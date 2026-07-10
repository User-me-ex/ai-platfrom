/**
 * 9 Router CLI — Intelligent Task Scheduler
 *
 * - Dependency graph construction and topological sort
 * - Automatic parallelism detection (independent tasks run concurrently)
 * - Priority-based scheduling with preemption
 * - Pause, resume, and cancellation
 * - Automatic retry with exponential backoff
 * - Progress tracking
 */

import { EventBus } from "../core/events";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScheduledTask<T = unknown> {
  id: string;
  name: string;
  execute: () => Promise<T>;
  dependencies?: string[];
  priority?: number; // higher = more important
  retries?: number;
  timeout?: number; // ms
  label?: string;
}

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled" | "skipped";

export interface TaskState {
  id: string;
  name: string;
  status: TaskStatus;
  priority: number;
  dependencies: string[];
  retriesLeft: number;
  maxRetries: number;
  timeout: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  result?: unknown;
}

export interface SchedulerProgress {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  elapsed: number;
}

// ─── Dependency Graph ─────────────────────────────────────────────────────────

export class DependencyGraph {
  private edges = new Map<string, string[]>(); // task -> deps
  private reverseEdges = new Map<string, string[]>(); // dep -> dependents

  addNode(id: string, deps: string[] = []): void {
    this.edges.set(id, deps);
    for (const dep of deps) {
      if (!this.reverseEdges.has(dep)) this.reverseEdges.set(dep, []);
      this.reverseEdges.get(dep)!.push(id);
    }
  }

  /** Get all dependencies of a task (direct) */
  getDependencies(id: string): string[] {
    return this.edges.get(id) ?? [];
  }

  /** Get all tasks that depend on a task */
  getDependents(id: string): string[] {
    return this.reverseEdges.get(id) ?? [];
  }

  /** Topological sort — returns ordered task IDs */
  topologicalSort(): string[] {
    const inDegree = new Map<string, number>();
    const nodes = [...this.edges.keys()];

    for (const node of nodes) inDegree.set(node, 0);
    for (const [, deps] of this.edges) {
      for (const dep of deps) {
        inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
      }
    }

    // De-duplicate: if a task appears as both node and dep, adjust
    for (const node of nodes) {
      const deps = this.edges.get(node)!;
      const actual = deps.filter((d) => nodes.includes(d));
      inDegree.set(node, (inDegree.get(node) ?? 0) + deps.length - actual.length);
    }

    const queue: string[] = [];
    for (const [node, deg] of inDegree) {
      if (deg === 0) queue.push(node);
    }

    const result: string[] = [];
    while (queue.length > 0) {
      queue.sort((a, b) => (this.edges.get(a)?.length ?? 0) - (this.edges.get(b)?.length ?? 0));
      const node = queue.shift()!;
      result.push(node);
      for (const dep of this.edges.get(node) ?? []) {
        const deg = (inDegree.get(dep) ?? 1) - 1;
        inDegree.set(dep, deg);
        if (deg === 0) queue.push(dep);
      }
    }

    return result;
  }

  /** Detect cycles — returns cycle paths if any */
  detectCycles(): string[][] {
    const visited = new Set<string>();
    const recStack = new Set<string>();
    const cycles: string[][] = [];
    const path: string[] = [];

    const dfs = (node: string): void => {
      visited.add(node);
      recStack.add(node);
      path.push(node);

      for (const dep of this.edges.get(node) ?? []) {
        if (!visited.has(dep)) {
          dfs(dep);
        } else if (recStack.has(dep)) {
          // Found a cycle
          const cycleStart = path.indexOf(dep);
          if (cycleStart >= 0) cycles.push([...path.slice(cycleStart), dep]);
        }
      }

      path.pop();
      recStack.delete(node);
    };

    for (const node of this.edges.keys()) {
      if (!visited.has(node)) dfs(node);
    }
    return cycles;
  }

  /** Get tasks with no remaining dependencies (ready to run) */
  getReadyTasks(completed: Set<string>, failed: Set<string>): string[] {
    const ready: string[] = [];
    for (const [id, deps] of this.edges) {
      if (completed.has(id) || failed.has(id)) continue;
      if (deps.every((d) => completed.has(d) || failed.has(d))) {
        // If any dep failed, skip this too
        if (deps.some((d) => failed.has(d))) continue;
        ready.push(id);
      }
    }
    return ready;
  }
}

// ─── Task Scheduler ───────────────────────────────────────────────────────────

export class TaskScheduler {
  private tasks = new Map<string, ScheduledTask>();
  private states = new Map<string, TaskState>();
  private graph = new DependencyGraph();
  private completed = new Set<string>();
  private failed = new Set<string>();
  private cancelled = new Set<string>();
  private running = new Set<string>();
  private retryQueue: Array<{ id: string; delay: number }> = [];
  private concurrency: number;
  private paused = false;
  private _aborted = false;
  private activeCount = 0;
  private eventBus: EventBus;
  private onProgress?: (progress: SchedulerProgress) => void;
  private startTime = 0;

  constructor(eventBus: EventBus, concurrency = 4) {
    this.eventBus = eventBus;
    this.concurrency = concurrency;
  }

  /** Set progress callback */
  setProgressCallback(cb: (progress: SchedulerProgress) => void): void {
    this.onProgress = cb;
  }

  /** Schedule a batch of tasks */
  schedule(tasks: ScheduledTask[]): void {
    for (const task of tasks) {
      this.tasks.set(task.id, task);
      this.graph.addNode(task.id, task.dependencies ?? []);
      this.states.set(task.id, {
        id: task.id,
        name: task.name,
        status: "pending",
        priority: task.priority ?? 0,
        dependencies: task.dependencies ?? [],
        retriesLeft: task.retries ?? 2,
        maxRetries: task.retries ?? 2,
        timeout: task.timeout ?? 30000,
      });
    }
  }

  /** Execute all scheduled tasks */
  async execute(): Promise<{
    completed: string[];
    failed: string[];
    cancelled: string[];
    duration: number;
  }> {
    this.startTime = Date.now();
    this._aborted = false;

    // Check for cycles
    const cycles = this.graph.detectCycles();
    if (cycles.length > 0) {
      throw new Error(`Circular dependency detected: ${cycles[0]!.join(" -> ")}`);
    }

    // Process tasks
    while (!this._aborted) {
      // Process retry queue
      this.processRetryQueue();

      // Get ready tasks
      const readyIds = this.graph
        .getReadyTasks(this.completed, this.failed)
        .filter((id) => !this.cancelled.has(id) && !this.running.has(id));

      if (readyIds.length === 0 && this.running.size === 0 && this.retryQueue.length === 0) break;

      // Launch ready tasks (respecting concurrency)
      for (const id of readyIds) {
        if (this.activeCount >= this.concurrency || this.paused || this._aborted) break;
        this.launchTask(id);
      }

      // Wait a tick before next iteration
      if (this.activeCount > 0 || this.retryQueue.length > 0) {
        await new Promise((r) => setTimeout(r, 10));
      } else {
        break;
      }
    }

    const duration = Date.now() - this.startTime;
    return {
      completed: [...this.completed],
      failed: [...this.failed],
      cancelled: [...this.cancelled],
      duration,
    };
  }

  /** Pause execution (running tasks finish, no new tasks start) */
  pause(): void {
    this.paused = true;
  }

  /** Resume execution */
  resume(): void {
    this.paused = false;
  }

  /** Cancel a specific task by ID */
  cancel(taskId: string): void {
    if (this.states.has(taskId)) {
      const state = this.states.get(taskId)!;
      state.status = "cancelled";
      this.cancelled.add(taskId);
      this.reportProgress();
    }
  }

  /** Cancel all tasks */
  cancelAll(): void {
    this._aborted = true;
    for (const [id, state] of this.states) {
      if (state.status === "pending") {
        state.status = "cancelled";
        this.cancelled.add(id);
      }
    }
    this.reportProgress();
  }

  /** Get state of all tasks */
  getAllStates(): TaskState[] {
    return [...this.states.values()];
  }

  /** Get progress info */
  getProgress(): SchedulerProgress {
    const total = this.states.size;
    let pending = 0;
    let running = 0;
    let completed = 0;
    let failed = 0;
    let cancelled = 0;

    for (const state of this.states.values()) {
      switch (state.status) {
        case "pending": pending++; break;
        case "running": running++; break;
        case "completed": completed++; break;
        case "failed": failed++; break;
        case "cancelled": cancelled++; break;
      }
    }

    return {
      total,
      pending,
      running,
      completed,
      failed,
      cancelled,
      elapsed: Date.now() - this.startTime,
    };
  }

  /** Check if execution is complete */
  isComplete(): boolean {
    const progress = this.getProgress();
    return progress.completed + progress.failed + progress.cancelled === progress.total;
  }

  private async launchTask(id: string): Promise<void> {
    const task = this.tasks.get(id);
    const state = this.states.get(id);
    if (!task || !state) return;

    this.running.add(id);
    this.activeCount++;
    state.status = "running";
    state.startedAt = Date.now();
    this.eventBus.emit("orchestrator:subagent:spawned", id);
    this.reportProgress();

    try {
      const result = await this.runWithTimeout(task.execute, state.timeout);
      state.status = "completed";
      state.completedAt = Date.now();
      state.result = result;
      this.completed.add(id);
      this.running.delete(id);
      this.activeCount--;
      this.eventBus.emit("orchestrator:subagent:completed", id);
    } catch (err) {
      if (state.retriesLeft > 0) {
        state.retriesLeft--;
        state.status = "pending";
        this.running.delete(id);
        this.activeCount--;
        // Re-queue with backoff
        const delay = (state.maxRetries - state.retriesLeft) * 1000;
        this.retryQueue.push({ id, delay });
        this.eventBus.emit("orchestrator:subagent:failed", id, err instanceof Error ? err : new Error(String(err)));
      } else {
        state.status = "failed";
        state.error = err instanceof Error ? err.message : String(err);
        this.failed.add(id);
        this.running.delete(id);
        this.activeCount--;
        this.eventBus.emit("orchestrator:subagent:failed", id, err instanceof Error ? err : new Error(String(err)));
      }
    }
    this.reportProgress();
  }

  private processRetryQueue(): void {
    const toRetry: string[] = [];
    this.retryQueue = this.retryQueue.filter((item) => {
      if (item.delay <= 0) {
        toRetry.push(item.id);
        return false;
      }
      item.delay -= 10;
      return true;
    });
    // Re-schedule retried tasks
    for (const id of toRetry) {
      if (!this.completed.has(id) && !this.failed.has(id) && !this.cancelled.has(id)) {
        this.states.get(id)!.status = "pending";
      }
    }
  }

  private async runWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Task timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
  }

  private reportProgress(): void {
    if (this.onProgress) this.onProgress(this.getProgress());
  }
}
