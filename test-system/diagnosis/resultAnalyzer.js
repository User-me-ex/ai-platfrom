'use strict';

class ResultAnalyzer {
  constructor(logCollector, evidenceManager) {
    this.logCollector = logCollector;
    this.evidence = evidenceManager;
  }

  /**
   * Analyzes all test results and diagnoses any failures.
   */
  analyze(allTests) {
    const failedTests = allTests.filter((t) => t.status === 'failed');
    const diagnoses = [];

    for (const test of failedTests) {
      const diagnosis = this._diagnoseTest(test);
      diagnoses.push(diagnosis);
    }

    return {
      totalFailed: failedTests.length,
      diagnoses
    };
  }

  _diagnoseTest(test) {
    const err = test.error || 'Unknown failure';
    const evidence = this.evidence.getEvidence(test.id);
    const failureScreenshot = evidence.screenshots.find((s) => s.includes('failure')) || evidence.screenshots[0] || null;

    let likelyFile = 'src/extension.ts';
    let likelyFunction = 'activate()';
    let technicalReason = err;
    let suggestedFix = 'Inspect recent code changes against this subsystem.';

    const lowerErr = err.toLowerCase();
    const lowerName = test.name.toLowerCase();

    if (lowerErr.includes('webview') || lowerErr.includes('chatinput') || lowerErr.includes('sendbtn') || lowerName.includes('tab') || lowerName.includes('header')) {
      likelyFile = 'src/ui/workflowWebview.ts';
      likelyFunction = lowerName.includes('header') ? 'renderChatHeader()' : 'renderChatUI()';
      technicalReason = `Webview element interaction or DOM template rendering issue: ${err}`;
      suggestedFix = 'Verify element IDs, event listener bindings, and CSP nonce configuration in WorkflowWebviewPanel.';
    } else if (lowerErr.includes('role') || lowerName.includes('role')) {
      likelyFile = 'src/roles/roleRegistry.ts';
      likelyFunction = lowerName.includes('watch') ? 'initRolesFileWatcher()' : 'syncRolesWithWorkspaceFile()';
      technicalReason = `Role synchronization or schema mismatch: ${err}`;
      suggestedFix = 'Ensure .antigravity/roles.json path is valid and JSON parsing error handlers fallback safely.';
    } else if (lowerErr.includes('session') || lowerName.includes('session')) {
      likelyFile = 'src/session/sessionManager.ts';
      likelyFunction = 'createNewSession() / addTurn()';
      technicalReason = `Session state persistence or active session switching error: ${err}`;
      suggestedFix = 'Check workspaceState storage keys and session serialization methods in SessionManager.';
    } else if (lowerErr.includes('orchestrat') || lowerName.includes('orchestrat') || lowerName.includes('goal')) {
      likelyFile = 'src/orchestration/orchestrator.ts';
      likelyFunction = 'runWorkflow() / planWorkflowFromGoal()';
      technicalReason = `Workflow step planning or serial state machine transition error: ${err}`;
      suggestedFix = 'Verify step status definitions, heuristic decomposition regexes, and cancellation token propagation.';
    } else if (lowerErr.includes('voice') || lowerName.includes('voice')) {
      likelyFile = 'src/voice.ts';
      likelyFunction = 'listAudioDevices() / LiveCall.talkToggle()';
      technicalReason = `Voice audio subsystem or external binary dependency issue: ${err}`;
      suggestedFix = 'Verify sox / ffplay process detection or mock fallback behavior when audio devices are offline.';
    } else if (lowerErr.includes('command') || lowerName.includes('command')) {
      likelyFile = 'src/extension.ts';
      likelyFunction = 'activate()';
      technicalReason = `Command not registered in VS Code extension subscriptions: ${err}`;
      suggestedFix = 'Check contributes.commands in package.json and ensure vscode.commands.registerCommand is invoked in activate().';
    }

    return {
      testId: test.id,
      testName: test.name,
      failedStep: test.actions || 'Execution of test routine',
      expectedBehavior: test.expectedResult || 'Step should execute without exceptions',
      actualBehavior: test.actualResult || err,
      technicalReason,
      likelyFile,
      likelyFunction,
      suggestedFix,
      evidence: failureScreenshot
    };
  }
}

module.exports = { ResultAnalyzer };
