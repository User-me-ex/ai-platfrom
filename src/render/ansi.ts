/**
 * 9 Router CLI — ANSI Utilities
 *
 * Low-level ANSI escape code helpers for terminal rendering.
 */

import { getTerminalWidth } from "../utils/terminal";
import { ANSI } from "../core/constants";

/** Clear the current line and move cursor to beginning */
export function clearLine(): string {
  return `\r${ANSI.CLEAR_LINE}`;
}

/** Move cursor up N lines */
export function cursorUp(n = 1): string {
  return n > 0 ? ANSI.CURSOR_UP(n) : "";
}

/** Move cursor down N lines */
export function cursorDown(n = 1): string {
  return n > 0 ? ANSI.CURSOR_DOWN(n) : "";
}

/** Clear from cursor to end of screen */
export function clearScreenAfter(): string {
  return ANSI.CLEAR_SCREEN_AFTER;
}

/** Save cursor position */
export function saveCursor(): string {
  return ANSI.CURSOR_SAVE;
}

/** Restore cursor position */
export function restoreCursor(): string {
  return ANSI.CURSOR_RESTORE;
}

/** Hide cursor */
export function hideCursor(): string {
  return ANSI.CURSOR_HIDE;
}

/** Show cursor */
export function showCursor(): string {
  return ANSI.CURSOR_SHOW;
}

/** Enter alternate screen buffer */
export function enterAltScreen(): string {
  return ANSI.ALTERNATE_SCREEN;
}

/** Exit alternate screen buffer */
export function exitAltScreen(): string {
  return ANSI.MAIN_SCREEN;
}

/** Draw a horizontal line across the terminal */
export function horizontalLine(char = "─", color = ""): string {
  const width = getTerminalWidth();
  return `${color}${char.repeat(Math.max(width - 2, 0))}${ANSI.RESET}`;
}

/** Draw a box around text */
export function boxText(lines: string[], borderColor = ""): string {
  const width = getTerminalWidth() - 4;
  const wrapped: string[] = [];

  for (const line of lines) {
    if (line.length > width) {
      // Wrap long text
      for (let i = 0; i < line.length; i += width) {
        wrapped.push(line.slice(i, i + width));
      }
    } else {
      wrapped.push(line);
    }
  }

  const border = `${borderColor}${ANSI.RESET}`;
  const result: string[] = [];

  result.push(`${border}┌${"─".repeat(width)}┐${ANSI.RESET}`);
  for (const line of wrapped) {
    const padding = width - stripAnsi(line).length;
    result.push(`${border}│ ${line}${" ".repeat(Math.max(padding - 1, 0))} │${ANSI.RESET}`);
  }
  result.push(`${border}└${"─".repeat(width)}┘${ANSI.RESET}`);

  return result.join("\n");
}

/** Center text within terminal width */
export function centerText(text: string): string {
  const width = getTerminalWidth();
  const stripped = stripAnsi(text);
  const padding = Math.max(Math.floor((width - stripped.length) / 2), 0);
  return " ".repeat(padding) + text;
}

/** Pad right with spaces to terminal width */
export function padRight(text: string): string {
  const width = getTerminalWidth();
  const stripped = stripAnsi(text);
  const padding = Math.max(width - stripped.length, 0);
  return text + " ".repeat(padding);
}

/** Strip ANSI escape codes from a string */
export function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

/** Get visible length of string (without ANSI codes) */
export function visibleLength(str: string): number {
  return stripAnsi(str).length;
}

/** Truncate string to visible width */
export function truncate(str: string, maxWidth: number): string {
  const stripped = stripAnsi(str);
  if (stripped.length <= maxWidth) return str;

  // Find the ANSI-free substring
  let visible = 0;
  let result = "";
  let inEscape = false;

  for (const char of str) {
    if (char === "\x1b") {
      inEscape = true;
      result += char;
      continue;
    }
    if (inEscape) {
      result += char;
      if (char === "m") {
        inEscape = false;
      }
      continue;
    }
    if (visible >= maxWidth - 1) {
      result += "…";
      break;
    }
    result += char;
    visible++;
  }

  return result;
}
