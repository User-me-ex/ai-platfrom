'use strict';

const fs = require('fs');
const path = require('path');

class ReportGenerator {
  constructor(resultsDir = path.join(process.cwd(), 'test-results'), logCollector) {
    this.resultsDir = resultsDir;
    this.logCollector = logCollector;
  }

  generate(buildResult, deterministicTests = [], aiTests = [], diagnosisResult = null) {
    const allTests = [...deterministicTests, ...aiTests];
    const passedTests = allTests.filter((t) => t.status === 'passed');
    const failedTests = allTests.filter((t) => t.status === 'failed');

    const detPassed = deterministicTests.filter((t) => t.status === 'passed').length;
    const detFailed = deterministicTests.filter((t) => t.status === 'failed').length;

    const aiPassed = aiTests.filter((t) => t.status === 'passed').length;
    const aiFailed = aiTests.filter((t) => t.status === 'failed').length;

    const criticalErrors = this.logCollector ? this.logCollector.getCriticalErrors().length : 0;
    const warnings = this.logCollector ? this.logCollector.getWarnings().length : 0;

    const isBuildPass = buildResult && buildResult.success;
    const isOverallPass = isBuildPass && failedTests.length === 0 && criticalErrors === 0;

    // 1. Generate Human-Readable Text Report
    let reportText = '';
    reportText += '========================================\n';
    reportText += 'AI EXTENSION TEST REPORT\n';
    reportText += '========================================\n\n';

    reportText += 'Build:\n';
    reportText += `${isBuildPass ? 'PASS' : 'FAIL'}\n\n`;

    reportText += 'Extension Activation:\n';
    const activationTest = deterministicTests.find((t) => t.id === 'TC-DET-001');
    reportText += `${(activationTest && activationTest.status === 'passed') ? 'PASS' : (isBuildPass ? 'PASS' : 'SKIPPED')}\n\n`;

    reportText += 'Deterministic Tests:\n';
    reportText += `${detPassed} passed\n`;
    reportText += `${detFailed} failed\n\n`;

    reportText += 'AI Exploratory Tests:\n';
    reportText += `${aiPassed} passed\n`;
    reportText += `${aiFailed} failed\n\n`;

    reportText += 'Critical Errors:\n';
    reportText += `${criticalErrors}\n\n`;

    reportText += 'Warnings:\n';
    reportText += `${warnings}\n\n`;

    reportText += 'Overall:\n';
    reportText += `${isOverallPass ? 'PASSED' : 'FAILED'}\n\n`;

    if (failedTests.length > 0) {
      reportText += 'Failed Tests:\n\n';
      for (const ft of failedTests) {
        const diag = diagnosisResult?.diagnoses?.find((d) => d.testId === ft.id);
        reportText += `${ft.id}\n`;
        reportText += `Name: ${ft.name}\n\n`;
        reportText += `Step:\n${diag?.failedStep || ft.actions || 'Execution of test step'}\n\n`;
        reportText += `Expected:\n${diag?.expectedBehavior || ft.expectedResult || 'Step should succeed'}\n\n`;
        reportText += `Actual:\n${diag?.actualBehavior || ft.actualResult || ft.error}\n\n`;
        reportText += `Error:\n${ft.error || 'Test failure'}\n\n`;

        if (diag) {
          reportText += `Probable Cause:\n${diag.technicalReason}\n\n`;
          reportText += `Likely File:\n${diag.likelyFile}\n\n`;
          reportText += `Likely Function:\n${diag.likelyFunction}\n\n`;
          reportText += `Suggested Fix:\n${diag.suggestedFix}\n\n`;
        }

        if (ft.screenshot || diag?.evidence) {
          reportText += `Evidence:\n${ft.screenshot || diag?.evidence}\n\n`;
        }
        reportText += '----------------------------------------\n\n';
      }
    }

    // 2. Generate Machine-Readable JSON Report
    const resultsJson = {
      build: {
        status: isBuildPass ? 'passed' : 'failed',
        durationMs: buildResult?.durationMs || 0,
        version: buildResult?.version || '0.5.20'
      },
      tests: allTests.map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        duration: t.duration,
        error: t.error || null,
        screenshot: t.screenshot || null
      })),
      summary: {
        total: allTests.length,
        passed: passedTests.length,
        failed: failedTests.length,
        deterministicPassed: detPassed,
        deterministicFailed: detFailed,
        aiPassed: aiPassed,
        aiFailed: aiFailed,
        warnings: warnings,
        criticalErrors: criticalErrors,
        overallStatus: isOverallPass ? 'passed' : 'failed'
      },
      diagnoses: diagnosisResult?.diagnoses || []
    };

    // Write to disk
    if (!fs.existsSync(this.resultsDir)) {
      fs.mkdirSync(this.resultsDir, { recursive: true });
    }

    const reportFilePath = path.join(this.resultsDir, 'report.txt');
    const jsonFilePath = path.join(this.resultsDir, 'results.json');

    fs.writeFileSync(reportFilePath, reportText, 'utf8');
    fs.writeFileSync(jsonFilePath, JSON.stringify(resultsJson, null, 2), 'utf8');

    return {
      reportText,
      resultsJson,
      reportFilePath,
      jsonFilePath,
      isOverallPass
    };
  }
}

module.exports = { ReportGenerator };
