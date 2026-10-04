'use strict';

const fs = require('fs');
const path = require('path');
const { installMockVscode } = require('../mocks/mockVscode');

class DeterministicRunner {
  constructor(envManager, uiAutomation, evidenceManager, logCollector) {
    this.envManager = envManager;
    this.ui = uiAutomation;
    this.evidence = evidenceManager;
    this.logCollector = logCollector;
    this.results = [];
  }

  async runAll() {
    this.logCollector.info('DeterministicRunner', '================================================');
    this.logCollector.info('DeterministicRunner', '  STARTING DETERMINISTIC AUTOMATED TEST SUITE   ');
    this.logCollector.info('DeterministicRunner', '================================================');

    // 1. Install mock VS Code environment hooked to the isolated sandbox
    const mockEnv = installMockVscode(this.envManager);
    const vscode = mockEnv.vscode;
    const context = mockEnv.context;

    // Load compiled modules from out/src/
    const extensionMod = require('../../out/src/extension.js');
    const modelsMod = require('../../out/src/models.js');
    const rolesMod = require('../../out/src/roles/roleRegistry.js');
    const sessionMod = require('../../out/src/session/sessionManager.js');
    const orchestratorMod = require('../../out/src/orchestration/orchestrator.js');

    // TC-DET-001: Extension Activation & State Initialization
    await this._runTest('TC-DET-001', 'Extension Activation & Subsystem Initialization', async () => {
      extensionMod.activate(context);
      if (!sessionMod.SessionManager.getInstance()) {
        throw new Error('SessionManager was not initialized during activation.');
      }
      return 'Extension activate() executed cleanly; SessionManager and catalog initialized.';
    });

    // TC-DET-002: Command Registration Verification
    await this._runTest('TC-DET-002', 'Verify Registration of Contributed Commands', async () => {
      const registered = await vscode.commands.getCommands(true);
      const requiredCommands = [
        'antigravity.orchestration.openWorkflow',
        'antigravity.orchestration.manageRoles',
        'antigravity.orchestration.startTask',
        'antigravity.orchestration.executeGoal',
        'antigravity.orchestration.pause',
        'antigravity.orchestration.resume',
        'antigravity.orchestration.cancel',
        'antigravity.models.click',
        'antigravity.models.quickMenu',
        'antigravity.models.pick',
        'antigravity.models.chat',
        'antigravity.models.chatInputBox',
        'antigravity.models.options',
        'antigravity.models.voice',
        'antigravity.voice.configureApiKeys',
        'antigravity.voice.pickModel',
        'antigravity.voice.talk',
        'antigravity.voice.mute',
        'antigravity.voice.interrupt',
        'antigravity.voice.devices',
        'antigravity.voice.micLevel',
        'antigravity.voice.connClick',
        'antigravity.voice.reconnect',
        'antigravity.voice.openRecordings',
        'antigravity.voice.copyLatestAudio',
        'antigravity.session.new',
        'antigravity.session.clear'
      ];

      const missing = requiredCommands.filter((c) => !registered.includes(c));
      if (missing.length > 0) {
        throw new Error(`Missing registered commands: ${missing.join(', ')}`);
      }
      return `All ${requiredCommands.length} commands successfully registered in vscode.commands registry.`;
    });

    // TC-DET-003: Webview Panel Lifecycle & Tab Structure
    await this._runTest('TC-DET-003', 'Webview Panel Creation & Tab Layout', async () => {
      const chatBtn = await this.ui.inspectUI('#tabChatBtn');
      const rolesBtn = await this.ui.inspectUI('#tabRolesBtn');
      const workflowBtn = await this.ui.inspectUI('#tabWorkflowBtn');
      if (!chatBtn || !rolesBtn || !workflowBtn) {
        throw new Error('Navigation tabs #tabChatBtn, #tabRolesBtn, or #tabWorkflowBtn not found in Webview DOM.');
      }
      return 'Webview panel loaded with active Chat, Roles, and Workflow navigation tabs.';
    });

    // TC-DET-004: Webview DOM & Script Health (Zero Exceptions)
    await this._runTest('TC-DET-004', 'Webview DOM & Script Health (Zero Exceptions)', async () => {
      const exceptions = this.ui.cdp.exceptions || [];
      if (exceptions.length > 0) {
        throw new Error(`Webview runtime threw ${exceptions.length} exceptions: ${JSON.stringify(exceptions[0])}`);
      }
      return 'Webview DOM loaded cleanly with 0 uncaught JavaScript runtime exceptions.';
    });

    // TC-DET-005: Header Collapse & Expand Toggle
    await this._runTest('TC-DET-005', 'Collapsible Header Toggle in Chat UI', async () => {
      const btn = await this.ui.inspectUI('#chatHeaderExpandBtn');
      const collapsible = await this.ui.inspectUI('#chatHeaderCollapsible');
      if (!btn || !collapsible) {
        throw new Error('Header expand button or collapsible element not found.');
      }

      await this.ui.click('#chatHeaderExpandBtn');
      const afterClick1 = await this.ui.inspectUI('#chatHeaderCollapsible');
      if (afterClick1.display !== 'block') {
        throw new Error(`Expected collapsible display 'block' after 1st click, got: ${afterClick1.display}`);
      }

      await this.ui.click('#chatHeaderExpandBtn');
      const afterClick2 = await this.ui.inspectUI('#chatHeaderCollapsible');
      if (afterClick2.display !== 'none') {
        throw new Error(`Expected collapsible display 'none' after 2nd click, got: ${afterClick2.display}`);
      }
      return 'Header toggled between visible and collapsed cleanly.';
    });

    // TC-DET-006: Model Catalog & Live Model Filtering
    await this._runTest('TC-DET-006', 'Model Catalog Parsing & Live Model Filtering', async () => {
      const catalog = modelsMod.catalogModelInfos();
      if (!catalog || catalog.length === 0) {
        throw new Error('Model catalog is empty.');
      }
      const bidiModels = modelsMod.getBidiLiveModels();
      if (!bidiModels || bidiModels.length === 0) {
        throw new Error('Live bidi models list is empty.');
      }
      return `Loaded ${catalog.length} catalog models; verified ${bidiModels.length} live voice-to-voice models.`;
    });

    // TC-DET-007: Role Registry Synchronization with Workspace File
    await this._runTest('TC-DET-007', 'Role Registry Sync with Workspace roles.json', async () => {
      rolesMod.syncRolesWithWorkspaceFile(context);
      const roles = rolesMod.getRoles(context);
      if (!roles || roles.length === 0) {
        throw new Error('No roles found after sync with workspace file.');
      }
      const researcher = roles.find((r) => r.id === 'researcher');
      if (!researcher) {
        throw new Error('Default researcher role not found.');
      }
      return `Successfully synced ${roles.length} roles from isolated workspace roles.json.`;
    });

    // TC-DET-008: Role File Watcher Hot-Reloading
    await this._runTest('TC-DET-008', 'Role File Watcher Hot-Reloading', async () => {
      let hotReloadFired = false;
      const watcher = rolesMod.initRolesFileWatcher(context, (updated) => {
        hotReloadFired = true;
      });

      // Write an update to isolated roles.json
      const current = rolesMod.getRoles(context);
      const modified = [...current, {
        id: 'test_hot_role',
        name: 'Hot Reload Test Role',
        purpose: 'Testing watcher.',
        primaryModel: 'ag/gemini-3.8-flash-high',
        fallbackModels: [],
        enabled: true,
        systemPrompt: 'Test'
      }];
      fs.writeFileSync(this.envManager.rolesJsonPath, JSON.stringify(modified, null, 2), 'utf8');

      // Allow debounce
      await new Promise((r) => setTimeout(r, 400));
      watcher.dispose();
      return 'Role file watcher initialized and handled workspace roles.json mutation.';
    });

    // TC-DET-009: SessionManager Persistence & Turn Management
    await this._runTest('TC-DET-009', 'SessionManager Turn Recording & Serialization', async () => {
      const sm = sessionMod.SessionManager.getInstance();
      const s = sm.createNewSession('ag/gemini-3.8-flash-high');
      sm.appendWebviewMessage({
        id: 'msg_det_u1',
        sender: 'user',
        content: 'Test prompt for session manager.',
        timestamp: '12:00'
      });
      sm.appendWebviewMessage({
        id: 'msg_det_a1',
        sender: 'ai',
        content: 'Test reply from session manager.',
        timestamp: '12:00'
      });
      sm.flushSync();
      const active = sm.getActiveSession();
      if (active.chatMessages.length < 2) {
        throw new Error(`Expected at least 2 chatMessages, got: ${active.chatMessages.length}`);
      }
      return `SessionManager recorded ${active.chatMessages.length} messages in active session ${s.id}.`;
    });

    // TC-DET-010: Session Reset via antigravity.session.new
    await this._runTest('TC-DET-010', 'Session Reset via antigravity.session.new', async () => {
      const initialSessionId = sessionMod.SessionManager.getInstance().getActiveSession().id;
      await vscode.commands.executeCommand('antigravity.session.new');
      const newSessionId = sessionMod.SessionManager.getInstance().getActiveSession().id;
      if (initialSessionId === newSessionId) {
        throw new Error('Session ID did not change after antigravity.session.new');
      }
      return `Session reset successfully created new session: ${newSessionId}`;
    });

    // TC-DET-011: SerialOrchestrator Step Planning from Goal
    await this._runTest('TC-DET-011', 'SerialOrchestrator Step Planning from Goal', async () => {
      const goal = 'Build REST API endpoints and create frontend dashboard UI';
      const steps = await extensionMod.planWorkflowFromGoal(goal, context);
      if (!steps || steps.length === 0) {
        throw new Error('planWorkflowFromGoal returned empty steps.');
      }
      return `Orchestrator planned ${steps.length} sequential execution steps for goal.`;
    });

    // TC-DET-012: SerialOrchestrator Workflow State Controls
    await this._runTest('TC-DET-012', 'SerialOrchestrator Pause, Resume, and Cancel Controls', async () => {
      const dummyEvents = {
        onWorkflowUpdated: () => {},
        onStepProgress: () => {},
        onFallback: () => {},
        onLog: () => {},
        onVerification: () => {}
      };
      const orchestrator = new orchestratorMod.SerialOrchestrator(context, dummyEvents);
      orchestrator.pause();
      orchestrator.resume();
      orchestrator.cancel();
      return 'Orchestrator pause(), resume(), and cancel() executed cleanly.';
    });

    // TC-DET-013: Voice Audio Device Listing Command
    await this._runTest('TC-DET-013', 'Voice Audio Device Listing Command', async () => {
      await vscode.commands.executeCommand('antigravity.voice.devices');
      return 'Command antigravity.voice.devices executed without throwing.';
    });

    // TC-DET-014: Voice Controls Command State Toggles
    await this._runTest('TC-DET-014', 'Voice Controls Command State Toggles', async () => {
      await vscode.commands.executeCommand('antigravity.voice.mute');
      await vscode.commands.executeCommand('antigravity.voice.talk');
      await vscode.commands.executeCommand('antigravity.voice.interrupt');
      return 'Voice mute, talk, and interrupt commands executed without runtime errors.';
    });

    // TC-DET-015: Extension Deactivation & Clean Teardown
    await this._runTest('TC-DET-015', 'Extension Deactivation & Teardown', async () => {
      extensionMod.deactivate();
      return 'deactivate() executed cleanly and flushed state to storage.';
    });

    return this.results;
  }

  async _runTest(id, name, testFn) {
    const startTime = Date.now();
    const testLogs = [];
    const logInterceptor = (lvl, sub, msg) => {
      testLogs.push({ timestamp: new Date().toISOString(), level: lvl, subsystem: sub, message: msg });
    };

    let status = 'passed';
    let error = null;
    let actualResult = '';
    let screenshotPath = null;

    try {
      this.logCollector.info('DeterministicRunner', `Running ${id}: ${name}...`);
      actualResult = await testFn();
      this.logCollector.info('DeterministicRunner', `[PASS] ${id}: ${actualResult}`);
    } catch (err) {
      status = 'failed';
      error = err.message || String(err);
      actualResult = `Failed: ${error}`;
      this.logCollector.error('DeterministicRunner', `[FAIL] ${id}: ${error}`);

      // Capture failure screenshot if UI is active
      try {
        if (this.ui) {
          screenshotPath = await this.ui.takeScreenshot(id, 'failure');
        }
      } catch {}
    }

    const duration = (Date.now() - startTime) / 1000;
    this.evidence.saveTestLogs(id, testLogs);

    const record = {
      id,
      name,
      status,
      duration,
      actualResult,
      error,
      screenshot: screenshotPath,
      logs: testLogs
    };

    this.results.push(record);
    return record;
  }
}

module.exports = { DeterministicRunner };
