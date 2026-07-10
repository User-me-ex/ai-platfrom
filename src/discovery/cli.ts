import { CliDiscoveryEngine } from "./engine";
import type { DiscoveryConfig } from "./types";

const DEFAULT_CONFIG: DiscoveryConfig = {
  enabled: true,
  userPaths: [],
  workspaceDirs: [],
  scanCommonLocations: true,
  scanEnvPath: true,
  configuredProjects: [],
  maxDepth: 3,
  excludePatterns: ["node_modules", ".git", "dist", "target"],
};

async function main() {
  const args = process.argv.slice(2);

  const config: DiscoveryConfig = {
    ...DEFAULT_CONFIG,
    ...(args.includes("--paths")
      ? { userPaths: args.slice(args.indexOf("--paths") + 1).filter((a) => !a.startsWith("-")) }
      : {}),
  };

  if (args.includes("--scan-env")) config.scanEnvPath = true;
  if (args.includes("--no-env")) config.scanEnvPath = false;

  const engine = new CliDiscoveryEngine();
  const discovered = engine.discover(config);

  console.log(`Discovered ${discovered.length} AI CLIs:\n`);

  for (const cli of discovered) {
    console.log(`  ${cli.name}`);
    console.log(`    Binary: ${cli.binaryPath}`);
    console.log(`    Framework: ${cli.identification.framework}`);
    console.log(`    Language: ${cli.identification.language}`);
    console.log(`    Commands: ${cli.inventory.commands.join(", ") || "none"}`);
    console.log(`    Capabilities: ${cli.inventory.capabilities.join(", ") || "none"}`);
    console.log(`    Plugin System: ${cli.inventory.pluginSystem || "none"}`);
    console.log(`    Rendering: ${cli.inventory.renderingEngine || "unknown"}`);
    console.log("");
  }

  if (args.includes("--json")) {
    console.log(JSON.stringify(discovered, null, 2));
  }
}

main().catch(console.error);
