import * as vscode from 'vscode';
import * as path from 'path';
import { WorkflowState, TaskStep, RoleDefinition, FallbackEvent, ProgressState } from '../roles/types';
import { getRoles, updateRole, saveRoles, createRole, getWorkspaceRolesFilePath } from '../roles/roleRegistry';
import { autoAssignBestModelsForRoles } from '../roles/roleModelAdvisor';
import { ModelInfo, UnifiedModelCatalog, getBidiLiveModels } from '../models';
import { searchModels } from '../roles/fuzzySearch';
import { SerialOrchestrator } from '../orchestration/orchestrator';
import { isVoiceActive, isVoiceTalking, isVoiceMuted, refreshStatusBar, getGeminiApiKeys, saveGeminiApiKeys, getWorkspaceContext } from '../extension';
import { agentSystem, streamCompletion, executeTools, ANTIGRAVITY_TOOLS, ChatMessage, NativeToolCall } from '../chat';
import { SessionManager } from '../session/sessionManager';

export interface WebviewChatMessage {
  id: string;
  sender: 'user' | 'ai' | 'role' | 'system' | 'voice';
  roleName?: string;
  roleModel?: string;
  taskName?: string;
  taskPrompt?: string;
  stepId?: string;
  content: string;
  timestamp: string;
  logs?: string[];
  status?: 'Running' | 'Completed' | 'Failed' | 'Queued' | 'Pending';
  from?: 'user' | 'ai';
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export class WorkflowWebviewPanel {
  public static currentPanel: WorkflowWebviewPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _orchestrator: SerialOrchestrator;
  private _context: vscode.ExtensionContext;
  private _catalog: ModelInfo[];
  private _chatMessages: WebviewChatMessage[] = [];
  private _chatHistory: ChatMessage[] = [];
  private _activeVoiceMsgId?: string;
  private _activeWorkflowId?: string;

  private _initialTab?: string;

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    context: vscode.ExtensionContext,
    orchestrator: SerialOrchestrator,
    catalog: ModelInfo[],
    initialTab?: string
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._context = context;
    this._orchestrator = orchestrator;
    this._initialTab = initialTab;
    this._catalog = catalog && catalog.length > 0 ? catalog : UnifiedModelCatalog.getInstance().getModels();
    SessionManager.initialize(context);
    const sessionMgr = SessionManager.getInstance();
    const sessionOpts = sessionMgr.getOptions();
    if (sessionOpts.resumeOnOpen) {
      const activeSess = sessionMgr.getActiveSession();
      this._chatMessages = [...activeSess.chatMessages];
      this._chatHistory = [...activeSess.chatHistory];
    }

    const unsub = UnifiedModelCatalog.getInstance().onModelsUpdated((models) => {
      this._catalog = models;
      this.sendState();
    });
    this._disposables.push({ dispose: unsub });

    this._update();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'clientError':
            console.error('[9 Router Webview Client Error]', message.error);
            return;

          case 'ready':
            this.sendState();
            if (this._initialTab === 'chat') {
              this.openChatWithSelectedModel();
            }
            return;

          case 'refresh':
            this._update();
            this.sendState();
            return;

          case 'pauseWorkflow':
            this._orchestrator.pause();
            return;

          case 'resumeWorkflow':
            this._orchestrator.resume();
            return;

          case 'cancelWorkflow':
            this._orchestrator.cancel();
            return;

          case 'saveRole':
            if (message.role) {
              await updateRole(this._context, message.role);
              this.sendState();
            }
            return;

          case 'autoAssignRoles': {
            const roles = getRoles(this._context);
            const { updatedRoles, result } = autoAssignBestModelsForRoles(roles, this._catalog, message.strategy || 'quality');
            await saveRoles(this._context, updatedRoles);
            vscode.window.showInformationMessage(`Auto-assigned models: ${result.summary}`);
            this.sendState();
            return;
          }

          case 'openRolesJson': {
            const filePath = getWorkspaceRolesFilePath();
            if (filePath) {
              const uri = vscode.Uri.file(filePath);
              try {
                const doc = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(doc);
              } catch (err) {
                vscode.window.showErrorMessage(`Failed to open ${filePath}: ${err}`);
              }
            } else {
              vscode.window.showWarningMessage('No workspace open to locate .antigravity/roles.json');
            }
            return;
          }

          case 'fuzzySearchModels': {
            const q = message.query || '';
            const results = searchModels(q, this._catalog);
            this._panel.webview.postMessage({
              type: 'fuzzySearchResults',
              field: message.field,
              roleId: message.roleId,
              query: q,
              totalCount: results.length,
              catalogSize: this._catalog.length,
              models: results.slice(0, 1000).map((m) => ({
                id: m.id,
                provider: m.provider,
                caps: m.caps,
                source: m.source
              }))
            });
            return;
          }

          case 'refreshRouterModels': {
            try {
              const cfg = vscode.workspace.getConfiguration('antigravity.models');
              const baseUrl = (cfg.get<string>('baseUrl') ?? 'http://127.0.0.1:20128/v1').trim();
              const apiKey = cfg.get<string>('apiKey')?.trim() || undefined;
              this._catalog = await UnifiedModelCatalog.getInstance().syncWithRouter(baseUrl, apiKey, true);
              const qStr = message.query || '';
              const rList = searchModels(qStr, this._catalog);
              this._panel.webview.postMessage({
                type: 'fuzzySearchResults',
                field: message.field,
                roleId: message.roleId,
                query: qStr,
                totalCount: rList.length,
                catalogSize: this._catalog.length,
                refreshed: true,
                models: rList.slice(0, 1000).map((m) => ({
                  id: m.id,
                  provider: m.provider,
                  caps: m.caps,
                  source: m.source
                }))
              });
              this.sendState();
            } catch (err) {
              console.error('Failed to sync 9 Router models', err);
            }
            return;
          }

          case 'selectActiveModel':
            if (message.modelId) {
              await this._context.workspaceState.update('antigravity.models.selected', message.modelId);
              refreshStatusBar();
              vscode.window.showInformationMessage(`Active 9 Router model: ${message.modelId}`);
              this.sendState();
            }
            return;

          case 'toggleVoiceMode':
            await vscode.commands.executeCommand('antigravity.models.voice');
            this.sendState();
            return;

          case 'toggleVoiceMute':
            await vscode.commands.executeCommand('antigravity.voice.mute');
            this.sendState();
            return;

          case 'interruptVoice':
            await vscode.commands.executeCommand('antigravity.voice.interrupt');
            this.sendState();
            return;

          case 'toggleVoiceTalk':
            await vscode.commands.executeCommand('antigravity.voice.talk');
            this.sendState();
            return;

          case 'openRecordingsFolder':
            await vscode.commands.executeCommand('antigravity.voice.openRecordings');
            return;

          case 'copyLatestAudio':
            await vscode.commands.executeCommand('antigravity.voice.copyLatestAudio');
            return;

          case 'checkMicLevel':
            await vscode.commands.executeCommand('antigravity.voice.micLevel');
            return;

          case 'listAudioDevices':
            await vscode.commands.executeCommand('antigravity.voice.devices');
            return;

          case 'setLiveModel':
            if (message.liveModel) {
              const vCfg = vscode.workspace.getConfiguration('antigravity.voice');
              await vCfg.update('liveModel', message.liveModel, vscode.ConfigurationTarget.Global);
              vscode.window.showInformationMessage(`Gemini Live model: ${message.liveModel}`);
              this.sendState();
            }
            return;

          case 'addGeminiApiKey':
            if (message.key && message.key.trim()) {
              const curr = getGeminiApiKeys(this._context);
              const trimmed = message.key.trim();
              if (!curr.includes(trimmed)) {
                curr.push(trimmed);
                await saveGeminiApiKeys(this._context, curr);
                vscode.window.showInformationMessage('Gemini API key added for Voice Mode.');
                this.sendState();
              }
            }
            return;

          case 'removeGeminiApiKey': {
            const curr = getGeminiApiKeys(this._context);
            if (typeof message.index === 'number' && curr[message.index]) {
              curr.splice(message.index, 1);
              await saveGeminiApiKeys(this._context, curr);
              vscode.window.showInformationMessage('Gemini API key removed.');
              this.sendState();
            }
            return;
          }

          case 'clearGeminiApiKeys':
            await saveGeminiApiKeys(this._context, []);
            vscode.window.showInformationMessage('Cleared all Gemini API keys.');
            this.sendState();
            return;

          case 'saveSessionOptions': {
            const sess = vscode.workspace.getConfiguration('antigravity.session');
            if (typeof message.temperature === 'number') await sess.update('temperature', message.temperature, vscode.ConfigurationTarget.Global);
            if (typeof message.maxTokens === 'number') await sess.update('maxTokens', message.maxTokens, vscode.ConfigurationTarget.Global);
            if (typeof message.systemPrompt === 'string') await sess.update('systemPrompt', message.systemPrompt, vscode.ConfigurationTarget.Global);
            if (typeof message.allowShell === 'boolean') await sess.update('allowShell', message.allowShell, vscode.ConfigurationTarget.Global);
            if (typeof message.allowVscode === 'boolean') await sess.update('allowVscode', message.allowVscode, vscode.ConfigurationTarget.Global);
            if (typeof message.allowFiles === 'boolean') await sess.update('allowFiles', message.allowFiles, vscode.ConfigurationTarget.Global);
            if (typeof message.maxTurns === 'number') await sess.update('maxTurns', message.maxTurns, vscode.ConfigurationTarget.Global);
            if (typeof message.resumeOnOpen === 'boolean') await sess.update('resumeOnOpen', message.resumeOnOpen, vscode.ConfigurationTarget.Global);
            if (typeof message.persistHistory === 'boolean') await sess.update('persistHistory', message.persistHistory, vscode.ConfigurationTarget.Global);
            if (typeof message.unifiedVoiceAndText === 'boolean') await sess.update('unifiedVoiceAndText', message.unifiedVoiceAndText, vscode.ConfigurationTarget.Global);
            if (typeof message.maxPersistedTurns === 'number') await sess.update('maxPersistedTurns', message.maxPersistedTurns, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage('Session & Security options updated.');
            this.sendState();
            return;
          }

          case 'newSession': {
            const selectedModel = this._context.workspaceState.get<string>('antigravity.models.selected') || 'ag/gemini-3.8-flash-high';
            const newSess = SessionManager.getInstance().createNewSession(selectedModel);
            this._chatMessages = [];
            this._chatHistory = [];
            this.sendState();
            this._panel.webview.postMessage({ type: 'chatCleared' });
            vscode.window.showInformationMessage(`Started new session: ${newSess.title}`);
            return;
          }

          case 'loadSession': {
            if (message.sessionId) {
              const loaded = SessionManager.getInstance().switchSession(message.sessionId);
              if (loaded) {
                this._chatMessages = [...loaded.chatMessages];
                this._chatHistory = [...loaded.chatHistory];
                this.sendState();
                this._panel.webview.postMessage({ type: 'chatReloaded', chatMessages: this._chatMessages });
                vscode.window.showInformationMessage(`Loaded session: ${loaded.title}`);
              }
            }
            return;
          }

          case 'clearAllSessions': {
            SessionManager.getInstance().clearAllSessions();
            this._chatMessages = [];
            this._chatHistory = [];
            this.sendState();
            this._panel.webview.postMessage({ type: 'chatCleared' });
            vscode.window.showInformationMessage('All saved session histories cleared.');
            return;
          }

          case 'exportSession': {
            const md = SessionManager.getInstance().exportSessionMarkdown();
            const doc = await vscode.workspace.openTextDocument({ content: md, language: 'markdown' });
            await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
            return;
          }

          case 'toggleFilterLive': {
            const mCfg = vscode.workspace.getConfiguration('antigravity.models');
            const curr = mCfg.get<boolean>('filterLive') !== false;
            await mCfg.update('filterLive', !curr, vscode.ConfigurationTarget.Global);
            this.sendState();
            return;
          }

          case 'startChat':
            await vscode.commands.executeCommand('antigravity.models.chat');
            return;

          case 'startNewTask':
            await vscode.commands.executeCommand('antigravity.orchestration.startTask');
            return;

          case 'chatSubmit': {
            const text = (message.text || '').trim();
            if (!text) return;
            const mode = message.mode || 'pipeline';
            const selectedModel = message.selectedModel || this._context.workspaceState.get<string>('antigravity.models.selected') || 'ag/gemini-3.8-flash-high';

            if (mode === 'pipeline') {
              this.appendChatMessage({
                id: `msg_u_${Date.now()}`,
                sender: 'user',
                content: text,
                timestamp: new Date().toLocaleTimeString()
              });
              await vscode.commands.executeCommand('antigravity.orchestration.executeGoal', text);
            } else {
              this.appendChatMessage({
                id: `msg_u_${Date.now()}`,
                sender: 'user',
                content: text,
                timestamp: new Date().toLocaleTimeString()
              });
              void this.handleDirectChat(text, selectedModel);
            }
            return;
          }

          case 'clearChat':
            this._chatMessages = [];
            this._chatHistory = [];
            SessionManager.getInstance().clearActiveSession();
            this.sendState();
            this._panel.webview.postMessage({ type: 'chatCleared' });
            return;
        }
      },
      null,
      this._disposables
    );
  }

  public postMessage(message: any): Thenable<boolean> {
    return this._panel.webview.postMessage(message);
  }

  public clearChatUI(): void {
    this._chatMessages = [];
    this._chatHistory = [];
    this.sendState();
    this._panel.webview.postMessage({ type: 'chatCleared' });
  }

  public switchTab(tab: 'workflow' | 'roles' | 'models' | 'voice' | 'session' | 'chat'): void {
    this._panel.webview.postMessage({ type: 'switchTab', tab });
  }

  public appendChatMessage(msg: WebviewChatMessage): void {
    this._chatMessages.push(msg);
    SessionManager.getInstance().appendWebviewMessage(msg);
    this._panel.webview.postMessage({ type: 'chatMessage', message: msg });
  }

  public appendChatDelta(id: string, text: string): void {
    const existing = this._chatMessages.find((m) => m.id === id);
    if (existing) {
      existing.content += text;
      SessionManager.getInstance().appendChatDelta(id, text);
    }
    this._panel.webview.postMessage({ type: 'chatDelta', id, text });
  }

  public appendChatLog(line: string, roleName?: string): void {
    const activeRoleMsg = [...this._chatMessages].reverse().find((m) => m.sender === 'role' && m.status === 'Running');
    if (activeRoleMsg) {
      if (!activeRoleMsg.logs) activeRoleMsg.logs = [];
      activeRoleMsg.logs.push(line);
      SessionManager.getInstance().scheduleSave();
    }
    this._panel.webview.postMessage({ type: 'chatLog', logLine: line, roleName });
  }

  public appendVoiceTurn(text: string, turnComplete: boolean, from?: 'user' | 'ai'): void {
    if (!turnComplete) {
      if (!this._activeVoiceMsgId) {
        this._activeVoiceMsgId = `v_${Date.now()}`;
        const msg: WebviewChatMessage = {
          id: this._activeVoiceMsgId,
          sender: 'voice',
          from: from || 'ai',
          content: text,
          timestamp: new Date().toLocaleTimeString()
        };
        this.appendChatMessage(msg);
      } else {
        this.appendChatDelta(this._activeVoiceMsgId, text);
      }
    } else {
      if (this._activeVoiceMsgId) {
        const finished = this._chatMessages.find((m) => m.id === this._activeVoiceMsgId);
        if (finished) {
          SessionManager.getInstance().appendVoiceTurn(finished.content, (finished.from as any) || from || 'ai');
        }
      }
      this._activeVoiceMsgId = undefined;
    }
  }

  public onAudioFileSaved(filePath: string, format: 'wav' | 'mp3'): void {
    const fileName = path.basename(filePath);
    this._panel.webview.postMessage({ type: 'audioSaved', filePath, format, fileName });
  }

  public onWorkflowUpdated(wf: WorkflowState): void {
    this._panel.webview.postMessage({ type: 'chatWorkflowUpdated', workflow: wf });

    // 1. Initial workflow kickoff: display user goal, AI Orchestrator breakdown, and all planned role cards
    if (wf.id !== this._activeWorkflowId) {
      this._activeWorkflowId = wf.id;

      // Ensure user's prompt is displayed in chat
      if (!this._chatMessages.some((m) => m.sender === 'user' && m.content === wf.userGoal)) {
        this.appendChatMessage({
          id: `msg_u_${Date.now()}`,
          sender: 'user',
          content: wf.userGoal,
          timestamp: new Date().toLocaleTimeString()
        });
      }

      // Display AI Orchestrator's initial plan
      const roleSequence = wf.steps.map((s, idx) => `${idx + 1}. ${s.roleName}`).join(' ➔ ');
      this.appendChatMessage({
        id: `orch_intro_${wf.id}`,
        sender: 'ai',
        roleModel: 'AI Orchestrator',
        content: `I'll break this task into ${wf.steps.length} specialized roles and execute them sequentially:\n\n${roleSequence}`,
        timestamp: new Date().toLocaleTimeString()
      });

      // Render all planned steps into the feed
      wf.steps.forEach((step, idx) => {
        const isFirst = idx === 0;
        const prevRole = idx > 0 ? wf.steps[idx - 1].roleName : '';
        const initialStatus = isFirst ? 'Running' : 'Queued';
        const initialContent = isFirst
          ? (step.taskName || `Starting ${step.roleName}…`)
          : `Waiting for ${prevRole}…`;
        const initialLogs = isFirst
          ? [`[${step.roleName}] Initialized execution with model ${step.assignedModel}…`]
          : [`Queued: Waiting for ${prevRole} to complete…`];

        this.appendChatMessage({
          id: `role_step_${step.id}`,
          stepId: step.id,
          taskPrompt: step.taskPrompt,
          sender: 'role',
          roleName: step.roleName,
          roleModel: step.assignedModel,
          taskName: step.taskName,
          content: initialContent,
          timestamp: new Date().toLocaleTimeString(),
          status: initialStatus,
          logs: initialLogs
        });
      });
    }

    // 2. Live step transitions: update active and completed role cards
    if (wf.status === 'Running') {
      wf.steps.forEach((step, idx) => {
        const card = this._chatMessages.find((m) => m.id === `role_step_${step.id}`);
        if (!card) return;

        if (idx < wf.activeStepIndex || step.status === 'Completed') {
          card.status = 'Completed';
          if (step.resultSummary) {
            card.content = step.resultSummary.slice(0, 160) + '…';
          } else {
            card.content = `${step.taskName} - Completed.`;
          }
        } else if (idx === wf.activeStepIndex) {
          card.status = 'Running';
          card.content = step.taskName || `Executing ${step.roleName}…`;
        } else {
          card.status = 'Queued';
          const prevRole = idx > 0 ? wf.steps[idx - 1].roleName : '';
          card.content = `Waiting for ${prevRole}…`;
        }
      });
    }

    // 3. Final completion
    if (wf.status === 'Completed') {
      this._chatMessages.forEach((m) => {
        if (m.sender === 'role') {
          m.status = 'Completed';
        }
      });

      if (!this._chatMessages.some((m) => m.id === `orch_done_${wf.id}`)) {
        const summary = wf.verificationResult?.summary || 'All planned specialized roles have completed.';
        const roleList = wf.steps.map((s) => `✓ ${s.roleName}`).join('\n');
        this.appendChatMessage({
          id: `orch_done_${wf.id}`,
          sender: 'ai',
          roleModel: 'AI Orchestrator',
          content: `Task completed successfully.\n\n${roleList}\n\n${summary}`,
          timestamp: new Date().toLocaleTimeString()
        });
      }
    }

    // 4. Role failure
    if (wf.status === 'Failed') {
      const failedStep = wf.steps.find((s) => s.status === 'Failed') || wf.steps[wf.activeStepIndex];
      const card = failedStep ? this._chatMessages.find((m) => m.id === `role_step_${failedStep.id}`) : undefined;
      if (card) {
        card.status = 'Failed';
        card.content = failedStep.error || 'Execution failed';
      }

      if (!this._chatMessages.some((m) => m.id === `orch_fail_${wf.id}`)) {
        this.appendChatMessage({
          id: `orch_fail_${wf.id}`,
          sender: 'ai',
          roleModel: 'AI Orchestrator',
          content: `Role "${failedStep?.roleName || 'Specialized Role'}" failed: ${failedStep?.error || 'Execution encountered an unrecoverable error'}.\n\nExecution has been paused. You can inspect logs, switch models, or retry.`,
          timestamp: new Date().toLocaleTimeString()
        });
      }
    }
  }

  public onStepProgress(stepId: string, state: ProgressState, pct?: number, note?: string): void {
    this._panel.webview.postMessage({ type: 'chatStepProgress', stepId, state, pct, note });
    const card = this._chatMessages.find((m) => m.id === `role_step_${stepId}`);
    if (card) {
      if (!card.logs) card.logs = [];
      const pctStr = typeof pct === 'number' ? ` (${pct}%)` : '';
      const noteStr = note ? ` - ${note}` : '';
      card.logs.push(`[progress] ${state}${pctStr}${noteStr}`);
    }
  }

  public onFallback(event: FallbackEvent): void {
    this.appendChatMessage({
      id: `fallback_${Date.now()}`,
      sender: 'system',
      content: `⚠️ [Fallback Triggered] Role "${event.roleId}": Model "${event.fromModel}" failed (${event.reason}) -> Auto-switched to Fallback Model "${event.toModel}"`,
      timestamp: new Date().toLocaleTimeString()
    });
  }

  public onVerification(result: WorkflowState['verificationResult']): void {
    if (!result) return;
    this.appendChatMessage({
      id: `ver_${Date.now()}`,
      sender: 'system',
      content: `✓ [Verification Outcome] ${result.verified ? 'PASSED' : 'NEEDS ATTENTION'}: ${result.summary}`,
      timestamp: new Date().toLocaleTimeString()
    });
  }

  public async handleDirectChat(userText: string, model: string): Promise<void> {
    const aiMsgId = `msg_ai_${Date.now()}`;
    const timestamp = new Date().toLocaleTimeString();

    this.appendChatMessage({
      id: aiMsgId,
      sender: 'ai',
      roleModel: model,
      content: '',
      timestamp
    });

    const cfg = vscode.workspace.getConfiguration('antigravity.router');
    const baseUrl = (cfg.get<string>('baseUrl') ?? 'http://127.0.0.1:20128/v1').trim();
    const apiKey = (cfg.get<string>('apiKey') ?? '').trim() || undefined;

    const sessCfg = vscode.workspace.getConfiguration('antigravity.session');
    const temp = sessCfg.get<number>('temperature') ?? 0.5;
    const maxTokens = sessCfg.get<number>('maxTokens') ?? 4096;
    const sysPrompt = sessCfg.get<string>('systemPrompt') || '';
    const allowShell = sessCfg.get<boolean>('allowShell') !== false;
    const allowVscode = sessCfg.get<boolean>('allowVscode') !== false;
    const allowFiles = sessCfg.get<boolean>('allowFiles') !== false;

    const roots = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0)
      ? vscode.workspace.workspaceFolders.map((f) => f.uri.fsPath)
      : [process.cwd()];

    if (this._chatHistory.length === 0) {
      const sys = (sysPrompt ? sysPrompt + '\n\n' : '') + agentSystem(roots);
      this._chatHistory.push({ role: 'system', content: sys });
    }

    const ideContext = getWorkspaceContext();
    const userMessageContent = ideContext ? `${ideContext}${userText}` : userText;
    this._chatHistory.push({ role: 'user', content: userMessageContent });

    try {
      for (let turn = 0; turn < 10; turn++) {
        const res = await streamCompletion(
          {
            baseUrl,
            apiKey,
            model,
            messages: this._chatHistory,
            temperature: temp,
            maxTokens,
            tools: ANTIGRAVITY_TOOLS
          },
          (delta) => {
            this.appendChatDelta(aiMsgId, delta);
          }
        );

        const replyContent = res.content || '';
        const toolCalls = res.toolCalls || [];

        if (!toolCalls.length) {
          this._chatHistory.push({ role: 'assistant', content: replyContent || '[Completed]' });
          SessionManager.getInstance().getActiveSession().chatHistory = this._chatHistory;
          SessionManager.getInstance().scheduleSave();
          break;
        }

        this.appendChatLog(`[${model}] Executing ${toolCalls.length} tool call(s)…`);
        const toolResults = await executeTools(
          replyContent,
          roots,
          { allowShell, allowVscode, allowFiles },
          toolCalls
        );
        for (const tr of toolResults) {
          this.appendChatLog(`[${model}] Tool '${tr.tool}': ${tr.output.slice(0, 300)}`);
        }

        this._chatHistory.push({
          role: 'assistant',
          content: replyContent,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments)
            }
          }))
        });

        for (let i = 0; i < toolCalls.length; i++) {
          const tc = toolCalls[i];
          const tr = toolResults[i];
          this._chatHistory.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.name,
            content: tr ? tr.output : '[done]'
          });
        }
        SessionManager.getInstance().getActiveSession().chatHistory = this._chatHistory;
        SessionManager.getInstance().scheduleSave();
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.appendChatDelta(aiMsgId, `\n\n⚠️ Error chatting with ${model}: ${errMsg}`);
      SessionManager.getInstance().getActiveSession().chatHistory = this._chatHistory;
      SessionManager.getInstance().scheduleSave();
    }
  }

  public updateCatalog(catalog: ModelInfo[]) {
    this._catalog = catalog;
  }

  public static createOrShow(
    extensionUri: vscode.Uri,
    context: vscode.ExtensionContext,
    orchestrator: SerialOrchestrator,
    catalog?: ModelInfo[],
    initialTab?: string
  ): WorkflowWebviewPanel {
    const activeCatalog = catalog && catalog.length > 0 ? catalog : UnifiedModelCatalog.getInstance().getModels();
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (WorkflowWebviewPanel.currentPanel) {
      WorkflowWebviewPanel.currentPanel._panel.reveal(column);
      if (catalog) WorkflowWebviewPanel.currentPanel.updateCatalog(catalog);
      WorkflowWebviewPanel.currentPanel.sendState();
      if (initialTab) {
        WorkflowWebviewPanel.currentPanel.switchTab(initialTab as any);
      }
      if (initialTab === 'chat') {
        WorkflowWebviewPanel.currentPanel.openChatWithSelectedModel();
      }
      return WorkflowWebviewPanel.currentPanel;
    }

    const title = initialTab === 'chat' ? '9 Router: Chat with Selected Model' : '9 Router: Workflow & Roles';

    const panel = vscode.window.createWebviewPanel(
      'antigravityWorkflow',
      title,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri]
      }
    );

    WorkflowWebviewPanel.currentPanel = new WorkflowWebviewPanel(
      panel,
      extensionUri,
      context,
      orchestrator,
      activeCatalog,
      initialTab
    );
    return WorkflowWebviewPanel.currentPanel;
  }

  public static openChatWithSelectedModel(
    extensionUri: vscode.Uri,
    context: vscode.ExtensionContext,
    orchestrator: SerialOrchestrator,
    catalog?: ModelInfo[]
  ): WorkflowWebviewPanel {
    const panel = WorkflowWebviewPanel.createOrShow(extensionUri, context, orchestrator, catalog, 'chat');
    panel.openChatWithSelectedModel();
    return panel;
  }

  public openChatWithSelectedModel(): void {
    this._initialTab = 'chat';
    this._panel.webview.postMessage({ type: 'openChatWithSelectedModel' });
  }

  public sendState() {
    const wf = this._orchestrator.workflow;
    const roles = getRoles(this._context);
    const selectedModel = this._context.workspaceState.get<string>('antigravity.models.selected') || 'ag/gemini-3.8-flash-high';

    const sessCfg = vscode.workspace.getConfiguration('antigravity.session');
    const sessionMgr = SessionManager.getInstance();
    const mgrOpts = sessionMgr.getOptions();
    const activeSession = sessionMgr.getActiveSession();
    const sessionOpts = {
      temperature: sessCfg.get<number>('temperature') ?? 0.5,
      maxTokens: sessCfg.get<number>('maxTokens') ?? 4096,
      systemPrompt: sessCfg.get<string>('systemPrompt') || '',
      allowShell: sessCfg.get<boolean>('allowShell') !== false,
      allowVscode: sessCfg.get<boolean>('allowVscode') !== false,
      allowFiles: sessCfg.get<boolean>('allowFiles') !== false,
      maxTurns: sessCfg.get<number>('maxTurns') ?? 40,
      resumeOnOpen: mgrOpts.resumeOnOpen,
      persistHistory: mgrOpts.persistHistory,
      unifiedVoiceAndText: mgrOpts.unifiedVoiceAndText,
      maxPersistedTurns: mgrOpts.maxPersistedTurns
    };

    const voiceCfg = vscode.workspace.getConfiguration('antigravity.voice');
    const voiceOpts = {
      liveModel: voiceCfg.get<string>('liveModel') || 'gemini-3.1-flash-live-preview',
      ttsVoice: voiceCfg.get<string>('ttsVoice') || 'Kore',
      inputDevice: voiceCfg.get<string>('inputDevice') || '#auto',
      echoCancellation: voiceCfg.get<boolean>('echoCancellation') !== false
    };

    const rawKeys = getGeminiApiKeys(this._context);
    const apiKeys = rawKeys.map((k) => ({
      full: k,
      masked: k.length > 8 ? `${k.slice(0, 6)}...${k.slice(-4)}` : '****'
    }));

    const filterLive = vscode.workspace.getConfiguration('antigravity.models').get<boolean>('filterLive') !== false;
    const liveModels = getBidiLiveModels();

    const workspaceFolders = vscode.workspace.workspaceFolders;
    const workspacePath = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : process.cwd();
    const activeDoc = vscode.window.activeTextEditor?.document.fileName || 'No active editor file';

    this._panel.webview.postMessage({
      type: 'updateState',
      workflow: wf,
      roles,
      selectedModel,
      sessionOpts,
      activeSession: {
        id: activeSession.id,
        title: activeSession.title,
        createdAt: activeSession.createdAt,
        updatedAt: activeSession.updatedAt,
        messageCount: this._chatMessages.length
      },
      sessionList: sessionMgr.listSessions(),
      voiceOpts,
      voiceActive: isVoiceActive(),
      voiceTalking: isVoiceTalking(),
      voiceMuted: isVoiceMuted(),
      apiKeys,
      filterLive,
      liveModels,
      workspacePath,
      rolesJsonPath: getWorkspaceRolesFilePath(),
      activeDoc,
      catalogSize: this._catalog.length,
      topModels: this._catalog.slice(0, 50).map((m) => m.id),
      chatMessages: this._chatMessages,
      initialTab: this._initialTab
    });
  }

  public dispose() {
    SessionManager.getInstance().flushSync();
    WorkflowWebviewPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) x.dispose();
    }
  }

  private _update() {
    this._panel.webview.html = this._getHtmlForWebview(this._initialTab);
    setTimeout(() => this.sendState(), 100);
  }

  private _getHtmlForWebview(initialTab?: string): string {
    const isChat = initialTab === 'chat';
    const selectedModel = this._context.workspaceState.get<string>('antigravity.models.selected') || 'ag/gemini-3.8-flash-high';
    const wf = this._orchestrator.workflow;
    const roles = getRoles(this._context);

    const sessCfg = vscode.workspace.getConfiguration('antigravity.session');
    const sessionOpts = {
      temperature: sessCfg.get<number>('temperature') ?? 0.5,
      maxTokens: sessCfg.get<number>('maxTokens') ?? 4096,
      systemPrompt: sessCfg.get<string>('systemPrompt') || '',
      allowShell: sessCfg.get<boolean>('allowShell') !== false,
      allowVscode: sessCfg.get<boolean>('allowVscode') !== false,
      allowFiles: sessCfg.get<boolean>('allowFiles') !== false,
      maxTurns: sessCfg.get<number>('maxTurns') ?? 40
    };

    const voiceCfg = vscode.workspace.getConfiguration('antigravity.voice');
    const voiceOpts = {
      liveModel: voiceCfg.get<string>('liveModel') || 'gemini-3.1-flash-live-preview',
      ttsVoice: voiceCfg.get<string>('ttsVoice') || 'Kore',
      inputDevice: voiceCfg.get<string>('inputDevice') || '#auto',
      echoCancellation: voiceCfg.get<boolean>('echoCancellation') !== false
    };

    const rawKeys = getGeminiApiKeys(this._context);
    const apiKeys = rawKeys.map((k) => ({
      full: k,
      masked: k.length > 8 ? `${k.slice(0, 6)}...${k.slice(-4)}` : '****'
    }));

    const filterLive = vscode.workspace.getConfiguration('antigravity.models').get<boolean>('filterLive') !== false;
    const liveModels = getBidiLiveModels();

    const workspaceFolders = vscode.workspace.workspaceFolders;
    const workspacePath = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : process.cwd();
    const activeDoc = vscode.window.activeTextEditor?.document.fileName || 'No active editor file';

    const topModels = this._catalog.slice(0, 50).map((m) => m.id);
    const catalogSize = this._catalog.length;

    const initialState = {
      workflow: wf,
      roles,
      selectedModel,
      sessionOpts,
      voiceOpts,
      voiceActive: isVoiceActive(),
      voiceTalking: isVoiceTalking(),
      voiceMuted: isVoiceMuted(),
      apiKeys,
      filterLive,
      liveModels,
      workspacePath,
      rolesJsonPath: getWorkspaceRolesFilePath(),
      activeDoc,
      catalogSize,
      topModels,
      chatMessages: this._chatMessages,
      initialTab
    };
    const initialStateJson = JSON.stringify(initialState).replace(/</g, '\\u003c');
    const nonce = getNonce();
    const cspSource = this._panel.webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: http: data: blob:; script-src 'nonce-${nonce}' 'unsafe-inline' 'unsafe-eval' ${cspSource}; style-src 'unsafe-inline' ${cspSource}; font-src ${cspSource} data:; connect-src https: http: ws: wss:;">
  <title>9 Router: Control Center & Orchestrator</title>
  <style>
:root {
      --bg: #0f1117;
      --fg: #e2e8f0;
      --fg-muted: #94a3b8;
      --panel-bg: rgba(22, 27, 38, 0.85);
      --panel-bg-hover: rgba(30, 38, 54, 0.9);
      --border: rgba(255, 255, 255, 0.1);
      --border-focus: #3b82f6;
      --accent: #2563eb;
      --accent-hover: #1d4ed8;
      --accent-gradient: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
      --accent-glow: rgba(59, 130, 246, 0.35);
      --badge-completed: #10b981;
      --badge-running: #3b82f6;
      --badge-queued: #64748b;
      --badge-failed: #ef4444;
      --badge-fallback: #f59e0b;
      --card-radius: 8px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      height: 100%;
      margin: 0;
      padding: 0;
    }
    body {
      background: var(--bg);
      color: var(--fg);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      font-size: 13px;
      line-height: 1.5;
      padding: 12px 18px 10px 18px;
      overflow-y: auto;
      overflow-x: hidden;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      height: 100vh;
    }
    body.chat-active {
      overflow: hidden;
    }
    body.chat-active.hub-open {
      overflow-y: auto;
    }
    ::-webkit-scrollbar { width: 10px; height: 10px; }
    ::-webkit-scrollbar-track { background: rgba(0,0,0,0.15); border-radius: 5px; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 5px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(56,189,248,0.5); }

    /* Header Bar */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 8px;
      flex-wrap: wrap;
      gap: 10px;
      flex-shrink: 0;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .header-title {
      font-size: 19px;
      font-weight: 700;
      letter-spacing: -0.02em;
      display: flex;
      align-items: center;
      gap: 8px;
      background: var(--accent-gradient);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .header-status-pill {
      font-size: 11px;
      padding: 3px 10px;
      border-radius: 14px;
      background: rgba(255,255,255,0.06);
      border: 1px solid var(--border);
      color: var(--fg-muted);
      display: inline-flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .header-status-pill:hover {
      border-color: var(--border-focus);
      color: #fff;
    }
    .dot-live {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 8px #10b981;
    }
    .dot-voice-on {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #ef4444;
      animation: pulse 1.5s infinite;
    }

    /* Buttons */
    .btn {
      background: var(--accent);
      color: #fff;
      border: 1px solid transparent;
      padding: 6px 14px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s;
    }
    .btn:hover {
      background: var(--accent-hover);
      box-shadow: 0 0 12px var(--accent-glow);
    }
    .btn-gradient {
      background: var(--accent-gradient);
    }
    .btn-gradient:hover {
      box-shadow: 0 0 16px rgba(139, 92, 246, 0.4);
    }
    .btn-secondary {
      background: rgba(255,255,255,0.06);
      border: 1px solid var(--border);
      color: var(--fg);
    }
    .btn-secondary:hover {
      background: rgba(255,255,255,0.12);
      color: #fff;
      border-color: rgba(255,255,255,0.2);
    }
    .btn-danger {
      background: #dc2626;
      color: #fff;
    }
    .btn-danger:hover { background: #b91c1c; }
    .btn-success {
      background: #16a34a;
      color: #fff;
    }
    .btn-success:hover { background: #15803d; }

    /* Navigation Tabs */
    .tabs-bar {
      display: flex;
      gap: 6px;
      margin-bottom: 20px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 6px;
      overflow-x: auto;
    }
    .tab-btn {
      background: transparent;
      border: 1px solid transparent;
      color: var(--fg-muted);
      padding: 7px 15px;
      cursor: pointer;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 7px;
      transition: all 0.15s;
      white-space: nowrap;
    }
    .tab-btn:hover {
      color: #fff;
      background: rgba(255,255,255,0.05);
    }
    .tab-btn.active {
      background: rgba(59, 130, 246, 0.15);
      border: 1px solid rgba(59, 130, 246, 0.4);
      color: #60a5fa;
    }

    /* Quick Actions Hub */
    .quick-actions-section {
      margin-bottom: 14px;
      background: rgba(18, 24, 38, 0.75);
      border: 1px solid var(--border);
      border-radius: var(--card-radius);
      padding: 14px 16px;
      backdrop-filter: blur(12px);
      flex-shrink: 0;
      max-height: 55vh;
      overflow-y: auto;
    }
    .qa-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .qa-header-title {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #94a3b8;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .qa-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 10px;
      overflow-y: auto;
      max-height: 48vh;
      padding-right: 4px;
    }
    .qa-card {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.07);
      border-radius: 8px;
      padding: 10px 12px;
      cursor: pointer;
      display: flex;
      align-items: flex-start;
      gap: 10px;
      transition: all 0.2s ease;
      position: relative;
    }
    .qa-card:hover {
      background: rgba(59, 130, 246, 0.1);
      border-color: rgba(59, 130, 246, 0.45);
      transform: translateY(-2px);
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
    }
    .qa-icon {
      font-size: 18px;
      width: 32px;
      height: 32px;
      border-radius: 7px;
      background: rgba(255, 255, 255, 0.05);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .qa-content {
      flex: 1;
      min-width: 0;
    }
    .qa-title {
      font-size: 12.5px;
      font-weight: 600;
      color: #f1f5f9;
      margin-bottom: 2px;
      display: flex;
      align-items: center;
      gap: 5px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .qa-desc {
      font-size: 11px;
      color: #94a3b8;
      line-height: 1.35;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    /* Cards & Containers */
    .card {
      background: var(--panel-bg);
      border: 1px solid var(--border);
      border-radius: var(--card-radius);
      padding: 16px 20px;
      margin-bottom: 18px;
      backdrop-filter: blur(16px);
      box-shadow: 0 4px 16px rgba(0,0,0,0.25);
    }
    .card-title {
      font-size: 15px;
      font-weight: 600;
      margin-bottom: 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .section-desc {
      font-size: 12px;
      color: var(--fg-muted);
      margin-bottom: 14px;
    }

    /* Form Fields */
    .input-field {
      width: 100%;
      background: #090b10;
      border: 1px solid var(--border);
      color: #fff;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 12.5px;
      transition: border-color 0.15s;
      outline: none;
    }
    .input-field:focus {
      border-color: var(--border-focus);
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
    }
    textarea.input-field {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      min-height: 80px;
      resize: vertical;
    }
    .form-group {
      margin-bottom: 14px;
    }
    .form-label {
      display: block;
      font-size: 11.5px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--fg-muted);
      margin-bottom: 6px;
    }

    /* Badges */
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 9px;
      border-radius: 12px;
      font-size: 10.5px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .badge-Running { background: var(--badge-running); color: #fff; animation: pulse 2s infinite; }
    .badge-Completed { background: var(--badge-completed); color: #fff; }
    .badge-Queued { background: var(--badge-queued); color: #fff; }
    .badge-Failed { background: var(--badge-failed); color: #fff; }
    .badge-Fallback { background: var(--badge-fallback); color: #000; }
    @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.65; } 100% { opacity: 1; } }

    /* Workflow Pipeline Step Cards */
    .pipeline {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-bottom: 20px;
    }
    .step-card {
      background: rgba(22, 27, 38, 0.85);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px 18px;
      transition: all 0.2s;
    }
    .step-card.active-step {
      border-color: #3b82f6;
      box-shadow: 0 0 16px rgba(59, 130, 246, 0.25);
    }
    .step-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .step-title {
      font-size: 14px;
      font-weight: 600;
    }

    /* Role Cards Grid */
    .roles-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
      gap: 16px;
    }
    .role-card {
      background: rgba(22, 27, 38, 0.85);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .role-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }

    /* Models Hub */
    .filter-chips-bar {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }
    .chip {
      padding: 5px 12px;
      border-radius: 14px;
      font-size: 11.5px;
      font-weight: 500;
      background: rgba(255,255,255,0.06);
      border: 1px solid var(--border);
      color: var(--fg-muted);
      cursor: pointer;
      transition: all 0.15s;
    }
    .chip:hover {
      background: rgba(255,255,255,0.12);
      color: #fff;
    }
    .chip.active {
      background: rgba(59, 130, 246, 0.2);
      border-color: rgba(59, 130, 246, 0.5);
      color: #60a5fa;
    }
    .models-list-container {
      max-height: 520px;
      overflow-y: auto;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: rgba(10, 13, 18, 0.6);
    }
    .model-card-item {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      transition: background 0.15s;
    }
    .model-card-item:hover {
      background: rgba(255,255,255,0.04);
    }
    .model-card-item.is-active-model {
      border-left: 3px solid #10b981;
      background: rgba(16, 185, 129, 0.05);
    }
    .model-cap-tag {
      font-size: 9.5px;
      padding: 2px 6px;
      border-radius: 4px;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      color: #94a3b8;
      text-transform: uppercase;
      font-weight: 600;
    }
    .model-cap-tag.tag-router {
      background: rgba(59, 130, 246, 0.15);
      border-color: rgba(59, 130, 246, 0.4);
      color: #60a5fa;
    }

    /* Modal Popup */
    .modal {
      display: none;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.7);
      backdrop-filter: blur(8px);
      z-index: 1000;
      justify-content: center;
      align-items: center;
    }
    .modal.show { display: flex; }
    .modal-content {
      background: #161b26;
      border: 1px solid var(--border);
      border-radius: 10px;
      width: 90%;
      max-width: 680px;
      max-height: 85vh;
      overflow-y: auto;
      padding: 22px;
      box-shadow: 0 16px 40px rgba(0,0,0,0.6);
    }
    .model-list {
      max-height: 420px;
      overflow-y: auto;
      border: 1px solid var(--border);
      border-radius: 6px;
      margin-top: 8px;
    }
    .model-item {
      padding: 10px 14px;
      border-bottom: 1px solid var(--border);
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      transition: background 0.15s;
    }
    .model-item:hover {
      background: var(--accent);
      color: #fff;
    }
    .model-item:hover .model-detail,
    .model-item:hover .model-cap-tag {
      color: #f0f0f0 !important;
    }

    /* Voice Mode Orb */
    .voice-orb {
      width: 70px;
      height: 70px;
      border-radius: 50%;
      background: radial-gradient(circle, #3b82f6 0%, #1e1b4b 100%);
      box-shadow: 0 0 25px rgba(59, 130, 246, 0.4);
      display: flex;
      justify-content: center;
      align-items: center;
      font-size: 28px;
      transition: all 0.3s;
    }
    .voice-orb.active {
      background: radial-gradient(circle, #10b981 0%, #064e3b 100%);
      box-shadow: 0 0 35px rgba(16, 185, 129, 0.6);
      animation: orb-pulse 2s infinite;
    }
    @keyframes orb-pulse {
      0% { transform: scale(1); box-shadow: 0 0 25px rgba(16, 185, 129, 0.5); }
      50% { transform: scale(1.06); box-shadow: 0 0 45px rgba(16, 185, 129, 0.8); }
      100% { transform: scale(1); box-shadow: 0 0 25px rgba(16, 185, 129, 0.5); }
    }

    /* Tab Content base style */
    .tab-content {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      padding-bottom: 24px;
    }
    #chatTab.tab-content {
      overflow: hidden;
      padding-bottom: 0;
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    /* ==================== INTERACTIVE CHAT CONSOLE & SERIAL GRAPH ==================== */
    .chat-console-wrapper {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      height: 100%;
      overflow: hidden;
    }

    .chat-header-section {
      background: rgba(15, 23, 42, 0.75);
      border: 1px solid var(--border);
      border-radius: 10px;
      margin-bottom: 6px;
      backdrop-filter: blur(8px);
      overflow: hidden;
      flex-shrink: 0;
    }

    /* Always-visible compact strip at the top of the header */
    .chat-header-compact-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 12px;
      gap: 10px;
      cursor: default;
    }
    .chat-header-compact-bar .compact-left {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .chat-header-compact-bar .compact-mode-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      font-weight: 600;
      color: #38bdf8;
      background: rgba(56,189,248,0.1);
      border: 1px solid rgba(56,189,248,0.25);
      border-radius: 6px;
      padding: 2px 8px;
    }
    .chat-header-compact-bar .compact-status {
      font-size: 11px;
      color: var(--fg-muted);
      display: flex;
      align-items: center;
      gap: 5px;
    }

    /* Toggle button on the compact bar */
    #chatHeaderToggleBtn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 6px;
      padding: 2px 7px;
      cursor: pointer;
      color: var(--fg-muted);
      font-size: 11px;
      line-height: 1;
      transition: background 0.2s, border-color 0.2s, color 0.2s;
      flex-shrink: 0;
    }
    #chatHeaderToggleBtn:hover {
      background: rgba(56,189,248,0.12);
      border-color: rgba(56,189,248,0.4);
      color: #38bdf8;
    }
    #chatHeaderToggleBtn .hdr-chevron {
      display: inline-block;
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    #chatHeaderToggleBtn.hdr-collapsed .hdr-chevron {
      transform: rotate(-180deg);
    }

    /* Collapsible body of the header */
    #chatHeaderBody {
      overflow: hidden;
      max-height: 600px;
      opacity: 1;
      transition: max-height 0.38s cubic-bezier(0.4, 0, 0.2, 1),
                  opacity 0.28s ease,
                  padding 0.3s ease;
      padding: 0 16px 12px 16px;
    }
    #chatHeaderBody.hdr-collapsed {
      max-height: 0 !important;
      opacity: 0;
      padding-top: 0;
      padding-bottom: 0;
    }

    .chat-mode-toggle {
      display: inline-flex;
      background: rgba(10, 15, 26, 0.75);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 3px;
      gap: 3px;
    }
    .chat-mode-btn {
      background: transparent;
      border: none;
      color: var(--fg-muted);
      padding: 5px 12px;
      font-size: 11.5px;
      font-weight: 500;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .chat-mode-btn:hover {
      color: #fff;
      background: rgba(255, 255, 255, 0.06);
    }
    .chat-mode-btn.active {
      background: var(--accent-gradient);
      color: #fff;
      font-weight: 600;
      box-shadow: 0 2px 10px rgba(59, 130, 246, 0.35);
    }

    /* Top-Right Serial Pipeline Graph */
    .serial-graph-flow {
      display: flex;
      align-items: center;
      gap: 8px;
      overflow-x: auto;
      padding: 4px 2px;
      max-width: 100%;
    }

    /* Collapse wrapper for the pipeline graph body */
    #chatSerialGraphBody {
      overflow: hidden;
      max-height: 200px;
      transition: max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                  opacity 0.3s ease;
      opacity: 1;
    }
    #chatSerialGraphBody.graph-collapsed {
      max-height: 0 !important;
      opacity: 0;
    }

    /* Collapse toggle button */
    #graphCollapseBtn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 6px;
      padding: 2px 6px;
      cursor: pointer;
      color: var(--fg-muted);
      font-size: 11px;
      line-height: 1;
      transition: background 0.2s, border-color 0.2s, color 0.2s;
      margin-left: 6px;
      flex-shrink: 0;
    }
    #graphCollapseBtn:hover {
      background: rgba(56,189,248,0.12);
      border-color: rgba(56,189,248,0.4);
      color: #38bdf8;
    }
    #graphCollapseBtn .chevron {
      display: inline-block;
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    #graphCollapseBtn.collapsed .chevron {
      transform: rotate(-90deg);
    }

    .graph-node {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 11.5px;
      font-weight: 500;
      white-space: nowrap;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: #94a3b8;
    }

    /* 1. RUNNING = VIBRANT ORANGE WITH PULSING GLOW */
    .graph-node.node-running {
      background: rgba(249, 115, 22, 0.16) !important;
      border: 1.5px solid #f97316 !important;
      color: #fdba74 !important;
      box-shadow: 0 0 16px rgba(249, 115, 22, 0.45);
      animation: node-pulse-orange 1.8s infinite;
    }

    @keyframes node-pulse-orange {
      0% { transform: scale(1); box-shadow: 0 0 10px rgba(249, 115, 22, 0.4); }
      50% { transform: scale(1.03); box-shadow: 0 0 20px rgba(249, 115, 22, 0.65); }
      100% { transform: scale(1); box-shadow: 0 0 10px rgba(249, 115, 22, 0.4); }
    }

    /* 2. COMPLETED = VIBRANT GREEN WITH CHECKMARK */
    .graph-node.node-completed {
      background: rgba(16, 185, 129, 0.14) !important;
      border: 1.5px solid #10b981 !important;
      color: #6ee7b7 !important;
      box-shadow: 0 0 10px rgba(16, 185, 129, 0.25);
    }

    /* 3. QUEUED = SUBTLE NEUTRAL */
    .graph-node.node-queued {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: #64748b;
      opacity: 0.8;
    }

    .graph-node-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .graph-node.node-running .graph-node-dot {
      background: #f97316;
      box-shadow: 0 0 8px #f97316;
      animation: dot-pulse-orange 1.2s infinite;
    }

    @keyframes dot-pulse-orange {
      0% { transform: scale(0.9); opacity: 0.8; }
      50% { transform: scale(1.3); opacity: 1; }
      100% { transform: scale(0.9); opacity: 0.8; }
    }

    .graph-node.node-completed .graph-node-dot {
      background: #10b981;
      box-shadow: 0 0 6px #10b981;
    }

    .graph-node.node-queued .graph-node-dot {
      background: #64748b;
    }

    .graph-arrow {
      color: #475569;
      font-size: 11px;
      flex-shrink: 0;
    }
    .graph-arrow.arrow-completed { color: #10b981; }
    .graph-arrow.arrow-active { color: #f97316; }

    /* Chat Messages Stream */
    .chat-messages-stream {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 10px 4px;
      scroll-behavior: smooth;
    }

    .chat-bubble-row {
      display: flex;
      flex-direction: column;
      animation: fade-in-up 0.25s ease-out;
    }

    .chat-bubble-row.user-row { align-items: flex-end; }
    .chat-bubble-row.ai-row { align-items: flex-start; }
    .chat-bubble-row.role-row { align-items: stretch; }

    .chat-bubble-meta {
      font-size: 11px;
      color: var(--fg-muted);
      margin-bottom: 4px;
      display: flex;
      gap: 6px;
      align-items: center;
    }

    .chat-bubble {
      max-width: 85%;
      border-radius: 12px;
      padding: 11px 15px;
      font-size: 13px;
      line-height: 1.55;
      word-break: break-word;
      white-space: pre-wrap;
    }

    .chat-bubble.user-bubble {
      background: linear-gradient(135deg, #0284c7 0%, #2563eb 100%);
      color: #ffffff;
      border-bottom-right-radius: 3px;
      box-shadow: 0 4px 16px rgba(2, 132, 199, 0.3);
    }

    .chat-bubble.ai-bubble {
      background: rgba(30, 41, 59, 0.85);
      border: 1px solid rgba(56, 189, 248, 0.25);
      color: #f1f5f9;
      border-bottom-left-radius: 3px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
    }

    /* Distinct Voice Mode Transcript Bubbles */
    .chat-bubble.voice-user-bubble {
      background: linear-gradient(135deg, #0284c7 0%, #2563eb 100%) !important;
      color: #ffffff !important;
      border: 1px solid rgba(56, 189, 248, 0.45);
      box-shadow: 0 4px 16px rgba(2, 132, 199, 0.35);
    }

    .chat-bubble.voice-ai-bubble {
      background: rgba(30, 41, 59, 0.92) !important;
      border: 1px solid rgba(148, 163, 184, 0.25) !important;
      color: #f1f5f9 !important;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
    }

    /* Role Execution Card inside Chat */
    .chat-role-card {
      background: rgba(15, 23, 42, 0.85);
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 10px;
      padding: 12px 14px;
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.4);
      transition: border-color 0.3s;
    }

    .chat-role-card.role-card-pending {
      border-left: 4px solid #475569;
      opacity: 0.85;
    }

    .chat-role-card.role-card-running {
      border-left: 4px solid #f97316;
      box-shadow: 0 0 16px rgba(249, 115, 22, 0.28);
    }

    .chat-role-card.role-card-completed {
      border-left: 4px solid #10b981;
    }

    .chat-role-card.role-card-failed {
      border-left: 4px solid #ef4444;
    }

    .chat-role-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }

    .chat-role-log-box {
      background: rgba(0, 0, 0, 0.65);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 6px;
      padding: 8px 12px;
      font-family: 'Consolas', 'Courier New', monospace;
      font-size: 11.5px;
      color: #cbd5e1;
      max-height: 180px;
      overflow-y: auto;
      white-space: pre-wrap;
      line-height: 1.45;
    }

    /* Drag Resizer between Chat Stream and Input Bar */
    .chat-resizer {
      height: 8px;
      cursor: ns-resize;
      background: transparent;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 2px 0;
      transition: background 0.2s;
      flex-shrink: 0;
      border-radius: 4px;
    }
    .chat-resizer:hover, .chat-resizer.resizing {
      background: rgba(56, 189, 248, 0.25);
    }
    .chat-resizer::after {
      content: '';
      width: 42px;
      height: 3px;
      background: rgba(255, 255, 255, 0.25);
      border-radius: 2px;
    }
    .chat-resizer:hover::after, .chat-resizer.resizing::after {
      background: #38bdf8;
    }

    /* Bottom Input Box */
    .chat-input-bar {
      background: rgba(15, 23, 42, 0.95);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 7px 10px;
      margin-top: 6px;
      box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.35);
      backdrop-filter: blur(12px);
      flex-shrink: 0;
      position: sticky;
      bottom: 0;
      z-index: 20;
    }

    .dictating-active {
      background: #dc2626 !important;
      color: white !important;
      animation: dictate-pulse 1.2s infinite;
    }

    @keyframes dictate-pulse {
      0% { box-shadow: 0 0 6px rgba(220, 38, 38, 0.5); }
      50% { box-shadow: 0 0 18px rgba(220, 38, 38, 0.9); }
      100% { box-shadow: 0 0 6px rgba(220, 38, 38, 0.5); }
    }
  </style>
</head>
<body class="${isChat ? 'chat-active' : ''} ${!isChat ? 'hub-open' : ''}">
  <script id="initial-state" type="application/json" nonce="${nonce}">${initialStateJson}</script>

  <!-- Top Header Bar -->
  <div class="header">
    <div class="header-left">
      <div class="header-title">⚡ 9 Router: Workflow & Roles</div>
      <div class="header-status-pill" id="headerModelPill" data-tab="models" onclick="switchTab('models')" title="Click to view & change active model">
        <span class="dot-live"></span>
        <span id="headerModelText">Model: ${selectedModel}</span>
      </div>
      <div class="header-status-pill" id="headerVoicePill" data-tab="voice" onclick="switchTab('voice')" title="Click to view Voice Mode controls">
        <span id="headerVoiceDot" class="dot-live" style="background: #94a3b8; box-shadow: none;"></span>
        <span id="headerVoiceText">Voice: Ready</span>
      </div>
    </div>
    <div style="display: flex; gap: 8px; align-items: center;">
      <button class="btn btn-primary" data-action="openChatInterface" data-param="pipeline" onclick="openChatInterface('pipeline')" id="headerChatBtn" style="background: linear-gradient(135deg, #0284c7, #38bdf8); color: white; font-weight: 600; box-shadow: ${isChat ? '0 0 14px rgba(56,189,248,0.6)' : '0 2px 10px rgba(14,165,233,0.35)'};" title="Open Chat & AI Orchestration Workspace">💬 Chat</button>
      <button class="btn btn-gradient" id="headerNewTaskBtn" data-action="startTaskPrompt" onclick="startTaskPrompt()">+ New Task</button>
      <button class="btn btn-secondary" id="headerRefreshBtn" data-action="requestRefresh" onclick="requestRefresh()">⟳ Refresh</button>
    </div>
  </div>

  <!-- Quick Actions & All Features Hub -->
  <div class="quick-actions-section" id="quickActionsSection">
    <div class="qa-header">
      <div class="qa-header-title">⚡ Quick Features & Actions Hub</div>
      <button class="btn btn-secondary" data-action="toggleQuickHub" id="qaToggleBtn" style="font-size: 11px; padding: 3px 9px;">Show Hub</button>
    </div>
    <div class="qa-grid" id="qaGrid" style="${isChat ? 'display: none;' : ''}">
      <!-- 1. Workflow Pipeline & Roles -->
      <div class="qa-card" onclick="switchTab('workflow')" title="Monitor serial AI roles, prompt transparency & fallback chains">
        <div class="qa-icon" style="background: rgba(59,130,246,0.15); color: #60a5fa;">🔀</div>
        <div class="qa-content">
          <div class="qa-title">Workflow Pipeline & Roles</div>
          <div class="qa-desc">Monitor serial AI roles, prompt transparency & fallback chains</div>
        </div>
      </div>

      <!-- 2. Manage Specialized Roles -->
      <div class="qa-card" onclick="switchTab('roles')" title="Configure models, fallback chains, and system prompts">
        <div class="qa-icon" style="background: rgba(168,85,247,0.15); color: #c084fc;">👥</div>
        <div class="qa-content">
          <div class="qa-title">Manage Specialized Roles</div>
          <div class="qa-desc">Configure models, fallback chains, and system prompts</div>
        </div>
      </div>

      <!-- 3. Chat & AI Orchestrator -->
      <div class="qa-card" onclick="openChatInterface('pipeline')" title="Open Chat & AI Orchestration interface">
        <div class="qa-icon" style="background: rgba(14,165,233,0.15); color: #38bdf8;">💬</div>
        <div class="qa-content">
          <div class="qa-title">Chat & AI Orchestrator</div>
          <div class="qa-desc" id="qaSelectedModelDesc">Chat, dynamic role planning & live execution</div>
        </div>
      </div>

      <!-- 4. Session Options -->
      <div class="qa-card" onclick="switchTab('session')" title="Configure temperature, max tokens, prompt, and tool guardrails">
        <div class="qa-icon" style="background: rgba(249,115,22,0.15); color: #fb923c;">⚙️</div>
        <div class="qa-content">
          <div class="qa-title">Session options</div>
          <div class="qa-desc">temperature, max tokens, prompt, tools guardrails</div>
        </div>
      </div>

      <!-- 5. Select model for Live session -->
      <div class="qa-card" onclick="focusLiveModelSelect()" title="Select model for Gemini Live voice-to-voice session">
        <div class="qa-icon" style="background: rgba(236,72,153,0.15); color: #f472b6;">📡</div>
        <div class="qa-content">
          <div class="qa-title">Select model for Live session</div>
          <div class="qa-desc" id="qaLiveModelDesc">gemini-3.8-live-extended-thinking</div>
        </div>
      </div>

      <!-- 6. Configure Gemini API Keys -->
      <div class="qa-card" onclick="focusApiKeysSection()" title="Configure multi-key pool for Gemini Live with auto-fallback">
        <div class="qa-icon" style="background: rgba(245,158,11,0.15); color: #fbbf24;">🔑</div>
        <div class="qa-content">
          <div class="qa-title">Configure Gemini API Keys (Voice)</div>
          <div class="qa-desc" id="qaApiKeysDesc">Multi-key pool configured · fallback active</div>
        </div>
      </div>

      <!-- 7. Check Mic Level -->
      <div class="qa-card" onclick="checkMicLevel()" title="Capture 2s audio and evaluate microphone RMS level against noise gate">
        <div class="qa-icon" style="background: rgba(16,185,129,0.15); color: #34d399;">📊</div>
        <div class="qa-content">
          <div class="qa-title">Check mic level</div>
          <div class="qa-desc">capture 2s and report RMS vs. the noise gate</div>
        </div>
      </div>
    </div>
  </div>

  <!-- ==================== TAB 1: WORKFLOW ==================== -->
  <div id="workflowTab" class="tab-content" style="${isChat ? 'display: none;' : ''}">
    <div class="card" id="workflowHeroCard">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
        <div>
          <div style="font-size: 11px; text-transform: uppercase; color: var(--fg-muted); letter-spacing: 0.05em;">Current Requirement / Goal</div>
          <h2 id="goalText" style="font-size: 16px; font-weight: 600; margin-top: 4px;">(No active workflow)</h2>
        </div>
        <div id="statusBadgeContainer">
          <span class="badge badge-Queued" id="mainStatusBadge">Idle</span>
        </div>
      </div>
      <div id="stepProgressText" style="font-size: 12px; color: var(--fg-muted); margin-bottom: 12px;">0 steps active</div>
      <div id="workflowControls" style="display: flex; gap: 8px;"></div>
    </div>

    <div id="verificationBanner" class="card" style="display: none; border-left: 4px solid #10b981;">
      <div style="font-size: 13px; font-weight: 600; color: #10b981; margin-bottom: 4px;">✓ Workflow Complete & Verified</div>
      <div id="verificationSummaryText" style="font-size: 12px; color: var(--fg-muted);"></div>
    </div>

    <div class="card-title">Serial Execution Pipeline</div>
    <div class="pipeline" id="pipelineContainer"></div>
  </div>

  <!-- ==================== TAB 2: ROLES ==================== -->
  <div id="rolesTab" class="tab-content" style="display: none;">
    <div class="card" style="margin-bottom: 14px;">
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
        <div style="display: flex; align-items: center; gap: 10px; flex: 1;">
          <input type="text" class="input-field" id="roleFilterInput" placeholder="Filter roles by name, model, or purpose…" oninput="filterRoles()" style="margin: 0; max-width: 340px;" />
          <div style="font-size: 12px; color: var(--fg-muted);" id="rolesCountLabel">13 Specialized Roles configured</div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <button class="btn btn-secondary" onclick="openRolesJson()" title="Open workspace .antigravity/roles.json configuration">📂 roles.json</button>
          <button class="btn btn-primary" onclick="autoAssignRoles()" title="Auto-assign optimal 9 Router models & fallback chains for all roles">⚡ Auto-Assign 9 Router Models</button>
        </div>
      </div>
    </div>
    <div class="roles-grid" id="rolesGrid"></div>
  </div>

  <!-- ==================== TAB 3: MODELS HUB ==================== -->
  <div id="modelsTab" class="tab-content" style="display: none;">
    <div class="card">
      <div class="card-title">
        <span>Complete 9 Router Gateway Catalog</span>
        <button class="btn btn-secondary" onclick="syncModelsHub()" id="syncHubBtn">⟳ Sync 9 Router Gateway</button>
      </div>
      <div class="section-desc">Search and activate any of the 2,150 models from your 9 Router routing table. Selected model is instantly activated for chat and agent execution.</div>

      <input type="text" class="input-field" id="hubSearchInput" placeholder="Fuzzy search across all 9 Router models (e.g. ag/, claude, sonnet, gemini-3.8, reasoning, gpt-4o, openrouter)…" oninput="onHubSearch()" style="margin-bottom: 10px;" />

      <div class="filter-chips-bar" id="hubFilterChips">
        <div class="chip active" onclick="setHubFilter('', this)">All Models</div>
        <div class="chip" onclick="setHubFilter('ag/', this)">⚡ 9 Router (ag/)</div>
        <div class="chip" onclick="setHubFilter('claude', this)">Anthropic / Claude</div>
        <div class="chip" onclick="setHubFilter('gemini', this)">Google / Gemini</div>
        <div class="chip" onclick="setHubFilter('gpt', this)">OpenAI / GPT</div>
        <div class="chip" onclick="setHubFilter('copilot', this)">GitHub Copilot (gh/)</div>
        <div class="chip" onclick="setHubFilter('openrouter', this)">OpenRouter</div>
        <div class="chip" onclick="setHubFilter('llama', this)">Meta / Llama</div>
        <div class="chip" onclick="setHubFilter('deepseek', this)">DeepSeek</div>
        <div class="chip" onclick="setHubFilter('reasoning', this)">Reasoning / Thinking</div>
        <div class="chip" onclick="setHubFilter('tools', this)">Tool Calling</div>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 11.5px; color: var(--fg-muted);">
        <span id="hubCountStatus">Showing 2,150 models</span>
        <label style="cursor: pointer; display: flex; align-items: center; gap: 6px;">
          <input type="checkbox" id="hideLiveCheck" onchange="toggleHideLive(this.checked)" /> Hide Voice/Live models
        </label>
      </div>

      <div class="models-list-container" id="hubModelList"></div>
    </div>
  </div>

  <!-- ==================== TAB 4: VOICE & GEMINI LIVE ==================== -->
  <div id="voiceTab" class="tab-content" style="display: none;">
    <div class="card" style="display: flex; align-items: center; gap: 24px; padding: 24px;">
      <div class="voice-orb" id="voiceOrb">🎙️</div>
      <div style="flex: 1;">
        <div style="font-size: 17px; font-weight: 600; margin-bottom: 4px;" id="voiceStatusTitle">Voice Mode Ready</div>
        <div style="font-size: 12px; color: var(--fg-muted); margin-bottom: 14px;" id="voiceStatusDesc">Direct low-latency voice-to-voice with Gemini Live (BidiGenerateContent) and autonomous tool execution.</div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <button class="btn btn-gradient" id="voiceToggleBtn" onclick="toggleVoiceMode()">🎙️ Start Voice Mode</button>
          <button class="btn btn-primary" id="voiceTalkBtn" onclick="toggleVoiceTalk()" style="display: none;">🔴 Live Mic Active</button>
          <button class="btn btn-secondary" id="voiceMuteBtn" onclick="toggleVoiceMute()">🔇 Mute Mic</button>
          <button class="btn btn-secondary" onclick="checkMicLevel()">📊 Test Mic Level (2s)</button>
          <button class="btn btn-secondary" onclick="openRecordingsFolder()" title="Open folder containing saved WAV and MP3 audio files">📂 Recordings</button>
          <button class="btn btn-secondary" onclick="copyLatestAudioPath()" title="Copy file path of the latest audio recording">📋 Copy Audio</button>
          <button class="btn btn-secondary" onclick="listAudioDevices()">🎧 List Audio Devices</button>
        </div>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
      <!-- Gemini Live Model Selector -->
      <div class="card">
        <div class="card-title">Gemini Live Model</div>
        <div class="section-desc">Select the real-time voice-to-voice model used during live conversations.</div>
        <div class="form-group">
          <label class="form-label">Live Audio Model</label>
          <select class="input-field" id="liveModelSelect" onchange="onLiveModelChange(this.value)"></select>
        </div>
        <div class="form-group">
          <label class="form-label">TTS Agent Voice</label>
          <input type="text" class="input-field" id="ttsVoiceInput" value="Kore" readonly style="color: #94a3b8;" />
        </div>
      </div>

      <!-- Gemini API Keys Manager -->
      <div class="card">
        <div class="card-title">Gemini API Keys (Voice Mode)</div>
        <div class="section-desc">Multi-key automatic fallback. If a key exhausts its quota, Voice Mode switches seamlessly.</div>
        <div id="apiKeysList" style="margin-bottom: 12px;"></div>
        <div style="display: flex; gap: 8px;">
          <input type="password" class="input-field" id="newApiKeyInput" placeholder="Enter Gemini API key (AIzaSy…)" style="margin: 0;" />
          <button class="btn" onclick="addGeminiApiKey()">Add Key</button>
        </div>
      </div>
    </div>
  </div>

  <!-- ==================== TAB 5: SESSION & SECURITY ==================== -->
  <div id="sessionTab" class="tab-content" style="display: none;">
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
      <!-- Generation Parameters -->
      <div class="card">
        <div class="card-title">Model Generation Parameters</div>
        <div class="section-desc">Fine-tune temperature, max tokens, and conversation memory.</div>

        <div class="form-group">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <label class="form-label" style="margin: 0;">Temperature</label>
            <span id="tempValueBadge" class="badge" style="background: rgba(59, 130, 246, 0.2); color: #60a5fa;">0.5</span>
          </div>
          <input type="range" id="tempSlider" min="0" max="2" step="0.05" value="0.5" oninput="onTempSlider(this.value)" style="width: 100%;" />
        </div>

        <div class="form-group">
          <label class="form-label">Max Tokens per Reply</label>
          <input type="number" class="input-field" id="maxTokensInput" value="4096" min="256" max="131072" step="256" />
        </div>

        <div class="form-group">
          <label class="form-label">Conversation History Turns</label>
          <input type="number" class="input-field" id="maxTurnsInput" value="40" min="4" max="100" />
        </div>
      </div>

      <!-- Autonomous Guardrails -->
      <div class="card">
        <div class="card-title">Autonomous Execution Guardrails</div>
        <div class="section-desc">Control what actions the 9 Router agent is permitted to execute automatically.</div>

        <div class="form-group" style="margin-top: 10px;">
          <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; margin-bottom: 12px;">
            <input type="checkbox" id="allowShellCheck" style="width: 16px; height: 16px;" />
            <div>
              <div style="font-weight: 500;">Allow Shell & Terminal Commands</div>
              <div style="font-size: 11px; color: var(--fg-muted);">Agent can execute build tools, linters, tests, and git commands</div>
            </div>
          </label>

          <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; margin-bottom: 12px;">
            <input type="checkbox" id="allowVscodeCheck" style="width: 16px; height: 16px;" />
            <div>
              <div style="font-weight: 500;">Allow VS Code Internal Commands</div>
              <div style="font-size: 11px; color: var(--fg-muted);">Agent can trigger editor navigation, formatting, and file opening</div>
            </div>
          </label>

          <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
            <input type="checkbox" id="allowFilesCheck" style="width: 16px; height: 16px;" />
            <div>
              <div style="font-weight: 500;">Allow File Reading & File Creation</div>
              <div style="font-size: 11px; color: var(--fg-muted);">Agent can inspect repository files and create or update code files</div>
            </div>
          </label>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top: 14px;">
      <div class="card-title">Session Resumption & Continuity (Voice & Text)</div>
      <div class="section-desc">Keep your conversation state active when closing the chat or switching between voice and text mode ("Start where I closed").</div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 12px;">
        <div>
          <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; margin-bottom: 12px;">
            <input type="checkbox" id="resumeOnOpenCheck" style="width: 16px; height: 16px;" />
            <div>
              <div style="font-weight: 500;">Resume Conversation on Open</div>
              <div style="font-size: 11px; color: var(--fg-muted);">When you reopen chat or voice mode, seamlessly pick up from the exact turn you closed.</div>
            </div>
          </label>

          <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; margin-bottom: 12px;">
            <input type="checkbox" id="persistHistoryCheck" style="width: 16px; height: 16px;" />
            <div>
              <div style="font-weight: 500;">Persist History to Disk & Workspace</div>
              <div style="font-size: 11px; color: var(--fg-muted);">Store chat logs, tool outputs, and voice transcripts across IDE restarts in .antigravity/sessions/.</div>
            </div>
          </label>

          <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
            <input type="checkbox" id="unifiedVoiceAndTextCheck" style="width: 16px; height: 16px;" />
            <div>
              <div style="font-weight: 500;">Unified Voice & Text Memory</div>
              <div style="font-size: 11px; color: var(--fg-muted);">Voice AI knows what you typed in chat, and Text chat knows what you spoke in voice mode.</div>
            </div>
          </label>
        </div>

        <div>
          <div class="form-group">
            <label class="form-label">Max Persisted Turns per Session</label>
            <input type="number" class="input-field" id="maxPersistedTurnsInput" value="50" min="5" max="200" />
            <div style="font-size: 10.5px; color: var(--fg-muted); margin-top: 4px;">Controls how many messages and tool outputs are remembered before pruning oldest turns.</div>
          </div>

          <div style="display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap;">
            <button class="btn btn-secondary" onclick="startNewSession()" style="font-size: 11px; padding: 6px 12px;">➕ Start New Session</button>
            <button class="btn btn-secondary" onclick="exportActiveSession()" style="font-size: 11px; padding: 6px 12px;">📄 Export Session (.md)</button>
            <button class="btn btn-secondary" onclick="clearAllSavedSessions()" style="font-size: 11px; padding: 6px 12px; color: #f87171;" title="Wipe all saved session files">🗑️ Clear All Sessions</button>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Workspace System Instructions Override</div>
      <div class="section-desc">Extra instructions appended to all AI agent system prompts in this workspace.</div>
      <textarea class="input-field" id="workspacePromptInput" placeholder="e.g. Always write strict TypeScript with JSDoc comments. Follow Next.js App Router conventions…"></textarea>
      <div style="text-align: right; margin-top: 10px;">
        <button class="btn btn-gradient" onclick="saveSessionSettings()">💾 Save Session & Guardrails</button>
      </div>
    </div>
  </div>

  <!-- ==================== TAB 6: CHAT & SERIAL ORCHESTRATION CONSOLE ==================== -->
  <div id="chatTab" class="tab-content" style="${isChat ? 'display: flex;' : 'display: none;'}">
    <div class="chat-console-wrapper">
      <!-- 1. Top Section: Mode Switcher, Active Model & Top-Right Serial Pipeline Graph -->
      <div class="chat-header-section">

        <!-- Always-visible compact bar -->
        <div class="chat-header-compact-bar">
          <div class="compact-left">
            <span class="compact-mode-pill" id="compactModePill">⚡ Autonomous Pipeline</span>
            <div class="compact-status">
              <span id="compactStatusPill" class="badge badge-Queued" style="padding: 1px 6px; font-size: 10px;">Idle</span>
              <span id="compactGoalSnippet" style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--fg-muted);">(No active task)</span>
            </div>
            <span id="compactModelName" style="font-size: 10.5px; color: var(--fg-muted);">9 Router: <strong style="color: #f8fafc;">ag/gemini-3.8-flash-high</strong></span>
          </div>
          <button id="chatHeaderToggleBtn" data-action="toggleChatHeader" title="Collapse header">
            <span class="hdr-chevron">&#9650;</span>
          </button>
        </div>

        <!-- Collapsible header body -->
        <div id="chatHeaderBody">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 14px; flex-wrap: wrap; padding-top: 6px;">
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
              <!-- Mode Switcher -->
              <div class="chat-mode-toggle" id="chatModeToggle">
                <button id="modePipelineBtn" class="chat-mode-btn active" data-action="setChatMode" data-param="pipeline" onclick="setChatMode('pipeline')" title="Autonomous AI Multi-Role Pipeline: orchestrates specialized roles 1-by-1 in serial">
                  <span>⚡</span> <span>Autonomous Pipeline</span>
                </button>
                <button id="modeDirectBtn" class="chat-mode-btn" data-action="setChatMode" data-param="direct" onclick="setChatMode('direct')" title="Direct 1-on-1 Text Mode: Chat with your chosen 9 Router model">
                  <span>💬</span> <span>Chat with Selected Model</span>
                  <span class="badge" style="background: rgba(56,189,248,0.2); color: #38bdf8; font-size: 9.5px; margin-left: 4px;">Text Mode</span>
                </button>
              </div>

              <!-- Active 9 Router Model Picker for Chat -->
              <div class="chat-model-selector-box" style="display: flex; align-items: center; gap: 6px; background: rgba(30,41,59,0.7); border: 1px solid var(--border); border-radius: 8px; padding: 4px 8px;">
                <span style="font-size: 11px; color: var(--fg-muted); font-weight: 500;">9 Router:</span>
                <select id="chatQuickModelDropdown" class="input-field" onchange="onChatQuickModelChange(this.value)" style="margin: 0; padding: 2px 6px; font-size: 11px; height: 26px; border-radius: 6px; background: rgba(15,23,42,0.85); color: #38bdf8; font-weight: 600; cursor: pointer; border: 1px solid rgba(56,189,248,0.3); max-width: 200px;" title="Select model from 9 Router to chat with directly">
                  <option value="ag/gemini-3.8-flash-high">ag/gemini-3.8-flash-high (Fast / Agentic)</option>
                  <option value="kr/qwen3-coder-next">kr/qwen3-coder-next (Code Specialist)</option>
                  <option value="ag/claude-opus-4-6-thinking">ag/claude-opus-4-6-thinking (Reasoning)</option>
                  <option value="forge api/deepseek-v4-flash">forge api/deepseek-v4-flash (Fast Dev)</option>
                  <option value="cc/claude-3-7-sonnet">cc/claude-3-7-sonnet (Frontend/UI)</option>
                  <option value="openai/gpt-4o">openai/gpt-4o (General High)</option>
                  <option value="__browse_all__">🔍 Browse all 2,150 9 Router models…</option>
                </select>
                <button class="btn btn-secondary" id="chatAllModelsBtn" data-action="openChatModelPicker" onclick="openChatModelPicker()" style="font-size: 11px; padding: 3px 8px;" title="Browse and search full 2,150 models from 9 Router">🔍 All Models</button>
              </div>

              <!-- Session Controls -->
              <div id="chatSessionControlBox" style="display: flex; align-items: center; gap: 6px; background: rgba(30,41,59,0.7); border: 1px solid var(--border); border-radius: 8px; padding: 3px 8px;" title="Session persistence: closing the chat allows you to start right where you left off">
                <span style="font-size: 11px;">📌</span>
                <span id="chatActiveSessionTitle" style="font-size: 11px; font-weight: 600; color: #93c5fd; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Active Session</span>
                <button class="btn btn-secondary" onclick="startNewSession()" style="font-size: 10.5px; padding: 2px 7px; height: 22px; line-height: 18px;" title="Start a fresh chat session without losing prior history">+ New</button>
                <select id="chatSessionSelector" onchange="onSwitchSession(this.value)" style="background: rgba(15,23,42,0.85); border: 1px solid rgba(56,189,248,0.25); color: #cbd5e1; font-size: 10.5px; border-radius: 6px; padding: 1px 4px; height: 22px; cursor: pointer; max-width: 120px;" title="Switch to another saved session">
                  <option value="">History ▾</option>
                </select>
              </div>

              <!-- Status pill -->
              <div id="chatWorkflowStatusContainer" style="display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--fg-muted);">
                <span id="chatWorkflowStatusPill" class="badge badge-Queued" style="padding: 2px 7px; font-size: 10px;">Idle</span>
                <span id="chatGoalSnippet" style="max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">(No active task)</span>
              </div>
            </div>

            <!-- Top-Right Serial Pipeline Graph -->
            <div id="chatGraphWrapper" style="display: flex; flex-direction: column; align-items: flex-end; flex: 1; min-width: 300px;">
              <div style="display: flex; justify-content: space-between; width: 100%; align-items: center; margin-bottom: 4px;">
                <span style="font-size: 10.5px; text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em; color: var(--fg-muted);">⚡ Serial Pipeline Graph (Autonomous 1-by-1)</span>
                <div style="display: flex; align-items: center; gap: 4px;">
                  <span id="graphStepCountText" style="font-size: 11px; color: var(--fg-muted);">0 / 0 steps</span>
                  <button id="graphCollapseBtn" data-action="togglePipelineGraph" title="Collapse / expand pipeline graph">
                    <span class="chevron">&#9660;</span>
                  </button>
                </div>
              </div>
              <div id="chatSerialGraphBody">
                <div class="serial-graph-flow" id="chatSerialGraph">
                  <span style="font-size: 11.5px; color: var(--fg-muted); font-style: italic;">Enter a task below to generate and launch the serial role pipeline…</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Dynamic Text Mode Banner (visible in Direct Mode) -->
          <div id="chatDirectModeBanner" style="display: none; padding: 8px 14px; background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 8px; margin-top: 10px; font-size: 12px; color: #cbd5e1; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 14px;">💬</span>
              <span><strong>Normal Text Mode:</strong> Chatting directly with <strong id="chatBannerModelName" style="color: #38bdf8;">ag/gemini-3.8-flash-high</strong> from 9 Router.</span>
            </div>
            <div style="display: gap: 6px; align-items: center;">
              <span class="badge" style="background: rgba(34,197,94,0.15); color: #4ade80; font-size: 10px;">1-on-1 Text</span>
              <span class="badge" style="background: rgba(56,189,248,0.15); color: #38bdf8; font-size: 10px;">Tools Active</span>
              <button class="btn btn-secondary" onclick="openChatModelPicker()" style="font-size: 10.5px; padding: 2px 7px;">Pick Different Model</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 2. Middle Section: Scrollable Chat Message Feed -->
      <div class="chat-messages-stream" id="chatFeed">
        <!-- Welcome empty card -->
        <div id="chatWelcomeCard" class="card" style="text-align: center; padding: 28px 20px; background: rgba(15,23,42,0.5); border: 1px dashed rgba(255,255,255,0.12);">
          <div style="font-size: 32px; margin-bottom: 8px;">🚀</div>
          <h3 id="chatWelcomeTitle" style="font-size: 15px; font-weight: 600; margin-bottom: 6px;">Autonomous AI Role Orchestrator & Chat</h3>
          <p id="chatWelcomeDesc" style="font-size: 12.5px; color: var(--fg-muted); max-width: 540px; margin: 0 auto 16px auto; line-height: 1.5;">
            In <strong>Autonomous Pipeline</strong> mode, enter a requirement to decompose and execute serial roles with real-time graph updates. Switch to <strong>Chat with Selected Model</strong> to converse directly with your chosen 9 Router model.
          </p>
          <div style="display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;">
            <button class="btn btn-secondary" style="font-size: 11.5px; padding: 5px 12px;" onclick="fillChatPrompt('Build authentication system with OAuth2 and JWT tokens')">🔐 Build Auth & JWT</button>
            <button class="btn btn-secondary" style="font-size: 11.5px; padding: 5px 12px;" onclick="fillChatPrompt('Create database schema and REST API endpoints')">🗄️ DB Schema & API</button>
            <button class="btn btn-secondary" style="font-size: 11.5px; padding: 5px 12px;" onclick="fillChatPrompt('Write comprehensive unit and integration tests')">🧪 Comprehensive Tests</button>
          </div>
        </div>
      </div>

      <!-- Drag Resizer between Chat Stream and Input Bar -->
      <div class="chat-resizer" id="chatInputResizer" title="Drag up/down to resize prompt box"></div>

      <!-- 3. Bottom Control Bar: Input, Dictation & Voice Mode -->
      <div class="chat-input-bar">
        <!-- Slim info strip -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; font-size: 10.5px; color: var(--fg-muted);">
          <div style="display: flex; align-items: center; gap: 5px;">
            <span id="inputBarModePill" class="badge" style="background: rgba(56,189,248,0.15); color: #38bdf8; font-size: 9.5px; padding: 1px 6px;">&#x26A1; Autonomous Pipeline</span>
            <span id="inputBarModelText" style="font-size: 10px;">Decomposing into serial specialized roles</span>
          </div>
          <div style="display: flex; align-items: center; gap: 4px;">
            <span style="font-size: 10px; opacity: 0.75;">Model: <strong id="inputBarModelName" style="color: #f8fafc;">ag/gemini-3.8-flash-high</strong></span>
            <a href="#" onclick="openChatModelPicker(); return false;" style="color: #38bdf8; text-decoration: none; font-size: 10px; font-weight: 500;">[Switch]</a>
          </div>
        </div>

        <!-- 100% full-width input box (spans full card width) -->
        <textarea
          class="input-field"
          id="chatMessageInput"
          rows="2"
          placeholder="Instruction or goal… [Enter to Send, Shift+Enter for newline]"
          style="margin: 0; width: 100%; box-sizing: border-box; resize: vertical; font-size: 12.5px; line-height: 1.45; padding: 8px 11px; border-radius: 8px; min-height: 44px; max-height: 350px; overflow-y: auto; display: block;"
          onkeydown="onChatInputKeyDown(event)"
        ></textarea>

        <!-- Action buttons row shifted below input box with buttons close together -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px; flex-wrap: wrap; gap: 6px;">
          <!-- Left tools & chips -->
          <div style="display: flex; gap: 5px; align-items: center; flex-wrap: wrap;">
            <!-- Dictate -->
            <button class="btn btn-secondary" id="dictateBtn" data-action="toggleDictation" onclick="toggleDictation()" style="height: 28px; padding: 0 9px; font-size: 11px; display: flex; align-items: center; gap: 4px; border-radius: 6px;" title="Dictate speech into the prompt box">
              <span>&#x1F3A4;</span> <span id="dictateBtnText" style="font-size: 10.5px;">Dictate</span>
            </button>

            <!-- Voice Mode -->
            <button class="btn btn-secondary" id="voiceModeBtn" data-action="toggleVoiceModeFromChat" onclick="toggleVoiceModeFromChat()" style="height: 28px; padding: 0 9px; font-size: 11px; display: flex; align-items: center; gap: 4px; border-radius: 6px;" title="Real-time bidirectional voice with Gemini Live">
              <span id="voiceModeBtnDot" class="dot-live" style="background: #94a3b8; box-shadow: none; width: 6px; height: 6px;"></span>
              <span id="voiceModeBtnText" style="font-size: 10.5px;">Voice</span>
            </button>

            <!-- Divider -->
            <div style="width: 1px; height: 18px; background: rgba(255,255,255,0.12); margin: 0 2px;"></div>

            <!-- Export -->
            <button class="btn btn-secondary" id="exportChatBtn" onclick="exportActiveSession()" style="height: 28px; padding: 0 8px; font-size: 11px; display: flex; align-items: center; gap: 3px; border-radius: 6px;" title="Export session transcript">
              &#x1F4C4;
            </button>

            <!-- Clear -->
            <button class="btn btn-secondary" id="clearChatBtn" data-action="clearChatMessages" onclick="clearChatMessages()" style="height: 28px; padding: 0 8px; font-size: 11px; display: flex; align-items: center; gap: 3px; border-radius: 6px; opacity: 0.7;" title="Clear conversation">
              &#x1F5D1;
            </button>

            <!-- Divider -->
            <div style="width: 1px; height: 18px; background: rgba(255,255,255,0.12); margin: 0 2px;"></div>

            <!-- Quick fill chips (close together) -->
            <span style="font-size: 10px; color: var(--fg-muted); margin-right: 2px;">Quick:</span>
            <button class="btn btn-secondary" style="height: 26px; font-size: 10.5px; padding: 0 8px; border-radius: 6px; white-space: nowrap;" onclick="fillChatPrompt('Explore codebase architecture and dependencies')" title="Quick fill: Architecture">&#x1F3D7; Architecture</button>
            <button class="btn btn-secondary" style="height: 26px; font-size: 10.5px; padding: 0 8px; border-radius: 6px; white-space: nowrap;" onclick="fillChatPrompt('Implement full authentication with login, registration, and JWT')" title="Quick fill: Full Auth">&#x1F510; Full Auth</button>
            <button class="btn btn-secondary" style="height: 26px; font-size: 10.5px; padding: 0 8px; border-radius: 6px; white-space: nowrap;" onclick="fillChatPrompt('Run test suite and fix failing test cases')" title="Quick fill: Test &amp; Fix">&#x1F6E1; Test &amp; Fix</button>
          </div>

          <!-- Right: Send button -->
          <button class="btn btn-gradient" id="sendChatBtn" data-action="submitChatMessage" onclick="submitChatMessage()" style="height: 28px; padding: 0 14px; font-size: 11.5px; font-weight: 600; display: flex; align-items: center; gap: 4px; border-radius: 6px;" title="Send message (Enter)">
            <span>&#x1F680;</span> Send
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- STEP INSPECTOR MODAL -->
  <div class="modal" id="stepModal">
    <div class="modal-content">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <h3 id="modalStepTitle">Step Details</h3>
        <button class="btn btn-secondary" onclick="closeModal()">✕</button>
      </div>
      <div class="form-group">
        <div class="form-label">Role Definition</div>
        <div id="modalStepRole" style="font-size: 14px; font-weight: 600;"></div>
      </div>
      <div class="form-group">
        <div class="form-label">Task Name</div>
        <div id="modalStepTask"></div>
      </div>
      <div class="form-group">
        <div class="form-label">Task Prompt</div>
        <div class="input-field" id="modalStepPrompt" style="white-space: pre-wrap; font-family: monospace;"></div>
      </div>
      <div class="form-group">
        <div class="form-label">Assigned Model</div>
        <div id="modalStepModel" style="font-family: monospace;"></div>
      </div>
      <div style="text-align: right; margin-top: 14px;">
        <button class="btn btn-secondary" onclick="closeModal()">Close</button>
      </div>
    </div>
  </div>

  <!-- MODEL PICKER MODAL -->
  <div class="modal" id="modelPickerModal">
    <div class="modal-content">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <div>
          <h3 id="modelPickerTitle" style="margin: 0 0 2px 0;">Select Model from 9 Router</h3>
          <div id="modelPickerSubtitle" style="font-size: 11px; color: var(--fg-muted);">Complete 9 Router Gateway Catalog</div>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <button class="btn btn-secondary" id="refreshRouterModelsBtn" onclick="refreshRouterModels()">⟳ Sync 9 Router</button>
          <button class="btn btn-secondary" onclick="closeModelPicker()">✕</button>
        </div>
      </div>
      <input type="text" id="modelSearchInput" class="input-field" placeholder="Fuzzy search across all 9 Router models (e.g. ag/, claude, sonnet, gemini-3.8, reasoning, gpt-4o, openrouter)…" oninput="onModelSearchInput()" />
      <div id="modelSearchStatus" style="font-size: 11px; color: var(--fg-muted); margin-bottom: 6px; display: flex; justify-content: space-between;">
        <span id="modelCountStatus">Loading 9 Router models…</span>
        <span id="modelRouterStatus">● 9 Router Connected</span>
      </div>
      <div class="model-list" id="modelList"></div>
      <div style="margin-top: 14px; text-align: right;">
        <button class="btn btn-secondary" onclick="closeModelPicker()">Cancel</button>
      </div>
    </div>
  </div>

  <!-- NEW TASK MODAL -->
  <div class="modal" id="newTaskModal">
    <div class="modal-content" style="max-width: 580px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <h3 style="margin: 0; font-size: 15px; font-weight: 600; color: #f8fafc;">🚀 Start New Serial Orchestrated Task</h3>
        <button class="btn btn-secondary" onclick="closeNewTaskModal()">✕</button>
      </div>
      <div style="font-size: 12px; color: var(--fg-muted); margin-bottom: 12px;">
        Enter your requirement or objective below. Main Voice AI will decompose it into a serial pipeline of specialized engineering roles.
      </div>
      <textarea id="newTaskGoalInput" class="input-field" rows="4" placeholder="e.g. Build authentication for this app with JWT tokens, or Create a responsive dashboard, or Run test suite and fix errors…" style="width: 100%; box-sizing: border-box; resize: vertical; margin-bottom: 14px; font-size: 13px;"></textarea>
      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <button class="btn btn-secondary" onclick="closeNewTaskModal()">Cancel</button>
        <button class="btn btn-gradient" onclick="submitInlineNewTask()">⚡ Launch Serial Workflow</button>
      </div>
    </div>
  </div>
  <script nonce="${nonce}">
let vscode;
    try {
      vscode = acquireVsCodeApi();
    } catch (e) {
      vscode = window._vscodeApi || { postMessage: function() {} };
    }
    window._vscodeApi = vscode;

    let currentWorkflow = null;
    let currentRoles = [];
    let currentSelectedModel = '${selectedModel}';
    let currentSessionOpts = null;
    let currentVoiceOpts = null;
    let currentApiKeys = [];
    let isVoiceCurrentlyActive = false;
    let isVoiceCurrentlyTalking = false;
    let isVoiceCurrentlyMuted = false;
    let currentPickerContext = null;
    let hubFilterText = '';
    let hubSearchQuery = '';
    let currentChatMode = 'pipeline';
    let chatMessagesList = [];
    let speechRecognizer = null;
    let isDictating = false;
    let hasSwitchedInitialTab = false;
    let isPipelineGraphCollapsed = false;
    let isChatHeaderCollapsed = false;

    function togglePipelineGraph() {
      isPipelineGraphCollapsed = !isPipelineGraphCollapsed;
      const body = document.getElementById('chatSerialGraphBody');
      const btn  = document.getElementById('graphCollapseBtn');
      if (body) body.classList.toggle('graph-collapsed', isPipelineGraphCollapsed);
      if (btn)  btn.classList.toggle('collapsed', isPipelineGraphCollapsed);
      if (btn)  btn.title = isPipelineGraphCollapsed ? 'Expand pipeline graph' : 'Collapse pipeline graph';
    }

    function toggleChatHeader() {
      isChatHeaderCollapsed = !isChatHeaderCollapsed;
      const body = document.getElementById('chatHeaderBody');
      const btn  = document.getElementById('chatHeaderToggleBtn');
      if (body) body.classList.toggle('hdr-collapsed', isChatHeaderCollapsed);
      if (btn)  btn.classList.toggle('hdr-collapsed', isChatHeaderCollapsed);
      if (btn)  btn.title = isChatHeaderCollapsed ? 'Expand header' : 'Collapse header';
    }

    /** Keep compact bar in sync with current mode / status / model */
    function syncCompactBar(mode, statusText, goalText, modelName) {
      const pill = document.getElementById('compactModePill');
      const statusPill = document.getElementById('compactStatusPill');
      const goalSnip = document.getElementById('compactGoalSnippet');
      const mdName = document.getElementById('compactModelName');
      if (pill) {
        if (mode === 'direct') {
          pill.textContent = '\uD83D\uDCAC Chat with Model';
          pill.style.color = '#4ade80';
          pill.style.background = 'rgba(74,222,128,0.1)';
          pill.style.borderColor = 'rgba(74,222,128,0.25)';
        } else {
          pill.textContent = '\u26A1 Autonomous Pipeline';
          pill.style.color = '#38bdf8';
          pill.style.background = 'rgba(56,189,248,0.1)';
          pill.style.borderColor = 'rgba(56,189,248,0.25)';
        }
      }
      if (statusPill && statusText) {
        statusPill.textContent = statusText;
        statusPill.className = 'badge badge-' + statusText;
      }
      if (goalSnip && goalText !== undefined) goalSnip.textContent = goalText;
      if (mdName && modelName) mdName.innerHTML = '9 Router: <strong style="color:#f8fafc;">' + modelName + '</strong>';
    }

    window.onerror = function(msg, url, line, col, error) {
      console.error('[Webview Error]', msg, line, col, error);
      try {
        vscode.postMessage({ command: 'clientError', error: String(msg) + ' (' + line + ':' + col + ')' });
      } catch (e) {}
    };
    window.addEventListener('unhandledrejection', function(event) {
      console.error('[Webview Unhandled Rejection]', event.reason);
    });

    function applyState(msg) {
      if (!msg) return;
      if (msg.workflow !== undefined) currentWorkflow = msg.workflow;
      if (msg.roles) currentRoles = msg.roles;
      if (msg.selectedModel) currentSelectedModel = msg.selectedModel;
      if (msg.sessionOpts) currentSessionOpts = msg.sessionOpts;
      if (msg.voiceOpts) currentVoiceOpts = msg.voiceOpts;
      if (msg.apiKeys) currentApiKeys = msg.apiKeys;
      if (msg.voiceActive !== undefined) isVoiceCurrentlyActive = !!msg.voiceActive;
      if (msg.voiceTalking !== undefined) isVoiceCurrentlyTalking = !!msg.voiceTalking;
      if (msg.voiceMuted !== undefined) isVoiceCurrentlyMuted = !!msg.voiceMuted;

      if (msg.activeSession) {
        currentActiveSession = msg.activeSession;
        const titleEl = document.getElementById('chatActiveSessionTitle');
        if (titleEl) titleEl.innerText = msg.activeSession.title || 'Active Session';
      }
      if (msg.sessionList) {
        populateSessionSelector(msg.sessionList, msg.activeSession ? msg.activeSession.id : undefined);
      }

      updateHeaderStatus();
      renderWorkflow();
      renderRoles();
      renderVoiceTab(msg.liveModels);
      renderSessionTab();
      renderChatTab(msg.workspacePath, msg.activeDoc);
      renderChatSerialGraph(currentWorkflow);

      if (msg.chatMessages && msg.chatMessages.length > 0 && chatMessagesList.length === 0) {
        msg.chatMessages.forEach((m) => appendLiveChatMessage(m));
      }

      if (msg.catalogSize) {
        const cEl = document.getElementById('tabModelsCount');
        if (cEl) cEl.innerText = msg.catalogSize.toLocaleString();
        const mStatus = document.getElementById('modelCountStatus');
        if (mStatus && mStatus.innerText && mStatus.innerText.includes('Loading')) {
          mStatus.innerText = 'Showing all ' + (msg.catalogSize).toLocaleString() + ' models from 9 Router';
        }
      }

      if (msg.topModels) {
        populateChatQuickModelDropdown(msg.topModels);
      }

      if (msg.initialTab === 'chat' && !hasSwitchedInitialTab) {
        hasSwitchedInitialTab = true;
        openChatWithSelectedModel();
      }
    }

    function populateSessionSelector(sessions, activeId) {
      const sel = document.getElementById('chatSessionSelector');
      if (!sel) return;
      sel.innerHTML = '<option value="">History ▾</option>' +
        sessions.map(function(s) {
          const isAct = s.id === activeId ? ' (Active)' : '';
          const preview = s.title.length > 22 ? s.title.slice(0, 22) + '…' : s.title;
          return '<option value="' + escapeHtml(s.id) + '"' + (s.id === activeId ? ' selected' : '') + '>' +
            escapeHtml(preview + isAct) +
          '</option>';
        }).join('');
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'updateState') {
        applyState(msg);
      } else if (msg.type === 'chatMessage') {
        appendLiveChatMessage(msg.message);
      } else if (msg.type === 'chatDelta') {
        appendLiveChatDelta(msg.id, msg.text);
      } else if (msg.type === 'chatLog') {
        appendLiveChatLog(msg.logLine, msg.roleName);
      } else if (msg.type === 'chatWorkflowUpdated') {
        currentWorkflow = msg.workflow;
        renderChatSerialGraph(currentWorkflow);
        syncRoleCardsWithWorkflow(currentWorkflow);
        renderWorkflow();
      } else if (msg.type === 'chatStepProgress') {
        updateStepProgressInChat(msg.stepId, msg.state, msg.pct, msg.note);
      } else if (msg.type === 'chatCleared') {
        clearChatUI();
      } else if (msg.type === 'chatReloaded') {
        chatMessagesList = [];
        const feed = document.getElementById('chatFeed');
        if (feed) feed.innerHTML = '';
        if (msg.chatMessages && msg.chatMessages.length > 0) {
          msg.chatMessages.forEach((m) => appendLiveChatMessage(m));
        } else {
          clearChatUI();
        }
      } else if (msg.type === 'switchTab') {
        switchTab(msg.tab);
      } else if (msg.type === 'audioSaved') {
        const feed = document.getElementById('chatFeed');
        if (feed) {
          const pill = document.createElement('div');
          pill.className = 'chat-bubble-row ai-row';
          pill.innerHTML =
            '<div style="background: rgba(16,185,129,0.12); border: 1px solid rgba(16,185,129,0.3); border-radius: 8px; padding: 6px 12px; font-size: 11.5px; display: inline-flex; align-items: center; gap: 8px; margin: 4px 0;">' +
              '<span>🎵 Saved Audio: <strong>' + escapeHtml(msg.fileName) + '</strong> (' + escapeHtml(msg.format.toUpperCase()) + ')</span>' +
              '<button class="btn btn-secondary" style="padding: 2px 7px; font-size: 10px;" onclick="copyLatestAudioPath()">📋 Copy Path</button>' +
              '<button class="btn btn-secondary" style="padding: 2px 7px; font-size: 10px;" onclick="openRecordingsFolder()">📂 Open Folder</button>' +
            '</div>';
          feed.appendChild(pill);
          feed.scrollTop = feed.scrollHeight;
        }
      } else if (msg.type === 'voiceTurn') {
        handleVoiceTurnInChat(msg.text, msg.turnComplete, msg.from);
      } else if (msg.type === 'openChatWithSelectedModel') {
        openChatWithSelectedModel();
      } else if (msg.type === 'fuzzySearchResults') {
        if (currentPickerContext?.isHub) {
          renderHubResults(msg);
        } else {
          renderFuzzyResults(msg);
        }
      }
    });

    function requestRefresh() {
      vscode.postMessage({ command: 'refresh' });
    }

    function startTaskPrompt() {
      const modal = document.getElementById('newTaskModal');
      if (modal) {
        modal.classList.add('show');
        const input = document.getElementById('newTaskGoalInput');
        if (input) {
          input.value = '';
          input.focus();
        }
      } else {
        vscode.postMessage({ command: 'startNewTask' });
      }
    }

    function closeNewTaskModal() {
      const modal = document.getElementById('newTaskModal');
      if (modal) modal.classList.remove('show');
    }

    function submitInlineNewTask() {
      const input = document.getElementById('newTaskGoalInput');
      if (!input) return;
      const text = input.value.trim();
      if (!text) return;
      closeNewTaskModal();
      vscode.postMessage({
        command: 'chatSubmit',
        text: text,
        mode: 'pipeline',
        selectedModel: currentSelectedModel
      });
      switchTab('workflow');
    }

    function switchTab(tab) {
      const tabs = ['workflow', 'roles', 'models', 'voice', 'session', 'chat'];
      tabs.forEach(t => {
        const el = document.getElementById(t + 'Tab');
        const btn = document.getElementById('tab' + capitalize(t) + 'Btn');
        if (el) el.style.display = t === tab ? (t === 'chat' ? 'flex' : 'block') : 'none';
        if (btn) btn.classList.toggle('active', t === tab);
      });
      if (tab === 'chat') {
        document.body.classList.add('chat-active');
      } else {
        document.body.classList.remove('chat-active');
      }
      const headerChat = document.getElementById('headerChatBtn');
      if (headerChat) {
        headerChat.style.boxShadow = tab === 'chat' ? '0 0 14px rgba(56,189,248,0.6)' : '0 2px 10px rgba(14,165,233,0.35)';
      }
      if (tab === 'models') {
        onHubSearch();
      } else if (tab === 'chat') {
        setTimeout(() => {
          const input = document.getElementById('chatMessageInput');
          if (input) {
            input.focus();
            const feed = document.getElementById('chatFeed'); if (feed) feed.scrollTop = feed.scrollHeight;
          }
        }, 50);
      }
    }

    function openChatInterface(mode) {
      switchTab('chat');
      setChatMode(mode || 'pipeline');
      setTimeout(() => {
        const input = document.getElementById('chatMessageInput');
        if (input) {
          input.focus();
          const feed = document.getElementById('chatFeed'); if (feed) feed.scrollTop = feed.scrollHeight;
        }
      }, 50);
    }

    function openChatWithSelectedModel() {
      openChatInterface('direct');
    }

    function onChatQuickModelChange(val) {
      if (val === '__browse_all__') {
        openChatModelPicker();
        return;
      }
      selectModel(val);
    }

    function populateChatQuickModelDropdown(topModels) {
      const qSelect = document.getElementById('chatQuickModelDropdown');
      if (!qSelect) return;
      const models = Array.isArray(topModels) && topModels.length > 0
        ? topModels
        : ['ag/gemini-3.8-flash-high', 'kr/qwen3-coder-next', 'ag/claude-opus-4-6-thinking', 'forge api/deepseek-v4-flash', 'cc/claude-3-7-sonnet', 'openai/gpt-4o'];

      const allList = [];
      if (currentSelectedModel && !models.includes(currentSelectedModel)) {
        allList.push(currentSelectedModel);
      }
      models.forEach(function(m) {
        if (!allList.includes(m)) allList.push(m);
      });

      let html = allList.map(function(m) {
        const isSel = m === currentSelectedModel ? ' selected' : '';
        return '<option value="' + escapeHtml(m) + '"' + isSel + '>' + escapeHtml(m) + '</option>';
      }).join('');
      html += '<option value="__browse_all__">🔍 Browse all 2,150 9 Router models…</option>';
      qSelect.innerHTML = html;
    }

    function capitalize(s) {
      return s.charAt(0).toUpperCase() + s.slice(1);
    }

    function updateHeaderStatus() {
      const mText = document.getElementById('headerModelText');
      if (mText) mText.innerText = 'Model: ' + currentSelectedModel;

      const chatActiveBadge = document.getElementById('chatActiveModelBadge');
      if (chatActiveBadge) chatActiveBadge.innerText = currentSelectedModel;

      const bannerModel = document.getElementById('chatBannerModelName');
      if (bannerModel) bannerModel.innerText = currentSelectedModel;

      const barModel = document.getElementById('inputBarModelName');
      if (barModel) barModel.innerText = currentSelectedModel;

      const qSelect = document.getElementById('chatQuickModelDropdown');
      if (qSelect) {
        let matched = false;
        for (let i = 0; i < qSelect.options.length; i++) {
          if (qSelect.options[i].value === currentSelectedModel) {
            qSelect.selectedIndex = i;
            matched = true;
            break;
          }
        }
        if (!matched && currentSelectedModel) {
          const opt = document.createElement('option');
          opt.value = currentSelectedModel;
          opt.innerText = currentSelectedModel;
          qSelect.insertBefore(opt, qSelect.firstChild);
          qSelect.selectedIndex = 0;
        }
      }

      const vDot = document.getElementById('headerVoiceDot');
      const vText = document.getElementById('headerVoiceText');
      if (vDot && vText) {
        if (isVoiceCurrentlyActive) {
          vDot.className = 'dot-voice-on';
          vText.innerText = isVoiceCurrentlyMuted ? 'Voice: Muted' : 'Voice: Live';
        } else {
          vDot.className = 'dot-live';
          vDot.style.background = '#94a3b8';
          vDot.style.boxShadow = 'none';
          vText.innerText = 'Voice: Ready';
        }
      }

      const chatVoiceDot = document.getElementById('voiceModeBtnDot');
      const chatVoiceText = document.getElementById('voiceModeBtnText');
      if (chatVoiceDot && chatVoiceText) {
        if (isVoiceCurrentlyActive) {
          chatVoiceDot.className = 'dot-voice-on';
          chatVoiceText.innerText = isVoiceCurrentlyMuted ? 'Voice: Muted' : 'Voice: Live';
        } else {
          chatVoiceDot.className = 'dot-live';
          chatVoiceDot.style.background = '#94a3b8';
          chatVoiceDot.style.boxShadow = 'none';
          chatVoiceText.innerText = 'Voice Mode: Ready';
        }
      }

      const qaSelDesc = document.getElementById('qaSelectedModelDesc');
      if (qaSelDesc) qaSelDesc.innerText = 'Text mode: Chat directly with ' + currentSelectedModel;

      const qaLiveDesc = document.getElementById('qaLiveModelDesc');
      if (qaLiveDesc && currentVoiceOpts?.liveModel) qaLiveDesc.innerText = currentVoiceOpts.liveModel;

      const qaApiDesc = document.getElementById('qaApiKeysDesc');
      if (qaApiDesc) qaApiDesc.innerText = currentApiKeys.length ? (currentApiKeys.length + ' key(s) configured · fallback active') : 'None configured — click to add';

      const qaVTitle = document.getElementById('qaVoiceTitle');
      if (qaVTitle) qaVTitle.innerText = isVoiceCurrentlyActive ? 'Voice mode (Active)' : 'Voice mode';
    }

    function focusLiveModelSelect() {
      switchTab('voice');
      setTimeout(() => {
        const el = document.getElementById('liveModelSelect');
        if (el) {
          el.focus();
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 50);
    }

    function focusApiKeysSection() {
      switchTab('voice');
      setTimeout(() => {
        const el = document.getElementById('newApiKeyInput');
        if (el) {
          el.focus();
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 50);
    }

    function toggleQuickHub() {
      const grid = document.getElementById('qaGrid');
      const btn = document.getElementById('qaToggleBtn');
      if (!grid || !btn) return;
      const isHidden = grid.style.display === 'none' || window.getComputedStyle(grid).display === 'none';
      if (isHidden) {
        grid.style.display = 'grid';
        btn.innerText = 'Hide Hub';
        document.body.classList.add('hub-open');
      } else {
        grid.style.display = 'none';
        btn.innerText = 'Show Hub';
        document.body.classList.remove('hub-open');
      }
    }

    /* ---------------- TAB 1: WORKFLOW ---------------- */
    function renderWorkflow() {
      const container = document.getElementById('pipelineContainer');
      const goalEl = document.getElementById('goalText');
      const statusBadge = document.getElementById('mainStatusBadge');
      const progressText = document.getElementById('stepProgressText');
      const controlsEl = document.getElementById('workflowControls');
      const verEl = document.getElementById('verificationBanner');

      if (!currentWorkflow) {
        goalEl.innerText = '(No active workflow)';
        statusBadge.className = 'badge badge-Queued';
        statusBadge.innerText = 'Idle';
        progressText.innerText = 'Start an autonomous serial task, or chat directly with ' + currentSelectedModel + ' in normal text mode.';
        controlsEl.innerHTML = '<button class="btn btn-primary" onclick="openChatWithSelectedModel()" style="background: linear-gradient(135deg, #0284c7, #38bdf8); color: white; font-weight: 600; padding: 6px 14px;">💬 Chat with ' + escapeHtml(currentSelectedModel) + '</button>' +
          '<button class="btn btn-gradient" onclick="startTaskPrompt()">+ Start New Task</button>';
        verEl.style.display = 'none';
        container.innerHTML = '<div style="text-align: center; color: #64748b; padding: 36px 0;">' +
          '<div style="font-size: 28px; margin-bottom: 8px;">💬 ⚡</div>' +
          '<h3 style="font-size: 14px; font-weight: 600; color: #cbd5e1; margin-bottom: 6px;">No Active Serial Pipeline</h3>' +
          '<p style="font-size: 12px; color: var(--fg-muted); margin-bottom: 14px;">You can chat directly with your selected 9 Router model or launch an autonomous serial workflow.</p>' +
          '<button class="btn btn-primary" onclick="openChatWithSelectedModel()" style="font-size: 12.5px; padding: 7px 16px; margin-right: 8px; background: linear-gradient(135deg, #0284c7, #38bdf8); color: white; font-weight: 600;">💬 Chat with ' + escapeHtml(currentSelectedModel) + ' (Text Mode)</button>' +
          '<button class="btn btn-secondary" onclick="startTaskPrompt()" style="font-size: 12.5px; padding: 7px 16px;">🚀 Launch Serial Workflow</button>' +
        '</div>';
        return;
      }

      goalEl.innerText = currentWorkflow.userGoal || 'Untitled Goal';
      statusBadge.className = 'badge badge-' + currentWorkflow.status;
      statusBadge.innerText = currentWorkflow.status;

      const totalSteps = currentWorkflow.steps.length;
      const completedSteps = currentWorkflow.steps.filter(s => s.status === 'Completed').length;
      progressText.innerText = 'Step ' + (currentWorkflow.activeStepIndex + 1) + ' of ' + totalSteps + ' (' + completedSteps + ' completed)';

      let ctrlHtml = '';
      if (currentWorkflow.status === 'Running') {
        ctrlHtml += '<button class="btn btn-secondary" onclick="pauseWorkflow()">⏸ Pause</button>';
        ctrlHtml += '<button class="btn btn-danger" onclick="cancelWorkflow()">✕ Cancel</button>';
      } else if (currentWorkflow.status === 'Paused') {
        ctrlHtml += '<button class="btn btn-success" onclick="resumeWorkflow()">▶ Resume</button>';
        ctrlHtml += '<button class="btn btn-danger" onclick="cancelWorkflow()">✕ Cancel</button>';
      }
      controlsEl.innerHTML = ctrlHtml;

      if (currentWorkflow.verification) {
        verEl.style.display = 'block';
        document.getElementById('verificationSummaryText').innerText = currentWorkflow.verification.summary;
      } else {
        verEl.style.display = 'none';
      }

      container.innerHTML = currentWorkflow.steps.map(function(step, idx) {
        const isActive = idx === currentWorkflow.activeStepIndex && currentWorkflow.status === 'Running';
        return '<div class="step-card ' + (isActive ? 'active-step' : '') + '">' +
          '<div class="step-header">' +
            '<div style="display: flex; align-items: center; gap: 8px;">' +
              '<span style="font-weight: 700; color: #60a5fa;">#' + (idx + 1) + '</span>' +
              '<span class="step-title">' + escapeHtml(step.roleName) + '</span>' +
              '<span style="font-size: 11px; color: var(--fg-muted);">(' + escapeHtml(step.taskName) + ')</span>' +
            '</div>' +
            '<div>' +
              '<span class="badge badge-' + step.status + '">' + step.status + '</span>' +
            '</div>' +
          '</div>' +
          '<div style="font-size: 12px; color: #cbd5e1; margin-bottom: 8px;">' + escapeHtml(step.taskPrompt) + '</div>' +
          '<div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--fg-muted);">' +
            '<div>Model: <code style="color: #93c5fd;">' + escapeHtml(step.assignedModel) + '</code></div>' +
            "<button class=\\"btn btn-secondary\\" style=\\"padding: 2px 8px; font-size: 11px;\\" onclick=\\"openStepModal('" + step.id + "')\\">Inspect Prompt</button>" +
          '</div>' +
        '</div>';
      }).join('');
    }

    function pauseWorkflow() { vscode.postMessage({ command: 'pauseWorkflow' }); }
    function resumeWorkflow() { vscode.postMessage({ command: 'resumeWorkflow' }); }
    function cancelWorkflow() { vscode.postMessage({ command: 'cancelWorkflow' }); }

    function openStepModal(stepId) {
      if (!stepId) return;
      var cleanId = String(stepId);
      if (cleanId.indexOf('role_step_') === 0) {
        cleanId = cleanId.substring('role_step_'.length);
      }

      var step = null;
      if (currentWorkflow && currentWorkflow.steps) {
        step = currentWorkflow.steps.find(function(s) {
          return s.id === cleanId || s.id === stepId || ('role_step_' + s.id) === stepId;
        });
      }

      var modalTitle = 'Step Details';
      var modalRole = '';
      var modalTask = '';
      var modalPrompt = '';
      var modalModel = '';

      if (step) {
        modalTitle = 'Step: ' + (step.taskName || step.roleName);
        modalRole = (step.roleName || '') + (step.roleId ? ' (' + step.roleId + ')' : '');
        modalTask = step.taskName || '';
        modalPrompt = step.taskPrompt || step.taskName || '(No prompt specified)';
        modalModel = step.assignedModel || '';
      } else if (chatMessagesList && chatMessagesList.length > 0) {
        var msg = chatMessagesList.find(function(m) {
          return m.id === stepId || m.id === ('role_step_' + cleanId) || m.stepId === cleanId || m.stepId === stepId;
        });
        if (msg) {
          modalTitle = 'Role: ' + (msg.roleName || 'Specialized Role');
          modalRole = (msg.roleName || '') + (msg.roleModel ? ' [' + msg.roleModel + ']' : '');
          modalTask = msg.taskName || msg.content || '';
          modalPrompt = msg.taskPrompt || msg.content || '(Task prompt executed)';
          modalModel = msg.roleModel || '';
        }
      }

      if (!modalRole && !modalPrompt && !modalTask) {
        console.warn('openStepModal: step not found for', stepId);
        return;
      }

      var elTitle = document.getElementById('modalStepTitle');
      var elRole = document.getElementById('modalStepRole');
      var elTask = document.getElementById('modalStepTask');
      var elPrompt = document.getElementById('modalStepPrompt');
      var elModel = document.getElementById('modalStepModel');
      var modal = document.getElementById('stepModal');

      if (elTitle) elTitle.innerText = modalTitle;
      if (elRole) elRole.innerText = modalRole;
      if (elTask) elTask.innerText = modalTask;
      if (elPrompt) elPrompt.innerText = modalPrompt;
      if (elModel) elModel.innerText = modalModel;
      if (modal) modal.classList.add('show');
    }

    function closeModal() {
      document.getElementById('stepModal').classList.remove('show');
    }

    /* ---------------- TAB 2: ROLES ---------------- */
    function renderRoles() {
      const grid = document.getElementById('rolesGrid');
      grid.innerHTML = currentRoles.map(function(role) {
        return '<div class="role-card" id="role_card_' + role.id + '">' +
          '<div>' +
            '<div class="role-card-header">' +
              '<div style="font-size: 15px; font-weight: 600;">' + escapeHtml(role.name) + '</div>' +
              '<label style="display: flex; align-items: center; gap: 4px; font-size: 11px; cursor: pointer;">' +
                "<input type=\\"checkbox\\" " + (role.enabled ? "checked" : "") + " onchange=\\"toggleRoleEnabled('" + role.id + "', this.checked)\\" /> Enabled" +
              '</label>' +
            '</div>' +
            '<div style="font-size: 11.5px; color: var(--fg-muted); margin-bottom: 12px;">' + escapeHtml(role.purpose || role.description) + '</div>' +

            '<div class="form-group">' +
              '<label class="form-label">Primary Model (9 Router)</label>' +
              '<div style="display: flex; gap: 6px;">' +
                '<input type="text" class="input-field" value="' + escapeHtml(role.primaryModel) + '" id="primary_' + role.id + '" style="margin: 0;" />' +
                "<button class=\\"btn btn-secondary\\" onclick=\\"openModelPicker('" + role.id + "', 'primary')\\">Fuzzy Search</button>" +
              '</div>' +
            '</div>' +

            '<div class="form-group">' +
              '<label class="form-label">Fallback Models Chain</label>' +
              '<div style="display: flex; gap: 6px;">' +
                '<input type="text" class="input-field" value="' + escapeHtml((role.fallbackModels || []).join(', ')) + '" id="fallbacks_' + role.id + '" placeholder="Comma-separated models" style="margin: 0;" />' +
                "<button class=\\"btn btn-secondary\\" onclick=\\"openModelPicker('" + role.id + "', 'fallback')\\">+ Add</button>" +
              '</div>' +
            '</div>' +

            '<div class="form-group">' +
              '<label class="form-label">Role System Persona</label>' +
              '<textarea class="input-field" id="prompt_' + role.id + '" style="min-height: 65px;">' + escapeHtml(role.systemPrompt) + '</textarea>' +
            '</div>' +
          '</div>' +

          '<div style="text-align: right; margin-top: 10px;">' +
            "<button class=\\"btn\\" onclick=\\"saveRoleCard('" + role.id + "')\\">Save Role Changes</button>" +
          '</div>' +
        '</div>';
      }).join('');
    }

    function saveRoleCard(roleId) {
      const role = currentRoles.find(r => r.id === roleId);
      if (!role) return;
      role.primaryModel = document.getElementById('primary_' + roleId).value.trim();
      const fbStr = document.getElementById('fallbacks_' + roleId).value;
      role.fallbackModels = fbStr.split(',').map(s => s.trim()).filter(Boolean);
      role.systemPrompt = document.getElementById('prompt_' + roleId).value.trim();
      vscode.postMessage({ command: 'saveRole', role });
    }

    function toggleRoleEnabled(roleId, enabled) {
      const role = currentRoles.find(r => r.id === roleId);
      if (!role) return;
      role.enabled = enabled;
      vscode.postMessage({ command: 'saveRole', role });
    }

    function autoAssignRoles() {
      vscode.postMessage({ command: 'autoAssignRoles', strategy: 'quality' });
    }

    function openRolesJson() {
      vscode.postMessage({ command: 'openRolesJson' });
    }

    function filterRoles() {
      const term = document.getElementById('roleFilterInput').value.toLowerCase();
      currentRoles.forEach(role => {
        const card = document.getElementById('role_card_' + role.id);
        if (!card) return;
        const match = role.name.toLowerCase().includes(term) || role.id.toLowerCase().includes(term) || role.primaryModel.toLowerCase().includes(term);
        card.style.display = match ? 'flex' : 'none';
      });
    }

    /* ---------------- TAB 3: MODELS HUB ---------------- */
    function syncModelsHub() {
      const btn = document.getElementById('syncHubBtn');
      if (btn) btn.innerText = '⟳ Syncing Gateway…';
      currentPickerContext = { isHub: true };
      vscode.postMessage({
        command: 'refreshRouterModels',
        query: hubFilterText || hubSearchQuery
      });
    }

    function setHubFilter(filter, el) {
      hubFilterText = filter;
      const chips = document.querySelectorAll('#hubFilterChips .chip');
      chips.forEach(c => c.classList.remove('active'));
      const targetEl = el || (typeof event !== 'undefined' ? event.target : null);
      if (targetEl && targetEl.classList) targetEl.classList.add('active');
      onHubSearch();
    }

    function onHubSearch() {
      const qInput = document.getElementById('hubSearchInput');
      hubSearchQuery = qInput ? qInput.value : '';
      const combined = (hubFilterText + ' ' + hubSearchQuery).trim();
      currentPickerContext = { isHub: true };
      vscode.postMessage({
        command: 'fuzzySearchModels',
        query: combined
      });
    }

    function renderHubResults(msg) {
      const models = msg.models || [];
      const list = document.getElementById('hubModelList');
      const countEl = document.getElementById('hubCountStatus');
      if (countEl) countEl.innerText = 'Showing ' + models.length + ' of ' + (msg.catalogSize || 2150) + ' models from 9 Router';
      const btn = document.getElementById('syncHubBtn');
      if (btn) btn.innerText = '⟳ Sync 9 Router Gateway';

      if (!models || !models.length) {
        list.innerHTML = '<div style="padding: 24px; text-align: center; color: #64748b;">No matching 9 Router models found.</div>';
        return;
      }

      list.innerHTML = models.map(function(m) {
        const isActive = m.id === currentSelectedModel;
        const caps = [];
        if (m.caps && m.caps.tools) caps.push('tools');
        if (m.caps && m.caps.reasoning) caps.push('reasoning');
        if (m.caps && m.caps.vision) caps.push('vision');
        if (m.caps && (m.caps.audioInput || m.caps.audioOutput)) caps.push('audio');
        if (m.source === 'router' || m.id.includes('/')) caps.push('9router');
        const capsHtml = caps.map(function(c) {
          return '<span class="model-cap-tag ' + (c === '9router' ? 'tag-router' : '') + '">' + c + '</span>';
        }).join('');

        const actionBtn = isActive
          ? '<button class="btn btn-secondary" style="opacity: 0.7; pointer-events: none;">Active Model</button>'
          : "<button class=\\"btn btn-secondary\\" onclick=\\"activateModel('" + escapeHtml(m.id) + "')\\">Set Active</button>";

        return '<div class="model-card-item ' + (isActive ? 'is-active-model' : '') + '">' +
          '<div style="flex: 1; min-width: 0; padding-right: 12px;">' +
            '<div style="display: flex; align-items: center; gap: 8px;">' +
              '<strong style="font-size: 13.5px; word-break: break-all;">' + escapeHtml(m.id) + '</strong>' +
              (isActive ? '<span class="badge badge-Completed" style="font-size: 9.5px;">Active</span>' : '') +
            '</div>' +
            '<div style="font-size: 11.5px; color: var(--fg-muted); margin-top: 3px;">' +
              'Provider: <span style="color: #cbd5e1;">' + escapeHtml(m.provider || 'router') + '</span>' +
            '</div>' +
            (capsHtml ? '<div style="display: flex; gap: 4px; margin-top: 5px; flex-wrap: wrap;">' + capsHtml + '</div>' : '') +
          '</div>' +
          '<div>' + actionBtn + '</div>' +
        '</div>';
      }).join('');
    }

    function activateModel(modelId) {
      vscode.postMessage({ command: 'selectActiveModel', modelId });
    }

    function toggleHideLive(hide) {
      vscode.postMessage({ command: 'toggleFilterLive', filterLive: !hide });
    }

    /* ---------------- TAB 4: VOICE ---------------- */
    function renderVoiceTab(liveModels) {
      const orb = document.getElementById('voiceOrb');
      const title = document.getElementById('voiceStatusTitle');
      const desc = document.getElementById('voiceStatusDesc');
      const toggleBtn = document.getElementById('voiceToggleBtn');
      const muteBtn = document.getElementById('voiceMuteBtn');
      const talkBtn = document.getElementById('voiceTalkBtn');

      if (isVoiceCurrentlyActive) {
        orb.className = 'voice-orb active';
        title.innerText = isVoiceCurrentlyMuted
          ? 'Voice Conversation Muted'
          : (isVoiceCurrentlyTalking ? 'Voice Live & Listening' : 'Voice Connected (Mic Paused)');
        desc.innerText = isVoiceCurrentlyTalking
          ? 'Mic is live and transmitting audio to Gemini Live. Speak anytime!'
          : 'Microphone is paused. Click "Resume Mic" to speak.';
        toggleBtn.innerText = '⏹ Stop Voice Mode';
        toggleBtn.className = 'btn btn-danger';
        muteBtn.innerText = isVoiceCurrentlyMuted ? '🔊 Unmute Mic' : '🔇 Mute Mic';
        muteBtn.style.display = 'inline-flex';
        if (talkBtn) {
          talkBtn.innerText = isVoiceCurrentlyTalking ? '⏸ Pause Mic' : '🔴 Resume Mic (Speak)';
          talkBtn.className = isVoiceCurrentlyTalking ? 'btn btn-secondary' : 'btn btn-primary';
          talkBtn.style.display = 'inline-flex';
        }
      } else {
        orb.className = 'voice-orb';
        title.innerText = 'Voice Mode Ready';
        desc.innerText = 'Direct low-latency voice-to-voice with Gemini Live (BidiGenerateContent) and autonomous tool execution.';
        toggleBtn.innerText = '🎙️ Start Voice Mode';
        toggleBtn.className = 'btn btn-gradient';
        muteBtn.style.display = 'none';
        if (talkBtn) talkBtn.style.display = 'none';
      }

      if (liveModels && liveModels.length) {
        const sel = document.getElementById('liveModelSelect');
        sel.innerHTML = liveModels.map(function(m) {
          const isSel = m.id === currentVoiceOpts?.liveModel ? ' selected' : '';
          return '<option value="' + m.id + '"' + isSel + '>' + escapeHtml(m.name) + ' (' + escapeHtml(m.tag) + ')</option>';
        }).join('');
      }

      const keysList = document.getElementById('apiKeysList');
      if (!currentApiKeys || !currentApiKeys.length) {
        keysList.innerHTML = '<div style="font-size: 12px; color: #f59e0b; padding: 6px 0;">⚠️ No Gemini API keys configured. Voice Mode requires at least one Gemini key.</div>';
      } else {
        keysList.innerHTML = currentApiKeys.map(function(k, idx) {
          const badge = idx === 0
            ? '<span class="badge badge-Completed" style="font-size: 9px; margin-left: 6px;">Primary</span>'
            : '<span class="badge" style="font-size: 9px; margin-left: 6px; background: #475569;">Fallback</span>';
          return '<div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: rgba(0,0,0,0.3); border-radius: 4px; margin-bottom: 6px;">' +
            '<div style="font-family: monospace; font-size: 11.5px;">' + escapeHtml(k.masked) + ' ' + badge + '</div>' +
            '<button class="btn btn-secondary" style="padding: 2px 6px; font-size: 10px;" onclick="removeApiKey(' + idx + ')">Remove</button>' +
          '</div>';
        }).join('');
      }
    }

    function toggleVoiceMode() { vscode.postMessage({ command: 'toggleVoiceMode' }); }
    function toggleVoiceTalk() { vscode.postMessage({ command: 'toggleVoiceTalk' }); }
    function toggleVoiceMute() { vscode.postMessage({ command: 'toggleVoiceMute' }); }
    function openRecordingsFolder() { vscode.postMessage({ command: 'openRecordingsFolder' }); }
    function copyLatestAudioPath() { vscode.postMessage({ command: 'copyLatestAudio' }); }
    function checkMicLevel() { vscode.postMessage({ command: 'checkMicLevel' }); }
    function listAudioDevices() { vscode.postMessage({ command: 'listAudioDevices' }); }

    function onLiveModelChange(val) {
      vscode.postMessage({ command: 'setLiveModel', liveModel: val });
    }

    function addGeminiApiKey() {
      const input = document.getElementById('newApiKeyInput');
      const val = input.value.trim();
      if (!val) return;
      vscode.postMessage({ command: 'addGeminiApiKey', key: val });
      input.value = '';
    }

    function removeApiKey(idx) {
      vscode.postMessage({ command: 'removeGeminiApiKey', index: idx });
    }

    /* ---------------- TAB 5: SESSION & GUARDRAILS ---------------- */
    function renderSessionTab() {
      if (!currentSessionOpts) return;
      document.getElementById('tempSlider').value = currentSessionOpts.temperature ?? 0.5;
      document.getElementById('tempValueBadge').innerText = currentSessionOpts.temperature ?? 0.5;
      document.getElementById('maxTokensInput').value = currentSessionOpts.maxTokens ?? 4096;
      document.getElementById('maxTurnsInput').value = currentSessionOpts.maxTurns ?? 40;
      document.getElementById('allowShellCheck').checked = currentSessionOpts.allowShell !== false;
      document.getElementById('allowVscodeCheck').checked = currentSessionOpts.allowVscode !== false;
      document.getElementById('allowFilesCheck').checked = currentSessionOpts.allowFiles !== false;
      document.getElementById('workspacePromptInput').value = currentSessionOpts.systemPrompt || '';

      const rOpen = document.getElementById('resumeOnOpenCheck');
      if (rOpen) rOpen.checked = currentSessionOpts.resumeOnOpen !== false;
      const pHist = document.getElementById('persistHistoryCheck');
      if (pHist) pHist.checked = currentSessionOpts.persistHistory !== false;
      const uVoice = document.getElementById('unifiedVoiceAndTextCheck');
      if (uVoice) uVoice.checked = currentSessionOpts.unifiedVoiceAndText !== false;
      const mTurns = document.getElementById('maxPersistedTurnsInput');
      if (mTurns) mTurns.value = currentSessionOpts.maxPersistedTurns ?? 50;
    }

    function onTempSlider(val) {
      document.getElementById('tempValueBadge').innerText = val;
    }

    function saveSessionSettings() {
      const rOpen = document.getElementById('resumeOnOpenCheck');
      const pHist = document.getElementById('persistHistoryCheck');
      const uVoice = document.getElementById('unifiedVoiceAndTextCheck');
      const mTurns = document.getElementById('maxPersistedTurnsInput');

      vscode.postMessage({
        command: 'saveSessionOptions',
        temperature: parseFloat(document.getElementById('tempSlider').value),
        maxTokens: parseInt(document.getElementById('maxTokensInput').value, 10),
        maxTurns: parseInt(document.getElementById('maxTurnsInput').value, 10),
        allowShell: document.getElementById('allowShellCheck').checked,
        allowVscode: document.getElementById('allowVscodeCheck').checked,
        allowFiles: document.getElementById('allowFilesCheck').checked,
        systemPrompt: document.getElementById('workspacePromptInput').value.trim(),
        resumeOnOpen: rOpen ? rOpen.checked : true,
        persistHistory: pHist ? pHist.checked : true,
        unifiedVoiceAndText: uVoice ? uVoice.checked : true,
        maxPersistedTurns: mTurns ? parseInt(mTurns.value, 10) : 50
      });
    }

    function startNewSession() {
      vscode.postMessage({ command: 'newSession' });
    }

    function onSwitchSession(sessionId) {
      if (!sessionId) return;
      vscode.postMessage({ command: 'loadSession', sessionId: sessionId });
    }

    function exportActiveSession() {
      vscode.postMessage({ command: 'exportSession' });
    }

    function clearAllSavedSessions() {
      vscode.postMessage({ command: 'clearAllSessions' });
    }

    /* ---------------- TAB 6: CHAT CONSOLE & SERIAL GRAPH ---------------- */

    function setChatMode(mode) {
      currentChatMode = mode;
      const pBtn = document.getElementById('modePipelineBtn');
      const dBtn = document.getElementById('modeDirectBtn');
      const input = document.getElementById('chatMessageInput');
      const gWrap = document.getElementById('chatGraphWrapper');
      const wTitle = document.getElementById('chatWelcomeTitle');
      const wDesc = document.getElementById('chatWelcomeDesc');
      const banner = document.getElementById('chatDirectModeBanner');
      const bannerModel = document.getElementById('chatBannerModelName');
      const modePill = document.getElementById('inputBarModePill');
      const modeModelText = document.getElementById('inputBarModelText');
      const modelNameEl = document.getElementById('inputBarModelName');

      if (pBtn) pBtn.classList.toggle('active', mode === 'pipeline');
      if (dBtn) dBtn.classList.toggle('active', mode === 'direct');

      if (bannerModel) bannerModel.innerText = currentSelectedModel;
      if (modelNameEl) modelNameEl.innerText = currentSelectedModel;

      if (mode === 'pipeline') {
        if (input) input.placeholder = "Type your instruction or goal (e.g. 'Build REST API for products and write unit tests')… [Enter to Send, Shift+Enter for newline]";
        if (gWrap) gWrap.style.opacity = '1';
        if (wTitle) wTitle.innerText = 'Autonomous AI Role Orchestrator';
        if (wDesc) wDesc.innerHTML = 'In <strong>Autonomous Pipeline</strong> mode, enter a requirement to autonomously decompose and execute serial roles with real-time graph updates.';
        if (banner) banner.style.display = 'none';
        if (modePill) {
          modePill.innerText = '⚡ Autonomous Pipeline';
          modePill.style.background = 'rgba(56,189,248,0.15)';
          modePill.style.color = '#38bdf8';
        }
        if (modeModelText) modeModelText.innerText = 'Decomposing into serial specialized roles';
      } else {
        if (input) input.placeholder = "Chat with " + currentSelectedModel + " (normal text mode)… [Enter to Send, Shift+Enter for newline]";
        if (gWrap) gWrap.style.opacity = '0.7';
        if (wTitle) wTitle.innerText = 'Direct Chat with ' + currentSelectedModel;
        if (wDesc) wDesc.innerHTML = 'In <strong>Chat with Selected Model (Text Mode)</strong>, you converse directly with <strong>' + escapeHtml(currentSelectedModel) + '</strong> from 9 Router. You can change your selected model anytime using the dropdown or 9 Router model picker.';
        if (banner) banner.style.display = 'flex';
        if (modePill) {
          modePill.innerText = '💬 Text Mode (Chat with Selected Model)';
          modePill.style.background = 'rgba(34,197,94,0.15)';
          modePill.style.color = '#4ade80';
        }
        if (modeModelText) modeModelText.innerText = '1-on-1 direct conversation with tools';
      }
      if (input) input.focus();
      // keep compact bar in sync
      syncCompactBar(mode, null, null, currentSelectedModel);
    }

    function openChatModelPicker() {
      currentPickerContext = { isChatModel: true, isHub: false };
      document.getElementById('modelPickerTitle').innerText = 'Select Model from 9 Router';
      document.getElementById('modelPickerSubtitle').innerText = 'Pick any model from 2,150 9 Router models to chat with directly';
      document.getElementById('modelSearchInput').value = '';
      const statusEl = document.getElementById('modelCountStatus');
      if (statusEl) statusEl.innerText = 'Loading 9 Router models…';
      document.getElementById('modelPickerModal').classList.add('show');
      onModelSearchInput();
    }

    function renderChatTab(workspacePath, activeDoc) {
      const badge = document.getElementById('chatActiveModelBadge');
      if (badge) badge.innerText = currentSelectedModel;
      renderChatSerialGraph(currentWorkflow);
    }

    function renderChatSerialGraph(wf) {
      const container = document.getElementById('chatSerialGraph');
      const countText = document.getElementById('graphStepCountText');
      const statusPill = document.getElementById('chatWorkflowStatusPill');
      const goalSnippet = document.getElementById('chatGoalSnippet');

      if (!container) return;

      if (!wf || !wf.steps || wf.steps.length === 0) {
        container.innerHTML = '<span style="font-size: 11.5px; color: var(--fg-muted); font-style: italic;">Enter a task below to generate and launch the serial role pipeline…</span>';
        if (countText) countText.innerText = '0 / 0 steps';
        if (statusPill) {
          statusPill.className = 'badge badge-Queued';
          statusPill.innerText = 'Idle';
        }
        if (goalSnippet) goalSnippet.innerText = '(No active task)';
        syncCompactBar(currentChatMode, 'Idle', '(No active task)', null);
        return;
      }

      if (goalSnippet) goalSnippet.innerText = wf.userGoal || 'Untitled Goal';
      if (statusPill) {
        statusPill.className = 'badge badge-' + wf.status;
        statusPill.innerText = wf.status;
      }
      syncCompactBar(currentChatMode, wf.status, wf.userGoal || 'Untitled Goal', null);

      const total = wf.steps.length;
      const completed = wf.steps.filter(function(s) { return s.status === 'Completed'; }).length;
      if (countText) {
        countText.innerText = 'Step ' + (wf.activeStepIndex + 1) + ' of ' + total + ' (' + completed + ' done)';
      }

      container.innerHTML = wf.steps.map(function(step, idx) {
        const isRunning = idx === wf.activeStepIndex && wf.status === 'Running';
        const isCompleted = step.status === 'Completed';
        const isFailed = step.status === 'Failed';

        let nodeClass = 'node-queued';
        if (isRunning) {
          nodeClass = 'node-running';
        } else if (isCompleted) {
          nodeClass = 'node-completed';
        } else if (isFailed) {
          nodeClass = 'node-failed';
        }

        const isLast = idx === wf.steps.length - 1;
        const arrowClass = isCompleted ? 'arrow-completed' : (isRunning ? 'arrow-active' : '');

            "<button class=\\"btn btn-secondary\\" style=\\"padding: 2px 8px; font-size: 11px;\\" onclick=\\"openStepModal('" + step.id + "')\\">Inspect Prompt</button>" +
          '<span class="graph-node-dot"></span>' +
          '<span style="font-weight: 600;">#' + (idx + 1) + ' ' + escapeHtml(step.roleName) + '</span>' +
          '<span style="font-size: 10px; opacity: 0.8; max-width: 105px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">' + escapeHtml(step.assignedModel) + '</span>' +
        '</div>' +
        (!isLast ? '<span class="graph-arrow ' + arrowClass + '">➔</span>' : '');
      }).join('');
    }

    function syncRoleCardsWithWorkflow(wf) {
      if (!wf || !wf.steps || wf.steps.length === 0) return;
      const feed = document.getElementById('chatFeed');
      if (!feed) return;
      const welcome = document.getElementById('chatWelcomeCard');
      if (welcome) welcome.style.display = 'none';

      wf.steps.forEach(function(step, idx) {
        const isRunning = idx === wf.activeStepIndex && wf.status === 'Running';
        const isCompleted = step.status === 'Completed';
        const isFailed = step.status === 'Failed';
        const isQueued = !isRunning && !isCompleted && !isFailed;

        const borderClass = isRunning ? 'role-card-running' : (isCompleted ? 'role-card-completed' : (isFailed ? 'role-card-failed' : 'role-card-pending'));
        const badgeClass = isRunning ? 'badge-Running' : (isCompleted ? 'badge-Completed' : (isFailed ? 'badge-Failed' : 'badge-Queued'));
        const statusLabel = isRunning ? '● Running' : (isCompleted ? '✓ Completed' : (isFailed ? '✕ Failed' : 'Waiting'));

        let descText = step.taskName || '';
        if (isCompleted) {
          descText = step.resultSummary ? (step.resultSummary.slice(0, 160) + '…') : (step.taskName + ' - Completed.');
        } else if (isQueued) {
          const prevRole = idx > 0 ? wf.steps[idx - 1].roleName : '';
          descText = prevRole ? ('Waiting for ' + prevRole + '…') : 'Waiting in queue…';
        }

        const card = document.getElementById('role_card_view_role_step_' + step.id);
        if (card) {
          card.className = 'chat-role-card ' + borderClass;
          const badge = document.getElementById('role_badge_role_step_' + step.id);
          if (badge) {
            badge.className = 'badge ' + badgeClass;
            badge.innerText = statusLabel;
          }
          const descEl = document.getElementById('role_task_desc_role_step_' + step.id);
          if (descEl) {
            descEl.innerText = descText;
          }
        } else {
          appendLiveChatMessage({
            id: 'role_step_' + step.id,
            stepId: step.id,
            taskPrompt: step.taskPrompt,
            sender: 'role',
            roleName: step.roleName,
            roleModel: step.assignedModel,
            taskName: step.taskName,
            content: descText,
            timestamp: new Date().toLocaleTimeString(),
            status: isRunning ? 'Running' : (isCompleted ? 'Completed' : (isFailed ? 'Failed' : 'Queued')),
            logs: isRunning ? ['[' + step.roleName + '] Initialized execution with model ' + step.assignedModel + '…'] : ['Queued: Waiting to execute…']
          });
        }
      });
    }

    function appendLiveChatMessage(msg) {
      const feed = document.getElementById('chatFeed');
      if (!feed) return;
      const welcome = document.getElementById('chatWelcomeCard');
      if (welcome) welcome.style.display = 'none';

      chatMessagesList.push(msg);

      const row = document.createElement('div');
      row.id = 'chat_row_' + msg.id;

      if (msg.sender === 'user') {
        row.className = 'chat-bubble-row user-row';
        row.innerHTML =
          '<div class="chat-bubble-meta">' +
            '<span>You</span>' +
            '<span>•</span>' +
            '<span>' + escapeHtml(msg.timestamp || '') + '</span>' +
          '</div>' +
          '<div class="chat-bubble user-bubble">' + escapeHtml(msg.content) + '</div>';
      } else if (msg.sender === 'voice') {
        const isUserVoice = msg.from === 'user';
        row.className = 'chat-bubble-row ' + (isUserVoice ? 'user-row' : 'ai-row');
        row.innerHTML =
          '<div class="chat-bubble-meta">' +
            '<span>🎙️ ' + (isUserVoice ? 'You (Voice)' : 'Gemini Live') + '</span>' +
            '<span>•</span>' +
            '<span>' + escapeHtml(msg.timestamp || '') + '</span>' +
          '</div>' +
          '<div class="chat-bubble ' + (isUserVoice ? 'user-bubble' : 'ai-bubble') + '" id="voice_content_' + msg.id + '">' + escapeHtml(msg.content) + '</div>';
      } else if (msg.sender === 'role') {
        row.className = 'chat-bubble-row role-row';
        const isRunning = msg.status === 'Running';
        const isCompleted = msg.status === 'Completed';
        const isFailed = msg.status === 'Failed';
        const isQueued = !isRunning && !isCompleted && !isFailed;
        const borderClass = isRunning ? 'role-card-running' : (isCompleted ? 'role-card-completed' : (isFailed ? 'role-card-failed' : 'role-card-pending'));
        const badgeClass = isRunning ? 'badge-Running' : (isCompleted ? 'badge-Completed' : (isFailed ? 'badge-Failed' : 'badge-Queued'));
        const statusLabel = isRunning ? '● Running' : (isCompleted ? '✓ Completed' : (isFailed ? '✕ Failed' : 'Waiting'));
        const logLines = (msg.logs || []).map(function(l) { return escapeHtml(l); }).join('\\n');
        const stepIdForModal = msg.stepId || (msg.id && msg.id.indexOf('role_step_') === 0 ? msg.id.substring('role_step_'.length) : (msg.id || ''));

        row.innerHTML =
          '<div class="chat-role-card ' + borderClass + '" id="role_card_view_' + msg.id + '">' +
            '<div class="chat-role-head">' +
              '<div style="display: flex; align-items: center; gap: 8px;">' +
                '<span style="font-size: 14px;">⚡</span>' +
                '<strong style="font-size: 13px; color: #f8fafc;">' + escapeHtml(msg.roleName || 'Specialized Role') + '</strong>' +
                '<span class="badge" style="background: rgba(59,130,246,0.15); color: #60a5fa; font-size: 10px;">' + escapeHtml(msg.roleModel || '') + '</span>' +
              '</div>' +
              '<div style="display: flex; align-items: center; gap: 6px;">' +
                "<button class=\\"btn btn-secondary\\" style=\\"padding: 2px 8px; font-size: 10.5px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px; cursor: pointer;\\" onclick=\\"openStepModal('" + escapeHtml(stepIdForModal) + "')\\">🔍 Inspect Prompt</button>" +
                '<span class="badge ' + badgeClass + '" id="role_badge_' + msg.id + '">' + statusLabel + '</span>' +
              '</div>' +
            '</div>' +
            '<div style="font-size: 12px; color: #cbd5e1; margin-bottom: 8px;" id="role_task_desc_' + msg.id + '">' + escapeHtml(msg.content || '') + '</div>' +
            '<div class="chat-role-log-box" id="role_logs_' + msg.id + '">' + logLines + '</div>' +
          '</div>';
      } else {
        row.className = 'chat-bubble-row ai-row';
        row.innerHTML =
          '<div class="chat-bubble-meta">' +
            '<span>' + escapeHtml(msg.roleModel || '9 Router') + '</span>' +
            '<span>•</span>' +
            '<span>' + escapeHtml(msg.timestamp || '') + '</span>' +
          '</div>' +
          '<div class="chat-bubble ai-bubble" id="ai_content_' + msg.id + '">' + escapeHtml(msg.content) + '</div>';
      }

      feed.appendChild(row);
      feed.scrollTop = feed.scrollHeight;
    }

    function appendLiveChatDelta(id, text) {
      const el = document.getElementById('ai_content_' + id) || document.getElementById('voice_content_' + id);
      if (el) {
        el.innerText += text;
        const feed = document.getElementById('chatFeed');
        if (feed) feed.scrollTop = feed.scrollHeight;
      }
    }

    function appendLiveChatLog(line, roleName) {
      const logBoxes = document.querySelectorAll('.chat-role-log-box');
      if (logBoxes.length > 0) {
        const lastBox = logBoxes[logBoxes.length - 1];
        lastBox.innerText += (lastBox.innerText ? '\\n' : '') + line;
        lastBox.scrollTop = lastBox.scrollHeight;
      }
    }

    function updateStepProgressInChat(stepId, state, pct, note) {
      const card = document.getElementById('role_card_view_role_step_' + stepId);
      if (card) {
        const badge = document.getElementById('role_badge_role_step_' + stepId);
        if (badge) {
          badge.innerText = state;
          badge.className = 'badge badge-' + (state === 'Completed' ? 'Completed' : (state === 'Failed' ? 'Failed' : 'Running'));
        }
        if (state === 'Completed') {
          card.classList.remove('role-card-running');
          card.classList.add('role-card-completed');
        } else if (state === 'Failed') {
          card.classList.remove('role-card-running');
          card.classList.add('role-card-failed');
        }
        const logBox = document.getElementById('role_logs_role_step_' + stepId);
        if (logBox && note) {
          logBox.innerText += '\\n[progress] ' + state + (pct ? ' (' + pct + '%)' : '') + ' - ' + note;
          logBox.scrollTop = logBox.scrollHeight;
        }
      }
    }

    function handleVoiceTurnInChat(text, turnComplete, from) {
      const isUser = from === 'user';
      const activeId = isUser ? 'active_live_user_bubble' : 'active_live_ai_bubble';
      const oppositeId = isUser ? 'active_live_ai_bubble' : 'active_live_user_bubble';

      // If turn is complete with no extra text, finalize active bubble
      if (!text && turnComplete) {
        const currentActive = document.getElementById(activeId);
        if (currentActive) currentActive.removeAttribute('id');
        return;
      }
      if (!text) return;

      const feed = document.getElementById('chatFeed');
      if (!feed) return;
      const welcome = document.getElementById('chatWelcomeCard');
      if (welcome) welcome.style.display = 'none';

      // Ensure any lingering opposite speaker bubble is closed so turns never concatenate
      const oppositeBubble = document.getElementById(oppositeId);
      if (oppositeBubble) {
        oppositeBubble.removeAttribute('id');
      }

      let voiceBox = document.getElementById(activeId);
      if (!voiceBox) {
        const row = document.createElement('div');
        row.className = 'chat-bubble-row ' + (isUser ? 'user-row' : 'ai-row');
        row.innerHTML =
          '<div class="chat-bubble-meta">' +
            '<span>' + (isUser ? '🎙️ You (Voice)' : '🎙️ Gemini Live (AI)') + '</span>' +
            '<span>•</span>' +
            '<span>' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '</span>' +
          '</div>' +
          '<div class="chat-bubble ' + (isUser ? 'user-bubble voice-user-bubble' : 'ai-bubble voice-ai-bubble') + '" id="' + activeId + '">' + escapeHtml(text) + '</div>';
        feed.appendChild(row);
        voiceBox = document.getElementById(activeId);
      } else {
        voiceBox.innerText += text;
      }

      feed.scrollTop = feed.scrollHeight;

      if (turnComplete && voiceBox) {
        voiceBox.removeAttribute('id');
      }
    }

    function submitChatMessage() {
      const input = document.getElementById('chatMessageInput');
      if (!input) return;
      const text = input.value.trim();
      if (!text) return;

      vscode.postMessage({
        command: 'chatSubmit',
        text,
        mode: currentChatMode,
        selectedModel: currentSelectedModel
      });

      input.value = '';
    }

    function onChatInputKeyDown(event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        submitChatMessage();
      }
    }

    function fillChatPrompt(text) {
      const input = document.getElementById('chatMessageInput');
      if (input) {
        input.value = text;
        input.focus();
        input.scrollTop = input.scrollHeight;
      }
    }

    function clearChatMessages() {
      vscode.postMessage({ command: 'clearChat' });
    }

    function clearChatUI() {
      chatMessagesList = [];
      const feed = document.getElementById('chatFeed');
      if (feed) {
        feed.innerHTML =
          '<div id="chatWelcomeCard" class="card" style="text-align: center; padding: 28px 20px; background: rgba(15,23,42,0.5); border: 1px dashed rgba(255,255,255,0.12);">' +
            '<div style="font-size: 32px; margin-bottom: 8px;">🚀</div>' +
            '<h3 id="chatWelcomeTitle" style="font-size: 15px; font-weight: 600; margin-bottom: 6px;">Autonomous AI Role Orchestrator & Chat</h3>' +
            '<p id="chatWelcomeDesc" style="font-size: 12.5px; color: var(--fg-muted); max-width: 540px; margin: 0 auto 16px auto; line-height: 1.5;">' +
              'In <strong>Autonomous Pipeline</strong> mode, enter a requirement to decompose and execute serial roles with real-time graph updates. Switch to <strong>Chat with Selected Model</strong> to converse directly with your chosen 9 Router model.' +
            '</p>' +
            '<div style="display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;">' +
              "<button class=\\"btn btn-secondary\\" style=\\"font-size: 11.5px; padding: 5px 12px;\\" onclick=\\"fillChatPrompt('Build authentication system with OAuth2 and JWT tokens')\\">🔐 Build Auth & JWT</button>" +
              "<button class=\\"btn btn-secondary\\" style=\\"font-size: 11.5px; padding: 5px 12px;\\" onclick=\\"fillChatPrompt('Create database schema and REST API endpoints')\\">🗄️ DB Schema & API</button>" +
              "<button class=\\"btn btn-secondary\\" style=\\"font-size: 11.5px; padding: 5px 12px;\\" onclick=\\"fillChatPrompt('Audit codebase for vulnerabilities and write unit tests')\\">🛡️ Audit & Write Tests</button>" +
            '</div>' +
          '</div>';
      }
    }

    function toggleDictation() {
      const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
      const btn = document.getElementById('dictateBtn');
      const btnText = document.getElementById('dictateBtnText');

      if (!SpeechRec) {
        alert('Web Speech API is not available in this environment. You can click "Voice Mode" for direct Gemini Live bidirectional voice streaming.');
        return;
      }

      if (isDictating) {
        if (speechRecognizer) speechRecognizer.stop();
        isDictating = false;
        if (btn) btn.classList.remove('dictating-active');
        if (btnText) btnText.innerText = 'Dictate';
        return;
      }

      try {
        speechRecognizer = new SpeechRec();
        speechRecognizer.continuous = true;
        speechRecognizer.interimResults = true;
        speechRecognizer.lang = 'en-US';

        const input = document.getElementById('chatMessageInput');
        let startingText = input ? input.value : '';
        if (startingText && !startingText.endsWith(' ')) startingText += ' ';

        speechRecognizer.onstart = () => {
          isDictating = true;
          if (btn) btn.classList.add('dictating-active');
          if (btnText) btnText.innerText = 'Listening…';
        };

        speechRecognizer.onresult = (event) => {
          let interim = '';
          let final = '';
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              final += event.results[i][0].transcript;
            } else {
              interim += event.results[i][0].transcript;
            }
          }
          if (input) {
            input.value = startingText + final + (interim ? ' ' + interim : '');
            input.scrollTop = input.scrollHeight;
          }
        };

        speechRecognizer.onerror = (e) => {
          console.warn('Speech recognition error', e);
          isDictating = false;
          if (btn) btn.classList.remove('dictating-active');
          if (btnText) btnText.innerText = 'Dictate';
        };

        speechRecognizer.onend = () => {
          isDictating = false;
          if (btn) btn.classList.remove('dictating-active');
          if (btnText) btnText.innerText = 'Dictate';
        };

        speechRecognizer.start();
      } catch (err) {
        console.error('Failed to start speech recognition', err);
        isDictating = false;
        if (btn) btn.classList.remove('dictating-active');
        if (btnText) btnText.innerText = 'Dictate';
      }
    }

    function toggleVoiceModeFromChat() {
      vscode.postMessage({ command: 'toggleVoiceMode' });
    }

    /* ---------------- MODEL PICKER POPUP (from roles & chat) ---------------- */
    function openModelPicker(roleId, field) {
      currentPickerContext = { roleId, field, isHub: false, isChatModel: false };
      document.getElementById('modelPickerTitle').innerText = field === 'primary'
        ? 'Select Primary Model (Fuzzy Search)'
        : 'Add Fallback Model (Fuzzy Search)';
      document.getElementById('modelPickerSubtitle').innerText = 'Complete 9 Router Gateway Catalog';
      document.getElementById('modelSearchInput').value = '';
      const statusEl = document.getElementById('modelCountStatus');
      if (statusEl) statusEl.innerText = 'Loading 9 Router models…';
      document.getElementById('modelPickerModal').classList.add('show');
      onModelSearchInput();
    }

    function closeModelPicker() {
      document.getElementById('modelPickerModal').classList.remove('show');
      currentPickerContext = null;
    }

    function onModelSearchInput() {
      const q = document.getElementById('modelSearchInput').value;
      vscode.postMessage({
        command: 'fuzzySearchModels',
        query: q,
        field: currentPickerContext?.field,
        roleId: currentPickerContext?.roleId
      });
    }

    function refreshRouterModels() {
      const btn = document.getElementById('refreshRouterModelsBtn');
      if (btn) btn.innerText = '⟳ Syncing…';
      vscode.postMessage({
        command: 'refreshRouterModels',
        query: document.getElementById('modelSearchInput').value,
        field: currentPickerContext?.field,
        roleId: currentPickerContext?.roleId
      });
    }

    function renderFuzzyResults(msg) {
      const models = msg.models || [];
      const totalCount = msg.totalCount ?? models.length;
      const catalogSize = msg.catalogSize ?? 2150;
      const statusEl = document.getElementById('modelCountStatus');
      if (statusEl) {
        if (msg.query) {
          statusEl.innerText = 'Found ' + totalCount + ' matching model(s) in 9 Router (displaying top ' + models.length + ')';
        } else {
          statusEl.innerText = 'Showing all ' + models.length + ' of ' + catalogSize + ' models from 9 Router';
        }
      }
      const btn = document.getElementById('refreshRouterModelsBtn');
      if (btn) btn.innerText = '⟳ Sync 9 Router';

      const list = document.getElementById('modelList');
      if (!models || !models.length) {
        list.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--fg-muted);">No matching models found in 9 Router.</div>';
        return;
      }

      list.innerHTML = models.map(function(m) {
        const capsList = [];
        if (m.caps && m.caps.tools) capsList.push('tools');
        if (m.caps && m.caps.reasoning) capsList.push('reasoning');
        if (m.caps && m.caps.vision) capsList.push('vision');
        if (m.caps && (m.caps.audioInput || m.caps.audioOutput)) capsList.push('audio');
        const isRouter = m.source === 'router' || m.id.includes('/');
        if (isRouter) capsList.push('9router');
        const capsHtml = capsList.map(function(c) {
          return '<span class="model-cap-tag ' + (c === '9router' ? 'tag-router' : '') + '">' + c + '</span>';
        }).join('');

        return "<div class=\\"model-item\\" onclick=\\"selectModel('" + escapeHtml(m.id) + "')\\">" +
          '<div style="flex: 1; min-width: 0; padding-right: 10px;">' +
            '<div style="display: flex; align-items: center; gap: 6px;">' +
              '<strong style="word-break: break-all;">' + escapeHtml(m.id) + '</strong>' +
            '</div>' +
            '<div class="model-detail" style="font-size: 11px; color: var(--fg-muted); margin-top: 2px;">Provider: ' + escapeHtml(m.provider || 'router') + '</div>' +
            (capsHtml ? '<div style="display: flex; gap: 4px; margin-top: 3px; flex-wrap: wrap;">' + capsHtml + '</div>' : '') +
          '</div>' +
          '<button class="btn btn-secondary" style="pointer-events: none; flex-shrink: 0;">Select</button>' +
        '</div>';
      }).join('');
    }

    function selectModel(modelId) {
      if (!currentPickerContext || currentPickerContext.isChatModel) {
        currentSelectedModel = modelId;
        updateHeaderStatus();
        const badge = document.getElementById('chatActiveModelBadge');
        if (badge) badge.innerText = modelId;
        const bannerModel = document.getElementById('chatBannerModelName');
        if (bannerModel) bannerModel.innerText = modelId;
        const barModel = document.getElementById('inputBarModelName');
        if (barModel) barModel.innerText = modelId;

        const qSelect = document.getElementById('chatQuickModelDropdown');
        if (qSelect) {
          let found = false;
          for (let i = 0; i < qSelect.options.length; i++) {
            if (qSelect.options[i].value === modelId) {
              qSelect.selectedIndex = i;
              found = true;
              break;
            }
          }
          if (!found) {
            const opt = document.createElement('option');
            opt.value = modelId;
            opt.innerText = modelId;
            qSelect.insertBefore(opt, qSelect.firstChild);
            qSelect.selectedIndex = 0;
          }
        }

        if (currentChatMode === 'direct') {
          const input = document.getElementById('chatMessageInput');
          if (input) input.placeholder = "Chat with " + modelId + " (normal text mode)… [Enter to Send, Shift+Enter for newline]";
          const wTitle = document.getElementById('chatWelcomeTitle');
          if (wTitle) wTitle.innerText = 'Direct Chat with ' + modelId;
          const wDesc = document.getElementById('chatWelcomeDesc');
          if (wDesc) wDesc.innerHTML = 'In <strong>Chat with Selected Model (Text Mode)</strong>, you converse directly with <strong>' + escapeHtml(modelId) + '</strong> from 9 Router.';
        }
        vscode.postMessage({ command: 'selectActiveModel', modelId });
        closeModelPicker();
        return;
      }

      const { roleId, field } = currentPickerContext;
      if (field === 'primary') {
        const input = document.getElementById('primary_' + roleId);
        if (input) input.value = modelId;
      } else {
        const input = document.getElementById('fallbacks_' + roleId);
        if (input) {
          const curr = input.value.split(',').map(s => s.trim()).filter(Boolean);
          if (!curr.includes(modelId)) curr.push(modelId);
          input.value = curr.join(', ');
        }
      }
      closeModelPicker();
      saveRoleCard(roleId);
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // Attach all interactive functions to window so inline onclick handlers always work
    window.switchTab = switchTab;
    window.openChatInterface = openChatInterface;
    window.openChatWithSelectedModel = openChatWithSelectedModel;
    window.startTaskPrompt = startTaskPrompt;
    window.closeNewTaskModal = closeNewTaskModal;
    window.submitInlineNewTask = submitInlineNewTask;
    window.requestRefresh = requestRefresh;
    window.toggleQuickHub = toggleQuickHub;
    window.toggleChatHeader = toggleChatHeader;
    window.togglePipelineGraph = togglePipelineGraph;
    window.submitChatMessage = submitChatMessage;
    window.onChatInputKeyDown = onChatInputKeyDown;
    window.clearChatMessages = clearChatMessages;
    window.toggleDictation = toggleDictation;
    window.setChatMode = setChatMode;
    window.openChatModelPicker = openChatModelPicker;
    window.closeModelPicker = closeModelPicker;
    window.fillChatPrompt = fillChatPrompt;
    window.closeModal = closeModal;
    window.openStepModal = openStepModal;
    window.toggleVoiceMode = toggleVoiceMode;
    window.toggleVoiceTalk = toggleVoiceTalk;
    window.toggleVoiceMute = toggleVoiceMute;
    window.toggleVoiceModeFromChat = toggleVoiceModeFromChat;
    window.saveSessionSettings = saveSessionSettings;
    window.selectModel = selectModel;
    window.onModelSearchInput = onModelSearchInput;
    window.refreshRouterModels = refreshRouterModels;
    window.syncModelsHub = syncModelsHub;
    window.setHubFilter = setHubFilter;
    window.onHubSearch = onHubSearch;
    window.autoAssignRoles = autoAssignRoles;
    window.openRolesJson = openRolesJson;
    window.filterRoles = filterRoles;
    window.saveRoleCard = saveRoleCard;
    window.toggleRoleEnabled = toggleRoleEnabled;
    window.onChatQuickModelChange = onChatQuickModelChange;
    window.onLiveModelChange = onLiveModelChange;
    window.addGeminiApiKey = addGeminiApiKey;
    window.removeApiKey = removeApiKey;
    window.checkMicLevel = checkMicLevel;
    window.listAudioDevices = listAudioDevices;
    window.copyLatestAudioPath = copyLatestAudioPath;
    window.openRecordingsFolder = openRecordingsFolder;
    window.focusLiveModelSelect = focusLiveModelSelect;
    window.focusApiKeysSection = focusApiKeysSection;
    window.activateModel = activateModel;
    window.toggleHideLive = toggleHideLive;
    window.onTempSlider = onTempSlider;
    window.pauseWorkflow = pauseWorkflow;
    window.resumeWorkflow = resumeWorkflow;
    window.cancelWorkflow = cancelWorkflow;
    window.startNewSession = startNewSession;
    window.onSwitchSession = onSwitchSession;
    window.exportActiveSession = exportActiveSession;
    window.clearAllSavedSessions = clearAllSavedSessions;

    // Universal CSP-safe Event Delegation and Action Dispatcher
    const ACTION_MAP = {
      switchTab: function(arg) { switchTab(arg); },
      openChatInterface: function(arg) { openChatInterface(arg); },
      openChatWithSelectedModel: function() { openChatWithSelectedModel(); },
      setChatMode: function(arg) { setChatMode(arg); },
      openChatModelPicker: function() { openChatModelPicker(); },
      closeModelPicker: function() { closeModelPicker(); },
      refreshRouterModels: function() { refreshRouterModels(); },
      startTaskPrompt: function() { startTaskPrompt(); },
      closeNewTaskModal: function() { closeNewTaskModal(); },
      submitInlineNewTask: function() { submitInlineNewTask(); },
      submitChatMessage: function() { submitChatMessage(); },
      clearChatMessages: function() { clearChatMessages(); },
      startNewSession: function() { startNewSession(); },
      exportActiveSession: function() { exportActiveSession(); },
      clearAllSavedSessions: function() { clearAllSavedSessions(); },
      toggleDictation: function() { toggleDictation(); },
      toggleVoiceModeFromChat: function() { toggleVoiceModeFromChat(); },
      fillChatPrompt: function(arg) { fillChatPrompt(arg); },
      toggleQuickHub: function() { toggleQuickHub(); },
      toggleChatHeader: function() { toggleChatHeader(); },
      togglePipelineGraph: function() { togglePipelineGraph(); },
      requestRefresh: function() { requestRefresh(); },
      openStepModal: function(arg) { openStepModal(arg); },
      closeModal: function() { closeModal(); },
      openRolesJson: function() { openRolesJson(); },
      autoAssignRoles: function(arg) { autoAssignRoles(arg); },
      toggleVoiceMode: function() { toggleVoiceMode(); },
      toggleVoiceTalk: function() { toggleVoiceTalk(); },
      toggleVoiceMute: function() { toggleVoiceMute(); },
      checkMicLevel: function() { checkMicLevel(); },
      copyLatestAudioPath: function() { copyLatestAudioPath(); },
      openRecordingsFolder: function() { openRecordingsFolder(); },
      listAudioDevices: function() { listAudioDevices(); },
      focusLiveModelSelect: function() { focusLiveModelSelect(); },
      focusApiKeysSection: function() { focusApiKeysSection(); },
      saveSessionSettings: function() { saveSessionSettings(); },
      pauseWorkflow: function() { pauseWorkflow(); },
      resumeWorkflow: function() { resumeWorkflow(); },
      cancelWorkflow: function() { cancelWorkflow(); }
    };

    function parseArg(tok, el) {
      tok = (tok || '').trim();
      if (!tok) return undefined;
      if (tok === 'this.checked') return el ? !!el.checked : true;
      if (tok === 'this.value') return el ? el.value : '';
      if (tok.match(/^['"].*['"]$/)) return tok.slice(1, -1);
      if (!isNaN(Number(tok))) return Number(tok);
      if (tok === 'true') return true;
      if (tok === 'false') return false;
      return tok;
    }

    function executeRawOnclick(raw, el) {
      if (!raw) return;
      const clean = raw.trim();
      const match = clean.match(/^\s*([a-zA-Z0-9_$]+)\s*\((.*)\)\s*;?\s*$/);
      if (match) {
        const fnName = match[1];
        const rawArgs = (match[2] || '').trim();
        const args = [];
        if (rawArgs.length > 0) {
          const tokens = rawArgs.split(/\s*,\s*/);
          for (let i = 0; i < tokens.length; i++) {
            args.push(parseArg(tokens[i], el));
          }
        }
        if (typeof window[fnName] === 'function') {
          try {
            window[fnName].apply(window, args);
            return;
          } catch (err) {
            console.warn('[Webview Action]', fnName, err);
          }
        }
        if (ACTION_MAP[fnName]) {
          try {
            ACTION_MAP[fnName].apply(null, args);
            return;
          } catch (err) {
            console.warn('[Webview ActionMap]', fnName, err);
          }
        }
      }
    }

    // Global click listener guarantees execution even if VS Code webview CSP blocks inline onclick
    document.addEventListener('click', function(e) {
      // 1. Data-action
      const actionEl = e.target.closest('[data-action]');
      if (actionEl) {
        const action = actionEl.getAttribute('data-action');
        const param = actionEl.getAttribute('data-param');
        if (ACTION_MAP[action]) {
          ACTION_MAP[action](param, actionEl);
          e.preventDefault();
          return;
        }
      }

      // 2. Data-tab
      const tabEl = e.target.closest('[data-tab]');
      if (tabEl) {
        const tab = tabEl.getAttribute('data-tab');
        switchTab(tab);
        e.preventDefault();
        return;
      }

      // 3. Data-prompt
      const promptEl = e.target.closest('[data-prompt]');
      if (promptEl) {
        fillChatPrompt(promptEl.getAttribute('data-prompt'));
        e.preventDefault();
        return;
      }

      // 4. Inline onclick fallback (safely invoked via JS delegation)
      const onclickEl = e.target.closest('[onclick]');
      if (onclickEl && !actionEl) {
        // If native inline onclick was already fired by browser, do not double-invoke
        if (typeof onclickEl.onclick === 'function') {
          return;
        }
        const raw = onclickEl.getAttribute('onclick');
        if (raw) {
          executeRawOnclick(raw, onclickEl);
        }
      }
    });

    // Delegated change listener (dropdowns & selects)
    document.addEventListener('change', function(e) {
      if (e.target && e.target.id === 'chatQuickModelDropdown') {
        onChatQuickModelChange(e.target.value);
      } else if (e.target && e.target.id === 'liveModelSelect') {
        onLiveModelChange(e.target.value);
      }
    });

    // Delegated input listener (search inputs & range sliders)
    document.addEventListener('input', function(e) {
      if (e.target && e.target.id === 'modelSearchInput') {
        onModelSearchInput();
      } else if (e.target && e.target.id === 'roleFilterInput') {
        filterRoles();
      } else if (e.target && e.target.id === 'tempSlider') {
        onTempSlider(parseFloat(e.target.value));
      }
    });

    // Delegated keydown listener (Enter / Ctrl+Enter)
    document.addEventListener('keydown', function(e) {
      if (e.target && e.target.id === 'chatMessageInput') {
        onChatInputKeyDown(e);
      } else if (e.target && e.target.id === 'newTaskGoalInput' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        submitInlineNewTask();
      }
    });

    // Drag Resizer for Chat Message Input
    (function initChatResizer() {
      const resizer = document.getElementById('chatInputResizer');
      const input = document.getElementById('chatMessageInput');
      if (!resizer || !input) return;
      let startY = 0;
      let startH = 0;

      function onMouseMove(e) {
        const delta = startY - e.clientY;
        const newH = Math.max(44, Math.min(350, startH + delta));
        input.style.height = newH + 'px';
      }

      function onMouseUp() {
        resizer.classList.remove('resizing');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      }

      resizer.addEventListener('mousedown', function(e) {
        startY = e.clientY;
        startH = input.offsetHeight;
        resizer.classList.add('resizing');
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        e.preventDefault();
      });
    })();

    // Load initial embedded state immediately so all buttons and UI are active on 1st frame
    try {
      const initScript = document.getElementById('initial-state');
      if (initScript && initScript.textContent) {
        const initData = JSON.parse(initScript.textContent);
        applyState(initData);
      }
    } catch (err) {
      console.warn('[Webview] Could not parse initial state:', err);
    }

    // Handshake: signal to extension that webview is fully ready to receive state
    try {
      vscode.postMessage({ command: 'ready' });
    } catch {
      /* ignore */
    }
  </script>
</body>
</html>`;
  }
}
