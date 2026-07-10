/**
 * 9 Router CLI — Model Discovery & Registry
 *
 * Manages discovering, caching, and querying models from 9 Router.
 */

import type { ModelInfo } from "../core/types";
import { EventBus, eventBus } from "../core/events";
import { DEFAULT_MODEL_REFRESH_INTERVAL } from "../core/constants";
import type { NineRouterClient } from "./client";
type RouterClient = NineRouterClient;

export class ModelRegistry {
  private models: ModelInfo[] = [];
  private lastRefresh = 0;
  private refreshInterval: number;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private router: RouterClient;
  private eventBus: EventBus;

  constructor(router: RouterClient, refreshInterval = DEFAULT_MODEL_REFRESH_INTERVAL) {
    this.router = router;
    this.refreshInterval = refreshInterval * 1000;
    this.eventBus = eventBus;
  }

  /** Get all available models */
  listModels(): ModelInfo[] {
    return [...this.models];
  }

  /** Get a specific model by ID */
  getModel(id: string): ModelInfo | undefined {
    return this.models.find((m) => m.id === id);
  }

  /** Search models by name or provider (fuzzy) */
  searchModels(query: string): ModelInfo[] {
    const q = query.toLowerCase();
    return this.models.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q)
    );
  }

  /** Group models by their provider */
  groupByProvider(): Map<string, ModelInfo[]> {
    const groups = new Map<string, ModelInfo[]>();
    for (const model of this.models) {
      const existing = groups.get(model.provider) ?? [];
      existing.push(model);
      groups.set(model.provider, existing);
    }
    // Sort each group
    for (const [, group] of groups) {
      group.sort((a, b) => a.id.localeCompare(b.id));
    }
    return groups;
  }

  /** Get unique providers */
  getProviders(): string[] {
    return [...new Set(this.models.map((m) => m.provider))].sort();
  }

  /** Fetch fresh model list from 9 Router */
  async refreshModels(): Promise<ModelInfo[]> {
    try {
      const models = await this.router.listModels();
      this.models = models;
      this.lastRefresh = Date.now();
      this.eventBus.emit("config:changed", { modelsCount: models.length });
      return models;
    } catch (error) {
      // If we have cached models, keep using them
      if (this.models.length > 0) {
        return this.models;
      }
      throw error;
    }
  }

  /** Start periodic model refresh */
  startAutoRefresh(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setInterval(() => {
      this.refreshModels().catch(() => {
        // Silently fail background refresh
      });
    }, this.refreshInterval);
  }

  /** Stop periodic model refresh */
  stopAutoRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /** Check if we have models loaded */
  hasModels(): boolean {
    return this.models.length > 0;
  }

  /** Get model count */
  get count(): number {
    return this.models.length;
  }

  /** Get time since last refresh in seconds */
  get secondsSinceRefresh(): number {
    return (Date.now() - this.lastRefresh) / 1000;
  }
}
