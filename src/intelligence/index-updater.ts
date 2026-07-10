import { watch, existsSync, writeFileSync, FSWatcher } from "fs";
import { join, resolve, relative } from "path";
import {
  synchronizeIndexAfterChanges,
} from "./knowledge-index";

const PROJECT_ROOT = resolve(join(__dirname, "..", ".."));
const SRC_DIR = join(PROJECT_ROOT, "src");

export function runIndexSync(): { added: string[]; removed: string[]; modified: string[]; total: number } {
  console.log("[index] Syncing project knowledge index...");
  const result = synchronizeIndexAfterChanges([], PROJECT_ROOT);
  console.log(
    `[index] Added: ${result.added.length}, Removed: ${result.removed.length}, ` +
    `Modified: ${result.modified.length}, Renamed: ${result.renamed.length}`
  );
  if (result.moduleChanges.length > 0) {
    for (const mc of result.moduleChanges) {
      console.log(`[index] Module change: ${mc.file} (${mc.from ?? "new"} -> ${mc.to ?? "removed"})`);
    }
  }
  writeFileSync(
    join(PROJECT_ROOT, "src", ".knowledge-index", "sync-result.json"),
    JSON.stringify({ timestamp: new Date().toISOString(), ...result }, null, 2)
  );
  return {
    added: result.added,
    removed: result.removed,
    modified: result.modified,
    total: result.added.length + result.removed.length + result.modified.length,
  };
}

export function startFileWatcher(): () => void {
  console.log("[index] Starting file watcher...");
  if (!existsSync(SRC_DIR)) return () => {};

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let changeQueue = new Set<string>();

  function flushChanges() {
    if (changeQueue.size === 0) return;
    const files = Array.from(changeQueue);
    changeQueue.clear();
    const result = synchronizeIndexAfterChanges(files, PROJECT_ROOT);
    if (result.added.length > 0 || result.removed.length > 0 || result.modified.length > 0) {
      console.log(
        `[index] Auto-sync: +${result.added.length} -${result.removed.length} ~${result.modified.length}` +
        (result.renamed.length > 0 ? ` mv${result.renamed.length}` : "")
      );
    }
  }

  let watcher: FSWatcher;
  try {
    watcher = watch(SRC_DIR, { recursive: true }, (_eventType, filename) => {
      if (!filename) return;
      if (!filename.endsWith(".ts") && !filename.endsWith(".tsx") && !filename.endsWith(".json")) return;
      const relPath = relative(PROJECT_ROOT, join(SRC_DIR, filename)).replace(/\\/g, "/");
      changeQueue.add(relPath);
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(flushChanges, 1500);
    });
  } catch (err) {
    console.error("[index] Failed to start watcher:", err);
    const pollingTimer = setInterval(() => {
      const result = synchronizeIndexAfterChanges([], PROJECT_ROOT);
      if (result.added.length > 0 || result.removed.length > 0 || result.modified.length > 0) {
        console.log(`[index] Poll sync: +${result.added.length} -${result.removed.length} ~${result.modified.length}`);
      }
    }, 30000);
    return () => clearInterval(pollingTimer);
  }

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    watcher.close();
  };
}

const isMain = process.argv[1]?.includes("index-updater");
if (isMain) {
  if (process.argv.includes("--watch")) {
    console.log("[index] Watching for file changes...");
    startFileWatcher();
  } else if (process.argv.includes("--full-rebuild")) {
    console.log("[index] Full index rebuild...");
    const fullResult = synchronizeIndexAfterChanges([], PROJECT_ROOT, true);
    const totalCount = fullResult.added.length + fullResult.removed.length + fullResult.modified.length;
    console.log(`[index] Rebuild complete. ${totalCount} changes.`);
  } else {
    const result = runIndexSync();
    console.log(`[index] Complete. ${result.total} changes.`);
  }
}
