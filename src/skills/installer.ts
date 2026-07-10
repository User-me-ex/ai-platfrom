/**
 * 9 Router CLI — Skill Installer
 *
 * The installation pipeline that orchestrates the full flow:
 * analyze → detect gaps → plan → evolve → install → validate → report
 */

import type { InstallResult } from "./types";
import { SkillEngine } from "./engine";
import { ArchitectureInspector } from "./inspector";
import type { Logger } from "../core/types";

export class SkillInstaller {
  private engine: SkillEngine;
  private logger: Logger;

  constructor(engine: SkillEngine, logger: Logger) {
    this.engine = engine;
    this.logger = logger;
  }

  /** Run the full installation pipeline */
  async install(path: string, mode: "interactive" | "autonomous"): Promise<InstallResult> {
    this.logger.info(`Installing skill from: ${path} (mode: ${mode})`);

    // Step 1: Analyze the skill
    this.logger.info("Step 1/10: Analyzing skill...");
    const definition = await this.engine.analyzeSkillFile(path);
    if (!definition) {
      return { success: false, evolved: false, error: "Failed to analyze skill file" };
    }

    // Step 2: Detect capability gaps
    this.logger.info("Step 2/10: Detecting capability gaps...");
    const gaps = this.engine.detectCapabilityGap(definition);

    if (gaps.length === 0) {
      // No gaps — install as runtime skill directly
      this.logger.info("No capability gaps — installing as runtime skill");
      await this.engine.loadSkill(definition);
      return {
        success: true,
        evolved: false,
        report: `✓ Skill "${definition.name}" v${definition.version} installed successfully (runtime only).`,
      };
    }

    this.logger.info(`Found ${gaps.length} capability gaps: ${gaps.map((g) => `${g.type}/${g.name}`).join(", ")}`);

    // Step 3: Generate evolution plan
    this.logger.info("Step 3/10: Generating evolution plan...");
    const { EvolutionPlanner } = await import("./planner");
    const inspector = new ArchitectureInspector();
    const planner = new EvolutionPlanner(inspector);
    const plan = await planner.generatePlan(definition, gaps, mode);

    // Step 4: Safety check
    this.logger.info("Step 4/10: Running safety checks...");
    const { SafetyGuard } = await import("./safety");
    const safety = new SafetyGuard(inspector);
    const safetyCheck = safety.validatePlan(plan);
    if (!safetyCheck.valid) {
      return {
        success: false,
        evolved: false,
        error: `Safety check failed: ${safetyCheck.reason}`,
        plan,
      };
    }

    // Step 5: Git checkpoint
    this.logger.info("Step 5/10: Creating git checkpoint...");
    const { GitManager } = await import("./git");
    const git = new GitManager(this.logger);
    await git.createCheckpoint(`Before evolving for skill: ${definition.name}`);

    // Step 6: Execute evolution
    this.logger.info("Step 6/10: Evolving framework...");
    const { FrameworkEvolver } = await import("./evolver");
    const evolver = new FrameworkEvolver(inspector, this.logger);
    const evolutionResult = await evolver.evolve(plan, mode);
    if (!evolutionResult.success) {
      this.logger.warn("Evolution failed — rolling back...");
      await git.rollback();
      return {
        success: false,
        evolved: false,
        error: `Evolution failed: ${evolutionResult.error}`,
        plan,
      };
    }

    // Step 7: Install skill
    this.logger.info("Step 7/10: Installing skill...");
    await this.engine.loadSkill(definition);

    // Step 8: Run validation
    this.logger.info("Step 8/10: Running validation...");
    const validationResult = await evolver.validate();
    if (!validationResult.success) {
      this.logger.warn("Validation failed — rolling back...");
      await git.rollback();
      return {
        success: false,
        evolved: false,
        error: `Validation failed: ${validationResult.error}`,
        plan,
      };
    }

    // Step 9: Generate change report
    this.logger.info("Step 9/10: Generating change report...");
    const { ChangeReporter } = await import("./reporter");
    const reporter = new ChangeReporter();
    const report = reporter.generateReport(
      `Install skill: ${definition.name}`,
      plan,
      evolutionResult.changes
    );

    // Update documentation
    const { DocAutomator } = await import("./docs");
    const docs = new DocAutomator(safety);
    await docs.updateAll(plan, report);

    // Step 10: Git commit
    this.logger.info("Step 10/10: Committing changes...");
    await git.commit(`feat(skills): evolve framework for skill "${definition.name}"`);

    const formattedReport = reporter.formatReport(report);

    return {
      success: true,
      evolved: true,
      plan,
      changes: evolutionResult.changes,
      report: formattedReport,
    };
  }
}
