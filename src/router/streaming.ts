/**
 * 9 Router CLI — Streaming Parser
 *
 * Handles SSE stream parsing and event dispatching for streaming responses.
 */

import type { StreamEvent } from "../core/types";

export type StreamEventHandler = (event: StreamEvent) => void | Promise<void>;

export class StreamParser {
  private buffer = "";
  private decoder = new TextDecoder();
  private handler: StreamEventHandler;

  constructor(handler: StreamEventHandler) {
    this.handler = handler;
  }

  /** Process a chunk of bytes from the stream */
  async processChunk(chunk: Uint8Array): Promise<void> {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    await this.processLines();
  }

  /** Finalize the stream (process any remaining buffer) */
  async finalize(): Promise<void> {
    if (this.buffer.trim()) {
      await this.processLine(this.buffer.trim());
    }
    this.buffer = "";
  }

  private async processLines(): Promise<void> {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      await this.processLine(line.trim());
    }
  }

  private async processLine(line: string): Promise<void> {
    if (!line || line === "data: [DONE]") return;

    if (line.startsWith("data: ")) {
      const jsonStr = line.slice(6);
      try {
        const data = JSON.parse(jsonStr);
        await this.processData(data);
      } catch {
        // Skip malformed JSON
      }
    }
  }

  private async processData(data: Record<string, unknown>): Promise<void> {
    const choices = data.choices as Array<Record<string, unknown>> | undefined;
    if (!choices?.[0]) return;

    const choice = choices[0];
    const delta = choice.delta as Record<string, unknown> | undefined;
    const finishReason = choice.finish_reason as string | null;

    if (delta?.content) {
      await this.safeEmit({ type: "text", content: delta.content as string });
    }

    if (finishReason === "stop" || finishReason === "length") {
      const usage = data.usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;
      await this.safeEmit({
        type: "done",
        usage: usage
          ? { input: usage.prompt_tokens ?? 0, output: usage.completion_tokens ?? 0, total: usage.total_tokens ?? 0 }
          : undefined,
      });
    }

    // Handle error from stream
    if (data.error) {
      const err = data.error as { message?: string };
      await this.safeEmit({ type: "error", message: err.message ?? "Unknown stream error" });
    }
  }

  private async safeEmit(event: StreamEvent): Promise<void> {
    try {
      await this.handler(event);
    } catch {
      // Handler errors should not break the stream
    }
  }
}
