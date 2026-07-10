import chalk from "chalk";
import type { Command } from "../core/types";
import type { OrchestratorManager } from "../orchestrator/index";
import { getTerminalWidth } from "../utils/terminal";

export function createOrchestrateCommand(orchestrator: OrchestratorManager): Command {
  return {
    name: "orchestrate",
    description: "Manage subagents, tasks, and swarm execution",
    aliases: ["orch", "agents", "swarm"],
    usage: "/orchestrate [status|agents|tasks]",
    async execute(args) {
      const sub = args[0] ?? "status";
      switch (sub) {
        case "agents": {
          const agents = orchestrator.pool.listAgents();
          console.log(chalk.cyan.bold("Subagent Pool"));
          console.log(chalk.dim("─".repeat(getTerminalWidth() - 2)));
          if (agents.length === 0) { console.log(chalk.dim("No agents spawned.")); return; }
          for (const a of agents) {
            const statusColor = a.status === "idle" ? chalk.green : a.status === "busy" ? chalk.yellow : chalk.red;
            console.log(`  ${statusColor(a.id.padEnd(16))} ${chalk.dim(a.name.padEnd(15))} ${statusColor(a.status.padEnd(6))} done: ${chalk.white(String(a.tasksCompleted))}`);
          }
          break;
        }
        case "tasks": {
          const all = orchestrator.queue.listTasks();
          console.log(chalk.cyan.bold("Task Queue"));
          console.log(chalk.dim("─".repeat(getTerminalWidth() - 2)));
          if (all.length === 0) { console.log(chalk.dim("No tasks in queue.")); return; }
          for (const t of all) {
            const statusColor = t.status === "completed" ? chalk.green : t.status === "running" ? chalk.yellow : t.status === "failed" ? chalk.red : chalk.dim;
            console.log(`  ${statusColor(t.status.padEnd(10))} ${chalk.white(t.name.slice(0, 30).padEnd(30))} ${chalk.dim(t.handler)}`);
          }
          break;
        }
        default: {
          const summary = orchestrator.getSummary();
          console.log(chalk.cyan.bold("Orchestration System"));
          console.log(chalk.dim("─".repeat(getTerminalWidth() - 2)));
          console.log(`  Agents:    ${chalk.white(String(summary.agents))}`);
          console.log(`  Tasks:     ${chalk.white(String(summary.tasks))}`);
          console.log(`  Queue:     ${chalk.white(String(summary.queueDepth))}`);
          break;
        }
      }
    },
  };
}
