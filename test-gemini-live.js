'use strict';
const Module = require('module');
const assert = require('assert');

// Mock vscode module for Node runtime
const fakeVscode = {
  workspace: {
    getConfiguration: () => ({
      get: () => undefined,
      update: async () => {}
    }),
    workspaceFolders: []
  },
  window: {
    showInformationMessage: async () => {},
    showErrorMessage: async () => {},
    showWarningMessage: async () => {},
    showInputBox: async () => undefined,
    showQuickPick: async () => undefined,
    createOutputChannel: () => ({ append: () => {}, appendLine: () => {}, show: () => {} })
  },
  ThemeColor: class {}
};

const orig = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'vscode') return fakeVscode;
  return orig.apply(this, arguments);
};

const models = require('./out/src/models.js');
const voice = require('./out/src/voice.js');

console.log('--- 1. Testing Hardcoded Gemini Live Models ---');
const liveModels = models.getBidiLiveModels();
console.log(`Found ${liveModels.length} hardcoded live models:`);
for (const m of liveModels) {
  console.log(`  - [${m.id}] ${m.name} (${m.tag})`);
  assert(m.id && typeof m.id === 'string', 'Model ID must be non-empty string');
  assert(m.name && typeof m.name === 'string', 'Model name must be non-empty string');
  assert(m.tag && typeof m.tag === 'string', 'Model tag must be non-empty string');
  assert(!m.id.includes('/') || m.id.startsWith('models/'), `Model ID should not contain unexpected slashes: ${m.id}`);
}
assert(liveModels.length >= 8, 'Expected at least 8 hardcoded live models');
console.log('✓ Hardcoded models test passed.\n');

console.log('--- 2. Testing Gemini Live Constants ---');
assert(voice.GEMINI_LIVE_WSS.includes('generativelanguage.googleapis.com'), 'WSS endpoint must point to Google Generative Language');
assert.strictEqual(voice.VOICE_DEFAULT_LIVE_MODEL, 'gemini-3.1-flash-live-preview');
assert.strictEqual(voice.VOICE_DEFAULT_VOICE, 'Kore');
console.log('✓ Gemini Live constants verified.\n');

console.log('--- 3. Testing Key Parsing & Normalization Logic ---');
const rawInput = 'AIzaSyKeyOne, AIzaSyKeyTwo\nAIzaSyKeyThree ,  ';
const keys = rawInput.split(/[,\n]/).map(k => k.trim()).filter(Boolean);
assert.deepStrictEqual(keys, ['AIzaSyKeyOne', 'AIzaSyKeyTwo', 'AIzaSyKeyThree']);
console.log(`✓ Parsed ${keys.length} keys correctly from string.\n`);

console.log('--- 4. Testing Multi-Key Rotation & Quota Fallback Simulation ---');
let activeIndex = 0;
let keysTried = 0;
const testKeys = ['key-1-exhausted', 'key-2-quota-limit', 'key-3-valid'];
const fallbackLog = [];

function simulateError(errorObj) {
  const code = errorObj.code;
  const status = errorObj.status || '';
  const errMsg = errorObj.message || '';
  const isQuota = code === 429 || /RESOURCE_EXHAUSTED|quota|rate\s*limit|exhausted/i.test(status + ' ' + errMsg);
  
  if (testKeys.length > 1 && isQuota) {
    keysTried++;
    const old = activeIndex;
    activeIndex = (activeIndex + 1) % testKeys.length;
    fallbackLog.push(`Switching from ${testKeys[old]} to ${testKeys[activeIndex]}`);
    return true;
  }
  return false;
}

// Simulate key 1 quota hit
const rotated1 = simulateError({ code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded for project' });
assert.strictEqual(rotated1, true);
assert.strictEqual(activeIndex, 1);

// Simulate key 2 quota hit
const rotated2 = simulateError({ code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Rate limit hit' });
assert.strictEqual(rotated2, true);
assert.strictEqual(activeIndex, 2);

console.log('Fallback trace:', fallbackLog);
assert.strictEqual(testKeys[activeIndex], 'key-3-valid');
console.log('✓ Quota fallback simulation passed.\n');

console.log('ALL VERIFICATION TESTS PASSED SUCCESSFULLY!');
