/**
 * 9 Router CLI — Streaming Architecture
 *
 * - Progressive output for all long-running operations
 * - Incremental rendering with live updates
 * - Streaming logs and progress bars
 * - Streaming code generation with immediate feedback
 * - Streaming file edits and search results
 */

import { stdout } from "process";
import chalk from "chalk";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StreamProgress {
  current: number;
  total: number;
  label: string;
  status: "running" | "completed" | "failed";
  elapsed: number;
  speed?: number; // items/second
  eta?: number; // ms
}

export type StreamLogLevel = "info" | "warn" | "error" | "debug" | "success";

export interface StreamLogEntry {
  level: StreamLogLevel;
  message: string;
  timestamp: number;
  details?: string;
}

export interface StreamChunk<T = unknown> {
  type: "data" | "progress" | "log" | "error" | "done";
  value?: T;
  progress?: StreamProgress;
  log?: StreamLogEntry;
  error?: string;
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────

export class ProgressBar {
  private width: number;
  private lastRender = "";
  private startTime = 0;
  private current = 0;
  private total = 1;
  private label = "";
  private status: "running" | "completed" | "failed" = "running";
  private completed = false;

  constructor(width = 30) {
    this.width = width;
  }

  /** Start tracking a task */
  start(total: number, label = ""): void {
    this.startTime = Date.now();
    this.total = total;
    this.label = label;
    this.current = 0;
    this.status = "running";
    this.completed = false;
    this.render(0, total);
  }

  /** Advance the progress bar */
  advance(n = 1, newLabel?: string): void {
    this.current += n;
    if (newLabel) this.label = newLabel;
    if (this.current >= this.total) {
      this.status = "completed";
      this.completed = true;
    }
    this.render(this.current, this.total);
    if (this.completed) this.finalize();
  }

  /** Update progress to a specific value */
  update(current: number, total: number, newLabel?: string): void {
    this.current = current;
    this.total = total;
    if (newLabel) this.label = newLabel;
    if (this.current >= this.total) {
      this.status = "completed";
      this.completed = true;
    }
    this.render(current, total);
    if (this.completed) this.finalize();
  }

  /** Mark as failed */
  fail(errorMessage?: string): void {
    this.status = "failed";
    this.render(this.current, this.total);
    stdout.write(`\n${chalk.red("✗")} ${errorMessage ?? this.label}\n`);
  }

  /** Get current progress info */
  getProgress(): StreamProgress {
    const elapsed = Date.now() - this.startTime;
    const speed = elapsed > 0 ? (this.current / elapsed) * 1000 : 0;
    return {
      current: this.current,
      total: this.total,
      label: this.label,
      status: this.status,
      elapsed,
      speed,
      eta: speed > 0 ? (this.total - this.current) / speed * 1000 : 0,
    };
  }

  /** Clear the progress bar from terminal */
  clear(): void {
    if (this.lastRender) {
      stdout.write("\r" + " ".repeat(this.lastRender.length) + "\r");
      this.lastRender = "";
    }
  }

  /** Clean up */
  dispose(): void {
    this.clear();
  }

  private render(current: number, total: number): void {
    const fraction = total > 0 ? current / total : 0;
    const filled = Math.round(fraction * this.width);
    const empty = this.width - filled;

    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    const bar = chalk.green("█".repeat(filled)) + chalk.dim("░".repeat(empty));
    const pct = (fraction * 100).toFixed(0).padStart(3);

    const statusColor =
      this.status === "failed" ? chalk.red :
      this.status === "completed" ? chalk.green :
      chalk.cyan;

    const line = ` ${statusColor("▸")} ${chalk.dim(this.label)} ${bar} ${chalk.bold(pct)}% ${chalk.dim(`[${elapsed}s]`)}`;

    // Clear previous line and render
    if (this.lastRender) stdout.write("\r");
    stdout.write(line);
    this.lastRender = line;
  }

  private finalize(): void {
    stdout.write("\n");
    this.lastRender = "";
  }
}

// ─── Streaming Renderer ───────────────────────────────────────────────────────

export class StreamingRenderer {
  private activeProgressBars = new Map<string, ProgressBar>();
  private logs: StreamLogEntry[] = [];
  private maxLogLines = 100;
  private showTimestamps = false;

  constructor(showTimestamps = false) {
    this.showTimestamps = showTimestamps;
  }

  /** Create a progress bar for a task */
  createProgress(id: string, total: number, label = ""): ProgressBar {
    const bar = new ProgressBar();
    bar.start(total, label);
    this.activeProgressBars.set(id, bar);
    return bar;
  }

  /** Get an existing progress bar */
  getProgress(id: string): ProgressBar | undefined {
    return this.activeProgressBars.get(id);
  }

  /** Remove a progress bar */
  removeProgress(id: string): void {
    this.activeProgressBars.get(id)?.dispose();
    this.activeProgressBars.delete(id);
  }

  /** Log a message */
  log(level: StreamLogLevel, message: string, details?: string): void {
    const entry: StreamLogEntry = { level, message, timestamp: Date.now(), details };
    this.logs.push(entry);
    if (this.logs.length > this.maxLogLines) this.logs.shift();

    const icon =
      level === "error" ? chalk.red("✗") :
      level === "warn" ? chalk.yellow("⚠") :
      level === "success" ? chalk.green("✓") :
      level === "debug" ? chalk.dim("·") :
      chalk.cyan("ℹ");

    const ts = this.showTimestamps
      ? chalk.dim(`[${new Date(entry.timestamp).toISOString().split("T")[1]?.split(".")[0]}] `)
      : "";

    const color =
      level === "error" ? chalk.red :
      level === "warn" ? chalk.yellow :
      level === "success" ? chalk.green :
      level === "debug" ? chalk.dim :
      chalk.white;

    stdout.write(`${ts}${icon} ${color(message)}\n`);
    if (details) stdout.write(chalk.dim(`  ${details}\n`));
  }

  /** Stream generated code in chunks */
  streamCode(code: string, onChunk?: (chunk: string) => void): void {
    // Split code into logical chunks and stream them
    const lines = code.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const chunk = lines[i]! + (i < lines.length - 1 ? "\n" : "");
      stdout.write(chunk);
      if (onChunk) onChunk(chunk);
      // Small delay for visual streaming effect if there are many lines
      if (lines.length > 20) {
        // Don't actually delay in production — just render instantly
      }
    }
  }

  /** Stream search results progressively */
  streamSearchResults<T>(
    items: T[],
    renderItem: (item: T, index: number) => string,
    batchSize = 5,
    onBatch?: (rendered: string[]) => void
  ): void {
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const rendered = batch.map((item, j) => renderItem(item, i + j));
      for (const line of rendered) stdout.write(line + "\n");
      if (onBatch) onBatch(rendered);
    }
  }

  /** Get recent log entries */
  getRecentLogs(count = 10): StreamLogEntry[] {
    return this.logs.slice(-count);
  }

  /** Clear all progress bars */
  clearAll(): void {
    for (const [, bar] of this.activeProgressBars) {
      bar.dispose();
    }
    this.activeProgressBars.clear();
  }
}

// ─── Stream Aggregator ────────────────────────────────────────────────────────

/**
 * Aggregates multiple parallel streams into a single unified output.
 * Useful for parallel task execution where you want a combined view.
 */
export class StreamAggregator {
  private streams = new Map<string, StreamChunk[]>();
  private onAggregated?: (chunks: Array<{ id: string; chunk: StreamChunk }>) => void;

  constructor(onAggregated?: (chunks: Array<{ id: string; chunk: StreamChunk }>) => void) {
    this.onAggregated = onAggregated;
  }

  /** Push a chunk from a specific stream */
  push(id: string, chunk: StreamChunk): void {
    if (!this.streams.has(id)) this.streams.set(id, []);
    this.streams.get(id)!.push(chunk);

    if (this.onAggregated) {
      this.onAggregated([{ id, chunk }]);
    }
  }

  /** Get all chunks from a stream */
  getStream(id: string): StreamChunk[] {
    return this.streams.get(id) ?? [];
  }

  /** Check if all streams are done */
  allDone(): boolean {
    for (const chunks of this.streams.values()) {
      if (!chunks.some((c) => c.type === "done")) return false;
    }
    return true;
  }

  /** Clear all streams */
  clear(): void {
    this.streams.clear();
  }
}
