/**
 * Offline handshake test for the 9Router voice gateway.
 * Serves the gateway on an ephemeral port and dials it with the `ws` client.
 * Expects: WS handshake OK -> setup accepted -> upstream opens -> Gemini Live
 * acks setupComplete -> status 'connected' received.
 */
'use strict';
const http = require('http');
const path = require('path');

const gatewayPath =
  process.env.NINEROUTER_APP || 'C:/Users/USER/AppData/Roaming/npm/node_modules/9router/app/voice-gateway.js';
const gateway = require(gatewayPath);
const { WebSocket } = require('ws');

const MODEL = process.env.VOICE_TEST_MODEL || 'gemini-3.1-flash-live-preview';
const TIMEOUT_MS = Number(process.env.VOICE_TEST_TIMEOUT || 40000);

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

async function main() {
  console.log('gateway loaded from', gatewayPath);
  console.log('model under test:', MODEL);
  const key = gateway.resolveGeminiKey();
  assert(key.length > 0, 'resolveGeminiKey() returned empty (no active gemini/vertex provider connection)');
  console.log('resolved gemini API key: prefix=' + key.slice(0, 4) + ' len=' + key.length);

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ service: '9router-voice-gateway-test' }));
  });
  server.on('upgrade', (req, socket, head) => gateway.handleUpgrade(req, socket, head));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  console.log('test server ws://127.0.0.1:' + port + '/voice (ephemeral)');

  const url = 'ws://127.0.0.1:' + port + '/voice';
  const ws = new WebSocket(url);

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout — no final status received')), TIMEOUT_MS);

    ws.on('open', () => {
      console.log('client connected -> sending setup');
      ws.send(
        JSON.stringify({
          setup: { model: MODEL, voice: 'Kore', temperature: 0.5 }
        })
      );
      setTimeout(() => {
        ws.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text: 'Say hello in one short word.' }] }], turnComplete: true } }));
      }, 1500);
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        console.log('  [binary] PCM bytes:', data.length);
        return;
      }
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch (e) {
        console.log('  [text?] non-json:', data.toString().slice(0, 80));
        return;
      }
      console.log('  [text]', JSON.stringify(msg));
      if (msg.type === 'status' && msg.state === 'error') {
        clearTimeout(timer);
        reject(new Error('gateway reported error: ' + msg.message));
      } else if (msg.type === 'text') {
        clearTimeout(timer);
        resolve('received model text: ' + msg.text);
      } else if (msg.type === 'turnComplete') {
        // keep waiting — the model usually emits text parts before this
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    ws.on('close', (code, reason) => {
      clearTimeout(timer);
      reject(new Error('closed early code=' + code + ' reason=' + reason));
    });
  });

  console.log('\nPASS: gateway bridged client -> 9Router gemini key -> Gemini Live');
  ws.close();
  server.close();
}

main().catch((err) => {
  console.error('\nFAIL:', err.message);
  process.exit(1);
});