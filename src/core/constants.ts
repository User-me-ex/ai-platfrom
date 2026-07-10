/**
 * 9 Router CLI — Constants
 */

export const APP_NAME = "9router-cli";
export const APP_DISPLAY_NAME = "9 Router CLI";
export const BIN_NAME = "9r";

/** Default 9 Router connection */
export const DEFAULT_BASE_URL = "http://localhost:20128/v1";
export const DEFAULT_MODEL = "";
export const DEFAULT_MODEL_REFRESH_INTERVAL = 300; // 5 minutes

/** Default config */
export const DEFAULT_THEME = "dark";
export const DEFAULT_SYNTAX_THEME = "dracula";

/** XDG / platform paths */
export const CONFIG_DIR_NAME = "9router-cli";
export const CONFIG_FILE_NAME = "config.json";
export const SESSIONS_DB_NAME = "sessions.db";
export const CACHE_DIR_NAME = "9router-cli";
export const LOG_DIR_NAME = "9router-cli";

/** Session defaults */
export const DEFAULT_MAX_HISTORY = 100;
export const DEFAULT_EXPORT_FORMAT = "json" as const;

/** Streaming defaults */
export const DEFAULT_STREAMING_CHUNK_SIZE = 4096;
export const DEFAULT_MAX_RENDER_WIDTH = 120;

/** Error codes */
export const ERROR_CODES = {
  CONNECTION_REFUSED: "CONNECTION_REFUSED",
  MODEL_NOT_FOUND: "MODEL_NOT_FOUND",
  TIMEOUT: "TIMEOUT",
  AUTH_ERROR: "AUTH_ERROR",
  STREAM_INTERRUPTED: "STREAM_INTERRUPTED",
  CONFIG_INVALID: "CONFIG_INVALID",
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
  PLUGIN_LOAD_FAILED: "PLUGIN_LOAD_FAILED",
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
} as const;

/** Retry defaults */
export const DEFAULT_RETRY_MAX = 3;
export const DEFAULT_RETRY_DELAY = 1000;
export const DEFAULT_TIMEOUT = 60000; // 1 minute

/** ANSI escape codes */
export const ANSI = {
  RESET: "\x1b[0m",
  BOLD: "\x1b[1m",
  DIM: "\x1b[2m",
  ITALIC: "\x1b[3m",
  UNDERLINE: "\x1b[4m",
  BLINK: "\x1b[5m",
  REVERSE: "\x1b[7m",
  HIDE: "\x1b[8m",
  STRIKE: "\x1b[9m",
  
  // Cursor movement
  CURSOR_UP: (n: number) => `\x1b[${n}A`,
  CURSOR_DOWN: (n: number) => `\x1b[${n}B`,
  CURSOR_RIGHT: (n: number) => `\x1b[${n}C`,
  CURSOR_LEFT: (n: number) => `\x1b[${n}D`,
  CURSOR_HIDE: "\x1b[?25l",
  CURSOR_SHOW: "\x1b[?25h",
  CURSOR_SAVE: "\x1b[s",
  CURSOR_RESTORE: "\x1b[u",
  
  // Screen
  CLEAR_LINE: "\x1b[2K",
  CLEAR_LINE_RIGHT: "\x1b[0K",
  CLEAR_SCREEN: "\x1b[2J",
  CLEAR_SCREEN_AFTER: "\x1b[J",
  ALTERNATE_SCREEN: "\x1b[?1049h",
  MAIN_SCREEN: "\x1b[?1049l",
  
  // Colors (foreground)
  BLACK: "\x1b[30m",
  RED: "\x1b[31m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  BLUE: "\x1b[34m",
  MAGENTA: "\x1b[35m",
  CYAN: "\x1b[36m",
  WHITE: "\x1b[37m",
  
  // Bright foreground
  BRIGHT_BLACK: "\x1b[90m",
  BRIGHT_RED: "\x1b[91m",
  BRIGHT_GREEN: "\x1b[92m",
  BRIGHT_YELLOW: "\x1b[93m",
  BRIGHT_BLUE: "\x1b[94m",
  BRIGHT_MAGENTA: "\x1b[95m",
  BRIGHT_CYAN: "\x1b[96m",
  BRIGHT_WHITE: "\x1b[97m",
  
  // Background
  BG_BLACK: "\x1b[40m",
  BG_RED: "\x1b[41m",
  BG_GREEN: "\x1b[42m",
  BG_YELLOW: "\x1b[43m",
  BG_BLUE: "\x1b[44m",
  BG_MAGENTA: "\x1b[45m",
  BG_CYAN: "\x1b[46m",
  BG_WHITE: "\x1b[47m",
  
  // TrueColor helper
  RGB: (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`,
  BG_RGB: (r: number, g: number, b: number) => `\x1b[48;2;${r};${g};${b}m`,
} as const;

/** Box drawing characters */
export const BOX_CHARS = {
  TL: "┌",
  TR: "┐",
  BL: "└",
  BR: "┘",
  H: "─",
  V: "│",
  HCROSS: "┬",
  VCROSS: "├",
  CROSS: "┼",
  SPACE: " ",
} as const;

/** Spinner frames */
export const SPINNER_FRAMES = {
  dots: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  line: ["-", "\\", "|", "/"],
  arrow: ["←", "↖", "↑", "↗", "→", "↘", "↓", "↙"],
  pulse: ["█", "▓", "▒", "░", "▒", "▓"],
  bounce: ["⠁", "⠂", "⠄", "⡀", "⢀", "⠠", "⠐", "⠈"],
} as const;

/** Slash commands list */
export const BUILTIN_COMMANDS = [
  { name: "chat", description: "Start or continue a conversation", usage: "/chat [message]" },
  { name: "model", description: "Switch model (with autocomplete)", usage: "/model [model-id]" },
  { name: "models", description: "List all available models", usage: "/models" },
  { name: "new", description: "Start a new conversation", usage: "/new" },
  { name: "history", description: "View conversation history", usage: "/history [search]" },
  { name: "clear", description: "Clear the screen", usage: "/clear" },
  { name: "help", description: "Show help for commands", usage: "/help [command]" },
  { name: "config", description: "View or set configuration", usage: "/config [key=value]" },
  { name: "plugins", description: "Manage plugins", usage: "/plugins [list|install|remove]" },
  { name: "export", description: "Export current conversation", usage: "/export [format]" },
  { name: "import", description: "Import a conversation", usage: "/import <file>" },
  { name: "reset", description: "Reset current conversation", usage: "/reset" },
  { name: "system", description: "Set system prompt", usage: "/system [prompt]" },
  { name: "context", description: "Show context usage statistics", usage: "/context" },
  { name: "status", description: "Show 9 Router connection status", usage: "/status" },
  { name: "search", description: "Search conversation history", usage: "/search <query>" },
  { name: "tools", description: "List available tools", usage: "/tools" },
  { name: "version", description: "Show version information", usage: "/version" },
  { name: "update", description: "Check for CLI updates", usage: "/update" },
  // New commands — common across all major CLIs
  { name: "undo", description: "Undo last change or action", usage: "/undo" },
  { name: "compact", description: "Compress conversation to save tokens", usage: "/compact" },
  { name: "rewind", description: "Go back to a previous checkpoint", usage: "/rewind [steps]" },
  { name: "resume", description: "Resume a previous session", usage: "/resume [session-id]" },
  { name: "rename", description: "Rename current session", usage: "/rename <name>" },
  { name: "fork", description: "Branch current conversation into new session", usage: "/fork" },
  { name: "ask", description: "Ask a question without affecting conversation", usage: "/ask <question>" },
  { name: "copy", description: "Copy last response to clipboard", usage: "/copy" },
  { name: "about", description: "Show system, version, and environment info", usage: "/about" },
  { name: "doctor", description: "Run diagnostics and health checks", usage: "/doctor" },
  { name: "plan", description: "Enter plan mode for structured analysis", usage: "/plan [topic]" },
  { name: "theme", description: "Change color theme", usage: "/theme [dark|light]" },
  { name: "review", description: "Review current session configuration", usage: "/review" },
  { name: "skills", description: "Manage skills: list, install, execute, info", usage: "/skills [list|install|execute|info]" },
  { name: "evolve", description: "Evolve framework to support new skill capabilities", usage: "/evolve [status|plan|apply|inspect|rollback]" },
  { name: "connect", description: "Manage 9 Router server connections", usage: "/connect [add|remove|list|test|switch|edit]" },
] as const;

/** Directory where skill files are stored */
export const SKILLS_DIR = "skills";
