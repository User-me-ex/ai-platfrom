/**
 * Lean benchmark runner — tests core performance subsystems
 * Skips file indexing to avoid filesystem traversal delays.
 */

import { EventBus } from "./src/core/events";
import { PerformanceMemoryManager, SmartCache } from "./src/performance/memory";
import { WorkerPool } from "./src/performance/parallel";
import { TaskScheduler } from "./src/performance/scheduler";

function green(s: string): string { return "\x1b[32m" + s + "\x1b[0m"; }
function yellow(s: string): string { return "\x1b[33m" + s + "\x1b[0m"; }
function dim(s: string): string { return "\x1b[2m" + s + "\x1b[0m"; }
function bold(s: string): string { return "\x1b[1m" + s + "\x1b[22m"; }
function red(s: string): string { return "\x1b[31m" + s + "\x1b[0m"; }

function timed(label: string, fn: () => void | Promise<void>, iterations: number): number {
  const start = Date.now();
  for (let i = 0; i < iterations; i++) {
    const r = fn();
    if (r instanceof Promise) throw new Error("Use asyncTimed for async functions");
  }
  return Date.now() - start;
}

async function asyncTimed(label: string, fn: () => Promise<void>, iterations: number): Promise<number> {
  const start = Date.now();
  for (let i = 0; i < iterations; i++) {
    await fn();
  }
  return Date.now() - start;
}

function tag(ms: number, threshold: number): string {
  return ms < threshold ? green("OK") : (ms < threshold * 3 ? yellow("OK") : red("SLOW"));
}

async function main() {
  console.log("\n  " + bold("9 Router CLI — Performance Benchmarks"));
  console.log("  " + dim("Date: " + new Date().toISOString()));
  console.log("  " + dim("Platform: " + process.platform + ", Node: " + process.version));
  console.log("  " + dim(Array(50).join("=")));
  console.log("");

  const eventBus = new EventBus();

  // ─── 1. Smart Cache ────────────────────────────────────────────
  console.log("  " + bold("1. SmartCache (LRU + TTL)"));
  console.log("  " + dim(Array(50).join("-")));

  const cache = new SmartCache(50);

  // Write benchmark
  let ms = timed("cache writes", () => {
    for (let j = 0; j < 1000; j++) cache.set("wk" + j, "val" + j, 60000);
  }, 10);
  console.log("    Write 10k entries:    " + ms.toString().padStart(6) + "ms  " + tag(ms, 50));

  // Read benchmark
  ms = timed("cache reads", () => {
    for (let j = 0; j < 1000; j++) cache.get("wk" + j);
  }, 10);
  console.log("    Read 10k entries:     " + ms.toString().padStart(6) + "ms  " + tag(ms, 30));

  // Mixed read/write
  ms = timed("mixed r/w", () => {
    for (let j = 0; j < 1000; j++) {
      if (j % 3 === 0) cache.set("mx" + j, "val", 60000);
      else cache.get("mx" + j);
    }
  }, 10);
  console.log("    Mixed 10k ops:        " + ms.toString().padStart(6) + "ms  " + tag(ms, 50));

  // Invalidation
  ms = timed("invalidate", () => {
    for (let j = 0; j < 1000; j++) cache.invalidate("wk" + j);
  }, 10);
  console.log("    Invalidate 10k:       " + ms.toString().padStart(6) + "ms  " + tag(ms, 50));

  const cs = cache.getStats();
  console.log("    Cache entries:        " + cs.entries.toString().padStart(6));
  console.log("    Cache size:           " + cs.sizeMB.toString().padStart(6) + " MB");
  console.log("    Hit rate:             " + cs.hitRate.toString().padStart(6) + " %");
  cache.clear();
  console.log("");

  // ─── 2. Object Pool ──────────────────────────────────────────────
  console.log("  " + bold("2. Object Pool"));
  console.log("  " + dim(Array(50).join("-")));

  const memory = new PerformanceMemoryManager(eventBus);
  const pool = memory.registerPool(
    "bench",
    () => ({ data: "", ts: 0, nested: { a: 0, b: "" } }),
    (obj: any) => { obj.data = ""; obj.ts = 0; obj.nested.a = 0; obj.nested.b = ""; },
    100
  );

  ms = timed("pool aq/rel 10k", () => {
    for (let j = 0; j < 1000; j++) {
      const obj = pool.acquire();
      obj.data = "x";
      pool.release(obj);
    }
  }, 10);
  console.log("    Acquire/release 10k:  " + ms.toString().padStart(6) + "ms  " + tag(ms, 50));
  console.log("    Pool size:            " + pool.size.toString().padStart(6));
  console.log("    Created:              " + pool.totalCreated.toString().padStart(6));
  pool.drain();
  console.log("");

  // ─── 3. Worker Pool ──────────────────────────────────────────────
  console.log("  " + bold("3. Worker Pool (4 concurrent)"));
  console.log("  " + dim(Array(50).join("-")));

  const pool2 = new WorkerPool(4, eventBus);
  ms = await asyncTimed("worker pool 100", async () => {
    const tasks = Array.from({ length: 100 }, (_, i) => ({
      id: "w" + i,
      execute: async () => i,
      priority: i % 10 === 0 ? 10 : 1,
    }));
    await pool2.submitAll(tasks);
  }, 1);
  console.log("    100 tasks:            " + ms.toString().padStart(6) + "ms  " + tag(ms, 200));
  console.log("    Throughput:           " + (100 / (ms / 1000)).toFixed(0).padStart(6) + " tasks/s");
  console.log("");

  // ─── 4. Worker Pool (higher concurrency) ──────────────────────
  console.log("  " + bold("4. Worker Pool (8 concurrent)"));
  console.log("  " + dim(Array(50).join("-")));

  const pool3 = new WorkerPool(8, eventBus);
  ms = await asyncTimed("worker pool 8", async () => {
    const tasks = Array.from({ length: 200 }, (_, i) => ({
      id: "w8-" + i,
      execute: async () => i,
      priority: 1,
    }));
    await pool3.submitAll(tasks);
  }, 1);
  console.log("    200 tasks:            " + ms.toString().padStart(6) + "ms  " + tag(ms, 300));
  console.log("    Throughput:           " + (200 / (ms / 1000)).toFixed(0).padStart(6) + " tasks/s");
  console.log("");

  // ─── 5. Task Scheduler ────────────────────────────────────────────
  console.log("  " + bold("5. Task Scheduler (4 concurrent)"));
  console.log("  " + dim(Array(50).join("-")));

  const scheduler = new TaskScheduler(eventBus, 4);
  const tasks = Array.from({ length: 100 }, (_, i) => ({
    id: "s" + i,
    name: "Task " + i,
    execute: async () => {},
    priority: i % 10 === 0 ? 10 : 1,
  }));
  scheduler.schedule(tasks);
  ms = await asyncTimed("scheduler 100", async () => {
    // Already scheduled above, just execute once
  }, 1);
  // Actually execute it
  const execStart = Date.now();
  const result = await scheduler.execute();
  ms = Date.now() - execStart;
  console.log("    100 tasks:            " + ms.toString().padStart(6) + "ms  " + tag(ms, 200));
  console.log("    Completed:            " + result.completed.length.toString().padStart(6));
  console.log("    Failed:               " + result.failed.length.toString().padStart(6));
  console.log("    Throughput:           " + (100 / (ms / 1000)).toFixed(0).padStart(6) + " tasks/s");
  console.log("");

  // ─── 6. Scheduler with dependencies ─────────────────────────
  console.log("  " + bold("6. Task Scheduler (dependency chains)"));
  console.log("  " + dim(Array(50).join("-")));

  const scheduler2 = new TaskScheduler(eventBus, 4);
  const depTasks = Array.from({ length: 50 }, (_, i) => ({
    id: "d" + i,
    name: "DepTask " + i,
    execute: async () => {},
    dependencies: i > 0 ? ["d" + (i - 1)] : [],
    priority: 1,
  }));
  scheduler2.schedule(depTasks);
  const depStart = Date.now();
  const depResult = await scheduler2.execute();
  const depMs = Date.now() - depStart;
  console.log("    50 tasks (chain):     " + depMs.toString().padStart(6) + "ms  " + tag(depMs, 300));
  console.log("    Completed:            " + depResult.completed.length.toString().padStart(6));
  console.log("");

  // ─── 7. Summary ──────────────────────────────────────────────────
  console.log("  " + bold("Summary"));
  console.log("  " + dim(Array(50).join("=")));
  const mem = process.memoryUsage();
  console.log("    Heap used:            " + (mem.heapUsed / 1024 / 1024).toFixed(1).padStart(6) + " MB");
  console.log("    RSS:                  " + (mem.rss / 1024 / 1024).toFixed(1).padStart(6) + " MB");
  console.log("    All benchmarks:       " + green("COMPLETE"));
  console.log("");
}

main().catch((err) => {
  console.error("  " + red("ERROR: " + (err instanceof Error ? err.message : String(err))));
  process.exit(1);
});
