# AI-Powered Automated Testing Architecture for VS Code Extension

## 1. Overview & Primary Objective

This document defines the complete architectural design for the **AI-Powered Automated Testing System** for the `antigravity-models` (9 Router Models) VS Code extension.

The system ensures that following every compilation/build:
1. The extension is packaged into an installable VSIX.
2. An isolated, sandboxed VS Code runtime environment is provisioned (temporary workspace, user-data, and extensions directories).
3. The newly built extension is installed and verified for clean activation.
4. A deterministic test suite executes to validate all core features, commands, sessions, webviews, and workflows.
5. An autonomous **AI Tester Agent** takes control of the running environment, conducting exploratory testing, UI interaction (via Chrome DevTools Protocol & accessibility tree), negative testing, and edge case validation.
6. Real-time logs, console exceptions, and visual screenshots are captured at every milestone.
7. A self-diagnosis engine analyzes failures, correlating UI symptoms, logs, and stack traces to pinpoint likely files and functions.
8. A final human-readable report and machine-readable `results.json` are produced.

---

## 2. High-Level Pipeline Architecture

```
Developer Changes Code
        │
        ▼
[1. Build Manager]
  - tsc compilation (tsc -p ./)
  - vsce package generation (.vsix)
        │
        ├── Compile Failed ──► [Report Build Failure & Halt]
        ▼ Compile Succeeded
[2. Environment Manager]
  - Create isolated sandbox (tmp/sandbox-*)
  - Generate clean test workspace & test files
  - Provision isolated user-data & settings.json
  - Provision isolated extensions directory
        │
        ▼
[3. Extension Installer]
  - Install .vsix into isolated extensions directory
  - Verify manifest integrity & dependencies
        │
        ▼
[4. VS Code Launcher & Runtime Host]
  - Launch VS Code with --user-data-dir, --extensions-dir, --remote-debugging-port
  - Verify extension host bootstrap and extension activation
        │
        ▼
[5. Deterministic Test Runner]
  - Activation & command registrations
  - Webview panel lifecycle & tab transitions
  - SessionManager persistence & reset
  - SerialOrchestrator goal execution & state machine
  - Voice controls & audio device subsystem
  - Mock Router gateway communication & fallback chains
        │
        ▼
[6. AI Test Agent (Exploratory & Negative QA)]
  - UI Automation Layer (CDP: DOM, Accessibility, Input, Screenshot)
  - Autonomous exploratory workflows (Chat, Roles, Task execution)
  - Negative stress testing (Empty inputs, invalid payloads, offline gateway)
  - Boundary & rapid interaction tests
        │
        ▼
[7. Log Collector & Error Monitor]
  - Capture Extension Host logs, Console exceptions, Webview events
  - Classify events: INFO, WARNING, ERROR, CRITICAL
  - Trigger screenshot captures (before/after/failure)
        │
        ▼
[8. Test Result Analyzer & Self-Diagnosis]
  - Correlate UI state + Failed action + Error stack + Logs
  - Generate technical diagnosis, likely file, likely function
        │
        ▼
[9. Report Generator]
  - Produce formatted human-readable report (console & test-results/report.txt)
  - Produce machine-readable JSON (test-results/results.json)
  - Cleanup isolated sandbox (unless TEST_DEBUG=true or keepTestEnvironment=true)
```

---

## 3. Modular System Components

The testing system follows strict modular design principles where each module has a dedicated single responsibility:

| Component | Class / Module | Primary Responsibility |
| :--- | :--- | :--- |
| **Test Orchestrator** | `TestOrchestrator` (`test/orchestrator.ts`) | Orchestrates the entire lifecycle: build, setup, run deterministic, run AI, teardown, and reporting. |
| **Build Manager** | `BuildManager` (`test/build/buildManager.ts`) | Executes TypeScript compiler, triggers VSIX packaging, and verifies binary output. |
| **VS Code Environment Manager** | `EnvironmentManager` (`test/env/environmentManager.ts`) | Creates, isolates, configures, and cleans up temporary sandboxes and workspaces. |
| **Extension Installer** | `ExtensionInstaller` (`test/env/extensionInstaller.ts`) | Unpacks or installs the VSIX package into the isolated extensions directory and checks activation readiness. |
| **UI Automation Layer** | `UIAutomationLayer` (`test/automation/uiAutomation.ts`) | Interfaces with VS Code and Webviews via Chrome DevTools Protocol (CDP) for DOM queries, clicks, typing, and screenshots. |
| **Deterministic Test Runner** | `DeterministicRunner` (`test/suites/deterministicRunner.ts`) | Executes fixed, assertion-driven verification of commands, webview states, orchestrator, and session managers. |
| **AI Test Agent** | `AITestAgent` (`test/ai/aiTestAgent.ts`) | Autonomous QA persona running dynamic exploratory sequences, negative tests, and resilience validation. |
| **Log Collector** | `LogCollector` (`test/monitoring/logCollector.ts`) | Taps extension output channels, process stdout/stderr, and browser console messages, tracking severity levels. |
| **Evidence Manager** | `EvidenceManager` (`test/evidence/evidenceManager.ts`) | Captures and persists screenshots (`before.png`, `after.png`, `failure.png`) and log dumps per test ID. |
| **Result Analyzer & Diagnosis** | `ResultAnalyzer` (`test/diagnosis/resultAnalyzer.ts`) | Cross-references failures across logs, UI snapshots, and AST/file maps to propose technical diagnoses and pinpoint files. |
| **Report Generator** | `ReportGenerator` (`test/reporting/reportGenerator.ts`) | Generates structured text and JSON test reports with pass/fail metrics, warnings, and error forensics. |

---

## 4. Isolation & Sandbox Strategy

Testing never touches the developer's personal VS Code configuration, settings, or real workspaces.

### 4.1 Directory Sandbox Layout

```text
.antigravity-test-sandbox/
  ├── workspace/
  │   ├── .antigravity/
  │   │   └── roles.json          # Pre-configured test roles
  │   ├── src/
  │   │   └── sample.ts           # Sample source file for agent tool operations
  │   └── README.md
  ├── user-data/
  │   └── User/
  │       └── settings.json       # Strict test configuration
  ├── extensions/
  │   └── antigravity-dev.antigravity-models-0.5.20/  # Installed VSIX payload
  └── test-results/
      ├── TC-DET-001/
      │   ├── before.png
      │   ├── after.png
      │   └── logs.txt
      ├── results.json
      └── report.txt
```

### 4.2 Test Configuration (`test-config.json`)

```json
{
  "testing": {
    "keepTestEnvironment": false,
    "captureScreenshots": true,
    "captureLogs": true,
    "stopOnCriticalFailure": false,
    "timeoutMs": 60000,
    "maxAiActions": 50,
    "cdpPort": 9333,
    "mockRouterPort": 20129
  }
}
```

### 4.3 Debug Mode (`TEST_DEBUG=true`)

When `TEST_DEBUG=true` or `--debug` flag is passed:
- Temporary workspace and user data directories are preserved.
- Full trace logs and all screenshots are retained in `test-results/`.
- The browser/VS Code process can be held open for interactive inspection.

---

## 5. UI Automation & Webview Bridge (CDP Architecture)

The extension contains an extensive Webview interface (`WorkflowWebviewPanel`) featuring:
- Model Selection & Filter
- Chat Interface (Live streaming, prompt inputs, action buttons)
- Role Management & Serial Orchestration Hub
- Voice Controls (Talk, Mute, Interrupt, Audio device pickers)

### 5.1 Communication Topology

```text
               ┌────────────────────────────────────────────────────────┐
               │                  Test Orchestrator                     │
               └───┬────────────────────────┬───────────────────────┬───┘
                   │                        │                       │
      Chrome DevTools Protocol (CDP)   VS Code IPC            Mock HTTP Server
                   │                        │                       │
                   ▼                        ▼                       ▼
          ┌──────────────────┐    ┌──────────────────┐    ┌───────────────────┐
          │  VS Code Window  │    │  Extension Host  │    │   Mock 9 Router   │
          │  & Webview Panel │    │  (Extension.ts)  │    │      Gateway      │
          └──────────────────┘    └──────────────────┘    └───────────────────┘
```

The `UIAutomationLayer` utilizes Chrome DevTools Protocol (CDP) via WebSocket:
- `DOM.enable`, `DOM.getDocument`, `DOM.querySelector` for fast selector lookup.
- `Runtime.evaluate` to inspect in-memory webview state (`window.acquireVsCodeApi()`, `window.recordedVsCodeMessages`).
- `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` for authentic user clicks and typing.
- `Page.captureScreenshot` for capturing pixel-perfect UI evidence.

---

## 6. Deterministic vs. AI Exploratory Testing Partition

### 6.1 Deterministic Suite
Focuses on strict, repeatable invariants:
- Are all 24 commands registered in `vscode.commands`?
- Does `WorkflowWebviewPanel` render all tabs and controls without uncaught JavaScript exceptions?
- Does `SessionManager` create, retrieve, serialize, and persist conversation turns?
- Does `SerialOrchestrator` decompose goals into ordered `TaskStep` objects?
- Does role fallback switch from primary model to fallback when the mock gateway returns 500?

### 6.2 AI Exploratory Suite
Focuses on realistic, non-scripted, emergent user behaviors:
- Navigating back and forth between Chat and Roles tabs.
- Rapid prompt submission and keyboard shortcuts.
- Edge testing with extreme inputs (empty string, 10,000 characters, Unicode characters, HTML injection).
- Simulating network disconnection during chat generation.
- Toggling voice controls in rapid succession while a workflow is active.
- Verifying error boundaries and ensuring graceful recovery with zero crashes.

---

## 7. Self-Diagnosis Engine Architecture

When any test fails, the `ResultAnalyzer`:
1. Collects the last action performed and the DOM state snapshot.
2. Extracts console error logs and stack traces from the `LogCollector`.
3. Maps stack trace frames and error signatures against known extension subsystems:
   - `ui/workflowWebview.ts` (DOM, message passing, CSS layout)
   - `roles/roleRegistry.ts` (JSON parsing, role schemas, file watchers)
   - `orchestration/orchestrator.ts` (Serial step execution, state transitions)
   - `session/sessionManager.ts` (State serialization, persistence)
   - `voice.ts` / `aec.ts` (Audio processes, child processes)
   - `models.ts` / `chat.ts` (API streaming, tool execution)
4. Emits a structured diagnosis block:
   ```text
   Diagnosis:
     Failure: Webview failed to render chat bubble
     Probable Cause: State event 'chat_append' payload lacked 'timestamp' property
     Likely File: src/ui/workflowWebview.ts
     Likely Function: renderChatMessage()
     Evidence: test-results/TC-AI-004/failure.png
   ```

---

## 8. CI/CD Integration & Exit Codes

Commands provided:
- `npm run test:e2e`: Runs environment setup, extension install, and deterministic tests.
- `npm run test:ai`: Runs environment setup and AI exploratory testing.
- `npm run test:all`: Executes the complete pipeline end-to-end.

Exit code standard:
- `0`: All tests passed without critical errors.
- `1`: Build failed, deterministic test failed, or AI detected a critical failure.
