'use strict';
const { WebSocket } = require('ws');

const url = process.env.VOICE_ENDPOINT || 'ws://127.0.0.1:20199/voice';
const timeout = Number(process.env.PROBE_TIMEOUT || 45000);

const ws = new WebSocket(url);

const timer = setTimeout(() => {
  console.error('FAIL: probe timed out');
  process.exit(1);
}, timeout);

ws.on('open', () => {
  console.log('open -> sending setup');
  ws.send(JSON.stringify({ setup: { model: 'gemini-3.1-flash-live-preview', voice: 'Kore' } }));
  setTimeout(() => ws.send(JSON.stringify({ realtimeInput: { text: 'Say hi in one word.' } })), 1500);
});

ws.on('message', (data, isBinary) => {
  if (isBinary) {
    console.log('  [binary] PCM bytes:', data.length);
    return;
  }
  let m;
  try {
    m = JSON.parse(data.toString());
  } catch (e) {
    return;
  }
  console.log('  [text]', JSON.stringify(m));
  if (m.type === 'status' && m.state === 'connected') {
    console.log('endpoint /voice connected via patched custom-server');
  } else if (m.type === 'text') {
    clearTimeout(timer);
    console.log('PASS: full-stack /voice round-trip OK');
    ws.close();
    process.exit(0);
  } else if (m.type === 'status' && m.state === 'error') {
    clearTimeout(timer);
    console.error('FAIL: endpoint error:', m.message);
    process.exit(1);
  }
});

ws.on('error', (err) => {
  clearTimeout(timer);
  console.error('FAIL: ws error:', err.message);
  process.exit(1);
});

ws.on('close', (code, reason) => {
  clearTimeout(timer);
  console.error('FAIL: closed early code=' + code + ' reason=' + reason);
  process.exit(1);
});