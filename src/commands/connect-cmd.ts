/**
 * 9 Router CLI — Connect Command
 *
 * Manage 9 Router connections: add, edit, remove, list, test, switch.
 * Interactive connection management is handled via the TUI overlay (Ctrl+Shift+C or /connect).
 * This command supports the same operations via CLI arguments for scripting.
 */
import chalk from "chalk";
import type { Command } from "../core/types";
import type { ConnectionManager } from "../router/connections";
import { getTerminalWidth } from "../utils/terminal";

export function createConnectCommand(cm: ConnectionManager): Command {
  return {
    name: "connect",
    description: "Manage 9 Router server connections",
    aliases: ["conn", "server"],
    usage: "/connect [add|remove|list|test|switch|edit]",
    async execute(args, _ctx) {
      const sub = args[0] ?? "list";

      switch (sub) {
        case "add":
          await addConnection(cm, args.slice(1));
          break;
        case "remove":
        case "rm":
          removeConnection(cm, args.slice(1));
          break;
        case "list":
        case "ls":
          listConnections(cm);
          break;
        case "test":
          await testConnection(cm, args.slice(1));
          break;
        case "switch":
        case "use":
          await switchConnection(cm, args.slice(1));
          break;
        case "edit":
          await editConnection(cm, args.slice(1));
          break;
        default:
          console.log(chalk.dim("Usage: /connect [add|remove|list|test|switch|edit]"));
          console.log(chalk.dim("  Use /connect (no args) to open the interactive TUI overlay"));
      }
    },
  };
}

function listConnections(cm: ConnectionManager): void {
  const connections = cm.list();
  const active = cm.getActiveName();

  if (connections.length === 0) {
    console.log(chalk.yellow("No connections configured."));
    console.log(chalk.dim("  Use /connect add <name> <url> [api-key] to add one."));
    return;
  }

  console.log(chalk.cyan.bold("9 Router Connections"));
  console.log(chalk.dim("─".repeat(getTerminalWidth() - 2)));

  for (const conn of connections) {
    const isActive = conn.name === active;
    const marker = isActive ? chalk.green("●") : chalk.dim("○");
    const name = isActive ? chalk.white.bold(conn.name) : chalk.white(conn.name);
    const url = chalk.dim(conn.baseUrl);
    const key = conn.apiKey ? chalk.dim(" [key set]") : chalk.dim(" [no key]");
    console.log(`  ${marker} ${name}  ${url}${key}`);
  }

  console.log("");
  console.log(chalk.dim(`  Active: ${active || "none"}  ·  Use /connect switch <name> to change`));
}

async function addConnection(cm: ConnectionManager, args: string[]): Promise<void> {
  if (args.length < 2) {
    console.log(chalk.red("Usage: /connect add <name> <url> [api-key]"));
    return;
  }

  const name = args[0]!;
  const baseUrl = args[1]!;
  const apiKey = args[2];

  const conn = { name, baseUrl, apiKey };
  cm.add(conn);
  console.log(chalk.green(`✓ Connection "${name}" added (${baseUrl})`));
}

function removeConnection(cm: ConnectionManager, args: string[]): void {
  if (args.length < 1) {
    console.log(chalk.red("Usage: /connect remove <name>"));
    return;
  }

  const name = args[0]!;
  if (cm.remove(name)) {
    console.log(chalk.green(`✓ Connection "${name}" removed.`));
  } else {
    console.log(chalk.red(`✗ Connection "${name}" not found.`));
  }
}

async function testConnection(cm: ConnectionManager, args: string[]): Promise<void> {
  if (args.length < 1) {
    console.log(chalk.red("Usage: /connect test <name>"));
    return;
  }

  const name = args[0]!;
  const conn = cm.list().find((c) => c.name === name);
  if (!conn) {
    console.log(chalk.red(`✗ Connection "${name}" not found.`));
    return;
  }

  console.log(chalk.cyan(`Testing connection: ${conn.name} (${conn.baseUrl})...`));
  const status = await cm.test(conn);
  if (status.connected) {
    console.log(chalk.green(`  ● Connected — ${status.modelsCount} model(s), ${status.uptime}ms`));
  } else {
    console.log(chalk.red(`  ○ Connection failed`));
    console.log(chalk.dim(`    Check that 9 Router is running at ${conn.baseUrl}`));
  }
}

async function switchConnection(cm: ConnectionManager, args: string[]): Promise<void> {
  if (args.length < 1) {
    const active = cm.active();
    console.log(chalk.cyan(`Currently using: ${chalk.white.bold(active?.name ?? "none")}`));
    if (active) console.log(chalk.dim(`  ${active.baseUrl}`));
    console.log(chalk.dim("  Use /connect switch <name> to switch connections."));
    return;
  }

  const name = args[0]!;
  const ok = await cm.switch(name);
  if (ok) {
    const active = cm.active();
    console.log(chalk.green(`✓ Switched to "${name}"`));
    if (active) console.log(chalk.dim(`  ${active.baseUrl}`));
  } else {
    console.log(chalk.red(`✗ Connection "${name}" not found.`));
    console.log(chalk.dim("  Use /connect list to see available connections."));
  }
}

async function editConnection(cm: ConnectionManager, args: string[]): Promise<void> {
  if (args.length < 2) {
    console.log(chalk.red("Usage: /connect edit <name> <new-url> [new-api-key]"));
    return;
  }
  const name = args[0]!;
  const baseUrl = args[1]!;
  const apiKey = args[2];

  const existing = cm.list().find((c) => c.name === name);
  if (!existing) {
    console.log(chalk.red(`✗ Connection "${name}" not found.`));
    return;
  }

  cm.add({ name, baseUrl, apiKey: apiKey ?? existing.apiKey });
  console.log(chalk.green(`✓ Connection "${name}" updated.`));
}
