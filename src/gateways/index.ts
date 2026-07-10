/**
 * 9 Router CLI — Multi-Platform Gateways
 *
 * Inspired by Hermes Agent's multi-platform support:
 * - Telegram gateway (bot API)
 * - Discord gateway (bot API)
 * - Slack gateway (bot API)
 * - Common gateway interface for extensibility
 *
 * Each gateway runs as a separate connection that relays messages
 * between the platform and the CLI's chat engine.
 */

import { EventBus } from "../core/events";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GatewayPlatform = "telegram" | "discord" | "slack" | "whatsapp" | "signal";

export interface GatewayConfig {
  platform: GatewayPlatform;
  enabled: boolean;
  botToken?: string;
  webhookUrl?: string;
  pollInterval?: number;
  options?: Record<string, unknown>;
}

export interface GatewayMessage {
  id: string;
  platform: GatewayPlatform;
  channelId: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: number;
  attachments?: string[];
  replyTo?: string;
}

export interface GatewayStatus {
  platform: GatewayPlatform;
  connected: boolean;
  lastActivity: number;
  messageCount: number;
  error?: string;
}

// ─── Gateway Interface ────────────────────────────────────────────────────────

export interface IGateway {
  readonly platform: GatewayPlatform;
  readonly name: string;

  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  sendMessage(channelId: string, text: string): Promise<boolean>;
  getStatus(): GatewayStatus;
  isConnected(): boolean;
}

// ─── Telegram Gateway ─────────────────────────────────────────────────────────

export class TelegramGateway implements IGateway {
  readonly platform: GatewayPlatform = "telegram";
  readonly name = "Telegram";
  private botToken: string;
  private connected = false;
  private lastOffset = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private messageCount = 0;
  private lastActivity = 0;
  private eventBus: EventBus;
  private _onMessage: ((msg: GatewayMessage) => void) | null = null;

  constructor(botToken: string, eventBus: EventBus) {
    this.botToken = botToken;
    this.eventBus = eventBus;
  }

  async connect(): Promise<boolean> {
    try {
      // Validate token by getting bot info
      const response = await fetch(`https://api.telegram.org/bot${this.botToken}/getMe`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      this.connected = true;
      this.lastActivity = Date.now();

      // Start polling for updates
      this.pollTimer = setInterval(() => this.pollUpdates(), 2000);
      return true;
    } catch (error) {
      this.connected = false;
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.connected = false;
  }

  async sendMessage(channelId: string, text: string): Promise<boolean> {
    if (!this.connected) return false;

    try {
      const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: channelId, text, parse_mode: "Markdown" }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      this.messageCount++;
      this.lastActivity = Date.now();
      this.eventBus.emit("gateway:message:sent", "telegram");
      return true;
    } catch {
      return false;
    }
  }

  setMessageHandler(handler: (msg: GatewayMessage) => void): void {
    this._onMessage = handler;
  }

  getStatus(): GatewayStatus {
    return {
      platform: "telegram",
      connected: this.connected,
      lastActivity: this.lastActivity,
      messageCount: this.messageCount,
    };
  }

  isConnected(): boolean {
    return this.connected;
  }

  private async pollUpdates(): Promise<void> {
    if (!this.connected) return;

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${this.botToken}/getUpdates?offset=${this.lastOffset + 1}&timeout=10`,
        { signal: AbortSignal.timeout(15000) }
      );

      if (!response.ok) return;

      const data = await response.json() as {
        result?: Array<{
          update_id: number;
          message?: {
            message_id: number;
            chat: { id: number; type: string };
            from: { id: number; first_name?: string; username?: string };
            text?: string;
            date: number;
          };
        }>;
      };

      if (!data.result) return;

      for (const update of data.result) {
        this.lastOffset = update.update_id;

        if (update.message?.text) {
          const msg: GatewayMessage = {
            id: String(update.message.message_id),
            platform: "telegram",
            channelId: String(update.message.chat.id),
            userId: String(update.message.from.id),
            userName: update.message.from.username ?? update.message.from.first_name ?? "Unknown",
            text: update.message.text,
            timestamp: update.message.date * 1000,
          };

          this.messageCount++;
          this.lastActivity = Date.now();
          this.eventBus.emit("gateway:message:received", "telegram", msg.text);

          if (this._onMessage) {
            this._onMessage(msg);
          }
        }
      }
    } catch {
      // Silent on poll errors
    }
  }
}

// ─── Discord Gateway ──────────────────────────────────────────────────────────

export class DiscordGateway implements IGateway {
  readonly platform: GatewayPlatform = "discord";
  readonly name = "Discord";
  private botToken: string;
  private connected = false;
  private messageCount = 0;
  private lastActivity = 0;
  private eventBus: EventBus;

  constructor(botToken: string, eventBus: EventBus) {
    this.botToken = botToken;
    this.eventBus = eventBus;
  }

  async connect(): Promise<boolean> {
    try {
      // Validate token
      const response = await fetch("https://discord.com/api/v10/users/@me", {
        headers: { Authorization: `Bot ${this.botToken}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      this.connected = true;
      this.lastActivity = Date.now();
      return true;
    } catch {
      this.connected = false;
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async sendMessage(channelId: string, text: string): Promise<boolean> {
    if (!this.connected) return false;

    try {
      const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bot ${this.botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: text }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      this.messageCount++;
      this.lastActivity = Date.now();
      this.eventBus.emit("gateway:message:sent", "discord");
      return true;
    } catch {
      return false;
    }
  }

  setMessageHandler(_handler: (msg: GatewayMessage) => void): void {
    // Discord event processing not yet implemented
  }

  getStatus(): GatewayStatus {
    return {
      platform: "discord",
      connected: this.connected,
      lastActivity: this.lastActivity,
      messageCount: this.messageCount,
    };
  }

  isConnected(): boolean {
    return this.connected;
  }
}

// ─── Slack Gateway ────────────────────────────────────────────────────────────

export class SlackGateway implements IGateway {
  readonly platform: GatewayPlatform = "slack";
  readonly name = "Slack";
  private botToken: string;
  private connected = false;
  private messageCount = 0;
  private lastActivity = 0;
  private eventBus: EventBus;

  constructor(botToken: string, eventBus: EventBus) {
    this.botToken = botToken;
    this.eventBus = eventBus;
  }

  async connect(): Promise<boolean> {
    try {
      const response = await fetch("https://slack.com/api/auth.test", {
        headers: { Authorization: `Bearer ${this.botToken}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json() as { ok: boolean };
      if (!data.ok) throw new Error("Auth failed");

      this.connected = true;
      this.lastActivity = Date.now();
      return true;
    } catch {
      this.connected = false;
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async sendMessage(channelId: string, text: string): Promise<boolean> {
    if (!this.connected) return false;

    try {
      const response = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ channel: channelId, text, mrkdwn: true }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json() as { ok: boolean };
      if (!data.ok) throw new Error("API error");

      this.messageCount++;
      this.lastActivity = Date.now();
      this.eventBus.emit("gateway:message:sent", "slack");
      return true;
    } catch {
      return false;
    }
  }

  setMessageHandler(_handler: (msg: GatewayMessage) => void): void {
    // Slack event processing not yet implemented
  }

  getStatus(): GatewayStatus {
    return {
      platform: "slack",
      connected: this.connected,
      lastActivity: this.lastActivity,
      messageCount: this.messageCount,
    };
  }

  isConnected(): boolean {
    return this.connected;
  }
}

// ─── Gateway Manager ──────────────────────────────────────────────────────────

export class GatewayManager {
  private gateways: Map<GatewayPlatform, IGateway> = new Map();
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /** Register and connect a gateway */
  async registerGateway(config: GatewayConfig): Promise<boolean> {
    let gateway: IGateway;

    switch (config.platform) {
      case "telegram":
        if (!config.botToken) return false;
        gateway = new TelegramGateway(config.botToken, this.eventBus);
        break;
      case "discord":
        if (!config.botToken) return false;
        gateway = new DiscordGateway(config.botToken, this.eventBus);
        break;
      case "slack":
        if (!config.botToken) return false;
        gateway = new SlackGateway(config.botToken, this.eventBus);
        break;
      default:
        return false;
    }

    const connected = await gateway.connect();
    if (connected) {
      this.gateways.set(config.platform, gateway);
    }
    return connected;
  }

  /** Disconnect and remove a gateway */
  async unregisterGateway(platform: GatewayPlatform): Promise<void> {
    const gateway = this.gateways.get(platform);
    if (gateway) {
      await gateway.disconnect();
      this.gateways.delete(platform);
    }
  }

  /** Send a message through a gateway */
  async sendMessage(platform: GatewayPlatform, channelId: string, text: string): Promise<boolean> {
    const gateway = this.gateways.get(platform);
    if (!gateway || !gateway.isConnected()) return false;
    return gateway.sendMessage(channelId, text);
  }

  /** Broadcast a message to all connected gateways */
  async broadcast(text: string, channelMap: Partial<Record<GatewayPlatform, string>>): Promise<void> {
    const promises = Object.entries(channelMap).map(async ([platform, channelId]) => {
      if (channelId) {
        await this.sendMessage(platform as GatewayPlatform, channelId, text);
      }
    });
    await Promise.all(promises);
  }

  /** Get status of all gateways */
  getAllStatuses(): GatewayStatus[] {
    return [...this.gateways.values()].map((g) => g.getStatus());
  }

  /** Get a specific gateway */
  getGateway(platform: GatewayPlatform): IGateway | undefined {
    return this.gateways.get(platform);
  }

  /** Check if any gateways are connected */
  hasConnected(): boolean {
    return [...this.gateways.values()].some((g) => g.isConnected());
  }

  /** Disconnect all gateways */
  async disconnectAll(): Promise<void> {
    const promises = [...this.gateways.values()].map((g) => g.disconnect().catch(() => {}));
    await Promise.all(promises);
    this.gateways.clear();
  }
}
