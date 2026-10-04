'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Module = require('module');

// Mock vscode
const fakeWorkspaceState = new Map();
const fakeConfig = {
  'antigravity.session.resumeOnOpen': true,
  'antigravity.session.persistHistory': true,
  'antigravity.session.unifiedVoiceAndText': true,
  'antigravity.session.maxPersistedTurns': 50
};

const tmpTestDir = path.join(os.tmpdir(), 'antigravity-session-test-' + Date.now());
fs.mkdirSync(tmpTestDir, { recursive: true });

const fakeVscode = {
  workspace: {
    workspaceFolders: [{ uri: { fsPath: tmpTestDir } }],
    getConfiguration: (section) => ({
      get: (key, def) => {
        const full = `${section}.${key}`;
        if (full in fakeConfig) return fakeConfig[full];
        return def;
      },
      update: async (key, val) => {
        fakeConfig[`${section}.${key}`] = val;
      }
    })
  },
  ExtensionContext: class {},
  window: {
    showInformationMessage: async () => {},
    showWarningMessage: async () => 'Clear All'
  },
  ConfigurationTarget: { Global: 1, Workspace: 2 }
};

const fakeContext = {
  workspaceState: {
    get: (key, def) => (fakeWorkspaceState.has(key) ? fakeWorkspaceState.get(key) : def),
    update: async (key, val) => {
      if (val === undefined) fakeWorkspaceState.delete(key);
      else fakeWorkspaceState.set(key, val);
    }
  }
};

const orig = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'vscode') return fakeVscode;
  return orig.apply(this, arguments);
};

// Require compiled sessionManager
const { SessionManager } = require('./out/src/session/sessionManager.js');

async function runTests() {
  console.log('🧪 Starting Session Persistence & Resumption Tests...\n');

  // Test 1: Initialization
  console.log('1. Testing SessionManager initialization...');
  const sm = SessionManager.initialize(fakeContext);
  assert(sm, 'SessionManager should be initialized');
  const sess1 = sm.getActiveSession();
  assert(sess1 && sess1.id, 'Active session should be created');
  assert.strictEqual(sess1.chatMessages.length, 0, 'New session starts empty');
  console.log('   ✓ Session initialized with ID:', sess1.id);

  // Test 2: Appending Text Chat Messages
  console.log('2. Testing Text Chat message appending & delta streaming...');
  sm.appendWebviewMessage({
    id: 'msg_1',
    sender: 'user',
    content: 'Can you implement authentication using JWT?',
    timestamp: '10:00:00'
  });
  sm.appendWebviewMessage({
    id: 'msg_2',
    sender: 'ai',
    roleModel: 'ag/gemini-3.8-flash-high',
    content: 'Sure! I will generate ',
    timestamp: '10:00:01'
  });
  sm.appendChatDelta('msg_2', 'the auth routes and jwt verification helper.');

  sm.appendChatHistory({
    role: 'user',
    content: 'Can you implement authentication using JWT?'
  });
  sm.appendChatHistory({
    role: 'assistant',
    content: 'Sure! I will generate the auth routes and jwt verification helper.'
  });

  sm.flushSync();
  const activeSessAfterText = sm.getActiveSession();
  assert.strictEqual(activeSessAfterText.chatMessages.length, 2);
  assert.strictEqual(activeSessAfterText.chatMessages[1].content, 'Sure! I will generate the auth routes and jwt verification helper.');
  console.log('   ✓ Text messages and delta streaming persisted correctly');

  // Test 3: Appending Voice Mode Turns
  console.log('3. Testing Voice Mode turn recording & cross-mode synchronization...');
  sm.appendVoiceTurn('Also add a bcrypt password hasher', 'user');
  sm.appendWebviewMessage({
    id: 'voice_turn_1',
    sender: 'voice',
    from: 'user',
    content: 'Also add a bcrypt password hasher',
    timestamp: '10:00:10'
  });
  sm.appendVoiceTurn('Got it, I will add bcrypt hashing with salt rounds.', 'ai');
  sm.appendWebviewMessage({
    id: 'voice_turn_2',
    sender: 'voice',
    from: 'ai',
    content: 'Got it, I will add bcrypt hashing with salt rounds.',
    timestamp: '10:00:15'
  });

  sm.flushSync();
  assert.strictEqual(sm.getActiveSession().voiceTurns.length, 2);
  console.log('   ✓ Voice turns recorded to session');

  // Test 4: Voice Resumption Context Generation
  console.log('4. Testing getResumeContext() for Gemini Live & Text resumption...');
  const resumeContext = sm.getResumeContext();
  assert(resumeContext.includes('[RESUMED CONVERSATION CONTEXT'), 'Context header should be present');
  assert(resumeContext.includes('authentication using JWT'), 'Text message should be in resume context');
  assert(resumeContext.includes('bcrypt password hasher'), 'Voice message should be in resume context');
  console.log('   ✓ getResumeContext() formatted smoothly:');
  console.log('--------------------------------------------------');
  console.log(resumeContext);
  console.log('--------------------------------------------------');

  // Test 5: Simulating Chat Close & Reopen (Re-instantiation)
  console.log('5. Testing Chat Close & Reopening ("Start where I closed the chat")...');
  // Reset memory instance and re-initialize from storage
  SessionManager['instance'] = undefined;
  const sm2 = SessionManager.initialize(fakeContext);
  const restoredSess = sm2.getActiveSession();
  assert.strictEqual(restoredSess.id, sess1.id, 'Should restore the exact active session ID');
  assert.strictEqual(restoredSess.chatMessages.length, 4, 'Should restore all 4 messages (text + voice)');
  assert.strictEqual(restoredSess.chatHistory.length, 4, 'Should restore LLM chat history turns');
  assert.strictEqual(restoredSess.voiceTurns.length, 2, 'Should restore voice turn audio records');
  console.log('   ✓ Conversation restored from storage without loss: 4 messages, 4 LLM turns, 2 voice turns');

  // Test 6: Creating a New Session while preserving past session in list
  console.log('6. Testing createNewSession() & Session Switching...');
  const sess2 = sm2.createNewSession('ag/claude-opus-4-6-thinking', 'Session 2: Testing');
  assert.notStrictEqual(sess2.id, sess1.id, 'New session should have a distinct ID');
  assert.strictEqual(sess2.chatMessages.length, 0, 'New session starts clean');

  const sessionList = sm2.listSessions();
  assert(sessionList.length >= 2, 'Should list both sessions');
  console.log('   ✓ Session list contains', sessionList.length, 'sessions');

  // Switch back to session 1
  const switchedBack = sm2.switchSession(sess1.id);
  assert.strictEqual(switchedBack.id, sess1.id, 'Should switch back to session 1');
  assert.strictEqual(switchedBack.chatMessages.length, 4, 'Session 1 still has its 4 messages intact');
  console.log('   ✓ Switched back to previous session seamlessly');

  // Test 7: Export Session to Markdown
  console.log('7. Testing Markdown export...');
  const md = sm2.exportSessionMarkdown(switchedBack);
  assert(md.includes('# Chat Session:'), 'Markdown header should be generated');
  assert(md.includes('User (Voice)'), 'Voice speaker tag should be present');
  console.log('   ✓ Export generated valid markdown');

  // Cleanup temporary test directory
  try {
    fs.rmSync(tmpTestDir, { recursive: true, force: true });
  } catch {}

  console.log('\n🎉 ALL SESSION PERSISTENCE & RESUMPTION TESTS PASSED!\n');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
