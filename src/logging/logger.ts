/**
 * 9 Router CLI — Logging System
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface LoggerConfig {
  level: LogLevel;
  file?: string;
  pretty?: boolean;
}

export class Logger {
  private level: number;
  private filePath?: string;
  private pretty: boolean;
  private context: Record<string, unknown>;

  constructor(config: LoggerConfig) {
    this.level = LOG_LEVELS[config.level];
    this.filePath = config.file;
    this.pretty = config.pretty ?? true;
    this.context = {};
  }

  debug(...args: unknown[]): void {
    this.log("debug", ...args);
  }

  info(...args: unknown[]): void {
    this.log("info", ...args);
  }

  warn(...args: unknown[]): void {
    this.log("warn", ...args);
  }

  error(...args: unknown[]): void {
    this.log("error", ...args);
  }

  child(context: Record<string, unknown>): Logger {
    const child = new Logger({
      level: this.level === LOG_LEVELS.debug ? "debug" : "info",
      file: this.filePath,
      pretty: this.pretty,
    });
    child.level = this.level;
    child.context = { ...this.context, ...context };
    return child;
  }

  private log(level: LogLevel, ...args: unknown[]): void {
    if (LOG_LEVELS[level] < this.level) return;

    const timestamp = new Date().toISOString();
    const message = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");

    const contextStr = Object.keys(this.context).length > 0
      ? ` ${JSON.stringify(this.context)}`
      : "";

    if (this.pretty) {
      const prefix = this.getPrettyPrefix(level);
      console.error(`${prefix} ${message}${contextStr}`);
    } else {
      const entry = JSON.stringify({
        timestamp,
        level,
        message,
        context: this.context,
      });
      console.error(entry);

      // Write to file if configured
      if (this.filePath) {
        try {
          const fs = require("fs");
          fs.appendFileSync(this.filePath, entry + "\n");
        } catch {
          // Silently fail if we can't write to log file
        }
      }
    }
  }

  private getPrettyPrefix(level: LogLevel): string {
    const colors: Record<LogLevel, string> = {
      debug: "\x1b[90m",    // Gray
      info: "\x1b[36m",     // Cyan
      warn: "\x1b[33m",     // Yellow
      error: "\x1b[31m",    // Red
    };
    const labels: Record<LogLevel, string> = {
      debug: "DBG",
      info: "INF",
      warn: "WRN",
      error: "ERR",
    };
    return `${colors[level]}[${labels[level]}]\x1b[0m`;
  }
}

/** Create a default logger instance */
export function createLogger(level: LogLevel = "info"): Logger {
  return new Logger({ level, pretty: true });
}
