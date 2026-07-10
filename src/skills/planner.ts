/**
 * 9 Router CLI — Evolution Planner
 *
 * Generates detailed implementation plans for evolving the framework
 * to support new skill capabilities.
 */

import type {
  EvolutionPlan,
  RequiredCapability,
  SkillDefinition,
  FileChange,
  Risk,
  ArchitectureSnapshot,
} from "./types";
import { ArchitectureInspector } from "./inspector";

export class EvolutionPlanner {
  private inspector: ArchitectureInspector;

  constructor(inspector: ArchitectureInspector) {
    this.inspector = inspector;
  }

  /** Generate a complete implementation plan for a skill */
  async generatePlan(
    skill: SkillDefinition,
    gaps: RequiredCapability[],
    mode: "interactive" | "autonomous"
  ): Promise<EvolutionPlan> {
    const snapshot = await this.inspector.getSnapshot();
    const changes: FileChange[] = [];
    const risks: Risk[] = [];
    const affectedModules: string[] = [];
    let backwardCompatible = true;

    for (const gap of gaps) {
      const plan = await this.planCapability(gap, skill, snapshot);
      changes.push(...plan.changes);
      risks.push(...plan.risks);
      affectedModules.push(...plan.affectedModules);
      if (!plan.backwardCompatible) backwardCompatible = false;
    }

    // Add the skill itself
    const skillFileChange = this.createSkillFileChange(skill);
    changes.push(skillFileChange);

    // Add registration/activation changes
    const registrationChanges = this.planRegistration(skill, snapshot);
    changes.push(...registrationChanges);

    const newFiles = changes.filter((c) => c.type === "create").map((c) => c.path);
    const modifiedFiles = changes.filter((c) => c.type === "modify").map((c) => c.path);
    const deletedFiles = changes.filter((c) => c.type === "delete").map((c) => c.path);

    // Assess risks
    if (modifiedFiles.some((f) => f.includes("core"))) {
      risks.push({
        description: "Core module modification — may affect all other modules",
        severity: "high",
        mitigation: "Ensure thorough testing and maintain backward compatibility",
      });
    }

    const plan: EvolutionPlan = {
      id: `plan_${Date.now()}`,
      skillId: skill.id,
      title: `Evolve framework for skill: ${skill.name}`,
      description: `The skill "${skill.name}" requires ${gaps.length} new capabilities that don't exist in the current framework: ${gaps.map((g) => `${g.type}/${g.name}`).join(", ")}`,
      affectedModules: [...new Set(affectedModules)],
      fileChanges: changes,
      newFiles,
      modifiedFiles,
      deletedFiles,
      risks,
      dependencies: skill.dependencies ?? [],
      backwardCompatible,
      rollbackStrategy: this.generateRollbackStrategy(changes),
      estimatedComplexity: this.estimateComplexity(changes),
      requiredApproval: mode === "interactive",
    };

    return plan;
  }

  /** Plan changes needed for a single capability gap */
  private async planCapability(
    gap: RequiredCapability,
    skill: SkillDefinition,
    _snapshot: ArchitectureSnapshot
  ): Promise<{
    changes: FileChange[];
    risks: Risk[];
    affectedModules: string[];
    backwardCompatible: boolean;
  }> {
    const changes: FileChange[] = [];
    const risks: Risk[] = [];
    const affectedModules: string[] = [];
    let backwardCompatible = true;

    // Find the extension point for this capability type
    this.inspector.findExtensionPoint(gap.type);

    switch (gap.type) {
      case "command":
        changes.push({
          path: `src/commands/${gap.name}.ts`,
          type: "create",
          reason: `New command /${gap.name} required by skill "${skill.name}"`,
          content: this.generateCommandStub(gap, skill),
        });
        changes.push({
          path: "src/commands/commands.ts",
          type: "modify",
          reason: `Register new /${gap.name} command for skill "${skill.name}"`,
        });
        affectedModules.push("commands");
        break;

      case "renderer":
        changes.push({
          path: `src/render/${gap.name}.ts`,
          type: "create",
          reason: `New renderer "${gap.name}" required by skill "${skill.name}"`,
        });
        changes.push({
          path: "src/render/index.ts",
          type: "modify",
          reason: `Register new renderer "${gap.name}" for skill "${skill.name}"`,
        });
        affectedModules.push("render");
        break;

      case "config":
        changes.push({
          path: "src/core/types.ts",
          type: "modify",
          reason: `Add config schema for "${gap.name}" required by skill "${skill.name}"`,
        });
        affectedModules.push("core");
        break;

      case "event":
        changes.push({
          path: "src/core/events.ts",
          type: "modify",
          reason: `Add new event "${gap.name}" for skill "${skill.name}"`,
        });
        affectedModules.push("core");
        break;

      case "router":
        changes.push({
          path: "src/router/client.ts",
          type: "modify",
          reason: `Extend router with "${gap.name}" capability for skill "${skill.name}"`,
        });
        affectedModules.push("router");
        break;

      case "storage":
        changes.push({
          path: "src/session/manager.ts",
          type: "modify",
          reason: `Extend storage layer with "${gap.name}" for skill "${skill.name}"`,
        });
        affectedModules.push("session");
        break;

      case "plugin_api":
        changes.push({
          path: "src/plugins/api.ts",
          type: "create",
          reason: `New plugin API "${gap.name}" required by skill "${skill.name}"`,
        });
        changes.push({
          path: "src/core/types.ts",
          type: "modify",
          reason: `Add plugin API types for "${gap.name}"`,
        });
        affectedModules.push("plugins", "core");
        break;

      case "hook":
        changes.push({
          path: "src/core/types.ts",
          type: "modify",
          reason: `Add new hook type "${gap.name}" for skill "${skill.name}"`,
        });
        backwardCompatible = false;
        affectedModules.push("core", "plugins");
        break;

      default:
        risks.push({
          description: `Unknown capability type "${gap.type}" — manual implementation required`,
          severity: "high",
          mitigation: "Implement the capability manually or choose a different approach",
        });
    }

    return { changes, risks, affectedModules, backwardCompatible };
  }

  /** Plan how the skill itself gets registered in the framework */
  private planRegistration(
    skill: SkillDefinition,
    _snapshot: ArchitectureSnapshot
  ): FileChange[] {
    const changes: FileChange[] = [];

    if (skill.entry) {
      changes.push({
        path: `skills/${skill.id}/package.json`,
        type: "create",
        reason: `Plugin manifest for skill "${skill.name}"`,
      });
    }

    return changes;
  }

  /** Generate a command stub for a new command */
  private generateCommandStub(gap: RequiredCapability, skill: SkillDefinition): string {
    return `/**
 * 9 Router CLI — Auto-generated command
 * 
 * Required by skill: "${skill.name}" (${skill.id} v${skill.version})
 * Capability: ${gap.type}/${gap.name}
 * 
 * ${gap.description}
 */

import chalk from "chalk";
import type { Command } from "../core/types";

export const ${gap.name}Command: Command = {
  name: "${gap.name}",
  description: "${gap.description}",
  usage: "/${gap.name} [args]",
  async execute(args, ctx) {
    console.log(chalk.cyan("/${gap.name} command — placeholder"));
    console.log(chalk.dim("  Required by skill: ${skill.name}"));
    console.log(chalk.dim("  Implement the skill logic here."));
  },
};
`;
  }

  /** Generate rollback strategy describing how to undo changes */
  private generateRollbackStrategy(changes: FileChange[]): string {
    const steps: string[] = [];

    for (const change of changes) {
      switch (change.type) {
        case "create":
          steps.push(`Delete file: ${change.path}`);
          break;
        case "modify":
          steps.push(`Revert changes to: ${change.path} (use git checkout ${change.path})`);
          break;
        case "delete":
          steps.push(`Restore file: ${change.path} (recover from git history)`);
          break;
        case "rename":
          steps.push(`Revert rename: ${change.oldPath ?? change.path} ← ${change.path}`);
          break;
      }
    }

    steps.push("Run: git reset HEAD .");
    steps.push("Run: git checkout .");

    return `Rollback strategy:\n${steps.map((s) => `  ${s}`).join("\n")}`;
  }

  /** Create the skill file change entry */
  private createSkillFileChange(skill: SkillDefinition): FileChange {
    return {
      path: `skills/${skill.id}/index.ts`,
      type: "create",
      reason: `Skill "${skill.name}" implementation`,
    };
  }

  /** Estimate complexity based on number and type of changes */
  private estimateComplexity(changes: FileChange[]): "low" | "medium" | "high" {
    const hasCoreChanges = changes.some((c) => c.path.includes("core/"));
    const changeCount = changes.length;

    if (hasCoreChanges || changeCount > 5) return "high";
    if (changeCount > 2) return "medium";
    return "low";
  }
}
