/**
 * 9 Router CLI — Status Bar
 *
 * Enhanced status bar with better visual hierarchy,
 * context progress bar, and keyboard shortcut hints.
 */

import { Box, Text } from "ink";
import type { Theme, ConnectionStatus, PermissionMode } from "../types";

interface StatusBarProps {
  theme: Theme;
  connectionStatus: ConnectionStatus;
  selectedModel: string;
  selectedProvider: string;
  sessionName: string;
  messageCount: number;
  isStreaming: boolean;
  contextUsage: number;
  maxContext: number;
  costTokens: number;
  permissionMode: PermissionMode;
  sidebarOpen: boolean;
}

export function StatusBar({
  theme,
  connectionStatus,
  selectedModel,
  selectedProvider,
  sessionName,
  messageCount,
  isStreaming,
  contextUsage,
  maxContext,
  sidebarOpen,
}: StatusBarProps) {
  const connDot =
    connectionStatus === "connected" ? "●"
    : connectionStatus === "connecting" ? "◌"
    : "○";

  const connColor =
    connectionStatus === "connected" ? theme.success
    : connectionStatus === "connecting" ? theme.warning
    : theme.error;

  const ctxPct = maxContext > 0 ? Math.round((contextUsage / maxContext) * 100) : 0;
  const modelDisplay = selectedModel
    ? `${selectedProvider ? selectedProvider + "/" : ""}${selectedModel}`
    : "no model";

  // Context bar (compact)
  const barWidth = 8;
  const filled = Math.min(barWidth, Math.round((ctxPct / 100) * barWidth));
  const empty = barWidth - filled;
  const ctxColor = ctxPct > 90 ? theme.error : ctxPct > 70 ? theme.warning : theme.success;

  return (
    <Box paddingX={1} borderStyle="single" borderColor={theme.statusBorder} backgroundColor={theme.statusBg as any}>
      {/* Connection */}
      <Box>
        <Text color={connColor}>{connDot}</Text>
      </Box>

      <Box>
        <Text color={theme.border}> │ </Text>
        <Text color={theme.textDim}>{modelDisplay}</Text>
      </Box>

      <Box>
        <Text color={theme.border}> │ </Text>
        <Text color={theme.dim}>{sessionName}</Text>
      </Box>

      <Box>
        <Text color={theme.border}> │ </Text>
        <Text color={theme.dim}>{messageCount}</Text>
      </Box>

      {/* Context usage bar */}
      {maxContext > 0 ? (
        <Box>
          <Text color={theme.border}> │ </Text>
          <Text color={ctxColor}>{connDot}</Text>
          <Text color={theme.dim}>ctx </Text>
          <Text color={ctxColor}>
            {"["}{"█".repeat(filled)}{"░".repeat(empty)}{"]"}
          </Text>
          <Text color={theme.dim}> {ctxPct}%</Text>
        </Box>
      ) : null}

      {/* Streaming indicator */}
      {isStreaming ? (
        <Box>
          <Text color={theme.border}> │ </Text>
          <Text color={theme.success}>● gen</Text>
        </Box>
      ) : null}

      {/* Keyboard hint (far right — model picker) */}
      <Box marginLeft={2}>
        {!isStreaming ? (
          <Text color={theme.placeholder}>Ctrl+K</Text>
        ) : null}
      </Box>

      {/* Sidebar indicator */}
      {sidebarOpen ? (
        <Box>
          <Text color={theme.info}> [≡]</Text>
        </Box>
      ) : null}
    </Box>
  );
}
