import chalk from "chalk";
import type { Command } from "../core/types";
import type { PersonaManager } from "../personas/index";
import { getTerminalWidth } from "../utils/terminal";

export function createPersonaCommand(personas: PersonaManager): Command {
  return {
    name: "persona",
    description: "Manage AI personality and reasoning settings",
    aliases: ["personality", "style"],
    usage: "/persona [list|set|effort|current] [name]",
    async execute(args) {
      const sub = args[0] ?? "current";
      switch (sub) {
        case "list": {
          const all = personas.listPersonas();
          console.log(chalk.cyan.bold("Available Personas"));
          console.log(chalk.dim("─".repeat(getTerminalWidth() - 2)));
          for (const p of all) {
            const color = chalk.hex(p.color);
            const current = p.id === personas.getCurrentPersona().id;
            console.log(`  ${current ? chalk.green("●") : chalk.dim("○")} ${color(p.name.padEnd(20))} ${chalk.dim(p.description)}`);
          }
          console.log(chalk.dim("\nUse /persona set <name> to switch"));
          break;
        }
        case "set": {
          const name = args[1];
          if (!name) { console.log(chalk.red("Usage: /persona set <name>")); return; }
          if (personas.setPersona(name)) {
            console.log(chalk.green(`✓ Switched to persona: ${personas.getCurrentPersona().name}`));
          } else {
            console.log(chalk.red(`✗ Unknown persona: ${name}. Use /persona list to see available ones.`));
          }
          break;
        }
        case "effort": {
          const effort = args[1] as any;
          if (!effort || !["low", "medium", "high"].includes(effort)) {
            console.log(chalk.red("Usage: /persona effort [low|medium|high]"));
            return;
          }
          personas.setEffort(effort);
          console.log(chalk.green(`✓ Reasoning effort set to: ${effort}`));
          break;
        }
        default: {
          const p = personas.getCurrentPersona();
          const color = chalk.hex(p.color);
          console.log(color.bold(`Current Persona: ${p.name}`));
          console.log(chalk.dim("─".repeat(getTerminalWidth() - 2)));
          console.log(`  Style:      ${chalk.white(p.responseStyle)}`);
          console.log(`  Effort:     ${chalk.white(personas.getEffort())}`);
          console.log(`  Temp:       ${chalk.white(String(personas.getTemperature()))}`);
          break;
        }
      }
    },
  };
}
