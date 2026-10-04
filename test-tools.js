'use strict';
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Mock vscode module for standalone unit testing
const fakeVscode = {
  Uri: { file: (p) => ({ fsPath: p }) },
  workspace: {
    fs: {
      createDirectory: async (uri) => { fs.mkdirSync(uri.fsPath, { recursive: true }); },
      writeFile: async (uri, data) => { fs.writeFileSync(uri.fsPath, Buffer.from(data)); },
      readFile: async (uri) => fs.readFileSync(uri.fsPath),
      readDirectory: async (uri) => {
        return fs.readdirSync(uri.fsPath).map((n) => {
          const isDir = fs.statSync(path.join(uri.fsPath, n)).isDirectory();
          return [n, isDir ? 2 : 1];
        });
      }
    },
    openTextDocument: async (uri) => ({ uri }),
  },
  window: {
    showTextDocument: async () => {}
  },
  commands: {
    executeCommand: async (cmd, ...args) => `ran ${cmd}`
  }
};

const orig = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'vscode') return fakeVscode;
  return orig.apply(this, arguments);
};

const chat = require('./out/src/chat.js');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

(async () => {
  console.log('=== Testing Antigravity Tools Integration ===');

  // Test 1: ANTIGRAVITY_TOOLS schemas
  console.log('\n--- 1. Testing ANTIGRAVITY_TOOLS definitions ---');
  assert(Array.isArray(chat.ANTIGRAVITY_TOOLS), 'ANTIGRAVITY_TOOLS must be an array');
  const toolNames = chat.ANTIGRAVITY_TOOLS.map(t => t.function.name);
  console.log('Available tools:', toolNames.join(', '));
  assert(toolNames.includes('grep_search'), 'must include grep_search');
  assert(toolNames.includes('view_file'), 'must include view_file');
  assert(toolNames.includes('write_to_file'), 'must include write_to_file');
  assert(toolNames.includes('replace_file_content'), 'must include replace_file_content');
  assert(toolNames.includes('multi_replace_file_content'), 'must include multi_replace_file_content');
  assert(toolNames.includes('list_dir'), 'must include list_dir');
  assert(toolNames.includes('run_command'), 'must include run_command');
  assert(toolNames.includes('search_web'), 'must include search_web');
  assert(toolNames.includes('read_url_content'), 'must include read_url_content');

  // Setup sandbox directory
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-test-tools-'));
  const roots = [testDir];

  // Test 2: File creation & Search
  console.log('\n--- 2. Testing grep_search / searchWorkspace ---');
  const f1 = path.join(testDir, 'sample.txt');
  fs.writeFileSync(f1, 'First line\nTarget keyword here\nAnother line\nAnother target keyword here\nEnd of file\n');
  
  const searchRes = await chat.searchWorkspace({ query: 'target keyword', searchPath: testDir }, roots);
  console.log('Search result:\n' + searchRes);
  assert(searchRes.includes('Found 2 matches'), 'search should find 2 matches');
  assert(searchRes.includes('sample.txt:2:'), 'match line 2 must be found');
  assert(searchRes.includes('sample.txt:4:'), 'match line 4 must be found');

  // Test 3: Multi-chunk edit (multi_replace_file_content)
  console.log('\n--- 3. Testing multi_replace_file_content / executeMultiEdit ---');
  const multiRes = await chat.executeMultiEdit(
    'sample.txt',
    [
      { target_content: 'First line', replacement_content: 'Beginning line' },
      { target_content: 'End of file', replacement_content: 'Finish of file' }
    ],
    roots
  );
  console.log('Multi-edit result:', multiRes);
  const updatedContent = fs.readFileSync(f1, 'utf8');
  assert(updatedContent.includes('Beginning line'), 'First chunk replaced');
  assert(updatedContent.includes('Finish of file'), 'Second chunk replaced');
  assert(!updatedContent.includes('First line'), 'Old first line removed');
  assert(!updatedContent.includes('End of file'), 'Old end line removed');

  // Test 4: XML Tool Execution (<antigravity:search> and <antigravity:multi_edit>)
  console.log('\n--- 4. Testing XML Tool Parsing in executeTools ---');
  const xmlSearch = await chat.executeTools('<antigravity:search query="Beginning" />', roots);
  assert(xmlSearch.length === 1, 'expected 1 search tool result');
  assert(xmlSearch[0].tool === 'search', 'tool is search');
  assert(xmlSearch[0].output.includes('Beginning line'), 'output matches content');

  const xmlMultiEdit = await chat.executeTools(
    `<antigravity:multi_edit path="sample.txt">
<<<<
Beginning line
====
Initial line
>>>>
<<<<
Finish of file
====
Final line
>>>>
</antigravity:multi_edit>`,
    roots
  );
  assert(xmlMultiEdit.length === 1, 'expected 1 multi_edit result');
  const contentAfterXml = fs.readFileSync(f1, 'utf8');
  assert(contentAfterXml.includes('Initial line'), 'XML multi_edit applied chunk 1');
  assert(contentAfterXml.includes('Final line'), 'XML multi_edit applied chunk 2');

  // Test 5: Native OpenAI Function Calling execution
  console.log('\n--- 5. Testing Native OpenAI Tool Calls in executeTools ---');
  const nativeCalls = [
    {
      id: 'call_1',
      name: 'grep_search',
      arguments: { query: 'Initial' }
    },
    {
      id: 'call_2',
      name: 'view_file',
      arguments: { path: 'sample.txt', start_line: 1, end_line: 3 }
    }
  ];
  const nativeResults = await chat.executeTools('', roots, undefined, nativeCalls);
  assert(nativeResults.length === 2, 'expected 2 native tool results');
  assert(nativeResults[0].tool === 'grep_search', 'first tool is grep_search');
  assert(nativeResults[0].output.includes('Initial line'), 'grep_search found match');
  assert(nativeResults[1].tool === 'view_file', 'second tool is view_file');
  console.log('view_file numbered output:\n' + nativeResults[1].output);
  assert(nativeResults[1].output.includes('1: Initial line'), 'line numbers are prefixed');

  // Test 6: Voice markup execution
  console.log('\n--- 6. Testing Voice markup tools ---');
  const voiceSearch = await chat.executeTools('TOOL: search Initial\n', roots);
  assert(voiceSearch.length === 1 && voiceSearch[0].tool === 'search', 'voice search parsed');
  assert(voiceSearch[0].output.includes('Initial line'), 'voice search result ok');

  // Test 7: fetchUrlContent / read_url_content
  console.log('\n--- 7. Testing read_url_content / fetchUrlContent ---');
  const http = require('http');
  const mockServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><head><title>Test Page</title></head><body><h1>Hello World</h1><p>Test content for web fetch</p></body></html>');
  });
  await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  const mockPort = mockServer.address().port;
  const fetchRes = await chat.fetchUrlContent(`http://127.0.0.1:${mockPort}/test`);
  mockServer.close();
  console.log('fetchUrlContent output:', fetchRes);
  assert(fetchRes.includes('# Hello World') || fetchRes.includes('Hello World'), 'fetched mock page content');
  assert(fetchRes.includes('Test content for web fetch'), 'contains paragraph content');

  // Test 7b: search_web / searchWeb
  console.log('\n--- 7b. Testing search_web / searchWeb ---');
  const searchWebRes = await chat.searchWeb('typescript 5.5 release notes');
  console.log('searchWeb output (first 150 chars):', searchWebRes.slice(0, 150));
  assert(typeof searchWebRes === 'string' && searchWebRes.length > 0, 'searchWeb returns results');

  // Test 7c: Native search_web tool call
  const webCalls = [{ id: 'call_web_1', name: 'search_web', arguments: { query: 'nodejs express' } }];
  const webResults = await chat.executeTools('', roots, undefined, webCalls);
  assert(webResults.length === 1 && webResults[0].tool === 'search_web', 'native search_web executed');

  // Test 7d: XML web_search tool tag
  const xmlWeb = await chat.executeTools('<antigravity:web_search query="fastify api" />', roots);
  assert(xmlWeb.length === 1 && xmlWeb[0].tool === 'search_web', 'XML web_search tag executed');

  // Test 7e: Voice web_search markup
  const voiceWeb = await chat.executeTools('TOOL: web_search react hooks\n', roots);
  assert(voiceWeb.length === 1 && voiceWeb[0].tool === 'search_web', 'Voice web_search markup executed');

  // Test 8: askUserQuestion / ask_question
  console.log('\n--- 8. Testing ask_question / askUserQuestion ---');
  fakeVscode.window.showInputBox = async () => 'User confirmed requirement';
  fakeVscode.window.showQuickPick = async (items) => items[0];
  const qRes1 = await chat.askUserQuestion('What database to use?', ['PostgreSQL', 'SQLite']);
  assert(qRes1 === 'PostgreSQL', 'quickpick question returns choice');
  const qRes2 = await chat.askUserQuestion('Provide custom input');
  assert(qRes2 === 'User confirmed requirement', 'inputbox question returns string');

  // Cleanup
  fs.rmSync(testDir, { recursive: true, force: true });
  console.log('\n✅ All tool integration tests (including fetch & question) passed successfully!');
})().catch((err) => {
  console.error('FAIL with error:', err);
  process.exit(1);
});