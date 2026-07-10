/**
 * 9 Router CLI — Command Registry
 *
 * Manages registration and dispatch of built-in and plugin slash commands.
 */

import type { Command, CommandContext } from "../core/types";
import { BUILTIN_COMMANDS } from "../core/constants";

export class CommandRegistry {
  private commands: Map<string, Command> = new Map();
  private aliases: Map<string, string> = new Map();

  constructor() {
    this.registerBuiltinCommands();
  }

  /** Register a command */
  register(command: Command): void {
    this.commands.set(command.name, command);

    if (command.aliases) {
      for (const alias of command.aliases) {
        this.aliases.set(alias, command.name);
      }
    }
  }

  /** Get a command by name or alias */
  get(name: string): Command | undefined {
    // Check exact match first
    let cmd = this.commands.get(name);
    if (cmd) return cmd;

    // Check alias
    const resolved = this.aliases.get(name);
    if (resolved) return this.commands.get(resolved);

    return undefined;
  }

  /** Check if a command exists */
  has(name: string): boolean {
    return this.commands.has(name) || this.aliases.has(name);
  }

  /** Get all registered commands */
  getAll(): Command[] {
    return [...this.commands.values()];
  }

  /** Get command names for autocomplete */
  getNames(): string[] {
    return [...this.commands.keys(), ...this.aliases.keys()].sort();
  }

  /** Execute a command by name */
  async execute(name: string, args: string[], context: CommandContext): Promise<void> {
    const command = this.get(name);
    if (!command) {
      throw new Error(`Unknown command: /${name}. Type /help for available commands.`);
    }

    await command.execute(args, context);
  }

  /** Autocomplete suggestion for partial command input */
  autocomplete(partial: string): string[] {
    const partialLower = partial.toLowerCase();
    return this.getNames().filter((name) => name.startsWith(partialLower));
  }

  private registerBuiltinCommands(): void {
    // Register basic command stubs that will be enhanced
    // The actual implementations are registered in cli.ts with full context
    for (const cmd of BUILTIN_COMMANDS) {
      this.register({
        name: cmd.name,
        description: cmd.description,
        usage: cmd.usage,
        execute: async () => {
          throw new Error(`Command /${cmd.name} not fully initialized`);
        },
      });
    }
  }
}
