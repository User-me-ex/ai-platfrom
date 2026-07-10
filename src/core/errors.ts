/**
 * 9 Router CLI — Custom Error Classes
 */

import { ERROR_CODES } from "./constants";

export class RouterError extends Error {
  public readonly code: string;
  public readonly statusCode?: number;
  public readonly recoverable: boolean;

  constructor(
    message: string,
    code: string = ERROR_CODES.UNKNOWN_ERROR,
    statusCode?: number,
    recoverable = false
  ) {
    super(message);
    this.name = "RouterError";
    this.code = code;
    this.statusCode = statusCode;
    this.recoverable = recoverable;
  }
}

export class ConnectionError extends RouterError {
  constructor(message = "Cannot connect to 9 Router. Is it running?" ) {
    super(message, ERROR_CODES.CONNECTION_REFUSED, undefined, true);
    this.name = "ConnectionError";
  }
}

export class ModelNotFoundError extends RouterError {
  constructor(modelId: string) {
    super(`Model "${modelId}" is not available`, ERROR_CODES.MODEL_NOT_FOUND, 404, true);
    this.name = "ModelNotFoundError";
  }
}

export class TimeoutError extends RouterError {
  constructor(message = "Request timed out") {
    super(message, ERROR_CODES.TIMEOUT, undefined, true);
    this.name = "TimeoutError";
  }
}

export class AuthError extends RouterError {
  constructor(message = "Invalid API key or authentication failed") {
    super(message, ERROR_CODES.AUTH_ERROR, 401, false);
    this.name = "AuthError";
  }
}

export class StreamingError extends RouterError {
  constructor(message = "Stream was interrupted") {
    super(message, ERROR_CODES.STREAM_INTERRUPTED, undefined, true);
    this.name = "StreamingError";
  }
}

export class ConfigError extends RouterError {
  constructor(message: string) {
    super(message, ERROR_CODES.CONFIG_INVALID, undefined, false);
    this.name = "ConfigError";
  }
}

export class SessionNotFoundError extends RouterError {
  constructor(sessionId: string) {
    super(`Session "${sessionId}" not found`, ERROR_CODES.SESSION_NOT_FOUND, 404, false);
    this.name = "SessionNotFoundError";
  }
}

export class PluginLoadError extends RouterError {
  constructor(name: string, reason: string) {
    super(`Failed to load plugin "${name}": ${reason}`, ERROR_CODES.PLUGIN_LOAD_FAILED, undefined, false);
    this.name = "PluginLoadError";
  }
}

/** Retry configuration */
export interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoff: "linear" | "exponential";
}

/** Retry a function with backoff */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    backoff: "exponential",
  },
  onRetry?: (attempt: number, error: Error) => void
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === config.maxRetries) {
        break;
      }

      onRetry?.(attempt + 1, lastError);

      const delay = config.backoff === "exponential"
        ? Math.min(config.initialDelay * Math.pow(2, attempt), config.maxDelay)
        : config.initialDelay * (attempt + 1);

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
