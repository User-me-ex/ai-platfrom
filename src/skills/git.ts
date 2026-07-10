/**
 * 9 Router CLI — Git Integration
 *
 * Manages version control checkpoints, commits, and rollbacks
 * for self-editing operations.
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { Logger } from "../core/types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class GitManager {
  private logger: Logger;
  private projectRoot: string;
  private isGitRepo: boolean;
  private checkpointBranch: string | null = null;

  constructor(logger: Logger) {
    this.logger = logger;
    this.projectRoot = join(__dirname, "..", "..");
    this.isGitRepo = this.detectGitRepo();
  }

  /** Detect if the project is inside a git repository */
  private detectGitRepo(): boolean {
    try {
      const gitDir = join(this.projectRoot, ".git");
      return existsSync(gitDir);
    } catch {
      return false;
    }
  }

  /** Check if git is available */
  get isAvailable(): boolean {
    return this.isGitRepo;
  }

  /** Create a git checkpoint (stash or branch) before modifications */
  async createCheckpoint(_message: string): Promise<boolean> {
    if (!this.isGitRepo) {
      this.logger.warn("Not a git repository — skipping checkpoint");
      return false;
    }

    try {
      // Create a checkpoint branch
      const branchName = `checkpoint/skills-${Date.now()}`;
      execSync(`git stash push -m "pre-${branchName}"`, {
        cwd: this.projectRoot,
        stdio: "pipe",
      });
      execSync(`git checkout -b ${branchName}`, {
        cwd: this.projectRoot,
        stdio: "pipe",
      });
      execSync(`git stash pop`, {
        cwd: this.projectRoot,
        stdio: "pipe",
      });

      this.checkpointBranch = branchName;
      this.logger.info(`Git checkpoint created: ${branchName}`);
      return true;
    } catch (error) {
      this.logger.error("Failed to create git checkpoint:", error);
      return false;
    }
  }

  /** Rollback to the checkpoint */
  async rollback(): Promise<boolean> {
    if (!this.isGitRepo || !this.checkpointBranch) {
      this.logger.warn("No checkpoint to rollback to");
      return false;
    }

    try {
      execSync(`git checkout ${this.checkpointBranch}`, {
        cwd: this.projectRoot,
        stdio: "pipe",
      });
      this.logger.info(`Rolled back to checkpoint: ${this.checkpointBranch}`);
      return true;
    } catch (error) {
      this.logger.error("Failed to rollback:", error);
      return false;
    }
  }

  /** Commit the changes after successful evolution */
  async commit(message: string): Promise<boolean> {
    if (!this.isGitRepo) {
      this.logger.warn("Not a git repository — skipping commit");
      return false;
    }

    try {
      execSync(`git add -A`, { cwd: this.projectRoot, stdio: "pipe" });
      execSync(`git commit -m "${message}"`, {
        cwd: this.projectRoot,
        stdio: "pipe",
      });

      // Clean up checkpoint branch
      if (this.checkpointBranch) {
        execSync(`git branch -D ${this.checkpointBranch}`, {
          cwd: this.projectRoot,
          stdio: "pipe",
        });
        this.checkpointBranch = null;
      }

      this.logger.info(`Changes committed: ${message}`);
      return true;
    } catch (error) {
      this.logger.error("Failed to commit changes:", error);
      return false;
    }
  }

  /** Get the current git status */
  getStatus(): string {
    if (!this.isGitRepo) return "Not a git repository";

    try {
      return execSync("git status --short", {
        cwd: this.projectRoot,
        encoding: "utf-8",
      });
    } catch {
      return "Failed to get git status";
    }
  }
}
