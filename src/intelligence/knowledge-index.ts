import { readFileSync, existsSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, relative, extname, basename, dirname } from "path";
import { createHash } from "crypto";

export interface FileEntry {
  path: string;
  type: "code" | "config" | "docs" | "infra" | "data" | "script" | "markup";
  purpose: string;
  exports: string[];
  dependencies: string[];
  reverseDeps: string[];
  relatedModules: string[];
  commands?: string[];
  eventsHandled?: string[];
  eventsEmitted?: string[];
  configUsed?: string[];
  interfacesImplemented?: string[];
  lastAnalyzed: string;
  contentHash?: string;
}

export interface ModuleEntry {
  summary: string;
  files: string[];
}

export interface KnowledgeIndex {
  project: {
    name: string;
    version: string;
    description: string;
    runtime: string;
    language: string;
  };
  files: Record<string, FileEntry>;
  modules: Record<string, ModuleEntry>;
  lastUpdated: string;
}

export interface IndexSyncReport {
  added: string[];
  removed: string[];
  modified: string[];
  renamed: Array<{ from: string; to: string }>;
  moduleChanges: Array<{ file: string; from: string | null; to: string | null }>;
}

interface AnalyzedFileData {
  type: FileEntry["type"];
  exports: string[];
  dependencies: string[];
  relatedModules: string[];
  commands?: string[];
  eventsHandled?: string[];
  eventsEmitted?: string[];
  configUsed?: string[];
  interfacesImplemented?: string[];
  contentHash?: string;
}

const INDEX_DIR = join(__dirname, "..", ".knowledge-index");
const INDEX_FILE = join(INDEX_DIR, "files", "index.json");

let _cached: KnowledgeIndex | null = null;

export function loadKnowledgeIndex(): KnowledgeIndex {
  if (_cached) return _cached;
  if (!existsSync(INDEX_FILE)) {
    return {
      project: { name: "unknown", version: "0.0.0", description: "", runtime: "node", language: "ts" },
      files: {},
      modules: {},
      lastUpdated: new Date().toISOString(),
    };
  }
  const raw = JSON.parse(readFileSync(INDEX_FILE, "utf-8"));
  _cached = {
    project: {
      name: "9router-cli",
      version: "0.1.0",
      description: "Production-grade AI CLI",
      runtime: "bun",
      language: "TypeScript",
    },
    files: raw.files ?? {},
    modules: raw.modules ?? {},
    lastUpdated: raw.lastUpdated ?? new Date().toISOString(),
  };
  return _cached;
}

export function invalidateCache(): void {
  _cached = null;
}

export function getFileMeta(filePath: string): FileEntry | null {
  const idx = loadKnowledgeIndex();
  const key = normalizePath(filePath);
  return idx.files[key] ?? null;
}

export function getFilesByModule(moduleName: string): FileEntry[] {
  const idx = loadKnowledgeIndex();
  const mod = idx.modules[moduleName];
  if (!mod) return [];
  return mod.files.map((f) => idx.files[f]).filter((f): f is FileEntry => f !== undefined);
}

export function findFilesByExport(exportName: string): FileEntry[] {
  const idx = loadKnowledgeIndex();
  return Object.values(idx.files).filter((f) => f.exports.includes(exportName));
}

export function findFilesByDependency(depName: string): FileEntry[] {
  const idx = loadKnowledgeIndex();
  return Object.values(idx.files).filter((f) => f.dependencies.includes(depName));
}

export function getAffectedFiles(changedPaths: string[]): Set<string> {
  const idx = loadKnowledgeIndex();
  const affected = new Set<string>();
  const changed = new Set(changedPaths.map(normalizePath));
  for (const [path, entry] of Object.entries(idx.files)) {
    if (changed.has(path)) {
      affected.add(path);
      for (const dep of entry.reverseDeps) {
        const depPath = normalizePath(dep);
        if (idx.files[depPath]) affected.add(depPath);
      }
    }
    for (const dep of entry.dependencies) {
      const depKey = normalizePath(dep);
      if (changed.has(depKey)) affected.add(path);
    }
  }
  return affected;
}

export function getModuleForFile(filePath: string): string | null {
  const key = normalizePath(filePath);
  const idx = loadKnowledgeIndex();
  for (const [name, mod] of Object.entries(idx.modules)) {
    if (mod.files.includes(key)) return name;
  }
  return null;
}

export function refreshIndexEntry(filePath: string, updates: Partial<FileEntry>): void {
  const idx = loadKnowledgeIndex();
  const key = normalizePath(filePath);
  if (idx.files[key]) {
    idx.files[key] = { ...idx.files[key], ...updates, lastAnalyzed: new Date().toISOString() };
  }
  saveIndex(idx);
}

export function deepAnalyzeFile(filePath: string, rootDir?: string): AnalyzedFileData {
  const root = rootDir ?? process.cwd();
  const absolutePath = join(root, filePath);
  if (!existsSync(absolutePath)) {
    return {
      type: "code",
      exports: [],
      dependencies: [],
      relatedModules: [],
    };
  }

  const content = readFileSync(absolutePath, "utf-8");
  const contentHash = createHash("md5").update(content).digest("hex");
  const isCodeFile = extname(filePath) === ".ts" || extname(filePath) === ".tsx";

  const exports: string[] = [];
  const dependencies: string[] = [];
  const commands: string[] = [];
  const eventsHandled: string[] = [];
  const eventsEmitted: string[] = [];
  const configUsed: string[] = [];
  const interfacesImplemented: string[] = [];

  if (isCodeFile) {
    const importRe = /(?:import\s+(?:(?:\{[^}]*\}|[^;{]+)\s+from\s+)?['"])([^'"]+)(['"])|(?:import\(['"])([^'"]+)(['"])|(?:require\(['"])([^'"]+)(['"])/g;
    let m1: RegExpExecArray | null;
    while ((m1 = importRe.exec(content)) !== null) {
      const dep = m1[1] || m1[3] || m1[5];
      if (dep) {
        if (!dep.startsWith(".") && !dep.startsWith("@")) {
          if (!dependencies.includes(dep)) dependencies.push(dep);
        } else {
          const d = dirname(filePath);
          const resolved = resolveRelativeImport(d, dep);
          if (resolved && !dependencies.includes(resolved)) dependencies.push(resolved);
        }
      }
    }

    const exportRe = /export\s+(?:declare\s+)?(?:const|let|var|function|class|interface|type|enum|default\s+(?:class|function))\s+(\w+)/g;
    let m2: RegExpExecArray | null;
    while ((m2 = exportRe.exec(content)) !== null) {
      if (m2[1] && !exports.includes(m2[1])) exports.push(m2[1]);
    }

    const reExportRe = /export\s+\{[^}]*\}\s*from\s+['"]([^'"]+)['"]/g;
    let m3: RegExpExecArray | null;
    while ((m3 = reExportRe.exec(content)) !== null) {
      const dep = m3[1];
      if (dep) {
        if (!dep.startsWith(".")) {
          if (!dependencies.includes(dep)) dependencies.push(dep);
        } else {
          const d = dirname(filePath);
          const resolved = resolveRelativeImport(d, dep);
          if (resolved && !dependencies.includes(resolved)) dependencies.push(resolved);
        }
      }
    }

    const exportNamedRe = /export\s+\{([^}]+)\}\s*;?/g;
    let m4: RegExpExecArray | null;
    while ((m4 = exportNamedRe.exec(content)) !== null) {
      const cap = m4[1];
      if (cap) {
        const names = cap.split(",").map((s) => (s.trim().split(/\s+as\s+/)[0] ?? "").trim());
        for (const name of names) {
          if (name && !name.startsWith("type ") && !exports.includes(name)) exports.push(name);
        }
      }
    }

    const eventEmitRe = /eventBus\.emit\(['"](\w+(?::\w+)*)['"]\)/g;
    let m5: RegExpExecArray | null;
    while ((m5 = eventEmitRe.exec(content)) !== null) {
      if (m5[1] && !eventsEmitted.includes(m5[1])) eventsEmitted.push(m5[1]);
    }

    const eventOnRe = /eventBus\.on\(['"](\w+(?::\w+)*)['"]/g;
    let m6: RegExpExecArray | null;
    while ((m6 = eventOnRe.exec(content)) !== null) {
      if (m6[1] && !eventsHandled.includes(m6[1])) eventsHandled.push(m6[1]);
    }

    const configGetRe = /\b(config\.get|configManager\.get|this\.config)\(['"](\w+)['"]\)/g;
    let m7: RegExpExecArray | null;
    while ((m7 = configGetRe.exec(content)) !== null) {
      if (m7[2] && !configUsed.includes(m7[2])) configUsed.push(m7[2]);
    }

    const implementsRe = /implements\s+(\w+)/g;
    let m8: RegExpExecArray | null;
    while ((m8 = implementsRe.exec(content)) !== null) {
      if (m8[1] && !interfacesImplemented.includes(m8[1])) interfacesImplemented.push(m8[1]);
    }

    const commandFnRe = /export\s+function\s+(create\w*Command)/g;
    let m9: RegExpExecArray | null;
    while ((m9 = commandFnRe.exec(content)) !== null) {
      if (m9[1] && !commands.includes(m9[1])) commands.push(m9[1]);
    }
  }

  const isCmdFile = filePath.includes("\\commands\\") || filePath.includes("/commands/");
  if (isCmdFile && isCodeFile) {
    const commandNameRe = /name:\s*['"](\w+)['"]/g;
    let m10: RegExpExecArray | null;
    while ((m10 = commandNameRe.exec(content)) !== null) {
      if (m10[1] && !commands.includes(m10[1])) commands.push(m10[1]);
    }
  }

  const base = basename(filePath);
  const type: FileEntry["type"] = base === "package.json" || base === "tsconfig.json"
    ? "config"
    : base.endsWith(".md") ? "docs"
    : base.endsWith(".json") ? "data"
    : base === "Dockerfile" || base === ".gitignore" ? "infra"
    : "code";

  const relatedModules = dependencies
    .filter((d) => d.includes("/"))
    .map((d) => {
      const parts = d.split("/");
      return parts.length >= 2 ? parts.slice(0, -1).join("/") : d;
    })
    .filter((v, i, a) => a.indexOf(v) === i);

  return {
    type,
    exports,
    dependencies,
    relatedModules,
    commands: commands.length > 0 ? commands : undefined,
    eventsHandled: eventsHandled.length > 0 ? eventsHandled : undefined,
    eventsEmitted: eventsEmitted.length > 0 ? eventsEmitted : undefined,
    configUsed: configUsed.length > 0 ? configUsed : undefined,
    interfacesImplemented: interfacesImplemented.length > 0 ? interfacesImplemented : undefined,
    contentHash,
  };
}

function resolveRelativeImport(dir: string, importPath: string): string | null {
  let resolved: string;
  if (importPath.startsWith("./") || importPath.startsWith("../")) {
    resolved = join(dir, importPath).replace(/\\/g, "/");
  } else {
    resolved = importPath;
  }

  const stripped = resolved.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "");
  const srcPrefix = "src/";
  const srcIdx = stripped.indexOf(srcPrefix);
  if (srcIdx >= 0) return stripped.slice(srcIdx);
  if (stripped.startsWith("src/")) return stripped;
  return null;
}

export function scanNewFiles(rootDir: string, analyze = true): string[] {
  const idx = loadKnowledgeIndex();
  const added: string[] = [];
  const srcDir = join(rootDir, "src");
  if (!existsSync(srcDir)) return added;

  const scan = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      try {
        const st = statSync(full);
        if (st.isDirectory() && !entry.startsWith(".") && entry !== "node_modules") {
          scan(full);
        } else if (st.isFile() && (entry.endsWith(".ts") || entry.endsWith(".tsx"))) {
          const relPath = relative(rootDir, full).replace(/\\/g, "/");
          const key = normalizePath(relPath);
          if (!idx.files[key]) {
            const analysis = analyze ? deepAnalyzeFile(relPath) : { type: "code" as const, exports: [] as string[], dependencies: [] as string[], relatedModules: [] as string[] };
            idx.files[key] = {
              path: relPath,
              type: analysis.type,
              purpose: "Auto-discovered",
              exports: analysis.exports ?? [],
              dependencies: analysis.dependencies ?? [],
              reverseDeps: [],
              relatedModules: analysis.relatedModules ?? [],
              commands: analysis.commands,
              eventsHandled: analysis.eventsHandled,
              eventsEmitted: analysis.eventsEmitted,
              configUsed: analysis.configUsed,
              interfacesImplemented: analysis.interfacesImplemented,
              lastAnalyzed: new Date().toISOString(),
              contentHash: analysis.contentHash,
            };
            added.push(relPath);
          }
        }
      } catch {
      }
    }
  };

  scan(srcDir);
  if (added.length > 0) {
    rebuildReverseDeps(idx);
    rebuildModules(idx);
    saveIndex(idx);
  }
  return added;
}

export function removeDeletedFiles(rootDir: string): string[] {
  const idx = loadKnowledgeIndex();
  const removed: string[] = [];
  for (const [path] of Object.entries(idx.files)) {
    const fullPath = join(rootDir, path);
    if (!existsSync(fullPath)) {
      delete idx.files[path];
      removed.push(path);
    }
  }
  if (removed.length > 0) {
    rebuildReverseDeps(idx);
    rebuildModules(idx);
    saveIndex(idx);
  }
  return removed;
}

export function synchronizeIndexAfterChanges(changedFiles: string[], rootDir?: string, force = false): IndexSyncReport {
  invalidateCache();
  const idx = loadKnowledgeIndex();
  const root = rootDir ?? process.cwd();
  const report: IndexSyncReport = {
    added: [],
    removed: [],
    modified: [],
    renamed: [],
    moduleChanges: [],
  };

  const srcDir = join(root, "src");
  if (!existsSync(srcDir)) return report;

  const allCurrentFiles = new Set<string>();
  const scanCurrentFilesFn = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      try {
        const st = statSync(full);
        if (st.isDirectory() && !entry.startsWith(".") && entry !== "node_modules") {
          scanCurrentFilesFn(full);
        } else if (st.isFile() && (entry.endsWith(".ts") || entry.endsWith(".tsx"))) {
          const relPath = relative(root, full).replace(/\\/g, "/");
          allCurrentFiles.add(normalizePath(relPath));
        }
      } catch {
      }
    }
  };
  scanCurrentFilesFn(srcDir);

  const existingPaths = new Set(Object.keys(idx.files));
  const forceAll = force || (changedFiles.length === 0 && Object.keys(idx.files).length === 0);

  const normalizedChanged = forceAll
    ? Array.from(allCurrentFiles)
    : changedFiles.map(normalizePath);

  for (const changed of normalizedChanged) {
    const fullPath = join(root, changed);
    const exists = existsSync(fullPath);
    const inIndex = existingPaths.has(changed);
    if (!exists && inIndex) {
      delete idx.files[changed];
      report.removed.push(changed);
    } else if (exists && !inIndex) {
      const analysis = deepAnalyzeFile(changed);
      idx.files[changed] = {
        path: changed,
        type: analysis.type,
        purpose: "Auto-discovered",
        exports: analysis.exports ?? [],
        dependencies: analysis.dependencies ?? [],
        reverseDeps: [],
        relatedModules: analysis.relatedModules ?? [],
        commands: analysis.commands,
        eventsHandled: analysis.eventsHandled,
        eventsEmitted: analysis.eventsEmitted,
        configUsed: analysis.configUsed,
        interfacesImplemented: analysis.interfacesImplemented,
        lastAnalyzed: new Date().toISOString(),
        contentHash: analysis.contentHash,
      };
      report.added.push(changed);
    } else if (exists && inIndex) {
      const oldEntry = idx.files[changed]!;
      const oldHash = oldEntry.contentHash ?? "";
      const content = readFileSync(fullPath, "utf-8");
      const newHash = createHash("md5").update(content).digest("hex");
      if (forceAll || oldHash !== newHash) {
        const analysis = deepAnalyzeFile(changed);
        idx.files[changed] = {
          ...oldEntry,
          ...analysis,
          reverseDeps: oldEntry.reverseDeps,
          path: oldEntry.path,
          purpose: oldEntry.purpose,
          lastAnalyzed: new Date().toISOString(),
        } as FileEntry;
        report.modified.push(changed);
      }
    }
  }

  for (const [path] of Object.entries(idx.files)) {
    const fullPath = join(root, path);
    if (!existsSync(fullPath)) {
      delete idx.files[path];
      if (!report.removed.includes(path)) report.removed.push(path);
    }
  }

  for (let i = report.removed.length - 1; i >= 0; i--) {
    const removedPath = report.removed[i]!;
    const similarPath = findSimilarPath(removedPath, allCurrentFiles);
    if (similarPath) {
      report.renamed.push({ from: removedPath, to: similarPath });
      report.removed.splice(i, 1);
      const addedIdx = report.added.indexOf(similarPath);
      if (addedIdx >= 0) report.added.splice(addedIdx, 1);
    }
  }

  for (const addedPath of report.added) {
    const oldModule = getModuleForFile(addedPath);
    const newModule = inferModule(addedPath);
    if (oldModule !== newModule) {
      report.moduleChanges.push({ file: addedPath, from: oldModule, to: newModule });
    }
  }

  for (const modifiedPath of report.modified) {
    const oldModule = getModuleForFile(modifiedPath);
    const newModule = inferModule(modifiedPath);
    if (oldModule !== newModule) {
      report.moduleChanges.push({ file: modifiedPath, from: oldModule, to: newModule });
    }
  }

  rebuildReverseDeps(idx);
  rebuildModules(idx);
  saveIndex(idx);
  invalidateCache();
  return report;
}

function findSimilarPath(removed: string, allFiles: Set<string>): string | null {
  const removedBase = basename(removed);
  for (const f of allFiles) {
    if (f === removed) continue;
    const fBase = basename(f);
    if (fBase === removedBase) return f;
  }
  for (const f of allFiles) {
    const cleanedRemoved = removed.replace(/\.[^.]+$/, "");
    if (f.includes(cleanedRemoved)) return f;
  }
  return null;
}

function rebuildReverseDeps(idx: KnowledgeIndex): void {
  for (const entry of Object.values(idx.files)) {
    entry.reverseDeps = [];
  }

  for (const [path, entry] of Object.entries(idx.files)) {
    for (const dep of entry.dependencies) {
      const depKey = normalizePath(dep);
      if (idx.files[depKey]) {
        if (!idx.files[depKey].reverseDeps.includes(path)) {
          idx.files[depKey].reverseDeps.push(path);
        }
      }
    }
  }
}

function rebuildModules(idx: KnowledgeIndex): void {
  const moduleMap: Record<string, string[]> = {};

  for (const [path] of Object.entries(idx.files)) {
    const module = inferModule(path);
    if (module) {
      if (!moduleMap[module]) moduleMap[module] = [];
      if (!moduleMap[module].includes(path)) moduleMap[module].push(path);
    }
  }

  for (const [, files] of Object.entries(moduleMap)) {
    files.sort();
  }

  idx.modules = {};
  for (const [name, files] of Object.entries(moduleMap)) {
    idx.modules[name] = {
      summary: `Module: ${name}`,
      files,
    };
  }
}

function inferModule(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/");
  const srcPrefix = "src/";
  const srcIdx = normalized.indexOf(srcPrefix);
  const fromSrc = srcIdx >= 0 ? normalized.slice(srcIdx + 4) : normalized;
  const parts = fromSrc.split("/");
  if (parts.length >= 2) return parts[0] + "/";
  return null;
}

function saveIndex(idx: KnowledgeIndex): void {
  idx.lastUpdated = new Date().toISOString();
  const output = {
    _note: "Auto-generated Project Knowledge Index. Update with `bun run index:update`.",
    modules: idx.modules,
    files: idx.files,
    lastUpdated: idx.lastUpdated,
  };
  writeFileSync(INDEX_FILE, JSON.stringify(output, null, 2));
}

function normalizePath(p: string): string {
  const norm = p.replace(/\\/g, "/");
  const srcPrefix = "src/";
  const srcIdx = norm.indexOf(srcPrefix);
  const stripped = srcIdx >= 0 ? norm.slice(srcIdx) : norm;
  if (stripped.startsWith("./")) return stripped.slice(2);
  return stripped;
}
