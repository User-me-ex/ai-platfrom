import chalk from "chalk";
import type { Command } from "../core/types";
import type { MemoryManager } from "../memory/index";
import { getTerminalWidth } from "../utils/terminal";

export function createMemoryCommand(memory: MemoryManager): Command {
  return {
    name: "memory",
    description: "Search and manage conversation memory",
    aliases: ["mem", "recall"],
    usage: "/memory [search|stats|clear] [query]",
    async execute(args) {
      const sub = args[0] ?? "stats";
      switch (sub) {
        case "search": {
          const query = args.slice(1).join(" ");
          if (!query) { console.log(chalk.red("Usage: /memory search <query>")); return; }
          const results = memory.search(query, 10);
          console.log(chalk.cyan.bold(`Memory Search: "${query}"`));
          console.log(chalk.dim("─".repeat(getTerminalWidth() - 2)));
          if (results.length === 0) { console.log(chalk.dim("No results found.")); return; }
          for (const r of results) {
            const date = new Date(r.record.timestamp).toLocaleString();
            console.log(`  ${chalk.green(r.record.role.padEnd(9))} ${chalk.dim(date)} ${chalk.dim(`[${Math.round(r.score)}pts]`)}`);
            console.log(`  ${r.snippet}`);
            console.log("");
          }
          break;
        }
        case "stats": {
          console.log(chalk.cyan.bold("Memory System"));
          console.log(chalk.dim("─".repeat(getTerminalWidth() - 2)));
          console.log(`  Records:   ${chalk.white(String(memory.fts5.count))}`);
          console.log(`  Vectors:   ${chalk.white(String(memory.vector.count))}`);
          console.log(`  Sessions:  ${chalk.white(String(memory.fts5.getSessionSummaries().size))}`);
          break;
        }
        case "profile": {
          const uid = args[1] ?? "default";
          const profile = memory.profiles.getProfile(uid);
          console.log(chalk.cyan.bold(`User Profile: ${uid}`));
          console.log(chalk.dim("─".repeat(getTerminalWidth() - 2)));
          console.log(`  Sessions:   ${chalk.white(String(profile.sessionCount))}`);
          console.log(`  Tokens:     ${chalk.white(String(profile.totalTokens))}`);
          const topics = memory.profiles.getTopTopics(uid, 5);
          if (topics.length > 0) console.log(`  Topics:     ${chalk.cyan(topics.join(", "))}`);
          if (profile.commonCommands.length > 0) console.log(`  Commands:   ${chalk.dim(profile.commonCommands.slice(0, 5).join(", "))}`);
          break;
        }
        default:
          console.log(chalk.dim("Usage: /memory [search|stats|profile]"));
      }
    },
  };
}
