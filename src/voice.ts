import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, execSync, execFileSync, type ChildProcess } from 'child_process';
import * as vscode from 'vscode';
import { WebSocket as WsClient } from 'ws';
import { initAec, AecCanceller } from './aec';

export const VOICE_DEFAULT_LIVE_MODEL = 'gemini-3.1-flash-live-preview';
export const VOICE_DEFAULT_VOICE = 'Kore';
export const GEMINI_LIVE_WSS =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

const SOX_CANDIDATES = [
  'C:\\Users\\USER\\AppData\\Local\\Microsoft\\WinGet\\Packages\\ChrisBagwell.SoX_Microsoft.Winget.Source_8wekyb3d8bbwe\\sox-14.4.2\\sox.exe'
];

const FFPLAY_CANDIDATES = [
  'C:\\Users\\USER\\AppData\\Local\\Microsoft\\WinGet\\Packages\\yt-dlp.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-N-121938-g2456a39581-win64-gpl\\bin\\ffplay.exe'
];

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), 'antigravity-voice');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function resolveSox(): string | undefined {
  const cfg = vscode.workspace.getConfiguration('antigravity.voice').get<string>('soxPath');
  if (cfg) return cfg;
  for (const p of SOX_CANDIDATES) if (fs.existsSync(p)) return p;
  return undefined;
}

export function resolveFfplay(): string | undefined {
  const cfg = vscode.workspace.getConfiguration('antigravity.voice').get<string>('ffplayPath');
  if (cfg) return cfg;
  for (const p of FFPLAY_CANDIDATES) if (fs.existsSync(p)) return p;
  return undefined;
}

export function resolveFfmpeg(): string | undefined {
  const ffplay = resolveFfplay();
  if (ffplay) {
    const candidate = path.join(path.dirname(ffplay), 'ffmpeg.exe');
    if (fs.existsSync(candidate)) return candidate;
  }
  for (const p of FFPLAY_CANDIDATES) {
    const candidate = path.join(path.dirname(p), 'ffmpeg.exe');
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

export function getRecordingsDir(workspaceRoot?: string): string {
  const folders = vscode.workspace.workspaceFolders;
  const baseDir = workspaceRoot || (folders && folders.length > 0 ? folders[0].uri.fsPath : undefined) || path.join(os.homedir(), 'Documents', 'Antigravity');
  const dir = path.join(baseDir, '.antigravity', 'recordings');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function createWavBuffer(pcmData: Buffer, sampleRate: number = 24000, numChannels: number = 1, bitsPerSample: number = 16): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmData.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
  header.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmData.length, 40);
  return Buffer.concat([header, pcmData]);
}

export function savePcmAsWavAndMp3(
  pcmBuffers: Buffer[],
  speaker: 'ai' | 'user',
  sampleRate: number = 24000,
  recordingsDir?: string,
  ffmpegBin?: string
): { wavPath: string; mp3Path?: string } {
  const dir = recordingsDir || getRecordingsDir();
  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
  const baseName = `voice_${speaker}_${timestamp}`;
  const wavPath = path.join(dir, `${baseName}.wav`);
  const totalPcm = Buffer.concat(pcmBuffers);
  const wavBuf = createWavBuffer(totalPcm, sampleRate);
  fs.writeFileSync(wavPath, wavBuf);

  let mp3Path: string | undefined;
  const ffmpeg = ffmpegBin || resolveFfmpeg();
  if (ffmpeg && fs.existsSync(ffmpeg)) {
    try {
      mp3Path = path.join(dir, `${baseName}.mp3`);
      execFileSync(ffmpeg, ['-y', '-i', wavPath, '-b:a', '128k', mp3Path], { windowsHide: true, stdio: 'ignore' });
    } catch {
      mp3Path = undefined;
    }
  }
  return { wavPath, mp3Path };
}

export function getLatestRecording(dir: string): string | undefined {
  if (!fs.existsSync(dir)) return undefined;
  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.mp3') || f.endsWith('.wav'))
    .map((f) => ({ name: f, path: path.join(dir, f), time: fs.statSync(path.join(dir, f)).mtime.getTime() }))
    .sort((a, b) => b.time - a.time);
  return files.length > 0 ? files[0].path : undefined;
}

export const LOOPBACK_PATTERNS = /stereo mix|what u hear|wave out|loopback|audio out|mixed output/i;

export function listMicEndpoints(): string[] {
  try {
    const out = execSync(
      'reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio\\Capture" /s',
      { maxBuffer: 4 * 1024 * 1024, windowsHide: true }
    ).toString();
    const names: string[] = [];
    let curState = 0;
    for (const raw of out.split(/\r?\n/)) {
      const t = raw.trim();
      const st = t.match(/^DeviceState\s+REG_DWORD\s+0x([0-9a-f]+)$/i);
      if (st) curState = parseInt(st[1], 16);
      const m = t.match(/^\{a45c254e-df1c-4efd-8020-67d146a850e0\},2\s+REG_SZ\s+(.+)$/i);
      if (m && curState === 1) names.push(m[1].replace(/^\s+|\s+$/g, ''));
    }
    return names;
  } catch {
    return [];
  }
}

export function resolveMicDevice(preferred: string | undefined): { device: string; note?: string } {
  const endpoints = listMicEndpoints();
  const pref = (preferred ?? '').trim();
  if (pref && pref.toLowerCase() !== 'default' && pref !== '#auto') {
    let names: string[];
    try {
      names = pref.startsWith('[') ? (JSON.parse(pref) as string[]) : [pref];
    } catch {
      names = [pref];
    }
    for (const n of names) {
      if (endpoints.includes(n)) return { device: n };
    }
    const seen = endpoints.length ? ` (found: ${endpoints.join('; ')})` : '';
    // configured name missing on this machine — fall through to auto-pick
  }
  const real = endpoints.filter((n) => !LOOPBACK_PATTERNS.test(n));
  const micLike = real.find((n) => /mic|array|input/i.test(n));
  if (micLike) return { device: micLike, note: `auto-selected '${micLike}' (real mic for this machine)` };
  if (real.length === 1) return { device: real[0], note: `auto-selected '${real[0]}'` };
  if (real.length > 1) {
    return { device: real[0], note: `auto-selected '${real[0]}' (first of: ${real.join('; ')})` };
  }
  if (pref && pref.toLowerCase() === 'default') return { device: 'default' };
  return {
    device: 'default',
    note: "no microphone found — using 'default'. On Windows this may be a Stereo Mix/loopback (AI repeats itself); set antigravity.voice.inputDevice to a real mic name."
  };
}

export interface LiveToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
}

export interface LiveHandlers {
  onText(text: string, turnComplete: boolean, from?: 'user' | 'ai'): void;
  onStatus(state: 'connected' | 'connecting' | 'disconnected' | 'error' | 'log', message?: string): void;
  onKeyFallback?(keyIndex: number, totalKeys: number, reason: string): void;
  onToolCall?(calls: LiveToolCall[]): Promise<void> | void;
  onAudioFile?(filePath: string, format: 'wav' | 'mp3', wavPath: string): void;
  onInterrupted?(): void;
}

export interface LiveCall {
  talking: boolean;
  muted: boolean;
  activeKeyIndex: number;
  totalKeys: number;
  setTalking(on: boolean): void;
  setMuted(on: boolean): void;
  setToolsExecuting(on: boolean): void;
  sendText(text: string): void;
  sendToolResponse(responses: Array<{ id: string; name?: string; response: Record<string, any> }>): void;
  interrupt(): void;
  reconnect(): void;
  stop(): void;
}

export interface LiveSetup {
  model: string;
  systemPrompt?: string;
  voice: string;
  temperature: number;
  maxTokens?: number;
  tools?: Array<{
    name: string;
    description: string;
    parameters?: Record<string, any>;
  }>;
}

export function startLiveConversation(
  apiKeys: string[] | string,
  setup: LiveSetup,
  handlers: LiveHandlers,
  soxBin: string,
  ffplayBin?: string,
  inputDevice?: string,
  echoCancellation?: boolean,
  echoDelayMs?: number,
  recordingsDir?: string,
  ffmpegBin?: string,
  bargeInEnabled?: boolean,
  bargeInThreshold?: number
): LiveCall {
  const normalizedKeys = (Array.isArray(apiKeys) ? apiKeys : [apiKeys])
    .map((k) => String(k || '').trim())
    .filter(Boolean);

  let currentKeyIndex = 0;
  let keysTriedInARow = 0;
  let setupCompletedEver = false;
  let toolsExecuting = false;
  let suppressTurnAudio = false;
  let aiTurnAudioChunks: Buffer[] = [];

  function isActivityContent(parts: any[]): boolean {
    if (!Array.isArray(parts)) return false;
    for (const part of parts) {
      if (!part) continue;
      if (part.functionCall || part.toolCall) return true;
      if (typeof part.text === 'string') {
        const t = part.text;
        if (
          /<antigravity:[a-z_]+/i.test(t) ||
          /\*\*TOOL:/i.test(t) ||
          /(?:^|\n)\s*(?:\*\*)?TOOL:\s*(read|list|open|file|edit|search|shell|fetch|question|grep|web_search|search_web)/i.test(t) ||
          /<antigravity:tool_result/i.test(t) ||
          /(?:<<<<|====|>>>>)/.test(t)
        ) {
          return true;
        }
      }
    }
    return false;
  }

  const isBargeInActive = typeof bargeInEnabled === 'boolean' ? bargeInEnabled : false;
  const effectiveBargeInThreshold = typeof bargeInThreshold === 'number'
    ? bargeInThreshold
    : (echoCancellation !== false ? 0.12 : 0.16);

  let talking = true;
  let muted = false;
  let stopped = false;
  let ws: WsClient | undefined;
  let mic: ChildProcess | undefined;
  let player: ChildProcess | undefined;
  const PLAY_BYTES_PER_MS = (24000 * 2) / 1000; // 24 kHz mono s16le = 48 bytes/ms
  const ACOUSTIC_TAIL_MS = 120; // 120ms acoustic decay margin
  let playbackStartTime = 0;
  let playbackEndTime = 0;
  let consecutiveSpeechChunks = 0;
  const REQUIRED_SPEECH_CHUNKS = 5; // ~160ms of continuous, sustained speech required to interrupt

  function isAiSpeakingNow(): boolean {
    return Date.now() < playbackEndTime + ACOUSTIC_TAIL_MS;
  }

  function computeRms(buf: Buffer): number {
    if (buf.length < 2) return 0;
    let sum = 0;
    const count = Math.floor(buf.length / 2);
    for (let i = 0; i < count; i++) {
      const val = buf.readInt16LE(i * 2);
      sum += val * val;
    }
    return Math.sqrt(sum / count) / 32768;
  }

  let reconnectTimer: NodeJS.Timeout | undefined;
  let pingWatch: NodeJS.Timeout | undefined;
  let reconnectAttempts = 0;

  let aec: AecCanceller | undefined;
  let aecOut = Buffer.alloc(0);
  if (echoCancellation !== false) {
    initAec()
      .then((a) => {
        aec = a;
        aec.setAudioBufferDelay(echoDelayMs ?? 120);
        handlers.onStatus('log', `echo cancellation: AEC3 active (in-process, render delay ${echoDelayMs ?? 120}ms)`);
      })
      .catch((err: Error) => {
        handlers.onStatus('log', `echo cancellation: AEC3 init failed, continuing without it (${err.message})`);
      });
  }

  const sanitizeParameters = (params?: Record<string, any>): Record<string, any> | undefined => {
    if (!params || typeof params !== 'object') return params;
    const clone = JSON.parse(JSON.stringify(params));
    const fixObj = (obj: any) => {
      if (!obj || typeof obj !== 'object') return;
      if (obj.type === 'array' && !obj.items) {
        obj.items = { type: 'string' };
      }
      if (obj.properties && typeof obj.properties === 'object') {
        for (const val of Object.values(obj.properties)) {
          fixObj(val);
        }
      }
      if (obj.items && typeof obj.items === 'object') {
        fixObj(obj.items);
      }
    };
    fixObj(clone);
    return clone;
  };

  const sendSetup = (socket: WsClient): void => {
    if (socket.readyState !== WsClient.OPEN) return;
    let rawModel = setup.model ? setup.model.trim() : VOICE_DEFAULT_LIVE_MODEL;
    let cleanModel = rawModel.split('/').pop() || rawModel;

    // Upstream Google Gemini Live limitation:
    // 'gemini-3.8-live-extended-thinking' crashes internally on Google's backend with a "system error" when functionDeclarations (tools) are declared.
    // When tools are active, safely route to 'gemini-3.8-live' which provides the full Gemini 3.8 architecture with seamless, reliable tool calling.
    if (cleanModel === 'gemini-3.8-live-extended-thinking' && setup.tools && setup.tools.length > 0) {
      handlers.onStatus('log', `Switching 'gemini-3.8-live-extended-thinking' to 'gemini-3.8-live' to support autonomous tools (Google thinking endpoint does not yet support live tool calling)`);
      cleanModel = 'gemini-3.8-live';
    }

    const modelPath = cleanModel.startsWith('models/') ? cleanModel : `models/${cleanModel}`;

    const cfg: Record<string, any> = {
      temperature: typeof setup.temperature === 'number' ? setup.temperature : 0.5,
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: setup.voice || VOICE_DEFAULT_VOICE
          }
        }
      }
    };
    if (typeof setup.maxTokens === 'number') cfg.maxOutputTokens = setup.maxTokens;
    if (/thinking/i.test(modelPath)) {
      cfg.thinkingConfig = { thinkingLevel: 'HIGH' };
    }

    const payload: Record<string, any> = {
      setup: {
        model: modelPath,
        generationConfig: cfg,
        inputAudioTranscription: {},
        outputAudioTranscription: {}
      }
    };

    if (setup.systemPrompt && setup.systemPrompt.trim()) {
      payload.setup.systemInstruction = {
        parts: [{ text: setup.systemPrompt.trim() }]
      };
    }

    if (setup.tools && setup.tools.length > 0) {
      payload.setup.tools = [
        {
          functionDeclarations: setup.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: sanitizeParameters(t.parameters)
          }))
        }
      ];
    }

    socket.send(JSON.stringify(payload));
  };

  const sendRealtimeAudio = (buf: Buffer): void => {
    if (!ws || ws.readyState !== WsClient.OPEN) return;
    try {
      ws.send(
        JSON.stringify({
          realtimeInput: {
            audio: {
              mimeType: 'audio/pcm;rate=16000',
              data: buf.toString('base64')
            }
          }
        })
      );
    } catch {
      /* ignore mid-write socket drop */
    }
  };

  const startMic = (): ChildProcess => {
    if (mic && !mic.killed) return mic;
    const dev = inputDevice && inputDevice.trim() ? inputDevice.trim() : 'default';
    const p = spawn(
      soxBin,
      ['--buffer', '1024', '-t', 'waveaudio', dev, '-r', '16000', '-c', '1', '-e', 'signed-integer', '-b', '16', '-t', 'raw', '-'],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    p.stdout.on('data', (chunk: Buffer) => {
      if (stopped || !talking || muted || !ws || ws.readyState !== WsClient.OPEN) return;

      const aiSpeaking = isAiSpeakingNow();

      if (aiSpeaking) {
        // AI is actively speaking out of the speakers right now.
        if (!isBargeInActive) {
          // Half-duplex safe mode: 100% immune to speaker feedback and false interruptions!
          // AI can never be cut off mid-reply by its own speaker audio or ambient noise.
          // User can interrupt anytime using the "Interrupt AI" button or command.
          consecutiveSpeechChunks = 0;
          return;
        }

        // Barge-in enabled: Check if user is deliberately speaking loudly to interrupt AI.
        // 500ms initial grace period after AI starts speaking to reject playback startup transients.
        const inGracePeriod = Date.now() < playbackStartTime + 500;
        if (inGracePeriod) {
          consecutiveSpeechChunks = 0;
          return;
        }

        let processedChunk = chunk;
        if (aec) {
          if (aecOut.length < chunk.length) aecOut = Buffer.alloc(chunk.length);
          const n = aec.processCapture(chunk, aecOut);
          if (n > 0) processedChunk = aecOut.subarray(0, n);
        }

        const energy = computeRms(processedChunk);
        if (energy > effectiveBargeInThreshold) {
          consecutiveSpeechChunks++;
          if (consecutiveSpeechChunks >= REQUIRED_SPEECH_CHUNKS) {
            handlers.onStatus('log', `voice: sustained user speech interruption detected (RMS ${energy.toFixed(3)} > ${effectiveBargeInThreshold}) — stopping AI playback`);
            stopPlayback();
            aiTurnAudioChunks = [];
            handlers.onInterrupted?.();
            sendRealtimeAudio(processedChunk);
            consecutiveSpeechChunks = 0;
          }
        } else {
          consecutiveSpeechChunks = 0;
        }
        return;
      }

      // Normal mode (AI is NOT speaking):
      consecutiveSpeechChunks = 0;
      let sendBuf = chunk;
      if (aec) {
        if (aecOut.length < chunk.length) aecOut = Buffer.alloc(chunk.length);
        const n = aec.processCapture(chunk, aecOut);
        if (n > 0) {
          sendBuf = aecOut.subarray(0, n);
        }
      }

      sendRealtimeAudio(sendBuf);
    });
    p.once('exit', () => {
      if (mic === p) mic = undefined;
      if (!stopped && !muted && talking) {
        mic = startMic();
      }
    });
    p.once('error', (err) => {
      handlers.onStatus('error', `mic: ${err.message}`);
    });
    mic = p;
    return p;
  };

  const ensurePlayer = (): ChildProcess | undefined => {
    if (player && !player.killed) return player;
    if (!ffplayBin) return undefined;
    const p = spawn(
      ffplayBin,
      ['-nodisp', '-loglevel', 'error', '-flags', 'low_delay', '-fflags', 'nobuffer', '-probesize', '32', '-analyzeduration', '0', '-f', 's16le', '-ar', '24000', '-ch_layout', 'mono', '-i', '-'],
      { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] }
    );
    let stderrBuf = '';
    p.stderr.on('data', (d: Buffer) => {
      stderrBuf += d.toString();
      if (stderrBuf.length > 2048) stderrBuf = stderrBuf.slice(-2048);
    });
    p.once('exit', () => {
      if (player === p) player = undefined;
      playbackEndTime = 0;
      if (stderrBuf.trim()) handlers.onStatus('error', `speaker: ${stderrBuf.trim().split('\n')[0]}`);
    });
    p.once('error', (err) => {
      handlers.onStatus('error', `speaker: ${err.message}`);
    });
    if (p.stdin) p.stdin.on('error', () => undefined);
    player = p;
    return p;
  };

  const playAiAudioChunk = (audio: Buffer): void => {
    if (!audio.length) return;
    const now = Date.now();
    const durationMs = audio.length / PLAY_BYTES_PER_MS;
    if (playbackEndTime > now) {
      playbackEndTime += durationMs;
    } else {
      playbackStartTime = now;
      playbackEndTime = now + durationMs;
    }

    aec?.feedRender(audio);

    const p = ensurePlayer();
    if (p && p.stdin) {
      try {
        p.stdin.write(audio);
      } catch {}
    }
  };

  const stopPlayback = (): void => {
    playbackEndTime = 0;
    playbackStartTime = 0;
    consecutiveSpeechChunks = 0;
    if (player && !player.killed) {
      try {
        player.kill();
      } catch {}
      player = undefined;
    }
  };

  const scheduleReconnect = (reason?: string): void => {
    if (stopped) return;
    if (reconnectTimer) return;
    if (pingWatch) {
      clearInterval(pingWatch);
      pingWatch = undefined;
    }
    const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), 5000);
    reconnectAttempts++;
    handlers.onStatus('connecting', `${reason ? reason + ' — ' : ''}auto-reconnecting in ${(delay / 1000).toFixed(1)}s…`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      if (!stopped) {
        connect();
      }
    }, delay);
  };

  const handleKeyFallback = (reason: string): void => {
    if (stopped) return;
    keysTriedInARow++;
    const oldIdx = currentKeyIndex;
    currentKeyIndex = (currentKeyIndex + 1) % normalizedKeys.length;
    const msg = `Key #${oldIdx + 1} issue (${reason}) -> auto-switching to fallback Key #${currentKeyIndex + 1}/${normalizedKeys.length}`;
    handlers.onStatus('connecting', msg);
    if (handlers.onKeyFallback) {
      handlers.onKeyFallback(currentKeyIndex, normalizedKeys.length, reason);
    }
    if (keysTriedInARow >= normalizedKeys.length) {
      handlers.onStatus(
        'error',
        `All ${normalizedKeys.length} Gemini API key(s) failed or hit quota limits. Please check keys or add fresh ones.`
      );
      scheduleReconnect('All keys exhausted; will retry');
      keysTriedInARow = 0;
      return;
    }
    if (ws) {
      try {
        ws.removeAllListeners();
        ws.close();
      } catch {}
      ws = undefined;
    }
    connect();
  };

  const connect = (): void => {
    if (stopped) return;
    if (normalizedKeys.length === 0) {
      handlers.onStatus('error', 'No Gemini API key configured for Voice Mode.');
      return;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
    if (pingWatch) {
      clearInterval(pingWatch);
      pingWatch = undefined;
    }
    if (ws) {
      try {
        ws.removeAllListeners();
        if (ws.readyState === WsClient.OPEN || ws.readyState === WsClient.CONNECTING) {
          ws.close();
        }
      } catch {
        /* ignore */
      }
      ws = undefined;
    }

    const key = normalizedKeys[currentKeyIndex];
    const keyTag = `Key #${currentKeyIndex + 1}${normalizedKeys.length > 1 ? `/${normalizedKeys.length}` : ''}`;
    handlers.onStatus(
      'connecting',
      reconnectAttempts > 0
        ? `reconnecting (${keyTag}, attempt ${reconnectAttempts + 1})…`
        : `connecting to Gemini Live (${keyTag})…`
    );

    const directWssUrl = `${GEMINI_LIVE_WSS}?key=${encodeURIComponent(key)}`;
    let currentWs: WsClient;
    try {
      currentWs = new WsClient(directWssUrl);
      ws = currentWs;
    } catch (err: any) {
      if (normalizedKeys.length > 1) {
        handleKeyFallback(`connect failed: ${err?.message ?? 'unknown'}`);
      } else {
        scheduleReconnect(`connect failed: ${err?.message ?? 'unknown'}`);
      }
      return;
    }

    currentWs.on('open', () => {
      if (stopped || ws !== currentWs) {
        try {
          currentWs.close();
        } catch {}
        return;
      }
      handlers.onStatus('connecting', `Gemini Live transport open (${keyTag}) — setting up session`);
      sendSetup(currentWs);
      ensurePlayer();
      pingWatch = setInterval(() => {
        if (currentWs.readyState === WsClient.OPEN) {
          try {
            currentWs.ping();
          } catch {
            /* ignore */
          }
        }
      }, 10000);
    });

    currentWs.on('message', (data, isBinary) => {
      if (stopped || ws !== currentWs) return;

      let textStr = '';
      if (typeof data === 'string') {
        textStr = data;
      } else if (Buffer.isBuffer(data)) {
        textStr = data.toString('utf8');
      } else if (data instanceof ArrayBuffer) {
        textStr = Buffer.from(data).toString('utf8');
      }

      let f: any = null;
      try {
        f = JSON.parse(textStr);
      } catch {
        // Handle raw binary if any
        if (isBinary && Buffer.isBuffer(data)) {
          aiTurnAudioChunks.push(data);
          playAiAudioChunk(data);
        }
        return;
      }

      if (!f) return;

      // Handle Gemini Live Error / Quota
      if (f.error) {
        const code = f.error.code;
        const status = String(f.error.status || '');
        const errMsg = String(f.error.message || 'Gemini Live error');
        const isQuota =
          code === 429 ||
          /RESOURCE_EXHAUSTED|quota|rate\s*limit|exhausted|too\s*many\s*requests/i.test(`${status} ${errMsg}`);
        const isAuth =
          code === 400 ||
          code === 403 ||
          /PERMISSION_DENIED|INVALID_ARGUMENT|API_KEY_INVALID/i.test(`${status} ${errMsg}`);

        if (normalizedKeys.length > 1 && (isQuota || isAuth || !setupCompletedEver)) {
          handleKeyFallback(isQuota ? `quota exceeded (${errMsg})` : errMsg);
        } else {
          handlers.onStatus('error', `Gemini Live error: ${errMsg}`);
          scheduleReconnect(`Gemini Live error: ${errMsg}`);
        }
        return;
      }

      // Handle session setup acknowledgement
      if (f.setupComplete) {
        setupCompletedEver = true;
        keysTriedInARow = 0;
        reconnectAttempts = 0;
        if (!muted && talking) {
          startMic();
        }
        handlers.onStatus('connected', `live channel ready (${keyTag}) — ${!muted && talking ? 'mic is live & listening' : 'mic is on hold / muted'}`);
        return;
      }

      // Handle goAway
      if (f.goAway) {
        const reason = f.goAway.reason || 'Gemini Live ended session';
        if (normalizedKeys.length > 1 && !setupCompletedEver) {
          handleKeyFallback(`goAway: ${reason}`);
        } else {
          scheduleReconnect(`Gemini Live goAway: ${reason}`);
        }
        return;
      }

      // Handle native Gemini Live toolCall
      if (f.toolCall && Array.isArray(f.toolCall.functionCalls)) {
        suppressTurnAudio = true;
        handlers.onStatus('log', `Gemini Live requested ${f.toolCall.functionCalls.length} tool call(s)`);
        if (handlers.onToolCall) {
          try {
            handlers.onToolCall(f.toolCall.functionCalls);
          } catch (e: any) {
            handlers.onStatus('log', `Tool execution error: ${e?.message || e}`);
          }
        }
        return;
      }

      // Handle serverContent
      const sc = f.serverContent;
      if (sc) {
        if (sc.interrupted) {
          handlers.onStatus('log', 'Gemini Live acknowledged interruption — stopping AI playback');
          stopPlayback();
          aiTurnAudioChunks = [];
          handlers.onInterrupted?.();
        }
        if (sc.modelTurn && Array.isArray(sc.modelTurn.parts)) {
          // Detect if tool calls are embedded inside modelTurn.parts
          const embeddedCalls: LiveToolCall[] = [];
          for (const part of sc.modelTurn.parts) {
            if (part && (part.functionCall || part.toolCall)) {
              const fc = part.functionCall || part.toolCall;
              embeddedCalls.push({
                name: fc.name,
                args: fc.args,
                id: fc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
              });
            }
          }
          if (embeddedCalls.length > 0) {
            suppressTurnAudio = true;
            handlers.onStatus('log', `Gemini Live requested ${embeddedCalls.length} tool call(s) (embedded)`);
            if (handlers.onToolCall) {
              try {
                handlers.onToolCall(embeddedCalls);
              } catch (e: any) {
                handlers.onStatus('log', `Tool execution error: ${e?.message || e}`);
              }
            }
          }

          // Detect if this turn contains raw tool blocks, markers, code, or activities that should not be sounded aloud
          const hasActivity = isActivityContent(sc.modelTurn.parts);
          if (hasActivity || toolsExecuting) {
            suppressTurnAudio = true;
          }

          for (const part of sc.modelTurn.parts) {
            if (!part) continue;
            // Always show all text in output channel!
            if (part.text) {
              handlers.onText(part.text, false, 'ai');
            }
            // Only play audio if this turn is NOT an activity / tool turn!
            if (!suppressTurnAudio && !toolsExecuting && part.inlineData && typeof part.inlineData.data === 'string') {
              try {
                const audio = Buffer.from(part.inlineData.data, 'base64');
                if (audio.length) {
                  aiTurnAudioChunks.push(audio);
                  playAiAudioChunk(audio);
                }
              } catch {}
            }
          }
        }
        if (sc.inputTranscription && typeof sc.inputTranscription.text === 'string' && sc.inputTranscription.text) {
          handlers.onText(sc.inputTranscription.text, false, 'user');
        }
        if (sc.outputTranscription && typeof sc.outputTranscription.text === 'string' && sc.outputTranscription.text) {
          handlers.onText(sc.outputTranscription.text, false, 'ai');
        }
        if (sc.turnComplete) {
          suppressTurnAudio = false;
          if (aiTurnAudioChunks.length > 0) {
            try {
              const res = savePcmAsWavAndMp3(aiTurnAudioChunks, 'ai', 24000, recordingsDir, ffmpegBin);
              handlers.onAudioFile?.(res.mp3Path || res.wavPath, res.mp3Path ? 'mp3' : 'wav', res.wavPath);
            } catch (err: any) {
              handlers.onStatus('log', `audio save error: ${err?.message || err}`);
            }
            aiTurnAudioChunks = [];
          }
          handlers.onText('', true);
        }
      }
      if (f.turnComplete && !sc?.turnComplete) {
        suppressTurnAudio = false;
        if (aiTurnAudioChunks.length > 0) {
          try {
            const res = savePcmAsWavAndMp3(aiTurnAudioChunks, 'ai', 24000, recordingsDir, ffmpegBin);
            handlers.onAudioFile?.(res.mp3Path || res.wavPath, res.mp3Path ? 'mp3' : 'wav', res.wavPath);
          } catch (err: any) {
            handlers.onStatus('log', `audio save error: ${err?.message || err}`);
          }
          aiTurnAudioChunks = [];
        }
        handlers.onText('', true);
      }
    });

    currentWs.on('close', (code, reason) => {
      if (stopped || ws !== currentWs) return;
      const r = reason ? reason.toString() : '';
      if (
        !setupCompletedEver &&
        normalizedKeys.length > 1 &&
        (code === 1008 || code === 1011 || code === 1006 || code === 400 || code === 403 || code === 429)
      ) {
        handleKeyFallback(`closed before setup complete (code ${code}${r ? `: ${r}` : ''})`);
        return;
      }
      scheduleReconnect(`channel closed (code ${code}${r ? `: ${r}` : ''})`);
    });

    currentWs.on('error', (err) => {
      if (stopped || ws !== currentWs) return;
      handlers.onStatus('error', `channel: ${err.message}`);
      if (!setupCompletedEver && normalizedKeys.length > 1) {
        handleKeyFallback(`error before setup complete: ${err.message}`);
        return;
      }
      scheduleReconnect(`channel error: ${err.message}`);
    });
  };

  // Start initial connection
  connect();

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    talking = false;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
    if (pingWatch) clearInterval(pingWatch);
    stopPlayback();
    try {
      if (mic && !mic.killed) mic.kill();
    } catch {}
    mic = undefined;
    try {
      if (ws) {
        ws.removeAllListeners();
        ws.close();
      }
    } catch {}
    ws = undefined;
    if (aec) {
      aec.free();
      aec = undefined;
    }
  };

  return {
    get talking(): boolean {
      return talking;
    },
    get muted(): boolean {
      return muted;
    },
    get activeKeyIndex(): number {
      return currentKeyIndex;
    },
    get totalKeys(): number {
      return normalizedKeys.length;
    },
    setTalking(on: boolean): void {
      talking = on;
      if (talking && !muted && !mic) {
        startMic();
      } else if (!talking && mic) {
        try { mic.kill(); } catch {}
        mic = undefined;
      }
    },
    setMuted(on: boolean): void {
      muted = on;
      if (muted && mic) {
        try { mic.kill(); } catch {}
        mic = undefined;
      } else if (!muted && talking && !mic) {
        startMic();
      }
    },
    setToolsExecuting(on: boolean): void {
      toolsExecuting = on;
      if (on) {
        suppressTurnAudio = true;
      }
    },
    sendText(text: string): void {
      stopPlayback();
      aiTurnAudioChunks = [];
      handlers.onInterrupted?.();
      if (ws && ws.readyState === WsClient.OPEN) {
        ws.send(
          JSON.stringify({
            clientContent: {
              turns: [{ role: 'user', parts: [{ text }] }],
              turnComplete: true
            }
          })
        );
      } else {
        handlers.onStatus('log', `voice text dropped — socket not open (reconnecting)`);
      }
    },
    sendToolResponse(responses: Array<{ id: string; name?: string; response: Record<string, any> }>): void {
      if (ws && ws.readyState === WsClient.OPEN) {
        ws.send(
          JSON.stringify({
            toolResponse: {
              functionResponses: responses.map((r) => ({
                id: r.id,
                name: r.name,
                response: r.response
              }))
            }
          })
        );
      } else {
        handlers.onStatus('log', `voice tool response dropped — socket not open (reconnecting)`);
      }
    },
    interrupt(): void {
      handlers.onStatus('log', 'voice: manual interrupt triggered — stopping AI playback');
      stopPlayback();
      aiTurnAudioChunks = [];
      handlers.onInterrupted?.();
      if (ws && ws.readyState === WsClient.OPEN) {
        try {
          ws.send(
            JSON.stringify({
              realtimeInput: {
                audio: {
                  mimeType: 'audio/pcm;rate=16000',
                  data: Buffer.alloc(1024).toString('base64')
                }
              }
            })
          );
        } catch {}
      }
    },
    reconnect(): void {
      if (stopped) return;
      reconnectAttempts = 0;
      connect();
    },
    stop
  };
}