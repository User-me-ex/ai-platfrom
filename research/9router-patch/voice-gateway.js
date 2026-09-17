// 9Router voice gateway.
// Bridges a local WebSocket at `/voice` to Gemini Live (BidiGenerateContent)
// using the API key of 9Router's active `gemini` (or `vertex`) provider
// connection. Zero npm dependencies (Node built-ins only).
//
// Wire protocol (same contract the Antigravity VS Code extension speaks):
//   client -> router  text  : { setup: { model, systemPrompt?, voice?, temperature?, maxTokens? } }
//   client -> router  binary: raw PCM16 16 kHz mono audio
//   router -> client  binary: raw PCM16 24 kHz mono audio (model reply)
//   router -> client  text  : { type: 'status', state: 'connected' }
//                             { type: 'text', text }
//                             { type: 'turnComplete' }
//                             { type: 'status', state: 'error', message }
'use strict';

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const GEMINI_LIVE_WSS =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

let sqlite = null;
try {
  sqlite = require('node:sqlite');
} catch (_) {
  /* older node — see resolveGeminiKey fallback */
}

const OPERATOR = Symbol('voiceGateway');

function defaultLiveModel() {
  return process.env.ANTIGRAVITY_DEFAULT_LIVE_MODEL || 'gemini-3.1-flash-live-preview';
}

function resolveGeminiKey() {
  if (!sqlite) return '';
  const appData = process.env.APPDATA || '';
  const dbPath = path.join(appData, '9router', 'db', 'data.sqlite');
  if (!appData || !fs.existsSync(dbPath)) return '';
  let db;
  try {
    db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
    const row = db
      .prepare(
        "SELECT data FROM providerConnections WHERE provider IN ('gemini','vertex') AND isActive = 1 ORDER BY CASE provider WHEN 'gemini' THEN 0 ELSE 1 END, priority LIMIT 1"
      )
      .get();
    if (row && typeof row.data === 'string') {
      try {
        const d = JSON.parse(row.data);
        if (typeof d.apiKey === 'string' && d.apiKey.trim()) return d.apiKey.trim();
      } catch (_) {
        /* ignore */
      }
    }
  } catch (_) {
    /* ignore */
  } finally {
    try {
      if (db) db.close();
    } catch (_) {
      /* ignore */
    }
  }
  return '';
}

function sendFrame(socket, opcode, payload) {
  const buf = payload ? (Buffer.isBuffer(payload) ? payload : Buffer.from(payload)) : Buffer.alloc(0);
  const len = buf.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  socket.write(Buffer.concat([header, buf]));
}

function sendText(socket, str) {
  sendFrame(socket, 0x1, Buffer.from(str, 'utf8'));
}

function closeClient(socket, code, reason) {
  try {
    const body = Buffer.alloc(2 + Buffer.byteLength(reason));
    body.writeUInt16BE(code, 0);
    body.write(reason, 2);
    sendFrame(socket, 0x8, body);
  } catch (_) {
    /* ignore */
  }
  setTimeout(() => {
    try {
      socket.end();
    } catch (_) {
      /* ignore */
    }
  }, 20);
}

function buildSetup(msg, voice, temperature, liveModelDefault) {
  const s = (msg && msg.setup) || {};
  const raw = typeof s.model === 'string' && s.model ? s.model : '';
  const seg = String(raw).split('/').pop() || liveModelDefault;
  const model = 'models/' + seg;
  const cfg = {
    temperature: typeof s.temperature === 'number' ? s.temperature : temperature,
    responseModalities: ['AUDIO'],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: typeof s.voice === 'string' && s.voice ? s.voice : voice
        }
      }
    }
  };
  if (typeof s.maxTokens === 'number') cfg.maxOutputTokens = s.maxTokens;
  const out = { setup: { model, generationConfig: cfg, inputAudioTranscription: {}, outputAudioTranscription: {} } };
  if (typeof s.systemPrompt === 'string' && s.systemPrompt) {
    out.setup.systemInstruction = { parts: [{ text: s.systemPrompt }] };
  }
  return JSON.stringify(out);
}

class FrameParser {
  constructor(onMessage, onClose) {
    this._paused = false;
    this._queue = [];
    this._buffer = Buffer.alloc(0);
    this._frag = null;
    this._fragOp = -1;
    this._onMessage = onMessage;
    this._onClose = onClose;
  }

  pushRaw(chunk) {
    if (this._paused) {
      this._queue.push(chunk);
      return;
    }
    this._buffer = this._buffer.length ? Buffer.concat([this._buffer, chunk]) : chunk;
    this._parse();
  }

  _parse() {
    while (true) {
      const b = this._buffer;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const op = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        const hi = b.readUInt32BE(2);
        const lo = b.readUInt32BE(6);
        if (hi !== 0) {
          this._drop(2);
          this._onMessage(0x9, undefined, FrameParser.HUGE);
          continue;
        }
        len = lo;
        off = 10;
      }
      if (len > 0x40000000) {
        this._drop(2);
        this._onMessage(0x9, undefined, FrameParser.HUGE);
        continue;
      }
      let maskKey = null;
      if (masked) {
        if (b.length < off + 4) return;
        maskKey = b.subarray(off, off + 4);
        off += 4;
      }
      if (b.length < off + len) return;
      let payload = b.subarray(off, off + len);
      const consumed = off + len;
      if (masked) {
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i & 3];
      }
      this._drop(consumed);
      if (op === 0x8) {
        this._onClose(payload);
        return;
      }
      if (op === 0x9) {
        this._onMessage(0x9, payload);
        continue;
      }
      if (op === 0xa) {
        continue;
      }
      if (op === 0x0) {
        if (this._frag === null) {
          this._drop(consumed);
          continue;
        }
        this._frag = this._frag.length ? Buffer.concat([this._frag, payload]) : payload;
        if (fin) {
          const msg = this._frag;
          const msgOp = this._fragOp;
          this._frag = null;
          this._fragOp = -1;
          this._onMessage(msgOp, msg);
        }
        continue;
      }
      if (op === 0x1 || op === 0x2) {
        if (fin) {
          this._onMessage(op, payload);
        } else {
          this._frag = payload;
          this._fragOp = op;
        }
        continue;
      }
      // Unknown/RSV opcode — ignore frame.
    }
  }

  _drop(n) {
    this._buffer = this._buffer.length === n ? Buffer.alloc(0) : this._buffer.subarray(n);
  }
}
FrameParser.HUGE = 'HUGE';

let activeSessions = 0;

function startSession(client, head) {
  if (activeSessions >= 1) {
    closeClient(client, 1008, 'only one voice session at a time');
    return;
  }
  activeSessions += 1;
  const key = resolveGeminiKey();
  if (!key) {
    activeSessions -= 1;
    closeClient(client, 1008, 'no active gemini provider in 9Router');
    return;
  }

  let upstream;
  try {
    upstream = new WebSocket(GEMINI_LIVE_WSS + '?key=' + encodeURIComponent(key), undefined);
  } catch (err) {
    activeSessions -= 1;
    try {
      sendText(
        client,
        JSON.stringify({ type: 'status', state: 'error', message: 'upstream WebSocket unavailable: ' + (err && err.message) })
      );
    } catch (_) {
      /* ignore */
    }
    closeClient(client, 1011, 'upstream unavailable');
    return;
  }

  let opened = false;
  let closed = false;
  let pendingSetup = null;
  let preopenFrames = [];
  let lastErrorReason = 'Gemini Live closed the channel';
  let lastDownAudioAt = 0;
  // Client now gates on actual playback, so this is just a final anti-loop net.
  const ECHO_GUARD_MS = 500;

  const teardown = (sendErr) => {
    if (closed) return;
    closed = true;
    try {
      if (upstream && (upstream.readyState === 0 || upstream.readyState === 1)) upstream.close();
    } catch (_) {
      /* ignore */
    }
    try {
      if (sendErr) {
        sendText(client, JSON.stringify({ type: 'status', state: 'error', message: sendErr }));
      }
      closeClient(client, 1011, sendErr || lastErrorReason);
    } catch (_) {
      /* ignore */
    }
    activeSessions -= 1;
  };

  try {
    upstream.binaryType = 'arraybuffer';
  } catch (_) {
    /* default */
  }

  upstream.onopen = () => {
    opened = true;
    if (pendingSetup) {
      try {
        upstream.send(pendingSetup);
      } catch (err) {
        teardown('Gemini Live: ' + (err && err.message));
      }
      pendingSetup = null;
    }
    const queued = preopenFrames;
    preopenFrames = [];
    for (const [kind, payload] of queued) {
      if (closed) break;
      try {
        if (kind === 't') {
          upstream.send(payload);
        } else {
          upstream.send(
            JSON.stringify({
              realtimeInput: {
                audio: { mimeType: 'audio/pcm;rate=16000', data: payload.toString('base64') }
              }
            })
          );
        }
      } catch (err) {
        teardown('Gemini Live: ' + (err && err.message));
        break;
      }
    }
  };

  upstream.onmessage = (evt) => {
    if (closed) return;
    const data = evt && evt.data;
    let str = null;
    let buf = null;
    if (typeof data === 'string') {
      str = data;
    } else if (data instanceof ArrayBuffer) {
      buf = Buffer.from(data);
    } else if (Buffer.isBuffer(data)) {
      buf = data;
    } else if (data && typeof data.arrayBuffer === 'function') {
      data
        .arrayBuffer()
        .then((ab) => {
          if (!closed) handleUpstreamBytes(Buffer.from(ab));
        })
        .catch(() => undefined);
      return;
    }
    if (str !== null) {
      handleUpstreamBytes(Buffer.from(str, 'utf8'), true);
      return;
    }
    if (buf && buf.length) handleUpstreamBytes(buf, false);
  };

  function handleUpstreamBytes(bytes, wasTextFrame) {
    if (closed) return;
    if (process.env.VOICE_GATEWAY_DEBUG) {
      try {
        console.error('[voice-gateway upstream] frames=' + bytes.subarray(0, 160).toString('utf8').replace(/\n/g, '\\n'));
      } catch (_) {
        /* ignore */
      }
    }
    let f = null;
    if (wasTextFrame) {
      try {
        f = JSON.parse(bytes.toString('utf8'));
      } catch (_) {
        /* ignore non-json text */
      }
      if (!f) return;
    } else if (bytes.length) {
      const first = bytes[0];
      const looksJson = first === 0x7b || first === 0x5b || first === 0x22;
      if (looksJson) {
        try {
          f = JSON.parse(bytes.toString('utf8'));
        } catch (_) {
          f = null;
        }
      }
      if (!f) {
        if (process.env.VOICE_GATEWAY_DEBUG) {
          try {
            console.error('[voice-gateway upstream binary] len=' + bytes.length + ' hex=' + bytes.subarray(0, 32).toString('hex'));
          } catch (_) {
            /* ignore */
          }
        }
        try {
          sendFrame(client, 0x2, bytes);
        } catch (_) {
          /* ignore */
        }
        return;
      }
    }
    if (!f) return;
    if (f && f.error) {
      const msg = String((f.error.status || '') + ' ' + (f.error.message || 'Gemini Live error')).trim();
      teardown(msg);
      return;
    }
    if (f && f.setupComplete) {
      try {
        sendText(client, JSON.stringify({ type: 'status', state: 'connected' }));
      } catch (_) {
        /* ignore */
      }
      return;
    }
    if (f && f.goAway) {
      teardown('Gemini Live goAway: ' + (f.goAway.reason || ''));
      return;
    }
    const sc = f && f.serverContent;
    if (sc && sc.modelTurn && Array.isArray(sc.modelTurn.parts)) {
      for (const part of sc.modelTurn.parts) {
        if (!part) continue;
        if (part.text) {
          try {
            sendText(client, JSON.stringify({ type: 'text', text: part.text, from: 'ai' }));
          } catch (_) {
            /* ignore */
          }
        }
        if (part.inlineData && typeof part.inlineData.data === 'string') {
          try {
            const audio = Buffer.from(part.inlineData.data, 'base64');
            if (audio.length) {
              lastDownAudioAt = Date.now();
              sendFrame(client, 0x2, audio);
            }
          } catch (_) {
            /* ignore */
          }
        }
      }
    }
    if (sc && sc.inputTranscription && typeof sc.inputTranscription.text === 'string' && sc.inputTranscription.text) {
      try {
        sendText(client, JSON.stringify({ type: 'text', text: sc.inputTranscription.text, from: 'user' }));
      } catch (_) {
        /* ignore */
      }
    }
    if (sc && sc.outputTranscription && typeof sc.outputTranscription.text === 'string' && sc.outputTranscription.text) {
      try {
        sendText(client, JSON.stringify({ type: 'text', text: sc.outputTranscription.text, from: 'ai' }));
      } catch (_) {
        /* ignore */
      }
    }
    if (f && f.turnComplete) {
      lastDownAudioAt = Date.now();
      try {
        sendText(client, JSON.stringify({ type: 'turnComplete' }));
      } catch (_) {
        /* ignore */
      }
    }
  }

  upstream.onerror = () => {
    lastErrorReason = 'Gemini Live connection failed';
  };

  upstream.onclose = (evt) => {
    lastErrorReason =
      'Gemini Live closed: code=' +
      (evt && typeof evt.code === 'number' ? evt.code : '?') +
      ' reason=' +
      (evt && evt.reason ? JSON.stringify(evt.reason) : '""') +
      (evt && evt.wasClean === false ? ' (unclean)' : '');
    if (!closed && (!evt || evt.code !== 1000)) {
      teardown(lastErrorReason);
    } else {
      teardown();
    }
  };

  const parser = new FrameParser(
    (op, payload, flag) => {
      if (flag === FrameParser.HUGE) return;
      if (closed) return;
      if (op === 0x9) {
        // Ping -> pong
        try {
          sendFrame(client, 0xa, payload || Buffer.alloc(0));
        } catch (_) {
          /* ignore */
        }
        return;
      }
      if (op === 0x1) {
        let msg;
        try {
          msg = JSON.parse(payload.toString());
        } catch (_) {
          return;
        }
        if (msg && msg.setup && typeof msg.setup === 'object') {
          const body = buildSetup(msg, 'Kore', 0.5, defaultLiveModel());
          if (opened) {
            try {
              upstream.send(body);
            } catch (err) {
              teardown('Gemini Live: ' + (err && err.message));
            }
          } else {
            pendingSetup = body;
          }
          return;
        }
        if (opened) {
          try {
            upstream.send(payload.toString());
          } catch (err) {
            teardown('Gemini Live: ' + (err && err.message));
          }
        } else if (preopenFrames.length < 200) {
          preopenFrames.push(['t', payload.toString()]);
        }
        return;
      }
      if (op === 0x2) {
        if (opened && Date.now() - lastDownAudioAt < ECHO_GUARD_MS) {
          return;
        }
        if (opened) {
          try {
            upstream.send(
              JSON.stringify({
                realtimeInput: {
                  audio: { mimeType: 'audio/pcm;rate=16000', data: payload.toString('base64') }
                }
              })
            );
          } catch (err) {
            teardown('Gemini Live: ' + (err && err.message));
          }
        } else if (preopenFrames.length < 200) {
          preopenFrames.push(['b', payload]);
        }
      }
    },
    (_payload) => {
      if (closed) return;
      try {
        if (upstream && (upstream.readyState === 0 || upstream.readyState === 1)) upstream.close();
      } catch (_) {
        /* ignore */
      }
      closed = true;
      activeSessions -= 1;
      try {
        client.end();
      } catch (_) {
        /* ignore */
      }
    }
  );

  client.on('data', (chunk) => parser.pushRaw(chunk));
  if (Buffer.isBuffer(head) && head.length) parser.pushRaw(head);
  client.on('end', () => {
    if (closed) return;
    closed = true;
    try {
      if (upstream && (upstream.readyState === 0 || upstream.readyState === 1)) upstream.close();
    } catch (_) {
      /* ignore */
    }
    activeSessions -= 1;
  });
  client.on('close', () => {
    if (closed) return;
    closed = true;
    try {
      if (upstream && (upstream.readyState === 0 || upstream.readyState === 1)) upstream.close();
    } catch (_) {
      /* ignore */
    }
    activeSessions -= 1;
  });
  client.on('error', () => {
    /* socket error — close path handles cleanup */
  });
}

function handleUpgrade(req, socket, head) {
  const isWebSocket = String(req.headers.upgrade || '').toLowerCase() === 'websocket';
  const urlPath = String(req.url || '').split('?')[0];
  if (urlPath !== '/voice' || !isWebSocket || !req.headers['sec-websocket-key']) {
    try {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    } catch (_) {
      /* ignore */
    }
    try {
      socket.destroy();
    } catch (_) {
      /* ignore */
    }
    return;
  }
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + WS_MAGIC).digest('base64');
  let extras = '';
  if (req.headers['sec-websocket-protocol']) {
    const first = String(req.headers['sec-websocket-protocol']).split(',')[0].trim();
    if (first) extras += 'Sec-WebSocket-Protocol: ' + first + '\r\n';
  }
  try {
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Accept: ' +
        accept +
        '\r\n' +
        extras +
        '\r\n'
    );
  } catch (_) {
    try {
      socket.destroy();
    } catch (_) {
      /* ignore */
    }
    return;
  }
  if (Buffer.isBuffer(head) && head.length) {
    startSession(socket, head);
  } else {
    startSession(socket);
  }
}

module.exports = { OPERATOR, handleUpgrade, resolveGeminiKey, FrameParser, sendFrame, defaultLiveModel, buildSetup };