/**
 * 9 Router CLI — Core Type Definitions
 */

/** Represents a model discovered from 9 Router */
export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  providerDisplayName: string;
  contextLength: number;
  capabilities: ModelCapabilities;
  pricing?: ModelPricing;
  metadata: Record<string, unknown>;
}

export interface ModelCapabilities {
  reasoning: boolean;
  vision: boolean;
  audio: boolean;
  toolUse: boolean;
  functionCalling: boolean;
  streaming: boolean;
}

export interface ModelPricing {
  input: number;
  output: number;
}

/** A single message in a conversation */
export interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  modelId?: string;
  tokensIn?: number;
  tokensOut?: number;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

/** A conversation session */
export interface Session {
  id: string;
  name: string;
  modelId: string;
  systemPrompt?: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  tokenCount: number;
  messageCount: number;
  metadata?: Record<string, unknown>;
}

/** Stream events from the router */
export type StreamEvent =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "tool_start"; tool: string; input: unknown }
  | { type: "tool_end"; tool: string; output: unknown }
  | { type: "error"; message: string; code?: string }
  | { type: "done"; usage?: TokenUsage };

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

/** CLI configuration */
export interface Config {
  baseUrl: string;
  apiKey?: string;
  defaultModel: string;
  modelRefreshInterval: number;
  theme: string;
  syntaxTheme: string;
  render: RenderConfig;
  streaming: StreamingConfig;
  session: SessionConfig;
  logging: LoggingConfig;
  plugins: PluginsConfig;
  performance: PerformanceConfig;
  keybindings: Record<string, string>;
  
  // New subsystems
  memory: MemoryConfig;
  automation: AutomationConfig;
  security: SecurityConfig;
  personas: PersonasConfig;
  gateways: GatewaysConfig;
  web: WebConfig;
  orchestration: OrchestrationConfig;

  // Multi-connection support
  connections: ServerConnection[];
  activeConnection: string;
}

export interface MemoryConfig {
  enabled: boolean;
  fts5Search: boolean;
  vectorMemory: boolean;
  modelCacheEnabled: boolean;
  maxSessions: number;
  recallLimit: number;
}

export interface AutomationConfig {
  enabled: boolean;
  maxConcurrentJobs: number;
  defaultCronTimezone: string;
  lifecycleGuard: boolean;
}

export interface SecurityConfig {
  enabled: boolean;
  threatDetection: boolean;
  fileSafetyChecks: boolean;
  pluginSandboxing: boolean;
  allowedPaths: string[];
  deniedPaths: string[];
}

export interface PersonasConfig {
  enabled: boolean;
  defaultPersona: string;
  reasoningEffort: "low" | "medium" | "high";
}

export interface GatewaysConfig {
  enabled: boolean;
  telegram?: { botToken: string; chatId: string };
  discord?: { botToken: string; channelId: string };
  slack?: { botToken: string; channelId: string };
}

export interface WebConfig {
  enabled: boolean;
  browserEngine: "playwright" | "puppeteer";
  maxResults: number;
  timeout: number;
}

export interface OrchestrationConfig {
  enabled: boolean;
  maxSubagents: number;
  taskTimeout: number;
}

export interface RenderConfig {
  markdown: boolean;
  syntaxHighlight: boolean;
  animateStreaming: boolean;
  maxRenderWidth: number;
}

export interface StreamingConfig {
  enabled: boolean;
  showTokens: boolean;
  thinking: boolean;
}

export interface SessionConfig {
  autoSave: boolean;
  maxHistory: number;
  exportFormat: "json" | "md";
}

export interface LoggingConfig {
  level: "debug" | "info" | "warn" | "error";
  file?: string;
}

export interface PluginsConfig {
  enabled: string[];
  paths: string[];
}

export interface PerformanceConfig {
  lazyLoadPlugins: boolean;
  cacheModels: boolean;

  // Extended performance configuration
  memoryCacheSizeMB: number;
  cacheEvictionIntervalMs: number;
  workerPoolConcurrency: number;
  schedulerConcurrency: number;
  fileIndexingEnabled: boolean;
  fileWatchingEnabled: boolean;
  streamingEnabled: boolean;
  benchmarkOnStartup: boolean;
  lazyModuleLoading: boolean;
  objectPooling: boolean;
  incrementalIndexing: boolean;
  maxBackupSizeMB: number;
}

export interface PerformanceMemoryConfig {
  maxCacheSizeMB: number;
  evictionIntervalMs: number;
  enableObjectPooling: boolean;
  enableLazyLoading: boolean;
}

export interface PerformanceParallelConfig {
  concurrency: number;
  enableConflictDetection: boolean;
}

export interface PerformanceSchedulerConfig {
  concurrency: number;
  defaultTimeout: number;
  maxRetries: number;
}

export interface PerformanceEditorConfig {
  backupDir: string;
  enableBackups: boolean;
  maxConcurrentEdits: number;
}

export interface PerformanceFileSystemConfig {
  enableIndexing: boolean;
  enableWatching: boolean;
  incrementalIndexing: boolean;
  codeExtensions: string[];
}

export interface PerformanceStreamingConfig {
  enabled: boolean;
  showTimestamps: boolean;
  progressBarWidth: number;
}

export interface PerformanceBenchmarkConfig {
  enabled: boolean;
  runOnStartup: boolean;
  logThresholdMs: number;
}

/** Stream callback for rendering */
export type StreamCallback = (event: StreamEvent) => void | Promise<void>;

/** Command definition */
export interface Command {
  name: string;
  description: string;
  aliases?: string[];
  usage?: string;
  execute(args: string[], context: CommandContext): Promise<void>;
}

export interface CommandContext {
  config: Config;
  chat: ChatEngine;
  router: RouterClient;
  session: SessionManager;
  renderer: Renderer;
  logger: Logger;
  modelRegistry?: ModelRegistry;
}

export interface ModelRegistry {
  listModels(): ModelInfo[];
  getModel(id: string): ModelInfo | undefined;
  searchModels(query: string): ModelInfo[];
  groupByProvider(): Map<string, ModelInfo[]>;
  getProviders(): string[];
  refreshModels(): Promise<ModelInfo[]>;
  count: number;
  hasModels(): boolean;
}

/** Plugin interface */
export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  entry: string;
  hooks: PluginHookType[];
}

export type PluginHookType =
  | "registerCommands"
  | "registerModels"
  | "registerRenderers"
  | "registerTools"
  | "registerKeybindings"
  | "onInit"
  | "onChatStart"
  | "onChatEnd"
  | "onConfigChange";

export interface PluginContext {
  config: Config;
  router: RouterClient;
  session: SessionManager;
  logger: Logger;
  addCommand(command: Command): void;
  addModel(model: ModelInfo): void;
  addRenderer(name: string, renderer: Renderer): void;
  addKeybinding(key: string, action: string): void;
  addTool(tool: Tool): void;
}

export interface Plugin {
  manifest: PluginManifest;
  activate(context: PluginContext): Promise<void>;
  deactivate?(): Promise<void>;
}

export interface Tool {
  name: string;
  description: string;
  execute(input: unknown): Promise<unknown>;
}

/** Renderer interface */
export interface Renderer {
  render(content: string): string;
  renderStream(token: string, state: RenderState): string;
}

export interface RenderState {
  buffer: string;
  blocks: RenderedBlock[];
  activeBlock: string;
}

export interface RenderedBlock {
  type: "paragraph" | "code" | "list" | "table" | "blockquote" | "heading" | "thematic_break";
  content: string;
  finalized: boolean;
}

/** Router client interface */
export interface RouterClient {
  baseUrl: string;
  listModels(): Promise<ModelInfo[]>;
  chatCompletionStream(params: ChatParams): AsyncIterable<StreamEvent>;
  chatCompletion(params: ChatParams): Promise<ChatResponse>;
  ping(): Promise<boolean>;
  getStatus(): Promise<RouterStatus>;
}

export interface ChatParams {
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream?: boolean;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ChatResponse {
  id: string;
  content: string;
  model: string;
  usage?: TokenUsage;
}

export interface RouterStatus {
  connected: boolean;
  version?: string;
  modelsCount: number;
  uptime?: number;
}

/** A saved 9 Router server connection */
export interface ServerConnection {
  name: string;
  baseUrl: string;
  apiKey?: string;
  defaultModel?: string;
}

/** Logger interface */
export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  child(context: Record<string, unknown>): Logger;
}

/** Session manager interface */
export interface SessionManager {
  createSession(name?: string, modelId?: string, systemPrompt?: string): Promise<Session>;
  getSession(id: string): Promise<Session | null>;
  listSessions(limit?: number, offset?: number): Promise<Session[]>;
  updateSession(id: string, updates: Partial<Session>): Promise<void>;
  deleteSession(id: string): Promise<void>;
  searchSessions(query: string): Promise<Session[]>;
  addMessage(sessionId: string, message: Message): Promise<void>;
  exportSession(id: string, format: "json" | "md"): Promise<string>;
  importSession(data: string): Promise<Session>;
  getCurrentSession(): Promise<Session | null>;
  setCurrentSession(id: string): Promise<void>;
}

/** Chat engine interface */
export interface ChatEngine {
  currentModel: string;
  startChat(modelId?: string, systemPrompt?: string): Promise<void>;
  sendMessage(content: string, onStream?: StreamCallback): Promise<string>;
  abortStream(): void;
  isStreaming(): boolean;
  getConversation(): Message[];
  clearConversation(): void;
  setSystemPrompt(prompt: string): void;
  getSystemPrompt(): string;
  setModel(modelId: string): void;
  getContextStats(): ContextStats;
}

export interface ContextStats {
  totalTokens: number;
  messageCount: number;
  percentageUsed: number;
}
