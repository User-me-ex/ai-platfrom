/**
 * 9 Router CLI — Start Screen
 *
 * Polished startup banner with connection status,
 * keyboard hints, and responsive layout.
 */

import { useWindowSize } from "ink";
import { Box, Text } from "ink";
import type { ConnectionStatus, Theme } from "./types";

interface StartScreenProps {
  connectionStatus: ConnectionStatus;
  version: string;
  modelsCount: number;
  defaultModel?: string;
  theme: Theme;
}

export function StartScreen({
  connectionStatus,
  version,
  modelsCount,
  defaultModel,
  theme,
}: StartScreenProps) {
  const { columns: width } = useWindowSize();

  const connColor =
    connectionStatus === "connected" ? theme.success
    : connectionStatus === "connecting" ? theme.warning
    : theme.error;

  const connText =
    connectionStatus === "connected" ? "Connected"
    : connectionStatus === "connecting" ? "Connecting..."
    : "Disconnected";

  const connIcon =
    connectionStatus === "connected" ? "●"
    : connectionStatus === "connecting" ? "◌"
    : "○";

  // Calculate responsive dimensions
  const bannerWidth = Math.min((width ?? 80) - 8, 56);
  const isSmall = (width ?? 80) < 60;

  return (
    <Box
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      width="100%"
      height="100%"
    >
      <Box
        flexDirection="column"
        alignItems="center"
        borderStyle="round"
        borderColor={theme.border}
        paddingX={isSmall ? 1 : 2}
        paddingY={2}
        width={bannerWidth}
      >
        {/* Title */}
        <Text color={theme.primary} bold>9 Router CLI</Text>
        <Text color={theme.textDim}>v{version}</Text>

        <Box marginTop={1}>
          <Text color={theme.border}>
            {"─".repeat(Math.max(10, bannerWidth - 8))}
          </Text>
        </Box>

        {/* Connection status */}
        <Box marginTop={1}>
          <Text color={connColor}>{connIcon}</Text>
          <Text color={theme.textDim}> {connText}</Text>
        </Box>

        {/* Connection details */}
        {connectionStatus === "connected" ? (
          <Box flexDirection="column" alignItems="center" marginTop={1}>
            <Text color={theme.textDim}>
              {modelsCount} model{modelsCount !== 1 ? "s" : ""} available
            </Text>
            {defaultModel ? (
              <Box marginTop={1}>
                <Text color={theme.info}>{defaultModel}</Text>
              </Box>
            ) : null}
          </Box>
        ) : null}

        {/* Keyboard hints */}
        <Box marginTop={1}>
          <Text color={theme.border}>
            {"─".repeat(Math.max(10, bannerWidth - 8))}
          </Text>
        </Box>

        <Box flexDirection="column" alignItems="center" marginTop={1}>
          {isSmall ? (
            <>
              <Text color={theme.dim}>Type to chat · /help for cmds</Text>
            </>
          ) : (
            <>
              <Text color={theme.textDim}>Type messages to chat</Text>
              <Text color={theme.dim}>/help for commands · Ctrl+K for palette</Text>
              <Text color={theme.dim}>Ctrl+P for models · Ctrl+T for theme</Text>
            </>
          )}
        </Box>

        {/* Version/build info */}
        <Box marginTop={1}>
          <Text color={theme.border}>
            {"─".repeat(Math.max(10, bannerWidth - 8))}
          </Text>
        </Box>

        <Box marginTop={1}>
          <Text color={theme.placeholder}>
            {connectionStatus === "connected"
              ? "Ready to assist"
              : "Waiting for connection..."}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
