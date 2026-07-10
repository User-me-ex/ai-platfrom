import chalk from "chalk";
import type { Command } from "../core/types";
import type { SecurityManager } from "../security/index";
import { getTerminalWidth } from "../utils/terminal";

export function createSecurityCommand(security: SecurityManager): Command {
  return {
    name: "security",
    description: "Security monitoring and threat detection",
    aliases: ["sec", "threats"],
    usage: "/security [status|threats|policy]",
    async execute(args) {
      const sub = args[0] ?? "status";
      switch (sub) {
        case "threats": {
          const threats = security.detector.getThreatLog();
          console.log(chalk.cyan.bold("Threat Detection Log"));
          console.log(chalk.dim("─".repeat(getTerminalWidth() - 2)));
          if (threats.length === 0) { console.log(chalk.dim("No threats detected.")); return; }
          for (const t of threats) {
            const colors = { info: chalk.blue, low: chalk.dim, medium: chalk.yellow, high: chalk.red, critical: chalk.red.bold };
            const color = colors[t.severity];
            console.log(`  ${color(t.severity.padEnd(8))} ${chalk.dim(t.type.padEnd(22))} ${t.details.slice(0, 60)}`);
            if (!t.mitigated) console.log(`  ${chalk.yellow("  ⚠ Not mitigated!")}`);
          }
          break;
        }
        case "policy": {
          const policy = security.getPolicy();
          console.log(chalk.cyan.bold("Safety Policy"));
          console.log(chalk.dim("─".repeat(getTerminalWidth() - 2)));
          console.log(`  Max file changes:  ${chalk.white(String(policy.maxFileChangesPerOperation))}`);
          console.log(`  Max file size:     ${chalk.white(`${Math.round(policy.maxFileSize / 1024 / 1024)}MB`)}`);
          console.log(`  Shell commands:    ${policy.allowShellCommands ? chalk.green("allowed") : chalk.red("blocked")}`);
          console.log(`  Network access:    ${policy.allowNetwork ? chalk.green("allowed") : chalk.red("blocked")}`);
          break;
        }
        default: {
          console.log(chalk.cyan.bold("Security System"));
          console.log(chalk.dim("─".repeat(getTerminalWidth() - 2)));
          console.log(`  ${chalk.green("●")} Threat detection ${chalk.white("active")}`);
          console.log(`  ${chalk.green("●")} File safety ${chalk.white("active")}`);
          console.log(`  ${chalk.dim("○")} Plugin sandboxing ${chalk.white("inactive")}`);
          console.log(`  Threats logged: ${chalk.white(String(security.detector.getThreatLog().length))}`);
          break;
        }
      }
    },
  };
}
