/**
 * 9 Router CLI — High-Performance File System
 *
 * - Incremental indexing with hash-based change detection
 * - Lazy directory traversal (yields results as found)
 * - Fast file searching with ripgrep
 * - .gitignore-aware filtering
 * - Efficient file watching with debouncing
 * - Fast symbol lookup via index
 * - Fast project scanning
 */

import {
  readFileSync,
  statSync,
  readdirSync,
  watch,
  FSWatcher,
  type Stats,
} from "fs";
import { join, relative, basename, extname, resolve } from "path";
import { EventBus } from "../core/events";
import { createHash } from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FileIndexEntry {
  path: string; // relative to root
  absolutePath: string;
  size: number;
  modifiedAt: number;
  hash: string; // content hash for change detection
  lines: number;
  extension: string;
  symbols: string[]; // extracted function/class/variable names
}

export interface FileSearchResult {
  path: string;
  line: number;
  column: number;
  content: string;
  matchLength: number;
}

export interface SymbolInfo {
  name: string;
  type: "function" | "class" | "variable" | "interface" | "type" | "constant";
  filePath: string;
  line: number;
}

export interface IndexStats {
  totalFiles: number;
  totalSize: number;
  indexedExtensions: number;
  lastIndexed: number;
  indexDuration: number;
}

// ─── Gitignore Parser ─────────────────────────────────────────────────────────

export class GitignoreParser {
  private patterns: Array<{ pattern: string; negate: boolean }> = [];

  /** Load patterns from a .gitignore file */
  loadFromFile(gitignorePath: string): void {
    try {
      const content = readFileSync(gitignorePath, "utf-8");
      this.parse(content);
    } catch { /* file doesn't exist */ }
  }

  /** Parse .gitignore content */
  parse(content: string): void {
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const negate = trimmed.startsWith("!");
      const pattern = negate ? trimmed.slice(1) : trimmed;
      this.patterns.push({ pattern, negate });
    }
  }

  /** Check if a file should be ignored */
  isIgnored(filePath: string): boolean {
    let ignored = false;
    for (const { pattern, negate } of this.patterns) {
      if (this.matches(filePath, pattern)) {
        ignored = !negate;
      }
    }
    return ignored;
  }

  private matches(filePath: string, pattern: string): boolean {
    // Normalize to forward slashes
    const normalized = filePath.replace(/\\/g, "/");

    // Simple glob matching
    const regexStr = pattern
      .replace(/\./g, "\\.")
      .replace(/\*\*/g, "___DOUBLESTAR___")
      .replace(/\*/g, "[^/]*")
      .replace(/___DOUBLESTAR___/g, ".*")
      .replace(/\?/g, "[^/]");

    const regex = new RegExp(`^${regexStr}$|^${regexStr}/|/${regexStr}$`);
    return regex.test(normalized);
  }
}

// ─── File Indexer ─────────────────────────────────────────────────────────────

export class FileIndexer {
  private index = new Map<string, FileIndexEntry>();
  private symbols = new Map<string, SymbolInfo[]>(); // filePath -> symbols
  private gitignore = new GitignoreParser();
  private rootPath: string;
  private hashCache = new Map<string, string>(); // path -> hash
  private eventBus: EventBus;
  private indexing = false;

  // Extension-based include/exclude
  private codeExtensions = new Set([
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".rb", ".go", ".rs", ".java", ".kt",
    ".swift", ".c", ".cpp", ".h", ".hpp",
    ".cs", ".php", ".vue", ".svelte",
    ".json", ".yaml", ".yml", ".toml",
    ".md", ".css", ".scss", ".html",
  ]);

  private ignoreDirs = new Set([
    "node_modules", ".git", "dist", "build", "target",
    ".next", ".nuxt", ".output", ".cache",
    "__pycache__", ".venv", "venv", ".tox",
    "vendor", ".bundle", "coverage",
  ]);

  constructor(rootPath: string, eventBus: EventBus) {
    this.rootPath = resolve(rootPath);
    this.eventBus = eventBus;

    // Load .gitignore
    this.gitignore.loadFromFile(join(this.rootPath, ".gitignore"));
  }

  /** Perform a full index */
  async fullIndex(): Promise<void> {
    if (this.indexing) return;
    this.indexing = true;

    this.index.clear();
    this.symbols.clear();
    this.hashCache.clear();

    await this.traverse(this.rootPath);

    this.indexing = false;
    this.eventBus.emit("memory:vector:index", this.index.size);
  }

  /** Incremental index — only updates changed files */
  async incrementalIndex(): Promise<{ added: number; updated: number; removed: number }> {
    if (this.indexing) return { added: 0, updated: 0, removed: 0 };
    this.indexing = true;

    let added = 0;
    let updated = 0;
    const currentPaths = new Set<string>();

    const processEntry = (relativePath: string, absolutePath: string): void => {
      currentPaths.add(relativePath);
      const existing = this.index.get(relativePath);

      try {
        const stats = statSync(absolutePath);
        const newHash = this.computeHash(absolutePath, Number(stats.size));

        if (!existing || existing.hash !== newHash) {
          if (existing) {
            updated++;
          } else {
            added++;
          }
          const entry = this.createEntry(relativePath, absolutePath, stats, newHash);
          this.index.set(relativePath, entry);
          this.indexSymbols(entry);
        }
      } catch { /* skip unreadable */ }
    };

    await this.traverse(this.rootPath, processEntry);

    // Remove deleted files
    let removed = 0;
    for (const key of this.index.keys()) {
      if (!currentPaths.has(key)) {
        this.index.delete(key);
        this.symbols.delete(key);
        removed++;
      }
    }

    this.indexing = false;
    return { added, updated, removed };
  }

  /** Search files by name pattern */
  findFiles(pattern: string, maxResults = 100): FileIndexEntry[] {
    const results: FileIndexEntry[] = [];
    const regex = new RegExp(pattern.replace(/\*/g, ".*").replace(/\?/g, "."), "i");
    for (const entry of this.index.values()) {
      if (results.length >= maxResults) break;
      if (regex.test(entry.path) || regex.test(basename(entry.path))) {
        results.push(entry);
      }
    }
    return results;
  }

  /** Search file contents using internal index (simple grep) */
  searchContent(query: string, maxResults = 200): FileSearchResult[] {
    const results: FileSearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    for (const entry of this.index.values()) {
      if (results.length >= maxResults) break;
      try {
        const content = readFileSync(entry.absolutePath, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          const idx = line.toLowerCase().indexOf(lowerQuery);
          if (idx >= 0) {
            results.push({
              path: entry.path,
              line: i + 1,
              column: idx + 1,
              content: line.trim().substring(0, 200),
              matchLength: query.length,
            });
            if (results.length >= maxResults) break;
          }
        }
      } catch { /* skip unreadable */ }
    }
    return results;
  }

  /** Search for symbols by name */
  findSymbols(name: string, maxResults = 50): SymbolInfo[] {
    const results: SymbolInfo[] = [];
    const lowerName = name.toLowerCase();
    for (const fileSymbols of this.symbols.values()) {
      for (const sym of fileSymbols) {
        if (results.length >= maxResults) break;
        if (sym.name.toLowerCase().includes(lowerName)) {
          results.push(sym);
        }
      }
    }
    return results;
  }

  /** Get index statistics */
  getStats(): IndexStats {
    let totalSize = 0;
    for (const entry of this.index.values()) totalSize += entry.size;
    return {
      totalFiles: this.index.size,
      totalSize,
      indexedExtensions: this.codeExtensions.size,
      lastIndexed: Date.now(),
      indexDuration: 0,
    };
  }

  /** Get all indexed entries (for iteration) */
  getEntries(): FileIndexEntry[] {
    return [...this.index.values()];
  }

  private async traverse(
    dir: string,
    onFile?: (relativePath: string, absolutePath: string) => void
  ): Promise<void> {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const absolutePath = join(dir, entry.name);
        const relativePath = relative(this.rootPath, absolutePath);

        if (entry.isDirectory()) {
          if (this.ignoreDirs.has(entry.name)) continue;
          if (entry.name.startsWith(".") && entry.name !== ".") continue;
          if (this.gitignore.isIgnored(relativePath)) continue;
          await this.traverse(absolutePath, onFile);
        } else if (entry.isFile()) {
          if (this.gitignore.isIgnored(relativePath)) continue;
          if (!this.codeExtensions.has(extname(entry.name).toLowerCase())) continue;
          if (onFile) {
            onFile(relativePath, absolutePath);
          } else {
            try {
              const stats = statSync(absolutePath);
              const hash = this.computeHash(absolutePath, Number(stats.size));
              const fileEntry = this.createEntry(relativePath, absolutePath, stats, hash);
              this.index.set(relativePath, fileEntry);
              this.indexSymbols(fileEntry);
            } catch { /* skip */ }
          }
        }
      }
    } catch { /* skip inaccessible dirs */ }
  }

  private createEntry(
    relativePath: string,
    absolutePath: string,
    stats: Stats,
    hash: string
  ): FileIndexEntry {
    return {
      path: relativePath,
      absolutePath,
      size: Number(stats.size),
      modifiedAt: stats.mtimeMs,
      hash,
      lines: 0, // lazily computed
      extension: extname(relativePath).toLowerCase(),
      symbols: [],
    };
  }

  private indexSymbols(entry: FileIndexEntry): void {
    try {
      const content = readFileSync(entry.absolutePath, "utf-8");
      entry.lines = content.split("\n").length;
      const symbols = this.extractSymbols(content, entry.path);
      entry.symbols = symbols.map((s) => s.name);
      this.symbols.set(entry.path, symbols);
    } catch { /* skip */ }
  }

  private extractSymbols(content: string, _filePath: string): SymbolInfo[] {
    const symbols: SymbolInfo[] = [];
    const lines = content.split("\n");

    // Simple regex-based symbol extraction
    const patterns: Array<{ regex: RegExp; type: SymbolInfo["type"] }> = [
      { regex: /^export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/gm, type: "function" },
      { regex: /^export\s+(?:default\s+)?class\s+(\w+)/gm, type: "class" },
      { regex: /^export\s+(?:default\s+)?interface\s+(\w+)/gm, type: "interface" },
      { regex: /^export\s+(?:default\s+)?type\s+(\w+)/gm, type: "type" },
      { regex: /^(?:const|let|var)\s+(\w+)\s*[=:]/gm, type: "variable" },
      { regex: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=/gm, type: "variable" },
      { regex: /^export\s+(?:const|let|var)\s+(\w+)\s*=/gm, type: "constant" },
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      for (const { regex, type } of patterns) {
        regex.lastIndex = 0;
        const match = regex.exec(line);
        if (match && match[1]) {
          symbols.push({ name: match[1], type, filePath: _filePath, line: i + 1 });
        }
      }
    }

    return symbols;
  }

  private computeHash(filePath: string, size: number): string {
    try {
      // For files > 1MB, hash from metadata to avoid loading large files
      if (size > 1024 * 1024) {
        return `${size}_${statSync(filePath).mtimeMs}`;
      }
      const content = readFileSync(filePath);
      return createHash("md5").update(content).digest("hex");
    } catch {
      return `${Date.now()}`;
    }
  }
}

// ─── File Watcher ─────────────────────────────────────────────────────────────

export class FileWatcher {
  private watchers = new Map<string, FSWatcher>();
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private debounceMs: number;
  private onChange: (filePath: string, event: "change" | "rename") => void;

  constructor(
    onChange: (filePath: string, event: "change" | "rename") => void,
    debounceMs = 100
  ) {
    this.onChange = onChange;
    this.debounceMs = debounceMs;
  }

  /** Start watching a directory */
  watch(dirPath: string): void {
    if (this.watchers.has(dirPath)) return;
    try {
      const watcher = watch(dirPath, { recursive: true }, (event, filename) => {
        if (!filename) return;
        const fullPath = join(dirPath, filename.toString());

        // Debounce
        const existing = this.debounceTimers.get(fullPath);
        if (existing) clearTimeout(existing);

        this.debounceTimers.set(
          fullPath,
          setTimeout(() => {
            this.onChange(fullPath, event === "change" ? "change" : "rename");
            this.debounceTimers.delete(fullPath);
          }, this.debounceMs)
        );
      });
      this.watchers.set(dirPath, watcher);
    } catch { /* skip unwatchable dirs */ }
  }

  /** Stop watching */
  unwatch(dirPath?: string): void {
    if (dirPath) {
      this.watchers.get(dirPath)?.close();
      this.watchers.delete(dirPath);
    } else {
      for (const [, watcher] of this.watchers) watcher.close();
      this.watchers.clear();
    }
    // Clear all debounce timers
    for (const [, timer] of this.debounceTimers) clearTimeout(timer);
    this.debounceTimers.clear();
  }
}

// ─── High-Performance File System Manager ─────────────────────────────────────

export class PerformanceFileSystem {
  readonly indexer: FileIndexer;
  readonly watcher: FileWatcher;
  private rootPath: string;

  constructor(rootPath: string, eventBus: EventBus) {
    this.rootPath = resolve(rootPath);
    this.indexer = new FileIndexer(this.rootPath, eventBus);
    this.watcher = new FileWatcher((filePath, event) => {
      eventBus.emit("memory:recall", `${filePath}:${event}`);
      void this.indexer.incrementalIndex();
    });
  }

  /** Start watching the project */
  startWatching(): void {
    this.watcher.watch(this.rootPath);
  }

  /** Stop watching */
  stopWatching(): void {
    this.watcher.unwatch();
  }

  /** Get root path */
  get root(): string {
    return this.rootPath;
  }
}
