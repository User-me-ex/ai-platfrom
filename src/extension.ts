import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { catalogModelInfos, fetchRouterModels, mergeModels, type ModelInfo } from './models';
import { agentSystem, voiceAgentSystem, executeTools, hasToolBlocks, streamCompletion, stripToolBlocks, toolBlockAwareAppender, type ChatMessage } from './chat';
import * as voice from './voice';

const CATALOG_SIZE = catalogModelInfos().length;

let statusBar: vscode.StatusBarItem;
let busyBar: vscode.StatusBarItem;
let busyDepth = 0;
let chatOutput: vscode.OutputChannel;

let voiceBtn: vscode.StatusBarItem;
let muteBtn: vscode.StatusBarItem;
let voiceConnBar: vscode.StatusBarItem;
let voiceActive = false;
let voiceTalking = false;
let voiceMuted = false;
let voiceTextOpen = false;
let voiceLastFrom: 'user' | 'ai' | undefined;
let liveCall: voice.LiveCall | undefined;

function setVoiceConn(state: 'connecting' | 'connected' | 'disconnected' | 'error', message?: string): void {
  if (!voiceConnBar) return;
  if (!voiceActive) {
    voiceConnBar.hide();
    return;
  }
  if (state === 'connected') {
    voiceConnBar.text = '$(radio-tower) Live';
    voiceConnBar.tooltip = 'Voice channel is live — press Talk and speak';
    voiceConnBar.color = new vscode.ThemeColor('charts.green');
  } else if (state === 'connecting') {
    voiceConnBar.text = '$(sync~spin) voice…';
    voiceConnBar.tooltip = message ?? 'Connecting to Gemini Live';
    voiceConnBar.color = new vscode.ThemeColor('charts.yellow');
  } else if (state === 'error') {
    voiceConnBar.text = '$(close) voice err';
    voiceConnBar.tooltip = message ?? 'Voice channel error';
    voiceConnBar.color = new vscode.ThemeColor('charts.red');
  } else {
    voiceConnBar.text = '$(plug) voice off';
    voiceConnBar.tooltip = message ?? 'Voice channel closed';
    voiceConnBar.color = undefined;
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

function voiceSettings(): { liveModel: string; ttsVoice: string; port: number; inputDevice?: string; echoCancellation: boolean; echoDelayMs: number } {
  const cfg = vscode.workspace.getConfiguration('antigravity.voice');
  const dev = (cfg.get<string>('inputDevice') ?? '').trim();
  return {
    liveModel: cfg.get<string>('liveModel') || voice.VOICE_DEFAULT_LIVE_MODEL,
    ttsVoice: cfg.get<string>('ttsVoice') || voice.VOICE_DEFAULT_VOICE,
    port: cfg.get<number>('routerPort') || voice.VOICE_DEFAULT_PORT,
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

  if (!chatOutput) chatOutput = vscode.window.createOutputChannel('9 Router');
  chatOutput.show(true);
  chatOutput.appendLine('');

  const opts = readSessionOptions();
  const model = vs.liveModel;
  const vRoots = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  chatOutput.appendLine('— voice conversation (real-time WebSocket channel) —');
  chatOutput.appendLine(`live model: ${model}`);
  chatOutput.appendLine(`voice: ${vs.ttsVoice} · temp ${opts.temperature} · max tokens ${opts.maxTokens ?? 'default'}`);
  chatOutput.appendLine(`channel: ws://127.0.0.1:${vs.port}/voice (served by 9 Router using its gemini/vertex provider key)`);
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
  liveCall = voice.startLiveConversation(
    vs.port,
    {
      model,
      systemPrompt: (opts.systemPrompt ? opts.systemPrompt + '\n\n' : '') + voiceAgentSystem(vRoots),
      voice: vs.ttsVoice,
      temperature: opts.temperature ?? 0.5,
      maxTokens: opts.maxTokens
    },
    {
      onText: (text, turnComplete, from) => {
        if (!chatOutput) return;
        if (turnComplete) {
          const turnText = aiTurnBuf;
          aiTurnBuf = '';
          if (turnText.trim() && hasToolBlocks(turnText)) {
            void executeVoiceTools(turnText, vRoots, opts, createdFiles, chatOutput);
          }
          chatOutput.appendLine('');
          voiceTextOpen = false;
          voiceLastFrom = undefined;
          return;
        }
        if (from === 'ai') aiTurnBuf += text;
        const speaker = from ?? 'ai';
        if (speaker !== voiceLastFrom) {
          if (voiceTextOpen) chatOutput.appendLine('');
          chatOutput.appendLine(speaker === 'user' ? 'You: ' : 'AI: ');
          voiceTextOpen = true;
          voiceLastFrom = speaker;
        }
        chatOutput.append(text);
      },
      onStatus: (state, message) => {
        if (state !== 'log') setVoiceConn(state, message);
        if (!chatOutput) return;
        if (state === 'connected') {
          chatOutput.appendLine('[voice] live connected — mic is open while talking; model audio plays in real time.');
        } else if (state === 'error') {
          chatOutput.appendLine(`[voice] [error] ${message ?? 'unknown'}`);
        } else {
          chatOutput.appendLine(`[voice] ${message ?? 'channel closed'}`);
        }
      }
    },
    soxBin,
    ffplay,
    micDev.device,
    vs.echoCancellation,
    vs.echoDelayMs
  );

  voiceBtn.show();
  muteBtn.show();
  setVoiceConn('connecting', 'opening channel…');
  voiceTalking = false;
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
  out.appendLine('[agent] executing <antigravity:…> blocks spoken in this turn…');
  setBusy(true, 'Voice AI working…');
  const results = await executeTools(text, roots, {
    allowShell: opts.allowShell,
    allowVscode: opts.allowVscode,
    allowFiles: opts.allowFiles
  });
  setBusy(false, 'Voice AI working…');
  for (const r of results) {
    out.appendLine(`[agent] ${r.tool}: ${r.args}`);
    out.appendLine(r.output.split('\n').slice(0, 40).join('\n'));
    if (r.tool === 'file' && r.output.startsWith('created')) {
      createdFiles.push(r.output.slice('created '.length).trim());
    }
  }
  if (results.length > 0 && liveCall) {
    const feed = results
      .map((r) => `<antigravity:tool_result tool="${r.tool}" args="${r.args}">\n${r.output}\n</antigravity:tool_result>`)
      .join('\n');
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
}

async function voiceMuteToggle(): Promise<void> {
  voiceMuted = !voiceMuted;
  if (liveCall) liveCall.setMuted(voiceMuted);
  refreshVoiceBars();
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
temperature: opts.temperature ?? 0.5,
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

  voiceBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98);
  voiceBtn.command = 'antigravity.voice.talk';
  voiceBtn.hide();
  context.subscriptions.push(voiceBtn);

  muteBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 97);
  muteBtn.command = 'antigravity.voice.mute';
  muteBtn.hide();
  context.subscriptions.push(muteBtn);

  voiceConnBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 96);
  voiceConnBar.hide();
  context.subscriptions.push(voiceConnBar);

  context.subscriptions.push(
    vscode.commands.registerCommand('antigravity.models.click', async () => {
      const choice = await vscode.window.showQuickPick(
        [
          { label: '$(comment-discussion) Chat with selected model', description: context.workspaceState.get<string>('antigravity.models.selected') ?? 'none yet', value: 'chat' as const },
          { label: '$(pencil) Pick / change model', value: 'pick' as const },
          { label: '$(gear) Session options', description: 'temperature, max tokens, prompt, tools', value: 'opts' as const },
          { label: voiceActive ? '$(mute) Voice conversation on' : '$(mic) Voice mode', description: 'real-time voice-to-voice over a local WebSocket channel (Gemini Live)', value: 'voice' as const },
          voiceActive ? { label: '$(mic) Check mic level', description: 'capture 2s and report RMS vs. the noise gate', value: 'micLevel' as const } : { label: '$(mic) Check mic level', description: 'capture 2s and report RMS vs. the noise gate', value: 'micLevel' as const },
          { label: filterLiveOn() ? '$(mute) Live models filtered out' : '$(unmute) Live models shown', description: 'toggle live/voice conversation models in the picker', value: 'live' as const }
        ],
        { placeHolder: '9 Router — what do you want to do?' }
      );
      if (choice?.value === 'chat') await chatWith(context, catalog);
      else if (choice?.value === 'pick') await pickModel(context, catalog);
      else if (choice?.value === 'opts') await configureSession(context);
      else if (choice?.value === 'voice') await toggleVoiceMode(context, catalog);
      else if (choice?.value === 'micLevel') await checkMicLevel();
      else if (choice?.value === 'live') await toggleLiveFilter();
    }),
    vscode.commands.registerCommand('antigravity.models.pick', () => pickModel(context, catalog)),
    vscode.commands.registerCommand('antigravity.models.chat', () => chatWith(context, catalog)),
    vscode.commands.registerCommand('antigravity.models.options', () => configureSession(context)),
    vscode.commands.registerCommand('antigravity.models.voice', () => toggleVoiceMode(context, catalog)),
    vscode.commands.registerCommand('antigravity.voice.talk', () => voiceTalkToggle()),
    vscode.commands.registerCommand('antigravity.voice.mute', () => voiceMuteToggle()),
    vscode.commands.registerCommand('antigravity.voice.devices', () => listAudioDevices()),
    vscode.commands.registerCommand('antigravity.voice.micLevel', () => checkMicLevel())
  );
}

export function deactivate(): void {
  if (liveCall) liveCall.stop();
}