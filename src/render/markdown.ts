/**
 * 9 Router CLI — Markdown Renderer
 *
 * Parses markdown and renders it to ANSI-colored terminal output.
 */

import { marked, type Token, type TokensList, type Tokens } from "marked";
import chalk from "chalk";
import type { Theme } from "./themes";
import { getTheme } from "./themes";
import { visibleLength, truncate } from "./ansi";
import { getTerminalWidth } from "../utils/terminal";
import { SyntaxHighlighter, getSyntaxHighlighter } from "./syntax";

export class MarkdownRenderer {
  private theme: Theme;
  private highlighter: SyntaxHighlighter;

  constructor(themeName = "dark", highlighter?: SyntaxHighlighter) {
    this.theme = getTheme(themeName);
    this.highlighter = highlighter ?? getSyntaxHighlighter();
    this.configureMarked();
  }

  setTheme(themeName: string): void {
    this.theme = getTheme(themeName);
  }

  private configureMarked(): void {
    marked.setOptions({
      breaks: false,
      gfm: true,
    });
  }

  /** Render markdown string to ANSI colored output */
  render(markdown: string): string {
    const tokens = marked.lexer(markdown);
    return this.renderTokens(tokens);
  }

  /** Render a stream of partial markdown (for streaming) */
  renderStreamChunk(buffer: string): string {
    // For streaming, we render inline content without block structure
    return this.renderInlineMarkdownSimple(buffer);
  }

  private renderInlineMarkdownSimple(text: string): string {
    return text;
  }

  private renderTokens(tokens: TokensList, depth = 0): string {
    const lines: string[] = [];
    const width = getTerminalWidth() - 4;

    for (const token of tokens) {
      switch (token.type) {
        case "paragraph":
          lines.push(this.renderInline((token as Tokens.Paragraph).tokens));
          lines.push("");
          break;

        case "heading":
          lines.push(this.renderHeading(token as Tokens.Heading));
          lines.push("");
          break;

        case "code":
          lines.push(this.renderCode(token as Tokens.Code));
          lines.push("");
          break;

        case "list":
          lines.push(this.renderList(token as Tokens.List, depth));
          lines.push("");
          break;

        case "blockquote":
          lines.push(this.renderBlockquote(token as Tokens.Blockquote));
          lines.push("");
          break;

        case "table":
          lines.push(this.renderTable(token as Tokens.Table));
          lines.push("");
          break;

        case "hr":
          lines.push(chalk.dim("─".repeat(Math.min(width, 40))));
          lines.push("");
          break;

        case "space":
          lines.push("");
          break;

        case "html":
          // Strip HTML tags for terminal output
          lines.push((token as Tokens.HTML).text.replace(/<[^>]*>/g, ""));
          lines.push("");
          break;

        default:
          if ("raw" in token) {
            lines.push((token as Tokens.Generic).raw);
          }
          break;
      }
    }

    return lines.join("\n");
  }

  private renderHeading(token: Tokens.Heading): string {
    const text = this.renderInline(token.tokens);
    const color = this.theme.heading(token.depth);
    const prefix = "#".repeat(token.depth);
    return `${chalk.dim(prefix)} ${color(text)}`;
  }

  private renderCode(token: Tokens.Code): string {
    const lang = token.lang ?? "";
    const result: string[] = [];
    const isDark = this.theme.type === "dark";

    // Language header with resolved name
    const resolvedLang = this.highlighter.resolveLanguage(lang);
    if (lang) {
      result.push(chalk.dim(` ─── ${resolvedLang} ───`));
    }

    // Syntax-highlight the code using sync fallback highlighter
    try {
      const highlighted = this.highlighter.highlightSync(token.text, {
        language: lang,
        themeName: isDark ? "dark" : "light",
      });

      // Indent each line for proper display
      const indented = highlighted.content
        .split("\n")
        .map((line) => ` ${line}`)
        .join("\n");

      result.push(indented);

      // Fire-and-forget: warm the Shiki cache for this code block
      // so that async renders use full Shiki quality
      this.highlighter.highlight(token.text, {
        language: lang,
        themeName: isDark ? "dark" : "light",
      }).catch(() => {});
    } catch {
      // Final fallback: plain rendering
      const lines = token.text.split("\n");
      for (const line of lines) {
        const truncated = truncate(line, getTerminalWidth() - 6);
        result.push(` ${this.theme.code(truncated)}`);
      }
    }

    return result.join("\n");
  }

  private renderList(token: Tokens.List, depth: number): string {
    const lines: string[] = [];
    const indent = "  ".repeat(depth);
    const ordered = token.ordered;

    for (let i = 0; i < token.items.length; i++) {
      const item = token.items[i] as Tokens.ListItem;
      const prefix = ordered ? `${indent}${i + 1}. ` : `${indent}${this.theme.list("•")} `;
      const text = this.renderInline(item.tokens);

      lines.push(`${prefix}${text}`);

      // Render nested list if present
      if (item.tokens) {
        const nested = item.tokens.filter((t: Token) => t.type === "list");
        for (const n of nested) {
          const rendered = this.renderTokens([n] as unknown as TokensList, depth + 1);
          if (rendered) lines.push(rendered);
        }
      }
    }

    return lines.join("\n");
  }

  private renderBlockquote(token: Tokens.Blockquote): string {
    const content = this.renderTokens(token.tokens as unknown as TokensList);
    const lines = content.split("\n").map((line) => {
      if (line.trim()) {
        return `${chalk.dim("│")} ${line}`;
      }
      return "";
    });
    return lines.join("\n");
  }

  private renderTable(token: Tokens.Table): string {
    const width = getTerminalWidth() - 4;
    const cols = token.header.length;

    if (cols === 0) return "";

    // Calculate column widths
    const colWidths: number[] = [];
    const allRows = [token.header, ...token.rows];

    for (let col = 0; col < cols; col++) {
      let maxWidth = 0;
      for (const row of allRows) {
        const cellText = this.renderInline(row[col]?.tokens ?? []);
        const len = visibleLength(cellText);
        if (len > maxWidth) maxWidth = len;
      }
      colWidths.push(Math.min(maxWidth + 2, Math.floor(width / cols)));
    }

    // Adjust to fit terminal width
    const totalWidth = colWidths.reduce((sum, w) => sum + w + 3, 1);
    if (totalWidth > width) {
      // Scale down
      const ratio = (width - 1 - cols * 3) / (totalWidth - 1 - cols * 3);
      for (let i = 0; i < colWidths.length; i++) {
        colWidths[i] = Math.max(3, Math.floor(colWidths[i]! * ratio));
      }
    }

    const result: string[] = [];

    // Header
    const headerLine = this.renderTableRow(token.header, colWidths);
    result.push(headerLine);

    // Separator
    const sep = colWidths.map((w) => chalk.dim("─".repeat(w - 1))).join(` ${chalk.dim("┼")} `);
    result.push(` ${chalk.dim("┌")}${sep}${chalk.dim("┐")}`);

    // Rows
    for (const row of token.rows) {
      result.push(this.renderTableRow(row, colWidths));
    }

    // Bottom border
    const bottomSep = colWidths.map((w) => chalk.dim("─".repeat(w - 1))).join(` ${chalk.dim("┴")} `);
    result.push(` ${chalk.dim("└")}${bottomSep}${chalk.dim("┘")}`);

    return result.join("\n");
  }

  private renderTableRow(cells: Tokens.TableCell[], colWidths: number[]): string {
    const rendered = cells.map((cell, i) => {
      const text = truncate(this.renderInline(cell.tokens), colWidths[i] ?? 3);
      const padding = " ".repeat(Math.max((colWidths[i] ?? 3) - visibleLength(text) - 1, 0));
      const align = cell.align === "center" ? "center" : cell.align === "right" ? "right" : "left";

      if (align === "right") return `${padding}${text} `;
      if (align === "center") {
        const leftPad = Math.floor(padding.length / 2);
        return `${" ".repeat(leftPad)}${text}${" ".repeat(padding.length - leftPad)} `;
      }
      return ` ${text}${padding}`;
    }).join(chalk.dim(" │ "));

    return ` ${chalk.dim("│")}${rendered}${chalk.dim("│")}`;
  }

  /** Render inline tokens */
  private renderInline(tokens: Token[] | TokensList): string {
    let result = "";

    for (const token of tokens) {
      switch (token.type) {
        case "text":
          result += (token as Tokens.Text).text;
          break;

        case "strong":
          result += chalk.bold(this.renderInline((token as Tokens.Strong).tokens));
          break;

        case "em":
          result += chalk.italic(this.renderInline((token as Tokens.Em).tokens));
          break;

        case "codespan":
          result += this.theme.code((token as Tokens.Codespan).text);
          break;

        case "link": {
          const link = token as Tokens.Link;
          const text = this.renderInline(link.tokens);
          result += `${chalk.underline(text)} ${chalk.dim(`(${link.href})`)}`;
          break;
        }

        case "image": {
          const img = token as Tokens.Image;
          result += chalk.dim(`[image: ${img.text}]`);
          break;
        }

        case "del":
          result += chalk.strikethrough(this.renderInline((token as Tokens.Del).tokens));
          break;

        case "br":
          result += "\n";
          break;

        case "html":
          result += (token as Tokens.HTML).text.replace(/<[^>]*>/g, "");
          break;

        case "escape":
          result += (token as Tokens.Escape).text;
          break;

        default:
          if ("raw" in token) {
            result += (token as Tokens.Generic).raw;
          }
          break;
      }
    }

    return result;
  }
}

/** Simple inline markdown rendering for streaming */
export function renderInlineMarkdown(text: string): string {
  // Bold: **text** or __text__
  text = text.replace(/(\*\*|__)(.*?)\1/g, (_, __, content) => chalk.bold(content));

  // Italic: *text* or _text_
  text = text.replace(/(\*|_)(.*?)\1/g, (_, __, content) => chalk.italic(content));

  // Inline code: `text`
  text = text.replace(/`([^`]+)`/g, (_, content) => chalk.yellow(content));

  // Strikethrough: ~~text~~
  text = text.replace(/~~(.*?)~~/g, (_, content) => chalk.strikethrough(content));

  return text;
}
