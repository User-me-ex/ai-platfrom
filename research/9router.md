# 9Router — research notes

Research date: 2026-09-09. Sources: docs.9router.com, dev.9router.com, 9router.com, github.com/decolua/9router, npm registry, local install at `%APPDATA%\9router`.

## What it is

A self-hosted, OpenAI-compatible **AI model router / gateway** (not an n8n node). It proxies one endpoint to 60+ providers (213 in the currently synced local catalog) across 9 service kinds (chat/LLM, embeddings, TTS, STT, image, video, web search, fetch, ...). Also called an "MITM bridge" in newer docs — it can intercept IDE traffic (Antigravity, GitHub Copilot, Kiro IDE) and re-route those subscriptions to any backend through it.

## Key concepts

- **3-tier smart fallback** — requests are routed Tier 1 → Tier 2 → Tier 3 on failure/quota:
  - Tier 1: subscription (Claude Code, Codex, Gemini, GitHub Copilot, etc.)
  - Tier 2: cheap (GLM $0.6/1M, MiniMax $0.2/1M, Kimi)
  - Tier 3: free (Kiro ~50 credits/mo, OpenCode Free, Vertex AI $300)
- **Model ids are provider-prefixed**: `cc/claude-*` (Claude Code), `kr/*` (Kiro), `kr/claude-sonnet-4.5`, `cc/claude-opus-4-7`, etc.
- **RTK / Caveman token saver** — auto-compresses `tool_result` blocks, claims 20–65% token savings.
- **Quota tracking** — dashboard shows quota per account; auto-refreshes/rotates tokens; multi-account round-robin per provider.
- **Format translation** — OpenAI ↔ Anthropic shapes.

## Install / run

- `npm install -g 9router` then `9router` (or Docker `decolua/9router:latest`). VPS env: `JWT_SECRET`, `INITIAL_PASSWORD` (default `123456`), `DATA_DIR` (default `~/.9router`, Windows `%APPDATA%/9router`), `PORT` (default 20128), `BASE_URL`.
- Server: `http://localhost:20128` · Dashboard: `http://localhost:20128/dashboard`
- OpenAI-compatible API: `http://localhost:20128/v1` — **use `127.0.0.1`, not `localhost`** (some CLIs resolve localhost to IPv6).
- API key is per-install (from dashboard); sample key `sk_9router`.

## Local install layout (Windows)

```
%APPDATA%/9router/
  auth/ bin/ db/        (SQLite: %APPDATA%/9router/db/data.sqlite)
  logs/ mitm/           (mitm: rootCA.crt/.key, aliases.json)
  runtime/              (mitm worker + node_modules)
  tailscale/ tunnel/
  jwt-secret / machine-id
  model-catalog-raw.json   (518 KB, synced 2026-09-09 13:39)
  model-catalog.json       (62 KB, 20128 catalog fed to clients)
```

## Catalog (the interesting part)

Raw catalog (`model-catalog-raw.json`) = **213 providers, 7617 model ids**. Providers include openai, anthropic, google, deepseek, xai, groq, openrouter, huggingface, github-copilot, lmstudio, nvidia, minimax, zhipuai, stepfun, etc.

- **49 live/voice/STT/TTS ids** (regex `live|voice|tts|stt|realtime|speech`): `gemini-3-1-flash-tts`, `gemini-2.5-flash-tts`, `qwen-omni-turbo-realtime`, `qwen3-omni-flash-realtime`, `nvidia/nemotron-voicechat`, `grok-voice-think-fast-1.0/2.0`, ...
- **STT ids present** (regex `transcrib|stt|whisper|voice-think|audio`, non-TTS): `openai/gpt-4o-transcribe`, `openai/gpt-4o-mini-transcribe`, `openai/whisper-large-v3(-turbo)`, `KBLab/kb-whisper-large`, `faster-whisper-large-v3`, `spacexai/grok-stt`, `google/gemini-3.5-transcribe(-live)`, `fish-audio/transcribe-1(-free)`, `stepaudio-2.5-asr`, `openai/gpt-realtime-whisper`.
- The extension embeds a reduced snapshot (currently 84 models / 21 providers) derived from `%APPDATA%\9router\model-catalog.json`, which 9Router itself refreshes at 1339 local time.

## API surface (advertised)

Everything OpenAI-compatible under `/v1`:

| Endpoint | Purpose |
|---|---|
| `POST /v1/chat/completions` | chat (streaming supported) |
| `GET /v1/models` | list all models + combos |
| `POST /v1/images/generations` | image generation |
| `POST /v1/audio/speech` | **text-to-speech** |
| `POST /v1/audio/transcriptions` | **speech-to-text** (STT) |
| `POST /v1/embeddings` | embeddings |
| `GET /v1/search` | web search |

Direct (non-OpenAI) docs also mention `/v1/fetch` and video; headers like `prompt_budget: cheap|smart|mini` can force a tier. The dashboard may only expose the /v1 routes that are actually wired per install — the n8n *node* integration (a separate product) only used chat/embeddings/images, which is NOT definitive for the router itself.

## CLI / IDE integrations

Claude Code, Codex, OpenClaw, Cursor, Cline, Continue, Roo, Copilot, Kilo Code, Gemini CLI, Qwen Code, iFlow, Aider, **Antigravity**, OpenCode, Copilot — config example:

```json
{ "models": { "providers": { "9router": {
  "baseUrl": "http://127.0.0.1:20128/v1",
  "apiKey": "sk_9router",
  "models": [{ "id": "kr/claude-sonnet-4.5", "name": "Claude Sonnet 4.5 (Kiro Free)" }]
} } } }
```

## Status of this machine's router

- Router was **offline / not responding** during the 2026-09-09 probe (`/v1/models` timed out at 6 s). Needs to be running before end-to-end voice/STT tests.
- Menu APIs used by the extension: `GET /v1/models` (auth `Bearer <api key>`) and `POST /v1/chat/completions`.

## Implication for voice mode (extension work)

Earlier work assumed "router has no `/audio/transcriptions` so STT must go through chat `input_audio`". That is likely wrong: 9Router advertises `/v1/audio/transcriptions` (STT) and `/v1/audio/speech` (TTS), and the catalog has dedicated STT ids. Next step once the router is online:

1. `POST /v1/audio/transcriptions` with a WAV file → verify; model `openai/gpt-4o-mini-transcribe` (or another STT id).
2. If that 404s, fall back to chat-completions `input_audio` parts against an STT id.
3. Wire whichever works into the voice-mode implementation (sox mic capture → wav → STT → chat).