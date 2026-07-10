import chalk from "chalk";
import type { Command } from "../core/types";
import type { WebManager } from "../web/index";
import { getTerminalWidth } from "../utils/terminal";

export function createWebCommand(web: WebManager): Command {
  return {
    name: "web",
    description: "Web research and browser tools",
    aliases: ["search", "browse"],
    usage: "/web [search|fetch] <query|url>",
    async execute(args) {
      const sub = args[0] ?? "search";
      switch (sub) {
        case "search": {
          const query = args.slice(1).join(" ");
          if (!query) { console.log(chalk.red("Usage: /web search <query>")); return; }
          console.log(chalk.dim(`Searching for: ${query}`));
          const results = await web.search.search(query);
          console.log(chalk.cyan.bold(`Search Results`));
          console.log(chalk.dim("─".repeat(getTerminalWidth() - 2)));
          if (results.length === 0) { console.log(chalk.dim("No results found.")); return; }
          for (let i = 0; i < results.length; i++) {
            const r = results[i]!;
            console.log(`  ${chalk.white(`${i + 1}. ${r.title}`)}`);
            console.log(`     ${chalk.dim(r.url)}`);
            if (r.snippet) console.log(`     ${chalk.dim(r.snippet.slice(0, 100))}`);
            console.log("");
          }
          break;
        }
        case "fetch": {
          const url = args[1];
          if (!url) { console.log(chalk.red("Usage: /web fetch <url>")); return; }
          console.log(chalk.dim(`Fetching: ${url}`));
          const page = await web.search.fetchPage(url);
          console.log(chalk.cyan.bold(`Page: ${page.title}`));
          console.log(chalk.dim("─".repeat(getTerminalWidth() - 2)));
          const text = page.text.length > 500 ? page.text.slice(0, 500) + "..." : page.text;
          console.log(text);
          console.log(chalk.dim(`\nWords: ${page.metadata.wordCount} | Fetched: ${new Date(page.metadata.fetchTime).toLocaleTimeString()}`));
          break;
        }
        default:
          console.log(chalk.dim("Usage: /web [search|fetch]"));
      }
    },
  };
}
