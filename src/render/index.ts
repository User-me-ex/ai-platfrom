/**
 * 9 Router CLI — Renderer Dispatcher
 *
 * Coordinates markdown rendering, streaming, syntax highlighting, and theming.
 */

import type { Renderer, RenderState, RenderedBlock } from "../core/types";
import { MarkdownRenderer, renderInlineMarkdown } from "./markdown";
import { SyntaxHighlighter, getSyntaxHighlighter } from "./syntax";
import chalk from "chalk";
import { getTerminalWidth } from "../utils/terminal";

export class CliRenderer implements Renderer {
  private markdownRenderer: MarkdownRenderer;
  private highlighter: SyntaxHighlighter;

  constructor(themeName = "dark", highlighter?: SyntaxHighlighter) {
    this.highlighter = highlighter ?? getSyntaxHighlighter();
    this.markdownRenderer = new MarkdownRenderer(themeName, this.highlighter);
  }

  setTheme(themeName: string): void {
    this.markdownRenderer.setTheme(themeName);
  }

  /** Render full markdown content */
  render(content: string): string {
    return this.markdownRenderer.render(content);
  }

  /** Render a single streaming token incrementally */
  renderStream(token: string, state: RenderState): string {
    state.buffer += token;
    state.activeBlock += token;

    // Detect block boundaries for streaming
    if (this.isBlockComplete(state.activeBlock)) {
      const blockType = this.detectBlockType(state.activeBlock);
      const rendered = this.renderBlock(state.activeBlock, blockType);
      state.blocks.push({
        type: blockType,
        content: rendered,
        finalized: true,
      });
      state.activeBlock = "";
      return rendered;
    }

    // Render the active (incomplete) block
    return renderInlineMarkdown(token);
  }

  /** Render the assistant header */
  renderAssistantHeader(modelId: string): string {
    const width = getTerminalWidth();
    return chalk.dim(`┌─ ${chalk.cyan(modelId)} ${"─".repeat(Math.max(width - modelId.length - 8, 0))}`);
  }

  /** Render the user header */
  renderUserHeader(): string {
    return chalk.green.bold("You:");
  }

  /** Render the system prompt header */
  renderSystemHeader(): string {
    return chalk.magenta.bold("System:");
  }

  /** Render a separator line */
  renderSeparator(): string {
    const width = getTerminalWidth();
    return chalk.dim("─".repeat(width));
  }

  /** Render a status message */
  renderStatus(message: string, type: "info" | "success" | "warning" | "error" = "info"): string {
    const colors = {
      info: chalk.blue,
      success: chalk.green,
      warning: chalk.yellow,
      error: chalk.red,
    };
    return colors[type](`▸ ${message}`);
  }

  /** Render thinking indicator */
  renderThinking(): string {
    return chalk.dim.italic("Thinking...");
  }

  /** Render token usage summary */
  renderUsage(input: number, output: number, modelId: string): string {
    return chalk.dim(
      `[Tokens: ${chalk.white(String(input))} in / ${chalk.white(String(output))} out | Model: ${modelId}]`
    );
  }

  /** Render a boxed info panel */
  renderInfoPanel(lines: string[]): string {
    const width = getTerminalWidth() - 6;
    const border = chalk.dim;
    const result: string[] = [];

    result.push(`${border("┌")}${border("─".repeat(width))}${border("┐")}`);
    for (const line of lines) {
      const padding = " ".repeat(Math.max(width - line.length, 0));
      result.push(`${border("│")} ${line}${padding} ${border("│")}`);
    }
    result.push(`${border("└")}${border("─".repeat(width))}${border("┘")}`);

    return result.join("\n");
  }

  /** Render a newline */
  newline(): string {
    return "";
  }

  private isBlockComplete(block: string): boolean {
    // Check for complete markdown block patterns
    return (
      block.endsWith("\n\n") ||
      block.match(/```[\s\S]*```\s*$/) !== null
    );
  }

  private detectBlockType(block: string): RenderedBlock["type"] {
    if (block.startsWith("#")) return "heading";
    if (block.startsWith("```")) return "code";
    if (block.startsWith("> ")) return "blockquote";
    if (block.startsWith("- ") || block.startsWith("* ") || block.match(/^\d+\. /)) return "list";
    if (block.startsWith("|")) return "table";
    if (block.startsWith("---") || block.startsWith("***") || block.startsWith("___")) return "thematic_break";
    return "paragraph";
  }

  private renderBlock(block: string, type: RenderedBlock["type"]): string {
    switch (type) {
      case "code":
        return chalk.yellow(block);
      case "paragraph":
        return renderInlineMarkdown(block);
      default:
        return block;
    }
  }

  /** Initialize render state */
  createRenderState(): RenderState {
    return {
      buffer: "",
      blocks: [],
      activeBlock: "",
    };
  }
}
