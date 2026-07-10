/**
 * 9 Router CLI — Chat Engine
 *
 * Manages the chat loop, message handling, and stream dispatch.
 */

import type { ChatEngine, Message, StreamEvent, ContextStats } from "../core/types";
import { eventBus, type EventBus } from "../core/events";
import type { NineRouterClient } from "../router/client";
import type { ModelRegistry } from "../router/models";
import { ModelNotFoundError } from "../core/errors";

export class ChatEngineImpl implements ChatEngine {
  public currentModel: string = "";
  private messages: Message[] = [];
  private systemPrompt = "";
  private router: NineRouterClient;
  private modelRegistry: ModelRegistry;
  private eventBus: EventBus;
  private _isStreaming = false;
  private abortController: AbortController | null = null;
  private modelContextLength = 4096;

  constructor(router: NineRouterClient, modelRegistry: ModelRegistry) {
    this.router = router;
    this.modelRegistry = modelRegistry;
    this.eventBus = eventBus;
  }

  /** Initialize a new chat session */
  async startChat(modelId?: string, systemPrompt?: string): Promise<void> {
    this.messages = [];
    this.systemPrompt = systemPrompt ?? "";
    this._isStreaming = false;

    if (modelId) {
      this.setModel(modelId);
    }
  }

  /** Select a model for the chat */
  setModel(modelId: string): void {
    const model = this.modelRegistry.getModel(modelId);
    if (!model) {
      throw new ModelNotFoundError(modelId);
    }
    this.currentModel = modelId;
    this.modelContextLength = model.contextLength;
    this.eventBus.emit("model:changed", modelId);
  }

  /** Send a message and stream the response */
  async sendMessage(content: string, onStream?: (event: StreamEvent) => void): Promise<string> {
    if (!this.currentModel) {
      throw new Error("No model selected. Use /model to select one.");
    }

    if (this._isStreaming) {
      throw new Error("Already streaming a response. Abort it first.");
    }

    // Add user message
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      createdAt: Date.now(),
    };
    this.messages.push(userMessage);

    // Build API payload
    const apiMessages = [];
    if (this.systemPrompt) {
      apiMessages.push({ role: "system" as const, content: this.systemPrompt });
    }
    for (const msg of this.messages) {
      if (msg.role === "user" || msg.role === "assistant") {
        apiMessages.push({ role: msg.role as "user" | "assistant", content: msg.content });
      }
    }

    // Start streaming
    this._isStreaming = true;
    this.abortController = new AbortController();
    this.eventBus.emit("stream:start");

    let fullContent = "";
    let totalInput = 0;
    let totalOutput = 0;

    try {
      const stream = this.router.chatCompletionStream({
        model: this.currentModel,
        messages: apiMessages,
        signal: this.abortController.signal,
      });

      for await (const event of stream) {
        switch (event.type) {
          case "text":
            fullContent += event.content;
            onStream?.(event);
            this.eventBus.emit("stream:token", event.content);
            break;
          case "thinking":
            onStream?.(event);
            break;
          case "done":
            if (event.usage) {
              totalInput = event.usage.input;
              totalOutput = event.usage.output;
            }
            onStream?.(event);
            break;
          case "error":
            throw new Error(event.message);
        }
      }

      // Add assistant message
      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: fullContent,
        modelId: this.currentModel,
        tokensIn: totalInput,
        tokensOut: totalOutput,
        createdAt: Date.now(),
      };
      this.messages.push(assistantMessage);

      this.eventBus.emit("stream:done");

      return fullContent;
    } catch (error) {
      this.eventBus.emit("stream:error", error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      this._isStreaming = false;
      this.abortController = null;
    }
  }

  /** Abort the current streaming request */
  abortStream(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this._isStreaming = false;
  }

  /** Check if currently streaming */
  isStreaming(): boolean {
    return this._isStreaming;
  }

  /** Get the current conversation messages */
  getConversation(): Message[] {
    return [...this.messages];
  }

  /** Clear all messages */
  clearConversation(): void {
    this.messages = [];
  }

  /** Set system prompt */
  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  /** Get system prompt */
  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  /** Get context usage statistics */
  getContextStats(): ContextStats {
    const totalChars = this.messages.reduce((sum, m) => sum + m.content.length, 0);
    // Rough estimation: 4 chars ≈ 1 token
    const totalTokens = Math.ceil(totalChars / 4);

    return {
      totalTokens,
      messageCount: this.messages.length,
      percentageUsed: this.modelContextLength > 0
        ? Math.round((totalTokens / this.modelContextLength) * 100)
        : 0,
    };
  }

  /** Get total message count */
  get messageCount(): number {
    return this.messages.length;
  }
}
