/**
 * 9 Router CLI — Performance System
 *
 * All high-performance subsystems consolidated into a unified orchestrator.
 * Manages memory, parallelism, scheduling, file system, streaming, and benchmarking.
 */

export * from "./memory";
export * from "./parallel";
export * from "./scheduler";
export * from "./editor";
export * from "./filesystem";
export * from "./streaming";
export * from "./benchmark";

import { EventBus } from "../core/events";
import { PerformanceMemoryManager } from "./memory";
import { ConcurrentFileEditor } from "./editor";
import { PerformanceFileSystem } from "./filesystem";
import { ParallelRunner, WorkerPool } from "./parallel";
import { TaskScheduler } from "./scheduler";
import { StreamingRenderer } from "./streaming";
import { BenchmarkSuite, PerformanceMonitor } from "./benchmark";
import { join } from "path";

export class PerformanceOrchestrator {
  readonly memory: PerformanceMemoryManager;
  readonly editor: ConcurrentFileEditor;
  readonly fileSystem: PerformanceFileSystem;
  readonly parallel: ParallelRunner;
  readonly scheduler: TaskScheduler;
  readonly streaming: StreamingRenderer;
  readonly benchmark: BenchmarkSuite;
  readonly monitor: PerformanceMonitor;
  readonly eventBus: EventBus;

  private activeBenchmark: boolean = false;

  constructor(configDir: string, rootPath: string, eventBus: EventBus) {
    this.eventBus = eventBus;

    // Core subsystems
    this.memory = new PerformanceMemoryManager(eventBus);
    this.editor = new ConcurrentFileEditor(join(configDir, "backups"), eventBus);
    this.fileSystem = new PerformanceFileSystem(rootPath, eventBus);
    this.parallel = new ParallelRunner(eventBus);
    this.scheduler = new TaskScheduler(eventBus);
    this.streaming = new StreamingRenderer();
    this.benchmark = new BenchmarkSuite(eventBus);
    this.monitor = new PerformanceMonitor();
  }

  /** Initialize file system indexer */
  async indexFileSystem(): Promise<void> {
    await this.fileSystem.indexer.fullIndex();
    this.fileSystem.startWatching();
  }

  /** Run benchmarks */
  async runBenchmarks(): Promise<ReturnType<BenchmarkSuite["runAll"]>> {
    this.activeBenchmark = true;
    try {
      const results = await this.benchmark.runAll(
        this.memory,
        this.fileSystem.indexer,
        this.scheduler,
        this.parallel["pool"] as WorkerPool
      );
      return results;
    } finally {
      this.activeBenchmark = false;
    }
  }

  /** Get comprehensive system status */
  getStatus(): Record<string, unknown> {
    return {
      memory: this.memory.getStats(),
      cache: this.memory.cache.getStats(),
      fileSystem: this.fileSystem.indexer.getStats(),
      parallel: this.parallel.getStatus(),
      scheduler: this.scheduler.getProgress(),
      benchmarking: this.activeBenchmark,
    };
  }

  /** Dispose all resources */
  dispose(): void {
    this.fileSystem.stopWatching();
    this.memory.dispose();
    this.streaming.clearAll();
  }
}
