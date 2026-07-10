/**
 * 9 Router CLI — XDG Path Resolution
 *
 * Cross-platform path resolution following XDG Base Directory Specification.
 */

import { homedir } from "os";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import { CONFIG_DIR_NAME } from "../core/constants";

function getEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

/** Get the config directory path, creating it if needed */
export function getConfigDir(): string {
  const xdgConfig = getEnv("XDG_CONFIG_HOME", join(homedir(), ".config"));
  const dir = join(xdgConfig, CONFIG_DIR_NAME);
  ensureDir(dir);
  return dir;
}

/** Get the data directory path, creating it if needed */
export function getDataDir(): string {
  const xdgData = getEnv("XDG_DATA_HOME", join(homedir(), ".local", "share"));
  const dir = join(xdgData, CONFIG_DIR_NAME);
  ensureDir(dir);
  return dir;
}

/** Get the cache directory path, creating it if needed */
export function getCacheDir(): string {
  const xdgCache = getEnv("XDG_CACHE_HOME", join(homedir(), ".cache"));
  const dir = join(xdgCache, CONFIG_DIR_NAME);
  ensureDir(dir);
  return dir;
}

/** Get the state directory path, creating it if needed */
export function getStateDir(): string {
  const xdgState = getEnv("XDG_STATE_HOME", join(homedir(), ".local", "state"));
  const dir = join(xdgState, CONFIG_DIR_NAME);
  ensureDir(dir);
  return dir;
}

/** Get path to config file */
export function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

/** Get path to sessions database */
export function getSessionsDbPath(): string {
  return join(getDataDir(), "sessions.db");
}

/** Get path to log file */
export function getLogPath(): string {
  return join(getStateDir(), "cli.log");
}

/** Get path to plugin directory */
export function getPluginDir(): string {
  return join(getConfigDir(), "plugins");
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}
