'use strict';

const path = require('path');
const fs = require('fs');

/**
 * Default testing configuration
 */
const DEFAULT_CONFIG = {
  testing: {
    keepTestEnvironment: false,
    captureScreenshots: true,
    captureLogs: true,
    stopOnCriticalFailure: false,
    timeoutMs: 60000,
    maxAiActions: 50,
    cdpPort: 9444,
    mockRouterPort: 20129,
    browserExecutable: null, // auto-detected if null
    codeExecutable: null     // auto-detected if null
  }
};

/**
 * Loads test configuration from test-config.json, environment variables, and CLI flags.
 */
function loadTestConfig(rootDir = process.cwd()) {
  const configPath = path.join(rootDir, 'test-config.json');
  let fileConfig = {};

  if (fs.existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
      console.warn(`[config] Warning: Failed to parse ${configPath}:`, err.message);
    }
  }

  const merged = {
    ...DEFAULT_CONFIG.testing,
    ...(fileConfig.testing || {})
  };

  // Environment variable overrides
  if (process.env.TEST_DEBUG === 'true' || process.env.TEST_DEBUG === '1') {
    merged.debugMode = true;
    merged.keepTestEnvironment = true;
  }
  if (process.env.KEEP_TEST_ENV === 'true') {
    merged.keepTestEnvironment = true;
  }
  if (process.env.CAPTURE_SCREENSHOTS === 'false') {
    merged.captureScreenshots = false;
  }
  if (process.env.CDP_PORT) {
    merged.cdpPort = parseInt(process.env.CDP_PORT, 10);
  }

  // CLI argument overrides
  const args = process.argv.slice(2);
  for (const arg of args) {
    if (arg === '--debug') {
      merged.debugMode = true;
      merged.keepTestEnvironment = true;
    } else if (arg === '--keep-env') {
      merged.keepTestEnvironment = true;
    } else if (arg.startsWith('--suite=')) {
      merged.targetSuite = arg.split('=')[1];
    } else if (arg === '--no-screenshots') {
      merged.captureScreenshots = false;
    }
  }

  // Derived paths
  merged.rootDir = rootDir;
  merged.sandboxDir = path.join(rootDir, '.antigravity-test-sandbox');
  merged.resultsDir = path.join(rootDir, 'test-results');

  return merged;
}

module.exports = {
  loadTestConfig,
  DEFAULT_CONFIG
};
