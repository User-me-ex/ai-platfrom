/**
 * 9 Router CLI — Skill Engine
 *
 * Loads, validates, and executes runtime skills.
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { join, extname } from "path";
import type {
  SkillDefinition,
  Skill,
  SkillExecutionContext,
  SkillResult,
  SkillManager,
  InstallResult,
  RequiredCapability,
  SkillCategory,
} from "./types";
import { ArchitectureInspector } from "./inspector";
import type { Logger } from "../core/types";

export class SkillEngine implements SkillManager {
  private skills: Map<string, Skill> = new Map();
  private definitions: Map<string, SkillDefinition> = new Map();
  private inspector: ArchitectureInspector;
  private logger: Logger;

  constructor(logger: Logger) {
    this.inspector = new ArchitectureInspector();
    this.logger = logger;
  }

  /** Auto-discover skills in a directory and load them */
  async discoverSkills(skillsDir: string): Promise<number> {
    if (!existsSync(skillsDir)) return 0;
    let loaded = 0;
    const files = readdirSync(skillsDir).filter((f) => f.endsWith(".skill"));
    for (const file of files) {
      const fullPath = join(skillsDir, file);
      const def = this.parseSkillFile(fullPath);
      if (def) {
        try {
          await this.loadSkill(def);
          loaded++;
          this.logger.info(`Loaded skill: ${def.name} (${def.id})`);
        } catch { /* skip invalid */ }
      }
    }
    return loaded;
  }

  /** Load a skill from its definition */
  async loadSkill(definition: SkillDefinition): Promise<Skill> {
    this.definitions.set(definition.id, definition);

    const skill: Skill = {
      ...definition,
      execute: async (context: SkillExecutionContext): Promise<SkillResult> => {
        // Check capability gaps before execution
        const gaps = this.detectCapabilityGap(definition);
        if (gaps.length > 0) {
          return {
            success: false,
            error: `Skill requires ${gaps.length} missing capabilities. Use /evolve to install with framework evolution.`,
          };
        }

        try {
          const result = await this.executeSkillModule(definition, context);
          return result;
        } catch (error) {
          return {
            success: false,
            error: `Skill execution failed: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    };

    this.skills.set(definition.id, skill);
    return skill;
  }

  /** Unload a skill */
  async unloadSkill(id: string): Promise<void> {
    this.skills.delete(id);
    this.definitions.delete(id);
  }

  /** Execute a skill by ID */
  async executeSkill(id: string, context: SkillExecutionContext): Promise<SkillResult> {
    const skill = this.skills.get(id);
    if (!skill) {
      return { success: false, error: `Skill "${id}" not found` };
    }
    return skill.execute(context);
  }

  /** List all loaded skill definitions */
  listSkills(): SkillDefinition[] {
    return [...this.definitions.values()];
  }

  /** Get a loaded skill by ID */
  getSkill(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  /** Detect capability gaps between a skill and the current framework */
  detectCapabilityGap(skill: SkillDefinition): RequiredCapability[] {
    const gaps: RequiredCapability[] = [];

    if (!skill.requiredCapabilities) return gaps;

    for (const cap of skill.requiredCapabilities) {
      if (cap.priority === "future") continue;

      const exists = this.inspector.capabilityExists(cap.type, cap.name);
      if (!exists) {
        gaps.push(cap);
      }
    }

    return gaps;
  }

  /** Full installation pipeline: delegates to SkillInstaller */
  async installSkill(path: string, mode: "interactive" | "autonomous"): Promise<InstallResult> {
    const { SkillInstaller } = await import("./installer");
    const installer = new SkillInstaller(this, this.logger);
    return installer.install(path, mode);
  }
  /** Analyze a skill file to extract its definition */
  async analyzeSkillFile(path: string): Promise<SkillDefinition | null> {
    try {
      const fullPath = join(process.cwd(), path);
      if (!existsSync(fullPath)) {
        // Check if it's a directory with package.json
        const pkgPath = join(fullPath, "package.json");
        if (existsSync(pkgPath)) {
          const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
          return this.parseSkillManifest(pkg, fullPath);
        }

        // Check if it's a .skill file
        if (path.endsWith(".skill")) {
          return this.parseSkillFile(fullPath);
        }

        return null;
      }

      // Read the file and parse
      const content = readFileSync(fullPath, "utf-8");
      return this.parseSkillScript(content, fullPath);
    } catch (error) {
      this.logger.error("Failed to analyze skill file:", error);
      return null;
    }
  }

  /** Parse a package.json manifest for a skill */
  private parseSkillManifest(pkg: Record<string, unknown>, _basePath: string): SkillDefinition {
    const skillMeta = (pkg["9router-skill"] ?? pkg["9r-skill"] ?? {}) as Record<string, unknown>;
    return {
      id: (skillMeta.id as string) ?? (pkg.name as string) ?? "unknown",
      name: (skillMeta.name as string) ?? (pkg.name as string) ?? "Unnamed Skill",
      version: (skillMeta.version as string) ?? (pkg.version as string) ?? "0.1.0",
      description: (skillMeta.description as string) ?? (pkg.description as string) ?? "",
      category: (skillMeta.category as SkillCategory) ?? "utility",
      entry: (skillMeta.entry as string) ?? "index.js",
      dependencies: (skillMeta.dependencies as string[]) ?? [],
      requiredCapabilities: (skillMeta.requiredCapabilities as RequiredCapability[]) ?? [],
      hooks: (skillMeta.hooks as string[]) ?? [],
      config: (skillMeta.config as Record<string, unknown>) ?? {},
    };
  }

  /** Parse a .skill file */
  private parseSkillFile(path: string): SkillDefinition | null {
    try {
      const content = readFileSync(path, "utf-8");
      const meta = JSON.parse(content);
      return {
        id: meta.id ?? "skill_" + Date.now(),
        name: meta.name ?? path.split("/").pop()?.replace(".skill", "") ?? "Unnamed",
        version: meta.version ?? "0.1.0",
        description: meta.description ?? "",
        category: meta.category ?? "utility",
        entry: meta.entry ?? path,
        dependencies: meta.dependencies ?? [],
        requiredCapabilities: meta.requiredCapabilities ?? [],
        hooks: meta.hooks ?? [],
        config: meta.config ?? {},
      };
    } catch {
      return null;
    }
  }

  /** Parse a skill script (TypeScript/JavaScript) */
  private parseSkillScript(_content: string, path: string): SkillDefinition {
    // Default definition for raw scripts
    return {
      id: "skill_" + Date.now(),
      name: path.split("/").pop()?.replace(/\.(ts|js)$/, "") ?? "Unnamed",
      version: "0.1.0",
      description: `Skill from ${path}`,
      category: "custom",
      entry: path,
      requiredCapabilities: [],
    };
  }

  /** Execute the skill's entry point module */
  private async executeSkillModule(
    definition: SkillDefinition,
    context: SkillExecutionContext
  ): Promise<SkillResult> {
    // Try to dynamically import the skill's entry point if it's a .ts/.js file
    const entry = definition.entry;
    const ext = extname(entry);

    if (ext === ".ts" || ext === ".js") {
      try {
        const mod = await import(/* @vite-ignore */ join(process.cwd(), entry));
        if (typeof mod.default === "function") {
          return await mod.default(context);
        }
        if (typeof mod.execute === "function") {
          return await mod.execute(context);
        }
      } catch (error) {
        this.logger.warn(`Could not load skill module ${entry}:`, error);
      }
    }

    // Fallback: execute based on skill pattern if available
    const skillFile = ext === ".skill" ? join(process.cwd(), entry) : null;
    if (skillFile && existsSync(skillFile)) {
      try {
        const content = JSON.parse(readFileSync(skillFile, "utf-8"));
        const pattern = content.pattern;
        if (pattern?.response) {
          return {
            success: true,
            output: pattern.response,
          };
        }
      } catch { /* fall through */ }
    }

    // Generic fallback
    return {
      success: true,
      output: `Executed skill "${definition.name}" (${definition.description})`,
    };
  }
}
