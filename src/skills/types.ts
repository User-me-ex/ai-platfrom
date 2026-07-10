/**
 * 9 Router CLI — Skills Architecture Types
 *
 * Core type definitions for the self-evolving skills system.
 */

/** Categories of skills */
export type SkillCategory =
  | "prompt"
  | "workflow"
  | "agent"
  | "processor"
  | "refactor"
  | "deploy"
  | "documentation"
  | "utility"
  | "integration"
  | "custom";

/** Required capability a skill needs from the framework */
export interface RequiredCapability {
  type: CapabilityType;
  name: string;
  description: string;
  version?: string;
  priority: "required" | "optional" | "future";
}

export type CapabilityType =
  | "command"
  | "renderer"
  | "menu"
  | "widget"
  | "tool"
  | "provider"
  | "storage"
  | "session"
  | "config"
  | "router"
  | "protocol"
  | "plugin_api"
  | "hook"
  | "event";

/** A runtime skill definition */
export interface SkillDefinition {
  id: string;
  name: string;
  version: string;
  description: string;
  category: SkillCategory;
  author?: string;
  entry: string;
  dependencies?: string[];
  requiredCapabilities?: RequiredCapability[];
  hooks?: string[];
  config?: Record<string, unknown>;
}

/** A skill loaded and ready to execute */
export interface Skill extends SkillDefinition {
  execute(context: SkillExecutionContext): Promise<SkillResult>;
}

/** Context passed to a skill during execution */
export interface SkillExecutionContext {
  args: string[];
  config: Record<string, unknown>;
  workspace: string;
  logger: Logger;
  router: RouterClient;
  session: SessionManager;
  chat: ChatEngine;
  renderer: Renderer;
  skills: SkillManager;
}

/** Result of a skill execution */
export interface SkillResult {
  success: boolean;
  output?: string;
  error?: string;
  changes?: FileChange[];
  usage?: { input: number; output: number };
}

/** A change to a file in the project */
export interface FileChange {
  path: string;
  type: "create" | "modify" | "delete" | "rename";
  reason: string;
  content?: string;
  oldPath?: string; // for rename
}

/** Implementation plan for evolving the framework */
export interface EvolutionPlan {
  id: string;
  skillId: string;
  title: string;
  description: string;
  affectedModules: string[];
  fileChanges: FileChange[];
  newFiles: string[];
  modifiedFiles: string[];
  deletedFiles: string[];
  risks: Risk[];
  dependencies: string[];
  backwardCompatible: boolean;
  rollbackStrategy: string;
  estimatedComplexity: "low" | "medium" | "high";
  requiredApproval: boolean;
}

/** A risk associated with a change */
export interface Risk {
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  mitigation: string;
}

/** Architecture snapshot — the AI's understanding of the project */
export interface ArchitectureSnapshot {
  modules: ModuleInfo[];
  dependencyGraph: DependencyEdge[];
  publicApis: ApiEndpoint[];
  pluginInterfaces: string[];
  renderingPipeline: string[];
  commandRegistry: CommandInfo[];
  eventSystem: string[];
  configSchema: Record<string, unknown>;
  fileTree: Record<string, string>;
}

export interface ModuleInfo {
  name: string;
  path: string;
  exports: string[];
  imports: string[];
  responsibilities: string[];
  files: string[];
}

export interface DependencyEdge {
  from: string;
  to: string;
  type: "import" | "extends" | "implements" | "injects";
}

export interface ApiEndpoint {
  name: string;
  module: string;
  signature: string;
  description: string;
}

export interface CommandInfo {
  name: string;
  aliases: string[];
  description: string;
  file: string;
}

/** Skill manager interface */
export interface SkillManager {
  loadSkill(definition: SkillDefinition): Promise<Skill>;
  unloadSkill(id: string): Promise<void>;
  executeSkill(id: string, context: SkillExecutionContext): Promise<SkillResult>;
  listSkills(): SkillDefinition[];
  getSkill(id: string): Skill | undefined;
  detectCapabilityGap(skill: SkillDefinition): RequiredCapability[];
  installSkill(path: string, mode: "interactive" | "autonomous"): Promise<InstallResult>;
}

export interface InstallResult {
  success: boolean;
  evolved: boolean;
  plan?: EvolutionPlan;
  changes?: FileChange[];
  report?: string;
  error?: string;
}

/** Change report for a self-editing operation */
export interface ChangeReport {
  timestamp: number;
  operation: string;
  filesCreated: string[];
  filesModified: string[];
  filesDeleted: string[];
  reasons: Record<string, string>;
  architecturalImpact: string;
  newCapabilities: string[];
  breakingChanges: string[];
  migrationSteps: string[];
}

/** Operating mode for the skills system */
export type OperationMode = "interactive" | "autonomous";

/** Safety constraints */
export interface SafetyConstraints {
  allowFileCreation: boolean;
  allowFileModification: boolean;
  allowFileDeletion: boolean;
  allowDependencyChanges: boolean;
  allowConfigChanges: boolean;
  allowedPaths: string[];
  deniedPaths: string[];
  maxFileChanges: number;
  requireGitCheckpoint: boolean;
}

import type { Logger, RouterClient, SessionManager, ChatEngine, Renderer } from "../core/types";

