/**
 * 9 Router CLI — Configuration Schema
 */

import type { Config } from "../core/types";

export const DEFAULT_CONFIG: Config = {
  baseUrl: "http://localhost:20128/v1",
  apiKey: undefined,
  defaultModel: "",
  modelRefreshInterval: 300,
  theme: "dark",
  syntaxTheme: "dracula",
  connections: [
    { name: "local", baseUrl: "http://localhost:20128/v1", apiKey: undefined },
  ],
  activeConnection: "local",
  render: {
    markdown: true,
    syntaxHighlight: true,
    animateStreaming: true,
    maxRenderWidth: 0,
  },
  streaming: {
    enabled: true,
    showTokens: true,
    thinking: true,
  },
  session: {
    autoSave: true,
    maxHistory: 100,
    exportFormat: "json",
  },
  logging: {
    level: "info",
    file: undefined,
  },
  plugins: {
    enabled: [],
    paths: [],
  },
  performance: {
    lazyLoadPlugins: true,
    cacheModels: true,

    // Extended performance configuration
    memoryCacheSizeMB: 50,
    cacheEvictionIntervalMs: 60000,
    workerPoolConcurrency: 4,
    schedulerConcurrency: 4,
    fileIndexingEnabled: true,
    fileWatchingEnabled: true,
    streamingEnabled: true,
    benchmarkOnStartup: false,
    lazyModuleLoading: true,
    objectPooling: true,
    incrementalIndexing: true,
    maxBackupSizeMB: 100,
  },
  keybindings: {
    "ctrl-c": "abort",
    "ctrl-d": "exit",
    "ctrl-l": "clear",
    "ctrl-n": "new",
    "up": "historyPrev",
    "down": "historyNext",
    "tab": "autocomplete",
    "escape": "cancel",
  },

  // New subsystems
  memory: {
    enabled: true,
    fts5Search: true,
    vectorMemory: true,
    modelCacheEnabled: true,
    maxSessions: 1000,
    recallLimit: 5,
  },
  automation: {
    enabled: false,
    maxConcurrentJobs: 5,
    defaultCronTimezone: "UTC",
    lifecycleGuard: true,
  },
  security: {
    enabled: true,
    threatDetection: true,
    fileSafetyChecks: true,
    pluginSandboxing: false,
    allowedPaths: [],
    deniedPaths: [],
  },
  personas: {
    enabled: true,
    defaultPersona: "default",
    reasoningEffort: "medium",
  },
  gateways: {
    enabled: false,
  },
  web: {
    enabled: true,
    browserEngine: "playwright",
    maxResults: 5,
    timeout: 15000,
  },
  orchestration: {
    enabled: false,
    maxSubagents: 5,
    taskTimeout: 60000,
  },
};
