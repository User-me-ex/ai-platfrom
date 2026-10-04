'use strict';

const fs = require('fs');
const path = require('path');

class EnvironmentManager {
  constructor(config, logCollector) {
    this.config = config;
    this.logCollector = logCollector;
    this.sandboxDir = config.sandboxDir || path.join(process.cwd(), '.antigravity-test-sandbox');

    this.workspaceDir = path.join(this.sandboxDir, 'workspace');
    this.userDataDir = path.join(this.sandboxDir, 'user-data');
    this.extensionsDir = path.join(this.sandboxDir, 'extensions');
    this.rolesJsonPath = path.join(this.workspaceDir, '.antigravity', 'roles.json');
    this.settingsJsonPath = path.join(this.userDataDir, 'User', 'settings.json');
  }

  async setup() {
    this.logCollector.info('EnvironmentManager', `Provisioning isolated sandbox at: ${this.sandboxDir}`);

    // Clean previous sandbox if exists
    if (fs.existsSync(this.sandboxDir)) {
      try {
        fs.rmSync(this.sandboxDir, { recursive: true, force: true });
      } catch (err) {
        this.logCollector.warn('EnvironmentManager', `Failed to clean previous sandbox: ${err.message}`);
      }
    }

    // Create directory tree
    fs.mkdirSync(this.workspaceDir, { recursive: true });
    fs.mkdirSync(path.join(this.workspaceDir, '.antigravity'), { recursive: true });
    fs.mkdirSync(path.join(this.workspaceDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(this.userDataDir, 'User'), { recursive: true });
    fs.mkdirSync(this.extensionsDir, { recursive: true });

    // Seed mock workspace files
    const defaultRoles = [
      {
        id: 'researcher',
        name: 'Researcher',
        purpose: 'Analyzes project context and requirements.',
        primaryModel: 'ag/gemini-3.8-flash-high',
        fallbackModels: ['ag/gemini-2.5-flash-native-audio-latest'],
        enabled: true,
        systemPrompt: 'You are an expert researcher.'
      },
      {
        id: 'backend',
        name: 'Backend Engineer',
        purpose: 'Develops server logic, APIs, and data models.',
        primaryModel: 'ag/gemini-3.8-flash-high',
        fallbackModels: ['ag/gemini-3.1-flash-live-preview'],
        enabled: true,
        systemPrompt: 'You are a senior backend engineer.'
      },
      {
        id: 'frontend',
        name: 'Frontend Engineer',
        purpose: 'Builds UI components, webviews, and styles.',
        primaryModel: 'ag/gemini-3.8-flash-high',
        fallbackModels: [],
        enabled: true,
        systemPrompt: 'You are an expert UI developer.'
      },
      {
        id: 'tester',
        name: 'QA Engineer',
        purpose: 'Writes tests and performs QA verification.',
        primaryModel: 'ag/gemini-3.8-flash-high',
        fallbackModels: [],
        enabled: true,
        systemPrompt: 'You are a meticulous QA engineer.'
      }
    ];
    fs.writeFileSync(this.rolesJsonPath, JSON.stringify(defaultRoles, null, 2), 'utf8');

    // Seed sample project file
    fs.writeFileSync(
      path.join(this.workspaceDir, 'src', 'sample.ts'),
      '// Sample test file in isolated sandbox\nexport function calculateSum(a: number, b: number): number {\n  return a + b;\n}\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(this.workspaceDir, 'README.md'),
      '# Isolated Test Workspace\nThis workspace is generated automatically for automated E2E testing.\n',
      'utf8'
    );

    // Seed test settings.json
    const testSettings = {
      'antigravity.router.baseUrl': `http://127.0.0.1:${this.config.mockRouterPort}/v1`,
      'antigravity.router.apiKey': 'test-api-key',
      'antigravity.models.filterLive': false,
      'antigravity.session.temperature': 0.5,
      'antigravity.session.maxTokens': 2048,
      'antigravity.session.allowShell': true,
      'antigravity.session.allowFiles': true,
      'antigravity.session.allowVscode': true,
      'antigravity.session.allowWeb': true,
      'antigravity.session.persistHistory': true,
      'antigravity.session.unifiedVoiceAndText': true
    };
    fs.writeFileSync(this.settingsJsonPath, JSON.stringify(testSettings, null, 2), 'utf8');

    this.logCollector.info('EnvironmentManager', 'Sandbox environment provisioned successfully.');
    return {
      sandboxDir: this.sandboxDir,
      workspaceDir: this.workspaceDir,
      userDataDir: this.userDataDir,
      extensionsDir: this.extensionsDir,
      rolesJsonPath: this.rolesJsonPath,
      settingsJsonPath: this.settingsJsonPath
    };
  }

  async teardown() {
    if (this.config.keepTestEnvironment || this.config.debugMode) {
      this.logCollector.info(
        'EnvironmentManager',
        `Preserving sandbox environment for inspection at: ${this.sandboxDir} (keepTestEnvironment=true / TEST_DEBUG)`
      );
      return;
    }

    this.logCollector.info('EnvironmentManager', `Cleaning up sandbox at: ${this.sandboxDir}`);
    try {
      if (fs.existsSync(this.sandboxDir)) {
        fs.rmSync(this.sandboxDir, { recursive: true, force: true });
        this.logCollector.info('EnvironmentManager', 'Sandbox cleanup complete.');
      }
    } catch (err) {
      this.logCollector.warn('EnvironmentManager', `Failed to clean sandbox: ${err.message}`);
    }
  }
}

module.exports = { EnvironmentManager };
