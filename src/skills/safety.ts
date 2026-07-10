/**
 * 9 Router CLI — Safety Guard
 *
 * Validates that evolution plans are safe before execution.
 * Enforces safety constraints like path allowlists and change limits.
 */

import type { EvolutionPlan, FileChange, SafetyConstraints } from "./types";
import { ArchitectureInspector } from "./inspector";

export interface SafetyCheckResult {
  valid: boolean;
  reason?: string;
  warnings: string[];
}

export class SafetyGuard {
  private constraints: SafetyConstraints;

  constructor(_inspector: ArchitectureInspector) {
    this.constraints = this.getDefaultConstraints();
  }

  /** Validate an entire evolution plan */
  validatePlan(plan: EvolutionPlan): SafetyCheckResult {
    const warnings: string[] = [];

    // Check file change count
    if (plan.fileChanges.length > this.constraints.maxFileChanges) {
      return {
        valid: false,
        reason: `Too many file changes: ${plan.fileChanges.length} > max ${this.constraints.maxFileChanges}`,
        warnings,
      };
    }

    // Check each change
    for (const change of plan.fileChanges) {
      const check = this.validateChange(change);
      if (!check.valid) {
        return check;
      }
      warnings.push(...check.warnings);
    }

    // Check risks
    const criticalRisks = plan.risks.filter((r) => r.severity === "critical");
    if (criticalRisks.length > 0) {
      return {
        valid: false,
        reason: `Critical risks found: ${criticalRisks.map((r) => r.description).join("; ")}`,
        warnings,
      };
    }

    // High severity risks require warnings
    const highRisks = plan.risks.filter((r) => r.severity === "high");
    for (const risk of highRisks) {
      warnings.push(`High risk: ${risk.description}. Mitigation: ${risk.mitigation}`);
    }

    return { valid: true, warnings };
  }

  /** Validate a single file change */
  validateChange(change: FileChange): SafetyCheckResult {
    const warnings: string[] = [];

    // Check path is allowed
    if (!this.isPathAllowed(change.path)) {
      return {
        valid: false,
        reason: `Path not allowed: ${change.path}`,
        warnings,
      };
    }

    // Check path is not denied
    if (this.isPathDenied(change.path)) {
      return {
        valid: false,
        reason: `Path is denied: ${change.path}`,
        warnings,
      };
    }

    // Check change type is allowed
    if (change.type === "delete" && !this.constraints.allowFileDeletion) {
      return {
        valid: false,
        reason: "File deletion is not allowed by constraints",
        warnings,
      };
    }

    if (change.type === "create" && !this.constraints.allowFileCreation) {
      return {
        valid: false,
        reason: "File creation is not allowed by constraints",
        warnings,
      };
    }

    if (change.type === "modify" && !this.constraints.allowFileModification) {
      return {
        valid: false,
        reason: "File modification is not allowed by constraints",
        warnings,
      };
    }

    return { valid: true, warnings };
  }

  /** Check if a path is in the allowed list */
  isPathAllowed(path: string): boolean {
    return this.constraints.allowedPaths.some((allowed) => path.startsWith(allowed));
  }

  /** Check if a path is in the denied list */
  isPathDenied(path: string): boolean {
    return this.constraints.deniedPaths.some((denied) => path.startsWith(denied));
  }

  /** Update safety constraints */
  setConstraints(constraints: Partial<SafetyConstraints>): void {
    this.constraints = { ...this.constraints, ...constraints };
  }

  /** Get default safety constraints */
  private getDefaultConstraints(): SafetyConstraints {
    return {
      allowFileCreation: true,
      allowFileModification: true,
      allowFileDeletion: false, // Safety: never delete by default
      allowDependencyChanges: false,
      allowConfigChanges: true,
      allowedPaths: [
        "src/commands/",
        "src/render/",
        "src/tui/",
        "src/plugins/",
        "src/core/",
        "src/router/",
        "src/session/",
        "src/config/",
        "src/skills/",
        "src/utils/",
        "skills/",
        "docs/",
        "tests/",
      ],
      deniedPaths: [
        "node_modules/",
        ".git/",
        "dist/",
        ".env",
        "src/index.ts",  // Protect entry point
        "src/cli.ts",    // Protect main CLI loop
      ],
      maxFileChanges: 20,
      requireGitCheckpoint: true,
    };
  }
}
