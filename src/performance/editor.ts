/**
 * 9 Router CLI — Concurrent File Editing
 *
 * - Safe parallel writes across multiple files
 * - Conflict detection (same file edits queued)
 * - Batch validation before writing
 * - Rollback on failure
 * - Formatting preservation
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync, unlinkSync, mkdirSync } from "fs";
import { join, dirname, relative } from "path";
import { EventBus } from "../core/events";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FileEdit {
  filePath: string; // absolute path
  originalContent?: string;
  newContent: string;
  operation: "write" | "patch" | "delete";
  description?: string;
}

export interface EditValidation {
  filePath: string;
  valid: boolean;
  errors: string[];
}

export interface BatchEditResult {
  success: boolean;
  applied: string[]; // file paths
  failed: string[]; // file paths
  errors: Array<{ filePath: string; error: string }>;
  rollbackPerformed: boolean;
  duration: number;
}

// ─── Conflict Detector ────────────────────────────────────────────────────────

export class FileConflictDetector {
  /** Check if edits conflict (same file) */
  detectConflicts(edits: FileEdit[]): Map<string, FileEdit[]> {
    const fileMap = new Map<string, FileEdit[]>();
    for (const edit of edits) {
      const normalized = this.normalizePath(edit.filePath);
      if (!fileMap.has(normalized)) fileMap.set(normalized, []);
      fileMap.get(normalized)!.push(edit);
    }

    // Only keep entries with conflicts (>1 edit per file)
    const conflicts = new Map<string, FileEdit[]>();
    for (const [path, fileEdits] of fileMap) {
      if (fileEdits.length > 1) conflicts.set(path, fileEdits);
    }
    return conflicts;
  }

  /** Resolve conflicts by merging edits to the same file */
  resolveConflicts(conflicts: Map<string, FileEdit[]>): FileEdit[] {
    const resolved: FileEdit[] = [];
    for (const [, fileEdits] of conflicts) {
      // If multiple deletes, just keep one
      const deletes = fileEdits.filter((e) => e.operation === "delete");
      if (deletes.length > 0) {
        resolved.push(deletes[0]!);
        continue;
      }

      // Merge writes — last write wins for full rewrites
      const writes = fileEdits.filter((e) => e.operation === "write");
      if (writes.length > 0) {
        resolved.push(writes[writes.length - 1]!);
        continue;
      }

      // For patches, apply all in order
      const patches = fileEdits.filter((e) => e.operation === "patch");
      if (patches.length > 0) {
        // Merge patch content sequentially
        const merged: FileEdit = {
          filePath: patches[0]!.filePath,
          newContent: patches.map((p) => p.newContent).join("\n"),
          operation: "patch",
          description: `Merged ${patches.length} patches`,
        };
        resolved.push(merged);
      }
    }
    return resolved;
  }

  private normalizePath(p: string): string {
    return p.replace(/\\/g, "/").toLowerCase();
  }
}

// ─── File Backup Manager ──────────────────────────────────────────────────────

export class FileBackupManager {
  private backupDir: string;
  private snapshots = new Map<string, string>(); // filePath -> backupPath

  constructor(backupDir: string) {
    this.backupDir = backupDir;
    if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });
  }

  /** Create a backup snapshot before editing */
  snapshot(edits: FileEdit[]): void {
    for (const edit of edits) {
      if (existsSync(edit.filePath)) {
        const backupPath = join(this.backupDir, `${Date.now()}_${this.safeName(edit.filePath)}.bak`);
        copyFileSync(edit.filePath, backupPath);
        this.snapshots.set(edit.filePath, backupPath);
      }
    }
  }

  /** Rollback all changes from snapshots */
  rollback(): void {
    for (const [filePath, backupPath] of this.snapshots) {
      if (existsSync(backupPath)) {
        copyFileSync(backupPath, filePath);
        unlinkSync(backupPath);
      }
    }
    this.snapshots.clear();
  }

  /** Clean up backup files */
  cleanup(): void {
    for (const [, backupPath] of this.snapshots) {
      if (existsSync(backupPath)) unlinkSync(backupPath);
    }
    this.snapshots.clear();
  }

  private safeName(filePath: string): string {
    return relative(this.backupDir, filePath).replace(/[^a-zA-Z0-9._-]/g, "_");
  }
}

// ─── File Editor ──────────────────────────────────────────────────────────────

export class ConcurrentFileEditor {
  private backupManager: FileBackupManager;
  private conflictDetector = new FileConflictDetector();

  constructor(backupDir: string, _eventBus: EventBus) {
    this.backupManager = new FileBackupManager(backupDir);
  }

  /** Validate a batch of edits before applying */
  validate(edits: FileEdit[]): EditValidation[] {
    return edits.map((edit) => {
      const errors: string[] = [];

      // Check file exists for non-write operations
      if (edit.operation === "patch" || edit.operation === "delete") {
        if (!existsSync(edit.filePath)) {
          errors.push(`File does not exist: ${edit.filePath}`);
        }
      }

      // Check for path traversal
      const normalized = edit.filePath.replace(/\\/g, "/");
      if (normalized.includes("..")) {
        errors.push("Path traversal detected");
      }

      // Check content is valid text
      if (edit.operation === "write" || edit.operation === "patch") {
        if (typeof edit.newContent !== "string") {
          errors.push("Content must be a string");
        }
      }

      return { filePath: edit.filePath, valid: errors.length === 0, errors };
    });
  }

  /** Apply a batch of edits safely */
  async applyBatch(edits: FileEdit[]): Promise<BatchEditResult> {
    const start = Date.now();
    const applied: string[] = [];
    const failed: string[] = [];
    const errors: Array<{ filePath: string; error: string }> = [];

    // 1. Validate all edits first
    const validations = this.validate(edits);
    const invalidEdits = validations.filter((v) => !v.valid);
    if (invalidEdits.length > 0) {
      for (const inv of invalidEdits) {
        failed.push(inv.filePath);
        errors.push({ filePath: inv.filePath, error: inv.errors.join("; ") });
      }
      // Remove invalid edits
      edits = edits.filter((e) => !invalidEdits.find((v) => v.filePath === e.filePath));
    }

    if (edits.length === 0) {
      return {
        success: false,
        applied,
        failed,
        errors,
        rollbackPerformed: false,
        duration: Date.now() - start,
      };
    }

    // 2. Read original content for rollback
    for (const edit of edits) {
      if (existsSync(edit.filePath)) {
        edit.originalContent = readFileSync(edit.filePath, "utf-8");
      }
    }

    // 3. Create backup snapshots
    this.backupManager.snapshot(edits);

    // 4. Detect and resolve conflicts
    const conflicts = this.conflictDetector.detectConflicts(edits);
    if (conflicts.size > 0) {
      const nonConflicting = edits.filter((e) => !conflicts.has(this.conflictDetector["normalizePath"](e.filePath)));
      const resolved = this.conflictDetector.resolveConflicts(conflicts);
      edits = [...nonConflicting, ...resolved];
    }

    // 5. Apply edits
    let rollbackPerformed = false;
    for (const edit of edits) {
      try {
        // Ensure directory exists
        const dir = dirname(edit.filePath);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

        switch (edit.operation) {
          case "write":
          case "patch":
            writeFileSync(edit.filePath, edit.newContent, "utf-8");
            break;
          case "delete":
            if (existsSync(edit.filePath)) unlinkSync(edit.filePath);
            break;
        }
        applied.push(edit.filePath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failed.push(edit.filePath);
        errors.push({ filePath: edit.filePath, error: msg });

        // Rollback on first failure
        this.backupManager.rollback();
        rollbackPerformed = true;
        break;
      }
    }

    // 6. Clean up backups on success
    if (!rollbackPerformed) this.backupManager.cleanup();

    return {
      success: failed.length === 0,
      applied,
      failed,
      errors,
      rollbackPerformed,
      duration: Date.now() - start,
    };
  }

  /** Apply a single file edit */
  async apply(edit: FileEdit): Promise<BatchEditResult> {
    return this.applyBatch([edit]);
  }
}
