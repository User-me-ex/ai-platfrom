'use strict';

const fs = require('fs');
const path = require('path');

class LogCollector {
  constructor(options = {}) {
    this.logs = [];
    this.silent = options.silent || false;
    this.maxLogs = options.maxLogs || 5000;
  }

  log(level, subsystem, message, metadata = null) {
    const entry = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      subsystem,
      message: typeof message === 'object' ? JSON.stringify(message) : String(message),
      metadata
    };

    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    if (!this.silent) {
      const color = this._getColor(entry.level);
      const reset = '\x1b[0m';
      console.log(`${color}[${entry.level}][${subsystem}]${reset} ${entry.message}`);
    }

    return entry;
  }

  info(subsystem, message, metadata) {
    return this.log('INFO', subsystem, message, metadata);
  }

  warn(subsystem, message, metadata) {
    return this.log('WARNING', subsystem, message, metadata);
  }

  error(subsystem, message, metadata) {
    return this.log('ERROR', subsystem, message, metadata);
  }

  critical(subsystem, message, metadata) {
    return this.log('CRITICAL', subsystem, message, metadata);
  }

  _getColor(level) {
    switch (level) {
      case 'CRITICAL': return '\x1b[35m'; // Magenta
      case 'ERROR': return '\x1b[31m';    // Red
      case 'WARNING': return '\x1b[33m';  // Yellow
      case 'INFO':
      default: return '\x1b[36m';         // Cyan
    }
  }

  getLogs(filterLevel = null) {
    if (!filterLevel) return this.logs;
    return this.logs.filter((l) => l.level === filterLevel.toUpperCase());
  }

  getCriticalErrors() {
    return this.logs.filter((l) => l.level === 'CRITICAL');
  }

  getErrors() {
    return this.logs.filter((l) => l.level === 'ERROR');
  }

  getWarnings() {
    return this.logs.filter((l) => l.level === 'WARNING');
  }

  hasCriticalErrors() {
    return this.getCriticalErrors().length > 0;
  }

  hasErrors() {
    return this.getErrors().length > 0;
  }

  dumpToFile(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const formatted = this.logs
      .map((l) => `[${l.timestamp}] [${l.level.padEnd(8)}] [${l.subsystem.padEnd(16)}] ${l.message}`)
      .join('\n');
    fs.writeFileSync(filePath, formatted, 'utf8');
  }

  clear() {
    this.logs = [];
  }
}

module.exports = { LogCollector };
