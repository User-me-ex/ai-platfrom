/**
 * 9 Router CLI — Parallel Execution Engine
 *
 * - Configurable worker pool with concurrency control
 * - Safe parallelism detection (file conflict analysis)
 * - Progress reporting and cancellation
 * - Priority-based task scheduling within the pool
 */

import { EventBus } from "../core/events";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParallelTask<T = unknown> {
  id: string;
  execute: () => Promise<T>;
  priority?: number; // higher = more important
  label?: string;
  weight?: number; // estimated cost (1-10), for progress tracking
  signal?: AbortSignal;
}

export interface ParallelTaskResult<T = unknown> {
  id: string;
  data?: T;
  error?: Error;
  duration: number; // ms
}

export interface ParallelProgress {
  completed: number;
  total: number;
  active: number;
  failed: number;
  elapsed: number; // ms
  eta: number; // ms remaining estimate
}

export type ParallelResult<T = unknown> = ParallelTaskResult<T>[];

// ─── File Conflict Analyzer ───────────────────────────────────────────────────

interface FileAccess {
  path: string;
  mode: "read" | "write";
}

/**
 * Analyzes which tasks access which files to determine safe parallelism.
 * Tasks that write to the same file cannot run in parallel.
 * Reads can safely overlap.
 */
export class FileConflictAnalyzer {
  /** Check if two sets of file accesses conflict */
  hasConflict(a: FileAccess[], b: FileAccess[]): boolean {
    for (const fa of a) {
      if (fa.mode !== "write") continue;
      if (b.some((fb) => fb.path === fa.path && (fb.mode === "write" || fb.mode === "read"))) return true;
    }
    for (const fb of b) {
      if (fb.mode !== "write") continue;
      if (a.some((fa) => fa.path === fb.path && fa.mode === "read")) return true;
    }
    return false;
  }

  /** Partition tasks into non-conflicting groups for parallel execution */
  partition(tasks: Array<{ id: string; accesses: FileAccess[] }>): string[][] {
    const groups: string[][] = [];
    const assigned = new Set<string>();

    for (const task of tasks) {
      if (assigned.has(task.id)) continue;
      const group = [task.id];
      assigned.add(task.id);

      for (const other of tasks) {
        if (assigned.has(other.id)) continue;
        const canJoin = group.every((gid) => {
          const gt = tasks.find((t) => t.id === gid);
          return gt && !this.hasConflict(gt.accesses, other.accesses);
        });
        if (canJoin) {
          group.push(other.id);
          assigned.add(other.id);
        }
      }
      groups.push(group);
    }

    return groups;
  }
}

// ─── Worker Pool ──────────────────────────────────────────────────────────────

export class WorkerPool {
  private concurrency: number;
  private running = 0;
  private queue: Array<{ task: ParallelTask; resolve: (result: ParallelTaskResult) => void }> = [];
  private eventBus: EventBus;

  constructor(concurrency: number, eventBus: EventBus) {
    this.concurrency = concurrency;
    this.eventBus = eventBus;
  }

  /** Submit a task to the pool */
  async submit<T>(task: ParallelTask<T>): Promise<ParallelTaskResult<T>> {
    return new Promise((resolve) => {
      this.queue.push({ task, resolve: resolve as (r: ParallelTaskResult) => void });
      this.drain();
    });
  }

  /** Submit multiple tasks and wait for all */
  async submitAll<T>(tasks: ParallelTask<T>[]): Promise<ParallelTaskResult<T>[]> {
    return Promise.all(tasks.map((t) => this.submit(t)));
  }

  /** Get current pool status */
  get status() {
    return { running: this.running, queued: this.queue.length, concurrency: this.concurrency };
  }

  /** Resize the pool */
  setConcurrency(n: number): void {
    this.concurrency = Math.max(1, n);
    this.drain();
  }

  /** Wait until all tasks complete */
  async idle(): Promise<void> {
    while (this.running > 0 || this.queue.length > 0) {
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  /** Cancel all queued tasks */
  clearQueue(): void {
    this.queue.length = 0;
  }

  private drain(): void {
    while (this.queue.length > 0 && this.running < this.concurrency) {
      // Sort by priority (higher first)
      this.queue.sort((a, b) => (b.task.priority ?? 0) - (a.task.priority ?? 0));
      const { task, resolve } = this.queue.shift()!;
      this.running++;
      this.eventBus.emit("orchestrator:subagent:spawned", task.id);

      const start = Date.now();
      const executeTask = async () => {
        // Check if aborted
        if (task.signal?.aborted) {
          this.running--;
          resolve({ id: task.id, error: new Error("Task cancelled"), duration: Date.now() - start });
          this.eventBus.emit("orchestrator:subagent:failed", task.id, new Error("Task cancelled"));
          this.drain();
          return;
        }

        try {
          const data = await task.execute();
          this.running--;
          resolve({ id: task.id, data, duration: Date.now() - start });
          this.eventBus.emit("orchestrator:subagent:completed", task.id);
        } catch (err) {
          this.running--;
          resolve({ id: task.id, error: err instanceof Error ? err : new Error(String(err)), duration: Date.now() - start });
          this.eventBus.emit("orchestrator:subagent:failed", task.id, err instanceof Error ? err : new Error(String(err)));
        }
        this.drain();
      };

      void executeTask();
    }
  }
}

// ─── Parallel Runner ──────────────────────────────────────────────────────────

export class ParallelRunner {
  private pool: WorkerPool;
  private conflictAnalyzer = new FileConflictAnalyzer();

  constructor(eventBus: EventBus, concurrency = 4) {
    this.pool = new WorkerPool(concurrency, eventBus);
  }

  /** Run tasks in parallel with progress tracking */
  async run<T>(
    tasks: ParallelTask<T>[],
    onProgress?: (progress: ParallelProgress) => void
  ): Promise<ParallelTaskResult<T>[]> {
    const total = tasks.length;
    const start = Date.now();
    let completed = 0;
    let failed = 0;

    const results: ParallelTaskResult<T>[] = [];
    const weightedTasks = tasks.map((t) => ({
      ...t,
      weight: t.weight ?? 1,
    }));
    const progressInterval = onProgress
      ? setInterval(() => {
          onProgress({
            completed,
            total,
            active: this.pool.status.running,
            failed,
            elapsed: Date.now() - start,
            eta: completed === 0 ? 0 : ((Date.now() - start) / completed) * (total - completed),
          });
        }, 200)
      : null;

    const completedTasks = await Promise.all(
      weightedTasks.map(async (task) => {
        const result = await this.pool.submit(task);
        completed++;
        if (result.error) failed++;
        results.push(result);
        return result;
      })
    );

    if (progressInterval) clearInterval(progressInterval);
    return completedTasks;
  }

  /** Detect safe parallelism groups from file accesses */
  groupByFileAccess(accesses: Array<{ id: string; accesses: FileAccess[] }>): string[][] {
    return this.conflictAnalyzer.partition(accesses);
  }

  /** Adjust pool concurrency */
  setConcurrency(n: number): void {
    this.pool.setConcurrency(n);
  }

  /** Get current pool status */
  getStatus() {
    return this.pool.status;
  }
}
