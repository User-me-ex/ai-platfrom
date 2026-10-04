import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { catalogModelInfos, fetchRouterModels, mergeModels, getBidiLiveModels, UnifiedModelCatalog, type ModelInfo } from './models';
import { agentSystem, voiceAgentSystem, executeTools, hasToolBlocks, streamCompletion, stripToolBlocks, toolBlockAwareAppender, ANTIGRAVITY_TOOLS, type ChatMessage, type NativeToolCall } from './chat';
import * as voice from './voice';
import { SerialOrchestrator } from './orchestration/orchestrator';
import { MainVoiceOrchestratorBridge, ORCHESTRATION_TOOL_DECLARATIONS } from './orchestration/mainVoiceOrchestrator';
import { WorkflowWebviewPanel } from './ui/workflowWebview';
import { getRoles, getRole, syncRolesWithWorkspaceFile, initRolesFileWatcher, getWorkspaceRolesFilePath } from './roles/roleRegistry';
import { configureRoleInteractive } from './roles/modelSelector';
import { TaskStep, RoleDefinition } from './roles/types';
import { SessionManager } from './session/sessionManager';

const CATALOG_SIZE = catalogModelInfos().length;

let statusBar: vscode.StatusBarItem;
let busyBar: vscode.StatusBarItem;
let busyDepth = 0;
let chatOutput: vscode.OutputChannel;

let orchestrator: SerialOrchestrator;
let voiceBridge: MainVoiceOrchestratorBridge;

let voiceBtn: vscode.StatusBarItem;
let muteBtn: vscode.StatusBarItem;
let voiceConnBar: vscode.StatusBarItem;
let chatBtn: vscode.StatusBarItem;
let voiceActive = false;
let voiceTalking = false;
let voiceMuted = false;
let voiceTextOpen = false;
let voiceLastFrom: 'user' | 'ai' | undefined;
let liveCall: voice.LiveCall | undefined;

async function attemptLlmRolePlanning(
  goal: string,
  allRoles: RoleDefinition[],
  baseUrl: string,
  apiKey?: string
): Promise<TaskStep[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);

  try {
    const roleCatalog = allRoles.map((r) => `${r.id}: ${r.name} (${r.purpose})`).join('\n');
    const prompt = `You are the AI Orchestrator. Analyze the user's task requirement and determine the exact sequence of specialized roles to execute sequentially.
User Goal: "${goal}"

Available Specialized Roles:
${roleCatalog}

Rules:
1. Return ONLY a valid JSON array of objects with keys: "roleId", "taskName", "taskPrompt".
2. Only include roles that are genuinely necessary for this specific task.
3. Order them in the optimal sequential execution order.
4. Do not include markdown formatting or extra text.

Example format:
[
  { "roleId": "researcher", "taskName": "Investigate ...", "taskPrompt": "..." },
  { "roleId": "frontend", "taskName": "Build ...", "taskPrompt": "..." }
]`;

    const res = await streamCompletion(
      {
        baseUrl,
        apiKey,
        model: 'ag/gemini-3.8-flash-high',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        maxTokens: 1024
      },
      () => {}
    );

    clearTimeout(timer);
    if (!res.content) return null;
    const jsonStr = res.content.replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;

    const steps: TaskStep[] = [];
    for (const item of parsed) {
      const roleDef = allRoles.find((r) => r.id === item.roleId) || allRoles[0];
      steps.push({
        id: `step_${steps.length + 1}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        roleId: roleDef.id,
        roleName: roleDef.name,
        taskName: item.taskName || `Execute ${roleDef.name}`,
        taskPrompt: item.taskPrompt || goal,
        status: 'Queued',
        progressState: 'Waiting',
        assignedModel: roleDef.primaryModel,
        fallbackHistory: [],
        filesChanged: []
      });
    }
    return steps;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export async function planWorkflowFromGoal(
  goal: string,
  context: vscode.ExtensionContext,
  baseUrl?: string,
  apiKey?: string
): Promise<TaskStep[]> {
  const g = goal.toLowerCase();
  const allRoles = getRoles(context).filter((r) => r.enabled);
  const steps: TaskStep[] = [];

  const addStep = (roleId: string, taskName: string, prompt: string) => {
    const roleDef = allRoles.find((r) => r.id === roleId) || allRoles.find((r) => r.id === 'researcher') || allRoles[0];
    steps.push({
      id: `step_${steps.length + 1}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      roleId: roleDef.id,
      roleName: roleDef.name,
      taskName,
      taskPrompt: prompt,
      status: 'Queued',
      progressState: 'Waiting',
      assignedModel: roleDef.primaryModel,
      fallbackHistory: [],
      filesChanged: []
    });
  };

  // 1. Try real-time LLM-based role planning if 9 Router gateway is configured
  if (baseUrl) {
    try {
      const llmSteps = await attemptLlmRolePlanning(goal, allRoles, baseUrl, apiKey);
      if (llmSteps && llmSteps.length > 0) {
        return llmSteps;
      }
    } catch {
      // Fall through to dynamic heuristic decomposition
    }
  }

  // 2. Dynamic Heuristic Decomposition:
  // Detect intent, roles mentioned, and determine optimal serial sequence
  const detectedRoles: Array<{ roleId: string; pos: number }> = [];

  const roleKeywords: Record<string, string[]> = {
    frontend: ['frontend', 'ui', 'view', 'page', 'component', 'css', 'html', 'styling', 'client', 'react', 'vue'],
    database: ['database', 'db', 'schema', 'table', 'model', 'sql', 'mongo', 'postgres', 'persistence', 'prisma', 'migration'],
    backend: ['backend', 'api', 'endpoint', 'server', 'controller', 'route', 'service', 'express', 'nest'],
    authentication: ['auth', 'authentication', 'security', 'login', 'signup', 'token', 'jwt', 'oauth', 'permission'],
    testing: ['test', 'testing', 'unit test', 'e2e', 'spec', 'verify', 'validate', 'audit'],
    devops: ['docker', 'ci/cd', 'deploy', 'kubernetes', 'pipeline', 'container'],
    docs: ['documentation', 'docs', 'readme', 'api spec', 'swagger']
  };

  for (const [roleId, keywords] of Object.entries(roleKeywords)) {
    let earliestPos = -1;
    for (const kw of keywords) {
      const idx = g.indexOf(kw);
      if (idx !== -1 && (earliestPos === -1 || idx < earliestPos)) {
        earliestPos = idx;
      }
    }
    if (earliestPos !== -1) {
      detectedRoles.push({ roleId, pos: earliestPos });
    }
  }

  // If user explicitly listed roles (e.g. "with frontend, backend and database"), respect requested order
  detectedRoles.sort((a, b) => a.pos - b.pos);

  // If both database and backend are detected, ensure database precedes backend unless explicit
  const dbIndex = detectedRoles.findIndex((r) => r.roleId === 'database');
  const beIndex = detectedRoles.findIndex((r) => r.roleId === 'backend');
  if (dbIndex !== -1 && beIndex !== -1 && dbIndex > beIndex) {
    // If user said "frontend, backend and database" -> Researcher -> Frontend -> Database -> Backend
    const dbItem = detectedRoles.splice(dbIndex, 1)[0];
    detectedRoles.splice(beIndex, 0, dbItem);
  }

  // Ensure testing is always placed at the end of the serial pipeline
  const testIndex = detectedRoles.findIndex((r) => r.roleId === 'testing');
  if (testIndex !== -1 && testIndex < detectedRoles.length - 1) {
    const testItem = detectedRoles.splice(testIndex, 1)[0];
    detectedRoles.push(testItem);
  }

  // Always start with Researcher to investigate requirements & architecture
  addStep(
    'researcher',
    `Investigate Requirements & Architecture`,
    `Investigate existing project architecture, conventions, schema contracts, and dependencies for: "${goal}". Provide clear findings and implementation strategy.`
  );

  if (detectedRoles.length > 0) {
    for (const item of detectedRoles) {
      if (item.roleId === 'frontend') {
        addStep(
          'frontend',
          `Implement User Interface & Client State`,
          `Build responsive, modern UI components, layout, and client state management for: "${goal}". Adhere to established project styling.`
        );
      } else if (item.roleId === 'database') {
        addStep(
          'database',
          `Design & Update Persistence Schema`,
          `Create or update required database models, migrations, or persistence schemas for: "${goal}". Ensure data integrity and export clear models.`
        );
      } else if (item.roleId === 'backend') {
        addStep(
          'backend',
          `Implement Core Business Logic & Endpoints`,
          `Implement backend services, controller logic, and API endpoints for: "${goal}". Adhere to research specs and database models.`
        );
      } else if (item.roleId === 'authentication') {
        addStep(
          'authentication',
          `Implement Authentication & Security Layer`,
          `Implement secure token/session handling, encryption, and authorization guardrails for: "${goal}".`
        );
      } else if (item.roleId === 'devops') {
        addStep(
          'devops',
          `Configure Deployment & Environment`,
          `Create or update container configurations, environment variables, and build automation for: "${goal}".`
        );
      } else if (item.roleId === 'docs') {
        addStep(
          'docs',
          `Document Architecture & APIs`,
          `Write comprehensive documentation, setup instructions, and API contract specifications for: "${goal}".`
        );
      } else if (item.roleId === 'testing') {
        addStep(
          'testing',
          `Validate Implementation & Verification`,
          `Write unit or integration tests, verify compilation, and ensure 0 regression errors for: "${goal}".`
        );
      }
    }
  } else {
    // Generic task fallback: Researcher -> Frontend -> Database -> Backend -> Testing
    addStep(
      'frontend',
      `Implement User Interface & Client State`,
      `Build responsive, modern UI components and integrate with backend endpoints for: "${goal}".`
    );
    addStep(
      'database',
      `Design & Update Persistence Schema`,
      `Create or update required database schemas and data models for: "${goal}".`
    );
    addStep(
      'backend',
      `Implement Core Business Logic & Endpoints`,
      `Implement backend services, controller logic, and API endpoints for: "${goal}".`
    );
  }

  // Ensure testing is included at the end if not already added
  if (!steps.some((s) => s.roleId === 'testing') && !g.includes('no test')) {
    addStep(
      'testing',
      `Validate Implementation & Verification`,
      `Write unit tests, verify compilation with build scripts, and ensure 0 regression errors for: "${goal}".`
    );
  }

  return steps;
}

function setVoiceConn(state: 'connecting' | 'connected' | 'disconnected' | 'error', message?: string): void {
  if (!voiceConnBar) return;
  if (!voiceActive) {
    voiceConnBar.hide();
    return;
  }
  if (state === 'connected') {
    voiceConnBar.text = '$(radio-tower) Live';
    voiceConnBar.tooltip = 'Voice channel is live — press Talk and speak (click to manage connection)';
    voiceConnBar.color = new vscode.ThemeColor('charts.green');
  } else if (state === 'connecting') {
    voiceConnBar.text = '$(sync~spin) voice…';
    voiceConnBar.tooltip = message ?? 'Connecting to Gemini Live…';
    voiceConnBar.color = new vscode.ThemeColor('charts.yellow');
  } else if (state === 'error') {
    voiceConnBar.text = '$(sync~spin) retrying…';
    voiceConnBar.tooltip = `${message ?? 'Voice channel error'} — auto-reconnecting… (click to reconnect now)`;
    voiceConnBar.color = new vscode.ThemeColor('charts.yellow');
  } else {
    voiceConnBar.text = '$(sync~spin) reconnecting…';
    voiceConnBar.tooltip = `${message ?? 'Voice channel reconnecting'} — auto-reconnecting… (click to reconnect now)`;
    voiceConnBar.color = new vscode.ThemeColor('charts.yellow');
  }
  voiceConnBar.show();
}

function setBusy(on: boolean, note: string): void {
  busyDepth = Math.max(0, busyDepth + (on ? 1 : -1));
  if (busyDepth > 0) {
    busyBar.text = `$(sync~spin) ${note}`;
    busyBar.tooltip = '9 Router agent is working…';
    busyBar.show();
  } else {
    busyDepth = 0;
    busyBar.hide();
  }
}

function settings(): { baseUrl: string; apiKey?: string } {
  const cfg = vscode.workspace.getConfiguration('antigravity.router');
  const baseUrl = (cfg.get<string>('baseUrl') ?? 'http://127.0.0.1:20128/v1').trim();
  const apiKey = (cfg.get<string>('apiKey') ?? '').trim();
  return { baseUrl, apiKey: apiKey || undefined };
}

function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '****';
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

export function getGeminiApiKeys(context?: vscode.ExtensionContext): string[] {
  const keys: string[] = [];
  const cfg = vscode.workspace.getConfiguration('antigravity.voice');
  const cfgKeys = cfg.get<string>('geminiApiKeys') || '';
  for (const part of cfgKeys.split(/[,\n]/)) {
    const k = part.trim();
    if (k && !keys.includes(k)) keys.push(k);
  }
  const ctx = context || statusBarContext;
  if (ctx) {
    const stored = ctx.globalState.get<string[]>('antigravity.voice.geminiApiKeys');
    if (Array.isArray(stored)) {
      for (const k of stored) {
        const trimmed = (k || '').trim();
        if (trimmed && !keys.includes(trimmed)) keys.push(trimmed);
      }
    }
  }
  return keys;
}

export async function saveGeminiApiKeys(context: vscode.ExtensionContext, keys: string[]): Promise<void> {
  const cleanKeys = keys.map((k) => k.trim()).filter(Boolean);
  await context.globalState.update('antigravity.voice.geminiApiKeys', cleanKeys);
  const cfg = vscode.workspace.getConfiguration('antigravity.voice');
  await cfg.update('geminiApiKeys', cleanKeys.join(', '), vscode.ConfigurationTarget.Global);
}

export async function configureGeminiApiKeys(context: vscode.ExtensionContext): Promise<void> {
  const keys = getGeminiApiKeys(context);
  const items: (vscode.QuickPickItem & { action: string; keyIndex?: number })[] = [];

  if (keys.length > 0) {
    keys.forEach((k, idx) => {
      items.push({
        label: `$(key) Key #${idx + 1}: ${maskApiKey(k)}`,
        description: idx === 0 ? 'Primary (Default)' : `Fallback #${idx}`,
        detail: 'Click to manage or remove this key',
        action: 'inspectKey',
        keyIndex: idx
      });
    });
  } else {
    items.push({
      label: '$(warning) No Gemini API keys configured',
      description: 'Voice mode requires at least one Gemini API key',
      action: 'add'
    });
  }

  items.push(
    {
      label: '$(add) Add a Gemini API key',
      description: 'Appends a new key for quota fallback',
      action: 'add'
    },
    {
      label: '$(edit) Edit all API keys',
      description: 'Enter comma-separated or newline-separated Gemini API keys',
      action: 'editAll'
    }
  );

  if (keys.length > 0) {
    items.push({
      label: '$(trash) Clear all Gemini API keys',
      description: 'Remove all saved voice mode API keys',
      action: 'clear'
    });
  }

  const sel = await vscode.window.showQuickPick(items, {
    title: 'Configure Gemini API Keys for Voice Mode',
    placeHolder: 'Select an action or API key to manage'
  });

  if (!sel) return;

  if (sel.action === 'add') {
    const raw = await vscode.window.showInputBox({
      title: 'Add Gemini API Key',
      prompt: 'Enter Gemini API key (starts with AIza...):',
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) => (!v.trim() ? 'API key cannot be empty' : null)
    });
    if (raw && raw.trim()) {
      const updated = [...keys, raw.trim()];
      await saveGeminiApiKeys(context, updated);
      vscode.window.showInformationMessage(`Added Gemini API key (${maskApiKey(raw.trim())}). Total keys: ${updated.length}`);
    }
  } else if (sel.action === 'editAll') {
    const raw = await vscode.window.showInputBox({
      title: 'Edit Gemini API Keys',
      prompt: 'Enter one or more comma-separated Gemini API keys (for quota fallback):',
      value: keys.join(', '),
      ignoreFocusOut: true
    });
    if (raw !== undefined) {
      const parts = raw
        .split(/[,\n]/)
        .map((k) => k.trim())
        .filter(Boolean);
      await saveGeminiApiKeys(context, parts);
      vscode.window.showInformationMessage(`Saved ${parts.length} Gemini API key(s) for Voice Mode.`);
    }
  } else if (sel.action === 'clear') {
    const confirm = await vscode.window.showWarningMessage(
      'Are you sure you want to remove all saved Gemini API keys for Voice Mode?',
      { modal: true },
      'Clear all'
    );
    if (confirm === 'Clear all') {
      await saveGeminiApiKeys(context, []);
      vscode.window.showInformationMessage('All Gemini API keys for Voice Mode cleared.');
    }
  } else if (sel.action === 'inspectKey' && typeof sel.keyIndex === 'number') {
    const idx = sel.keyIndex;
    const key = keys[idx];
    const subSel = await vscode.window.showQuickPick(
      [
        { label: '$(trash) Remove this key', action: 'delete' },
        ...(idx > 0 ? [{ label: '$(arrow-up) Make primary (first)', action: 'makePrimary' }] : [])
      ],
      { title: `Key #${idx + 1}: ${maskApiKey(key)}` }
    );
    if (subSel?.action === 'delete') {
      const updated = keys.filter((_, i) => i !== idx);
      await saveGeminiApiKeys(context, updated);
      vscode.window.showInformationMessage(`Removed Key #${idx + 1}. Remaining keys: ${updated.length}`);
    } else if (subSel?.action === 'makePrimary') {
      const updated = [key, ...keys.filter((_, i) => i !== idx)];
      await saveGeminiApiKeys(context, updated);
      vscode.window.showInformationMessage(`Key #${idx + 1} is now the primary key.`);
    }
  }
}

function voiceSettings(): { liveModel: string; ttsVoice: string; inputDevice?: string; echoCancellation: boolean; echoDelayMs: number } {
  const cfg = vscode.workspace.getConfiguration('antigravity.voice');
  const dev = (cfg.get<string>('inputDevice') ?? '').trim();
  return {
    liveModel: cfg.get<string>('liveModel') || voice.VOICE_DEFAULT_LIVE_MODEL,
    ttsVoice: cfg.get<string>('ttsVoice') || voice.VOICE_DEFAULT_VOICE,
    inputDevice: dev || undefined,
    echoCancellation: cfg.get<boolean>('echoCancellation') ?? true,
    echoDelayMs: cfg.get<number>('echoDelayMs') ?? 120
  };
}

function refreshVoiceBars(): void {
  voiceBtn.text = voiceTalking ? '$(record) Talking…' : '$(mic) Talk';
  voiceBtn.tooltip = voiceActive
    ? voiceTalking
      ? 'Click to stop sending your mic audio'
      : 'Click to start sending your mic audio (16 kHz PCM → Gemini Live)'
    : 'Voice conversation is off';
  muteBtn.text = voiceMuted ? '$(mute) Muted' : '$(unmute) Mic on';
  muteBtn.tooltip = voiceMuted ? 'Unmute your mic' : 'Mute your mic (audio is not sent)';
}

let lastRecordedAudioPath: string | undefined;

async function toggleVoiceMode(context: vscode.ExtensionContext, catalog: ModelInfo[]): Promise<void> {
  voiceActive = !voiceActive;
  if (!voiceActive) {
    if (liveCall) {
      liveCall.stop();
      liveCall = undefined;
    }
    voiceTalking = false;
    voiceMuted = false;
    voiceTextOpen = false;
    voiceLastFrom = undefined;
    voiceBtn.hide();
    muteBtn.hide();
    if (voiceConnBar) voiceConnBar.hide();
    if (chatOutput) chatOutput.appendLine('— voice conversation ended —');
    SessionManager.getInstance().flushSync();
    return;
  }

  const vs = voiceSettings();
  const soxBin = voice.resolveSox();
  const ffplay = voice.resolveFfplay();
  if (!soxBin) {
    voiceActive = false;
    vscode.window.showErrorMessage('Voice needs sox — install it or set antigravity.voice.soxPath.');
    return;
  }

  let keys = getGeminiApiKeys(context);
  if (keys.length === 0) {
    const entered = await vscode.window.showInputBox({
      title: 'Gemini Live API Key (Voice Mode)',
      prompt: 'Enter your Gemini API key (or multiple comma-separated keys for auto-fallback):',
      placeHolder: 'AIzaSy..., AIzaSy...',
      ignoreFocusOut: true,
      password: true,
      validateInput: (v) => (!v.trim() ? 'Please provide a valid Gemini API key' : null)
    });
    if (!entered || !entered.trim()) {
      voiceActive = false;
      vscode.window.showWarningMessage('Voice Mode requires a Gemini API key.');
      return;
    }
    const parts = entered
      .split(/[,\n]/)
      .map((k) => k.trim())
      .filter(Boolean);
    await saveGeminiApiKeys(context, parts);
    keys = parts;
    vscode.window.showInformationMessage(`Saved ${keys.length} Gemini API key(s) permanently for Voice Mode.`);
  }

  if (!chatOutput) chatOutput = vscode.window.createOutputChannel('9 Router');
  chatOutput.show(true);
  chatOutput.appendLine('');

  const opts = readSessionOptions();
  const model = vs.liveModel;
  const vRoots = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0)
    ? vscode.workspace.workspaceFolders.map((f) => f.uri.fsPath)
    : [process.cwd()];
  chatOutput.appendLine('— voice conversation (direct Gemini Live WebSocket) —');
  chatOutput.appendLine(`live model: ${model}`);
  chatOutput.appendLine(`voice: ${vs.ttsVoice} · temp ${opts.temperature} · max tokens ${opts.maxTokens ?? 'default'}`);
  chatOutput.appendLine(`channel: direct Gemini Live WSS (generativelanguage.googleapis.com)`);
  chatOutput.appendLine(`api keys: ${keys.length} configured (Active: ${maskApiKey(keys[0])})${keys.length > 1 ? ' · automatic quota fallback active' : ''}`);
  chatOutput.appendLine(`sox: ${soxBin}`);
  chatOutput.appendLine(`ffplay: ${ffplay ? 'found (raw 24 kHz PCM playback)' : 'NOT FOUND — no audio output'}`);
  const micDev = voice.resolveMicDevice(vs.inputDevice);
  chatOutput.appendLine(`echo cancellation: ${vs.echoCancellation ? 'AEC3 in-process (removes the AI repeating its own words)' : 'off'}`);
  chatOutput.appendLine(`mic device: ${micDev.device}${micDev.note ? ` — ${micDev.note}` : ''}`);
  if (micDev.device === 'default' && !micDev.note) {
    chatOutput.appendLine('NOTE: if the AI keeps repeating your/its own words, the Windows DEFAULT recording device is usually a speaker-mic loop. Set antigravity.voice.inputDevice to a real microphone (run "9 Router: Voice: List audio devices").');
  }
  chatOutput.appendLine('click the status-bar mic to talk, click again to listen; the model replies by voice in real time.');
  chatOutput.appendLine('');

  voiceTextOpen = false;
  const createdFiles: string[] = [];
  let aiTurnBuf = '';
  let aiDebounceTimer: NodeJS.Timeout | undefined;

  const isCompleteToolBlock = (content: string): boolean => {
    return (
      /<antigravity:[a-z_]+[\s\S]*?(?:\/>|<\/antigravity:[a-z_]+>)/i.test(content) ||
      /\*\*END TOOL\*\*/i.test(content) ||
      /(?:^|\n)\s*(?:\*\*)?TOOL:\s*(read|list|open|fetch|question|shell)/i.test(content)
    );
  };

  const flushAiTools = (force: boolean = false) => {
    if (aiDebounceTimer) {
      clearTimeout(aiDebounceTimer);
      aiDebounceTimer = undefined;
    }
    const turnText = aiTurnBuf;
    if (turnText.trim() && hasToolBlocks(turnText)) {
      if (force || isCompleteToolBlock(turnText)) {
        aiTurnBuf = '';
        void executeVoiceTools(turnText, vRoots, opts, createdFiles, chatOutput);
      }
    }
  };

  const ideContext = getWorkspaceContext();
  const orchToolNames = new Set(ORCHESTRATION_TOOL_DECLARATIONS.map((t) => t.name));

  const resumeContext = SessionManager.getInstance().getResumeContext();
  let voiceSystemPrompt = (opts.systemPrompt ? opts.systemPrompt + '\n\n' : '') + voiceAgentSystem(vRoots, ideContext);
  if (resumeContext) {
    voiceSystemPrompt += `\n\n${resumeContext}`;
  }

  liveCall = voice.startLiveConversation(
    keys,
    {
      model,
      systemPrompt: voiceSystemPrompt,
      voice: vs.ttsVoice,
      temperature: opts.temperature ?? 0.5,
      maxTokens: opts.maxTokens,
      tools: [
        ...ANTIGRAVITY_TOOLS.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters
        })),
        ...ORCHESTRATION_TOOL_DECLARATIONS
      ]
    },
    {
      onToolCall: async (calls) => {
        if (!chatOutput) return;
        chatOutput.appendLine('');
        chatOutput.appendLine(`[agent] Gemini Live requested ${calls.length} tool call(s) (silent background execution):`);

        const orchCalls = calls.filter((c) => orchToolNames.has(c.name));
        const standardCalls = calls.filter((c) => !orchToolNames.has(c.name));

        if (orchCalls.some((c) => c.name === 'orchestrate_task' || c.name === 'configure_role_models' || c.name === 'auto_assign_best_models')) {
          WorkflowWebviewPanel.createOrShow(context.extensionUri, context, orchestrator, catalog);
          if (orchCalls.some((c) => c.name === 'orchestrate_task')) {
            WorkflowWebviewPanel.currentPanel?.switchTab('workflow');
          }
        }

        const hasRunCmd = standardCalls.some((c) => c.name === 'run_command' || c.name === 'shell');
        const hasEdits = standardCalls.some((c) => c.name === 'replace_file_content' || c.name === 'write_to_file' || c.name === 'multi_replace_file_content');
        const statusMsg = orchCalls.length
          ? (orchCalls.some((c) => c.name === 'auto_assign_best_models')
              ? 'Voice AI auto-assigning best 9 Router models for all roles…'
              : orchCalls.some((c) => c.name === 'configure_role_models')
              ? 'Voice AI configuring role models…'
              : orchCalls.some((c) => c.name === 'list_roles' || c.name === 'list_router_models')
              ? 'Voice AI inspecting 9 Router roles & models…'
              : 'Voice AI orchestrating serial tasks…')
          : hasRunCmd
          ? 'Voice AI compiling / running command…'
          : hasEdits
          ? 'Voice AI editing files…'
          : 'Voice AI inspecting project…';
        setBusy(true, statusMsg);
        liveCall?.setToolsExecuting(true);

        const policy = { allowShell: opts.allowShell, allowVscode: opts.allowVscode, allowFiles: opts.allowFiles, allowWeb: opts.allowWeb };
        const nativeCalls: NativeToolCall[] = standardCalls.map((c) => ({
          id: c.id,
          name: c.name,
          arguments: c.args || {}
        }));

        let standardResults: any[] = [];
        try {
          if (nativeCalls.length > 0) {
            standardResults = await executeTools('', vRoots, policy, nativeCalls);
          }
        } catch (err) {
          standardResults = standardCalls.map(() => ({ tool: 'unknown', args: '', output: `[error] ${err instanceof Error ? err.message : String(err)}` }));
        }

        const orchResultsMap = new Map<string, any>();
        for (const oc of orchCalls) {
          try {
            const res = await voiceBridge.handleToolCall(oc.name, oc.args || {});
            orchResultsMap.set(oc.id, res);
          } catch (err) {
            orchResultsMap.set(oc.id, { error: err instanceof Error ? err.message : String(err) });
          }
        }

        setBusy(false, 'Voice AI ready');

        let stdIdx = 0;
        const responses = calls.map((c) => {
          chatOutput.appendLine(`[agent] -> ${c.name}(${JSON.stringify(c.args)}):`);
          if (orchToolNames.has(c.name)) {
            const orchRes = orchResultsMap.get(c.id) || { status: 'done' };
            chatOutput.appendLine(JSON.stringify(orchRes, null, 2));
            return {
              id: c.id,
              name: c.name,
              response: {
                output: JSON.stringify(orchRes),
                instruction: 'Orchestration updated. All activity is shown in user output window. Do NOT recite raw tool blocks over audio. Provide natural conversational update.'
              }
            };
          } else {
            const r = standardResults[stdIdx++];
            if (r) {
              chatOutput.appendLine(r.output.split('\n').slice(0, 30).join('\n'));
              if ((r.tool === 'file' || r.tool === 'write_to_file') && r.output.startsWith('created')) {
                const match = r.output.match(/^created\s+(.+?)(?:\s+\(|$)/);
                createdFiles.push(match ? match[1].trim() : r.output.slice('created '.length).trim());
              }
            }
            return {
              id: c.id,
              name: c.name,
              response: {
                output: r ? r.output : '[done]',
                instruction: 'All activity is shown in user output window. Do NOT speak or read aloud this activity output over audio. Continue silently or speak your final answer only.'
              }
            };
          }
        });

        chatOutput.appendLine('[agent] returning tool results to Gemini Live WebSocket…');
        liveCall?.sendToolResponse(responses);

        if (createdFiles.length) {
          const pick = await vscode.window.showInformationMessage(`Voice-created file(s): ${createdFiles.join(', ')}`, 'Open file');
          if (pick === 'Open file') {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(createdFiles[0]));
            await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
          }
        }
      },
      onText: (text, turnComplete, from) => {
        WorkflowWebviewPanel.currentPanel?.appendVoiceTurn(text, turnComplete, from);
        if (!WorkflowWebviewPanel.currentPanel && turnComplete && (aiTurnBuf.trim() || from === 'user')) {
          SessionManager.getInstance().appendVoiceTurn(aiTurnBuf.trim() || text, from ?? 'ai');
        }
        if (!chatOutput) return;
        if (turnComplete) {
          liveCall?.setToolsExecuting(false);
          flushAiTools(true);
          aiTurnBuf = '';
          chatOutput.appendLine('');
          voiceTextOpen = false;
          voiceLastFrom = undefined;
          return;
        }
        const speaker = from ?? 'ai';
        if (speaker !== voiceLastFrom) {
          if (voiceLastFrom === 'ai') {
            flushAiTools(true);
          }
          if (voiceTextOpen) chatOutput.appendLine('');
          chatOutput.appendLine(speaker === 'user' ? 'You: ' : 'AI: ');
          voiceTextOpen = true;
          voiceLastFrom = speaker;
        }
        if (from === 'ai') {
          aiTurnBuf += text;
          if (aiDebounceTimer) clearTimeout(aiDebounceTimer);
          aiDebounceTimer = setTimeout(() => {
            flushAiTools(false);
          }, 1200);
        }
        chatOutput.append(text);
      },
      onInterrupted: () => {
        WorkflowWebviewPanel.currentPanel?.appendVoiceTurn(' [interrupted]', true, 'ai');
        if (aiTurnBuf.trim()) {
          SessionManager.getInstance().appendVoiceTurn(aiTurnBuf.trim() + ' [interrupted]', 'ai');
        }
        liveCall?.setToolsExecuting(false);
        flushAiTools(true);
        aiTurnBuf = '';
        if (chatOutput) {
          chatOutput.appendLine('');
          chatOutput.appendLine('[voice] ⚡ AI interrupted by user — listening to your statement...');
          voiceTextOpen = false;
          voiceLastFrom = undefined;
        }
        setBusy(false, 'Voice: Listening (AI interrupted)');
      },
      onStatus: (state, message) => {
        if (state !== 'log') setVoiceConn(state, message);
        if (!chatOutput) return;
        if (state === 'connected') {
          voiceTalking = true;
          liveCall?.setTalking(true);
          refreshVoiceBars();
          WorkflowWebviewPanel.currentPanel?.sendState();
          chatOutput.appendLine(`[voice] live connected (${message ?? 'ready'}) — mic is open and listening; speak anytime.`);
        } else if (state === 'connecting') {
          chatOutput.appendLine(`[voice] ${message ?? 'connecting to Gemini Live…'}`);
        } else if (state === 'error') {
          chatOutput.appendLine(`[voice] [error] ${message ?? 'unknown'}`);
        } else if (state === 'log') {
          chatOutput.appendLine(`[voice] ${message ?? ''}`);
        } else {
          chatOutput.appendLine(`[voice] ${message ?? 'channel closed'}`);
        }
      },
      onKeyFallback: (keyIdx, total, reason) => {
        if (chatOutput) {
          chatOutput.appendLine(`[voice] Key fallback triggered: ${reason}`);
          chatOutput.appendLine(`[voice] Switched to Key #${keyIdx + 1}/${total}`);
        }
        vscode.window.showWarningMessage(`Voice mode: Switched to fallback Gemini API Key #${keyIdx + 1} (${reason})`);
      },
      onAudioFile: (filePath, format, wavPath) => {
        lastRecordedAudioPath = filePath;
        if (chatOutput) {
          chatOutput.appendLine(`[audio] Saved voice response (${format.toUpperCase()}): ${filePath}`);
        }
        WorkflowWebviewPanel.currentPanel?.onAudioFileSaved(filePath, format);
      }
    },
    soxBin,
    ffplay,
    micDev.device,
    vs.echoCancellation,
    vs.echoDelayMs,
    voice.getRecordingsDir(),
    voice.resolveFfmpeg()
  );

  voiceBtn.show();
  muteBtn.show();
  setVoiceConn('connecting', 'opening channel…');
  voiceTalking = true;
  voiceMuted = false;
  refreshVoiceBars();
}

async function executeVoiceTools(
  text: string,
  roots: string[],
  opts: SessionOptions,
  createdFiles: string[],
  out: vscode.OutputChannel
): Promise<void> {
  out.appendLine('');
  out.appendLine('[agent] executing tool blocks spoken in this turn…');
  setBusy(true, 'Voice AI working…');
  liveCall?.setToolsExecuting(true);
  const results = await executeTools(text, roots, {
    allowShell: opts.allowShell,
    allowVscode: opts.allowVscode,
    allowFiles: opts.allowFiles,
    allowWeb: opts.allowWeb
  });
  setBusy(false, 'Voice AI working…');
  if (results.length === 0) {
    out.appendLine('[agent] (tool block detected but no valid tool command parsed)');
  }
  for (const r of results) {
    out.appendLine(`[agent] ${r.tool}: ${r.args}`);
    out.appendLine(r.output.split('\n').slice(0, 40).join('\n'));
    if ((r.tool === 'file' || r.tool === 'write_to_file') && r.output.startsWith('created')) {
      const match = r.output.match(/^created\s+(.+?)(?:\s+\(|$)/);
      createdFiles.push(match ? match[1].trim() : r.output.slice('created '.length).trim());
    }
  }
  if (results.length > 0 && liveCall) {
    const feed = results
      .map((r) => `<antigravity:tool_result tool="${r.tool}" args="${r.args}">\n${r.output}\n</antigravity:tool_result>`)
      .join('\n') + '\n\n[All activity shown in user output console. Do NOT speak or read aloud this activity output over audio. Speak only your final conversational reply.]';
    out.appendLine('[agent] returning tool results to Gemini Live…');
    liveCall.sendText(feed);
  }
  if (createdFiles.length) {
    const pick = await vscode.window.showInformationMessage(`Voice-created file(s): ${createdFiles.join(', ')}`, 'Open file');
    if (pick === 'Open file') {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(createdFiles[0]));
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    }
  }
}

async function voiceTalkToggle(): Promise<void> {
  if (!voiceActive || !liveCall) return;
  voiceTalking = !voiceTalking;
  liveCall.setTalking(voiceTalking);
  refreshVoiceBars();
  WorkflowWebviewPanel.currentPanel?.sendState();
}

async function voiceMuteToggle(): Promise<void> {
  voiceMuted = !voiceMuted;
  if (liveCall) liveCall.setMuted(voiceMuted);
  refreshVoiceBars();
  WorkflowWebviewPanel.currentPanel?.sendState();
}

async function voiceInterrupt(): Promise<void> {
  if (!voiceActive || !liveCall) return;
  liveCall.interrupt();
  if (chatOutput) chatOutput.appendLine('[voice] ⚡ AI interrupted by user — listening to your statement...');
  vscode.window.showInformationMessage('Voice AI interrupted.');
}

async function voiceConnClick(context: vscode.ExtensionContext, catalog: ModelInfo[]): Promise<void> {
  if (!voiceActive || !liveCall) {
    await toggleVoiceMode(context, catalog);
    return;
  }
  const vs = voiceSettings();
  const keys = getGeminiApiKeys(context);
  const activeIdx = liveCall ? liveCall.activeKeyIndex : 0;
  const choice = await vscode.window.showQuickPick(
    [
      { label: '$(stop) Interrupt Voice AI', description: 'Instantly cut AI speech and listen to your statement', value: 'interrupt' as const },
      { label: '$(radio-tower) Select model for Live session', description: `Current: ${vs.liveModel}`, value: 'pickLive' as const },
      { label: '$(key) Configure Gemini API Keys', description: `${keys.length} key(s) configured (Active: Key #${activeIdx + 1})`, value: 'keys' as const },
      { label: '$(sync) Reconnect voice channel', description: 'Force an immediate reconnect to Gemini Live', value: 'reconnect' as const },
      { label: '$(mic) Check mic level', description: 'Capture 2s and report RMS vs. the noise gate', value: 'micLevel' as const },
      { label: '$(folder) Open Audio Recordings Folder', description: 'View and copy all saved WAV & MP3 audio files', value: 'recordings' as const },
      { label: '$(clippy) Copy Latest Audio File Path', description: 'Copy path of the latest audio file to clipboard for other platforms', value: 'copyAudio' as const },
      { label: '$(close) End voice conversation', description: 'Disconnect and close voice mode', value: 'end' as const }
    ],
    { placeHolder: 'Voice channel status & options' }
  );
  if (choice?.value === 'interrupt') {
    await voiceInterrupt();
  } else if (choice?.value === 'pickLive') {
    await pickLiveModel(context, catalog);
  } else if (choice?.value === 'keys') {
    await configureGeminiApiKeys(context);
  } else if (choice?.value === 'reconnect') {
    liveCall.reconnect();
    vscode.window.showInformationMessage('Reconnecting voice channel to Gemini Live…');
  } else if (choice?.value === 'micLevel') {
    await checkMicLevel();
  } else if (choice?.value === 'recordings') {
    await openRecordingsFolder();
  } else if (choice?.value === 'copyAudio') {
    await copyLatestAudioPath();
  } else if (choice?.value === 'end') {
    await toggleVoiceMode(context, catalog);
  }
}

function listAudioDevices(): void {
  if (!chatOutput) chatOutput = vscode.window.createOutputChannel('9 Router');
  chatOutput.show(true);
  chatOutput.appendLine('[audio] capture endpoints (what sox can actually open):');
  const endpoints = voice.listMicEndpoints();
  if (endpoints.length) {
    for (const n of endpoints) {
      const tag = voice.LOOPBACK_PATTERNS.test(n) ? '  <- loopback (STAY AWAY)' : '';
      chatOutput.appendLine(`  ${n}${tag}`);
    }
  } else {
    chatOutput.appendLine('  (none found via registry)');
  }
  chatOutput.appendLine('[audio] fallback: Windows-sound devices (may include renderers/adapters):');
  cp.exec(
    'powershell -NoProfile -Command "Get-CimInstance Win32_SoundDevice | Select-Object -ExpandProperty Name | Sort-Object -Unique"',
    { timeout: 15000 },
    (err, stdout) => {
      const names = (stdout || '')
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (!names.length) {
        chatOutput.appendLine(`  none${err ? ` (${err.message})` : ''}`)
      } else {
        names.forEach((n) => chatOutput.appendLine(`  ${n}`));
      }
      chatOutput.appendLine('Set antigravity.voice.inputDevice to the exact microphone name (a JSON array also works: ["Microphone Array", "Microphone (Realtek Audio)"]).');
    }
  );
}

async function openRecordingsFolder(): Promise<void> {
  const dir = voice.getRecordingsDir();
  await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(dir));
}

async function copyLatestAudioPath(): Promise<void> {
  const dir = voice.getRecordingsDir();
  const file = lastRecordedAudioPath || voice.getLatestRecording(dir);
  if (file && fs.existsSync(file)) {
    await vscode.env.clipboard.writeText(file);
    const pick = await vscode.window.showInformationMessage(`Copied audio path to clipboard: ${path.basename(file)}`, 'Reveal in File Explorer');
    if (pick === 'Reveal in File Explorer') {
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(file));
    }
  } else {
    vscode.window.showWarningMessage(`No recordings found yet in ${dir}. Speak in Voice Mode to record.`);
  }
}

async function checkMicLevel(): Promise<void> {
  const soxBin = voice.resolveSox();
  if (!soxBin) {
    void vscode.window.showErrorMessage('sox not found — cannot test the microphone');
    return;
  }
  const vs = voiceSettings();
  const resolved = voice.resolveMicDevice(vs.inputDevice);
  const dev = resolved.device;
  if (!chatOutput) chatOutput = vscode.window.createOutputChannel('9 Router');
  chatOutput.show(true);
  chatOutput.appendLine(`[mic] device: ${dev}${resolved.note ? ` — ${resolved.note}` : ''}`);
  chatOutput.appendLine(`[mic] opening '${dev}' for 2 seconds — speak now…`);
  const tmp = path.join(os.tmpdir(), `antigravity-mic-${Date.now()}.raw`);
  await new Promise<void>((resolve) => {
    const c = cp.spawn(
      soxBin,
      ['-t', 'waveaudio', dev, '-r', '16000', '-c', '1', '-e', 'signed-integer', '-b', '16', '-t', 'raw', tmp, 'trim', '0', '2'],
      { windowsHide: true }
    );
    c.once('error', () => resolve());
    c.once('close', () => resolve());
  });
  let peak = 0;
  let sum = 0;
  let n = 0;
  let above = 0;
  try {
    const b = fs.readFileSync(tmp);
    for (let i = 0; i + 1 < b.length; i += 2) {
      const a = Math.abs(b.readInt16LE(i));
      sum += a * a;
      n++;
      if (a > peak) peak = a;
      if (a > 80) above++;
    }
  } catch {
    /* capture failed — stays empty */
  }
  try {
    fs.unlinkSync(tmp);
  } catch {
    /* ok */
  }
  const rms = n ? Math.round(Math.sqrt(sum / n)) : 0;
  const verdict =
    rms >= 300
      ? 'good — the gate will pass your speech'
      : rms >= 100
        ? 'low but usable — auto gate still passes it'
        : 'SILENT — your voice is not reaching this device (RMS near zero). This usually means the wrong capture device: set antigravity.voice.inputDevice to your real microphone name from "Voice: List audio devices".';
  chatOutput.appendLine(`[mic] RMS ${rms}, peak ${peak}, samples above gate floor ${above}/${n}`);
  chatOutput.appendLine(`[mic] verdict: ${verdict}`);
  void vscode.window.showInformationMessage(`Mic '${dev}': RMS ${rms} (peak ${peak}) — ${verdict}`);
}

function filterLiveOn(): boolean {
  return vscode.workspace.getConfiguration('antigravity.models').get<boolean>('filterLive') !== false;
}

async function toggleLiveFilter(): Promise<void> {
  const next = !filterLiveOn();
  await vscode.workspace
    .getConfiguration('antigravity.models')
    .update('filterLive', next, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(
    next
      ? '9 Router: live/voice conversation models will be hidden from the picker.'
      : '9 Router: live/voice conversation models will be shown in the picker.'
  );
}

function describe(m: ModelInfo): string {
  const bits: string[] = [];
  if (m.caps.contextWindow) bits.push(`${Math.round(m.caps.contextWindow / 1000)}k ctx`);
  if (m.caps.maxOutput) bits.push(`${Math.round(m.caps.maxOutput / 1000)}k out`);
  const flags = ['vision', 'audioInput', 'videoInput', 'pdf', 'imageOutput', 'audioOutput', 'search', 'tools', 'reasoning']
    .filter((k) => (m.caps as Record<string, boolean | undefined>)[k]);
  if (flags.length) bits.push(flags.join(','));
  return bits.join(' · ') || m.provider;
}

export function isVoiceActive(): boolean {
  return voiceActive;
}

export function isVoiceTalking(): boolean {
  return voiceTalking;
}

export function isVoiceMuted(): boolean {
  return voiceMuted;
}

export function refreshStatusBar(): void {
  const selected = statusBarContext?.workspaceState?.get<string>('antigravity.models.selected');
  if (statusBar) {
    if (selected) {
      statusBar.text = `$(gather) 9 Router · ${selected}`;
      statusBar.tooltip = `Selected model: ${selected}\nClick to open 9 Router Control Center & Orchestrator`;
    } else {
      statusBar.text = '$(gather) 9 Router';
      statusBar.tooltip = '9 Router — click to open Control Center & Orchestrator';
    }
  }
  if (chatBtn) {
    if (selected) {
      chatBtn.text = `$(comment-discussion) Chat: ${selected}`;
      chatBtn.tooltip = `Chat with ${selected} in Normal Text Mode (9 Router Chat Console)`;
    } else {
      chatBtn.text = '$(comment-discussion) Chat with Model';
      chatBtn.tooltip = 'Open 9 Router Chat Console (Normal Text Mode & Pipeline)';
    }
  }
}

let statusBarContext: vscode.ExtensionContext;

async function pickModel(context: vscode.ExtensionContext, catalog?: ModelInfo[]): Promise<void> {
  const { baseUrl, apiKey } = settings();
  const filterLive = vscode.workspace.getConfiguration('antigravity.models').get<boolean>('filterLive') !== false;
  statusBar.text = '$(sync~spin) 9 Router…';
  const router = await fetchRouterModels(baseUrl, apiKey);
  const baseCatalog = catalog && catalog.length > 0 ? catalog : UnifiedModelCatalog.getInstance().getModels();
  const merged = mergeModels(router.items, baseCatalog);
  if (router.online) {
    void UnifiedModelCatalog.getInstance().syncWithRouter(baseUrl, apiKey, true);
  }
  const hidden = filterLive ? merged.filter((m) => m.live).length : 0;
  const items = filterLive ? merged.filter((m) => !m.live) : merged;
  if (statusBarContext) refreshStatusBar();

  const picked = context.workspaceState.get<string>('antigravity.models.selected');
  const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { model: ModelInfo }>();
  qp.title = router.online
    ? `9 Router Models — ${router.items.length} live / ${items.length} shown${hidden ? ` · ${hidden} voice/live hidden` : ''}`
    : `9 Router offline — showing ${items.length} of ${CATALOG_SIZE} catalog models${hidden ? ` · ${hidden} voice/live hidden` : ''}`;
  qp.placeholder = 'Type to filter models… (e.g. claude, gemini). Turn off "antigravity.models.filterLive" to browse voice/live models';
  qp.matchOnDescription = true;
  qp.matchOnDetail = true;
  qp.items = items.map((m) => ({
    label: (m.live ? '$(flame) ' : '') + m.id,
    description: m.source === 'router' ? 'router' : 'catalog',
    detail: describe(m),
    alwaysShow: !!picked && m.id === picked,
    model: m
  }));

  qp.onDidChangeSelection(async (sel) => {
    const m = sel[0]?.model;
    if (!m) return;
    await context.workspaceState.update('antigravity.models.selected', m.id);
    refreshStatusBar();
    const go = await vscode.window.showInformationMessage(`Model selected: ${m.id}`, 'Chat with Model');
    qp.dispose();
    if (go === 'Chat with Model') {
      WorkflowWebviewPanel.openChatWithSelectedModel(context.extensionUri, context, orchestrator, baseCatalog);
    }
  });
  qp.onDidHide(() => qp.dispose());
  qp.show();
}

async function pickLiveModel(context: vscode.ExtensionContext, catalog: ModelInfo[]): Promise<void> {
  const vs = voiceSettings();
  const liveModels = getBidiLiveModels();

  const currentId = vs.liveModel;
  const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { modelId: string }>();
  qp.title = 'Select Model for Live Session (BidiGenerateContent Voice & Text)';
  qp.placeholder = `Select a model supporting real-time voice-to-voice and simultaneous text (current: ${currentId})`;
  qp.matchOnDescription = true;
  qp.matchOnDetail = true;

  qp.items = liveModels.map((m) => {
    const isSelected = m.id === currentId;
    return {
      label: `${isSelected ? '$(check) ' : '$(radio-tower) '}${m.name}`,
      description: `[${m.id}] ${m.tag}${isSelected ? ' · CURRENT' : ''}`,
      detail: `${m.description} · Supports live voice-to-voice & simultaneous text (BidiGenerateContent)`,
      alwaysShow: isSelected,
      modelId: m.id
    };
  });

  qp.onDidChangeSelection(async (sel) => {
    const chosen = sel[0]?.modelId;
    if (!chosen) return;
    qp.dispose();

    const cfg = vscode.workspace.getConfiguration('antigravity.voice');
    await cfg.update('liveModel', chosen, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`9 Router: Live session model set to "${chosen}".`);

    if (chatOutput) {
      chatOutput.appendLine(`[voice] live session model set to: ${chosen} (BidiGenerateContent voice-to-voice & simultaneous text)`);
    }

    if (voiceActive && liveCall) {
      const act = await vscode.window.showInformationMessage(
        `Voice conversation is active. Restart session with "${chosen}" now?`,
        'Restart now',
        'Keep current'
      );
      if (act === 'Restart now') {
        await toggleVoiceMode(context, catalog);
        await toggleVoiceMode(context, catalog);
      }
    }
  });

  qp.onDidHide(() => qp.dispose());
  qp.show();
}

interface SessionOptions {
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  allowShell: boolean;
  allowVscode: boolean;
  allowFiles: boolean;
  allowWeb: boolean;
  maxTurns: number;
}

function readSessionOptions(): SessionOptions {
  const cfg = vscode.workspace.getConfiguration('antigravity.session');
  const num = (k: string): number | undefined => {
    const v = cfg.get<number>(k);
    return typeof v === 'number' ? v : undefined;
  };
  return {
    temperature: num('temperature'),
    maxTokens: num('maxTokens'),
    systemPrompt: cfg.get<string>('systemPrompt') || undefined,
    allowShell: cfg.get<boolean>('allowShell') !== false,
    allowVscode: cfg.get<boolean>('allowVscode') !== false,
    allowFiles: cfg.get<boolean>('allowFiles') !== false,
    allowWeb: cfg.get<boolean>('allowWeb') !== false,
    maxTurns: num('maxTurns') ?? 40
  };
}

async function configureSession(context: vscode.ExtensionContext): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('antigravity.session');
  const opts = readSessionOptions();

  const resumeOnOpen = cfg.get<boolean>('resumeOnOpen') !== false;
  const unifiedVoiceAndText = cfg.get<boolean>('unifiedVoiceAndText') !== false;
  const persistHistory = cfg.get<boolean>('persistHistory') !== false;

  const item = await vscode.window.showQuickPick(
    [
      { label: '$(history) Resume on open', description: resumeOnOpen ? 'enabled (starts where you closed)' : 'disabled (starts fresh)', value: 'resumeOnOpen' as const },
      { label: '$(sync) Unified Voice & Text', description: unifiedVoiceAndText ? 'enabled (shared context)' : 'disabled', value: 'unifiedVoiceAndText' as const },
      { label: '$(database) Persist history to disk', description: persistHistory ? 'enabled (.antigravity/sessions/)' : 'disabled', value: 'persistHistory' as const },
      { label: '$(add) Start New Session', description: 'Clear active conversation and start fresh', value: 'newSession' as const },
      { label: '$(trash) Clear All Sessions', description: 'Delete all saved session histories', value: 'clearSessions' as const },
      { label: '$(gear) Temperature', description: String(opts.temperature ?? '(unset)'), value: 'temperature' as const },
      { label: '$(gear) Max tokens', description: String(opts.maxTokens ?? '(unset)'), value: 'maxTokens' as const },
      { label: '$(comment) System prompt', description: opts.systemPrompt ? 'custom' : '(default agent rules)', value: 'systemPrompt' as const },
      { label: '$(terminal) Shell commands', description: opts.allowShell ? 'allowed' : 'blocked', value: 'allowShell' as const },
      { label: '$(extensions) VS Code commands', description: opts.allowVscode ? 'allowed' : 'blocked', value: 'allowVscode' as const },
      { label: '$(files) File access', description: opts.allowFiles ? 'allowed' : 'blocked', value: 'allowFiles' as const },
      { label: '$(globe) Web search & fetch', description: opts.allowWeb ? 'allowed' : 'blocked', value: 'allowWeb' as const },
      { label: '$(list-ordered) History turns', description: String(opts.maxTurns), value: 'maxTurns' as const }
    ],
    { placeHolder: '9 Router — session options' }
  );
  if (!item) return;

  const set = async (key: string, value: unknown): Promise<void> => {
    await cfg.update(key, value, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`9 Router session — ${key} set`);
  };

  switch (item.value) {
    case 'resumeOnOpen':
      await set('resumeOnOpen', !resumeOnOpen);
      break;
    case 'unifiedVoiceAndText':
      await set('unifiedVoiceAndText', !unifiedVoiceAndText);
      break;
    case 'persistHistory':
      await set('persistHistory', !persistHistory);
      break;
    case 'newSession': {
      const selected = context.workspaceState.get<string>('antigravity.models.selected') || 'ag/gemini-3.8-flash-high';
      const s = SessionManager.getInstance().createNewSession(selected);
      if (WorkflowWebviewPanel.currentPanel) {
        WorkflowWebviewPanel.currentPanel.clearChatUI();
      }
      vscode.window.showInformationMessage(`Started new session: ${s.title}`);
      break;
    }
    case 'clearSessions': {
      const pick = await vscode.window.showWarningMessage('Are you sure you want to clear all chat & voice session histories?', { modal: true }, 'Clear All');
      if (pick === 'Clear All') {
        SessionManager.getInstance().clearAllSessions();
        if (WorkflowWebviewPanel.currentPanel) {
          WorkflowWebviewPanel.currentPanel.clearChatUI();
        }
        vscode.window.showInformationMessage('All session histories cleared.');
      }
      break;
    }
    case 'temperature': {
      const raw = await vscode.window.showInputBox({ prompt: 'Temperature (0–2)', value: String(opts.temperature ?? 0.5) });
      if (raw !== undefined && /^\d+(\.\d+)?$/.test(raw)) await set('temperature', Math.min(2, Math.max(0, Number(raw))));
      break;
    }
    case 'maxTokens': {
      const raw = await vscode.window.showInputBox({ prompt: 'Max tokens per reply', value: String(opts.maxTokens ?? 4096) });
      if (raw !== undefined && /^\d+$/.test(raw)) await set('maxTokens', Math.min(131072, Math.max(1, Number(raw))));
      break;
    }
    case 'systemPrompt': {
      const raw = await vscode.window.showInputBox({
        prompt: 'Extra system instructions (empty = default)',
        value: opts.systemPrompt ?? ''
      });
      if (raw !== undefined) await set('systemPrompt', raw);
      break;
    }
    case 'allowShell':
      await set('allowShell', !opts.allowShell);
      break;
    case 'allowVscode':
      await set('allowVscode', !opts.allowVscode);
      break;
    case 'allowFiles':
      await set('allowFiles', !opts.allowFiles);
      break;
    case 'allowWeb':
      await set('allowWeb', !opts.allowWeb);
      break;
    case 'maxTurns': {
      const raw = await vscode.window.showInputBox({ prompt: 'History message count', value: String(opts.maxTurns) });
      if (raw !== undefined && /^\d+$/.test(raw)) await set('maxTurns', Math.max(2, Number(raw)));
      break;
    }
  }
  void context;
}

export function getWorkspaceContext(): string {
  const parts: string[] = [];
  const roots = vscode.workspace.workspaceFolders;
  const rootPath = (roots && roots.length > 0) ? roots[0].uri.fsPath : process.cwd();
  parts.push(`Workspace Root: ${rootPath}`);

  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const file = editor.document.uri.fsPath;
    const line = editor.selection.active.line + 1;
    const rel = path.relative(rootPath, file);
    parts.push(`Active File: ${rel} (${file}, Line ${line})`);
    if (!editor.selection.isEmpty) {
      const sel = editor.document.getText(editor.selection);
      parts.push(`Selected Text (${sel.length} chars):\n${sel.slice(0, 1000)}`);
    }
  }

  if (roots && roots.length > 0) {
    try {
      const branch = cp.execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: rootPath,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 1000
      }).trim();
      if (branch) parts.push(`Git Branch: ${branch}`);
    } catch {
      /* ignore git error */
    }
  }

  try {
    const entries = fs.readdirSync(rootPath).filter(
      (n) => !['node_modules', '.git', '.vscode', 'dist', 'out', 'build', '.gemini'].includes(n)
    );
    if (entries.length > 0) {
      parts.push(`Workspace Top-Level Items: ${entries.slice(0, 30).join(', ')}${entries.length > 30 ? '...' : ''}`);
    }
  } catch {
    /* ignore fs error */
  }

  return parts.length ? `[Current IDE Context]\n${parts.join('\n')}\n\n` : '';
}

async function chatWith(context: vscode.ExtensionContext, catalog: ModelInfo[]): Promise<void> {
  const selected = context.workspaceState.get<string>('antigravity.models.selected');
  if (!selected) {
    const pick = await vscode.window.showInformationMessage('Pick a 9 Router model first.', 'Pick Model');
    if (pick === 'Pick Model') return pickModel(context, catalog);
    return;
  }

  if (!chatOutput) chatOutput = vscode.window.createOutputChannel('9 Router');
  chatOutput.show(true);
  chatOutput.clear();
  const opts = readSessionOptions();
  chatOutput.appendLine(`9 Router chat · model: ${selected} · temp: ${opts.temperature ?? 0.5} · maxTokens: ${opts.maxTokens ?? 'default'} · shell: ${opts.allowShell ? 'on' : 'off'} · vscode: ${opts.allowVscode ? 'on' : 'off'} · files: ${opts.allowFiles ? 'on' : 'off'} · web: ${opts.allowWeb ? 'on' : 'off'}`);
  chatOutput.appendLine('type messages into the input box, Esc = end');
  chatOutput.appendLine('');

  const { baseUrl, apiKey } = settings();
  const roots = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  const system = (opts.systemPrompt ? opts.systemPrompt + '\n\n' : '') + agentSystem(roots);
  const messages: ChatMessage[] = [{ role: 'system', content: system }];
  let last = '';

  for (;;) {
    const text = await vscode.window.showInputBox({
      prompt: `Message to ${selected}`,
      value: last,
      placeHolder: 'Type your message… (agent can read files, run commands, create files)'
    });
    if (text === undefined) {
      chatOutput.appendLine('— chat ended —');
      return;
    }
    last = '';
    const trimmed = text.trim();
    if (!trimmed) continue;

    const ideContext = getWorkspaceContext();
    const userMessageContent = ideContext ? `${ideContext}${trimmed}` : trimmed;
    messages.push({ role: 'user', content: userMessageContent });
    chatOutput.appendLine(`You: ${trimmed}`);

    const createdFiles: string[] = [];
    let announced = false;
    let failed = false;
    setBusy(true, 'thinking');
    const policy = { allowShell: opts.allowShell, allowVscode: opts.allowVscode, allowFiles: opts.allowFiles, allowWeb: opts.allowWeb };

    for (let guard = 0; guard < 15; guard++) {
      if (!announced) {
        chatOutput.append('Model: ');
        announced = true;
      }
      const appender = toolBlockAwareAppender((d) => chatOutput.append(d));
      setBusy(true, 'typing');
      const sendMessages = [messages[0], ...messages.slice(1, 1 + opts.maxTurns)];
      let raw = '';
      let toolCalls: NativeToolCall[] = [];
      try {
        const res = await streamCompletion(
          {
            baseUrl,
            apiKey,
            model: selected,
            messages: sendMessages,
            temperature: opts.temperature ?? 0.5,
            maxTokens: opts.maxTokens,
            tools: ANTIGRAVITY_TOOLS
          },
          appender
        );
        raw = res.content;
        toolCalls = res.toolCalls;
      } catch (err) {
        chatOutput.appendLine('');
        chatOutput.appendLine(`[error] ${err instanceof Error ? err.message : String(err)}`);
        failed = true;
        break;
      }
      setBusy(false, 'typing');
      chatOutput.appendLine('');

      const hasXmlTools = hasToolBlocks(raw);
      const hasNativeTools = toolCalls && toolCalls.length > 0;

      if (!hasXmlTools && !hasNativeTools) {
        messages.push({ role: 'assistant', content: raw });
        break;
      }

      setBusy(true, 'running tools');
      const toolResults = await executeTools(raw, roots, policy, toolCalls);
      for (const r of toolResults) {
        chatOutput.appendLine(`[agent] ${r.tool}: ${r.args}`);
        chatOutput.appendLine(r.output.split('\n').slice(0, 40).join('\n'));
        if ((r.tool === 'file' || r.tool === 'write_to_file') && r.output.startsWith('created')) {
          const match = r.output.match(/^created\s+(.+?)(?:\s+\(|$)/);
          createdFiles.push(match ? match[1].trim() : r.output.slice('created '.length).trim());
        }
      }

      if (hasNativeTools) {
        messages.push({
          role: 'assistant',
          content: raw,
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
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.name,
            content: tr ? tr.output : '[done]'
          });
        }
      } else {
        messages.push({ role: 'assistant', content: raw });
        const feed = toolResults
          .map((r) => `<antigravity:tool_result tool="${r.tool}" args="${r.args}">\n${r.output}\n</antigravity:tool_result>`)
          .join('\n');
        messages.push({ role: 'user', content: feed });
      }
    }

    if (failed) {
      setBusy(false, 'typing');
      chatOutput.appendLine('— chat ended —');
      return;
    }

    setBusy(false, 'typing');
    chatOutput.appendLine('[✓ done]');

    if (createdFiles.length) {
      chatOutput.appendLine(`[agent] created ${createdFiles.length} file(s)`);
      const items = createdFiles.length === 1 ? ['Open file'] : [];
      const first = await vscode.window.showInformationMessage(
        `Created ${createdFiles.length} file(s): ${createdFiles.join(', ')}`,
        ...items
      );
      if (first === 'Open file') {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(createdFiles[0]));
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
      }
    }
    chatOutput.appendLine('');
  }
}

export function activate(context: vscode.ExtensionContext): void {
  statusBarContext = context;
  SessionManager.initialize(context);
  const catalogManager = UnifiedModelCatalog.getInstance();
  const catalog = catalogManager.getModels();

  // Background auto-sync with 9 Router to discover any live providers / models
  const { baseUrl, apiKey } = settings();
  void catalogManager.syncWithRouter(baseUrl, apiKey).then((models) => {
    WorkflowWebviewPanel.currentPanel?.updateCatalog(models);
  }).catch(() => {});

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'antigravity.models.click';
  statusBar.show();
  context.subscriptions.push(statusBar);

  chatBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99.5);
  chatBtn.command = 'antigravity.models.chat';
  chatBtn.text = '$(comment-discussion) Chat with Model';
  chatBtn.tooltip = '9 Router: Chat with Selected Model (Text Mode & Autonomous Pipeline)';
  chatBtn.show();
  context.subscriptions.push(chatBtn);

  busyBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  busyBar.command = 'antigravity.models.click';
  busyBar.hide();
  context.subscriptions.push(busyBar);
  refreshStatusBar();

  voiceBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98);
  voiceBtn.command = 'antigravity.voice.talk';
  voiceBtn.hide();
  context.subscriptions.push(voiceBtn);

  muteBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 97);
  muteBtn.command = 'antigravity.voice.mute';
  muteBtn.hide();
  context.subscriptions.push(muteBtn);

  voiceConnBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 96);
  voiceConnBar.command = 'antigravity.voice.connClick';
  voiceConnBar.hide();
  context.subscriptions.push(voiceConnBar);

  // Initialize Layer 2 Serial Orchestrator & Voice AI Bridge
  orchestrator = new SerialOrchestrator(context, {
    onWorkflowUpdated: (wf) => {
      WorkflowWebviewPanel.currentPanel?.onWorkflowUpdated(wf);
      WorkflowWebviewPanel.currentPanel?.sendState();
      if (wf.status === 'Running') {
        const active = wf.steps[wf.activeStepIndex];
        if (active) {
          setBusy(true, `[${active.roleName}] ${active.progressState}`);
        }
      } else {
        setBusy(false, 'Ready');
      }
    },
    onStepProgress: (stepId, state, pct, note) => {
      const wf = orchestrator.workflow;
      const active = wf?.steps.find((s) => s.id === stepId);
      if (active) {
        setBusy(true, `[${active.roleName}] ${state}${note ? ` (${note})` : ''}`);
      }
      WorkflowWebviewPanel.currentPanel?.onStepProgress(stepId, state, pct, note);
      WorkflowWebviewPanel.currentPanel?.sendState();
    },
    onFallback: (event) => {
      if (chatOutput) {
        chatOutput.appendLine('');
        chatOutput.appendLine(`[fallback] Role '${event.roleId}': Model '${event.fromModel}' encountered failure (${event.reason}) -> automatically switched to Fallback Model '${event.toModel}'`);
      }
      vscode.window.showWarningMessage(`Role ${event.roleId}: Switched to fallback model ${event.toModel}`);
      WorkflowWebviewPanel.currentPanel?.onFallback(event);
      WorkflowWebviewPanel.currentPanel?.sendState();
    },
    onLog: (line) => {
      if (chatOutput) chatOutput.appendLine(line);
      WorkflowWebviewPanel.currentPanel?.appendChatLog(line);
    },
    onVerification: (result) => {
      if (chatOutput && result) {
        chatOutput.appendLine('');
        chatOutput.appendLine(`[verification] Final verification outcome: ${result.summary}`);
      }
      WorkflowWebviewPanel.currentPanel?.onVerification(result);
      WorkflowWebviewPanel.currentPanel?.sendState();
    }
  });

  voiceBridge = new MainVoiceOrchestratorBridge(context, orchestrator, settings);

  // Sync and mirror roles into workspace .antigravity/roles.json
  syncRolesWithWorkspaceFile(context);
  context.subscriptions.push(
    initRolesFileWatcher(context, (updatedRoles) => {
      if (chatOutput) {
        chatOutput.appendLine(`[roles] Hot-reloaded ${updatedRoles.length} roles from .antigravity/roles.json`);
      }
      WorkflowWebviewPanel.currentPanel?.sendState();
    })
  );

  const executeGoalCommand = async (goal: string) => {
    if (!goal || !goal.trim()) return;

    const vRoots = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0)
      ? vscode.workspace.workspaceFolders.map((f) => f.uri.fsPath)
      : [process.cwd()];

    const { baseUrl, apiKey } = settings();
    const steps = await planWorkflowFromGoal(goal.trim(), context, baseUrl, apiKey);

    const panel = WorkflowWebviewPanel.createOrShow(context.extensionUri, context, orchestrator, catalog);
    panel.switchTab('chat');

    void orchestrator.runWorkflow(goal.trim(), steps, vRoots[0], baseUrl, apiKey);
  };

  const startTaskCommand = async () => {
    const goal = await vscode.window.showInputBox({
      title: 'Start Serial Orchestrated Task',
      prompt: 'Enter the goal or requirement for the specialized AI roles to accomplish:',
      placeHolder: 'e.g. Build authentication for this application, or Refactor database models',
      ignoreFocusOut: true
    });
    if (!goal || !goal.trim()) return;
    await executeGoalCommand(goal);
  };

  const manageRolesCommand = async () => {
    const roles = getRoles(context);
    const items = roles.map((r) => ({
      label: `${r.enabled ? '$(check) ' : '$(circle-slash) '}${r.name}`,
      description: `[${r.primaryModel}] · ${r.fallbackModels.length} fallback(s)`,
      detail: r.purpose,
      role: r
    }));

    const sel = await vscode.window.showQuickPick(items, {
      title: 'Manage AI Roles & Model Selection',
      placeHolder: 'Select a role to configure primary model, fallback chain, or system prompt'
    });

    if (sel?.role) {
      await configureRoleInteractive(sel.role, context, catalog);
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('antigravity.models.click', () => {
      WorkflowWebviewPanel.createOrShow(context.extensionUri, context, orchestrator, catalog);
    }),
    vscode.commands.registerCommand('antigravity.models.quickMenu', () => {
      WorkflowWebviewPanel.createOrShow(context.extensionUri, context, orchestrator, catalog);
    }),
    vscode.commands.registerCommand('antigravity.orchestration.openWorkflow', () => {
      WorkflowWebviewPanel.createOrShow(context.extensionUri, context, orchestrator, catalog);
    }),
    vscode.commands.registerCommand('antigravity.orchestration.manageRoles', () => {
      WorkflowWebviewPanel.createOrShow(context.extensionUri, context, orchestrator, catalog);
    }),
    vscode.commands.registerCommand('antigravity.orchestration.startTask', startTaskCommand),
    vscode.commands.registerCommand('antigravity.orchestration.executeGoal', (goal: string) => executeGoalCommand(goal)),
    vscode.commands.registerCommand('antigravity.orchestration.pause', () => orchestrator.pause()),
    vscode.commands.registerCommand('antigravity.orchestration.resume', () => orchestrator.resume()),
    vscode.commands.registerCommand('antigravity.orchestration.cancel', () => orchestrator.cancel()),
    vscode.commands.registerCommand('antigravity.models.pick', () => pickModel(context, catalog)),
    vscode.commands.registerCommand('antigravity.models.chat', () => {
      WorkflowWebviewPanel.openChatWithSelectedModel(context.extensionUri, context, orchestrator, catalog);
    }),
    vscode.commands.registerCommand('antigravity.models.chatInputBox', () => chatWith(context, catalog)),
    vscode.commands.registerCommand('antigravity.models.options', () => configureSession(context)),
    vscode.commands.registerCommand('antigravity.models.voice', () => toggleVoiceMode(context, catalog)),
    vscode.commands.registerCommand('antigravity.voice.configureApiKeys', () => configureGeminiApiKeys(context)),
    vscode.commands.registerCommand('antigravity.voice.pickModel', () => pickLiveModel(context, catalog)),
    vscode.commands.registerCommand('antigravity.voice.talk', () => voiceTalkToggle()),
    vscode.commands.registerCommand('antigravity.voice.mute', () => voiceMuteToggle()),
    vscode.commands.registerCommand('antigravity.voice.interrupt', () => voiceInterrupt()),
    vscode.commands.registerCommand('antigravity.voice.devices', () => listAudioDevices()),
    vscode.commands.registerCommand('antigravity.voice.micLevel', () => checkMicLevel()),
    vscode.commands.registerCommand('antigravity.voice.connClick', () => voiceConnClick(context, catalog)),
    vscode.commands.registerCommand('antigravity.voice.reconnect', () => {
      if (liveCall) {
        liveCall.reconnect();
        vscode.window.showInformationMessage('Reconnecting voice channel to Gemini Live…');
      }
    }),
    vscode.commands.registerCommand('antigravity.voice.openRecordings', () => openRecordingsFolder()),
    vscode.commands.registerCommand('antigravity.voice.copyLatestAudio', () => copyLatestAudioPath()),
    vscode.commands.registerCommand('antigravity.session.new', () => {
      const selected = context.workspaceState.get<string>('antigravity.models.selected') || 'ag/gemini-3.8-flash-high';
      const s = SessionManager.getInstance().createNewSession(selected);
      if (WorkflowWebviewPanel.currentPanel) {
        WorkflowWebviewPanel.currentPanel.clearChatUI();
      }
      vscode.window.showInformationMessage(`Started new chat session: ${s.title}`);
    }),
    vscode.commands.registerCommand('antigravity.session.clear', async () => {
      const pick = await vscode.window.showWarningMessage('Are you sure you want to clear all chat & voice session histories?', { modal: true }, 'Clear All');
      if (pick === 'Clear All') {
        SessionManager.getInstance().clearAllSessions();
        if (WorkflowWebviewPanel.currentPanel) {
          WorkflowWebviewPanel.currentPanel.clearChatUI();
        }
        vscode.window.showInformationMessage('All chat and voice session histories cleared.');
      }
    })
  );
}

export function deactivate(): void {
  SessionManager.getInstance().flushSync();
  if (orchestrator) orchestrator.cancel();
  if (liveCall) liveCall.stop();
}