/**
 * 9 Router CLI — Plugin Manager
 *
 * Discovers, loads, and manages plugin lifecycle based on the SimonW's LLM
 * and oclif hybrid approach with manifest-based discovery and hook registration.
 */

import { existsSync, readdirSync, statSync, readFileSync } from "fs";
import { join } from "path";

import type { Plugin, PluginManifest, PluginContext, Command, ModelInfo, Renderer, Tool } from "../core/types";
import type { RouterClient } from "../core/types";
import type { SessionManager } from "../core/types";
import type { Logger } from "../core/types";
import { getPluginDir } from "../utils/paths";
import { PluginLoadError } from "../core/errors";
import { eventBus } from "../core/events";

export class PluginManager {
  private plugins: Map<string, Plugin> = new Map();
  private contexts: Map<string, PluginContext> = new Map();
  private commands: Map<string, Command> = new Map();
  private models: ModelInfo[] = [];
  private renderers: Map<string, Renderer> = new Map();
  private tools: Map<string, Tool> = new Map();
  private keybindings: Map<string, string> = new Map();
  private searchPaths: string[];
  private router: RouterClient;
  private session: SessionManager;
  private logger: Logger;

  constructor(
    router: RouterClient,
    session: SessionManager,
    logger: Logger,
    additionalPaths: string[] = []
  ) {
    this.router = router;
    this.session = session;
    this.logger = logger;
    this.searchPaths = [getPluginDir(), ...additionalPaths];
  }

  /** Discover and load all plugins from search paths */
  async loadPlugins(enabledList?: string[]): Promise<void> {
    const manifests = this.discoverPlugins();

    for (const manifest of manifests) {
      if (enabledList && !enabledList.includes(manifest.name)) {
        continue; // Skip disabled plugins
      }

      try {
        await this.loadPlugin(manifest);
      } catch (error) {
        this.logger.error(`Failed to load plugin "${manifest.name}":`, error);
        eventBus.emit("plugin:unloaded", manifest.name);
      }
    }
  }

  /** Load a single plugin by its manifest */
  async loadPlugin(manifest: PluginManifest): Promise<void> {
    const pluginPath = this.resolvePluginPath(manifest.entry);
    if (!pluginPath) {
      throw new PluginLoadError(manifest.name, "Entry point not found");
    }

    // Load plugin module (dynamic import)
    let pluginModule: { default?: Plugin; activate?: (ctx: PluginContext) => Promise<void> };
    try {
      pluginModule = await import(/* @vite-ignore */ pluginPath);
    } catch (error) {
      throw new PluginLoadError(manifest.name, `Import failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    const plugin: Plugin = pluginModule.default
      ? { ...pluginModule.default, manifest }
      : { manifest, activate: pluginModule.activate ?? (async () => {}) };

    // Create plugin context
    const context = this.createPluginContext(manifest.name);

    try {
      await plugin.activate(context);
      this.plugins.set(manifest.name, plugin);
      this.contexts.set(manifest.name, context);
      this.logger.info(`Plugin loaded: ${manifest.name} v${manifest.version}`);
      eventBus.emit("plugin:loaded", manifest.name);
    } catch (error) {
      throw new PluginLoadError(manifest.name, `Activation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Unload a specific plugin */
  async unloadPlugin(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin) return;

    try {
      await plugin.deactivate?.();
    } catch (error) {
      this.logger.warn(`Plugin deactivation error: ${name}`, error);
    }

    // Remove plugin contributions
    const context = this.contexts.get(name);
    if (context) {
      // Plugin context methods would need tracking for selective removal
    }

    this.plugins.delete(name);
    this.contexts.delete(name);
    this.logger.info(`Plugin unloaded: ${name}`);
    eventBus.emit("plugin:unloaded", name);
  }

  /** Get a command registered by any plugin */
  getCommand(name: string): Command | undefined {
    return this.commands.get(name);
  }

  /** Get all plugin-registered commands */
  getCommands(): Command[] {
    return [...this.commands.values()];
  }

  /** Get all plugin-registered models */
  getModels(): ModelInfo[] {
    return [...this.models];
  }

  /** Get all loaded plugins */
  getPlugins(): Plugin[] {
    return [...this.plugins.values()];
  }

  /** Check if a specific plugin is loaded */
  isLoaded(name: string): boolean {
    return this.plugins.has(name);
  }

  /** Get plugin count */
  get count(): number {
    return this.plugins.size;
  }

  /** Reload all plugins */
  async reloadPlugins(): Promise<void> {
    for (const name of this.plugins.keys()) {
      await this.unloadPlugin(name);
    }
    await this.loadPlugins();
  }

  private discoverPlugins(): PluginManifest[] {
    const manifests: PluginManifest[] = [];

    for (const searchPath of this.searchPaths) {
      if (!existsSync(searchPath)) continue;

      const entries = readdirSync(searchPath);
      for (const entry of entries) {
        const fullPath = join(searchPath, entry);
        if (!statSync(fullPath).isDirectory()) continue;

        const pkgPath = join(fullPath, "package.json");
        if (!existsSync(pkgPath)) continue;

        try {
          const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

          // Check if this package has 9router-cli plugin metadata
          const pluginMeta = pkg["9router-cli-plugin"] ?? pkg["9r-plugin"];
          if (!pluginMeta) continue;

          manifests.push({
            name: pluginMeta.name ?? pkg.name ?? entry,
            version: pluginMeta.version ?? pkg.version ?? "0.0.0",
            description: pluginMeta.description ?? pkg.description ?? "",
            entry: pluginMeta.entry ?? pluginMeta.main ?? "index.js",
            hooks: pluginMeta.hooks ?? [],
          });
        } catch {
          // Skip invalid package.json
        }
      }
    }

    return manifests;
  }

  private resolvePluginPath(entry: string): string | null {
    for (const searchPath of this.searchPaths) {
      const candidates = [
        join(searchPath, entry),
        join(searchPath, entry, "index.js"),
        join(searchPath, entry, "index.ts"),
        join(searchPath, entry, "dist", "index.js"),
      ];

      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }
    return null;
  }

  private createPluginContext(pluginName: string): PluginContext {
    return {
      config: {} as any, // Will be populated by the CLI
      router: this.router,
      session: this.session,
      logger: this.logger.child({ plugin: pluginName }),

      addCommand: (command: Command) => {
        this.commands.set(command.name, command);
      },

      addModel: (model: ModelInfo) => {
        this.models.push(model);
      },

      addRenderer: (name: string, renderer: Renderer) => {
        this.renderers.set(name, renderer);
      },

      addKeybinding: (key: string, action: string) => {
        this.keybindings.set(key, action);
      },

      addTool: (tool: Tool) => {
        this.tools.set(tool.name, tool);
      },
    };
  }
}
