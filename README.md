# 9 Router Models

Pick AI models served by the local **9 Router gateway** (`http://127.0.0.1:20128/v1`) and chat with them — streaming replies, full agentic access to your machine, live typing feedback, and a **real-time voice conversation** mode over a local WebSocket channel (Gemini Live).

## Features

- **Model Picker** — browse the live `/v1/models` list merged with an embedded catalog (84 models, 21 providers). Shows provider, source badge (router/catalog), `$(flame)` marker for live/voice models, and capabilities (context window, max output, vision/audio/tools/reasoning). If the router is offline the picker falls back to the catalog and shows the error.
- **Live-Model Filter (default on)** — all live/voice conversation (voice-to-voice) models are hidden from the picker by default. Toggle from the status-bar menu or the `antigravity.models.filterLive` setting. See [Gemini Live conversation — model IDs & PCM config](research/gemini-live-conversation.md) for the underlying research.
- **Streaming Chat** — type messages into the input box; the reply streams into the output channel in real time.
- **Typing Indicator** — a status-bar spinner tracks the agent live: `thinking` → `typing` (while streaming) → `running tools`, then clears; every turn ends with a `[✓ done]` line in the output.
- **Agent Tools** — the model can read files, list directories, create/edit files, run shell commands, run any VS Code command, and open files in the editor. Execution is announced in the output channel.
- **Session Options** — per-session temperature, max tokens, extra system prompt, history length, and per-tool on/off switches.
- **Voice Conversation — live WebSocket channel** — true real-time voice-to-voice. **9 Router serves the channel** at `ws://127.0.0.1:20128/voice` — a patched `custom-server.js` that bridges the socket to **Gemini Live** (16 kHz PCM in / 24 kHz PCM out), echoing model transcripts into the output channel as they happen. Press the status-bar **mic** to talk, press again to listen; **mute** stops your audio from being sent. Auth uses the API key of 9 Router's active `gemini`/`vertex` provider connection — no separate Google key required.
- **Status Bar** — one click opens a menu: Chat, Pick model, Session options, Voice mode.

## Requirements

- VS Code `^1.90.0`
- A running 9 Router gateway (default: `http://127.0.0.1:20128/v1`), or the catalog-only fallback if it is down

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
| `antigravity.voice.liveModel` | `gemini-3.1-flash-live-preview` | Gemini Live model id for the real-time channel (audio-in / audio-out). |
| `antigravity.voice.routerPort` | `20128` | 9 Router port that serves the voice WebSocket channel (`ws://127.0.0.1:<port>/voice`), authenticated with the router's own gemini/vertex provider key. |
| `antigravity.voice.ttsVoice` | `Kore` | Voice name for Gemini Live replies (e.g. Kore, Puck, Charon, Aoede). |
| `antigravity.voice.soxPath` | *(auto)* | Path to `sox.exe` for microphone capture. |
| `antigravity.voice.ffplayPath` | *(auto)* | Path to `ffplay.exe` for playback (falls back to PowerShell for WAV). |

## Usage

1. Reload the window after installing.
2. Click the **9 Router · \<model\>** status bar item (or run `9 Router: Pick Model` from the command palette).
3. Pick a model, then choose **Chat with selected model**. Live/voice conversation models are filtered out — use the status-bar menu toggle *"Live models filtered out / shown"* (or set `antigravity.models.filterLive: false`) to browse/select them.
4. Type messages. The selected model can use agent tools automatically (a tool must be both enabled in the session options and correctly emitted by the model).
5. Adjust per-session behavior via the **Session options** menu item or the command `9 Router: Session Options`.

### Voice conversation (live, WebSocket)

Real-time voice-to-voice runs through the **9 Router WebSocket gateway** — 9 Router now serves the live channel itself at `ws://127.0.0.1:20128/voice` (16 kHz PCM in / 24 kHz PCM out), authenticating Gemini Live with the API key of its active `gemini`/`vertex` provider connection. No separate Google key is needed.

1. Open the status-bar menu → **Voice mode** (or run `9 Router: Voice Conversation`). The extension connects to the router's channel and the output channel shows the live model, voice, and channel URL.
2. Click the status-bar **mic** button and speak — your audio streams up in real time (16 kHz PCM). Click **mic** again to stop talking and listen.
3. The model's reply streams back (24 kHz PCM) and plays through the speaker as it is generated; the transcript appears in the output channel live.
4. **mute** silences your mic without ending the call. Click **Voice mode** again to hang up.

Troubleshooting: check the output channel for `[voice]` lines — status/errors report there. `sox` is needed for capture and `ffplay` for playback (auto-detected, override with `antigravity.voice.soxPath` / `antigravity.voice.ffplayPath`).

## Agent Tools

While chatting the model may emit these tool blocks. The agent loop executes them, feeds results back, and continues until it reaches a final answer (up to 15 tool rounds per message).

| Tool | Syntax | Description |
|------|--------|-------------|
| Read | `<antigravity:read path="..."/>` | Read a file's contents. |
| List | `<antigravity:list path="..."/>` | List a directory (`file`/`dir` entries). |
| Shell | `<antigravity:shell command="..."/>` | Run a shell command (PowerShell on Windows; cwd = workspace root or home). |
| VS Code | `<antigravity:vscode command="..." args='[...]'/>` | Run a VS Code command with optional JSON args. |
| Open | `<antigravity:open path="..."/>` | Open a file in the editor. |
| File | `<antigravity:file path="...">content</antigravity:file>` | Create or overwrite a file (existing files prompt before writing). |

### Tool policy

The session options on/off switches are enforced in the agent loop — a disabled tool produces **no** executions (verified by tests). Shell and VS Code commands run with full access to the machine; use with a trusted model.

## Development

```
npm install         # install dev dependencies
npm run compile     # tsc -> out/
node test-tools.js  # offline + live router test harness (stubs the vscode API)
node test-channel.js # offline codec + setup-builder test for the 9 Router voice gateway
node probe-voice-endpoint.js # optional: probe a running 9 Router at ws://127.0.0.1:20128/voice (full round-trip)
npx vsce package --allow-missing-repository --no-yarn   # build .vsix
```

## Repository

Source lives in `D:\New folder` and is published to `https://github.com/User-me-ex/ai-platfrom.git`.