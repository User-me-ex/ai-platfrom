'use strict';

class UIAutomationLayer {
  constructor(cdpClient, evidenceManager, logCollector) {
    this.cdp = cdpClient;
    this.evidence = evidenceManager;
    this.logCollector = logCollector;
    this.actionCount = 0;
  }

  /**
   * Translates a semantic selector or CSS selector into a browser JS expression.
   */
  _buildElementQuery(selector) {
    if (selector.startsWith('#') || selector.startsWith('.') || selector.includes('[')) {
      return `document.querySelector(${JSON.stringify(selector)})`;
    }
    // Text search fallback
    return `(Array.from(document.querySelectorAll('button, a, div, span, label')).find(el => (el.textContent || '').trim().includes(${JSON.stringify(selector)})) || null)`;
  }

  async click(selector) {
    this.actionCount++;
    if (this.logCollector) {
      this.logCollector.info('UIAutomation', `Action #${this.actionCount}: click(${selector})`);
    }

    const query = this._buildElementQuery(selector);
    const result = await this.cdp.evaluate(`
      (() => {
        const el = ${query};
        if (!el) return { success: false, reason: 'Element not found: ' + ${JSON.stringify(selector)} };
        el.scrollIntoView({ block: 'center', inline: 'center' });
        el.click();
        return {
          success: true,
          tagName: el.tagName,
          id: el.id,
          className: el.className
        };
      })()
    `);

    if (!result.success) {
      throw new Error(`Click failed: ${result.reason}`);
    }
    await new Promise((r) => setTimeout(r, 100)); // micro-wait for UI dispatch
    return result;
  }

  async type(selector, text, options = {}) {
    this.actionCount++;
    if (this.logCollector) {
      this.logCollector.info('UIAutomation', `Action #${this.actionCount}: type(${selector}, "${text.length > 30 ? text.slice(0, 30) + '...' : text}")`);
    }

    const query = this._buildElementQuery(selector);
    const result = await this.cdp.evaluate(`
      (() => {
        const el = ${query};
        if (!el) return { success: false, reason: 'Element not found: ' + ${JSON.stringify(selector)} };
        el.focus();
        if (${options.clear !== false}) {
          el.value = '';
        }
        el.value = ${JSON.stringify(text)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, value: el.value };
      })()
    `);

    if (!result.success) {
      throw new Error(`Type failed: ${result.reason}`);
    }
    await new Promise((r) => setTimeout(r, 100));
    return result;
  }

  async select(selector, value) {
    this.actionCount++;
    if (this.logCollector) {
      this.logCollector.info('UIAutomation', `Action #${this.actionCount}: select(${selector}, "${value}")`);
    }

    const query = this._buildElementQuery(selector);
    const result = await this.cdp.evaluate(`
      (() => {
        const el = ${query};
        if (!el) return { success: false, reason: 'Element not found: ' + ${JSON.stringify(selector)} };
        el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, selectedValue: el.value };
      })()
    `);

    if (!result.success) {
      throw new Error(`Select failed: ${result.reason}`);
    }
    await new Promise((r) => setTimeout(r, 100));
    return result;
  }

  async inspectUI(selector) {
    const query = this._buildElementQuery(selector);
    return await this.cdp.evaluate(`
      (() => {
        const el = ${query};
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return {
          exists: true,
          tagName: el.tagName,
          id: el.id,
          className: el.className,
          innerText: (el.innerText || '').trim(),
          value: el.value,
          visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
          display: style.display,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        };
      })()
    `);
  }

  async waitForSelector(selector, timeoutMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const info = await this.inspectUI(selector);
      if (info && info.visible) {
        return info;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`Timed out waiting for visible element: ${selector} after ${timeoutMs}ms`);
  }

  async takeScreenshot(testId, name) {
    if (!this.evidence) return null;
    const base64 = await this.cdp.captureScreenshot();
    return this.evidence.saveScreenshot(testId, name, base64);
  }

  async queryRecordedMessages() {
    return await this.cdp.evaluate(`
      (() => {
        return window.recordedVsCodeMessages || [];
      })()
    `);
  }

  async clearRecordedMessages() {
    return await this.cdp.evaluate(`
      (() => {
        window.recordedVsCodeMessages = [];
        return true;
      })()
    `);
  }
}

module.exports = { UIAutomationLayer };
