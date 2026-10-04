'use strict';

const http = require('http');
const WebSocket = require('ws');

class CDPClient {
  constructor(port = 9444, logCollector = null) {
    this.port = port;
    this.logCollector = logCollector;
    this.ws = null;
    this.msgId = 1;
    this.pendingCallbacks = new Map();
    this.exceptions = [];
    this.consoleMessages = [];
  }

  /**
   * Discovers and connects to the active browser page via CDP.
   */
  async connect(timeoutMs = 10000) {
    const startTime = Date.now();
    let wsUrl = null;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const pages = await new Promise((resolve, reject) => {
          http.get(`http://127.0.0.1:${this.port}/json`, (res) => {
            let data = '';
            res.on('data', (c) => data += c);
            res.on('end', () => {
              try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
          }).on('error', reject);
        });

        const targetPage = pages.find((p) => p.type === 'page' && p.webSocketDebuggerUrl);
        if (targetPage) {
          wsUrl = targetPage.webSocketDebuggerUrl;
          break;
        }
      } catch (err) {
        // Wait and retry
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    if (!wsUrl) {
      throw new Error(`Failed to find CDP WebSocket endpoint on port ${this.port} after ${timeoutMs}ms.`);
    }

    if (this.logCollector) {
      this.logCollector.info('CDPClient', `Connecting to WebSocket: ${wsUrl}`);
    }

    this.ws = new WebSocket(wsUrl);

    await new Promise((resolve, reject) => {
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
    });

    this.ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.id && this.pendingCallbacks.has(parsed.id)) {
          const { resolve, reject } = this.pendingCallbacks.get(parsed.id);
          this.pendingCallbacks.delete(parsed.id);
          if (parsed.error) {
            reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
          } else {
            resolve(parsed.result);
          }
        } else if (parsed.method === 'Runtime.exceptionThrown') {
          const details = parsed.params.exceptionDetails;
          this.exceptions.push(details);
          if (this.logCollector) {
            this.logCollector.error('CDPClient', `Webview Exception: ${details.text} at ${details.url}:${details.lineNumber}`);
          }
        } else if (parsed.method === 'Runtime.consoleAPICalled') {
          const args = parsed.params.args.map((a) => a.value !== undefined ? a.value : a.description);
          this.consoleMessages.push({ type: parsed.params.type, args });
        }
      } catch (err) {
        if (this.logCollector) {
          this.logCollector.warn('CDPClient', `Error handling CDP message: ${err.message}`);
        }
      }
    });

    // Initialize required domains
    await this.send('Runtime.enable');
    await this.send('Page.enable');
    await this.send('DOM.enable');

    if (this.logCollector) {
      this.logCollector.info('CDPClient', 'CDP session established and domains enabled.');
    }
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('CDP WebSocket is not open.'));
      }
      const id = this.msgId++;
      this.pendingCallbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (res.exceptionDetails) {
      throw new Error(`Evaluation failed: ${res.exceptionDetails.text}`);
    }
    return res.result ? res.result.value : undefined;
  }

  async captureScreenshot() {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    return res.data; // Base64 encoded string
  }

  async close() {
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
  }
}

module.exports = { CDPClient };
