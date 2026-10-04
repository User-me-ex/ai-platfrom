'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class BrowserHost {
  constructor(config, envManager, logCollector) {
    this.config = config;
    this.envManager = envManager;
    this.logCollector = logCollector;
    this.port = config.cdpPort || 9444;
    this.browserProc = null;
    this.tempHtmlPath = null;
  }

  locateBrowser() {
    if (this.config.browserExecutable && fs.existsSync(this.config.browserExecutable)) {
      return this.config.browserExecutable;
    }
    const candidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        return c;
      }
    }
    throw new Error('Neither Chrome nor Edge was found on system paths.');
  }

  generateWebviewHtml() {
    const compiledPath = path.resolve('out/src/ui/workflowWebview.js');
    if (!fs.existsSync(compiledPath)) {
      throw new Error(`Compiled webview file not found at: ${compiledPath}`);
    }

    const compiledJs = fs.readFileSync(compiledPath, 'utf8');
    const startMarker = '<!DOCTYPE html>';
    const htmlStart = compiledJs.indexOf(startMarker);
    const endMarker = '</html>`;';
    const htmlEnd = compiledJs.indexOf(endMarker, htmlStart);

    if (htmlStart === -1 || htmlEnd === -1) {
      throw new Error('Could not locate webview HTML template in compiled code.');
    }

    const nonce = 'TEST_NONCE_' + Date.now();
    let html = compiledJs.substring(htmlStart, htmlEnd + 7);

    // Read model catalog if available
    let catalogModels = [];
    const catalogPath = path.resolve('catalog/models.json');
    if (fs.existsSync(catalogPath)) {
      try {
        const rawCatalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
        catalogModels = Object.keys(rawCatalog.models || {}).slice(0, 50);
      } catch {}
    }

    const testState = {
      workflow: null,
      roles: [],
      selectedModel: 'ag/gemini-3.8-flash-high',
      sessionOpts: { temperature: 0.5, maxTokens: 4096 },
      voiceOpts: { liveModel: 'gemini-3.1-flash-live-preview', ttsVoice: 'Kore' },
      voiceActive: false,
      voiceTalking: false,
      voiceMuted: false,
      apiKeys: [],
      filterLive: false,
      liveModels: [],
      workspacePath: this.envManager.workspaceDir,
      rolesJsonPath: this.envManager.rolesJsonPath,
      activeDoc: 'No active editor file',
      catalogSize: catalogModels.length,
      topModels: catalogModels,
      chatMessages: [
        { id: 'm1', sender: 'user', content: 'What can you do?', timestamp: '7:45 PM' },
        { id: 'm2', sender: 'ai', content: 'I can help you build and test code.', timestamp: '7:45 PM' }
      ],
      initialTab: 'chat'
    };

    const testStateJson = JSON.stringify(testState).replace(/</g, '\\u003c');

    html = html
      .replace(/\$\{nonce\}/g, nonce)
      .replace(/\$\{cspSource\}/g, '*')
      .replace(/\$\{initialStateJson\}/g, testStateJson)
      .replace(/\$\{isChat \? 'display: block;' : 'display: none;' \}/g, 'display: block;')
      .replace(/\$\{isChat \? 'display: none;' : 'display: block;' \}/g, 'display: none;')
      .replace(/\$\{isChat \? 'Show Hub' : 'Hide Hub'\}/g, 'Show Hub')
      .replace(/\$\{selectedModel\}/g, 'ag/gemini-3.8-flash-high')
      .replace(/\$\{filterLive \? 'checked' : ''\}/g, '')
      .replace(/\$\{voiceOpts\.ttsVoice === '([^']+)' \? 'selected' : ''\}/g, '')
      .replace(/\$\{voiceOpts\.inputDevice === '([^']+)' \? 'selected' : ''\}/g, '')
      .replace(/\$\{rolesJsonPath \? [^}]+\}/g, this.envManager.rolesJsonPath.replace(/\\/g, '\\\\'))
      .replace(/\$\{version\}/g, '0.5.20');

    html = html.replace(/\$\{[^}]+\}/g, '');

    const mockVsCodeApiScript = `
    <script nonce="${nonce}">
      window.recordedVsCodeMessages = [];
      window.acquireVsCodeApi = function() {
        return {
          postMessage: function(msg) {
            window.recordedVsCodeMessages.push(msg);
            console.log('[VSCODE POSTMESSAGE]', JSON.stringify(msg));
          },
          getState: function() { return {}; },
          setState: function() {}
        };
      };
    </script>`;

    html = html.replace('<script id="initial-state"', `${mockVsCodeApiScript}\n<script id="initial-state"`);

    const outDir = this.envManager.sandboxDir;
    this.tempHtmlPath = path.join(outDir, 'webview_test.html');
    fs.writeFileSync(this.tempHtmlPath, html, 'utf8');

    return this.tempHtmlPath;
  }

  async start() {
    const browserPath = this.locateBrowser();
    const htmlFile = this.generateWebviewHtml();
    const fileUrl = `file:///${htmlFile.replace(/\\/g, '/')}`;

    this.logCollector.info('BrowserHost', `Launching browser engine at: ${browserPath}`);
    this.logCollector.info('BrowserHost', `Loading test webview from: ${fileUrl}`);

    const args = [
      '--headless',
      `--remote-debugging-port=${this.port}`,
      '--disable-gpu',
      '--no-sandbox',
      '--disable-extensions',
      fileUrl
    ];

    this.browserProc = spawn(browserPath, args, { stdio: 'ignore' });

    this.browserProc.on('error', (err) => {
      this.logCollector.critical('BrowserHost', `Browser process error: ${err.message}`);
    });

    // Short stabilization wait
    await new Promise((r) => setTimeout(r, 800));
  }

  async stop() {
    if (this.browserProc) {
      try {
        this.browserProc.kill();
      } catch {}
      this.browserProc = null;
    }
    if (this.tempHtmlPath && !this.config.keepTestEnvironment && !this.config.debugMode) {
      try {
        if (fs.existsSync(this.tempHtmlPath)) fs.unlinkSync(this.tempHtmlPath);
      } catch {}
    }
  }
}

module.exports = { BrowserHost };
