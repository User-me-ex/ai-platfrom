/**
 * 9 Router CLI — Router Types
 *
 * Types specific to the 9 Router API communication.
 */

import type { ModelInfo } from "../core/types";

/** 9 Router API response for /v1/models */
export interface RouterModelsResponse {
  object: "list";
  data: RouterModel[];
}

/** 9 Router API model object */
export interface RouterModel {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
  /** Extra metadata that 9 Router may expose */
  metadata?: Record<string, unknown>;
}

/** Parsed capabilities from model metadata */
export interface RouterModelCapabilities {
  max_tokens?: number;
  context_length?: number;
  reasoning?: boolean;
  vision?: boolean;
  audio?: boolean;
  tool_use?: boolean;
  function_calling?: boolean;
  streaming?: boolean;
}

/** OpenAI-compatible chat completion request body */
export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
}

/** OpenAI-compatible chat message */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

/** OpenAI-compatible streaming chunk */
export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: ChunkChoice[];
}

export interface ChunkChoice {
  index: number;
  delta: ChunkDelta;
  finish_reason: "stop" | "length" | "tool_calls" | null;
}

export interface ChunkDelta {
  role?: "assistant";
  content?: string;
}

/** OpenAI-compatible non-streaming response */
export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ResponseChoice[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ResponseChoice {
  index: number;
  message: {
    role: "assistant";
    content: string;
  };
  finish_reason: "stop" | "length" | "tool_calls";
}

/** Convert router model to our internal ModelInfo */
export function toModelInfo(routerModel: RouterModel): ModelInfo {
  const id = routerModel.id;
  const parts = id.split("/");
  const provider = parts.length > 1 ? parts[0] ?? "unknown" : "unknown";
  const name = parts.length > 1 ? parts.slice(1).join("/") : id;

  // Attempt to parse capabilities from metadata
  const meta = (routerModel.metadata ?? {}) as RouterModelCapabilities;
  const rawMeta = routerModel.metadata as Record<string, unknown> | undefined;

  const ownedBy = routerModel.owned_by?.trim() || "";
  const metaKeys = ["provider_display_name", "provider_name", "display_name", "full_name", "organization", "org_name", "provider"];
  let metaDisplayName = "";
  for (const k of metaKeys) {
    const v = rawMeta?.[k];
    if (v && typeof v === "string" && v.trim()) { metaDisplayName = v.trim(); break; }
  }
  const providerDisplayName = metaDisplayName || ownedBy || provider;

  return {
    id,
    name,
    provider,
    providerDisplayName,
    contextLength: meta.context_length ?? meta.max_tokens ?? 4096,
    capabilities: {
      reasoning: meta.reasoning ?? false,
      vision: meta.vision ?? false,
      audio: meta.audio ?? false,
      toolUse: meta.tool_use ?? meta.function_calling ?? false,
      functionCalling: meta.function_calling ?? meta.tool_use ?? false,
      streaming: meta.streaming ?? true,
    },
    metadata: routerModel.metadata ?? {},
  };
}
