/**
 * 9 Router CLI — Connection Manager
 *
 * Manages multiple 9 Router server connections: add, edit, remove, switch.
 */
import { NineRouterClient } from "./client";
import type { ServerConnection, RouterStatus } from "../core/types";
import type { ConfigManager } from "../config/manager";

export class ConnectionManager {
  private connections: ServerConnection[] = [];
  private activeName: string;
  private client: NineRouterClient;
  private config: ConfigManager;

  constructor(client: NineRouterClient, config: ConfigManager, _logger: unknown) {
    this.client = client;
    this.config = config;
    this.connections = [...(config.get().connections ?? [])];
    this.activeName = config.get().activeConnection ?? "local";
    this.applyActiveConnection();
  }

  /** Get all saved connections */
  list(): ServerConnection[] {
    return [...this.connections];
  }

  /** Get the active connection */
  active(): ServerConnection | undefined {
    return this.connections.find((c) => c.name === this.activeName);
  }

  /** Get the active connection name */
  getActiveName(): string {
    return this.activeName;
  }

  /** Add a new connection */
  add(conn: ServerConnection): void {
    const existing = this.connections.findIndex((c) => c.name === conn.name);
    if (existing >= 0) {
      this.connections[existing] = conn;
    } else {
      this.connections.push(conn);
    }
    this.save();
  }

  /** Remove a connection */
  remove(name: string): boolean {
    const idx = this.connections.findIndex((c) => c.name === name);
    if (idx < 0) return false;
    this.connections.splice(idx, 1);
    if (this.activeName === name) {
      this.activeName = this.connections[0]?.name ?? "local";
    }
    this.save();
    return true;
  }

  /** Switch to a different connection */
  async switch(name: string): Promise<boolean> {
    const conn = this.connections.find((c) => c.name === name);
    if (!conn) return false;
    this.activeName = conn.name;
    this.client.setConfig(conn.baseUrl, conn.apiKey);
    this.save();
    return true;
  }

  /** Test a connection and return its status */
  async test(conn: ServerConnection): Promise<RouterStatus> {
    const active = this.active();
    const savedUrl = active?.baseUrl ?? "";
    const savedKey = active?.apiKey;
    this.client.setConfig(conn.baseUrl, conn.apiKey);
    const status = await this.client.getStatus();
    this.client.setConfig(savedUrl, savedKey);
    return status;
  }

  /** Get status of the active connection */
  async getStatus(): Promise<RouterStatus> {
    return this.client.getStatus();
  }

  private applyActiveConnection(): void {
    const active = this.active();
    if (active) {
      this.client.setConfig(active.baseUrl, active.apiKey);
    }
  }

  private save(): void {
    const cfg = this.config.get();
    cfg.connections = this.connections;
    cfg.activeConnection = this.activeName;
    // Save via ConfigManager's internal set — we use the reference
    this.config.setValue("connections", this.connections);
    this.config.setValue("activeConnection", this.activeName);
    this.config.save();
  }
}
