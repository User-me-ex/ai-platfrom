/**
 * 9 Router CLI — Change Reporter
 *
 * Generates detailed, human-readable change reports for every
 * self-editing operation.
 */

import type { EvolutionPlan, FileChange, ChangeReport } from "./types";

export class ChangeReporter {
  /** Generate a structured change report */
  generateReport(
    operation: string,
    plan: EvolutionPlan,
    appliedChanges: FileChange[]
  ): ChangeReport {
    const filesCreated = appliedChanges
      .filter((c) => c.type === "create")
      .map((c) => c.path);

    const filesModified = appliedChanges
      .filter((c) => c.type === "modify")
      .map((c) => c.path);

    const filesDeleted = appliedChanges
      .filter((c) => c.type === "delete")
      .map((c) => c.path);

    const reasons: Record<string, string> = {};
    for (const change of appliedChanges) {
      reasons[change.path] = change.reason;
    }

    return {
      timestamp: Date.now(),
      operation,
      filesCreated,
      filesModified,
      filesDeleted,
      reasons,
      architecturalImpact: this.assessArchitecturalImpact(plan),
      newCapabilities: this.extractNewCapabilities(appliedChanges),
      breakingChanges: this.assessBreakingChanges(plan),
      migrationSteps: this.generateMigrationSteps(plan),
    };
  }

  /** Format a change report as a human-readable string */
  formatReport(report: ChangeReport): string {
    const lines: string[] = [];
    const date = new Date(report.timestamp).toISOString();

    lines.push("=".repeat(60));
    lines.push(`  CHANGE REPORT — ${report.operation}`);
    lines.push(`  ${date}`);
    lines.push("=".repeat(60));
    lines.push("");

    // Files created
    if (report.filesCreated.length > 0) {
      lines.push("📁 Files Created:");
      for (const file of report.filesCreated) {
        lines.push(`   + ${file}`);
        lines.push(`     → ${report.reasons[file] ?? "No reason provided"}`);
      }
      lines.push("");
    }

    // Files modified
    if (report.filesModified.length > 0) {
      lines.push("✏️  Files Modified:");
      for (const file of report.filesModified) {
        lines.push(`   ~ ${file}`);
        lines.push(`     → ${report.reasons[file] ?? "No reason provided"}`);
      }
      lines.push("");
    }

    // Files deleted
    if (report.filesDeleted.length > 0) {
      lines.push("🗑️  Files Deleted:");
      for (const file of report.filesDeleted) {
        lines.push(`   - ${file}`);
        lines.push(`     → ${report.reasons[file] ?? "No reason provided"}`);
      }
      lines.push("");
    }

    // Architectural impact
    lines.push("🏗️  Architectural Impact:");
    lines.push(`   ${report.architecturalImpact}`);
    lines.push("");

    // New capabilities
    if (report.newCapabilities.length > 0) {
      lines.push("✨ New Capabilities:");
      for (const cap of report.newCapabilities) {
        lines.push(`   • ${cap}`);
      }
      lines.push("");
    }

    // Breaking changes
    if (report.breakingChanges.length > 0) {
      lines.push("⚠️  Breaking Changes:");
      for (const change of report.breakingChanges) {
        lines.push(`   • ${change}`);
      }
      lines.push("");
    }

    // Migration steps
    if (report.migrationSteps.length > 0) {
      lines.push("📋 Migration Steps:");
      for (const step of report.migrationSteps) {
        lines.push(`   • ${step}`);
      }
      lines.push("");
    }

    lines.push("=".repeat(60));

    return lines.join("\n");
  }

  /** Assess the architectural impact of the changes */
  private assessArchitecturalImpact(plan: EvolutionPlan): string {
    const parts: string[] = [];

    if (plan.affectedModules.length > 0) {
      parts.push(`Affected modules: ${plan.affectedModules.join(", ")}`);
    }

    if (!plan.backwardCompatible) {
      parts.push("⚠️ Changes are NOT backward compatible");
    }

    parts.push(`Estimated complexity: ${plan.estimatedComplexity}`);
    parts.push(`Rollback available via: ${plan.rollbackStrategy}`);

    return parts.join("\n       ");
  }

  /** Extract new capabilities added by the changes */
  private extractNewCapabilities(changes: FileChange[]): string[] {
    const capabilities: string[] = [];

    for (const change of changes) {
      if (change.type === "create" && change.path.startsWith("src/commands/")) {
        const name = change.path.replace("src/commands/", "").replace(".ts", "");
        capabilities.push(`New command: /${name}`);
      } else if (change.type === "create" && change.path.startsWith("src/render/")) {
        const name = change.path.replace("src/render/", "").replace(".ts", "");
        capabilities.push(`New renderer: ${name}`);
      } else if (change.type === "create" && change.path.startsWith("src/plugins/")) {
        const name = change.path.replace("src/plugins/", "").replace(".ts", "");
        capabilities.push(`New plugin API: ${name}`);
      }
    }

    return capabilities;
  }

  /** Assess breaking changes */
  private assessBreakingChanges(plan: EvolutionPlan): string[] {
    if (!plan.backwardCompatible) {
      return ["Framework schema/API changes — plugins may need updates"];
    }
    return [];
  }

  /** Generate migration steps for users */
  private generateMigrationSteps(plan: EvolutionPlan): string[] {
    const steps: string[] = [];

    if (!plan.backwardCompatible) {
      steps.push("Run `npm run build` to rebuild the CLI");
      steps.push("Update any custom plugins to match new APIs");
      steps.push("Test all existing functionality before deploying");
    } else {
      steps.push("No migration steps required (backward compatible)");
    }

    steps.push(`To rollback, run: ${plan.rollbackStrategy}`);

    return steps;
  }
}
