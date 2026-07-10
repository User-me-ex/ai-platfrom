/**
 * 9 Router CLI — Syntax Highlighter
 *
 * Production-grade syntax highlighting for terminal output using Shiki.
 * Supports:
 *   - Full code block highlighting via Shiki (async)
 *   - Fast fallback highlighting via regex (sync, always available)
 *   - Streaming partial code blocks
 *   - Theme-aware highlighting (dark/light themes)
 *   - Language detection and aliases
 *   - Configurable line numbers and word wrapping
 *   - Lazy initialization for fast startup
 */

import { createHighlighter, type Highlighter } from "shiki";
import chalk from "chalk";
import type { ChalkInstance } from "chalk";
import { getTerminalWidth } from "../utils/terminal";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Local ThemedToken interface matching Shiki's internal type */
export interface ThemedToken {
  content: string;
  color?: string;
  fontStyle?: number;
  offset?: number;
}

export interface HighlightOptions {
  language?: string;
  themeName?: "dark" | "light";
  showLineNumbers?: boolean;
  maxWidth?: number;
  wordWrap?: boolean;
}

export interface HighlightResult {
  content: string;
  lines: string[];
  language: string;
  detected: boolean;
}

// ─── Language Aliases ─────────────────────────────────────────────────────────

const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  javascript: "javascript",
  ts: "typescript",
  typescript: "typescript",
  py: "python",
  python: "python",
  rb: "ruby",
  ruby: "ruby",
  rs: "rust",
  rust: "rust",
  go: "go",
  golang: "go",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  shell: "shellscript",
  tsx: "tsx",
  jsx: "jsx",
  vue: "vue",
  svelte: "svelte",
  html: "html",
  css: "css",
  scss: "scss",
  less: "less",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  markdown: "markdown",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  dockerfile: "dockerfile",
  docker: "dockerfile",
  "c++": "cpp",
  cpp: "cpp",
  c: "c",
  csharp: "csharp",
  "c#": "csharp",
  java: "java",
  kotlin: "kotlin",
  kt: "kotlin",
  swift: "swift",
  scala: "scala",
  php: "php",
  perl: "perl",
  lua: "lua",
  r: "r",
  dart: "dart",
  toml: "toml",
  xml: "xml",
  svg: "xml",
  diff: "diff",
  patch: "diff",
};

// ─── Fallback Token Colors ─────────────────────────────────────────────────────

const FALLBACK_COLORS_DARK: Record<string, string> = {
  comment: "#676E95",
  string: "#C3E88D",
  number: "#F78C6C",
  keyword: "#C792EA",
  function: "#82AAFF",
  variable: "#EEFFFF",
  constant: "#FFCB6B",
  type: "#FFCB6B",
  property: "#82AAFF",
  operator: "#89DDFF",
  punctuation: "#89DDFF",
  tag: "#F07178",
  attribute: "#C792EA",
  delimiter: "#89DDFF",
  boolean: "#FF5370",
  regexp: "#89DDFF",
  parameter: "#EEFFFF",
};

const FALLBACK_COLORS_LIGHT: Record<string, string> = {
  comment: "#969896",
  string: "#D50000",
  number: "#005CC5",
  keyword: "#A626A4",
  function: "#6F42C1",
  variable: "#E36209",
  constant: "#005CC5",
  type: "#005CC5",
  property: "#6F42C1",
  operator: "#D01884",
  punctuation: "#D01884",
  tag: "#22863A",
  attribute: "#6F42C1",
  delimiter: "#D01884",
  boolean: "#D50000",
  regexp: "#D01884",
  parameter: "#E36209",
};

// ─── Chalk cache ─────────────────────────────────────────────────────────────

const chalkCache = new Map<string, ChalkInstance>();

function getChalkForColor(hex: string, fontStyle?: number): ChalkInstance {
  const key = `${hex}:${fontStyle ?? 0}`;
  let cached = chalkCache.get(key);
  if (cached) return cached;

  let instance: ChalkInstance = chalk.hex(hex);
  if (fontStyle !== undefined) {
    if (fontStyle & 1) instance = instance.bold;
    if (fontStyle & 2) instance = instance.italic;
    if (fontStyle & 4) instance = instance.underline;
  }
  chalkCache.set(key, instance);
  return instance;
}

// ─── SyntaxHighlighter ───────────────────────────────────────────────────────

export class SyntaxHighlighter {
  private highlighter: Highlighter | null = null;
  private initPromise: Promise<void> | null = null;
  private loadedLanguages = new Set<string>();

  /** Get the Shiki highlighter, initializing lazily if needed */
  private async getHighlighter(): Promise<Highlighter> {
    if (this.highlighter) return this.highlighter;
    if (this.initPromise) await this.initPromise;

    this.initPromise = this.initialize();
    await this.initPromise;
    return this.highlighter!;
  }

  private async initialize(): Promise<void> {
    this.highlighter = await createHighlighter({
      themes: ["material-theme-palenight", "github-light"],
      langs: [
        "typescript",
        "javascript",
        "tsx",
        "jsx",
        "python",
        "rust",
        "go",
        "bash",
        "shellscript",
        "json",
        "yaml",
        "markdown",
        "html",
        "css",
        "sql",
        "cpp",
        "c",
        "java",
        "ruby",
        "php",
        "diff",
      ],
    });
    for (const lang of this.highlighter.getLoadedLanguages()) {
      this.loadedLanguages.add(lang as string);
    }
  }

  /** Load a language on demand if not already loaded */
  async ensureLanguage(language: string): Promise<boolean> {
    const resolved = this.resolveLanguage(language);
    if (this.loadedLanguages.has(resolved)) return true;

    try {
      const hl = await this.getHighlighter();
      await hl.loadLanguage(resolved as any);
      this.loadedLanguages.add(resolved);
      return true;
    } catch {
      return false;
    }
  }

  /** Resolve a language alias to its canonical Shiki name */
  resolveLanguage(language: string): string {
    const normalized = language.trim().toLowerCase();
    return LANGUAGE_ALIASES[normalized] ?? normalized;
  }

  /** Detect language from code content (simple heuristic) */
  detectLanguage(code: string): string {
    const lines = code.split("\n").filter((l) => l.trim());
    const firstLine = lines[0] ?? "";

    // Shebang detection
    if (firstLine.startsWith("#!/usr/bin/env node") || firstLine.startsWith("#!/usr/bin/node")) return "javascript";
    if (firstLine.startsWith("#!/bin/bash") || firstLine.startsWith("#!/bin/sh")) return "shellscript";
    if (firstLine.startsWith("#!/usr/bin/python") || firstLine.startsWith("#!/usr/bin/env python")) return "python";

    // Syntax pattern detection
    const joined = code.slice(0, 2000);

    if (/\b(import\s+.*\s+from\s+['"]|export\s+(default|const|function|class|interface|type)\b|interface\s+\w+\s*\{|type\s+\w+\s*=)/.test(joined)) {
      return /:\s*(string|number|boolean|any|void|never|unknown)\b|interface\s|type\s+\w+\s*=/.test(joined) ? "typescript" : "javascript";
    }
    if (/\b(def\s+\w+\s*\(|import\s+\w+|from\s+\w+\s+import|class\s+\w+:)/.test(joined)) return "python";
    if (/\b(fn\s+\w+|let\s+mut\s+\w+|impl\s+\w+|pub\s+(fn|struct|enum|trait)|->\s*\w+)/.test(joined)) return "rust";
    if (/\b(package\s+\w+|func\s+\w+|import\s*\(|defer\s+|go\s+\w+\(|:=)/.test(joined)) return "go";
    if (/\b(SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|CREATE\s+TABLE)\b/i.test(joined)) return "sql";
    if (/<\/?[a-z][\s>]/.test(joined) && /<!DOCTYPE|<html|<div|<span|<a\s/.test(joined)) return "html";
    if (/[.#]\w+\s*\{|@media|@import/.test(joined)) return "css";
    if (/^\s*[\{\[].*[\}\]]\s*$/.test(code.trim())) { try { JSON.parse(code.trim()); return "json"; } catch {} }
    if (/^[a-zA-Z_-]+:\s|^-\s+[a-zA-Z_-]+:\s/.test(code.trim())) return "yaml";
    if (/^(FROM|RUN|CMD|ENTRYPOINT|COPY|ADD|WORKDIR|ENV|EXPOSE)\s/i.test(firstLine.trim())) return "dockerfile";

    return "text";
  }

  /**
   * Synchronous fallback highlighting — always available, fast, uses regex.
   * Ideal for sync rendering pipelines where Shiki can't be awaited.
   */
  highlightSync(code: string, options: HighlightOptions = {}): HighlightResult {
    const language = options.language && options.language !== ""
      ? this.resolveLanguage(options.language)
      : this.detectLanguage(code);

    const isDark = options.themeName !== "light";
    const colors = isDark ? FALLBACK_COLORS_DARK : FALLBACK_COLORS_LIGHT;
    const maxWidth = options.maxWidth ?? getTerminalWidth() - 6;
    const showLineNumbers = options.showLineNumbers ?? false;

    const rawLines = code.split("\n");
    const lines: string[] = [];
    const lineNumWidth = showLineNumbers ? String(rawLines.length).length + 2 : 0;

    for (let i = 0; i < rawLines.length; i++) {
      let line = rawLines[i] ?? "";
      let colored = this.simpleColorize(line, colors);

      let prefix = "";
      if (showLineNumbers) {
        const num = String(i + 1).padStart(lineNumWidth - 2);
        prefix = chalk.dim(`${num} `);
      }

      if (maxWidth > 0) {
        const strippedLen = stripAnsiLength(colored);
        if (strippedLen > maxWidth - lineNumWidth) {
          const wrapped = this.wordWrapLine(colored, maxWidth - lineNumWidth);
          for (const wLine of wrapped) {
            lines.push(`${prefix}${wLine}`);
            if (prefix) prefix = " ".repeat(lineNumWidth);
          }
          continue;
        }
      }

      lines.push(`${prefix}${colored}`);
    }

    return { content: lines.join("\n"), lines, language, detected: true };
  }

  /**
   * Async full-quality highlighting using Shiki.
   * Falls back to highlightSync if Shiki is unavailable.
   */
  async highlight(code: string, options: HighlightOptions = {}): Promise<HighlightResult> {
    const language = options.language && options.language !== ""
      ? this.resolveLanguage(options.language)
      : this.detectLanguage(code);

    const isDark = options.themeName !== "dark";
    const shikiTheme = isDark ? "material-theme-palenight" : "github-light";
    const maxWidth = options.maxWidth ?? getTerminalWidth() - 6;
    const showLineNumbers = options.showLineNumbers ?? false;

    try {
      const hl = await this.getHighlighter();

      if (language !== "text") {
        await this.ensureLanguage(language).catch(() => {});
      }

      if (language !== "text" && this.loadedLanguages.has(language)) {
        const { tokens } = hl.codeToTokens(code, {
          lang: language as any,
          theme: shikiTheme,
        });

        return this.formatTokensToLines(tokens, { maxWidth, showLineNumbers });
      }
    } catch {
      // Fall through to sync fallback
    }

    return this.highlightSync(code, options);
  }

  /**
   * Highlight a partial/streaming code block.
   */
  async highlightStream(
    accumulated: string,
    language: string,
    options: HighlightOptions = {}
  ): Promise<HighlightResult> {
    // For very short partial content, use simple highlighting
    if (accumulated.length < 20) {
      return this.highlightSync(accumulated, {
        ...options,
        language: language || undefined,
      });
    }

    try {
      return await this.highlight(accumulated, {
        ...options,
        language: language || undefined,
      });
    } catch {
      return this.highlightSync(accumulated, {
        ...options,
        language: language || undefined,
      });
    }
  }

  /** Format Shiki tokens into ANSI-colored terminal lines */
  private formatTokensToLines(
    tokenLines: ThemedToken[][],
    options: { maxWidth: number; showLineNumbers: boolean }
  ): HighlightResult {
    const { maxWidth, showLineNumbers } = options;
    const lines: string[] = [];
    const lineNumWidth = showLineNumbers ? String(tokenLines.length).length + 2 : 0;

    for (let lineIdx = 0; lineIdx < tokenLines.length; lineIdx++) {
      const tokenLine = tokenLines[lineIdx]!;
      let lineContent = "";

      for (const token of tokenLine) {
        if (token.content === "") continue;
        const color = token.color ?? "#E0E0E0";
        const styled = getChalkForColor(color, token.fontStyle)(token.content);
        lineContent += styled;
      }

      let prefix = "";
      if (showLineNumbers) {
        const num = String(lineIdx + 1).padStart(lineNumWidth - 2);
        prefix = chalk.dim(`${num} `);
      }

      if (maxWidth > 0) {
        const strippedLen = stripAnsiLength(lineContent);
        if (strippedLen > maxWidth - lineNumWidth) {
          const wrapped = this.wordWrapLine(lineContent, maxWidth - lineNumWidth);
          for (const wLine of wrapped) {
            lines.push(`${prefix}${wLine}`);
            if (prefix) prefix = " ".repeat(lineNumWidth);
          }
          continue;
        }
      }

      lines.push(`${prefix}${lineContent}`);
    }

    return { content: lines.join("\n"), lines, language: "", detected: false };
  }

  /** Simple regex-based colorization for fallback mode */
  private simpleColorize(line: string, colors: Record<string, string>): string {
    let result = "";
    let remaining = line;

    while (remaining.length > 0) {
      const dqMatch = remaining.match(/^"([^"\\]*(\\.[^"\\]*)*)"/);
      if (dqMatch) { result += chalk.hex(colors.string ?? "#C3E88D")(dqMatch[0]); remaining = remaining.slice(dqMatch[0].length); continue; }

      const sqMatch = remaining.match(/^'([^'\\]*(\\.[^'\\]*)*)'/);
      if (sqMatch) { result += chalk.hex(colors.string ?? "#C3E88D")(sqMatch[0]); remaining = remaining.slice(sqMatch[0].length); continue; }

      const tplMatch = remaining.match(/^`([^`\\]*(\\.[^`\\]*)*)`/);
      if (tplMatch) { result += chalk.hex(colors.string ?? "#C3E88D")(tplMatch[0]); remaining = remaining.slice(tplMatch[0].length); continue; }

      const commentMatch = remaining.match(/^(\/\/.*$|#.*$)/);
      if (commentMatch) { result += chalk.hex(colors.comment ?? "#676E95").italic(commentMatch[0]); remaining = remaining.slice(commentMatch[0].length); continue; }

      const numMatch = remaining.match(/^\b(\d+(\.\d+)?)\b/);
      if (numMatch) { result += chalk.hex(colors.number ?? "#F78C6C")(numMatch[0]); remaining = remaining.slice(numMatch[0].length); continue; }

      const keywordMatch = remaining.match(/^\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|new|throw|try|catch|def|fn|pub|mut|impl|struct|enum|trait|package|func|defer|go|select|match|where|as|in|of|typeof|instanceof)\b/);
      if (keywordMatch) { result += chalk.hex(colors.keyword ?? "#C792EA")(keywordMatch[0]); remaining = remaining.slice(keywordMatch[0].length); continue; }

      result += remaining[0] ?? "";
      remaining = remaining.slice(1);
    }

    return result;
  }

  /** Word-wrap a line of ANSI-colored text to a maximum width */
  private wordWrapLine(line: string, maxWidth: number): string[] {
    const wrapped: string[] = [];
    const words = line.split(/(?<=\s)/);
    let currentLine = "";
    let currentLen = 0;

    for (const word of words) {
      const wordLen = stripAnsiLength(word);
      if (currentLen + wordLen > maxWidth && currentLen > 0) {
        wrapped.push(currentLine);
        currentLine = word;
        currentLen = wordLen;
      } else {
        currentLine += word;
        currentLen += wordLen;
      }
    }

    if (currentLine) wrapped.push(currentLine);
    return wrapped.length > 0 ? wrapped : [line];
  }

  /** Release the highlighter instance */
  async dispose(): Promise<void> {
    if (this.highlighter) {
      await this.highlighter.dispose();
      this.highlighter = null;
      this.initPromise = null;
      this.loadedLanguages.clear();
    }
  }
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

function stripAnsiLength(str: string): number {
  return str.replace(/\x1b\[[0-9;]*m/g, "").length;
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let globalHighlighter: SyntaxHighlighter | null = null;

/** Get the global syntax highlighter instance */
export function getSyntaxHighlighter(): SyntaxHighlighter {
  if (!globalHighlighter) {
    globalHighlighter = new SyntaxHighlighter();
  }
  return globalHighlighter;
}

/** Format a Shiki language list for display */
export function formatLanguageList(): string {
  return Object.keys(LANGUAGE_ALIASES)
    .filter((k, i, arr) => arr.indexOf(k) === i)
    .sort()
    .join(", ");
}
