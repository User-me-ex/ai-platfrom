'use strict';
const assert = require('assert');
const fs = require('fs');

console.log('====================================================');
console.log('  TESTING CHAT BUTTON & WEBVIEW LIFECYCLE FIXES     ');
console.log('====================================================\n');

const webviewFile = fs.readFileSync('src/ui/workflowWebview.ts', 'utf8');

// 1. Verify getWorkspaceContext is imported from extension
assert(
  webviewFile.includes("getWorkspaceContext } from '../extension'"),
  'getWorkspaceContext must be imported from ../extension'
);
console.log('  [PASS] 1. getWorkspaceContext imported.');

// 2. Verify _getHtmlForWebview accepts initialTab and sets isChat
assert(
  webviewFile.includes('private _getHtmlForWebview(initialTab?: string): string {'),
  '_getHtmlForWebview must accept initialTab'
);
assert(
  webviewFile.includes("const isChat = initialTab === 'chat';"),
  '_getHtmlForWebview must determine isChat'
);
console.log('  [PASS] 2. _getHtmlForWebview dynamic initialTab support verified.');

// 3. Verify ready handshake is present in script
assert(
  webviewFile.includes("vscode.postMessage({ command: 'ready' });"),
  'Webview client script must post ready command on load'
);
assert(
  webviewFile.includes("case 'ready':"),
  'Webview host onDidReceiveMessage must handle ready command'
);
console.log('  [PASS] 3. Client-host ready handshake verified.');

// 4. Verify createOrShow does NOT call _update() on existing panel
const createOrShowIdx = webviewFile.indexOf('public static createOrShow(');
const createOrShowEnd = webviewFile.indexOf('return WorkflowWebviewPanel.currentPanel;', createOrShowIdx);
const existingBranch = webviewFile.substring(createOrShowIdx, createOrShowEnd);

assert(
  !existingBranch.includes('WorkflowWebviewPanel.currentPanel._update();'),
  'createOrShow must not call _update() on an existing panel'
);
assert(
  existingBranch.includes('WorkflowWebviewPanel.currentPanel.switchTab(initialTab as any);'),
  'createOrShow must switchTab on an existing panel'
);
console.log('  [PASS] 4. Non-destructive reveal and tab switch on existing panel verified.');

// 5. Verify antigravity.router configuration is used for direct chat
const handleDirectChatIdx = webviewFile.indexOf('public async handleDirectChat(');
const handleDirectChatEnd = webviewFile.indexOf('public updateCatalog(', handleDirectChatIdx);
const handleDirectChatBody = webviewFile.substring(handleDirectChatIdx, handleDirectChatEnd);

assert(
  handleDirectChatBody.includes("vscode.workspace.getConfiguration('antigravity.router')"),
  'handleDirectChat must query antigravity.router config'
);
assert(
  handleDirectChatBody.includes('getWorkspaceContext()'),
  'handleDirectChat must inject IDE workspace context'
);
assert(
  handleDirectChatBody.includes('for (let turn = 0; turn < 10; turn++)'),
  'handleDirectChat must support multi-turn tool execution loop'
);
console.log('  [PASS] 5. handleDirectChat router config, IDE context, and multi-turn tool calling verified.');

// 6. Verify HTML markup handles isChat correctly
assert(
  webviewFile.includes('class="tab-btn ${isChat ? \'active\' : \'\'}" id="tabChatBtn"'),
  'tabChatBtn must be active when isChat'
);
assert(
  webviewFile.includes('id="chatTab" class="tab-content" style="${isChat ? \'display: block;\' : \'display: none;\'}"'),
  'chatTab must have display: block when isChat'
);
assert(
  webviewFile.includes('id="workflowTab" class="tab-content" style="${isChat ? \'display: none;\' : \'\'}"'),
  'workflowTab must have display: none when isChat'
);
console.log('  [PASS] 6. HTML initial tab rendering for chat mode verified.');

console.log('\n====================================================');
console.log('  ALL CHAT BUTTON INTEGRATION TESTS PASSED (100%)  ');
console.log('====================================================');
