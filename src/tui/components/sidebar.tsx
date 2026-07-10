import { Box, Text, useInput } from "ink";
import type { Theme, SessionInfo } from "../types";

interface SidebarProps {
  theme: Theme;
  sessionName: string;
  sessionList: SessionInfo[];
  selectedModel: string;
  selectedProvider: string;
  messageCount: number;
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ theme, sessionName, sessionList, selectedModel, selectedProvider, messageCount, isOpen, onClose }: SidebarProps) {
  if (!isOpen) return null;

  useInput((_input, key) => {
    if (key.escape) {
      onClose();
    }
  });

  return (
    <Box
      width={28}
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.sidebarBorder}
      backgroundColor={theme.sidebarBg}
      paddingX={1}
      minHeight="100%"
    >
      <Box marginBottom={1}>
        <Text bold color={theme.primary}>9 Router CLI</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color={theme.dim} bold>Session</Text>
        <Text color={theme.text}>  {sessionName}</Text>
        <Text color={theme.textDim}>  {messageCount} messages</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color={theme.dim} bold>Model</Text>
        <Text color={theme.primary}>  {selectedModel || "—"}</Text>
        {selectedProvider ? (
          <Text color={theme.textDim}>  via {selectedProvider}</Text>
        ) : null}
      </Box>

      {sessionList.length > 0 ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.dim} bold>Recent Sessions</Text>
          {sessionList.slice(-5).reverse().map((s) => (
            <Box key={s.id}>
              <Text color={s.isActive ? theme.primary : theme.textDim}>
                {s.isActive ? "▸" : " "} {s.name}
              </Text>
            </Box>
          ))}
        </Box>
      ) : null}

      <Box marginTop={1}>
        <Text color={theme.textDim}>Esc to close</Text>
      </Box>
    </Box>
  );
}
