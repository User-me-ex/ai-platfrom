import { existsSync, readFileSync, readdirSync } from "fs";
import { join, basename } from "path";
import type { DiscoveredCli, CliFeatureInventory, DiscoveryConfig } from "./types";

const COMMON_AI_CLI_BINS = [
  "opencode", "opencode-ai",
  "claude", "claude-code",
  "aider", "aider-chat",
  "gemini", "gemini-cli",
  "copilot", "github-copilot-cli",
  "codebuff",
  "cursor", "cursor-cli",
  "mentat",
  "sweep",
  "continue",
  "tabby",
];

const COMMON_INSTALL_DIRS = [
  ...(process.platform === "win32"
    ? [
        join(process.env.ProgramFiles || "C:\\Program Files", "opencode"),
        join(process.env.ProgramFiles || "C:\\Program Files", "Claude Code"),
        join(process.env.ProgramFiles || "C:\\Program Files", "Aider"),
        join(process.env.APPDATA || "", "npm"),
        join(process.env.LOCALAPPDATA || "", "npm"),
      ]
    : [
        "/usr/local/bin",
        "/usr/bin",
        "/opt/homebrew/bin",
        join(process.env.HOME || "", ".local/bin"),
        join(process.env.HOME || "", "bin"),
      ]),
];

export class CliDiscoveryEngine {
  private discovered: Map<string, DiscoveredCli> = new Map();

  discover(config: DiscoveryConfig): DiscoveredCli[] {
    this.discovered.clear();

    for (const p of config.userPaths) {
      this.scanDirectory(p, config);
    }
    for (const dir of config.workspaceDirs) {
      this.scanDirectory(dir, config);
    }
    for (const p of config.configuredProjects) {
      this.scanDirectory(p, config);
    }
    if (config.scanCommonLocations) {
      for (const dir of COMMON_INSTALL_DIRS) {
        if (existsSync(dir)) {
          this.scanDirectory(dir, config);
        }
      }
    }
    if (config.scanEnvPath) {
      const envPath = process.env.PATH || "";
      const pathDirs = envPath.split(";").filter(Boolean);
      for (const bin of COMMON_AI_CLI_BINS) {
        for (const dir of pathDirs) {
          const full = join(dir, bin + (process.platform === "win32" ? ".exe" : ""));
          if (existsSync(full)) {
            this.analyzeBinary(full, bin);
            break;
          }
        }
      }
    }

    return Array.from(this.discovered.values());
  }

  getDiscovered(): DiscoveredCli[] {
    return Array.from(this.discovered.values());
  }

  getCli(name: string): DiscoveredCli | undefined {
    return this.discovered.get(name.toLowerCase());
  }

  private scanDirectory(dir: string, _config: DiscoveryConfig): void {
    if (!existsSync(dir)) return;
    this.analyzeProject(dir);
  }

  private analyzeProject(rootDir: string): void {
    const packageJsonPath = join(rootDir, "package.json");
    if (existsSync(packageJsonPath)) {
      const cli = this.analyzeNodeProject(rootDir);
      if (cli) this.discovered.set(cli.name.toLowerCase(), cli);
      return;
    }

    const pyProjectPath = join(rootDir, "pyproject.toml");
    if (existsSync(pyProjectPath)) {
      const cli = this.analyzeGenericProject(rootDir, "Python", "Python CLI");
      if (cli) this.discovered.set(cli.name.toLowerCase(), cli);
      return;
    }

    const cargoPath = join(rootDir, "Cargo.toml");
    if (existsSync(cargoPath)) {
      const cli = this.analyzeGenericProject(rootDir, "Rust", "Rust CLI");
      if (cli) this.discovered.set(cli.name.toLowerCase(), cli);
      return;
    }

    const goModPath = join(rootDir, "go.mod");
    if (existsSync(goModPath)) {
      const cli = this.analyzeGenericProject(rootDir, "Go", "Go CLI");
      if (cli) this.discovered.set(cli.name.toLowerCase(), cli);
    }
  }

  private analyzeNodeProject(rootDir: string): DiscoveredCli | null {
    try {
      const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf-8"));
      const hasInk = this.checkDependency(pkg, /ink/);
      const hasCommander = this.checkDependency(pkg, /commander/);

      let framework = "Node.js CLI";
      if (hasInk) framework = "Ink (React-based)";

      const inventory: CliFeatureInventory = {
        architecture: {
          layers: [],
          entryPoint: pkg.main || "index.js",
          modules: Object.keys(pkg.scripts || {}),
          dependencyGraph: [],
        },
        commands: Object.keys(pkg.bin || {}),
        pluginSystem: this.detectPluginSystem(rootDir, pkg),
        configFiles: this.findConfigFiles(rootDir),
        renderingEngine: hasInk ? "Ink (Flexbox/React)" : hasCommander ? "Commander.js" : "Unknown",
        extensionPoints: [],
        capabilities: this.detectCapabilities(pkg),
        modelProviders: [],
        tools: [],
        storage: this.detectStorage(pkg),
        securityFeatures: [],
        performanceFeatures: [],
      };

      return {
        name: pkg.name,
        binaryPath: rootDir,
        projectRoot: rootDir,
        detectedAt: new Date().toISOString(),
        identification: {
          displayName: pkg.name,
          version: pkg.version,
          language: "TypeScript/JavaScript",
          framework,
          description: pkg.description || "",
          repository: pkg.repository?.url || pkg.repository,
          license: pkg.license,
        },
        inventory,
      };
    } catch {
      return null;
    }
  }

  private analyzeGenericProject(rootDir: string, language: string, framework: string): DiscoveredCli | null {
    return {
      name: basename(rootDir),
      binaryPath: rootDir,
      projectRoot: rootDir,
      detectedAt: new Date().toISOString(),
      identification: {
        displayName: basename(rootDir),
        version: "unknown",
        language,
        framework,
        description: "",
      },
      inventory: {
        architecture: { layers: [], entryPoint: null, modules: [], dependencyGraph: [] },
        commands: [],
        pluginSystem: null,
        configFiles: [],
        renderingEngine: null,
        extensionPoints: [],
        capabilities: [],
        modelProviders: [],
        tools: [],
        storage: null,
        securityFeatures: [],
        performanceFeatures: [],
      },
    };
  }

  private analyzeBinary(binPath: string, binName: string): void {
    if (this.discovered.has(binName.toLowerCase())) return;
    const cli: DiscoveredCli = {
      name: binName,
      binaryPath: binPath,
      detectedAt: new Date().toISOString(),
      identification: {
        displayName: binName,
        version: "unknown",
        language: "unknown",
        framework: "Binary",
        description: `AI CLI binary found at ${binPath}`,
      },
      inventory: {
        architecture: { layers: [], entryPoint: null, modules: [], dependencyGraph: [] },
        commands: [],
        pluginSystem: null,
        configFiles: [],
        renderingEngine: null,
        extensionPoints: [],
        capabilities: [],
        modelProviders: [],
        tools: [],
        storage: null,
        securityFeatures: [],
        performanceFeatures: [],
      },
    };
    this.discovered.set(binName.toLowerCase(), cli);
  }

  private checkDependency(pkg: any, pattern: RegExp): boolean {
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    return Object.keys(all).some((d) => pattern.test(d));
  }

  private detectPluginSystem(rootDir: string, pkg: any): string | null {
    if (this.checkDependency(pkg, /plugin/)) return "NPM plugin system";
    if (existsSync(join(rootDir, "plugins"))) return "Custom plugin system";
    return null;
  }

  private findConfigFiles(rootDir: string): string[] {
    const configs: string[] = [];
    for (const pattern of [".json", ".yaml", ".yml", ".toml", ".env", ".config.*"]) {
      try {
        const files = readdirSync(rootDir).filter((f) => f.endsWith(pattern) || f.startsWith(".") && f.includes(pattern));
        configs.push(...files);
      } catch {}
    }
    return configs;
  }

  private detectCapabilities(pkg: any): string[] {
    const caps: string[] = [];
    if (pkg.bin) caps.push("CLI entry points");
    if (this.checkDependency(pkg, /stream/)) caps.push("Streaming output");
    if (this.checkDependency(pkg, /markdown|marked|remark/)) caps.push("Markdown rendering");
    if (this.checkDependency(pkg, /syntax|shiki|highlight/)) caps.push("Syntax highlighting");
    if (this.checkDependency(pkg, /sqlite|better-sqlite/)) caps.push("Local storage");
    if (this.checkDependency(pkg, /commander|yargs/)) caps.push("Command parsing");
    return caps;
  }

  private detectStorage(pkg: any): string | null {
    if (this.checkDependency(pkg, /sqlite/)) return "SQLite";
    if (this.checkDependency(pkg, /redis/)) return "Redis";
    if (this.checkDependency(pkg, /mongodb/)) return "MongoDB";
    return null;
  }
}
