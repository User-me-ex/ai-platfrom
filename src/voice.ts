import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, execSync, type ChildProcess } from 'child_process';
import * as vscode from 'vscode';
import { WebSocket as WsClient } from 'ws';
import { initAec, AecCanceller } from './aec';

export const VOICE_DEFAULT_LIVE_MODEL = 'gemini-3.1-flash-live-preview';
export const VOICE_DEFAULT_VOICE = 'Kore';
export const VOICE_DEFAULT_PORT = 20128;

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

export interface LiveHandlers {
  onText(text: string, turnComplete: boolean, from?: 'user' | 'ai'): void;
  onStatus(state: 'connected' | 'connecting' | 'disconnected' | 'error' | 'log', message?: string): void;
}

export interface LiveCall {
  talking: boolean;
  muted: boolean;
  setTalking(on: boolean): void;
  setMuted(on: boolean): void;
  sendText(text: string): void;
  stop(): void;
}

export interface LiveSetup {
  model: string;
  systemPrompt?: string;
  voice: string;
  temperature: number;
  maxTokens?: number;
}

export function startLiveConversation(
  port: number,
  setup: LiveSetup,
  handlers: LiveHandlers,
  soxBin: string,
  ffplayBin?: string,
  inputDevice?: string,
  echoCancellation?: boolean,
  echoDelayMs?: number
): LiveCall {
  const url = `ws://127.0.0.1:${port}/voice`;
  let talking = false;
  let muted = false;
  let stopped = false;
  let ws: WsClient | undefined;
  let mic: ChildProcess | undefined;
  let player: ChildProcess | undefined;
  let micGated = false;
  let writtenBytes = 0;
  let playedBytes = 0;
  let lastCaughtUpAt = 0;
  const PLAY_BYTES_PER_MS = 24000 * 2 / 1000; // 24 kHz mono s16le
  const ROOM_TAIL_MS = 450; // speaker decay after playback actually finishes

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

  const wsConnect = new WsClient(url);

  const sendSetup = (): void => {
    wsConnect.send(
      JSON.stringify({
        setup: {
          model: setup.model,
          systemPrompt: setup.systemPrompt,
          voice: setup.voice,
          temperature: setup.temperature,
          maxTokens: setup.maxTokens
        }
      })
    );
  };

  const startMic = (): ChildProcess => {
    const dev = inputDevice && inputDevice.trim() ? inputDevice.trim() : 'default';
    const p = spawn(
      soxBin,
      ['--buffer', '1024', '-t', 'waveaudio', dev, '-r', '16000', '-c', '1', '-e', 'signed-integer', '-b', '16', '-t', 'raw', '-'],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    p.stdout.on('data', (chunk: Buffer) => {
      if (stopped || !talking || muted || micGated || wsConnect.readyState !== WsClient.OPEN) return;
      if (aec) {
        if (aecOut.length < chunk.length) aecOut = Buffer.alloc(chunk.length);
        const n = aec.processCapture(chunk, aecOut);
        if (n > 0) wsConnect.send(aecOut.subarray(0, n));
        return;
      }
      wsConnect.send(chunk);
    });
    p.once('exit', () => {
      if (mic === p) mic = undefined;
    });
    p.once('error', (err) => {
      handlers.onStatus('error', `mic: ${err.message}`);
    });
    return p;
  };

  const ensurePlayer = (): ChildProcess | undefined => {
    if (player) return player;
    if (!ffplayBin) return undefined;
    const p = spawn(
      ffplayBin,
      ['-nodisp', '-autoexit', '-loglevel', 'error', '-flags', 'low_delay', '-fflags', 'nobuffer', '-probesize', '32', '-analyzeduration', '0', '-f', 's16le', '-ar', '24000', '-ch_layout', 'mono', '-i', '-'],
      { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] }
    );
    let stderrBuf = '';
    p.stderr.on('data', (d: Buffer) => {
      stderrBuf += d.toString();
      if (stderrBuf.length > 2048) stderrBuf = stderrBuf.slice(-2048);
    });
    p.once('exit', () => {
      if (player === p) player = undefined;
      writtenBytes = 0;
      playedBytes = 0;
      lastCaughtUpAt = Date.now();
      if (stderrBuf.trim()) handlers.onStatus('error', `speaker: ${stderrBuf.trim().split('\n')[0]}`);
    });
    p.once('error', (err) => {
      handlers.onStatus('error', `speaker: ${err.message}`);
    });
    if (p.stdin) p.stdin.on('error', () => undefined);
    player = p;
    return p;
  };

  const gateMicWhileAiTalks = (bytes: number): void => {
    writtenBytes += bytes;
    micGated = true;
  };

  const playWatch = setInterval(() => {
    const now = Date.now();
    const target = writtenBytes;
    playedBytes = Math.min(playedBytes + PLAY_BYTES_PER_MS * 40, target);
    if (playedBytes >= target) {
      if (lastCaughtUpAt === 0) lastCaughtUpAt = now;
      micGated = now - lastCaughtUpAt < ROOM_TAIL_MS;
    } else {
      lastCaughtUpAt = 0;
      micGated = true;
    }
  }, 40);
  if (typeof (playWatch as unknown as { unref?: () => void }).unref === 'function') {
    (playWatch as unknown as { unref: () => void }).unref();
  }

  let pingWatch: NodeJS.Timeout | undefined;

  wsConnect.on('open', () => {
    handlers.onStatus('connecting', 'transport open — setting up Gemini Live session');
    sendSetup();
    ensurePlayer(); // Proactively spawn ffplay so there's no startup latency when the AI speaks
    pingWatch = setInterval(() => {
      if (wsConnect.readyState === WsClient.OPEN) wsConnect.ping();
    }, 15000);
  });
  wsConnect.on('message', (data, isBinary) => {
    if (isBinary) {
      const audio = data as Buffer;
      gateMicWhileAiTalks(audio.length);
      aec?.feedRender(audio);
      const p = ensurePlayer();
      if (p && p.stdin) {
        try {
          p.stdin.write(audio);
        } catch {
          /* player died mid-write */
        }
      }
      return;
    }
    let msg: { type?: string; text?: string; state?: string; message?: string; from?: 'user' | 'ai' };
    try {
      msg = JSON.parse(data.toString()) as { type?: string; text?: string; state?: string; message?: string; from?: 'user' | 'ai' };
    } catch {
      return;
    }
    if (msg.type === 'text') {
      handlers.onText(msg.text ?? '', false, msg.from === 'user' ? 'user' : 'ai');
    } else if (msg.type === 'turnComplete') {
      handlers.onText('', true);
    } else if (msg.type === 'status') {
      if (msg.state === 'connected' && !stopped) {
        mic = startMic();
        handlers.onStatus('connected', 'live channel ready — press Talk and speak');
      } else {
        handlers.onStatus(msg.state === 'error' ? 'error' : 'disconnected', msg.message);
      }
    }
  });
  wsConnect.on('close', () => {
    if (stopped) return;
    handlers.onStatus('disconnected', 'channel closed');
  });
  wsConnect.on('error', (err) => {
    handlers.onStatus('error', `channel: ${err.message}`);
  });

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    talking = false;
    if (playWatch) clearInterval(playWatch);
    if (pingWatch) clearInterval(pingWatch);
    writtenBytes = 0;
    playedBytes = 0;
    micGated = false;
    try {
      if (mic && !mic.killed) mic.kill();
    } catch {
      /* gone */
    }
    try {
      if (player && !player.killed) player.kill();
    } catch {
      /* gone */
    }
    try {
      wsConnect.close();
    } catch {
      /* already closed */
    }
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
    setTalking(on: boolean): void {
      talking = on;
    },
    setMuted(on: boolean): void {
      muted = on;
    },
    sendText(text: string): void {
      if (wsConnect.readyState === WsClient.OPEN) {
        wsConnect.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } }));
      }
    },
    stop
  };
}