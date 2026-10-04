'use strict';
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Setup mock vscode for runtime
const fakeVscode = {
  Uri: { file: (p) => ({ fsPath: p }) },
  workspace: {
    workspaceFolders: [],
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
    showTextDocument: async () => {},
    showInformationMessage: async () => {}
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

const BASE_URL = 'http://127.0.0.1:20128/v1';
const MODEL = 'ag/gemini-3.8-flash-high';

async function runTurn(userPrompt, testDir, roots, messages) {
  console.log(`\n💬 User: "${userPrompt}"`);
  messages.push({ role: 'user', content: userPrompt });

  const allToolResults = [];

  for (let guard = 0; guard < 5; guard++) {
    console.log(`\n🤖 Model turn ${guard + 1} streaming:`);
    const res = await chat.streamCompletion(
      {
        baseUrl: BASE_URL,
        model: MODEL,
        messages,
        temperature: 0.2,
        tools: chat.ANTIGRAVITY_TOOLS
      },
      (t) => process.stdout.write(t)
    );
    console.log('\n');

    const raw = res.content;
    const toolCalls = res.toolCalls || [];
    const hasXml = chat.hasToolBlocks(raw);
    const hasNative = toolCalls.length > 0;

    console.log(`[Diagnostic guard=${guard}] toolCalls count: ${toolCalls.length}, hasXmlBlocks: ${hasXml}`);

    if (!hasXml && !hasNative) {
      messages.push({ role: 'assistant', content: raw });
      break;
    }

    console.log('⚡ Executing tools...');
    const toolResults = await chat.executeTools(raw, roots, undefined, toolCalls);
    allToolResults.push(...toolResults);
    for (const r of toolResults) {
      console.log(`  -> [${r.tool}] ${r.args}`);
      console.log('     Output:\n' + r.output.split('\n').map(l => '       ' + l).join('\n'));
    }

    if (hasNative) {
      messages.push({
        role: 'assistant',
        content: raw,
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
        }))
      });
      for (let i = 0; i < toolCalls.length; i++) {
        const tc = toolCalls[i];
        const tr = toolResults[i];
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.name,
          content: tr ? tr.output : '[done]'
        });
      }
    } else {
      messages.push({ role: 'assistant', content: raw });
      const feed = toolResults
        .map(r => `<antigravity:tool_result tool="${r.tool}" args="${r.args}">\n${r.output}\n</antigravity:tool_result>`)
        .join('\n');
      messages.push({ role: 'user', content: feed });
    }
  }

  return { toolResults: allToolResults };
}

(async () => {
  console.log('====================================================');
  console.log(`Testing Extension in Text Mode against Live 9Router`);
  console.log(`Gateway: ${BASE_URL} | Model: ${MODEL}`);
  console.log('====================================================');

  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-live-text-'));
  const roots = [testDir];

  // Seed sample file
  const testFile = path.join(testDir, 'sample-code.txt');
  fs.writeFileSync(
    testFile,
    'Line 1: system start\nLine 2: ANTIGRAVITY_AGENT_PROBE_SEARCH_KEY = "alpha_mode";\nLine 3: beta_mode = 42;\nLine 4: system finish\n'
  );

  const system = chat.agentSystem(roots);
  const messages = [{ role: 'system', content: system }];

  // 1. Test Search
  console.log('\n--- TEST 1: WORKSPACE SEARCH (grep_search) ---');
  const t1 = await runTurn(
    'Search for the term "ANTIGRAVITY_AGENT_PROBE_SEARCH_KEY" in the workspace.',
    testDir,
    roots,
    messages
  );
  const searchExecuted = t1.toolResults.some(r => r.tool === 'grep_search' || r.tool === 'search');
  console.log(`TEST 1 RESULT: ${searchExecuted ? 'PASSED ✅' : 'FAILED ❌'}`);

  // 2. Test File Read
  console.log('\n--- TEST 2: VIEW FILE (view_file / read) ---');
  const t2 = await runTurn(
    'Read lines 1 to 4 of sample-code.txt.',
    testDir,
    roots,
    messages
  );
  const readExecuted = t2.toolResults.some(r => r.tool === 'view_file' || r.tool === 'read');
  console.log(`TEST 2 RESULT: ${readExecuted ? 'PASSED ✅' : 'FAILED ❌'}`);

  // 3. Test File Write / Create
  console.log('\n--- TEST 3: WRITE FILE (write_to_file / file) ---');
  const t3 = await runTurn(
    'Create a new file named "live-created.txt" with the content "Hello from 9 Router agent".',
    testDir,
    roots,
    messages
  );
  const createdPath = path.join(testDir, 'live-created.txt');
  const fileExists = fs.existsSync(createdPath);
  console.log(`TEST 3 RESULT: ${fileExists ? 'PASSED ✅ (file created on disk)' : 'FAILED ❌'}`);
  if (fileExists) console.log('File content:', JSON.stringify(fs.readFileSync(createdPath, 'utf8')));

  // 4. Test Multi-edit / Replace
  console.log('\n--- TEST 4: EDIT FILE (multi_replace_file_content or replace_file_content) ---');
  const t4 = await runTurn(
    'In sample-code.txt, replace "alpha_mode" with "ALPHA_ACTIVE" and replace "beta_mode" with "BETA_ACTIVE".',
    testDir,
    roots,
    messages
  );
  const updatedText = fs.readFileSync(testFile, 'utf8');
  const editApplied = updatedText.includes('ALPHA_ACTIVE') || updatedText.includes('BETA_ACTIVE');
  console.log(`TEST 4 RESULT: ${editApplied ? 'PASSED ✅ (file edited on disk)' : 'FAILED ❌'}`);
  console.log('Updated sample-code.txt:\n' + updatedText);

  // 5. Test Web Fetch / read_url_content
  console.log('\n--- TEST 5: WEB FETCH (read_url_content / fetch) ---');
  const t5 = await runTurn(
    'Fetch and read the web URL "http://127.0.0.1:20128/v1/models" to inspect available models.',
    testDir,
    roots,
    messages
  );
  const fetchExecuted = t5.toolResults.some(r => r.tool === 'read_url_content' || r.tool === 'fetch');
  console.log(`TEST 5 RESULT: ${fetchExecuted ? 'PASSED ✅' : 'FAILED ❌'}`);

  // 6. Test Interactive Question / ask_question
  console.log('\n--- TEST 6: ASK QUESTION (ask_question / question) ---');
  fakeVscode.window.showQuickPick = async (items) => items[0];
  fakeVscode.window.showInputBox = async () => 'PostgreSQL';
  const t6 = await runTurn(
    'Ask me which database engine to select between PostgreSQL and SQLite.',
    testDir,
    roots,
    messages
  );
  const questionExecuted = t6.toolResults.some(r => r.tool === 'ask_question' || r.tool === 'question');
  console.log(`TEST 6 RESULT: ${questionExecuted ? 'PASSED ✅' : 'FAILED ❌'}`);

  // 7. Test Directory Listing / list_dir
  console.log('\n--- TEST 7: DIRECTORY LISTING (list_dir / list) ---');
  const t7 = await runTurn(
    'List all files and directories in the workspace.',
    testDir,
    roots,
    messages
  );
  const listExecuted = t7.toolResults.some(r => r.tool === 'list_dir' || r.tool === 'list');
  console.log(`TEST 7 RESULT: ${listExecuted ? 'PASSED ✅' : 'FAILED ❌'}`);

  // Clean up
  fs.rmSync(testDir, { recursive: true, force: true });

  console.log('\n====================================================');
  console.log('Live Text-Mode Tool Calling Evaluation Summary:');
  console.log(`- Search (grep_search):               ${searchExecuted ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`- Read (view_file):                   ${readExecuted ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`- Write (write_to_file):              ${fileExists ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`- Multi-Edit (multi_replace_content): ${editApplied ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`- Web Fetch (read_url_content):       ${fetchExecuted ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`- Ask Question (ask_question):        ${questionExecuted ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`- List Dir (list_dir):                ${listExecuted ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log('====================================================');
})().catch(e => {
  console.error('Fatal test error:', e);
  process.exit(1);
});
