/**
 * 9 Router CLI — Terminal Detection & Capabilities
 */

import { stdout } from "process";

export interface TerminalCapabilities {
  width: number;
  height: number;
  colorDepth: "none" | "16" | "256" | "truecolor";
  supportsAnsi: boolean;
  isTTY: boolean;
  isWindows: boolean;
}

let cached: TerminalCapabilities | null = null;

/** Detect terminal capabilities (cached) */
export function getTerminalCapabilities(): TerminalCapabilities {
  if (cached) return cached;

  const isTTY = stdout.isTTY ?? false;
  const isWindows = process.platform === "win32";

  // Detect color depth from env or terminal
  let colorDepth: TerminalCapabilities["colorDepth"] = "16";
  const colorTerm = process.env["COLORTERM"] ?? "";
  const term = process.env["TERM"] ?? "";

  if (colorTerm.includes("truecolor") || colorTerm.includes("24bit")) {
    colorDepth = "truecolor";
  } else if (term.includes("truecolor") || term.includes("24bit")) {
    colorDepth = "truecolor";
  } else if (term.includes("256")) {
    colorDepth = "256";
  } else if (term.includes("color")) {
    colorDepth = "16";
  }

  // Windows Terminal supports truecolor
  if (isWindows && process.env["WT_SESSION"]) {
    colorDepth = "truecolor";
  }

  cached = {
    width: stdout.columns || 80,
    height: stdout.rows || 24,
    colorDepth,
    supportsAnsi: isTTY || isWindows,
    isTTY,
    isWindows,
  };

  return cached;
}

/** Invalidate cached capabilities (e.g., on resize) */
export function invalidateCapabilities(): void {
  cached = null;
}

/** Get current terminal width */
export function getTerminalWidth(): number {
  return stdout.columns || 80;
}

/** Get current terminal height */
export function getTerminalHeight(): number {
  return stdout.rows || 24;
}

/** Check if terminal supports a given color depth */
export function supportsColor(depth: "16" | "256" | "truecolor"): boolean {
  const caps = getTerminalCapabilities();
  if (depth === "truecolor") return caps.colorDepth === "truecolor";
  if (depth === "256") return caps.colorDepth === "256" || caps.colorDepth === "truecolor";
  return caps.colorDepth !== "none";
}

/** Strip ANSI escape codes from a string */
export function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

/** Wrap text to terminal width */
export function wrapText(text: string, maxWidth?: number): string[] {
  const width = maxWidth ?? getTerminalWidth() - 4; // 4 chars padding
  if (width <= 0) return [text];

  const lines: string[] = [];
  const words = text.split(/(\s+)/);

  let currentLine = "";
  for (const word of words) {
    if (currentLine.length + word.length > width) {
      if (currentLine) lines.push(currentLine.trimEnd());
      currentLine = word;
    } else {
      currentLine += word;
    }
  }
  if (currentLine) lines.push(currentLine.trimEnd());

  return lines.length > 0 ? lines : [text];
}

/** Check if we're running in a pipe (non-interactive) */
export function isPiped(): boolean {
  return !stdout.isTTY;
}
