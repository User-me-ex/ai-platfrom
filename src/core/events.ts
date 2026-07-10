/**
 * 9 Router CLI — Event Bus
 */

type EventHandler = (...args: unknown[]) => void | Promise<void>;

interface EventMap {
  "config:changed": [config: Record<string, unknown>];
  "model:changed": [modelId: string];
  "session:created": [sessionId: string];
  "session:deleted": [sessionId: string];
  "stream:start": [];
  "stream:token": [token: string];
  "stream:done": [];
  "stream:error": [error: Error];
  "command:before": [command: string];
  "command:after": [command: string];
  "plugin:loaded": [pluginName: string];
  "plugin:unloaded": [pluginName: string];
  "router:connected": [];
  "router:disconnected": [];
  "router:error": [error: Error];
  "error": [error: Error];

  // Memory subsystem
  "memory:search": [query: string, results: unknown[]];
  "memory:recall": [sessionId: string];
  "memory:vector:index": [count: number];

  // Automation subsystem
  "cron:tick": [jobId: string];
  "cron:job:start": [jobId: string];
  "cron:job:complete": [jobId: string, success: boolean];
  "cron:job:error": [jobId: string, error: Error];

  // Autonomous skills
  "skill:created": [skillId: string];
  "skill:evolved": [skillId: string];
  "skill:experience:recorded": [pattern: string];

  // Orchestration
  "orchestrator:subagent:spawned": [taskId: string];
  "orchestrator:subagent:completed": [taskId: string];
  "orchestrator:subagent:failed": [taskId: string, error: Error];

  // Security
  "security:threat:detected": [threatType: string, details: string];
  "security:file:blocked": [filePath: string, reason: string];

  // Web
  "web:search": [query: string];
  "web:page:fetched": [url: string];

  // Personas
  "persona:changed": [persona: string];
  "reasoning:effort:changed": [effort: string];

  // Gateways
  "gateway:message:sent": [gateway: string];
  "gateway:message:received": [gateway: string, content: string];

  // Performance subsystem
  "perf:cache:hit": [key: string];
  "perf:cache:miss": [key: string];
  "perf:cache:evict": [key: string];
  "perf:memory:high": [heapMB: number];
  "perf:memory:released": [freedMB: number];
  "perf:parallel:task:start": [taskId: string];
  "perf:parallel:task:complete": [taskId: string];
  "perf:parallel:task:fail": [taskId: string, error: string];
  "perf:scheduler:tick": [progress: Record<string, unknown>];
  "perf:scheduler:paused": [];
  "perf:scheduler:resumed": [];
  "perf:scheduler:complete": [result: Record<string, unknown>];
  "perf:editor:batch:start": [count: number];
  "perf:editor:batch:complete": [result: Record<string, unknown>];
  "perf:editor:conflict": [filePath: string];
  "perf:filesystem:index:start": [];
  "perf:filesystem:index:complete": [stats: Record<string, unknown>];
  "perf:filesystem:file:changed": [filePath: string];
  "perf:benchmark:start": [name: string];
  "perf:benchmark:complete": [name: string, duration: number];
}

type EventName = keyof EventMap;

export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();
  private onceHandlers = new Map<string, Set<EventHandler>>();

  on<E extends EventName>(event: E, handler: (...args: EventMap[E]) => void): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as EventHandler);

    return () => {
      this.handlers.get(event)?.delete(handler as EventHandler);
    };
  }

  once<E extends EventName>(event: E, handler: (...args: EventMap[E]) => void): () => void {
    if (!this.onceHandlers.has(event)) {
      this.onceHandlers.set(event, new Set());
    }
    this.onceHandlers.get(event)!.add(handler as EventHandler);

    return () => {
      this.onceHandlers.get(event)?.delete(handler as EventHandler);
    };
  }

  emit<E extends EventName>(event: E, ...args: EventMap[E]): void {
    // Run handlers
    const handlers = this.handlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        void Promise.resolve(handler(...args));
      }
    }

    // Run and clear once handlers
    const onceHandlers = this.onceHandlers.get(event);
    if (onceHandlers) {
      for (const handler of onceHandlers) {
        void Promise.resolve(handler(...args));
      }
      this.onceHandlers.delete(event);
    }
  }

  removeAll(event?: EventName): void {
    if (event) {
      this.handlers.delete(event);
      this.onceHandlers.delete(event);
    } else {
      this.handlers.clear();
      this.onceHandlers.clear();
    }
  }

  listenerCount(event: EventName): number {
    return (this.handlers.get(event)?.size ?? 0) + (this.onceHandlers.get(event)?.size ?? 0);
  }
}

/** Global event bus instance */
export const eventBus = new EventBus();
