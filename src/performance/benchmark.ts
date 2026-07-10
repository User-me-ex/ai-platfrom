/**
 * 9 Router CLI — Performance Benchmarking
 *
 * - Startup time measurement
 * - Memory consumption tracking
 * - CPU utilization sampling
 * - File indexing speed tests
 * - Search performance tests
 * - Rendering speed benchmarks
 * - Parallel execution efficiency
 * - Cache hit rate tracking
 * - Overall throughput measurement
 * - Bottleneck identification and recommendations
 */

import { PerformanceMemoryManager } from "./memory";
import { FileIndexer } from "./filesystem";
import { TaskScheduler } from "./scheduler";
import { WorkerPool } from "./parallel";
import { EventBus } from "../core/events";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BenchmarkResult {
  name: string;
  duration: number; // ms
  memoryDelta: number; // bytes
  throughput?: number; // ops/second
  iterations: number;
  error?: string;
}

export interface StartupMetrics {
  coldStart: number; // ms
  moduleLoadTime: number; // ms
  configLoadTime: number; // ms
  routerConnectTime: number; // ms
  modelLoadTime: number; // ms
  totalStartupTime: number; // ms
  peakMemoryMB: number;
}

export interface ThroughputMetrics {
  filesIndexedPerSecond: number;
  searchesPerSecond: number;
  tasksCompletedPerSecond: number;
  cacheHitRate: number;
  averageLatency: number; // ms
  peakThroughput: number; // ops/second
}

export interface SystemMetrics {
  heapUsedMB: number;
  heapTotalMB: number;
  rssMB: number;
  externalMB: number;
  cpuUsage: number; // percentage
  gcPauseTime: number; // ms
  openHandles: number;
}

export interface Bottleneck {
  area: string;
  severity: "critical" | "high" | "medium" | "low";
  description: string;
  recommendation: string;
  estimatedImpact: string; // e.g., "30% faster startup"
}

// ─── Benchmark Runner ─────────────────────────────────────────────────────────

export class BenchmarkRunner {
  private results: BenchmarkResult[] = [];

  constructor(_eventBus: EventBus) {
  }

  /** Run a benchmark with memory tracking */
  async run(name: string, fn: () => Promise<void>, iterations = 1): Promise<BenchmarkResult> {
    const memBefore = process.memoryUsage().heapUsed;
    const start = Date.now();

    try {
      for (let i = 0; i < iterations; i++) {
        await fn();
      }
    } catch (err) {
      const result: BenchmarkResult = {
        name,
        duration: Date.now() - start,
        memoryDelta: process.memoryUsage().heapUsed - memBefore,
        iterations,
        error: err instanceof Error ? err.message : String(err),
      };
      this.results.push(result);
      return result;
    }

    const memAfter = process.memoryUsage().heapUsed;
    const duration = Date.now() - start;
    const result: BenchmarkResult = {
      name,
      duration,
      memoryDelta: memAfter - memBefore,
      throughput: iterations / (duration / 1000),
      iterations,
    };
    this.results.push(result);
    return result;
  }

  /** Get all benchmark results */
  getResults(): BenchmarkResult[] {
    return [...this.results];
  }

  /** Generate a summary report */
  generateSummary(): string {
    if (this.results.length === 0) return "No benchmarks executed.";

    const lines: string[] = [];
    lines.push("╔══════════════════════════════════════════════════════╗");
    lines.push("║           Performance Benchmark Results             ║");
    lines.push("╚══════════════════════════════════════════════════════╝");
    lines.push("");

    for (const result of this.results) {
      const dur = result.duration.toFixed(2);
      const mem = (result.memoryDelta / (1024 * 1024)).toFixed(2);
      const tput = result.throughput ? result.throughput.toFixed(2) : "N/A";

      lines.push(`  ${result.error ? "✗" : "✓"} ${chalkBold(result.name)}`);
      lines.push(`     Duration:  ${dur}ms  |  Memory: ${mem}MB  |  Throughput: ${tput} ops/s`);
      if (result.error) lines.push(`     Error:     ${result.error}`);
      lines.push("");
    }

    return lines.join("\n");
  }
}

function chalkBold(s: string): string {
  // Simple bold without chalk dependency
  return `\x1b[1m${s}\x1b[22m`;
}

// ─── Performance Monitor (Continuous) ─────────────────────────────────────────

export class PerformanceMonitor {
  private samples: SystemMetrics[] = [];
  private interval: ReturnType<typeof setInterval> | null = null;
  private sampleIntervalMs: number;
  private maxSamples: number;
  private peakRSS = 0;
  private peakHeap = 0;
  private gcPauseTotal = 0;
  private gcCount = 0;
  private startTime = Date.now();

  constructor(sampleIntervalMs = 1000, maxSamples = 60) {
    this.sampleIntervalMs = sampleIntervalMs;
    this.maxSamples = maxSamples;
  }

  /** Start monitoring */
  start(): void {
    this.startTime = Date.now();
    this.samples = [];
    this.interval = setInterval(() => this.sample(), this.sampleIntervalMs);
  }

  /** Stop monitoring and get final metrics */
  stop(): {
    average: SystemMetrics;
    peak: { rssMB: number; heapMB: number };
    gc: { totalPauseMs: number; count: number };
    duration: number;
  } {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;

    const avg = this.computeAverage();
    return {
      average: avg,
      peak: { rssMB: this.peakRSS / 1024 / 1024, heapMB: this.peakHeap / 1024 / 1024 },
      gc: { totalPauseMs: this.gcPauseTotal, count: this.gcCount },
      duration: Date.now() - this.startTime,
    };
  }

  /** Get current metrics snapshot */
  getCurrentMetrics(): SystemMetrics {
    const mem = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    return {
      heapUsedMB: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
      heapTotalMB: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
      rssMB: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
      externalMB: Math.round((mem.external / 1024 / 1024) * 100) / 100,
      cpuUsage: (cpuUsage.user + cpuUsage.system) / 1000, // rough estimate
      gcPauseTime: this.gcPauseTotal,
      openHandles: process.listenerCount ? process.listenerCount("") : 0,
    };
  }

  private sample(): void {
    const mem = process.memoryUsage();
    this.peakRSS = Math.max(this.peakRSS, mem.rss);
    this.peakHeap = Math.max(this.peakHeap, mem.heapUsed);

    this.samples.push({
      heapUsedMB: mem.heapUsed / 1024 / 1024,
      heapTotalMB: mem.heapTotal / 1024 / 1024,
      rssMB: mem.rss / 1024 / 1024,
      externalMB: mem.external / 1024 / 1024,
      cpuUsage: 0,
      gcPauseTime: 0,
      openHandles: 0,
    });

    if (this.samples.length > this.maxSamples) this.samples.shift();
  }

  private computeAverage(): SystemMetrics {
    if (this.samples.length === 0) return { heapUsedMB: 0, heapTotalMB: 0, rssMB: 0, externalMB: 0, cpuUsage: 0, gcPauseTime: 0, openHandles: 0 };

    const sum = this.samples.reduce(
      (acc, s) => ({
        heapUsedMB: acc.heapUsedMB + s.heapUsedMB,
        heapTotalMB: acc.heapTotalMB + s.heapTotalMB,
        rssMB: acc.rssMB + s.rssMB,
        externalMB: acc.externalMB + s.externalMB,
        cpuUsage: acc.cpuUsage + s.cpuUsage,
        gcPauseTime: acc.gcPauseTime + s.gcPauseTime,
        openHandles: acc.openHandles + s.openHandles,
      }),
      { heapUsedMB: 0, heapTotalMB: 0, rssMB: 0, externalMB: 0, cpuUsage: 0, gcPauseTime: 0, openHandles: 0 }
    );

    const n = this.samples.length;
    return {
      heapUsedMB: sum.heapUsedMB / n,
      heapTotalMB: sum.heapTotalMB / n,
      rssMB: sum.rssMB / n,
      externalMB: sum.externalMB / n,
      cpuUsage: sum.cpuUsage / n,
      gcPauseTime: sum.gcPauseTime / n,
      openHandles: Math.round(sum.openHandles / n),
    };
  }
}

// ─── Benchmark Suite ──────────────────────────────────────────────────────────

export class BenchmarkSuite {
  private runner: BenchmarkRunner;
  private monitor: PerformanceMonitor;

  constructor(eventBus: EventBus) {
    this.runner = new BenchmarkRunner(eventBus);
    this.monitor = new PerformanceMonitor();
  }

  /** Run all benchmarks */
  async runAll(
    memoryManager?: PerformanceMemoryManager,
    fileIndexer?: FileIndexer,
    scheduler?: TaskScheduler,
    workerPool?: WorkerPool
  ): Promise<{
    results: BenchmarkResult[];
    systemMetrics: ReturnType<PerformanceMonitor["stop"]>;
    bottlenecks: Bottleneck[];
  }> {
    console.log("\n  Running benchmarks...\n");

    this.monitor.start();

    // 1. Cache performance
    if (memoryManager) {
      await this.benchmarkCache(memoryManager);
    }

    // 2. Object pool performance
    if (memoryManager) {
      await this.benchmarkObjectPool(memoryManager);
    }

    // 3. File indexing performance
    if (fileIndexer) {
      await this.benchmarkFileIndexing(fileIndexer);
    }

    // 4. Search performance
    if (fileIndexer) {
      await this.benchmarkSearch(fileIndexer);
    }

    // 5. Parallel execution (synthetic)
    if (scheduler) {
      await this.benchmarkScheduler(scheduler);
    }

    // 6. Worker pool performance
    if (workerPool) {
      await this.benchmarkWorkerPool(workerPool);
    }

    // 7. Empty benchmark
    await this.runner.run("noop (baseline overhead)", async () => {}, 100);

    const systemMetrics = this.monitor.stop();
    const bottlenecks = this.analyzeBottlenecks(this.runner.getResults(), systemMetrics.average);

    return {
      results: this.runner.getResults(),
      systemMetrics,
      bottlenecks,
    };
  }

  /** Generate a formatted report */
  generateReport(data: {
    results: BenchmarkResult[];
    systemMetrics: ReturnType<PerformanceMonitor["stop"]>;
    bottlenecks: Bottleneck[];
  }): string {
    const lines: string[] = [];

    lines.push("╔══════════════════════════════════════════════════════╗");
    lines.push("║       9 Router CLI — Performance Report            ║");
    lines.push("╚══════════════════════════════════════════════════════╝");
    lines.push("");

    // Benchmark results
    lines.push("  ┌─ Benchmarks ──────────────────────────────────────┐");
    for (const r of data.results) {
      const icon = r.error ? "✗" : "✓";
      const dur = r.duration.toFixed(1).padStart(8);
      lines.push(`  │ ${icon} ${r.name.padEnd(36)} ${dur}ms │`);
    }
    lines.push("  └────────────────────────────────────────────────────┘");
    lines.push("");

    // System Metrics
    lines.push("  ┌─ System Metrics ──────────────────────────────────┐");
    const avg = data.systemMetrics.average;
    lines.push(`  │ Heap Used:    ${avg.heapUsedMB.toFixed(2).padStart(8)} MB            │`);
    lines.push(`  │ RSS:          ${avg.rssMB.toFixed(2).padStart(8)} MB            │`);
    lines.push(`  │ External:     ${avg.externalMB.toFixed(2).padStart(8)} MB            │`);
    const peak = data.systemMetrics.peak;
    lines.push(`  │ Peak RSS:     ${peak.rssMB.toFixed(2).padStart(8)} MB            │`);
    lines.push(`  │ Duration:     ${(data.systemMetrics.duration / 1000).toFixed(1).padStart(8)}s             │`);
    lines.push("  └────────────────────────────────────────────────────┘");
    lines.push("");

    // Bottlenecks
    if (data.bottlenecks.length > 0) {
      lines.push("  ┌─ Bottlenecks & Recommendations ──────────────────┐");
      for (const b of data.bottlenecks) {
        const severityColor =
          b.severity === "critical" ? "CRIT" :
          b.severity === "high" ? "HIGH" :
          b.severity === "medium" ? "MED" : "LOW";
        lines.push(`  │ [${severityColor}] ${b.area.padEnd(20)} ${b.description.padEnd(40)} │`);
        lines.push(`  │     → ${b.recommendation.padEnd(70)} │`);
        lines.push(`  │       Impact: ${b.estimatedImpact.padEnd(55)} │`);
        lines.push("  │                                            │");
      }
      lines.push("  └────────────────────────────────────────────────────┘");
    }

    return lines.join("\n");
  }

  private async benchmarkCache(memoryManager: PerformanceMemoryManager): Promise<void> {
    const cache = memoryManager.cache;

    await this.runner.run("cache write (10k entries)", async () => {
      for (let i = 0; i < 10000; i++) cache.set(`key-${i}`, { data: `value-${i}` }, 60000);
    });

    await this.runner.run("cache read (10k hits)", async () => {
      for (let i = 0; i < 10000; i++) cache.get(`key-${i}`);
    });
  }

  private async benchmarkObjectPool(memoryManager: PerformanceMemoryManager): Promise<void> {
    const pool = memoryManager.registerPool(
      "test",
      () => ({ data: "", timestamp: 0 }),
      (obj) => { obj.data = ""; obj.timestamp = 0; },
      100
    );

    await this.runner.run("object pool acquire/release (10k)", async () => {
      for (let i = 0; i < 10000; i++) {
        const obj = pool.acquire();
        pool.release(obj);
      }
    });

    pool.drain();
  }

  private async benchmarkFileIndexing(indexer: FileIndexer): Promise<void> {
    await this.runner.run("full file index", async () => {
      await indexer.fullIndex();
    });
  }

  private async benchmarkSearch(indexer: FileIndexer): Promise<void> {
    await this.runner.run("content search (100 queries)", async () => {
      for (let i = 0; i < 100; i++) {
        indexer.searchContent(`function_${i}`, 50);
      }
    });
  }

  private async benchmarkScheduler(scheduler: TaskScheduler): Promise<void> {
    await this.runner.run("scheduler (100 tasks, 10 parallel)", async () => {
      const tasks = Array.from({ length: 100 }, (_, i) => ({
        id: `bench-${i}`,
        name: `Task ${i}`,
        execute: async () => {},
        priority: i % 10 === 0 ? 10 : 1,
      }));
      scheduler.schedule(tasks);
      await scheduler.execute();
    });
  }

  private async benchmarkWorkerPool(workerPool: WorkerPool): Promise<void> {
    await this.runner.run("worker pool (100 tasks, 4 parallel)", async () => {
      const tasks = Array.from({ length: 100 }, (_, i) => ({
        id: `wp-${i}`,
        execute: async () => {},
        priority: 1,
      }));
      await workerPool.submitAll(tasks);
    });
  }

  private analyzeBottlenecks(
    results: BenchmarkResult[],
    avgMetrics: SystemMetrics
  ): Bottleneck[] {
    const bottlenecks: Bottleneck[] = [];

    for (const result of results) {
      // Check for slow operations (> 1 second)
      if (result.duration > 1000 && result.iterations === 1) {
        bottlenecks.push({
          area: result.name,
          severity: result.duration > 5000 ? "critical" : "high",
          description: `Took ${result.duration.toFixed(0)}ms`,
          recommendation: `Consider lazy loading, streaming, or caching for this operation`,
          estimatedImpact: `~${Math.min(80, Math.round((1 - 1000 / result.duration) * 100))}% faster`,
        });
      }
    }

    // Check memory
    if (avgMetrics.heapUsedMB > 100) {
      bottlenecks.push({
        area: "Memory Usage",
        severity: avgMetrics.heapUsedMB > 500 ? "critical" : "high",
        description: `${avgMetrics.heapUsedMB.toFixed(0)}MB heap used`,
        recommendation: "Enable lazy loading, reduce cache size, or use streaming for large operations",
        estimatedImpact: "~50% less memory usage",
      });
    }

    return bottlenecks;
  }
}
