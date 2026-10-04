# Comprehensive Automated Test Cases Specification

This document details the complete suite of deterministic tests, AI exploratory tests, and negative resilience scenarios for the `antigravity-models` VS Code extension.

---

## 1. Build & Isolation Suite

### TC-BLD-001: Extension Compilation & VSIX Packaging
* **Test ID:** `TC-BLD-001`
* **Test Name:** Compile TypeScript and Package VSIX
* **Preconditions:** Source files in `src/` are present; `package.json` contains valid manifest.
* **Actions:**
  1. Execute `npm run compile` (`tsc -p ./`).
  2. Execute `vsce package` to produce `.vsix` archive.
  3. Verify output file exists and has non-zero size.
* **Expected Result:** TypeScript compiles with 0 errors; VSIX archive generated successfully.
* **Actual Result:** Pending execution.
* **Status:** PENDING
* **Error:** None
* **Screenshot:** N/A (Build stage)
* **Logs:** Build logs captured in `test-results/TC-BLD-001/logs.txt`.

---

### TC-ENV-001: Isolated Sandbox Environment Provisioning
* **Test ID:** `TC-ENV-001`
* **Test Name:** Provision Sandboxed User-Data, Extensions, and Workspace
* **Preconditions:** Host filesystem accessible in temporary directory.
* **Actions:**
  1. Create temporary directory `.antigravity-test-sandbox/`.
  2. Create isolated subdirectories: `workspace/`, `user-data/`, `extensions/`.
  3. Generate mock workspace files: `.antigravity/roles.json`, `sample.ts`.
  4. Generate isolated `user-data/User/settings.json` with test router port.
* **Expected Result:** Isolated environment tree created without touching developer's personal settings.
* **Actual Result:** Pending execution.
* **Status:** PENDING
* **Error:** None
* **Screenshot:** N/A
* **Logs:** Environment provisioning log.

---

### TC-INS-001: VSIX Installation & Verification in Sandbox
* **Test ID:** `TC-INS-001`
* **Test Name:** Install VSIX Package into Isolated Sandbox
* **Preconditions:** VSIX generated in `TC-BLD-001`; sandbox created in `TC-ENV-001`.
* **Actions:**
  1. Install VSIX package into isolated `extensions/` directory.
  2. Verify unpacked extension directory exists with `package.json` and `out/`.
  3. Check extension manifest version matches `0.5.20`.
* **Expected Result:** Extension cleanly installed and ready for activation.
* **Actual Result:** Pending execution.
* **Status:** PENDING
* **Error:** None
* **Screenshot:** N/A
* **Logs:** Installation output log.

---

## 2. Deterministic Test Suite

### TC-DET-001: Extension Activation & Subsystem Initialization
* **Test ID:** `TC-DET-001`
* **Test Name:** Verify Clean Extension Activation
* **Preconditions:** Extension installed in isolated sandbox; VS Code test host launched.
* **Actions:**
  1. Activate extension `antigravity-dev.antigravity-models`.
  2. Verify `SessionManager` initializes without throwing.
  3. Verify `UnifiedModelCatalog` loads catalog items.
  4. Verify status bar items (`statusBar`, `busyBar`, `voiceBtn`, `muteBtn`, `voiceConnBar`) are initialized.
* **Expected Result:** Extension activates cleanly; activation promise resolves with 0 uncaught exceptions.
* **Actual Result:** Pending execution.
* **Status:** PENDING
* **Error:** None
* **Screenshot:** `test-results/TC-DET-001/activation.png`
* **Logs:** Extension host activation log.

---

### TC-DET-002: Command Registration Verification
* **Test ID:** `TC-DET-002`
* **Test Name:** Verify Registration of All Contributed Commands
* **Preconditions:** Extension activated.
* **Actions:**
  1. Query `vscode.commands.getCommands(true)`.
  2. Verify all contributed commands are registered:
     - `antigravity.orchestration.openWorkflow`
     - `antigravity.orchestration.manageRoles`
     - `antigravity.orchestration.startTask`
     - `antigravity.orchestration.executeGoal`
     - `antigravity.orchestration.pause`
     - `antigravity.orchestration.resume`
     - `antigravity.orchestration.cancel`
     - `antigravity.models.click`
     - `antigravity.models.quickMenu`
     - `antigravity.models.pick`
     - `antigravity.models.chat`
     - `antigravity.models.chatInputBox`
     - `antigravity.models.options`
     - `antigravity.models.voice`
     - `antigravity.voice.configureApiKeys`
     - `antigravity.voice.pickModel`
     - `antigravity.voice.talk`
     - `antigravity.voice.mute`
     - `antigravity.voice.interrupt`
     - `antigravity.voice.devices`
     - `antigravity.voice.micLevel`
     - `antigravity.voice.connClick`
     - `antigravity.voice.reconnect`
     - `antigravity.voice.openRecordings`
     - `antigravity.voice.copyLatestAudio`
     - `antigravity.session.new`
     - `antigravity.session.clear`
* **Expected Result:** 100% of commands exist in VS Code command registry.
* **Actual Result:** Pending execution.
* **Status:** PENDING
* **Error:** None
* **Screenshot:** N/A
* **Logs:** Command registration verification log.

---

### TC-DET-003: Webview Panel Lifecycle & Tab Structure
* **Test ID:** `TC-DET-003`
* **Test Name:** Webview Panel Creation & Tab Layout
* **Preconditions:** Extension activated.
* **Actions:**
  1. Inspect Webview DOM.
  2. Verify webview contains primary navigation tabs (`#tabChatBtn`, `#tabRolesBtn`, `#tabWorkflowBtn`).
* **Expected Result:** Panel opens with active Chat, Roles, and Workflow navigation tabs.
* **Actual Result:** Webview panel loaded with active Chat, Roles, and Workflow navigation tabs.
* **Status:** PASSED
* **Error:** None
* **Screenshot:** N/A
* **Logs:** Panel lifecycle events.

---

### TC-DET-004: Webview DOM & Script Health (Zero Exceptions)
* **Test ID:** `TC-DET-004`
* **Test Name:** Webview Headless DOM Verification via CDP
* **Preconditions:** Webview HTML rendered.
* **Actions:**
  1. Connect to webview page via CDP WebSocket.
  2. Enable `Runtime` and `Page` domains.
  3. Listen for `Runtime.exceptionThrown` events during initial load.
* **Expected Result:** Zero uncaught JavaScript syntax or runtime exceptions.
* **Actual Result:** Webview DOM loaded cleanly with 0 uncaught JavaScript runtime exceptions.
* **Status:** PASSED
* **Error:** None
* **Screenshot:** N/A
* **Logs:** Browser console log.

---

### TC-DET-005: Header Collapse & Expand Toggle
* **Test ID:** `TC-DET-005`
* **Test Name:** Verify Collapsible Header Toggle in Chat UI
* **Preconditions:** Webview active in Chat tab.
* **Actions:**
  1. Query `#chatHeaderExpandBtn` and `#chatHeaderCollapsible`.
  2. Verify initial `display` style is `'none'`.
  3. Trigger click on `#chatHeaderExpandBtn`.
  4. Verify `display` toggles to `'block'`.
  5. Trigger click again.
  6. Verify `display` toggles back to `'none'`.
* **Expected Result:** Collapsible section toggles visibility on click; icon flips orientation.
* **Actual Result:** Header toggled between visible and collapsed cleanly.
* **Status:** PASSED
* **Error:** None
* **Screenshot:** `test-results/TC-DET-005/toggle.png`
* **Logs:** DOM inspection events.

---

### TC-DET-006: Model Catalog & Live Model Filtering
* **Test ID:** `TC-DET-006`
* **Test Name:** Verify Model Catalog Parsing and Live Filtering
* **Preconditions:** `catalog/models.json` present.
* **Actions:**
  1. Query `UnifiedModelCatalog.getInstance().getModels()`.
  2. Verify catalog contains models (e.g. `gemini-3.8-flash-high`, `gemini-3.1-flash-live-preview`).
  3. Test `getBidiLiveModels()` returns only real-time voice compatible models.
* **Expected Result:** Catalog size > 0; filter correctly separates standard vs. live bidi models.
* **Actual Result:** Pending execution.
* **Status:** PENDING
* **Error:** None
* **Screenshot:** N/A
* **Logs:** Catalog size and model list.

---

### TC-DET-007: Role Registry Synchronization with Workspace File
* **Test ID:** `TC-DET-007`
* **Test Name:** Role Registry Sync with `.antigravity/roles.json`
* **Preconditions:** Workspace contains pre-configured `.antigravity/roles.json`.
* **Actions:**
  1. Invoke `syncRolesWithWorkspaceFile(context)`.
  2. Retrieve loaded roles with `getRoles(context)`.
  3. Verify default roles (`researcher`, `backend`, `frontend`, `tester`, `orchestrator`) exist.
* **Expected Result:** Workspace roles parsed accurately with primary and fallback models.
* **Actual Result:** Pending execution.
* **Status:** PENDING
* **Error:** None
* **Screenshot:** N/A
* **Logs:** Role synchronization log.

---

### TC-DET-008: Role File Watcher Hot-Reloading
* **Test ID:** `TC-DET-008`
* **Test Name:** Verify Hot-Reloading on `.antigravity/roles.json` Mutation
* **Preconditions:** Role file watcher initialized.
* **Actions:**
  1. Update `.antigravity/roles.json` with a custom test role `"qa_bot"`.
  2. Wait 300ms for debounce file watcher callback.
  3. Query `getRole(context, "qa_bot")`.
* **Expected Result:** File watcher detects change; role `"qa_bot"` appears in active role registry.
* **Actual Result:** Pending execution.
* **Status:** PENDING
* **Error:** None
* **Screenshot:** N/A
* **Logs:** Hot-reload callback log.

---

### TC-DET-009: SessionManager Persistence & Turn Management
* **Test ID:** `TC-DET-009`
* **Test Name:** SessionManager Turn Recording and Workspace State Serialization
* **Preconditions:** `SessionManager` initialized.
* **Actions:**
  1. Create session via `SessionManager.getInstance().createNewSession("ag/gemini-3.8-flash-high")`.
  2. Add user message and assistant reply to session.
  3. Flush state to disk/storage.
  4. Verify active session turns count is 2.
* **Expected Result:** Turns recorded with timestamps; messages correctly serialized.
* **Actual Result:** Pending execution.
* **Status:** PENDING
* **Error:** None
* **Screenshot:** N/A
* **Logs:** Session storage dump.

---

### TC-DET-010: Session Reset & Clear
* **Test ID:** `TC-DET-010`
* **Test Name:** Verify Session Reset via `antigravity.session.new`
* **Preconditions:** Session populated with messages.
* **Actions:**
  1. Execute `vscode.commands.executeCommand("antigravity.session.new")`.
  2. Inspect active session.
* **Expected Result:** Active session resets to empty message array with fresh session ID.
* **Actual Result:** Pending execution.
* **Status:** PENDING
* **Error:** None
* **Screenshot:** N/A
* **Logs:** Session reset log.

---

### TC-DET-011: SerialOrchestrator Step Planning from Goal
* **Test ID:** `TC-DET-011`
* **Test Name:** Heuristic and LLM Step Decomposition
* **Preconditions:** Orchestrator instance initialized.
* **Actions:**
  1. Call `planWorkflowFromGoal("Build fullstack auth with backend API and frontend login UI", context)`.
  2. Inspect returned `TaskStep[]`.
* **Expected Result:** Generates sequential steps including `backend` and `frontend` roles.
* **Actual Result:** Pending execution.
* **Status:** PENDING
* **Error:** None
* **Screenshot:** N/A
* **Logs:** Planned steps dump.

---

### TC-DET-012: SerialOrchestrator Workflow State Controls
* **Test ID:** `TC-DET-012`
* **Test Name:** Pause, Resume, and Cancel Lifecycle Controls
* **Preconditions:** SerialOrchestrator instance active.
* **Actions:**
  1. Initialize workflow with 3 steps.
  2. Call `orchestrator.pause()`. Verify status is `'Paused'`.
  3. Call `orchestrator.resume()`. Verify status returns to `'Running'`.
  4. Call `orchestrator.cancel()`. Verify status is `'Cancelled'`.
* **Expected Result:** State transitions occur cleanly without unhandled rejections.
* **Actual Result:** Pending execution.
* **Status:** PENDING
* **Error:** None
* **Screenshot:** N/A
* **Logs:** Orchestrator state transitions log.

---

### TC-DET-013: Voice Audio Device Listing Command
* **Test ID:** `TC-DET-013`
* **Test Name:** Verify `antigravity.voice.devices` Command Execution
* **Preconditions:** Extension activated.
* **Actions:**
  1. Execute `vscode.commands.executeCommand("antigravity.voice.devices")`.
* **Expected Result:** Executes audio device enumeration; returns without runtime exception.
* **Actual Result:** Pending execution.
* **Status:** PENDING
* **Error:** None
* **Screenshot:** N/A
* **Logs:** Voice device enumeration output.

---

### TC-DET-014: Voice Controls Command State Toggles
* **Test ID:** `TC-DET-014`
* **Test Name:** Verify Voice Mute and Talk Commands
* **Preconditions:** Extension activated.
* **Actions:**
  1. Execute `antigravity.voice.mute`.
  2. Execute `antigravity.voice.talk`.
  3. Execute `antigravity.voice.interrupt`.
* **Expected Result:** Commands execute and toggle status bar icons gracefully.
* **Actual Result:** Pending execution.
* **Status:** PENDING
* **Error:** None
* **Screenshot:** N/A
* **Logs:** Voice control action logs.

---

### TC-DET-015: Extension Deactivation & Clean Teardown
* **Test ID:** `TC-DET-015`
* **Test Name:** Verify Extension Shutdown & Resource Cleanup
* **Preconditions:** Extension active with open sessions and background watchers.
* **Actions:**
  1. Invoke `deactivate()` entry point.
  2. Verify `SessionManager.getInstance().flushSync()` executes.
  3. Verify orchestrator cancel is called.
* **Expected Result:** All watchers, processes, and memory buffers flushed cleanly.
* **Actual Result:** Pending execution.
* **Status:** PENDING
* **Error:** None
* **Screenshot:** N/A
* **Logs:** Deactivation logs.

---

## 3. AI Exploratory & UI Testing Suite

### TC-AI-001: Autonomous Chat Message Submission & Bubble Verification
* **Test ID:** `TC-AI-001`
* **Test Name:** AI Exploratory: Submit Prompt and Verify Chat Bubbles
* **Preconditions:** Webview active in Chat tab; CDP attached.
* **Actions:**
  1. Agent inspects UI and identifies `#chatMessageInput`.
  2. Agent types test prompt: `"Hello! Explain what features you offer in this extension."`
  3. Agent captures `before_send.png`.
  4. Agent clicks `#sendChatBtn`.
  5. Agent captures `after_send.png`.
  6. Agent observes postMessage dispatched to Extension Host with command `'chatSubmit'`.
  7. Agent verifies input field `#chatMessageInput` clears.
* **Expected Result:** Message sent, recorded in postMessage stream, input reset, zero exceptions.
* **Actual Result:** Dispatched chatSubmit postMessage with prompt and input cleared cleanly.
* **Status:** PASSED
* **Error:** None
* **Screenshot:** `test-results/TC-AI-001/after_send.png`
* **Logs:** Captured webview console logs.

---

### TC-AI-002: Autonomous Tab Switching & View State Retention
* **Test ID:** `TC-AI-002`
* **Test Name:** AI Exploratory: Switch Between Chat and Roles Tabs
* **Preconditions:** Webview active with at least one message.
* **Actions:**
  1. Agent clicks `#tabRolesBtn`.
  2. Agent verifies `#rolesTab` style display becomes `'block'` and `#chatTab` becomes `'none'`.
  3. Agent captures `roles_tab_active.png`.
  4. Agent clicks `#tabChatBtn`.
  5. Agent verifies `#chatTab` style display restores to `'block'`.
  6. Agent captures `chat_tab_restored.png`.
* **Expected Result:** Smooth tab transition without DOM recreation or state loss.
* **Actual Result:** Successfully navigated between Chat and Roles views with correct display toggling.
* **Status:** PASSED
* **Error:** None
* **Screenshot:** `test-results/TC-AI-002/chat_tab_restored.png`
* **Logs:** Tab transition logs.

---

### TC-AI-003: Autonomous Role Filter & Inspection in Hub
* **Test ID:** `TC-AI-003`
* **Test Name:** AI Exploratory: Role Filter & Inspection in Hub UI
* **Preconditions:** Webview active in Roles tab.
* **Actions:**
  1. Agent switches to `#tabRolesBtn`.
  2. Agent types filter query into `#roleFilterInput`.
  3. Agent verifies role cards filter responsively.
  4. Agent returns to Chat tab.
* **Expected Result:** Role filter input and role grid inspected and validated.
* **Actual Result:** Role filter input and role grid inspected and validated.
* **Status:** PASSED
* **Error:** None
* **Screenshot:** `test-results/TC-AI-003/role_filter_applied.png`
* **Logs:** Role modification log.

---

### TC-AI-004: Autonomous Task Workflow Pipeline View
* **Test ID:** `TC-AI-004`
* **Test Name:** AI Exploratory: Launch Task Workflow Pipeline View
* **Preconditions:** Webview active.
* **Actions:**
  1. Agent clicks `#tabWorkflowBtn`.
  2. Agent verifies `#workflowTab` renders with status badges and pipeline container.
  3. Agent returns to Chat tab.
* **Expected Result:** Workflow pipeline tab renders cleanly.
* **Actual Result:** Task workflow pipeline tab and controls verified in webview UI.
* **Status:** PASSED
* **Error:** None
* **Screenshot:** `test-results/TC-AI-004/workflow_pipeline_active.png`
* **Logs:** Workflow execution logs.

---

### TC-AI-005: Autonomous Voice Controls UI Verification
* **Test ID:** `TC-AI-005`
* **Test Name:** AI Exploratory: Test Voice Buttons in UI
* **Preconditions:** Webview active.
* **Actions:**
  1. Agent clicks `#tabVoiceBtn`.
  2. Agent verifies `#voiceOrb` and `#voiceToggleBtn` are visible.
  3. Agent returns to Chat tab.
* **Expected Result:** Voice orb and voice mode activation buttons verified in UI.
* **Actual Result:** Voice orb and voice mode activation buttons verified in UI.
* **Status:** PASSED
* **Error:** None
* **Screenshot:** `test-results/TC-AI-005/voice_tab_active.png`
* **Logs:** Voice events log.

---

## 4. Negative Resilience Suite

### TC-AI-006: Empty and Whitespace Chat Input Validation
* **Test ID:** `TC-AI-006`
* **Test Name:** AI Negative: Attempt Empty & Whitespace Submissions
* **Preconditions:** Webview active in Chat tab.
* **Actions:**
  1. Agent sets `#chatMessageInput` value to `""`.
  2. Agent clicks `#sendChatBtn`.
  3. Agent sets `#chatMessageInput` value to `"     \n\t   "`.
  4. Agent clicks `#sendChatBtn`.
* **Expected Result:** Submissions are blocked; no empty chat bubbles added; no errors thrown.
* **Actual Result:** Empty and whitespace inputs were correctly rejected with zero invalid dispatches.
* **Status:** PASSED
* **Error:** None
* **Screenshot:** `test-results/TC-AI-006/empty_input_blocked.png`
* **Logs:** Webview input validation log.

---

### TC-AI-007: Rapid Click Stress Testing
* **Test ID:** `TC-AI-007`
* **Test Name:** AI Negative: Rapid 10x Clicks on Send and Expand
* **Preconditions:** Webview active in Chat tab.
* **Actions:**
  1. Agent types `"Stress test click storm"` into `#chatMessageInput`.
  2. Agent fires rapid click events alternating `#sendChatBtn` and `#chatHeaderExpandBtn`.
* **Expected Result:** UI does not freeze or desync; single request processed; header remains in consistent state.
* **Actual Result:** UI handled rapid repeated click events gracefully without crashing.
* **Status:** PASSED
* **Error:** None
* **Screenshot:** `test-results/TC-AI-007/rapid_clicks_handled.png`
* **Logs:** UI event loop logs.

---

### TC-AI-008: Corrupted `roles.json` Graceful Handling
* **Test ID:** `TC-AI-008`
* **Test Name:** AI Negative: Malformed JSON in Roles File
* **Preconditions:** Role file watcher active.
* **Actions:**
  1. Write invalid JSON string `"{ invalid: [ json ..."` to `.antigravity/roles.json`.
  2. Wait 300ms for watcher trigger.
* **Expected Result:** File watcher logs warning; extension falls back to default in-memory roles; zero extension crash.
* **Actual Result:** Handled corrupted JSON gracefully; fell back to default built-in roles without crashing.
* **Status:** PASSED
* **Error:** None
* **Screenshot:** N/A
* **Logs:** Parser error handling log.

---

### TC-AI-009: Offline 9 Router Gateway Error Handling
* **Test ID:** `TC-AI-009`
* **Test Name:** AI Negative: API Request to Unreachable Endpoint
* **Preconditions:** Extension configured with dummy offline port `http://127.0.0.1:59999/v1`.
* **Actions:**
  1. Submit chat prompt requiring completion.
  2. Observe network failure handler in `streamCompletion`.
* **Expected Result:** Catches connection refused error; outputs friendly message in chat channel; resets busy state to false.
* **Actual Result:** Offline gateway connection error was caught and propagated safely.
* **Status:** PASSED
* **Error:** None
* **Screenshot:** N/A
* **Logs:** Network error log.

---

### TC-AI-010: Automatic Role Model Fallback on HTTP 500
* **Test ID:** `TC-AI-010`
* **Test Name:** AI Negative: Fallback Model Activation on Primary Model Error
* **Preconditions:** Mock gateway responds with HTTP 500 for primary model.
* **Actions:**
  1. Execute completion request assigned to primary model.
  2. Mock gateway injects 500 failure.
  3. Observe fallback to secondary model.
* **Expected Result:** Automatically switches to next fallback model in chain; displays warning notification; step continues.
* **Actual Result:** Simulated 500 failure on primary model, verified error detection and successful execution on fallback model.
* **Status:** PASSED
* **Error:** None
* **Screenshot:** N/A
* **Logs:** Fallback chain log.
