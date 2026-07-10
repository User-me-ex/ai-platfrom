# 9 Router CLI — Agent Workflow

## Core Principle: Automatic Index Synchronization

The Project Knowledge Index (`src/.knowledge-index/files/index.json`) is the AI's primary architectural reference. **It must always be accurate.** The AI must update it automatically after every change — no manual steps, no exceptions.

After any modification (create, edit, delete, rename, move, refactor), call `synchronizeIndexAfterChanges()` from `src/intelligence/knowledge-index.ts` with the list of changed file paths.

---

## Before Editing Code

1. **Read the Knowledge Index** — understand module architecture, dependencies, exports, purpose.
2. **Identify affected modules** — use `getAffectedFiles()` to find what depends on changed files.
3. **Read only relevant files** — do not scan the entire repository unless the index is missing or outdated.
4. **Generate an implementation plan** — list files to modify, expected changes, dependencies.
5. **Apply changes** — modify minimal set of files.

## After Editing Code

1. **Call `synchronizeIndexAfterChanges(changedPaths)`** — incrementally re-analyzes only changed files:
   - Deep-parses exports, imports, commands, events, config usage, interfaces
   - Detects new files, deleted files, renames, module moves
   - Rebuilds reverse dependencies and module membership
   - Returns a detailed `IndexSyncReport`
2. **If `synchronizeIndexAfterChanges` found stale or missing entries**, call it again with the paths it reported.
3. **Run `bun x tsc --noEmit`** — verify no type errors introduced.

## When to Rebuild the Entire Index

- After a merge or rebase
- If the index is missing, corrupted, or clearly stale
- Run: `bun run index:update --full-rebuild`

---

## Project Knowledge Index

Location: `src/.knowledge-index/`
- `project-meta.json` — project-level metadata, dependency graph, performance targets
- `files/index.json` — per-file metadata: exports, dependencies, purpose, events, config, commands

Scripts:
- `bun run index:update` — scan for new/deleted files, refresh metadata
- `bun run index:update --full-rebuild` — regenerate the entire index from scratch
- `bun run index:watch` — start file watcher for automatic updates

API (`src/intelligence/knowledge-index.ts`):
- `loadKnowledgeIndex()` — load the full index
- `getFileMeta(path)` — get metadata for a single file
- `getFilesByModule(module)` — list all files in a module
- `findFilesByExport(name)` — find files exporting a symbol
- `findFilesByDependency(dep)` — find files depending on a module
- `getAffectedFiles(paths)` — determine which files are affected by changes
- `getModuleForFile(path)` — get module name for a file
- `scanNewFiles(rootDir)` — auto-discover new files
- `removeDeletedFiles(rootDir)` — clean up removed files from index
- `deepAnalyzeFile(path)` — full static analysis of a single file
- **`synchronizeIndexAfterChanges(paths)`** — **primary sync function; call after every edit**
- `refreshIndexEntry(path, updates)` — partial update of a single entry
- `invalidateCache()` — clear in-memory cache

---

## CLI Discovery

Location: `src/discovery/`
- `engine.ts` — `CliDiscoveryEngine` scans for AI CLIs on the machine
- Discovers via: user paths, workspace directories, common install locations, PATH
- Analyzes: Node.js (package.json), Python (pyproject.toml), Rust (Cargo.toml), Go (go.mod)
- Produces: `DiscoveredCli` with identity, architecture, commands, plugin system, capabilities

Run: `bun run discover`
Run with JSON output: `bun run src/discovery/cli.ts --json`

---

## TUI Research

Location: `src/tui/research-summary.ts`
Documents findings from Bubble Tea, Lip Gloss, Bubbles, Ink, OpenCode, Gemini CLI, Aider.

Key recommendation: **Adopt Ink** for 9 Router CLI TUI — already TypeScript/Bun stack, Flexbox layout via Yoga, React component model.

---

## Architecture Rules

- No circular dependencies between modules
- `commands/` can access all subsystems
- `router/` depends only on `config/` and `core/`
- `render/` is standalone (only `core/` and `utils/terminal.ts`)
- `plugins/` depends on `core/` and `config/`
- `session/` depends on `config/` (storage path)
