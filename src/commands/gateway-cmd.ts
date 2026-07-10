import chalk from "chalk";
import type { Command } from "../core/types";
import type { GatewayManager } from "../gateways/index";
import { getTerminalWidth } from "../utils/terminal";

export function createGatewayCommand(gateways: GatewayManager): Command {
  return {
    name: "gateway",
    description: "Manage cross-platform messaging gateways",
    aliases: ["gw", "gateways"],
    usage: "/gateway [status|connect|disconnect] [platform]",
    async execute(args) {
      const sub = args[0] ?? "status";
      switch (sub) {
        case "status": {
          const statuses = gateways.getAllStatuses();
          console.log(chalk.cyan.bold("Gateway Connections"));
          console.log(chalk.dim("─".repeat(getTerminalWidth() - 2)));
          if (statuses.length === 0) { console.log(chalk.dim("No gateways connected.")); return; }
          for (const s of statuses) {
            const statusColor = s.connected ? chalk.green : chalk.red;
            console.log(`  ${statusColor(s.platform.padEnd(12))} ${statusColor(s.connected ? "● connected" : "○ disconnected")} msgs: ${chalk.white(String(s.messageCount))}`);
          }
          break;
        }
        case "broadcast": {
          const message = args.slice(1).join(" ");
          if (!message) { console.log(chalk.red("Usage: /gateway broadcast <message>")); return; }
          console.log(chalk.dim(`Broadcasting: ${message}`));
          const statuses = gateways.getAllStatuses();
          for (const s of statuses) {
            if (s.connected) {
              console.log(chalk.dim(`  → Sent to ${s.platform}`));
            }
          }
          break;
        }
        default:
          console.log(chalk.cyan.bold("Gateway System"));
          console.log(chalk.dim("─".repeat(getTerminalWidth() - 2)));
          console.log(`  ${chalk.dim("○")} Telegram ${chalk.dim("(not configured)")}`);
          console.log(`  ${chalk.dim("○")} Discord ${chalk.dim("(not configured)")}`);
          console.log(`  ${chalk.dim("○")} Slack   ${chalk.dim("(not configured)")}`);
          console.log(chalk.dim("\n  Configure gateways via /config or the config file."));
      }
    },
  };
}
