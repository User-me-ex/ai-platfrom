# Gemini Live Conversation — Model IDs & PCM Configuration

Research notes on Google's **Live Conversation** (voice-to-voice) API, used to decide which models the 9 Router picker filters out by default (`antigravity.models.filterLive`) and to document how such models accept audio.

## Protocol

- **Stateful bidirectional WebSocket (WSS)**, low-latency voice/video/text streaming.
- One persistent session; client sends `BidiGenerateContentRealtimeInput` chunks, server streams audio/transcripts back.
- Session config is the **first message** (`BidiGenerateContentSetup`).

## Model IDs

| Model ID | Status / Release | Notes |
|---|---|---|
| `gemini-2.0-flash-live-preview-04-09` | Preview | Earliest Live preview (text + audio). |
| `gemini-2.0-flash-live-preview` | Preview | Generic preview alias. |
| `gemini-live-2.5-flash-preview` | Preview | 2.5 Flash Live, text/audio. |
| `gemini-live-2.5-pro-preview-09-2025` | Preview | Pro variant of Live. |
| `gemini-2.5-flash-native-audio-preview-12-2025` | Preview | First *native audio* model. |
| `gemini-live-2.5-flash-native-audio` | GA (Dec 12, 2025) | **Recommended.** Native audio, multilingual switching, emotional tone, affective dialog, proactive audio (v1beta), tool use. |
| `gemini-3.1-flash-live-preview` | Preview (2026) | Newest Live preview; `thinkingLevel` (minimal/low/medium/high), `send_realtime_input` for incremental text. |

Pattern: `gemini-<ver>-<family>-live(-preview|-<date>)` and `gemini-live-<ver>-<family>-native-audio`. The 9 Router catalog also carries analogues such as `gemini-3.1-flash-live-preview`, `gemini-3.5-live-translate-preview`, `gemini-3.5-transcribe-live`.

## PCM Configuration

Audio in the Live API is always **raw**, **little-endian**, **16-bit signed PCM** (mono).

| Property | Value |
|---|---|
| Input sample rate | **16 kHz** native (resampled automatically if you send another rate) |
| Output sample rate | **24 kHz** |
| Input MIME | `audio/pcm;rate=16000` (set per chunk/blob) |
| Supported upload MIME types | `audio/x-aac`, `audio/flac`, `audio/mp3`, `audio/m4a`, `audio/mpeg`, `audio/mpga`, `audio/mp4`, `audio/ogg`, `audio/pcm`, `audio/wav`, `audio/webm` |
| WAV encoding for input | 16-bit PCM, 16 kHz, 1 channel (mono) |
| Default conversation length | 10 minutes (extendable) |

> The API will **resample** input, so `rate=16000` in the MIME conveys the true rate for best behavior; do not upsample client-side.

## Session configuration (setup message)

```json
{
  "model": "gemini-3.1-flash-live-preview",
  "generationConfig": {
    "candidateCount": 1,
    "maxOutputTokens": 8192,
    "temperature": 0.5,
    "topP": 0.95,
    "responseModalities": ["AUDIO"],
    "speechConfig": {
      "modelVariant": "BIDIRECTIONAL",
      "languageCode": "en-US",
      "realtimeConfig": {
        "audioModes": []
      }
    }
  },
  "systemInstruction": { "parts": [{ "text": "You are a friendly voice assistant." }] },
  "tools": []
}
```

- **`responseModalities`** accepts **exactly one** of `AUDIO` or `TEXT` per session (setting both errors). For text transcripts alongside speech use `output_audio_transcription`.
- **`speechConfig.modelVariant`**: `BIDIRECTIONAL` (speak whenever + answer) or `UNIDIRECTIONAL` (listen + answer when done).
- Unsupported in generationConfig for Live: `response_logprobs`, `response_mime_type`, `logprobs`, `response_schema`, `stop_sequence`, `routing_config`, `audio_timestamp`.

## Voice activity detection (VAD)

On by default; tune it in `realtime_input_config.automatic_activity_detection`:

```json
{
  "realtime_input_config": {
    "automatic_activity_detection": {
      "disabled": false,
      "start_of_speech_sensitivity": "START_SENSITIVITY_LOW",
      "end_of_speech_sensitivity": "END_SENSITIVITY_LOW",
      "prefix_padding_ms": 20,
      "silence_duration_ms": 100
    }
  }
}
```

To control turn boundaries your own way, set `disabled: true`; the client then sends `activityStart` / `activityEnd` messages and no `audioStreamEnd` is emitted.

## Thinking (native audio models)

- **Gemini 3.1 Live**: `thinking_config.thinking_level` → `minimal` (default, lowest latency), `low`, `medium`, `high`.
- **Gemini 2.5 Live**: `thinking_config.thinking_budget` (token count; `0` disables thinking).

## Transcription

- `input_audio_transcription` — transcript of what the user said (returned as `server_content.input_transcription`).
- `output_audio_transcription` — transcript of the model's spoken reply (language inferred/codec specified).

## Proactive audio (v1beta)

`gemini-live-2.5-flash-native-audio` only. Set `proactivity: { "proactive_audio": true }`; the model replies only when relevant instead of always answering.

## Interaction with the 9 Router extension

- The picker treats any model whose ID matches `live|voice|tts|stt|realtime|speech` as a **live conversation model** and **hides it by default** (`$(flame)` marker when shown).
- Toggle: status-bar menu → *"Live models filtered out / shown"*, or setting `antigravity.models.filterLive` (default `true`).
- Chat completion over the router is bidirectional-streaming; true voice-to-voice sessions need a WebSocket Live client, out of scope for chat completions.

## Sources

- https://ai.google.dev/gemini-api/docs/live-api
- https://ai.google.dev/gemini-api/docs/live-api/capabilities
- https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-native-audio-preview-12-2025
- https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/2-5-flash-live-api