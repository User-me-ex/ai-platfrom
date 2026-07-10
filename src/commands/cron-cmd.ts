import chalk from "chalk";
import type { Command } from "../core/types";
import type { AutomationManager } from "../automation/index";
import { getTerminalWidth } from "../utils/terminal";

export function createCronCommand(automation: AutomationManager): Command {
  return {
    name: "cron",
    description: "Schedule and manage automated jobs",
    aliases: ["schedule", "jobs"],
    usage: "/cron [list|add|remove|start|stop|blueprints|suggestions]",
    async execute(args) {
      const sub = args[0] ?? "list";
      switch (sub) {
        case "list": {
          const jobs = automation.scheduler.listJobs();
          console.log(chalk.cyan.bold("Scheduled Jobs"));
          console.log(chalk.dim("─".repeat(getTerminalWidth() - 2)));
          if (jobs.length === 0) { console.log(chalk.dim("No scheduled jobs. Use /cron add to create one.")); return; }
          for (const job of jobs) {
            const statusColor = job.enabled ? chalk.green : chalk.dim;
            console.log(`  ${statusColor(job.name.padEnd(20))} ${chalk.dim(job.cronExpression.padEnd(14))} ${statusColor(job.status)} ${chalk.dim(`runs: ${job.runCount}`)}`);
          }
          break;
        }
        case "blueprints": {
          const type = args[1] as any;
          const blueprints = automation.catalog.list(type);
          console.log(chalk.cyan.bold("Job Blueprints"));
          console.log(chalk.dim("─".repeat(getTerminalWidth() - 2)));
          for (const bp of blueprints) {
            console.log(`  ${chalk.white(bp.name.padEnd(20))} ${chalk.dim(bp.cronExpression.padEnd(14))} ${chalk.dim(bp.description)}`);
          }
          console.log(chalk.dim("  Use /cron add <blueprint-id> to create a job from a blueprint"));
          break;
        }
        case "suggestions": {
          const suggestions = automation.suggestionCatalog.generateSuggestions();
          console.log(chalk.cyan.bold("Suggested Jobs"));
          console.log(chalk.dim("─".repeat(getTerminalWidth() - 2)));
          if (suggestions.length === 0) { console.log(chalk.dim("No suggestions yet. Continue using the CLI for personalized suggestions.")); return; }
          for (const s of suggestions) {
            console.log(`  ${chalk.white(s.title)} ${chalk.dim(`(${Math.round(s.confidence * 100)}% confidence)`)}`);
            console.log(`    ${chalk.dim(s.reason)}`);
          }
          break;
        }
        case "start":
          automation.scheduler.start();
          console.log(chalk.green("✓ Cron scheduler started"));
          break;
        case "stop":
          automation.scheduler.stop();
          console.log(chalk.yellow("○ Cron scheduler stopped"));
          break;
        default:
          console.log(chalk.dim("Usage: /cron [list|blueprints|suggestions|start|stop]"));
      }
    },
  };
}
