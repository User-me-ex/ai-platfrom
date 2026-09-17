'use strict';
const fs = require('fs');
const path = require('path');
const { WebSocket } = require('ws');

const URL = process.env.VOICE_ENDPOINT || 'ws://127.0.0.1:20128/voice';
const MODEL = process.env.VOICE_TEST_MODEL || 'gemini-3.1-flash-live-preview';
const PROMPT = process.env.VOICE_PROMPT || 'Say this sentence slowly and clearly: hello, this is a voice test.';
const DURATION = Number(process.env.VOICE_CAPTURE_MS || 12000);
const OUT = path.join(process.env.TEMP || 'C:/Users/USER/AppData/Local/Temp', 'opencode', 'capture.pcm');

(async () => {
  const ws = new WebSocket(URL);
  let connected = false;
  let frames = 0;
  let bytes = 0;
  let startedAt = 0;
  const chunks = [];

  const timer = setTimeout(() => finish('capture window elapsed'), DURATION + 3000);

  function finish(reason) {
    clearTimeout(timer);
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, Buffer.concat(chunks));
    const durMs = bytes / 2 / 24000 * 1000;
    console.log(`audio capture done: ${frames} frames, ${bytes} bytes => ${durMs.toFixed(0)} ms of 24 kHz PCM`);
    console.log(`saved to ${OUT} (${reason})`);
    console.log(frames === 0 ? 'AUDIO FAIL: no binary frames received' : bytes / 2 < 2400 ? 'AUDIO WARN: under 0.1 s of audio' : 'AUDIO OK');
    ws.close();
    process.exit(0);
  }

  ws.on('open', () => {
    console.log('open -> setup');
    ws.send(JSON.stringify({ setup: { model: MODEL, voice: 'Kore', temperature: 0.5 } }));
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      if (frames === 0) { startedAt = Date.now(); console.log('first audio chunk arrived'); }
      if (!connected) return; // ignore any stray early frame
      frames++;
      bytes += data.length;
      if (bytes < 8 * 1024 * 1024) chunks.push(Buffer.from(data));
      return;
    }
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (msg.type === 'status' && msg.state === 'connected') {
      connected = true;
      console.log('connected -> prompting');
      setTimeout(() => ws.send(JSON.stringify({ realtimeInput: { text: PROMPT } })), 500);
    }
  });

  ws.on('error', (e) => { console.error('ws error:', e.message); finish('ws error'); });
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });