import type { ThemeName } from "./themes";

export type { ThemeName };

export type TuiView = "chat" | "start" | "model-picker" | "session-list" | "settings" | "help" | "logs" | "command-palette" | "submenu" | "sidebar" | "quota" | "connect";

export type ModelSelectorScreen = "menu" | "providers" | "provider-models" | "all-models" | "combos";

export type SortKey = "name" | "context" | "pricing" | "provider";

export interface FilterState {
  provider: string | null;
  capability: ModelCapability | null;
  sort: SortKey;
  asc: boolean;
}

export interface LocalCombo {
  id: string;
  name: string;
  description: string;
  models: string[];
  useCase: string;
  icon: string;
}

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export type PermissionMode = "auto" | "accept" | "plan";

export interface Theme {
  name: string;
  primary: string;
  secondary: string;
  success: string;
  error: string;
  warning: string;
  info: string;
  dim: string;
  border: string;
  borderActive: string;
  background: string;
  surface: string;
  overlay: string;
  text: string;
  textDim: string;
  textInverse: string;
  placeholder: string;
  inputBg: string;
  userBubble: string;
  assistantBubble: string;
  systemBubble: string;
  toolBubble: string;
  scrollbar: string;
  scrollbarThumb: string;
  tabActive: string;
  tabInactive: string;
  tabBorder: string;
  statusBg: string;
  statusBorder: string;
  sidebarBg: string;
  sidebarBorder: string;
  highlight: string;
  danger: string;
}

export interface TuiState {
  view: TuiView;
  messages: Message[];
  currentInput: string;
  isStreaming: boolean;
  connectionStatus: ConnectionStatus;
  selectedModel: string;
  selectedProvider: string;
  availableModels: ModelInfo[];
  sessionName: string;
  sessionList: SessionInfo[];
  permissionRequest: PermissionRequest | null;
  notifications: Notification[];
  theme: Theme;
  themeName: ThemeName;
  sidebarOpen: boolean;
  contextUsage: number;
  maxContext: number;
  costTokens: number;
  permissionMode: PermissionMode;
  showCommandPalette: boolean;
  commandPaletteQuery: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  providerDisplayName: string;
  capabilities: ModelCapability[];
  contextWindow: number;
  speed: string;
  cost: string;
}

export type ModelCapability = "text" | "vision" | "audio" | "live" | "tools" | "mcp" | "reasoning";

export interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  toolCalls?: ToolCall[];
  tokensIn?: number;
  tokensOut?: number;
  cost?: number;
  model?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  args: string;
  result?: string;
  status: "pending" | "running" | "approved" | "denied" | "completed" | "error";
  durationMs?: number;
  collapsed?: boolean;
}

export interface SessionInfo {
  id: string;
  name: string;
  model: string;
  messageCount: number;
  createdAt: Date;
  isActive: boolean;
}

export interface PermissionRequest {
  id: string;
  toolName: string;
  description: string;
  resolve: (allowed: boolean) => void;
}

export interface Notification {
  id: string;
  message: string;
  type: "info" | "success" | "error" | "warning";
  timestamp: Date;
  duration?: number;
}

export interface CommandItem {
  id: string;
  name: string;
  description: string;
  category: CommandCategory;
  shortcut?: string;
  icon?: string;
  aliases?: string[];
  submenu?: boolean;
}

export type CommandCategory = "ai" | "model" | "session" | "tools" | "settings" | "help" | "navigation";

export type Action =
  | { type: "SET_VIEW"; view: TuiView }
  | { type: "ADD_MESSAGE"; message: Message }
  | { type: "UPDATE_MESSAGE"; id: string; content: string }
  | { type: "STREAM_TOKEN"; id: string; token: string }
  | { type: "SET_STREAMING"; isStreaming: boolean }
  | { type: "SET_INPUT"; input: string }
  | { type: "SET_CONNECTION"; status: ConnectionStatus }
  | { type: "SET_MODEL"; model: string }
  | { type: "SET_PROVIDER"; provider: string }
  | { type: "SET_MODELS"; models: ModelInfo[] }
  | { type: "SET_SESSION"; name: string }
  | { type: "SET_SESSION_LIST"; sessions: SessionInfo[] }
  | { type: "SET_PERMISSION"; request: PermissionRequest | null }
  | { type: "SET_PERMISSION_MODE"; mode: PermissionMode }
  | { type: "ADD_NOTIFICATION"; notification: Notification }
  | { type: "REMOVE_NOTIFICATION"; id: string }
  | { type: "CLEAR_MESSAGES" }
  | { type: "SET_THEME"; theme: ThemeName }
  | { type: "SET_SIDEBAR"; open: boolean }
  | { type: "SET_CONTEXT_USAGE"; used: number; max: number }
  | { type: "SET_COST_TOKENS"; tokens: number }
  | { type: "SET_COMMAND_PALETTE"; show: boolean; query?: string }
  | { type: "SHOW_SUBMENU"; items: SubmenuItem[]; title: string; onSelect: string }
  | { type: "HIDE_SUBMENU" };

export interface SubmenuItem {
  id: string;
  label: string;
  description?: string;
  badges?: string[];
  group?: string;
}

export interface TuiConnection {
  name: string;
  baseUrl: string;
  apiKey?: string;
}

export interface TuiContextValue {
  state: TuiState;
  dispatch: (action: Action) => void;
}

export const COMMANDS: CommandItem[] = [
  { id: "model", name: "model", description: "Switch AI model", category: "model", icon: "M", shortcut: "Ctrl+P", submenu: true },
  { id: "provider", name: "provider", description: "Switch AI provider", category: "model", icon: "P", shortcut: "Ctrl+Shift+P" },
  { id: "theme", name: "theme", description: "Change color theme", category: "settings", icon: "T", shortcut: "Ctrl+T", submenu: true },
  { id: "help", name: "help", description: "Show help and commands", category: "help", icon: "?", shortcut: "Ctrl+/" },
  { id: "settings", name: "settings", description: "Open settings dialog", category: "settings", icon: "S" },
  { id: "clear", name: "clear", description: "Clear conversation", category: "session", icon: "C" },
  { id: "new", name: "new", description: "Start new conversation", category: "session", icon: "N" },
  { id: "history", name: "history", description: "View session history", category: "session", icon: "H", shortcut: "Ctrl+R" },
  { id: "compact", name: "compact", description: "Summarize context to save tokens", category: "ai", icon: "Z" },
  { id: "undo", name: "undo", description: "Undo last turn", category: "ai", icon: "U" },
  { id: "rewind", name: "rewind", description: "Rewind to checkpoint", category: "ai", icon: "R" },
  { id: "resume", name: "resume", description: "Resume previous session", category: "session", icon: ">" },
  { id: "rename", name: "rename", description: "Rename current session", category: "session", icon: "N" },
  { id: "fork", name: "fork", description: "Fork conversation", category: "ai", icon: "F" },
  { id: "ask", name: "ask", description: "Ask a quick question", category: "ai", icon: "A" },
  { id: "copy", name: "copy", description: "Copy last response", category: "tools", icon: "C" },
  { id: "about", name: "about", description: "Show about info", category: "help", icon: "i" },
  { id: "doctor", name: "doctor", description: "Run diagnostics", category: "tools", icon: "D" },
  { id: "plan", name: "plan", description: "Create implementation plan", category: "ai", icon: "P" },
  { id: "review", name: "review", description: "Code review changes", category: "tools", icon: "R" },
  { id: "connect", name: "connect", description: "Manage router connections", category: "settings", icon: "C" },
  { id: "tools", name: "tools", description: "List available tools", category: "tools", icon: "T" },
  { id: "context", name: "context", description: "Show context usage", category: "ai", icon: "X" },
  { id: "mcp", name: "mcp", description: "Manage MCP servers", category: "settings", icon: "M" },
  { id: "skills", name: "skills", description: "Manage skills", category: "tools", icon: "S" },
  { id: "agents", name: "agents", description: "Browse available agents", category: "ai", icon: "A" },
  { id: "router", name: "router", description: "Router status and info", category: "ai", icon: "R" },
  { id: "export", name: "export", description: "Export conversation", category: "tools", icon: "E" },
  { id: "quota", name: "quota", description: "View model quotas and token usage", category: "ai", icon: "Q", shortcut: "Ctrl+Q" },
  { id: "session", name: "session", description: "Manage sessions", category: "session", icon: "S" },
];
