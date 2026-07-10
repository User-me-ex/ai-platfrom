# 9 Router CLI — TUI Design Blueprint

**Target:** Replicate the feature set and UX of GitHub Copilot CLI's terminal UI using Ink (React) + TypeScript.
**Source Analyzed:** Copilot CLI v1.0.68 (Go / Bubble Tea)

---

## 1. Layout Architecture

```
┌──────────────────────────────────────────────────┐
│  [Tab Bar] Session │ Agents │ Issues │ PRs │ ... │  ← configurable tabs
├──────────────────────────────────────────────────┤
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │  [Banner / Start Screen]                   │  │  ← animated, once/always/never
│  │                                            │  │
│  │  [Chat View]                               │  │  ← scrollable, scrollbar toggle
│  │  ┌─ user ──────────────────────────────┐   │  │
│  │  │  message content                    │   │  │
│  │  └─────────────────────────────────────┘   │  │
│  │  ┌─ assistant ─────────────────────────┐   │  │
│  │  │  ● streaming content...             │   │  │
│  │  └─────────────────────────────────────┘   │  │
│  │  ┌─ system ───────────────────────────┐   │  │
│  │  │  /command output                   │   │  │
│  │  └─────────────────────────────────────┘   │  │
│  │  ┌─ tool_call ────────────────────────┐   │  │
│  │  │  [✓] shell(git push origin main)   │   │  │
│  │  └─────────────────────────────────────┘   │  │
│  │                                            │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │  [Thinking Indicator]  ⠋ Generating ...    │  │  ← animated spinner + timer
│  └────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────┐  │
│  │ ❯ /command or message...             [M+]  │  │  ← Input box (Shift+Enter newline)
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │  ● connected  gpt-5.4  my-session  12 msgs │  │  ← Status bar
│  └────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────┤
│  [Status Line / Footer]  (custom via /statusline) │  ← optional, user-defined
└──────────────────────────────────────────────────┘
```

---

## 2. Overlay / Dialog System

All dialogs use a centered modal overlay with semi-transparent backdrop:

```
┌──────────────────────────────────────────────────┐
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│   ┌────────────────────────────────────────┐     │
│   │  Model Picker                    ✕     │     │
│   ├────────────────────────────────────────┤     │
│   │  🔍 filter models...                   │     │
│   │                                        │     │
│   │  ▸ claude-sonnet-5              ✓      │     │
│   │   gpt-5.4                              │     │
│   │   gemini-3.1-pro-preview               │     │
│   │   ...                                  │     │
│   │                                        │     │
│   │  [Context Tier: default ▾]             │     │
│   └────────────────────────────────────────┘     │
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
└──────────────────────────────────────────────────┘
```

### Dialog Registry

| Dialog | Trigger | Key Features |
|--------|---------|--------------|
| Model Picker | `/model`, `Ctrl+P` | Search filter, cursor nav, context tier selector |
| Settings | `/settings` | Interactive property editor with categories |
| Session List | `/session`, `Ctrl+S` | Resume/rename/delete, created date, model |
| Agent Browser | `/agent` | Grid/card view of available agents |
| Help | `/help`, `Ctrl+L` | Searchable command list with keybindings |
| Limits | `/limits` | AI credit bar, max credits input |
| Subagents | `/subagents` | Per-agent model/effort/context config |
| Tasks | `/tasks` | Running subagents and shell commands |
| File Picker | `@` prefix | Fuzzy file search, respects .gitignore |

---

## 3. Color System (GitHub Primer Dark)

```typescript
// src/tui/themes.ts
export const copilotTheme = {
  // Semantic
  primary: "#2DA44E",     // GitHub green — success/confirmation
  accent: "#D29922",      // GitHub yellow — warnings/attention
  danger: "#F85149",      // GitHub red — errors/denied
  info: "#58A6FF",        // GitHub blue — info/links
  secondary: "#BC8CFF",   // GitHub purple — agent/tool calls

  // Backgrounds
  bg: "#0D1117",          // Canvas default
  surface: "#161B22",     // Subtle background
  overlay: "#1C2128",     // Overlay background
  inputBg: "#0D1117",     // Input background

  // Borders
  border: "#30363D",      // Default border
  borderActive: "#58A6FF",// Active/focused border
  borderSelected: "#2DA44E", // Selected item border

  // Text
  text: "#E6EDF3",        // Default text
  textDim: "#8B949E",     // Secondary/subtle text
  textInverse: "#0D1117", // Text on accent backgrounds
  placeholder: "#484F58", // Input placeholder

  // Tabs
  tabActive: "#F0F6FC",   // Active tab text
  tabInactive: "#8B949E", // Inactive tab text
  tabBorder: "#30363D",   // Tab separator

  // Status bar
  statusBg: "#161B22",    // Status bar background
  statusBorder: "#30363D",// Status bar top border

  // Scrollbar
  scrollbar: "#30363D",   // Scrollbar track
  scrollbarThumb: "#484F58", // Scrollbar handle

  // Chat bubbles
  userBg: "#1F2A3F",      // User message background
  assistantBg: "#161B22", // Assistant message background
  systemBg: "#161B22",    // System message background
  toolBg: "#1C2128",      // Tool call background
} as const;
```

### Theme Variants

| Theme | Description |
|-------|-------------|
| `github` | GitHub Primer Dark (default) |
| `default` | Same as github |
| `dim` | Lower contrast, muted colors |
| `high-contrast` | Maximum contrast ratios |
| `colorblind` | Accessible color pairings |

---

## 4. Component Tree (Ink/React)

```
<App>
  <TabBar />                    ← Session / Agents / Issues / PRs / Gists
  <Box flexDirection="column">
    <Banner />                  ← Animated startup banner (once/always/never)
    <ChatView>                  ← Scrollable message list
      <Message role="user" />
      <Message role="assistant">
        <Markdown content={} />
        <ToolCall name={} status={} />
        <InlineImage />         ← Kitty graphics protocol
      </Message>
      <Message role="system" />
      <Message role="tool">
        <CollapsibleOutput />   ← Toggle with Tab, Ctrl+T for all
      </Message>
    </ChatView>
    <ThinkingIndicator />       ← Animated spinner + elapsed timer
    <InputBox>
      <CompactPasteIndicator /> ← [Paste #N - X lines]
      <VoiceModeIndicator />    ← 🎤 when voice active
    </InputBox>
    <StatusBar />               ← connection / model / session / msg count
    <FooterStatusLine />        ← /statusline custom command output
  </Box>

  {/* Overlay dialogs rendered on top when active */}
  <ModelPicker visible={view === "model-picker"} />
  <SettingsDialog visible={view === "settings"} />
  <SessionPicker visible={view === "session-list"} />
  <HelpOverlay visible={view === "help"} />
  <LimitsDialog visible={view === "limits"} />
  <FilePicker visible={view === "file-picker"} />
  <AgentBrowser visible={view === "agent-browser"} />
  <PermissionPrompt visible={permissionRequest !== null} />

  {/* Context visualization overlay */}
  <ContextWindow visible={view === "context"} />
</App>
```

---

## 5. Screen / View Modes

| Mode | Transition | Behavior |
|------|-----------|----------|
| **Start** | `--banner` | Animated logo + version + quick tip |
| **Chat** | default view | Main conversation with input |
| **Model Picker** | `/model`, `Ctrl+P` | Overlay with search |
| **Settings** | `/settings` | Overlay with categories |
| **Help** | `/help`, `Ctrl+L` | Overlay with search |
| **Context View** | `/context` | Token usage visualization |
| **Diff View** | `/diff` | Rich diff (syntax highlighted) |
| **Logs** | future | Debug log viewer |

---

## 6. Keyboard Navigation

### Global Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+C` | Abort streaming / quit |
| `Ctrl+P` | Open model picker |
| `Ctrl+L` | Open help |
| `Ctrl+K` | Open command palette |
| `Tab` | Cycle tab bar focus |
| `Shift+Tab` | Cycle agent mode (ask/execute/plan/autopilot) |
| `Esc` | Close overlay / cancel selection |
| `Up/Down` | Scroll chat / navigate lists |
| `PageUp/PageDown` | Scroll chat by page |
| `Enter` | Submit input / select item |
| `Shift+Enter` | Newline in input |

### Navigation Mode and Agent Mode Controls

| Key | Action |
|-----|--------|
| `Shift+Tab` | Cycle between Ask / Execute / Plan / Autopilot modes |
| `/` | Focus input with `/` prefix (command mode) |
| `@` | Focus input with `@` prefix (file picker) |

---

## 7. Message Types & Formatting

```typescript
interface UIMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  toolCalls?: ToolCallResult[];
  attachments?: Attachment[];
}

interface ToolCallResult {
  name: string;           // e.g., "shell", "write", "read"
  args: string;           // e.g., "git push origin main"
  result?: string;        // stdout/stderr output (collapsible)
  status: "pending" | "running" | "approved" | "denied" | "completed" | "error";
  durationMs?: number;
}

interface Attachment {
  type: "image" | "file";
  path: string;
  mimeType?: string;
}
```

---

## 8. Permission Prompt UI

```
┌──────────────────────────────────────────────────┐
│  ⚠️ Tool Request                                 │
│                                                  │
│  The agent wants to run:                         │
│    shell(git push origin main)                   │
│                                                  │
│  [1] Allow once    [2] Always allow              │
│  [3] Deny once     [4] Always deny               │
│  [5] Allow all for this session                  │
└──────────────────────────────────────────────────┘
```

---

## 9. Configuration Persistence

All TUI preferences stored in `~/.9router/config.json`:

```json
{
  "theme": "github",
  "mouse": true,
  "scrollbar": true,
  "screenReader": false,
  "tabs": {
    "enabled": true,
    "sort": ["copilot", "agents", "issues", "pull-requests", "gists"],
    "hide": []
  },
  "banner": "once",
  "compactPaste": true,
  "streamerMode": false,
  "renderMarkdown": true,
  "statusLine": {
    "type": "command",
    "command": ""
  }
}
```

---

## 10. Implementation Priority

### Phase 1 — Present
- [x] Chat View with streaming messages
- [x] Input box with multi-line support
- [x] Status bar (connection, model, session, count)
- [x] Thinking indicator (animated spinner + timer)
- [x] Model picker overlay
- [x] Start screen

### Phase 2 — Next
- [ ] Tab bar (Session, Issues, PRs, Gists, Agents)
- [ ] Settings dialog (`/settings`)
- [ ] Help overlay (`/help`, `Ctrl+L`)
- [ ] Permission prompts (tool approval UI)
- [ ] Compact paste indicator
- [ ] Scrollbar toggle
- [ ] Session picker (`/session`, `/resume`)
- [ ] Context window visualization (`/context`)

### Phase 3 — Advanced
- [ ] Alt-screen toggle (alternate buffer)
- [ ] Mouse support (SGR encoding)
- [ ] Theme variants (dim, high-contrast, colorblind)
- [ ] Custom status line (`/statusline`)
- [ ] Streamer mode (hide model names/quota)
- [ ] Screen reader mode
- [ ] Inline images (Kitty protocol)
- [ ] File picker (`@` mention)
- [ ] Diff view with syntax highlighting
- [ ] Voice mode indicator
- [ ] `/every` `/after` scheduling
- [ ] Tab reorder/hide config
- [ ] Notification toasts
