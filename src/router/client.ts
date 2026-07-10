/**
 * 9 Router CLI — 9 Router API Client
 *
 * HTTP client for communicating with 9 Router's OpenAI-compatible API.
 */

import type { ModelInfo, RouterClient, ChatParams, ChatResponse, StreamEvent, RouterStatus } from "../core/types";
import { toModelInfo, type ChatCompletionRequest, type ChatMessage } from "./types";
import { ConnectionError, TimeoutError, AuthError, withRetry } from "../core/errors";
import { DEFAULT_TIMEOUT } from "../core/constants";

export class NineRouterClient implements RouterClient {
  public baseUrl: string;
  private apiKey?: string;
  private abortController: AbortController | null = null;

  constructor(baseUrl: string, apiKey?: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
  }

  /** Update the connection config */
  setConfig(baseUrl: string, apiKey?: string): void {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
  }

  /** List all available models from 9 Router */
  async listModels(): Promise<ModelInfo[]> {
    const response = await this.fetch("/models");

    if (!response.ok) {
      throw new ConnectionError(`Failed to list models: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { data?: unknown[] };
    const models = data.data ?? [];

    if (!Array.isArray(models)) {
      return [];
    }

    return models.map((m: unknown) => toModelInfo(m as import("./types").RouterModel));
  }

  /** Stream chat completion tokens */
  async *chatCompletionStream(params: ChatParams): AsyncIterable<StreamEvent> {
    this.abortController = new AbortController();
    const signal = params.signal ?? this.abortController.signal;

    const body: ChatCompletionRequest = {
      model: params.model,
      messages: params.messages as ChatMessage[],
      stream: true,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
    };

    try {
      const response = await withRetry(
        () =>
          this.post("/chat/completions", body, {
            signal,
            timeout: DEFAULT_TIMEOUT,
          }),
        { maxRetries: 2, initialDelay: 1000, maxDelay: 5000, backoff: "exponential" },
        (attempt, error) => {
          console.error(`Retry ${attempt}: ${error.message}`);
        }
      );

      if (!response.ok) {
        const error = await this.parseError(response);
        throw error;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new ConnectionError("No response body received");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") continue;

          if (trimmed.startsWith("data: ")) {
            try {
              const json = JSON.parse(trimmed.slice(6));
              const delta = json.choices?.[0]?.delta;
              const finishReason = json.choices?.[0]?.finish_reason;

              if (delta?.content) {
                yield { type: "text", content: delta.content };
              }

              if (finishReason === "stop" || finishReason === "length") {
                const usage = json.usage;
                const u = usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;
                yield {
                  type: "done",
                  usage: u
                    ? { input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0, total: u.total_tokens ?? 0 }
                    : undefined,
                };
              }
            } catch {
              // Skip malformed JSON chunks
            }
          }
        }
      }

      // If stream ended without done event, yield it
      yield { type: "done" };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      throw error;
    } finally {
      this.abortController = null;
    }
  }

  /** Non-streaming chat completion */
  async chatCompletion(params: ChatParams): Promise<ChatResponse> {
    this.abortController = new AbortController();

    const body: ChatCompletionRequest = {
      model: params.model,
      messages: params.messages as ChatMessage[],
      stream: false,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
    };

    try {
      const response = await this.post("/chat/completions", body, {
        signal: params.signal ?? this.abortController.signal,
      });

      if (!response.ok) {
        const error = await this.parseError(response);
        throw error;
      }

      const data = (await response.json()) as {
        id: string;
        model: string;
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      };
      return {
        id: data.id,
        content: data.choices?.[0]?.message?.content ?? "",
        model: data.model,
        usage: data.usage
          ? { input: data.usage.prompt_tokens, output: data.usage.completion_tokens, total: data.usage.total_tokens }
          : undefined,
      };
    } finally {
      this.abortController = null;
    }
  }

  /** Check if 9 Router is reachable */
  async ping(): Promise<boolean> {
    try {
      const response = await this.fetch("/models", { timeout: 5000 });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** Get router connection status */
  async getStatus(): Promise<RouterStatus> {
    try {
      const start = Date.now();
      const response = await this.fetch("/models", { timeout: 5000 });
      const latency = Date.now() - start;

      if (!response.ok) {
        return { connected: false, modelsCount: 0 };
      }

      const data = (await response.json()) as { data?: unknown[] };
      const models = data.data ?? [];

      return {
        connected: true,
        modelsCount: Array.isArray(models) ? models.length : 0,
        version: "unknown",
        uptime: latency,
      };
    } catch {
      return { connected: false, modelsCount: 0 };
    }
  }

  /** Cancel any ongoing request */
  cancelRequest(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private async fetch(path: string, options: RequestInit & { timeout?: number } = {}): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = options.timeout
      ? setTimeout(() => controller.abort(), options.timeout)
      : undefined;

    try {
      const response = await fetch(url, {
        ...options,
        headers: { ...headers, ...(options.headers as Record<string, string>) },
        signal: options.signal ?? controller.signal,
      });
      return response;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  private async post(path: string, body: unknown, options: RequestInit & { timeout?: number } = {}): Promise<Response> {
    return this.fetch(path, {
      method: "POST",
      body: JSON.stringify(body),
      ...options,
    });
  }

  private async parseError(response: Response): Promise<Error> {
    let message = `HTTP ${response.status}: ${response.statusText}`;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      message = body.error?.message ?? message;
    } catch {
      // Use default message
    }

    switch (response.status) {
      case 401:
        return new AuthError(message);
      case 408:
      case 429:
        return new TimeoutError(message);
      default:
        return new ConnectionError(message);
    }
  }
}
