/**
 * 9 Router CLI — Architecture Inspector
 *
 * Analyzes the project structure, dependency graph, module boundaries,
 * public APIs, and builds an internal understanding for self-evolution.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative, dirname } from "path";
import { fileURLToPath } from "url";
import type {
  ArchitectureSnapshot,
  ModuleInfo,
  DependencyEdge,
  ApiEndpoint,
  CommandInfo,
} from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "..", "..");

export class ArchitectureInspector {
  private snapshot: ArchitectureSnapshot | null = null;
  private lastScan = 0;
  private cacheTTL = 30000; // 30 seconds

  /** Get or refresh the architecture snapshot */
  async getSnapshot(): Promise<ArchitectureSnapshot> {
    if (this.snapshot && Date.now() - this.lastScan < this.cacheTTL) {
      return this.snapshot;
    }

    this.snapshot = await this.scan();
    this.lastScan = Date.now();
    return this.snapshot;
  }

  /** Force a fresh scan */
  async refresh(): Promise<ArchitectureSnapshot> {
    this.snapshot = await this.scan();
    this.lastScan = Date.now();
    return this.snapshot;
  }

  /** Find which module owns a specific path */
  findModuleForPath(filePath: string): string | null {
    const srcPath = join(PROJECT_ROOT, "src");
    const rel = relative(srcPath, filePath);
    const parts = rel.split(/[\\/]/);

    // The module is the top-level directory under src/
    if (parts.length >= 1) {
      const moduleName = parts[0];
      // Validate it's one of our known modules
      const knownModules = [
        "commands", "core", "router", "chat", "render", "tui",
        "session", "config", "plugins", "logging", "utils", "skills",
      ];
      if (moduleName && knownModules.includes(moduleName)) {
        return moduleName;
      }
    }
    return null;
  }

  /** Get all exports from a specific module */
  getModuleExports(modulePath: string): string[] {
    const exports: string[] = [];
    const fullPath = join(PROJECT_ROOT, modulePath);

    if (!existsSync(fullPath)) return exports;

    const entries = readdirSync(fullPath);
    for (const entry of entries) {
      const entryPath = join(fullPath, entry);
      if (statSync(entryPath).isFile() && entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
        const content = readFileSync(entryPath, "utf-8");
        const exportMatches = content.matchAll(/^export\s+(?:type\s+)?(?:interface|class|function|const|enum|type|abstract\s+class)\s+(\w+)/gm);
        for (const match of exportMatches) {
          if (match[1]) exports.push(match[1]);
        }
      }
    }

    return exports;
  }

  /** Check if a capability already exists in the framework */
  capabilityExists(type: string, name: string): boolean {
    if (!this.snapshot) return false;

    switch (type) {
      case "command":
        return this.snapshot.commandRegistry.some((c) => c.name === name);
      case "plugin_api":
        return this.snapshot.pluginInterfaces.includes(name);
      case "event":
        return this.snapshot.eventSystem.includes(name);
      default:
        return false;
    }
  }

  /** Find the best module to extend for a new capability */
  findExtensionPoint(capabilityType: string): string | null {
    const extensionPoints: Record<string, string[]> = {
      command: ["src/commands/", "src/core/types.ts"],
      renderer: ["src/render/", "src/render/index.ts"],
      menu: ["src/tui/", "src/commands/"],
      widget: ["src/tui/"],
      tool: ["src/plugins/", "src/core/types.ts"],
      provider: ["src/router/", "src/plugins/"],
      storage: ["src/session/", "src/config/"],
      session: ["src/session/"],
      config: ["src/config/", "src/core/types.ts"],
      router: ["src/router/"],
      protocol: ["src/router/", "src/plugins/"],
      plugin_api: ["src/plugins/", "src/core/types.ts"],
      hook: ["src/plugins/", "src/core/types.ts"],
      event: ["src/core/events.ts"],
    };

    const paths = extensionPoints[capabilityType];
    if (!paths || paths.length === 0) return null;

    // Return the primary extension point
    return join(PROJECT_ROOT, paths[0]!);
  }

  /** Get the dependency chain for a module */
  getDependencyChain(moduleName: string): string[] {
    const deps: string[] = [];
    if (!this.snapshot) return deps;

    const findDeps = (name: string, visited: Set<string>) => {
      if (visited.has(name)) return;
      visited.add(name);

      for (const edge of this.snapshot!.dependencyGraph) {
        if (edge.from === name) {
          deps.push(edge.to);
          findDeps(edge.to, visited);
        }
      }
    };

    findDeps(moduleName, new Set());
    return deps;
  }

  /** Get all files that would be affected by a change to a module */
  getAffectedFiles(modulePath: string): string[] {
    const files: string[] = [];
    const fullPath = join(PROJECT_ROOT, "src", modulePath);
    if (!existsSync(fullPath)) return files;

    const scanDir = (dir: string) => {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const entryPath = join(dir, entry);
        if (statSync(entryPath).isDirectory()) {
          scanDir(entryPath);
        } else if (entry.endsWith(".ts")) {
          files.push(relative(PROJECT_ROOT, entryPath));
        }
      }
    };

    scanDir(fullPath);
    return files;
  }

  /** Build the full project file tree */
  private buildFileTree(): Record<string, string> {
    const tree: Record<string, string> = {};
    const srcPath = join(PROJECT_ROOT, "src");

    const walk = (dir: string) => {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const entryPath = join(dir, entry);
        if (statSync(entryPath).isDirectory()) {
          if (!entry.startsWith(".") && entry !== "node_modules") {
            walk(entryPath);
          }
        } else if (entry.endsWith(".ts")) {
          const rel = relative(PROJECT_ROOT, entryPath);
          tree[rel] = readFileSync(entryPath, "utf-8");
        }
      }
    };

    walk(srcPath);
    return tree;
  }

  /** Scan the project and build a complete architecture snapshot */
  private async scan(): Promise<ArchitectureSnapshot> {
    const srcPath = join(PROJECT_ROOT, "src");
    const modules: ModuleInfo[] = [];
    const dependencyGraph: DependencyEdge[] = [];
    const commandRegistry: CommandInfo[] = [];
    const publicApis: ApiEndpoint[] = [];
    const pluginInterfaces: string[] = [];
    const eventSystem: string[] = [];
    const renderingPipeline: string[] = [];

    // Scan each module directory
    const moduleDirs = readdirSync(srcPath).filter((d) =>
      statSync(join(srcPath, d)).isDirectory()
    );

    for (const moduleDir of moduleDirs) {
      const modulePath = join(srcPath, moduleDir);
      const files = readdirSync(modulePath)
        .filter((f) => f.endsWith(".ts"))
        .map((f) => `src/${moduleDir}/${f}`);

      const exports = this.getModuleExports(`src/${moduleDir}`);
      const tsFiles = files.filter((f) => f.endsWith(".ts"));

      // Parse imports to build dependency graph
      for (const file of tsFiles) {
        const content = readFileSync(join(PROJECT_ROOT, file), "utf-8");
        const importMatches = content.matchAll(/from\s+['"](\..*?)['"]/g);
        for (const match of importMatches) {
          if (match[1]) {
            const importPath = match[1].replace(/\.\.\//g, "").split("/")[0];
            if (importPath && importPath !== moduleDir) {
              dependencyGraph.push({
                from: moduleDir,
                to: importPath,
                type: "import",
              });
            }
          }
        }

        // Find command registrations
        const cmdMatches = content.matchAll(/name:\s*['"](\/?.+?)['"]/g);
        for (const match of cmdMatches) {
          if (match[1]) {
            commandRegistry.push({
              name: match[1],
              aliases: [],
              description: "",
              file,
            });
          }
        }

        // Find event system references
        if (content.includes("eventBus.") || content.includes("EventBus")) {
          const eventMatches = content.matchAll(/emit\(['"](.+?)['"]/g);
          for (const match of eventMatches) {
            if (match[1] && !eventSystem.includes(match[1])) {
              eventSystem.push(match[1]);
            }
          }
        }

        // Find plugin interfaces
        if (content.includes("Plugin") || content.includes("plugin")) {
          const ifaceMatches = content.matchAll(/interface\s+(\w*Plugin\w*)/g);
          for (const match of ifaceMatches) {
            if (match[1]) pluginInterfaces.push(match[1]);
          }
        }
      }

      modules.push({
        name: moduleDir,
        path: `src/${moduleDir}`,
        exports,
        imports: [],
        responsibilities: [],
        files,
      });
    }

    // Detect rendering pipeline
    if (existsSync(join(srcPath, "render"))) {
      const renderFiles = readdirSync(join(srcPath, "render"));
      for (const file of renderFiles) {
        if (file.endsWith(".ts")) {
          renderingPipeline.push(`src/render/${file}`);
        }
      }
    }

    return {
      modules,
      dependencyGraph: this.deduplicateEdges(dependencyGraph),
      publicApis,
      pluginInterfaces,
      renderingPipeline,
      commandRegistry,
      eventSystem,
      configSchema: {},
      fileTree: this.buildFileTree(),
    };
  }

  private deduplicateEdges(edges: DependencyEdge[]): DependencyEdge[] {
    const seen = new Set<string>();
    return edges.filter((e) => {
      const key = `${e.from}->${e.to}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
