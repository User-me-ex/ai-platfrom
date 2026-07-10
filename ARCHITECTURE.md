# 9 Router CLI — Architecture Document

## Overview

9 Router CLI is a production-grade, open-source AI CLI that connects to **9 Router** (local AI router at `http://localhost:20128/v1`). It automatically discovers every model exposed by 9 Router and provides a premium terminal experience optimized for local execution.

## Core Principles

1. **Zero hardcoded models** — always discover dynamically from 9 Router
2. **Modular architecture** — every subsystem is swappable
3. **Performance first** — cold start < 50ms, streaming < 5ms/token
4. **Plugin extensible** — add commands, renderers, providers without core changes
5. **Local-first** — all data stays on the machine

---

## 1. Folder Structure

```
9router-cli/
├── package.json
├── tsconfig.json
├── bun.lock
├── .gitignore
├── README.md
├── ARCHITECTURE.md
│
├── src/
│   ├── index.ts                    # Entry point — CLI bootstrap
│   ├── cli.ts                      # Main CLI loop (REPL or single-shot)
│   │
│   ├── commands/                   # Slash command implementations
│   │   ├── index.ts                # Command registry
│   │   ├── chat.ts                 # /chat — start/continue conversation
│   │   ├── model.ts                # /model — switch model
│   │   ├── models.ts               # /models — list all models
│   │   ├── new.ts                  # /new — new conversation
│   │   ├── history.ts              # /history — view/search history
│   │   ├── clear.ts                # /clear — clear screen
│   │   ├── help.ts                 # /help — show help
│   │   ├── config.ts               # /config — view/edit config
│   │   ├── plugins.ts              # /plugins — manage plugins
│   │   ├── export.ts               # /export — export session
│   │   ├── import.ts               # /import — import session
│   │   ├── reset.ts                # /reset — reset conversation
│   │   ├── system.ts               # /system — set system prompt
│   │   ├── context.ts              # /context — show context usage
│   │   ├── status.ts               # /status — show router status
│   │   ├── search.ts               # /search — search history
│   │   ├── version.ts              # /version — show version
│   │   └── update.ts               # /update — check for updates
│   │
│   ├── core/                       # Core abstractions
│   │   ├── types.ts                # Shared TypeScript types
│   │   ├── constants.ts            # Constants, defaults
│   │   ├── errors.ts               # Custom error classes
│   │   └── events.ts               # Event bus (TypeScript EventEmitter)
│   │
│   ├── router/                     # 9 Router integration
│   │   ├── client.ts               # HTTP client for 9 Router API
│   │   ├── models.ts               # Model discovery & registry
│   │   ├── streaming.ts            # SSE stream parser
│   │   └── types.ts                # Router-specific types
│   │
│   ├── chat/                       # Chat engine
│   │   ├── engine.ts               # Chat loop, message handling
│   │   ├── context.ts              # Context window management
│   │   └── history.ts              # Message history (in-memory)
│   │
│   ├── render/                     # Rendering engine
│   │   ├── index.ts                # Renderer dispatcher
│   │   ├── markdown.ts             # Markdown parser & renderer
│   │   ├── syntax.ts               # Syntax highlighting (Shiki)
│   │   ├── streaming.ts            # Streaming markdown renderer
│   │   ├── ansi.ts                 # ANSI escape code utilities
│   │   ├── tables.ts               # Table rendering
│   │   └── themes.ts               # Theme definitions
│   │
│   ├── tui/                        # Terminal UI components
│   │   ├── startup.ts              # Startup screen / splash
│   │   ├── prompt.ts               # Input prompt with autocomplete
│   │   ├── spinner.ts              # Loading spinners
│   │   ├── thinking.ts             # Thinking indicator
│   │   ├── model-picker.ts         # Interactive model selector
│   │   ├── keybindings.ts          # Keyboard shortcut handler
│   │   └── layout.ts              # Terminal layout management
│   │
│   ├── session/                    # Session management
│   │   ├── manager.ts              # Session CRUD operations
│   │   ├── storage.ts              # SQLite storage adapter
│   │   └── serializer.ts           # Export/import serialization
│   │
│   ├── config/                     # Configuration system
│   │   ├── manager.ts              # Config file manager
│   │   ├── schema.ts               # Config schema & validation
│   │   └── defaults.ts             # Default configuration
│   │
│   ├── plugins/                    # Plugin system
│   │   ├── manager.ts              # Plugin discovery & loading
│   │   ├── api.ts                  # Plugin API (hooks, context)
│   │   └── types.ts                # Plugin type definitions
│   │
│   ├── logging/                    # Logging system
│   │   ├── logger.ts               # Structured logger
│   │   └── levels.ts               # Log levels
│   │
│   └── utils/                      # Shared utilities
│       ├── paths.ts                # XDG path resolution
│       ├── terminal.ts             # Terminal detection & capabilities
│       ├── throttle.ts             # Throttle/debounce utilities
│       └── version.ts              # Version management
│
├── tests/
│   ├── unit/
│   │   ├── router.test.ts
│   │   ├── render.test.ts
│   │   ├── session.test.ts
│   │   ├── config.test.ts
│   │   └── plugins.test.ts
│   └── integration/
│       ├── cli.test.ts
│       └── router-integration.test.ts
│
├── docs/
│   ├── getting-started.md
│   ├── configuration.md
│   ├── plugins.md
│   ├── commands.md
│   └── development.md
│
└── examples/
    └── plugins/
        └── example-plugin/
            ├── package.json
            └── index.ts
```

---

## 2. Module Boundaries & Dependency Graph

```
                                 ┌─────────────┐
                                 │   index.ts   │
                                 │  (Bootstrap) │
                                 └──────┬──────┘
                                        │
                                 ┌──────▼──────┐
                                 │    cli.ts    │
                                 │  (Main Loop) │
                                 └──────┬──────┘
                                        │
            ┌───────────────────────────┼───────────────────────────┐
            │                           │                           │
     ┌──────▼──────┐           ┌───────▼────────┐         ┌───────▼───────┐
     │  commands/   │           │     chat/      │         │     tui/      │
     │  (Registry)  │◄──────────│    engine.ts   │────────►│  (UX Layer)   │
     └──────┬──────┘           └───────┬────────┘         └───────┬───────┘
            │                          │                          │
            │                   ┌──────▼──────┐           ┌───────▼───────┐
            │                   │  router/    │           │    render/    │
            │                   │ (API Client)│           │ (Rendering)   │
            │                   └──────┬──────┘           └───────┬───────┘
            │                          │                          │
            │                   ┌──────▼──────┐                   │
            └──────────────────►│  session/   │                   │
                               │  (Storage)  │                   │
                               └──────┬──────┘                   │
                                      │                          │
                               ┌──────▼──────┐           ┌───────▼───────┐
                               │   config/   │           │    plugins/   │
                               │  (Manager)  │           │   (Manager)   │
                               └─────────────┘           └───────────────┘

Shared across all:
  - core/       (types, errors, events)
  - logging/    (logger)
  - utils/      (paths, terminal)
```

**Dependency rules:**
- `commands/` → can access `chat/`, `router/`, `session/`, `config/`, `plugins/`, `tui/`
- `cli.ts` → orchestrates all top-level modules
- `chat/engine.ts` → uses `router/` for API, `render/` for output, `session/` for persistence
- `router/` → depends only on `config/` (for base URL) and `core/`
- `render/` → standalone, only depends on `core/` and `utils/terminal.ts`
- `plugins/` → depends on `core/`, `config/`, and provides API to `commands/`
- `session/` → depends on `config/` (for storage path)
- No circular dependencies

---

## 3. Configuration System

**Schema** (stored in `~/.config/9router-cli/config.json` or `%APPDATA%\9router-cli\config.json`):

```typescript
interface Config {
  // 9 Router connection
  baseUrl: string;              // default: "http://localhost:20128/v1"
  apiKey?: string;              // optional API key
  
  // Model preferences
  defaultModel: string;         // last used model ID
  modelRefreshInterval: number; // seconds between model list refreshes (default: 300)
  
  // Theme
  theme: string;                // "dark" | "light" | theme name
  syntaxTheme: string;          // Shiki theme name (default: "dracula")
  
  // Rendering
  render: {
    markdown: boolean;          // enable markdown rendering
    syntaxHighlight: boolean;   // enable syntax highlighting
    animateStreaming: boolean;  // smooth streaming animation
    maxRenderWidth: number;     // max line width (0 = auto-detect)
  };
  
  // Streaming
  streaming: {
    enabled: boolean;
    showTokens: boolean;        // show token count after each response
    thinking: boolean;          // show thinking state
  };
  
  // Session
  session: {
    autoSave: boolean;          // auto-save conversations
    maxHistory: number;         // max stored conversations
    exportFormat: "json" | "md";
  };
  
  // Logging
  logging: {
    level: "debug" | "info" | "warn" | "error";
    file?: string;              // log file path
  };
  
  // Plugins
  plugins: {
    enabled: string[];          // list of enabled plugin names
    paths: string[];            // additional plugin search paths
  };
  
  // Performance
  performance: {
    lazyLoadPlugins: boolean;   // lazy load plugins on first use
    cacheModels: boolean;       // cache model list
  };
  
  // Keyboard shortcuts
  keybindings: Record<string, string>;
}
```

---

## 4. Model Registry

```typescript
interface ModelInfo {
  id: string;                   // Model ID (e.g., "kr/claude-sonnet-4.5")
  name: string;                 // Human-readable name
  provider: string;             // Provider name
  contextLength: number;        // Max context tokens
  capabilities: {
    reasoning: boolean;
    vision: boolean;
    audio: boolean;
    toolUse: boolean;
    functionCalling: boolean;
    streaming: boolean;
  };
  pricing?: {
    input: number;              // per 1M tokens
    output: number;
  };
  metadata: Record<string, unknown>;
}
```

**Registry methods:**
- `listModels()` → returns all discovered models
- `getModel(id)` → returns single model info
- `refreshModels()` → fetches fresh list from 9 Router
- `searchModels(query)` → fuzzy search models
- `groupByProvider()` → returns models grouped by provider

---

## 5. Router Abstraction (9 Router API Client)

```typescript
interface RouterClient {
  baseUrl: string;
  
  // Model discovery
  listModels(): Promise<ModelInfo[]>;
  
  // Chat completions (streaming)
  chatCompletionStream(params: ChatParams): AsyncIterable<StreamEvent>;
  
  // Chat completions (non-streaming)
  chatCompletion(params: ChatParams): Promise<ChatResponse>;
  
  // Health check
  ping(): Promise<boolean>;
  
  // Status
  getStatus(): Promise<RouterStatus>;
}
```

**Stream Event Types:**
```typescript
type StreamEvent =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "tool_start"; tool: string; input: unknown }
  | { type: "tool_end"; tool: string; output: unknown }
  | { type: "error"; message: string }
  | { type: "done"; usage?: TokenUsage };
```

---

## 6. Streaming Engine

```
                    ┌──────────────┐
                    │  User Types  │
                    │   /question  │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │  Abortable   │
                    │  SSE Stream  │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
       ┌──────▼────┐ ┌────▼────┐ ┌────▼────┐
       │  Text      │ │Thinking │ │ Tool    │
       │  Chunks    │ │ Chunks  │ │ Chunks  │
       └──────┬────┘ └────┬────┘ └────┬────┘
              │            │            │
       ┌──────▼────────────▼────────────▼──────┐
       │        Stream Event Dispatcher         │
       │  (routes events to correct renderer)   │
       └──────────────────┬─────────────────────┘
                          │
              ┌───────────┼───────────┐
              │           │           │
       ┌──────▼────┐ ┌────▼────┐ ┌────▼──────┐
       │  Markdown │ │Thinking │ │ Tool UI   │
       │ Renderer  │ │Renderer │ │ Renderer  │
       └──────┬────┘ └─────────┘ └───────────┘
              │
       ┌──────▼──────────────┐
       │ Block-Based Parser  │
       │ (only last block    │
       │  re-rendered)       │
       └──────┬──────────────┘
              │
       ┌──────▼──────────────┐
       │  ANSI Terminal      │
       │  Output (stdout)    │
       └─────────────────────┘
```

---

## 7. Plugin System API

```typescript
interface PluginManifest {
  name: string;
  version: string;
  description: string;
  entry: string;                // main entry point
  hooks: PluginHookType[];      // hooks this plugin uses
}

type PluginHookType =
  | "registerCommands"
  | "registerModels"
  | "registerRenderers"
  | "registerTools"
  | "registerKeybindings"
  | "onInit"
  | "onChatStart"
  | "onChatEnd"
  | "onConfigChange";

interface PluginContext {
  config: Config;
  router: RouterClient;
  session: SessionManager;
  logger: Logger;
  
  // API exposed to plugins
  addCommand(command: Command): void;
  addModel(model: ModelInfo): void;
  addRenderer(name: string, renderer: Renderer): void;
  addKeybinding(key: string, action: string): void;
  addTool(tool: Tool): void;
}

interface Plugin {
  manifest: PluginManifest;
  activate(context: PluginContext): Promise<void>;
  deactivate?(): Promise<void>;
}
```

---

## 8. Session & Storage Layer

```sql
-- SQLite schema

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  name TEXT,
  model_id TEXT NOT NULL,
  system_prompt TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  token_count INTEGER DEFAULT 0,
  message_count INTEGER DEFAULT 0,
  metadata TEXT  -- JSON
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,  -- 'user' | 'assistant' | 'system' | 'tool'
  content TEXT NOT NULL,
  model_id TEXT,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  metadata TEXT,  -- JSON (tools used, thinking, etc.)
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE message_fts (
  content TEXT
);

-- Virtual table for full-text search
CREATE VIRTUAL TABLE messages_fts USING fts5(content, content=messages, content_rowid=rowid);

-- Triggers to keep FTS in sync
CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
```

**Session CRUD:**
- `createSession(name?, modelId?, systemPrompt?)` → Session
- `getSession(id)` → Session with messages
- `listSessions(limit?, offset?)` → Session[]
- `searchSessions(query)` → Session[]
- `deleteSession(id)` → void
- `exportSession(id, format)` → string
- `importSession(data)` → Session

---

## 9. Error Handling Strategy

```typescript
// Custom error hierarchy
class RouterError extends Error {
  constructor(
    message: string,
    public code: ErrorCode,
    public statusCode?: number,
    public recoverable: boolean = false
  ) { super(message); }
}

class ConnectionError extends RouterError {}     // 9 Router not running
class ModelNotFoundError extends RouterError {}   // Model unavailable
class TimeoutError extends RouterError {}         // Request timeout
class AuthError extends RouterError {}            // API key invalid
class StreamingError extends RouterError {}       // Stream interrupted

// Error recovery
interface RetryStrategy {
  maxRetries: number;
  backoff: 'linear' | 'exponential';
  initialDelay: number;
  maxDelay: number;
}
```

**Retry logic:**
- Connection errors: retry 3x with exponential backoff, then show "Is 9 Router running?" message
- Timeout errors: retry 1x, then offer to switch to a faster model
- Streaming errors: attempt to resume from last complete token
- Auth errors: prompt user to configure API key (non-recoverable)

---

## 10. Performance Targets & Techniques

| Metric | Target | Technique |
|--------|--------|-----------|
| Cold start | < 50ms | Dynamic imports, esbuild single bundle |
| Model list load | < 100ms | Cached with background refresh |
| First token latency | < 200ms | Direct SSE connection, no pre-processing |
| Token rendering | < 5ms/token | Block-based incremental rendering |
| Session load | < 30ms | SQLite with prepared statements |
| Startup with plugins | < 150ms | Lazy plugin activation |
| Memory (idle) | < 30MB | Minimal dependency tree, streaming buffers |
| Memory (active) | < 100MB | Rolling context window, SQLite offload |

---

## 11. Command System

```
/chat [message]       — Start or continue a conversation
/model [model-id]     — Switch model (with autocomplete)
/models               — List all available models
/new                  — Start a new conversation
/history [search]     — View conversation history
/clear                — Clear the screen
/help [command]       — Show help
/config [key=value]   — View or set configuration
/plugins [list|install|remove]
/export [session-id]  — Export conversation
/import <file>        — Import conversation
/reset                — Reset current conversation
/system [prompt]      — Set system prompt
/context              — Show context usage statistics
/status               — Show 9 Router connection status
/search <query>       — Search conversation history
/tools                — List available tools
/version              — Show version information
/update               — Check for CLI updates
```

---

## 12. TUI/UX Design

**Startup Screen:**
```
╔══════════════════════════════════════════════════╗
║                   9 Router CLI                    ║
║         Connected to 9 Router · 24 models         ║
║                                                  ║
║   Type /help for commands, or start chatting!    ║
╚══════════════════════════════════════════════════╝
```

**Chat Interface:**
```
┌─ Model: kr/claude-sonnet-4.5 ─────────────────────┐
│                                                    │
│  You: What's the best way to structure a Node.js   │
│  API server?                                       │
│                                                    │
│  9 Router ──┤ Thinking...                          │
│                                                    │
│  The best approach depends on your requirements,   │
│  but here's a modern architecture:                 │
│                                                    │
│  ```typescript                                     │
│  import { serve } from 'bun';                      │
│                                                    │
│  const server = Bun.serve({                        │
│    port: 3000,                                     │
│    fetch(req) { return new Response("OK"); }       │
│  });                                                │
│  ```                                                │
│                                                    │
│  [Tokens: 342 in / 1,204 out | Model: Claude 3.5] │
│                                                    │
│  ┌─ /help for commands ───────────────────────────┐│
│  │ >                                              ││
│  └────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────┘
```

**Model Picker:**
```
┌─ Select Model ─────────────────────────────────────┐
│  🔍 filter: [claude                   ]            │
│                                                    │
│  › kr/claude-sonnet-4.5                            │
│       200K ctx · reasoning · tools · vision         │
│                                                    │
│    kr/claude-haiku-3.5                             │
│       200K ctx · tools                              │
│                                                    │
│    gpt/gpt-4o                                      │
│       128K ctx · reasoning · tools · vision · audio│
│                                                    │
│    google/gemini-2.0-flash                          │
│       1M ctx · reasoning · tools · vision · audio  │
└────────────────────────────────────────────────────┘
```

---

## 13. Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | **Bun** | 5-10x faster startup, built-in bundler, SQLite, test runner |
| Language | **TypeScript** | Type safety, ecosystem, developer experience |
| Bundler | **esbuild** (via Bun) | Fastest JS bundler, single-file output |
| Command parsing | **Commander.js** | Best balance of power and simplicity |
| Interactive prompts | **@inquirer/prompts** | Autocomplete, fuzzy search, modern API |
| Styling | **Chalk** | Industry standard terminal colors |
| Spinners | **Ora** | Lightweight, animated spinners |
| Markdown | **marked** + custom ANSI renderer | Full control over terminal output |
| Syntax highlighting | **Shiki** | TextMate grammars, true VS Code fidelity |
| SQLite | **bun:sqlite** | Built-in, blazing fast |
| HTTP | **Bun.fetch** | Built-in, faster than node-fetch/undici |
| Testing | **Bun test** | Built-in, fast, TypeScript native |
| Logging | **pino** or custom | Structured JSON logging |

---

## 14. Development Workflow

```bash
# Setup
bun install

# Development
bun run dev          # Watch mode with hot reload
bun run build        # Production build
bun run start        # Run the CLI

# Testing
bun test             # Run all tests
bun test --watch     # Watch mode
bun run test:coverage

# Linting
bun run lint
bun run format

# Release
bun run build
npm publish          # Or distribute as single binary (Bun SEA)
```
