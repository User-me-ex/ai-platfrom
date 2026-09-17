'use strict';
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

const fakeVscode = {
  Uri: { file: (p) => ({ fsPath: p }) },
  workspace: {
    fs: {
      createDirectory: async (uri) => { fs.mkdirSync(uri.fsPath, { recursive: true }); },
      writeFile: async (uri, data) => { fs.writeFileSync(uri.fsPath, Buffer.from(data)); }
    }
  }
};
const orig = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'vscode') return fakeVscode;
  return orig.apply(this, arguments);
};

const chat = require('./out/src/chat.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-probe-'));

(async () => {
  const roots = [dir];
  console.log('--- agentSystem banner ---');
  console.log(chat.agentSystem(roots).split('\n').slice(0, 4).join('\n'));

  const r = await chat.executeTools(`<antigravity:file path="probe.md"></antigravity:file>`, roots);
  console.log('--- tool result ---');
  console.log(JSON.stringify(r));
  const abs = path.join(dir, 'probe.md');
  console.log('exists on disk:', fs.existsSync(abs), fs.existsSync(abs) ? `size=${fs.statSync(abs).size}` : '');

  const multi = await chat.executeTools(`<antigravity:file path="sub/deep.txt">hi</antigravity:file>`, roots);
  console.log('--- nested ---');
  console.log(JSON.stringify(multi));
  console.log('nested exists:', fs.existsSync(path.join(dir, 'sub', 'deep.txt')));

  process.exit(0);
})().catch((e) => { console.error('FAIL:', e); process.exit(1); });