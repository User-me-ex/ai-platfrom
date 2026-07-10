export interface DiscoveredCli {
  name: string;
  binaryPath: string;
  projectRoot?: string;
  detectedAt: string;

  identification: CliIdentity;
  inventory: CliFeatureInventory;
}

export interface CliIdentity {
  displayName: string;
  version: string;
  language: string;
  framework: string;
  description: string;
  repository?: string;
  license?: string;
}

export interface CliFeatureInventory {
  architecture: ArchitectureInfo;
  commands: string[];
  pluginSystem: string | null;
  configFiles: string[];
  renderingEngine: string | null;
  extensionPoints: string[];
  capabilities: string[];
  modelProviders: string[];
  tools: string[];
  storage: string | null;
  securityFeatures: string[];
  performanceFeatures: string[];
}

export interface ArchitectureInfo {
  layers: string[];
  entryPoint: string | null;
  modules: string[];
  dependencyGraph: string[];
}

export type DiscoverySource =
  | { type: "user_path"; path: string }
  | { type: "workspace"; path: string }
  | { type: "common_location"; path: string }
  | { type: "env_path"; binary: string }
  | { type: "configured"; path: string };

export interface DiscoveryConfig {
  enabled: boolean;
  userPaths: string[];
  workspaceDirs: string[];
  scanCommonLocations: boolean;
  scanEnvPath: boolean;
  configuredProjects: string[];
  maxDepth: number;
  excludePatterns: string[];
}
