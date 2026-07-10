/**
 * 9 Router CLI — Cron & Automation System
 *
 * Inspired by Hermes Agent's cron scheduler:
 * - Built-in cron scheduler with configurable jobs
 * - Job blueprint catalog with reusable templates
 * - Lifecycle guards to prevent runaway tasks
 * - Suggestion catalog for AI-recommended recurring tasks
 */

import { execSync } from "child_process";
import { EventBus } from "../core/events";

// ─── Types ────────────────────────────────────────────────────────────────────

export type JobStatus = "active" | "paused" | "completed" | "failed";
export type JobType = "report" | "backup" | "monitor" | "notify" | "sync" | "cleanup" | "custom";

export interface CronJob {
  id: string;
  name: string;
  type: JobType;
  description: string;
  cronExpression: string;
  command: string;
  enabled: boolean;
  status: JobStatus;
  maxRuns?: number;
  runCount: number;
  lastRun?: number;
  lastDuration?: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

export interface JobBlueprint {
  id: string;
  name: string;
  type: JobType;
  description: string;
  cronExpression: string;
  commandTemplate: string;
  parameters: Array<{ name: string; description: string; default: string }>;
}

export interface JobResult {
  jobId: string;
  success: boolean;
  output: string;
  duration: number;
  error?: string;
  timestamp: number;
}

export interface LifecycleGuardConfig {
  maxConcurrentJobs: number;
  maxRuntimePerJob: number; // ms
  maxDailyRunsPerJob: number;
  maxMemoryPerJob: number; // MB
  cooldownBetweenRuns: number; // ms
}

// ─── Blueprint Catalog ────────────────────────────────────────────────────────

export class BlueprintCatalog {
  private blueprints: Map<string, JobBlueprint> = new Map();

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults(): void {
    this.register({
      id: "daily-report",
      name: "Daily Report",
      type: "report",
      description: "Generate a daily summary of conversations and token usage",
      cronExpression: "0 9 * * 1-5",
      commandTemplate: "/system Generate a daily report and output as markdown",
      parameters: [{ name: "timeframe", description: "Report timeframe (24h, 7d, 30d)", default: "24h" }],
    });

    this.register({
      id: "session-backup",
      name: "Session Backup",
      type: "backup",
      description: "Backup all sessions to JSON files",
      cronExpression: "0 */6 * * *",
      commandTemplate: "/export json > backups/sessions-{date}.json",
      parameters: [{ name: "format", description: "Export format (json, md)", default: "json" }],
    });

    this.register({
      id: "model-health-check",
      name: "Model Health Check",
      type: "monitor",
      description: "Check if 9 Router models are healthy and responsive",
      cronExpression: "*/15 * * * *",
      commandTemplate: "/status",
      parameters: [
        { name: "timeout", description: "Health check timeout in seconds", default: "10" },
        { name: "notify_on_failure", description: "Send notification on failure", default: "true" },
      ],
    });

    this.register({
      id: "token-usage-report",
      name: "Token Usage Report",
      type: "report",
      description: "Track and report token consumption",
      cronExpression: "0 0 * * 0",
      commandTemplate: "/context",
      parameters: [{ name: "threshold", description: "Alert threshold in tokens", default: "100000" }],
    });

    this.register({
      id: "cache-cleanup",
      name: "Cache Cleanup",
      type: "cleanup",
      description: "Clear old cache and temporary files",
      cronExpression: "0 3 * * 0",
      commandTemplate: "",
      parameters: [
        { name: "max_age_days", description: "Maximum cache age in days", default: "30" },
        { name: "dry_run", description: "Preview without deleting", default: "true" },
      ],
    });
  }

  register(blueprint: JobBlueprint): void {
    this.blueprints.set(blueprint.id, blueprint);
  }

  get(id: string): JobBlueprint | undefined {
    return this.blueprints.get(id);
  }

  list(type?: JobType): JobBlueprint[] {
    const all = [...this.blueprints.values()];
    return type ? all.filter((b) => b.type === type) : all;
  }

  createJobFromBlueprint(blueprintId: string, overrides: Partial<CronJob>): CronJob | null {
    const blueprint = this.blueprints.get(blueprintId);
    if (!blueprint) return null;

    return {
      id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: `${blueprint.name}${overrides.name ? ` (${overrides.name})` : ""}`,
      type: blueprint.type,
      description: blueprint.description,
      cronExpression: overrides.cronExpression ?? blueprint.cronExpression,
      command: blueprint.commandTemplate,
      enabled: true,
      status: "active",
      runCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    };
  }
}

// ─── Cron Parser ──────────────────────────────────────────────────────────────

export function parseCronExpression(expr: string): { minute: number[]; hour: number[]; dayOfMonth: number[]; month: number[]; dayOfWeek: number[] } {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Invalid cron expression: "${expr}" — expected 5 fields`);

  const safeParts: string[] = [parts[0] ?? "*", parts[1] ?? "*", parts[2] ?? "*", parts[3] ?? "*", parts[4] ?? "*"];

  const parseField = (field: string | undefined, min: number, max: number): number[] => {
    const f = field ?? "*";
    if (f === "*") return Array.from({ length: max - min + 1 }, (_, i) => i + min);
    if (f.includes("/")) {
      const [range = "*", stepStr = "1"] = f.split("/");
      const step = parseInt(stepStr, 10) || 1;
      const [startRaw = "*", endRaw] = range.split("-");
      const start = startRaw === "*" ? min : parseInt(startRaw, 10) || min;
      const end = endRaw ? parseInt(endRaw, 10) || max : max;
      const result: number[] = [];
      for (let i = start; i <= end; i += step) result.push(i);
      return result;
    }
    if (f.includes(",")) return f.split(",").map((n) => parseInt(n.trim(), 10) || min);
    if (f.includes("-")) {
      const [s = min.toString(), e = max.toString()] = f.split("-");
      const start = parseInt(s, 10) || min;
      const end = parseInt(e, 10) || max;
      return Array.from({ length: end - start + 1 }, (_, i) => i + start);
    }
    return [parseInt(f, 10) || min];
  };

  return {
    minute: parseField(safeParts[0], 0, 59),
    hour: parseField(safeParts[1], 0, 23),
    dayOfMonth: parseField(safeParts[2], 1, 31),
    month: parseField(safeParts[3], 1, 12),
    dayOfWeek: parseField(safeParts[4], 0, 6),
  };
}

export function cronMatches(expr: ReturnType<typeof parseCronExpression>, date: Date): boolean {
  return (
    expr.minute.includes(date.getMinutes()) &&
    expr.hour.includes(date.getHours()) &&
    expr.dayOfMonth.includes(date.getDate()) &&
    expr.month.includes(date.getMonth() + 1) &&
    expr.dayOfWeek.includes(date.getDay())
  );
}

// ─── Suggestion Catalog ───────────────────────────────────────────────────────

export interface JobSuggestion {
  id: string;
  title: string;
  description: string;
  reason: string;
  blueprintId?: string;
  confidence: number; // 0-1
}

export class SuggestionCatalog {
  private suggestions: JobSuggestion[] = [];
  private history: Array<{ pattern: string; count: number }> = [];

  /** Record a user activity pattern for suggestions */
  recordActivity(pattern: string): void {
    const existing = this.history.find((h) => h.pattern === pattern);
    if (existing) existing.count++;
    else this.history.push({ pattern, count: 1 });
  }

  /** Get stored suggestions */
  getStoredSuggestions(): JobSuggestion[] { return [...this.suggestions]; }

  /** Generate suggestions based on usage patterns */
  generateSuggestions(): JobSuggestion[] {
    const result: JobSuggestion[] = [];

    // If user frequently checks status, suggest monitoring
    const statusChecks = this.history.find((h) => h.pattern === "status_check");
    if (statusChecks && statusChecks.count > 5) {
      result.push({
        id: "suggest_monitor",
        title: "Auto-Monitor 9 Router",
        description: "Schedule automatic health checks every 15 minutes",
        reason: `You've checked status ${statusChecks.count} times manually`,
        blueprintId: "model-health-check",
        confidence: 0.7,
      });
    }

    // If user has many conversations, suggest backup
    const conversationCount = this.history.find((h) => h.pattern === "new_conversation");
    if (conversationCount && conversationCount.count > 10) {
      result.push({
        id: "suggest_backup",
        title: "Schedule Session Backup",
        description: "Backup sessions every 6 hours to prevent data loss",
        reason: `You've started ${conversationCount.count} conversations`,
        blueprintId: "session-backup",
        confidence: 0.6,
      });
    }

    return result;
  }

  /** Get activity history */
  getActivityHistory(): Array<{ pattern: string; count: number }> {
    return [...this.history];
  }
}

// ─── Lifecycle Guard ──────────────────────────────────────────────────────────

export class LifecycleGuard {
  private config: LifecycleGuardConfig;
  private runningJobs = new Map<string, { startTime: number; abort: () => void }>();
  private dailyRunCounts = new Map<string, number>();
  private lastResetDay = new Date().getDate();

  constructor(config?: Partial<LifecycleGuardConfig>) {
    this.config = {
      maxConcurrentJobs: 5,
      maxRuntimePerJob: 30 * 60 * 1000, // 30 minutes
      maxDailyRunsPerJob: 50,
      maxMemoryPerJob: 512,
      cooldownBetweenRuns: 1000, // 1 second
      ...config,
    };
  }

  /** Check if a job can start */
  canStart(jobId: string): { allowed: boolean; reason?: string } {
    // Check concurrent jobs
    if (this.runningJobs.size >= this.config.maxConcurrentJobs) {
      return { allowed: false, reason: "Max concurrent jobs reached" };
    }

    // Check daily runs
    this.resetDailyIfNeeded();
    const dailyCount = this.dailyRunCounts.get(jobId) ?? 0;
    if (dailyCount >= this.config.maxDailyRunsPerJob) {
      return { allowed: false, reason: "Max daily runs reached" };
    }

    return { allowed: true };
  }

  /** Register a started job */
  onStart(jobId: string): void {
    const abortController = new AbortController();
    this.runningJobs.set(jobId, { startTime: Date.now(), abort: () => abortController.abort() });
    this.dailyRunCounts.set(jobId, (this.dailyRunCounts.get(jobId) ?? 0) + 1);
  }

  /** Register a completed job */
  onComplete(jobId: string): void {
    this.runningJobs.delete(jobId);
  }

  /** Check for timeout violations */
  checkTimeouts(): string[] {
    const now = Date.now();
    const timedOut: string[] = [];
    for (const [jobId, { startTime, abort }] of this.runningJobs) {
      if (now - startTime > this.config.maxRuntimePerJob) {
        abort();
        timedOut.push(jobId);
      }
    }
    for (const id of timedOut) this.runningJobs.delete(id);
    return timedOut;
  }

  /** Get running job count */
  get runningCount(): number {
    return this.runningJobs.size;
  }

  private resetDailyIfNeeded(): void {
    const today = new Date().getDate();
    if (today !== this.lastResetDay) {
      this.dailyRunCounts.clear();
      this.lastResetDay = today;
    }
  }
}

// ─── Cron Runner ──────────────────────────────────────────────────────────────

export class CronRunner {
  private jobs: Map<string, CronJob> = new Map();
  private lastChecks: Map<string, number> = new Map();
  private timer: ReturnType<typeof setInterval> | null = null;
  private results: JobResult[] = [];
  private lifecycleGuard: LifecycleGuard;
  private catalog: BlueprintCatalog;
  private eventBus: EventBus;
  private readonly maxResults = 100;

  _eventBus: EventBus;

  constructor(eventBus: EventBus, catalog?: BlueprintCatalog) {
    this.eventBus = eventBus;
    this._eventBus = eventBus;
    this.catalog = catalog ?? new BlueprintCatalog();
    this.lifecycleGuard = new LifecycleGuard();
  }

  /** Register a job */
  registerJob(job: CronJob): void {
    this.jobs.set(job.id, job);
    this.lastChecks.set(job.id, Date.now());
  }

  /** Unregister a job */
  unregisterJob(jobId: string): void {
    this.jobs.delete(jobId);
    this.lastChecks.delete(jobId);
  }

  /** Start the cron scheduler */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 30_000); // Check every 30s

    // Also check immediately
    setImmediate(() => this.tick());
  }

  /** Stop the cron scheduler */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Main tick — check all jobs */
  private async tick(): Promise<void> {
    const now = new Date();

    // Check for timed out jobs
    const timedOut = this.lifecycleGuard.checkTimeouts();
    for (const jobId of timedOut) {
      const job = this.jobs.get(jobId);
      if (job) {
        job.status = "failed";
        job.lastError = "Timed out (exceeded max runtime)";
        this.eventBus.emit("cron:job:error", jobId, new Error("Timed out"));
      }
    }

    for (const job of this.jobs.values()) {
      if (!job.enabled) continue;

      try {
        const expr = parseCronExpression(job.cronExpression);
        if (!cronMatches(expr, now)) continue;
      } catch {
        continue; // Skip invalid cron expressions
      }

      // Check lifecycle guard
      const guard = this.lifecycleGuard.canStart(job.id);
      if (!guard.allowed) continue;

      // Check cooldown
      const lastRun = job.lastRun ?? 0;
      if (Date.now() - lastRun < this.lifecycleGuard["config"].cooldownBetweenRuns) continue;

      this.eventBus.emit("cron:tick", job.id);
      this.eventBus.emit("cron:job:start", job.id);

      this.lifecycleGuard.onStart(job.id);
      job.status = "active";
      job.runCount++;
      job.lastRun = Date.now();

      const startTime = Date.now();
      try {
        const output = this.executeJobCommand(job.command);
        const duration = Date.now() - startTime;

        job.status = "active"; // stays active for next tick
        job.lastDuration = duration;

        this.results.push({ jobId: job.id, success: true, output, duration, timestamp: startTime });
        if (this.results.length > this.maxResults) this.results.shift();

        this.eventBus.emit("cron:job:complete", job.id, true);
      } catch (error) {
        const duration = Date.now() - startTime;
        job.status = "failed";
        job.lastError = error instanceof Error ? error.message : String(error);
        job.lastDuration = duration;

        this.results.push({ jobId: job.id, success: false, output: "", duration, error: job.lastError, timestamp: startTime });
        if (this.results.length > this.maxResults) this.results.shift();

        this.eventBus.emit("cron:job:error", job.id, error instanceof Error ? error : new Error(String(error)));
      } finally {
        this.lifecycleGuard.onComplete(job.id);
      }
    }
  }

  private executeJobCommand(command: string): string {
    try {
      return execSync(command, { encoding: "utf-8", timeout: 60_000, windowsHide: true });
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /** List all registered jobs */
  listJobs(): CronJob[] {
    return [...this.jobs.values()];
  }

  /** Get job execution history */
  getResults(limit = 20): JobResult[] {
    return this.results.slice(-limit);
  }

  /** Get the lifecycle guard */
  getGuard(): LifecycleGuard {
    return this.lifecycleGuard;
  }

  /** Get the blueprint catalog */
  getCatalog(): BlueprintCatalog {
    return this.catalog;
  }
}

// ─── Automation Manager ───────────────────────────────────────────────────────

export class AutomationManager {
  readonly scheduler: CronRunner;
  readonly catalog: BlueprintCatalog;
  readonly suggestionCatalog: SuggestionCatalog;
  readonly lifecycleGuard: LifecycleGuard;
  constructor(eventBus: EventBus) {
    this.catalog = new BlueprintCatalog();
    this.suggestionCatalog = new SuggestionCatalog();
    this.lifecycleGuard = new LifecycleGuard();
    this.scheduler = new CronRunner(eventBus, this.catalog);
  }

  /** Start the automation system */
  start(): void {
    this.scheduler.start();
  }

  /** Stop the automation system */
  stop(): void {
    this.scheduler.stop();
  }

  /** Record user activity for suggestions */
  recordActivity(pattern: string): void {
    this.suggestionCatalog.recordActivity(pattern);
  }
}
