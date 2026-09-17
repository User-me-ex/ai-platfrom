'use strict';
const assert = require('assert');
const gateway = require('C:/Users/USER/AppData/Roaming/npm/node_modules/9router/app/voice-gateway.js');
const { WebSocket } = require('ws');

function maskPayload(payload, maskKey) {
  const out = Buffer.from(payload);
  for (let i = 0; i < out.length; i++) out[i] ^= maskKey[i & 3];
  return out;
}

function buildClientFrame(opcode, payload, fin = true) {
  const mask = Buffer.from([0x11, 0x22, 0x33, 0x44]);
  const masked = maskPayload(payload, mask);
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | len, ...mask]);
  } else if (len < 65536) {
    header = Buffer.alloc(8);
    header[0] = (fin ? 0x80 : 0) | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
    mask.copy(header, 4);
  } else {
    header = Buffer.alloc(14);
    header[0] = (fin ? 0x80 : 0) | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
    mask.copy(header, 10);
  }
  return Buffer.concat([header, masked]);
}

function parseFrames(stream) {
  const messages = [];
  const parser = new gateway.FrameParser((op, payload) => {
    messages.push({ op, payload });
  }, () => {});
  parser.pushRaw(stream);
  return messages;
}

function testCodec() {
  const text = JSON.stringify({ hi: 'there', n: 123 });
  const msgs1 = parseFrames(buildClientFrame(0x1, Buffer.from(text)));
  assert.strictEqual(msgs1.length, 1);
  assert.strictEqual(msgs1[0].op, 0x1);
  assert.strictEqual(msgs1[0].payload.toString(), text);

  const big = Buffer.alloc(70000, 7);
  const msgs2 = parseFrames(buildClientFrame(0x2, big));
  assert.strictEqual(msgs2.length, 1);
  assert.deepStrictEqual(msgs2[0].payload, big);

  const partA = buildClientFrame(0x1, Buffer.from('{"setup":'), false);
  const partB = buildClientFrame(0x0, Buffer.from('{"model":"x"}}'), true);
  const msgs3 = parseFrames(Buffer.concat([partA, partB]));
  assert.strictEqual(msgs3.length, 1);
  assert.strictEqual(msgs3[0].payload.toString(), '{"setup":{"model":"x"}}');
  console.log('codec test PASS (text, 64k+ binary, fragmented)');
}

function testBuildSetup() {
  const out = gateway.defaultLiveModel();
  assert.strictEqual(out.length > 0, true);

  const raw = '{"setup":{"model":"google/gemini-3.1-flash-live-preview","systemPrompt":"be brief","voice":"Puck","temperature":0.7,"maxTokens":1024}}';
  const body = gateway.buildSetup(JSON.parse(raw), 'Kore', 0.5, gateway.defaultLiveModel());
  const obj = JSON.parse(body);
  const s = obj.setup;
  assert.strictEqual(s.model, 'models/gemini-3.1-flash-live-preview');
  assert.deepStrictEqual(s.generationConfig.responseModalities, ['AUDIO']);
  assert.strictEqual(s.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Puck');
  assert.strictEqual(s.generationConfig.temperature, 0.7);
  assert.strictEqual(s.generationConfig.maxOutputTokens, 1024);
  assert.strictEqual(s.systemInstruction.parts[0].text, 'be brief');
  assert.deepStrictEqual(s.inputAudioTranscription, {});
  assert.deepStrictEqual(s.outputAudioTranscription, {});
  console.log('buildSetup test PASS');
}

function testHandshake() {
  return Promise.resolve('handshake covered by test-router-gateway.js (live)');
}

testCodec();
testBuildSetup();
testHandshake().then((m) => {
  console.log(m);
  console.log('OFFLINE GATEWAY TEST PASSED');
  process.exit(0);
}).catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});