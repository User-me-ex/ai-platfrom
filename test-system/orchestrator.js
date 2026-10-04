'use strict';

const path = require('path');
const { loadTestConfig } = require('./config/testConfig');
const { LogCollector } = require('./monitoring/logCollector');
const { EvidenceManager } = require('./evidence/evidenceManager');
const { BuildManager } = require('./build/buildManager');
const { EnvironmentManager } = require('./env/environmentManager');
const { ExtensionInstaller } = require('./env/extensionInstaller');
const { MockRouterGateway } = require('./mocks/mockRouterGateway');
const { BrowserHost } = require('./automation/browserHost');
const { CDPClient } = require('./automation/cdpClient');
const { UIAutomationLayer } = require('./automation/uiAutomationLayer');
const { DeterministicRunner } = require('./suites/deterministicRunner');
const { AITestAgent } = require('./ai/aiTestAgent');
const { ResultAnalyzer } = require('./diagnosis/resultAnalyzer');
const { ReportGenerator } = require('./reporting/reportGenerator');

async function main() {
  const config = loadTestConfig();
  const logCollector = new LogCollector();
  const evidenceManager = new EvidenceManager(config.resultsDir, logCollector);
  const reportGenerator = new ReportGenerator(config.resultsDir, logCollector);

  logCollector.info('Orchestrator', '=======================================================');
  logCollector.info('Orchestrator', '   AI-POWERED AUTOMATED EXTENSION TESTING PIPELINE    ');
  logCollector.info('Orchestrator', '=======================================================');

  let buildResult = null;
  let envManager = null;
  let mockRouter = null;
  let browserHost = null;
  let cdpClient = null;
  let deterministicTests = [];
  let aiTests = [];
  let diagnosisResult = null;

  try {
    // -------------------------------------------------------------
    // STAGE 1: Build & Packaging
    // -------------------------------------------------------------
    const buildManager = new BuildManager(config, logCollector);
    buildResult = await buildManager.build();

    if (!buildResult.success) {
      logCollector.critical('Orchestrator', `Pipeline halted: Extension build failed at stage "${buildResult.stage}".`);
      const finalReport = reportGenerator.generate(buildResult, [], [], null);
      console.log('\n' + finalReport.reportText);
      process.exit(1);
    }

    // -------------------------------------------------------------
    // STAGE 2: Isolated Environment Provisioning
    // -------------------------------------------------------------
    envManager = new EnvironmentManager(config, logCollector);
    await envManager.setup();
    const { installMockVscode } = require('./mocks/mockVscode');
    installMockVscode(envManager);

    // -------------------------------------------------------------
    // STAGE 3: Extension Installation in Isolated Environment
    // -------------------------------------------------------------
    const installer = new ExtensionInstaller(envManager, logCollector);
    const installResult = await installer.install(buildResult);

    if (!installResult.success) {
      logCollector.critical('Orchestrator', `Extension installation failed: ${installResult.error}`);
      const finalReport = reportGenerator.generate(buildResult, [{
        id: 'TC-INS-001',
        name: 'Extension Installation in Isolated Environment',
        status: 'failed',
        error: installResult.error,
        duration: 0
      }], [], null);
      console.log('\n' + finalReport.reportText);
      await envManager.teardown();
      process.exit(1);
    }

    // -------------------------------------------------------------
    // STAGE 4: Start Mock 9 Router Gateway
    // -------------------------------------------------------------
    mockRouter = new MockRouterGateway(config.mockRouterPort, logCollector);
    await mockRouter.start();

    // -------------------------------------------------------------
    // STAGE 5: Launch Headless Browser UI & CDP Connection
    // -------------------------------------------------------------
    browserHost = new BrowserHost(config, envManager, logCollector);
    await browserHost.start();

    cdpClient = new CDPClient(config.cdpPort, logCollector);
    await cdpClient.connect();

    const uiAutomation = new UIAutomationLayer(cdpClient, evidenceManager, logCollector);

    // -------------------------------------------------------------
    // STAGE 6: Execute Deterministic Automated Tests
    // -------------------------------------------------------------
    const shouldRunDeterministic = !config.targetSuite || config.targetSuite === 'all' || config.targetSuite === 'e2e';
    if (shouldRunDeterministic) {
      const deterministicRunner = new DeterministicRunner(envManager, uiAutomation, evidenceManager, logCollector);
      deterministicTests = await deterministicRunner.runAll();
    }

    // -------------------------------------------------------------
    // STAGE 7: Execute Autonomous AI Exploratory Tests
    // -------------------------------------------------------------
    const shouldRunAi = !config.targetSuite || config.targetSuite === 'all' || config.targetSuite === 'ai';
    if (shouldRunAi) {
      const aiAgent = new AITestAgent(uiAutomation, envManager, mockRouter, evidenceManager, logCollector, config);
      aiTests = await aiAgent.runAll();
    }

    // -------------------------------------------------------------
    // STAGE 8: Self-Diagnosis & Analysis
    // -------------------------------------------------------------
    const analyzer = new ResultAnalyzer(logCollector, evidenceManager);
    diagnosisResult = analyzer.analyze([...deterministicTests, ...aiTests]);

  } catch (fatalErr) {
    logCollector.critical('Orchestrator', `Unhandled pipeline failure: ${fatalErr.stack || fatalErr.message}`);
  } finally {
    // -------------------------------------------------------------
    // STAGE 9: Teardown & Clean Resources
    // -------------------------------------------------------------
    if (cdpClient) {
      try { await cdpClient.close(); } catch {}
    }
    if (browserHost) {
      try { await browserHost.stop(); } catch {}
    }
    if (mockRouter) {
      try { await mockRouter.stop(); } catch {}
    }
    if (envManager) {
      try { await envManager.teardown(); } catch {}
    }

    // -------------------------------------------------------------
    // STAGE 10: Final Report & Exit Code
    // -------------------------------------------------------------
    const finalReport = reportGenerator.generate(buildResult, deterministicTests, aiTests, diagnosisResult);
    console.log('\n' + finalReport.reportText);

    if (finalReport.isOverallPass) {
      process.exit(0);
    } else {
      process.exit(1);
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { main };
