/**
 * 9 Router CLI — Shared UI Hooks
 *
 * Reusable hooks for keyboard navigation, fuzzy search, scrolling,
 * and viewport management across all TUI components.
 */

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import type { Key } from "ink";

// ─── Fuzzy Search ───────────────────────────────────────────────────────────

export interface FuzzyMatchResult {
  index: number;
  score: number;
  matches: number[]; // character indices that matched
}

/**
 * Fuzzy search with scoring and highlighted match positions.
 * Returns results sorted by relevance (best first).
 */
export function fuzzySearch<T>(
  items: T[],
  query: string,
  getText: (item: T) => string,
  maxResults = 200
): Array<{ item: T; match: FuzzyMatchResult }> {
  if (!query) return items.slice(0, maxResults).map((item, index) => ({
    item,
    match: { index, score: 0, matches: [] },
  }));

  const lowerQuery = query.toLowerCase();
  const scored: Array<{ item: T; match: FuzzyMatchResult }> = [];

  for (let i = 0; i < items.length && scored.length < maxResults * 2; i++) {
    const text = getText(items[i]!).toLowerCase();
    const result = computeFuzzyScore(text, lowerQuery);
    if (result) {
      scored.push({ item: items[i]!, match: { ...result, index: i } });
    }
  }

  // Sort by score descending
  scored.sort((a, b) => b.match.score - a.match.score);

  return scored.slice(0, maxResults);
}

function computeFuzzyScore(text: string, query: string): Omit<FuzzyMatchResult, "index"> | null {
  let qi = 0;
  const matches: number[] = [];
  let score = 0;
  let consecutive = 0;

  for (let ti = 0; ti < text.length && qi < query.length; ti++) {
    if (text[ti] === query[qi]) {
      matches.push(ti);
      consecutive++;
      // Bonus for consecutive matches
      score += 10 + consecutive * 5;
      // Bonus for match at word boundary
      if (ti === 0 || text[ti - 1] === " " || text[ti - 1] === "-" || text[ti - 1] === "/") {
        score += 15;
      }
      // Bonus for matching start of word
      if (ti > 0 && text[ti - 1] === " ") {
        score += 10;
      }
      qi++;
    } else {
      consecutive = 0;
      // Penalty for gaps
      score -= 2;
    }
  }

  if (qi < query.length) return null;

  // Bonus for shorter strings (closer match)
  score += Math.max(0, 50 - text.length);
  // Prefix bonus
  if (text.startsWith(query)) score += 30;

  return { score, matches };
}

/**
 * Format text with highlighted matched characters.
 * Returns an array of segments: { text: string, highlight: boolean }
 */
export function highlightMatches(text: string, query: string, matches?: number[]): Array<{ text: string; highlight: boolean }> {
  if (!query && !matches) return [{ text, highlight: false }];

  const matchSet = matches ? new Set(matches) : null;
  if (!matchSet) {
    // Compute matches on the fly
    const result = computeFuzzyScore(text.toLowerCase(), query.toLowerCase());
    if (!result) return [{ text, highlight: false }];
    return buildHighlightSegments(text, new Set(result.matches));
  }

  return buildHighlightSegments(text, matchSet);
}

function buildHighlightSegments(text: string, matchSet: Set<number>): Array<{ text: string; highlight: boolean }> {
  const segments: Array<{ text: string; highlight: boolean }> = [];
  let current = "";
  let currentHighlight = false;

  for (let i = 0; i < text.length; i++) {
    const isMatch = matchSet.has(i);
    if (isMatch !== currentHighlight) {
      if (current) segments.push({ text: current, highlight: currentHighlight });
      current = "";
      currentHighlight = isMatch;
    }
    current += text[i]!;
  }
  if (current) segments.push({ text: current, highlight: currentHighlight });

  return segments;
}

// ─── Keyboard Navigation ────────────────────────────────────────────────────

export interface NavigationConfig {
  itemCount: number;
  initialCursor?: number;
  loop?: boolean;
  pageSize?: number;
}

export interface NavigationHandlers {
  cursor: number;
  handleKey: (input: string, key: Key) => "handled" | "not-handled";
  scrollTop: number;
  visibleCount: number;
  totalCount: number;
  isAtTop: boolean;
  isAtBottom: boolean;
  scrollUp: (n?: number) => void;
  scrollDown: (n?: number) => void;
  resetCursor: () => void;
  setCursor: (n: number) => void;
}

/**
 * Shared keyboard navigation hook with vim keys, page keys,
 * scroll indicators, and auto-scroll into view.
 */
export function useNavigation({
  itemCount,
  initialCursor = 0,
  loop = false,
  pageSize: configPageSize,
}: NavigationConfig): NavigationHandlers {
  const [cursor, setCursorState] = useState(initialCursor);
  const [scrollTop, setScrollTop] = useState(0);
  const prevCountRef = useRef(itemCount);

  // Guard against empty lists
  if (itemCount <= 0) {
    const noopHandle = (_input: string, _key: Key): "handled" | "not-handled" => "not-handled";
    return {
      cursor: 0,
      handleKey: noopHandle,
      scrollTop: 0,
      visibleCount: 0,
      totalCount: 0,
      isAtTop: true,
      isAtBottom: true,
      scrollUp: () => {},
      scrollDown: () => {},
      resetCursor: () => {},
      setCursor: () => {},
    };
  }

  // Reset cursor when item count changes dramatically
  useEffect(() => {
    const prev = prevCountRef.current;
    prevCountRef.current = itemCount;
    if (prev !== itemCount && cursor >= itemCount) {
      setCursorState(itemCount - 1);
    }
  }, [itemCount, cursor]);

  // Determine visible count from terminal or default
  const visibleCount = configPageSize ?? Math.min(itemCount, 10);

  const clampedCursor = Math.max(0, Math.min(cursor, itemCount - 1));

  const setCursor = useCallback((n: number) => {
    setCursorState(Math.max(0, Math.min(n, itemCount - 1)));
  }, [itemCount]);

  const resetCursor = useCallback(() => {
    setCursorState(0);
    setScrollTop(0);
  }, []);

  // Scroll to keep cursor visible
  useEffect(() => {
    if (clampedCursor < scrollTop) {
      setScrollTop(clampedCursor);
    } else if (clampedCursor >= scrollTop + visibleCount) {
      setScrollTop(clampedCursor - visibleCount + 1);
    }
  }, [clampedCursor, scrollTop, visibleCount]);

  const scrollUp = useCallback((n = 1) => {
    setScrollTop((s) => Math.max(0, s - n));
  }, []);

  const scrollDown = useCallback((n = 1) => {
    setScrollTop((s) => Math.min(itemCount - visibleCount, s + n));
  }, [itemCount, visibleCount]);

  const handleKey = useCallback((input: string, key: Key): "handled" | "not-handled" => {
    // Vim-style navigation
    if (input === "j" && !key.ctrl && !key.meta) {
      setCursorState((c) => {
        const next = c + 1;
        if (next >= itemCount) return loop ? 0 : c;
        return next;
      });
      return "handled";
    }
    if (input === "k" && !key.ctrl && !key.meta) {
      setCursorState((c) => {
        const prev = c - 1;
        if (prev < 0) return loop ? itemCount - 1 : 0;
        return prev;
      });
      return "handled";
    }

    // Arrow keys
    if (key.upArrow || (key.ctrl && input === "p")) {
      setCursorState((c) => {
        const prev = c - 1;
        if (prev < 0) return loop ? itemCount - 1 : 0;
        return prev;
      });
      return "handled";
    }
    if (key.downArrow || (key.ctrl && input === "n")) {
      setCursorState((c) => {
        const next = c + 1;
        if (next >= itemCount) return loop ? 0 : c;
        return next;
      });
      return "handled";
    }

    // Page keys
    if (key.pageDown || (key.ctrl && input === "d")) {
      setCursorState((c) => Math.min(itemCount - 1, c + visibleCount));
      return "handled";
    }
    if (key.pageUp || (key.ctrl && input === "u")) {
      setCursorState((c) => Math.max(0, c - visibleCount));
      return "handled";
    }

    // Home / End
    if (key.home || (key.ctrl && input === "a")) {
      setCursorState(0);
      return "handled";
    }
    if (key.end || (key.ctrl && input === "e")) {
      setCursorState(itemCount - 1);
      return "handled";
    }

    // g/G for top/bottom (vim)
    if (input === "g" && !key.ctrl && !key.meta && !key.shift) {
      setCursorState(0);
      return "handled";
    }
    if (input === "G" || (input === "g" && key.shift)) {
      setCursorState(itemCount - 1);
      return "handled";
    }

    // Tab and Shift+Tab for focus cycling (return to let parent handle)
    if (key.tab) return "not-handled";

    return "not-handled";
  }, [itemCount, loop, visibleCount]);

  return {
    cursor: clampedCursor,
    handleKey,
    scrollTop,
    visibleCount,
    totalCount: itemCount,
    isAtTop: clampedCursor === 0,
    isAtBottom: clampedCursor === itemCount - 1,
    scrollUp,
    scrollDown,
    resetCursor,
    setCursor,
  };
}

// ─── Viewport / Responsive Sizing ──────────────────────────────────────────

export interface ResponsiveSize {
  width: number;
  height: number;
  isSmall: boolean;
  isLarge: boolean;
  safeWidth: number;  // width minus padding
  maxVisibleItems: number;
  panelWidth: number;  // proportional width for panels
}

/**
 * Calculate responsive dimensions based on terminal size.
 */
export function useResponsiveSize(
  terminalWidth: number,
  terminalHeight: number,
  padding = 4
): ResponsiveSize {
  return useMemo(() => {
    const w = terminalWidth - padding;
    const h = terminalHeight - padding;
    return {
      width: Math.max(20, w),
      height: Math.max(10, h),
      isSmall: terminalWidth < 60,
      isLarge: terminalWidth >= 100,
      safeWidth: Math.max(16, w - 4),
      maxVisibleItems: Math.max(5, Math.min(20, h - 10)),
      panelWidth: terminalWidth >= 120 ? Math.floor(terminalWidth * 0.4) : Math.floor(terminalWidth * 0.35),
    };
  }, [terminalWidth, terminalHeight, padding]);
}

// ─── Scroll Indicators ──────────────────────────────────────────────────────

export interface ScrollInfo {
  hasMoreAbove: boolean;
  hasMoreBelow: boolean;
  aboveCount: number;
  belowCount: number;
  position: number;  // 0-1
}

/**
 * Calculate scroll indicators for a list.
 */
export function getScrollInfo(
  cursor: number,
  _visibleCount: number,
  totalCount: number
): ScrollInfo {
  const aboveCount = cursor;
  const belowCount = totalCount - cursor - 1;
  return {
    hasMoreAbove: aboveCount > 0,
    hasMoreBelow: belowCount > 0,
    aboveCount,
    belowCount,
    position: totalCount > 1 ? cursor / (totalCount - 1) : 0,
  };
}

// ─── Debounce ────────────────────────────────────────────────────────────────

export function useDebounce<T>(value: T, delayMs = 150): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}

// ─── Elapsed Timer ─────────────────────────────────────────────────────────

export function useElapsedTimer(running: boolean): number {
  const startRef = useRef(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!running) {
      setElapsed(0);
      return;
    }
    startRef.current = Date.now();
    setElapsed(0);
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  return elapsed;
}

// ─── Format elapsed time ─────────────────────────────────────────────────────

export function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return `${m}:${String(s).padStart(2, "0")}`;
  return `${s}s`;
}
