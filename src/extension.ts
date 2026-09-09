import * as vscode from 'vscode';
import { catalogModelInfos, fetchRouterModels, mergeModels, type ModelInfo } from './models';
import { AGENT_SYSTEM, executeTools, hasToolBlocks, streamCompletion, toolBlockAwareAppender, type ChatMessage } from './chat';

const CATALOG_SIZE = catalogModelInfos().length;

let statusBar: vscode.StatusBarItem;
let busyBar: vscode.StatusBarItem;
let busyDepth = 0;
let chatOutput: vscode.OutputChannel;

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

function refreshStatusBar(): void {
  const selected = statusBarContext.workspaceState.get<string>('antigravity.models.selected');
  if (selected) {
    statusBar.text = `$(gather) 9 Router · ${selected}`;
    statusBar.tooltip = `Selected model: ${selected}\nClick to chat or pick a model`;
  } else {
    statusBar.text = '$(gather) 9 Router';
    statusBar.tooltip = '9 Router — click to pick a model';
  }
}

let statusBarContext: vscode.ExtensionContext;

async function pickModel(context: vscode.ExtensionContext, catalog: ModelInfo[]): Promise<void> {
  const { baseUrl, apiKey } = settings();
  const filterLive = vscode.workspace.getConfiguration('antigravity.models').get<boolean>('filterLive') !== false;
  statusBar.text = '$(sync~spin) 9 Router…';
  const router = await fetchRouterModels(baseUrl, apiKey);
  const merged = mergeModels(router.items, catalog);
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
    const go = await vscode.window.showInformationMessage(`Model selected: ${m.id}`, 'Chat');
    qp.dispose();
    if (go === 'Chat') await chatWith(context, catalog);
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
    maxTurns: num('maxTurns') ?? 40
  };
}

async function configureSession(context: vscode.ExtensionContext): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('antigravity.session');
  const opts = readSessionOptions();

  const item = await vscode.window.showQuickPick(
    [
      { label: '$(gear) Temperature', description: String(opts.temperature ?? '(unset)'), value: 'temperature' as const },
      { label: '$(gear) Max tokens', description: String(opts.maxTokens ?? '(unset)'), value: 'maxTokens' as const },
      { label: '$(comment) System prompt', description: opts.systemPrompt ? 'custom' : '(default agent rules)', value: 'systemPrompt' as const },
      { label: '$(terminal) Shell commands', description: opts.allowShell ? 'allowed' : 'blocked', value: 'allowShell' as const },
      { label: '$(extensions) VS Code commands', description: opts.allowVscode ? 'allowed' : 'blocked', value: 'allowVscode' as const },
      { label: '$(files) File access', description: opts.allowFiles ? 'allowed' : 'blocked', value: 'allowFiles' as const },
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
    case 'maxTurns': {
      const raw = await vscode.window.showInputBox({ prompt: 'History message count', value: String(opts.maxTurns) });
      if (raw !== undefined && /^\d+$/.test(raw)) await set('maxTurns', Math.max(2, Number(raw)));
      break;
    }
  }
  void context;
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
  chatOutput.appendLine(`9 Router chat · model: ${selected} · temp: ${opts.temperature ?? 0.5} · maxTokens: ${opts.maxTokens ?? 'default'} · shell: ${opts.allowShell ? 'on' : 'off'} · vscode: ${opts.allowVscode ? 'on' : 'off'} · files: ${opts.allowFiles ? 'on' : 'off'}`);
  chatOutput.appendLine('type messages into the input box, Esc = end');
  chatOutput.appendLine('');

  const { baseUrl, apiKey } = settings();
  const roots = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  const system = (opts.systemPrompt ? opts.systemPrompt + '\n\n' : '') + AGENT_SYSTEM;
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

    messages.push({ role: 'user', content: trimmed });
    chatOutput.appendLine(`You: ${trimmed}`);

    const createdFiles: string[] = [];
    let announced = false;
    let failed = false;
    setBusy(true, 'thinking');
    const policy = { allowShell: opts.allowShell, allowVscode: opts.allowVscode, allowFiles: opts.allowFiles };

    for (let guard = 0; guard < 15; guard++) {
      if (!announced) {
        chatOutput.append('Model: ');
        announced = true;
      }
      const appender = toolBlockAwareAppender((d) => chatOutput.append(d));
      setBusy(true, 'typing');
      const sendMessages = [messages[0], ...messages.slice(1, 1 + opts.maxTurns)];
      let raw = '';
      try {
        const { content } = await streamCompletion(
          {
            baseUrl,
            apiKey,
            model: selected,
            messages: sendMessages,
            temperature: opts.temperature,
            maxTokens: opts.maxTokens
          },
          appender
        );
        raw = content;
      } catch (err) {
        chatOutput.appendLine('');
        chatOutput.appendLine(`[error] ${err instanceof Error ? err.message : String(err)}`);
        failed = true;
        break;
      }
      setBusy(false, 'typing');
      chatOutput.appendLine('');
      messages.push({ role: 'assistant', content: raw });

      if (!hasToolBlocks(raw)) break;

      setBusy(true, 'running tools');
      const toolResults = await executeTools(raw, roots, policy);
      for (const r of toolResults) {
        chatOutput.appendLine(`[agent] ${r.tool}: ${r.args}`);
        chatOutput.appendLine(r.output.split('\n').slice(0, 40).join('\n'));
        if (r.tool === 'file' && r.output.startsWith('created')) createdFiles.push(r.output.slice('created '.length).trim());
      }
      const feed = toolResults
        .map((r) => `<antigravity:tool_result tool="${r.tool}" args="${r.args}">\n${r.output}\n</antigravity:tool_result>`)
        .join('\n');
      messages.push({ role: 'user', content: feed });
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
  const catalog = catalogModelInfos();

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'antigravity.models.click';
  statusBar.show();
  context.subscriptions.push(statusBar);

  busyBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  busyBar.command = 'antigravity.models.click';
  busyBar.hide();
  context.subscriptions.push(busyBar);
  refreshStatusBar();

  context.subscriptions.push(
    vscode.commands.registerCommand('antigravity.models.click', async () => {
      const choice = await vscode.window.showQuickPick(
        [
          { label: '$(comment-discussion) Chat with selected model', description: context.workspaceState.get<string>('antigravity.models.selected') ?? 'none yet', value: 'chat' as const },
          { label: '$(pencil) Pick / change model', value: 'pick' as const },
          { label: '$(gear) Session options', description: 'temperature, max tokens, prompt, tools', value: 'opts' as const },
          { label: filterLiveOn() ? '$(mute) Live models filtered out' : '$(unmute) Live models shown', description: 'toggle voice-to-voice models in the picker', value: 'live' as const }
        ],
        { placeHolder: '9 Router — what do you want to do?' }
      );
      if (choice?.value === 'chat') await chatWith(context, catalog);
      else if (choice?.value === 'pick') await pickModel(context, catalog);
      else if (choice?.value === 'opts') await configureSession(context);
      else if (choice?.value === 'live') await toggleLiveFilter();
    }),
    vscode.commands.registerCommand('antigravity.models.pick', () => pickModel(context, catalog)),
    vscode.commands.registerCommand('antigravity.models.chat', () => chatWith(context, catalog)),
    vscode.commands.registerCommand('antigravity.models.options', () => configureSession(context))
  );
}