/**
 * 9 Router CLI — Throttle & Debounce Utilities
 */

/** Create a throttled function that only invokes fn at most once per `wait` ms */
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  wait: number
): (...args: Parameters<T>) => void {
  let lastTime = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;

  return function (this: unknown, ...args: Parameters<T>) {
    const now = Date.now();
    const remaining = wait - (now - lastTime);

    lastArgs = args;

    if (remaining <= 0) {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      lastTime = now;
      fn.apply(this, args);
    } else if (!timeoutId) {
      timeoutId = setTimeout(() => {
        lastTime = Date.now();
        timeoutId = null;
        if (lastArgs) {
          fn.apply(this, lastArgs);
          lastArgs = null;
        }
      }, remaining);
    }
  };
}

/** Create a debounced function that delays invoking fn until after `wait` ms of inactivity */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return function (this: unknown, ...args: Parameters<T>) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn.apply(this, args);
      timeoutId = null;
    }, wait);
  };
}

/** Create a rate-limited function that ensures at most `maxCalls` calls per `interval` ms */
export function rateLimit<T extends (...args: unknown[]) => unknown>(
  fn: T,
  maxCalls: number,
  interval: number
): (...args: Parameters<T>) => void {
  const queue: Array<{ args: Parameters<T>; this: unknown }> = [];
  let callsInInterval = 0;
  let intervalStart = Date.now();

  function processQueue(): void {
    const now = Date.now();
    if (now - intervalStart >= interval) {
      callsInInterval = 0;
      intervalStart = now;
    }

    while (callsInInterval < maxCalls && queue.length > 0) {
      const item = queue.shift()!;
      callsInInterval++;
      fn.apply(item.this, item.args);
    }

    if (queue.length > 0) {
      setTimeout(processQueue, Math.max(0, interval - (Date.now() - intervalStart)));
    }
  }

  return function (this: unknown, ...args: Parameters<T>) {
    queue.push({ args, this: this });
    processQueue();
  };
}
