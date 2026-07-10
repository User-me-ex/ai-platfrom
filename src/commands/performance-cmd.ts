/**
 * 9 Router CLI — Performance Command
 *
 * /perf status       — Show performance statistics
 * /perf benchmark    — Run benchmark suite
 * /perf cache        — Show cache stats
 * /perf gc           — Suggest garbage collection
 * /perf scheduler    — Show scheduler status
 * /perf index        — Index the file system
 */

import chalk from "chalk";
import type { Command, CommandContext } from "../core/types";
import { PerformanceOrchestrator } from "../performance/index";

export function createPerformanceCommand(perf: PerformanceOrchestrator): Command {
  return {
    name: "perf",
    description: "Performance monitoring and optimization",
    aliases: ["performance", "benchmark"],
    usage: "/perf [status|benchmark|cache|gc|scheduler|index]",
    async execute(args: string[], _context: CommandContext): Promise<void> {
      const subcommand = args[0]?.toLowerCase() ?? "status";

      switch (subcommand) {
        case "status":
        case "stats":
          await showStatus(perf);
          break;

        case "benchmark":
        case "bench":
          await runBenchmarks(perf);
          break;

        case "cache":
          showCache(perf);
          break;

        case "gc":
          suggestGC(perf);
          break;

        case "scheduler":
          showScheduler(perf);
          break;

        case "index":
          await indexFiles(perf);
          break;

        default:
          console.log(chalk.yellow(`Unknown subcommand: ${subcommand}`));
          console.log(chalk.dim("Usage: /perf [status|benchmark|cache|gc|scheduler|index]"));
      }
    },
  };
}

async function showStatus(perf: PerformanceOrchestrator): Promise<void> {
  const status = perf.getStatus() as Record<string, unknown>;

  console.log(chalk.cyan.bold("\n  ⚡ Performance Status"));
  console.log(chalk.dim("  ─────────────────────────────────────"));

  // Memory
  const mem = status.memory as Record<string, unknown>;
  console.log(`  ${chalk.green("▸")} ${chalk.bold("Memory")}`);
  console.log(`     Heap:    ${(mem.heapUsed as number / 1024 / 1024).toFixed(1)} MB / ${(mem.heapTotal as number / 1024 / 1024).toFixed(1)} MB`);
  console.log(`     RSS:     ${(mem.rss as number / 1024 / 1024).toFixed(1)} MB`);

  // Cache
  const cache = status.cache as Record<string, unknown>;
  console.log(`  ${chalk.green("▸")} ${chalk.bold("Cache")}`);
  console.log(`     Entries: ${cache.entries}`);
  console.log(`     Size:    ${cache.sizeMB} MB`);
  console.log(`     Hit Rate: ${cache.hitRate}%`);

  // File System
  const fs = status.fileSystem as Record<string, unknown>;
  console.log(`  ${chalk.green("▸")} ${chalk.bold("File System")}`);
  console.log(`     Indexed: ${fs.totalFiles} files`);
  console.log(`     Size:    ${((fs.totalSize as number) / 1024 / 1024).toFixed(1)} MB`);

  // Parallel
  const parallel = status.parallel as Record<string, unknown>;
  console.log(`  ${chalk.green("▸")} ${chalk.bold("Parallel")}`);
  console.log(`     Running: ${parallel.running}`);
  console.log(`     Queued:  ${parallel.queued}`);

  console.log("");
}

async function runBenchmarks(perf: PerformanceOrchestrator): Promise<void> {
  console.log(chalk.cyan.bold("\n  ⚡ Running Benchmarks...\n"));
  const results = await perf.runBenchmarks();
  console.log(perf.benchmark.generateReport(results));
}

function showCache(perf: PerformanceOrchestrator): void {
  const stats = perf.memory.cache.getStats();
  console.log(chalk.cyan.bold("\n  ⚡ Cache Statistics"));
  console.log(chalk.dim("  ─────────────────────────────────────"));
  console.log(`  Entries: ${stats.entries}`);
  console.log(`  Size:    ${stats.sizeMB} MB`);
  console.log(`  Hit Rate: ${stats.hitRate}%`);
  console.log("");
}

function suggestGC(perf: PerformanceOrchestrator): void {
  perf.memory.suggestGC();
  console.log(chalk.green("\n  ✓ Cache cleared, memory pools drained.\n"));
}

function showScheduler(perf: PerformanceOrchestrator): void {
  const progress = perf.scheduler.getProgress();
  console.log(chalk.cyan.bold("\n  ⚡ Scheduler Status"));
  console.log(chalk.dim("  ─────────────────────────────────────"));
  console.log(`  Total:     ${progress.total}`);
  console.log(`  Pending:   ${progress.pending}`);
  console.log(`  Running:   ${progress.running}`);
  console.log(`  Completed: ${progress.completed}`);
  console.log(`  Failed:    ${progress.failed}`);
  console.log(`  Elapsed:   ${(progress.elapsed / 1000).toFixed(1)}s`);
  console.log("");
}

async function indexFiles(perf: PerformanceOrchestrator): Promise<void> {
  console.log(chalk.cyan("\n  Indexing file system..."));
  const start = Date.now();
  await perf.indexFileSystem();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const stats = perf.fileSystem.indexer.getStats();
  console.log(chalk.green(`  ✓ Indexed ${stats.totalFiles} files in ${elapsed}s`));
  console.log("");
}
