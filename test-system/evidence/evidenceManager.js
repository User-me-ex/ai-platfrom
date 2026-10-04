'use strict';

const fs = require('fs');
const path = require('path');

class EvidenceManager {
  constructor(resultsDir = path.join(process.cwd(), 'test-results'), logCollector) {
    this.resultsDir = resultsDir;
    this.logCollector = logCollector;
    this.evidenceMap = new Map();

    if (!fs.existsSync(this.resultsDir)) {
      fs.mkdirSync(this.resultsDir, { recursive: true });
    }
  }

  getTestDir(testId) {
    const testDir = path.join(this.resultsDir, testId);
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    return testDir;
  }

  saveScreenshot(testId, filename, base64OrBuffer) {
    try {
      const testDir = this.getTestDir(testId);
      const targetFile = path.join(testDir, filename.endsWith('.png') ? filename : `${filename}.png`);
      const buffer = Buffer.isBuffer(base64OrBuffer)
        ? base64OrBuffer
        : Buffer.from(base64OrBuffer, 'base64');
      fs.writeFileSync(targetFile, buffer);

      if (!this.evidenceMap.has(testId)) {
        this.evidenceMap.set(testId, { screenshots: [], logs: null });
      }
      this.evidenceMap.get(testId).screenshots.push(targetFile);
      if (this.logCollector) {
        this.logCollector.info('EvidenceManager', `Saved screenshot for ${testId}: ${path.relative(this.resultsDir, targetFile)}`);
      }
      return targetFile;
    } catch (err) {
      if (this.logCollector) {
        this.logCollector.error('EvidenceManager', `Failed to save screenshot for ${testId}: ${err.message}`);
      }
      return null;
    }
  }

  saveTestLogs(testId, logs) {
    try {
      const testDir = this.getTestDir(testId);
      const targetFile = path.join(testDir, 'logs.txt');
      const content = Array.isArray(logs)
        ? logs.map((l) => `[${l.timestamp}] [${l.level}] [${l.subsystem}] ${l.message}`).join('\n')
        : String(logs);
      fs.writeFileSync(targetFile, content, 'utf8');

      if (!this.evidenceMap.has(testId)) {
        this.evidenceMap.set(testId, { screenshots: [], logs: null });
      }
      this.evidenceMap.get(testId).logs = targetFile;
      return targetFile;
    } catch (err) {
      if (this.logCollector) {
        this.logCollector.error('EvidenceManager', `Failed to save logs for ${testId}: ${err.message}`);
      }
      return null;
    }
  }

  getEvidence(testId) {
    return this.evidenceMap.get(testId) || { screenshots: [], logs: null };
  }
}

module.exports = { EvidenceManager };
