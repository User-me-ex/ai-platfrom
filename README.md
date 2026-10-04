# 9 Router Models

Pick AI models served by the local **9 Router gateway** (`http://127.0.0.1:20128/v1`) and chat with them — streaming replies, full agentic access to your machine, live typing feedback, and a **real-time voice conversation** mode over a local WebSocket channel (Gemini Live).

## Features

- **Model Picker** — browse the live `/v1/models` list merged with an embedded catalog (84 models, 21 providers). Shows provider, source badge (router/catalog), `$(flame)` marker for live/voice models, and capabilities (context window, max output, vision/audio/tools/reasoning). If the router is offline the picker falls back to the catalog and shows the error.
- **Live-Model Filter (default on)** — all live/voice conversation (voice-to-voice) models are hidden from the picker by default. Toggle from the status-bar menu or the `antigravity.models.filterLive` setting. See [Gemini Live conversation — model IDs & PCM config](research/gemini-live-conversation.md) for the underlying research.
- **Streaming Chat** — type messages into the input box; the reply streams into the output channel in real time.
- **Typing Indicator** — a status-bar spinner tracks the agent live: `thinking` → `typing` (while streaming) → `running tools`, then clears; every turn ends with a `[✓ done]` line in the output.
- **Agent Tools** — the model can read files, list directories, create/edit files, run shell commands, run any VS Code command, and open files in the editor. Execution is announced in the output channel.
- **Session Options** — per-session temperature, max tokens, extra system prompt, history length, and per-tool on/off switches.
- **Voice Conversation — Direct Gemini Live WebSocket** — true real-time voice-to-voice. The extension connects directly to **Gemini Live** (`BidiGenerateContent` over WSS at 16 kHz PCM in / 24 kHz PCM out), echoing model transcripts into the output channel as they happen. Supports **multiple Gemini API keys** with permanent storage and seamless automatic quota (`429` / `RESOURCE_EXHAUSTED`) fallback. Press the status-bar **mic** to talk, press again to listen; **mute** stops your audio from being sent.
- **Status Bar** — one click opens a menu: Chat, Pick model, Session options, Configure Gemini API Keys, Voice mode.

- **Layer 2: Role-Based Model Assignment & Serial Orchestration** — Main Voice AI acts as the central intelligent orchestrator. Tasks are decomposed into a strictly **serial** execution pipeline of specialized AI roles (Researcher, Backend, Frontend, Database, Security, Testing, etc.), powered by models selected from the **9 Router** gateway with independent fallback chains and structured context handoffs.
- **Workflow & Roles Webview** — interactive real-time visualizer for the serial execution pipeline, displaying the currently active role, queued steps, progress indicators, prompt transparency inspection (System Prompt vs. Task Prompt), fallback event banners, and complete role configuration.
- **Fuzzy Model Search** — instant weighted fuzzy search across the complete live 9 Router catalog (1,400+ models, 60+ providers). Search by model ID, display name, provider, capabilities (tools, reasoning, vision), and keywords.

## Requirements

- VS Code `^1.90.0`
- A running 9 Router gateway (default: `http://127.0.0.1:20128/v1`), or the catalog-only fallback if it is down
- One or more Gemini API keys for Voice Mode

## Layer 2 Architecture: Serial Orchestration & Main Voice AI Control

```
User
  ↓
Main Voice AI (Gemini Live)
  ↓
Task Understanding & Dependency Planning
  ↓
Role Selection & Model Assignment (from 9 Router)
  ↓
Serial Task Execution (Strictly One Active Role at a Time)
  ↓
Shared Project Context & Structured Handoff
  ↓
Next Specialized Role
  ↓
Final Verification Stage
  ↓
Main Voice AI Report & Feedback
  ↓
User
```

### Key Principles

1. **Main Voice AI as Orchestrator**: The existing Gemini Live voice system remains the conversational interface and intelligent supervisor. It decomposes complex tasks, reasons about dependencies (e.g. Database → Backend → Frontend → Testing), assigns models, and verifies final results without reading raw code or internal tool mechanics over audio.
2. **Strictly Serial Execution**: Execution is strictly sequential. At any given moment, exactly one specialized role is in the `Running` state, while all subsequent roles wait in `Queued` state.
3. **Dynamic & Extensible Roles**: Pre-configured with 13 domain roles (Researcher, Backend, Frontend, Database, API, Authentication, Security, Testing, DevOps, UI/UX, Documentation, Performance, Code Reviewer) with support for adding, editing, duplicating, and deleting custom roles.
4. **Independent Model & Fallback Assignment**: Every role independently selects its primary model and configurable ordered fallback list from 9 Router. The same model can be assigned to multiple roles without restriction.
5. **Intelligent Error Classification**: Temporary errors (socket drops, transient HTTP 5xx, rate spikes) trigger automatic retries with backoff. Persistent errors (quota exhausted 429, unauthorized 401/403, model 404) trigger fallback to the next model in the role's chain while preserving conversation context.
6. **Prompt Transparency**: Permanent Role System Prompts (behavioral persona) and Current Task Prompts (task-specific instructions) remain strictly separated and inspectable in the Workflow Webview.
7. **Shared State & Context Handoff**: Completed roles update shared project intelligence (modified files, API contracts, architectural decisions). The next role receives a structured handoff summary rather than an unmanageable token dump.
8. **Final Verification**: Automatically validates that files were modified, builds/compiles without errors (`npm run compile`), and appends follow-up verification steps if issues are discovered.

## Configuration

Settings → `Extensions` → `9 Router Models` (or search `antigravity.`).

| Setting | Default | Description |
|---------|---------|-------------|
| `antigravity.router.baseUrl` | `http://127.0.0.1:20128/v1` | 9 Router base URL (OpenAI-compatible) |
| `antigravity.router.apiKey` | *(empty)* | Optional API key. Leave empty if auth is disabled. |
| `antigravity.models.filterLive` | `true` | Hide live/voice conversation (voice-to-voice) models from the picker. |
| `antigravity.session.temperature` | `0.5` | Sampling temperature (0–2). |
| `antigravity.session.maxTokens` | `4096` | Maximum tokens the model may produce per reply. |
| `antigravity.session.systemPrompt` | *(empty)* | Extra system instructions prepended to the agent rules. |
| `antigravity.session.allowShell` | `true` | Allow the agent to run shell commands. |
| `antigravity.session.allowVscode` | `true` | Allow the agent to run VS Code commands. |
| `antigravity.session.allowFiles` | `true` | Allow the agent to read, list, open, and write files. |
| `antigravity.session.maxTurns` | `40` | Conversation history length (old messages are trimmed). |
| `antigravity.voice.liveModel` | `gemini-3.1-flash-live-preview` | Gemini Live model ID selected from the verified hardcoded models list. |
| `antigravity.voice.geminiApiKeys` | *(empty)* | Comma-separated Gemini API key(s) for Voice Mode. Multiple keys enable automatic quota fallback. |
| `antigravity.voice.ttsVoice` | `Kore` | Voice name for Gemini Live replies (e.g. Kore, Puck, Charon, Aoede). |
| `antigravity.voice.soxPath` | *(auto)* | Path to `sox.exe` for microphone capture. |
| `antigravity.voice.ffplayPath` | *(auto)* | Path to `ffplay.exe` for playback (falls back to PowerShell for WAV). |

## Usage

### 1. Serial Workflow & Role Management
- Open the workflow view via the status-bar menu → **Workflow Pipeline & Roles** or run `9 Router: Open Workflow & Roles View` from the command palette (`Ctrl+Shift+P`).
- Click **+ New Task** to describe a task. The orchestrator decomposes it into a dependency-ordered serial sequence.
- Inspect real-time status: Active role (`Running`), queued roles, progress states (`Analyzing`, `Planning`, `Editing`, `Testing`, `Verifying`), and fallback event notifications.
- Click **Inspect Prompts** on any step to see both the permanent **Role System Prompt** and the **Current Task Prompt**.
- Switch to the **Role Configuration** tab to configure models, reorder fallback chains, edit system prompts, or create new custom roles.

### 2. Main Voice AI Orchestration
- Start Voice mode via the status-bar **Voice mode** button.
- Speak naturally: *"Build an authentication system with database tables, API endpoints, and a login component."*
- Main Voice AI analyzes dependencies, decomposes the request into serial steps (`Database` → `Backend` → `Frontend` → `Testing`), assigns appropriate 9 Router models, and launches execution.
- Main Voice AI remains active and supervises execution, checking progress and reporting the final verified summary over voice.

### 3. Interactive Chat & Model Picker
- Click the status-bar **9 Router · \<model\>** item to browse models, chat with streaming replies, or adjust session options.

## Development & Testing

```bash
npm install                     # install dependencies
npm run compile                 # tsc -> out/
node test-layer2-orchestration.js # run comprehensive Layer 2 serial orchestration & roles test suite
node test-tools.js              # offline + live router tool execution harness
node test-channel.js            # voice WebSocket codec & setup test
npx vsce package --allow-missing-repository --no-yarn # package extension .vsix
```

## Changelog

### Layer 2 Release
- **Role-Based Model Assignment**: Configurable domain roles with independent primary models and fallback chains from 9 Router.
- **Fuzzy Model Search**: Search across complete 1,400+ 9 Router models by ID, display name, provider, capabilities, and keywords.
- **Strictly Serial Orchestration**: Guaranteed single active role execution with dependency ordering and dynamic step adjustments.
- **Intelligent Error Handling**: Automatic retry for temporary errors and context-preserving fallback for persistent failures.
- **Context Handoff**: Structured intelligence transfer between serial roles.
- **Prompt Transparency**: Full visibility into separated Role System Prompts and Task Prompts.
- **Workflow & Roles Webview**: State-of-the-art visual pipeline monitor with live status badges, prompt modal, and role editor.
- **Main Voice AI Bridge**: Gemini Live integration with autonomous serial task planning, status reporting, and final verification.