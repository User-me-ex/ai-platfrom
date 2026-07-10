/**
 * 9 Router CLI — Agent Orchestration System
 *
 * Inspired by Ruflo/Claude Flow's swarm and Hermes' subagent delegation:
 * - Subagent spawning for parallel task execution
 * - Task routing to appropriate handlers
 * - Swarm coordination for complex multi-step tasks
 * - Result collection and aggregation
 */

import { EventBus } from "../core/events";

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type TaskPriority = "low" | "medium" | "high" | "critical";

export interface Task {
  id: string;
  name: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  parentTask?: string;
  dependencies: string[];
  agentId?: string;
  handler: string;
  input: unknown;
  output?: unknown;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  timeout: number;
  retryCount: number;
  maxRetries: number;
}

export interface Subagent {
  id: string;
  name: string;
  capabilities: string[];
  status: "idle" | "busy" | "error";
  currentTask?: string;
  tasksCompleted: number;
  successRate: number;
  spawnedAt: number;
}

export interface SwarmConfig {
  name: string;
  description: string;
  strategy: "sequential" | "parallel" | "fan_out" | "voting" | "debate";
  agentCount: number;
  taskTimeout: number;
  requireConsensus: boolean;
  consensusThreshold: number;
}

export interface SwarmResult {
  swarmId: string;
  config: SwarmConfig;
  tasks: Task[];
  outputs: unknown[];
  consensus?: unknown;
  completedAt: number;
  success: boolean;
  summary: string;
}

// ─── Subagent Pool ────────────────────────────────────────────────────────────

export class SubagentPool {
  private agents: Map<string, Subagent> = new Map();
  private maxAgents: number;

  constructor(_maxAgents = 5, _eventBus?: EventBus) {
    this.maxAgents = _maxAgents;
  }

  spawn(name: string, capabilities: string[]): Subagent {
    const id = `agent_${makeId()}`;
    const agent: Subagent = {
      id, name, capabilities, status: "idle",
      tasksCompleted: 0, successRate: 1.0, spawnedAt: Date.now(),
    };
    this.agents.set(id, agent);
    return agent;
  }

  findBestAgent(requiredCapabilities: string[]): Subagent | null {
    let best: Subagent | null = null;
    let bestScore = -1;
    for (const agent of this.agents.values()) {
      if (agent.status !== "idle") continue;
      const matchCount = requiredCapabilities.filter((c) => agent.capabilities.includes(c)).length;
      if (matchCount > bestScore) { bestScore = matchCount; best = agent; }
    }
    return best;
  }

  assignTask(agentId: string, taskId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) { agent.status = "busy"; agent.currentTask = taskId; }
  }

  completeTask(agentId: string, _taskId: string, _success: boolean): void {
    const agent = this.agents.get(agentId);
    if (agent) { agent.status = "idle"; agent.currentTask = undefined; agent.tasksCompleted++; }
  }

  listAgents(): Subagent[] { return [...this.agents.values()]; }

  get availableCount(): number {
    return [...this.agents.values()].filter((a) => a.status === "idle").length;
  }

  get totalCount(): number { return this.agents.size; }

  canSpawn(): boolean { return this.agents.size < this.maxAgents; }
}

// ─── Task Queue ───────────────────────────────────────────────────────────────

export class TaskQueue {
  private tasks: Map<string, Task> = new Map();
  private queue: Task[] = [];

  constructor(_eventBus?: EventBus) {}

  enqueue(task: Task): void {
    this.tasks.set(task.id, task);
    this.queue.push(task);
    this.queue.sort((a, b) => {
      const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      return (order[a.priority] ?? 99) - (order[b.priority] ?? 99);
    });
  }

  dequeueReady(): Task | null {
    const idx = this.queue.findIndex((t) => {
      const depsMet = t.dependencies.every((depId) => {
        const dep = this.tasks.get(depId);
        return dep?.status === "completed";
      });
      return depsMet && t.status === "pending";
    });
    if (idx >= 0) {
      const task = this.queue[idx]!;
      task.status = "running";
      task.startedAt = Date.now();
      this.queue.splice(idx, 1);
      return task;
    }
    return null;
  }

  complete(taskId: string, output: unknown): void {
    const task = this.tasks.get(taskId);
    if (task) { task.status = "completed"; task.output = output; task.completedAt = Date.now(); }
  }

  fail(taskId: string, error: string): void {
    const task = this.tasks.get(taskId);
    if (task) {
      if (task.retryCount < task.maxRetries) {
        task.retryCount++;
        task.status = "pending";
        this.queue.push(task);
      } else {
        task.status = "failed"; task.error = error; task.completedAt = Date.now();
      }
    }
  }

  cancel(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = "cancelled";
      this.queue = this.queue.filter((t) => t.id !== taskId);
      for (const t of this.tasks.values()) {
        if (t.dependencies.includes(taskId) && t.status === "pending") {
          t.status = "cancelled";
          this.queue = this.queue.filter((q) => q.id !== t.id);
        }
      }
    }
  }

  listTasks(status?: TaskStatus): Task[] {
    const all = [...this.tasks.values()];
    return status ? all.filter((t) => t.status === status) : all;
  }

  get depth(): number { return this.queue.length; }
}

// ─── Swarm Coordinator ────────────────────────────────────────────────────────

export class SwarmCoordinator {
  private agentPool: SubagentPool;
  private taskQueue: TaskQueue;

  constructor(agentPool: SubagentPool, taskQueue: TaskQueue) {
    this.agentPool = agentPool;
    this.taskQueue = taskQueue;
  }

  private makeTask(swarmId: string, idx: number, name: string, config: SwarmConfig, deps: string[], input?: unknown): Task | null {
    if (!input && deps.length === 0) return null;
    return {
      id: `${swarmId}_task_${idx}`,
      name,
      description: config.description,
      priority: "medium",
      status: "pending",
      dependencies: deps,
      handler: config.strategy === "voting" || config.strategy === "debate" ? "analysis_handler" : "swarm_handler",
      input: input ?? "",
      timeout: config.taskTimeout,
      retryCount: 0,
      maxRetries: 2,
      createdAt: Date.now(),
    };
  }

  async executeSwarm(config: SwarmConfig, input: string): Promise<SwarmResult> {
    const swarmId = `swarm_${makeId()}`;
    const tasks: Task[] = [];

    for (let i = 0; i < config.agentCount && this.agentPool.canSpawn(); i++) {
      this.agentPool.spawn(`${config.name}-agent-${i + 1}`, ["general", "reasoning", "coding"]);
    }

    const createAndEnqueue = (i: number, name: string, deps: string[], taskInput?: unknown) => {
      const task = this.makeTask(swarmId, i, name, config, deps, taskInput);
      if (task) { tasks.push(task); this.taskQueue.enqueue(task); }
    };

    for (let i = 0; i < config.agentCount; i++) {
      if (config.strategy === "parallel") {
        createAndEnqueue(i, `${config.name} task ${i + 1}`, []);
      } else if (config.strategy === "sequential") {
        const deps = i > 0 ? [`${swarmId}_task_${i - 1}`] : [];
        createAndEnqueue(i, `${config.name} step ${i + 1}`, deps, i === 0 ? input : undefined);
      } else if (config.strategy === "voting" || config.strategy === "debate") {
        createAndEnqueue(i, `${config.name} analysis ${i + 1}`, []);
      }
    }

    await this.waitForTasks(tasks.map((t) => t.id), config.taskTimeout);

    const outputs = tasks.map((t) => this.taskQueue.listTasks().find((qt) => qt.id === t.id)?.output).filter(Boolean);

    let consensus: unknown;
    if (config.requireConsensus && (config.strategy === "voting" || config.strategy === "debate")) {
      const stringOutputs = outputs.filter((o): o is string => typeof o === "string");
      const freq = new Map<string, number>();
      for (const o of stringOutputs) freq.set(o, (freq.get(o) ?? 0) + 1);
      const maxFreq = Math.max(...freq.values(), 0);
      if (maxFreq / stringOutputs.length >= config.consensusThreshold) {
        consensus = [...freq.entries()].find(([, f]) => f === maxFreq)?.[0];
      }
    }

    return {
      swarmId, config, tasks, outputs, consensus,
      completedAt: Date.now(),
      success: outputs.length > 0,
      summary: `${config.name} swarm completed with ${outputs.length}/${tasks.length} tasks successful`,
    };
  }

  private async waitForTasks(taskIds: string[], timeout: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const completed = taskIds.filter((id) => {
        const task = this.taskQueue.listTasks().find((t) => t.id === id);
        return task?.status === "completed" || task?.status === "failed";
      });
      if (completed.length === taskIds.length) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

// ─── Orchestrator Manager ─────────────────────────────────────────────────────

export class OrchestratorManager {
  readonly pool: SubagentPool;
  readonly queue: TaskQueue;
  readonly swarm: SwarmCoordinator;

  constructor(eventBus: EventBus) {
    this.pool = new SubagentPool(5, eventBus);
    this.queue = new TaskQueue(eventBus);
    this.swarm = new SwarmCoordinator(this.pool, this.queue);
  }

  async executeTask(name: string, handler: string, input: unknown, priority: TaskPriority = "medium"): Promise<Task> {
    const task: Task = {
      id: `task_${makeId()}`,
      name,
      description: `Execute ${name}`,
      priority,
      status: "pending",
      dependencies: [],
      handler,
      input,
      timeout: 60000,
      retryCount: 0,
      maxRetries: 3,
      createdAt: Date.now(),
    };
    this.queue.enqueue(task);
    return task;
  }

  getSummary(): { agents: number; tasks: number; queueDepth: number } {
    return {
      agents: this.pool.totalCount,
      tasks: this.queue.listTasks().length,
      queueDepth: this.queue.depth,
    };
  }
}
