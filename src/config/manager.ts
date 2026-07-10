/**
 * 9 Router CLI — Configuration Manager
 *
 * Manages reading/writing/validating configuration from disk.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import type { Config } from "../core/types";
import { DEFAULT_CONFIG } from "./defaults";
import { DEFAULT_MODEL } from "../core/constants";
import { getConfigPath } from "../utils/paths";
import { ConfigError } from "../core/errors";

export class ConfigManager {
  private config: Config;
  private configPath: string;
  private dirty = false;

  constructor() {
    this.configPath = getConfigPath();
    this.config = this.load();
  }

  /** Get the full config */
  get(): Config {
    return { ...this.config };
  }

  /** Get a specific config value by dot path (e.g., "render.markdown") */
  getValue(key: string): unknown {
    const parts = key.split(".");
    let current: unknown = this.config;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current === "object" && part in current) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
    return current;
  }

  /** Set a config value by dot path */
  setValue(key: string, value: unknown): void {
    const parts = key.split(".");
    let current: unknown = this.config;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      if (current && typeof current === "object" && part in current) {
        current = (current as Record<string, unknown>)[part];
      } else {
        throw new ConfigError(`Invalid config key: ${key}`);
      }
    }

    const lastPart = parts[parts.length - 1]!;
    if (current && typeof current === "object" && lastPart in current) {
      (current as Record<string, unknown>)[lastPart] = value;
      this.dirty = true;
    } else {
      throw new ConfigError(`Invalid config key: ${key}`);
    }
  }

  /** Save config to disk if dirty */
  save(): void {
    if (!this.dirty) return;
    this.writeConfig(this.config);
    this.dirty = false;
  }

  /** Get the path to the config file */
  get path(): string {
    return this.configPath;
  }

  private load(): Config {
    try {
      if (existsSync(this.configPath)) {
        const raw = readFileSync(this.configPath, "utf-8");
        const parsed = JSON.parse(raw);
        return this.mergeWithDefaults(parsed);
      }
    } catch (error) {
      console.error(`Failed to load config from ${this.configPath}:`, error);
    }
    return { ...DEFAULT_CONFIG };
  }

  private mergeWithDefaults(partial: Partial<Config>): Config {
    return {
      ...DEFAULT_CONFIG,
      ...partial,
      baseUrl: partial.baseUrl ?? DEFAULT_CONFIG.baseUrl,
      defaultModel: partial.defaultModel ?? DEFAULT_MODEL,
      activeConnection: partial.activeConnection ?? DEFAULT_CONFIG.activeConnection,
      connections: partial.connections ?? DEFAULT_CONFIG.connections,
      render: { ...DEFAULT_CONFIG.render, ...partial.render },
      streaming: { ...DEFAULT_CONFIG.streaming, ...partial.streaming },
      session: { ...DEFAULT_CONFIG.session, ...partial.session },
      logging: { ...DEFAULT_CONFIG.logging, ...partial.logging },
      plugins: { ...DEFAULT_CONFIG.plugins, ...partial.plugins },
      performance: { ...DEFAULT_CONFIG.performance, ...partial.performance },
      keybindings: { ...DEFAULT_CONFIG.keybindings, ...partial.keybindings },
    };
  }

  private writeConfig(config: Config): void {
    try {
      writeFileSync(this.configPath, JSON.stringify(config, null, 2), "utf-8");
    } catch (error) {
      console.error(`Failed to write config to ${this.configPath}:`, error);
    }
  }
}
