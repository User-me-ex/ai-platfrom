/**
 * 9 Router CLI — Security & Safety System
 *
 * Inspired by Ruflo's aidefence (threat detection) and Hermes' file safety:
 * - Threat detection for prompt injection, CVE patterns
 * - File safety validation before writes
 * - Plugin sandboxing with path allowlists/denylists
 * - Real-time security event monitoring
 */

import { normalize } from "path";
import { EventBus } from "../core/events";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ThreatSeverity = "info" | "low" | "medium" | "high" | "critical";

export type ThreatType =
  | "prompt_injection"
  | "path_traversal"
  | "command_injection"
  | "sensitive_data_exposure"
  | "file_write_outside_allowed"
  | "dangerous_shell_command"
  | "suspicious_import"
  | "network_egress"
  | "cve_dependency";

export interface ThreatEvent {
  type: ThreatType;
  severity: ThreatSeverity;
  source: string;
  details: string;
  timestamp: number;
  mitigated: boolean;
}

export interface SafetyPolicy {
  allowedPaths: string[];
  deniedPaths: string[];
  maxFileSize: number;
  allowNetwork: boolean;
  allowShellCommands: boolean;
  maxFileChangesPerOperation: number;
  allowedShellCommands: string[];
}

export interface FileValidationResult {
  safe: boolean;
  reason?: string;
  normalizedPath: string;
}

// ─── Threat Detection ─────────────────────────────────────────────────────────

export class ThreatDetector {
  private eventBus: EventBus;
  private threats: ThreatEvent[] = [];
  private readonly maxThreatLog = 100;

  // Known prompt injection patterns
  private readonly injectionPatterns = [
    /ignore\s+(all\s+)?previous\s+instructions/i,
    /forget\s+(all\s+)?previous\s+(instructions|context)/i,
    /you\s+are\s+(now|not\s+(required|obligated))\s+to/i,
    /system\s+(prompt|instruction)s?:\s*ignore/i,
    /\[\s*SYSTEM\s*\]\s*:\s*override/i,
    /disregard\s+(all\s+)?(previous|prior)\s+(instructions|directives)/i,
    /new\s+(instructions|directives|orders)\s*follow/i,
    /you\s+(will|must|shall)\s+now\s+(act|behave|respond)\s+as/i,
    /\[\s*END\s+OF\s+CONTEXT\s*\]/i,
    /\[\s*NEW\s+SESSION\s*\]/i,
  ];

  // Known CVE patterns in dependencies
  private readonly cvePatterns = [
    /lodash\s*[<>=~]+\s*4\.17\.(1[0-9]|0)/,
    /axios\s*[<>=~]+\s*0\.(2[1-9]|[3-9][0-9])\./,
    /express\s*[<>=~]+\s*4\.(1[0-6]|17)\.[0-9]/,
    /minimatch\s*[<>=~]+\s*3\.0\.[0-4]/,
    /undici\s*[<>=~]+\s*5\.(1[5-9]|2[0-8])\./,
    /node-fetch\s*[<>=~]+\s*2\.6\.[0-6]/,
    /follow-redirects\s*[<>=~]+\s*1\.(14\.[0-9]|15\.[0-4])/,
    /json5\s*[<>=~]+\s*[0-1]\./,
    /path-to-regexp\s*[<>=~]+\s*0\.1\./,
  ];

  // Sensitive data patterns
  private readonly sensitivePatterns = [
    /(?:api[_-]?key|apikey|api[_-]?secret)\s*[=:]\s*['\"][^'\"]+['\"]/i,
    /(?:sk-[a-zA-Z0-9]{20,}|pk-[a-zA-Z0-9]{20,})/,
    /(?:ghp_|gho_|ghu_|ghs_|ghr_)[a-zA-Z0-9]{36}/,
    /(?:AKIA[0-9A-Z]{16})/,
    /(?:-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----)/,
    /(?:bearer\s+[a-zA-Z0-9\-._~+/]+=*)/i,
    /(?:password\s*[=:]\s*['\"][^'\"]+['\"])/i,
    /(?:token\s*[=:]\s*['\"][a-zA-Z0-9\-._~+/]+=*['\"])/i,
  ];

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /** Analyze a user message for prompt injection attempts */
  analyzeMessage(content: string): ThreatEvent | null {
    for (const pattern of this.injectionPatterns) {
      if (pattern.test(content)) {
        return this.recordThreat("prompt_injection", "high", "user_message", `Suspicious pattern: ${pattern.source.slice(0, 80)}`, true);
      }
    }
    return null;
  }

  /** Analyze file content for sensitive data exposure */
  analyzeFileContent(filePath: string, content: string): ThreatEvent[] {
    const threats: ThreatEvent[] = [];
    for (const pattern of this.sensitivePatterns) {
      const matches = content.match(pattern);
      if (matches) {
        threats.push(this.recordThreat(
          "sensitive_data_exposure",
          "high",
          filePath,
          `Sensitive pattern detected: ${pattern.source.slice(0, 60)}`,
          true
        ));
      }
    }
    return threats;
  }

  /** Analyze dependencies for known vulnerabilities */
  analyzeDependencies(packageJson: Record<string, unknown>): ThreatEvent[] {
    const threats: ThreatEvent[] = [];
    const deps = { ...(packageJson.dependencies as Record<string, string> ?? {}), ...(packageJson.devDependencies as Record<string, string> ?? {}) };

    for (const [name, version] of Object.entries(deps)) {
      for (const pattern of this.cvePatterns) {
        const depStr = `${name}${version}`;
        if (pattern.test(depStr)) {
          threats.push(this.recordThreat(
            "cve_dependency",
            "medium",
            `dependency:${name}`,
            `Potentially vulnerable: ${name}@${version}`,
            false
          ));
        }
      }
    }
    return threats;
  }

  /** Check for dangerous shell commands */
  analyzeCommand(command: string): ThreatEvent | null {
    const dangerousPatterns = [
      /rm\s+-rf\s+\//,
      />(?:\s*>)?\s*\/dev\/(sda|sdb|sdc|nvme)/,
      /:\s*\(\)\s*\{.*:\s*:\s*\};/,
      /chmod\s+-R\s+777\s+\//,
      /dd\s+if=\/dev\/zero/,
      /mkfs\.\w+/,
      /fdisk\s+\/dev\/(sda|sdb)/,
      /curl\s+.*\|\s*(?:bash|sh|zsh)/,
      /wget\s+.*\|\s*(?:bash|sh|zsh)/,
      /eval\s*\(/,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        return this.recordThreat("dangerous_shell_command", "critical", "command", `Dangerous command: ${command.slice(0, 100)}`, true);
      }
    }
    return null;
  }

  /** Check for path traversal attempts */
  analyzePath(filePath: string): ThreatEvent | null {
    const normalized = normalize(filePath);
    if (normalized.includes("..")) {
      return this.recordThreat("path_traversal", "high", filePath, `Path traversal detected: ${filePath}`, true);
    }
    if (/[<>"|?*]/.test(normalized)) {
      return this.recordThreat("path_traversal", "medium", filePath, `Invalid path characters: ${filePath}`, true);
    }
    return null;
  }

  /** Get recent threat log */
  getThreatLog(severity?: ThreatSeverity): ThreatEvent[] {
    if (severity) {
      const severityOrder = ["info", "low", "medium", "high", "critical"];
      const minLevel = severityOrder.indexOf(severity);
      return this.threats.filter((t) => severityOrder.indexOf(t.severity) >= minLevel);
    }
    return [...this.threats];
  }

  private recordThreat(type: ThreatType, severity: ThreatSeverity, source: string, details: string, mitigated: boolean): ThreatEvent {
    const threat: ThreatEvent = { type, severity, source, details, timestamp: Date.now(), mitigated };
    this.threats.push(threat);
    if (this.threats.length > this.maxThreatLog) this.threats.shift();
    this.eventBus.emit("security:threat:detected", type, details);
    return threat;
  }
}

// ─── File Safety Validator ────────────────────────────────────────────────────

export class FileSafetyValidator {
  private policy: SafetyPolicy;
  private eventBus: EventBus;

  constructor(policy: SafetyPolicy, eventBus: EventBus) {
    this.policy = policy;
    this.eventBus = eventBus;
  }

  /** Validate a file path for safety */
  validatePath(filePath: string): FileValidationResult {
    const normalized = normalize(filePath);

    // Check denied paths
    for (const denied of this.policy.deniedPaths) {
      if (normalized.startsWith(normalize(denied))) {
        this.eventBus.emit("security:file:blocked", filePath, `Path is in denied list: ${denied}`);
        return { safe: false, reason: `Path is denied: ${denied}`, normalizedPath: normalized };
      }
    }

    // Check allowed paths (if any are configured)
    if (this.policy.allowedPaths.length > 0) {
      const allowed = this.policy.allowedPaths.some((p) => normalized.startsWith(normalize(p)));
      if (!allowed) {
        this.eventBus.emit("security:file:blocked", filePath, "Path not in allowed list");
        return { safe: false, reason: "Path not in allowed list", normalizedPath: normalized };
      }
    }

    return { safe: true, normalizedPath: normalized };
  }

  /** Validate file content size */
  validateFileSize(content: string | Buffer): boolean {
    const size = typeof content === "string" ? Buffer.byteLength(content) : content.length;
    return size <= this.policy.maxFileSize;
  }

  /** Validate a shell command */
  validateCommand(command: string): boolean {
    if (!this.policy.allowShellCommands) return false;

    const parts = command.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();

    if (cmd && this.policy.allowedShellCommands.length > 0) {
      return this.policy.allowedShellCommands.includes(cmd);
    }

    return true;
  }

  /** Update safety policy */
  updatePolicy(updates: Partial<SafetyPolicy>): void {
    this.policy = { ...this.policy, ...updates };
  }
}

// ─── Plugin Sandbox ───────────────────────────────────────────────────────────

export class PluginSandbox {
  private allowedHosts: string[];
  private allowedAPIs: string[];

  constructor(allowedHosts: string[] = [], allowedAPIs: string[] = []) {
    this.allowedHosts = allowedHosts;
    this.allowedAPIs = allowedAPIs;
  }

  /** Check if a network host is allowed */
  checkNetworkAccess(host: string): boolean {
    if (this.allowedHosts.length === 0) return false;
    return this.allowedHosts.some((h) => host === h || host.endsWith(`.${h}`));
  }

  /** Check if an API method is allowed */
  checkAPIAccess(api: string): boolean {
    if (this.allowedAPIs.length === 0) return false;
    return this.allowedAPIs.includes(api);
  }

  /** Configure allowed hosts */
  setAllowedHosts(hosts: string[]): void {
    this.allowedHosts = hosts;
  }

  /** Configure allowed APIs */
  setAllowedAPIs(apis: string[]): void {
    this.allowedAPIs = apis;
  }
}

// ─── Security Manager ─────────────────────────────────────────────────────────

export class SecurityManager {
  readonly detector: ThreatDetector;
  readonly fileValidator: FileSafetyValidator;
  readonly pluginSandbox: PluginSandbox;
  private policy: SafetyPolicy;

  constructor(eventBus: EventBus) {
    this.policy = {
      allowedPaths: [process.cwd()],
      deniedPaths: ["/etc", "/sys", "/proc", "/dev", "/boot"],
      maxFileSize: 10 * 1024 * 1024, // 10MB
      allowNetwork: false,
      allowShellCommands: false,
      maxFileChangesPerOperation: 50,
      allowedShellCommands: ["ls", "cat", "head", "tail", "echo", "pwd", "which", "git"],
    };
    this.detector = new ThreatDetector(eventBus);
    this.fileValidator = new FileSafetyValidator(this.policy, eventBus);
    this.pluginSandbox = new PluginSandbox();
  }

  /** Get current safety policy */
  getPolicy(): SafetyPolicy {
    return { ...this.policy };
  }

  /** Update safety policy */
  updatePolicy(updates: Partial<SafetyPolicy>): void {
    this.policy = { ...this.policy, ...updates };
    this.fileValidator.updatePolicy(updates);
  }
}


