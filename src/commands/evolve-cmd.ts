/**
 * 9 Router CLI — Evolve Command
 *
 * The self-evolving framework command. Analyzes capability gaps,
 * generates plans, and evolves the framework to support new skills.
 */

import chalk from "chalk";
import type { Command } from "../core/types";
import type { SkillEngine, SkillInstaller, ArchitectureInspector } from "../skills/index";
import { getTerminalWidth } from "../utils/terminal";

export function createEvolveCommand(
  engine: SkillEngine,
  installer: SkillInstaller,
  inspector: ArchitectureInspector
): Command {
  return {
    name: "evolve",
    description: "Evolve the framework to support new skill capabilities",
    aliases: ["ev"],
    usage: "/evolve [skill-path] [--auto]",
    async execute(args: string[], _ctx: any) {
      const subcommand = args[0] ?? "status";

      switch (subcommand) {
        case "status":
          await showEvolutionStatus(engine, inspector);
          break;

        case "plan":
          await generatePlan(args.slice(1), engine, inspector);
          break;

        case "apply":
          await applyEvolution(args.slice(1), engine, installer);
          break;

        case "inspect":
          await inspectArchitecture(inspector);
          break;

        case "rollback":
          await rollbackEvolution();
          break;

        default:
          // Treat as a skill path to install
          await applyEvolution(args, engine, installer);
      }
    },
  };
}

async function showEvolutionStatus(
  engine: SkillEngine,
  inspector: ArchitectureInspector
): Promise<void> {
  const snapshot = await inspector.getSnapshot();
  const skills = engine.listSkills();

  console.log(chalk.cyan.bold("Evolution Status"));
  console.log(chalk.dim("─".repeat(getTerminalWidth() - 2)));

  console.log(`  Modules: ${chalk.white(String(snapshot.modules.length))}`);
  console.log(`  Commands: ${chalk.white(String(snapshot.commandRegistry.length))}`);
  console.log(`  Events: ${chalk.white(String(snapshot.eventSystem.length))}`);
  console.log(`  Plugin APIs: ${chalk.white(String(snapshot.pluginInterfaces.length))}`);
  console.log(`  Skills installed: ${chalk.white(String(skills.length))}`);

  // Find skills with capability gaps
  const gapsFound = skills.filter((s) => engine.detectCapabilityGap(s).length > 0);
  if (gapsFound.length > 0) {
    console.log("");
    console.log(chalk.yellow(`⚠ ${gapsFound.length} skill(s) require framework evolution:`));
    for (const skill of gapsFound) {
      const gaps = engine.detectCapabilityGap(skill);
      console.log(`  ${chalk.white(skill.name)}: ${gaps.map((g) => `${chalk.dim(g.type)}/${chalk.cyan(g.name)}`).join(", ")}`);
    }
    console.log("");
    console.log(chalk.dim("  Run /evolve plan <skill-path> to see what changes are needed."));
  } else {
    console.log("");
    console.log(chalk.green("  ✓ Framework is up to date."));
  }
}

async function generatePlan(
  args: string[],
  engine: SkillEngine,
  _inspector: ArchitectureInspector
): Promise<void> {
  const path = args[0];
  if (!path) {
    console.log(chalk.red("Usage: /evolve plan <skill-path>"));
    return;
  }

  console.log(chalk.cyan(`Analyzing: ${path}`));
  console.log("");

  // Use the installer to analyze the skill
  const definition = engine.listSkills().find((s) => s.id === path);
  if (!definition) {
    console.log(chalk.yellow(`Skill not found. Install it first with /skills install ${path}`));
    return;
  }

  const gaps = engine.detectCapabilityGap(definition);
  if (gaps.length === 0) {
    console.log(chalk.green("✓ No capability gaps. Skill can be installed directly."));
    return;
  }

  console.log(chalk.yellow(`⚠ ${gaps.length} capability gap(s) detected:`));
  for (const gap of gaps) {
    console.log(`  ${chalk.dim(`[${gap.type}]`)} ${chalk.cyan(gap.name)} — ${gap.description}`);
    console.log(`    ${chalk.dim(`Priority: ${gap.priority}`)}`);
  }
  console.log("");

  console.log(chalk.dim("Run /evolve apply <skill-path> to generate and execute the evolution plan."));
}

async function applyEvolution(
  args: string[],
  _engine: SkillEngine,
  installer: SkillInstaller
): Promise<void> {
  const path = args[0];
  if (!path) {
    console.log(chalk.red("Usage: /evolve apply <skill-path> [--auto]"));
    return;
  }

  const mode = args.includes("--auto") ? "autonomous" : "interactive";

  console.log(chalk.cyan.bold("🚀 Framework Evolution"));
  console.log(chalk.dim("─".repeat(getTerminalWidth() - 2)));
  console.log(`  Skill path: ${chalk.white(path)}`);
  console.log(`  Mode: ${chalk.white(mode)}`);
  console.log("");

  try {
    const result = await installer.install(path, mode);

    if (result.success) {
      console.log(chalk.green.bold("\n✓ Evolution complete!"));

      if (result.evolved) {
        if (result.report) {
          console.log("");
          console.log(result.report);
        }

        if (result.plan) {
          console.log("");
          console.log(chalk.cyan("Summary:"));
          console.log(`  Files created: ${chalk.white(String(result.plan.newFiles.length))}`);
          console.log(`  Files modified: ${chalk.white(String(result.plan.modifiedFiles.length))}`);
          console.log(`  Backward compatible: ${result.plan.backwardCompatible ? chalk.green("✓") : chalk.red("✗")}`);
        }
      } else {
        console.log(chalk.dim("  Skill installed as runtime skill (no framework changes needed)."));
      }
    } else {
      console.log(chalk.red.bold(`\n✗ Evolution failed:`));
      console.log(`  ${result.error}`);

      if (result.plan) {
        console.log("");
        console.log(chalk.yellow("Required changes (not applied):"));
        for (const change of result.plan.fileChanges) {
          console.log(`  ${chalk.dim(`[${change.type}]`)} ${change.path}`);
          console.log(`    ${chalk.dim(change.reason)}`);
        }
      }
    }
  } catch (error) {
    console.log(chalk.red(`\n✗ Evolution error: ${error instanceof Error ? error.message : String(error)}`));
  }
}

async function inspectArchitecture(inspector: ArchitectureInspector): Promise<void> {
  const snapshot = await inspector.getSnapshot();

  console.log(chalk.cyan.bold("Architecture Inspection"));
  console.log(chalk.dim("─".repeat(getTerminalWidth() - 2)));

  console.log(chalk.bold("\nModules:"));
  for (const mod of snapshot.modules) {
    console.log(`  ${chalk.cyan(mod.name.padEnd(15))} ${mod.files.length} files, ${mod.exports.length} exports`);
  }

  console.log(chalk.bold("\nDependencies:"));
  const grouped = new Map<string, string[]>();
  for (const edge of snapshot.dependencyGraph) {
    const deps = grouped.get(edge.from) ?? [];
    deps.push(edge.to);
    grouped.set(edge.from, deps);
  }
  for (const [from, tos] of grouped) {
    console.log(`  ${chalk.white(from)} → ${tos.map((t) => chalk.dim(t)).join(", ")}`);
  }

  console.log(chalk.bold("\nEvents:"));
  if (snapshot.eventSystem.length > 0) {
    for (const event of snapshot.eventSystem) {
      console.log(`  ${chalk.dim(event)}`);
    }
  } else {
    console.log(chalk.dim("  No events found"));
  }
}

async function rollbackEvolution(): Promise<void> {
  console.log(chalk.yellow("Rollback requires git."));
  console.log(chalk.dim("  Run: git reset --hard HEAD~1"));
  console.log(chalk.dim("  Or: git checkout <checkpoint-branch>"));
}
