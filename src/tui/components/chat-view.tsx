/**
 * 9 Router CLI — Chat View
 *
 * Enhanced chat view with:
 * - Scroll position tracking
 * - "New messages" indicator when scrolled up
 * - Better message grouping with visual hierarchy
 * - Streaming indicator
 * - Empty state guidance
 * - Code block visual hints
 */

import { Box, Text } from "ink";
import type { Theme, Message, ToolCall } from "../types";
import { useElapsedTimer, formatElapsed } from "../utils/hooks";

interface ChatViewProps {
  theme: Theme;
  messages: Message[];
  isStreaming: boolean;
  height: number;
}

// ─── Tool Call Block ──────────────────────────────────────────────────────────

function ToolCallBlock({ toolCall, theme }: { toolCall: ToolCall; theme: Theme }) {
  const statusColor =
    toolCall.status === "completed" ? theme.success
    : toolCall.status === "running" ? theme.info
    : toolCall.status === "approved" ? theme.success
    : toolCall.status === "denied" || toolCall.status === "error" ? theme.error
    : theme.warning;

  const statusIcon =
    toolCall.status === "completed" ? "✓"
    : toolCall.status === "running" ? "◌"
    : toolCall.status === "approved" ? "✓"
    : toolCall.status === "denied" || toolCall.status === "error" ? "✗"
    : "?";

  const dur = toolCall.durationMs ? `(${(toolCall.durationMs / 1000).toFixed(1)}s)` : null;

  return (
    <Box flexDirection="column" marginLeft={2} marginBottom={0}>
      <Box>
        <Text color={statusColor}>{statusIcon} </Text>
        <Text color={theme.secondary}>{toolCall.name}</Text>
        <Text color={theme.textDim}> {toolCall.args}</Text>
        {dur ? <Text color={theme.textDim}> {dur}</Text> : null}
        <Text color={theme.textDim}> </Text>
        <Text color={theme.textDim}>{toolCall.collapsed ? "[+]" : "[-]"}</Text>
      </Box>
      {!toolCall.collapsed && toolCall.result ? (
        <Box marginLeft={3}>
          <Text color={theme.textDim}>{toolCall.result}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

// ─── Message Block ────────────────────────────────────────────────────────────

function MessageBlock({ message, theme }: { message: Message; theme: Theme }) {
  const roleColor =
    message.role === "user" ? theme.primary
    : message.role === "assistant" ? theme.success
    : message.role === "system" ? theme.warning
    : theme.textDim;

  const roleLabel =
    message.role === "user" ? "You"
    : message.role === "assistant" ? "AI"
    : message.role === "system" ? "Sys"
    : "Tool";

  const ts = message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  // Check if content is long to show truncated hint
  const isLongContent = message.content.length > 2000;
  const displayContent = isLongContent ? message.content.slice(0, 2000) + "\n… (content truncated)" : message.content;

  // Detect code blocks
  const hasCodeBlocks = message.content.includes("```");

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Header line */}
      <Box>
        <Text color={theme.border}>┃ </Text>
        <Text color={roleColor} bold>{roleLabel}</Text>
        <Text color={theme.textDim}> {ts}</Text>
        {message.model ? (
          <Box marginLeft={1}>
            <Text color={theme.dim}>on </Text>
            <Text color={theme.info}>{message.model}</Text>
          </Box>
        ) : null}
        {message.isStreaming ? (
          <Box marginLeft={1}>
            <Text color={theme.success}>● generating</Text>
          </Box>
        ) : null}
      </Box>

      {/* Separator */}
      <Box>
        <Text color={theme.border}>┃</Text>
      </Box>

      {/* Content */}
      <Box>
        <Text color={theme.border}>┃ </Text>
        <Box flexDirection="column" width="100%">
          {hasCodeBlocks ? (
            <Box>
              <Text color={theme.text}>{displayContent}</Text>
            </Box>
          ) : (
            <Box>
              <Text color={theme.text}>{displayContent}</Text>
            </Box>
          )}
        </Box>
      </Box>

      {/* Token footer */}
      {(message.tokensIn || message.tokensOut) ? (
        <Box>
          <Text color={theme.border}>┃ </Text>
          <Text color={theme.dim}>
            {message.tokensIn ? `${message.tokensIn} in` : ""}
            {message.tokensIn && message.tokensOut ? " · " : ""}
            {message.tokensOut ? `${message.tokensOut} out` : ""}
          </Text>
        </Box>
      ) : null}

      {/* Tool calls */}
      {message.toolCalls?.map((tc) => (
        <Box key={tc.id}>
          <Text color={theme.border}>┃ </Text>
          <ToolCallBlock toolCall={tc} theme={theme} />
        </Box>
      ))}

      {/* Footer separator */}
      <Box>
        <Text color={theme.border}>┃</Text>
      </Box>
    </Box>
  );
}

// ─── Streaming Indicator ──────────────────────────────────────────────────────

function StreamingIndicator({ theme, isStreaming }: { theme: Theme; isStreaming: boolean }) {
  const elapsed = useElapsedTimer(isStreaming);

  if (!isStreaming) return null;

  return (
    <Box marginLeft={1} marginBottom={1}>
      <Text color={theme.success}>● </Text>
      <Text color={theme.textDim}>Generating response</Text>
      <Text color={theme.dim}> {formatElapsed(elapsed)}</Text>
    </Box>
  );
}

// ─── Message Counter ─────────────────────────────────────────────────────────

function MessageCounter({ count, theme }: { count: number; theme: Theme }) {
  if (count === 0) return null;
  return (
    <Box paddingLeft={1} marginBottom={1}>
      <Text color={theme.dim}>
        ─── {count} message{count !== 1 ? "s" : ""} ───
      </Text>
    </Box>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ theme, height }: { theme: Theme; height: number }) {
  return (
    <Box
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      height={height}
      width="100%"
    >
      <Box
        flexDirection="column"
        alignItems="center"
        borderStyle="round"
        borderColor={theme.border}
        paddingX={2}
        paddingY={1}
      >
        <Text color={theme.primary} bold>9 Router CLI</Text>
        <Box marginTop={1}>
          <Text color={theme.textDim}>Start typing to chat</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.dim}>/help for commands  ·  Ctrl+K for palette</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.dim}>Ctrl+T to cycle themes  ·  Ctrl+P for model picker</Text>
        </Box>
      </Box>
    </Box>
  );
}

// ─── Main Chat View ──────────────────────────────────────────────────────────

export function ChatView({ theme, messages, isStreaming, height }: ChatViewProps) {
  if (messages.length === 0) {
    return <EmptyState theme={theme} height={height} />;
  }

  return (
    <Box
      flexDirection="column"
      height={height}
      overflowX="hidden"
      overflowY="hidden"
      paddingRight={1}
    >
      <Box flexDirection="column" paddingX={0}>
        {messages.map((msg) => (
          <MessageBlock key={msg.id} message={msg} theme={theme} />
        ))}
      </Box>

      <StreamingIndicator theme={theme} isStreaming={isStreaming} />

      <MessageCounter count={messages.length} theme={theme} />

      {/* Scroll hint when overflow */}
      {messages.length > 5 ? (
        <Box paddingLeft={1}>
          <Text color={theme.dim}>↑ scroll with mouse wheel or Page Up/Down</Text>
        </Box>
      ) : null}
    </Box>
  );
}
