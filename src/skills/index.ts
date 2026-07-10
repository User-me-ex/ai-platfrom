/**
 * 9 Router CLI — Skills Module
 *
 * Barrel export for the self-evolving skills architecture.
 */

export { SkillEngine } from "./engine";
export type { SkillManager } from "./types";
export type {
  SkillDefinition,
  Skill,
  SkillExecutionContext,
  SkillResult,
  EvolutionPlan,
  FileChange,
  RequiredCapability,
  CapabilityType,
  SkillCategory,
  InstallResult,
  ChangeReport,
  OperationMode,
} from "./types";
export { ArchitectureInspector } from "./inspector";
export { EvolutionPlanner } from "./planner";
export { FrameworkEvolver } from "./evolver";
export { SafetyGuard } from "./safety";
export { ChangeReporter } from "./reporter";
export { GitManager } from "./git";
export { SkillInstaller } from "./installer";
export { DocAutomator } from "./docs";
