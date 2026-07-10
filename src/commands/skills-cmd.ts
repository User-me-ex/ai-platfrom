/**
 * 9 Router CLI — Skills Command
 *
 * Manages runtime skills: list, install, remove, execute.
 */

import chalk from "chalk";
import type { Command } from "../core/types";
import type { SkillEngine, SkillInstaller } from "../skills/index";

export function createSkillsCommand(engine: SkillEngine, installer: SkillInstaller): Command {
  return {
    name: "skills",
    description: "Manage skills — list, install, execute",
    aliases: ["skill"],
    usage: "/skills [list|install|execute|info]",
    async execute(args: string[], _ctx: any) {
      const subcommand = args[0] ?? "list";

      switch (subcommand) {
        case "list":
          await listSkills(engine);
          break;

        case "install":
          await installSkill(args.slice(1), engine, installer);
          break;

        case "execute":
          await executeSkill(args.slice(1), engine);
          break;

        case "info":
          await showSkillInfo(args.slice(1), engine);
          break;

        default:
          console.log(chalk.dim("Usage: /skills [list|install|execute|info]"));
      }
    },
  };
}

async function listSkills(engine: SkillEngine): Promise<void> {
  const skills = engine.listSkills();
  if (skills.length === 0) {
    console.log(chalk.dim("No skills installed. Use /skills install <path> to add one."));
    return;
  }

  console.log(chalk.cyan.bold("Installed Skills"));
  console.log(chalk.dim("─".repeat(50)));

  for (const skill of skills) {
    const hasGaps = engine.detectCapabilityGap(skill).length > 0;
    const status = hasGaps ? chalk.yellow("⚠ needs evolution") : chalk.green("✓ ready");
    console.log(
      `  ${chalk.white(skill.name.padEnd(20))} ${chalk.dim(`v${skill.version}`)} ${status}`
    );
    console.log(`  ${chalk.dim(skill.description)}`);
    console.log(`  ${chalk.dim(`  id: ${skill.id} · category: ${skill.category}`)}`);
    console.log("");
  }

  console.log(chalk.dim(`Total: ${skills.length} skill(s)`));
}

async function installSkill(
  args: string[],
  _engine: SkillEngine,
  installer: SkillInstaller
): Promise<void> {
  const path = args[0];
  if (!path) {
    console.log(chalk.red("Usage: /skills install <path>"));
    return;
  }

  const mode = args.includes("--auto") ? "autonomous" : "interactive";

  console.log(chalk.cyan(`Installing skill from: ${path}`));
  console.log(chalk.dim(`Mode: ${mode}`));

  try {
    const result = await installer.install(path, mode);

    if (result.success) {
      console.log(chalk.green("✓ Installation successful"));

      if (result.evolved && result.report) {
        console.log("");
        console.log(result.report);
      }
    } else {
      console.log(chalk.red(`✗ Installation failed: ${result.error}`));

      if (result.plan) {
        console.log("");
        console.log(chalk.yellow("Required changes:"));
        for (const change of result.plan.fileChanges) {
          console.log(`  ${chalk.dim(`[${change.type}]`)} ${change.path}`);
          console.log(`    ${chalk.dim(change.reason)}`);
        }
      }
    }
  } catch (error) {
    console.log(
      chalk.red(`✗ Installation error: ${error instanceof Error ? error.message : String(error)}`)
    );
  }
}

async function executeSkill(args: string[], engine: SkillEngine): Promise<void> {
  const skillId = args[0];
  if (!skillId) {
    console.log(chalk.red("Usage: /skills execute <skill-id>"));
    return;
  }

  const skill = engine.getSkill(skillId);
  if (!skill) {
    console.log(chalk.red(`Skill "${skillId}" not found.`));
    return;
  }

  console.log(chalk.cyan(`Executing skill: ${skill.name}...`));

  try {
    const result = await skill.execute({
      args: args.slice(1),
      config: {},
      workspace: process.cwd(),
      logger: console as any,
      router: {} as any,
      session: {} as any,
      chat: {} as any,
      renderer: {} as any,
      skills: engine,
    });

    if (result.success) {
      console.log(chalk.green("✓ Skill executed successfully"));
      if (result.output) console.log(result.output);
    } else {
      console.log(chalk.red(`✗ ${result.error}`));
    }
  } catch (error) {
    console.log(
      chalk.red(`✗ Execution error: ${error instanceof Error ? error.message : String(error)}`)
    );
  }
}

async function showSkillInfo(args: string[], engine: SkillEngine): Promise<void> {
  const skillId = args[0];
  if (!skillId) {
    console.log(chalk.red("Usage: /skills info <skill-id>"));
    return;
  }

  const skill = engine.getSkill(skillId);
  if (!skill) {
    const def = engine.listSkills().find((s) => s.id === skillId);
    if (!def) {
      console.log(chalk.red(`Skill "${skillId}" not found.`));
      return;
    }

    console.log(chalk.cyan.bold(`Skill: ${def.name}`));
    console.log(`  ID: ${chalk.dim(def.id)}`);
    console.log(`  Version: ${chalk.dim(def.version)}`);
    console.log(`  Description: ${chalk.dim(def.description)}`);
    console.log(`  Category: ${chalk.dim(def.category)}`);
    if (def.requiredCapabilities && def.requiredCapabilities.length > 0) {
      console.log(`  Required Capabilities:`);
      for (const cap of def.requiredCapabilities) {
        console.log(`    ${chalk.dim(`[${cap.type}]`)} ${cap.name} (${cap.priority})`);
      }
    }
    return;
  }

  console.log(chalk.cyan.bold(`Skill: ${skill.name} v${skill.version}`));
  console.log(`  ID: ${chalk.dim(skill.id)}`);
  console.log(`  Description: ${chalk.dim(skill.description)}`);
  console.log(`  Category: ${chalk.dim(skill.category)}`);

  const gaps = engine.detectCapabilityGap(skill);
  if (gaps.length > 0) {
    console.log(chalk.yellow(`  ⚠ ${gaps.length} capability gap(s) — run /evolve`));
  } else {
    console.log(chalk.green("  ✓ Fully compatible with current framework"));
  }
}
