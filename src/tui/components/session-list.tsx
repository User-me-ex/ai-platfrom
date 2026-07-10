/**
 * 9 Router CLI — Session List
 *
 * Enhanced with shared navigation hook, scroll indicators,
 * vim-style keys, page keys, and responsive sizing.
 */

import { Box, Text, useInput, useWindowSize } from "ink";
import type { Theme, SessionInfo } from "../types";
import { useNavigation, getScrollInfo } from "../utils/hooks";

interface SessionListProps {
  sessions: SessionInfo[];
  activeName: string;
  onSelect: (name: string) => void;
  onClose: () => void;
  theme: Theme;
}

export function SessionList({ sessions, activeName, onSelect, onClose, theme }: SessionListProps) {
  const { columns: termWidth, rows: termHeight } = useWindowSize();

  const overlayWidth = Math.min((termWidth ?? 80) - 4, 72);
  const overlayHeight = Math.min((termHeight ?? 24) - 4, 22);
  const maxVisible = Math.max(5, overlayHeight - 8);

  const nav = useNavigation({
    itemCount: sessions.length,
    pageSize: maxVisible,
  });

  const scrollInfo = getScrollInfo(nav.cursor, maxVisible, sessions.length);

  useInput((input, key) => {
    if (key.escape) { onClose(); return; }
    if (key.return) {
      const s = sessions[nav.cursor];
      if (s) onSelect(s.name);
      return;
    }
    nav.handleKey(input, key);
  });

  // Calculate visible items
  const startIdx = Math.max(0, Math.min(nav.cursor, scrollInfo.hasMoreAbove ? nav.cursor - 1 : nav.cursor));
  const visible = sessions.slice(startIdx, startIdx + maxVisible);

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" width="100%">
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.borderActive}
        padding={1}
        width={overlayWidth}
        height={overlayHeight}
      >
        {/* Header */}
        <Box marginBottom={1}>
          <Text bold color={theme.primary}>💬 Sessions</Text>
          <Text color={theme.textDim}>  ({sessions.length} session{sessions.length !== 1 ? "s" : ""})</Text>
          {activeName ? (
            <Text color={theme.success}>  Active: {activeName}</Text>
          ) : null}
        </Box>

        {/* List */}
        <Box flexDirection="column" flexGrow={1} overflowY="hidden">
          {/* Scroll indicator */}
          {scrollInfo.hasMoreAbove ? (
            <Box>
              <Text color={theme.dim}>  ↑ {scrollInfo.aboveCount} more</Text>
            </Box>
          ) : null}

          {visible.length === 0 ? (
            <Box paddingLeft={1} alignItems="center" justifyContent="center" flexGrow={1}>
              <Box flexDirection="column" alignItems="center">
                <Text color={theme.textDim}>No sessions yet</Text>
                <Text color={theme.dim}>Start a conversation to create one</Text>
              </Box>
            </Box>
          ) : (
            visible.map((s, i) => {
              const actualIdx = startIdx + i;
              const isActive = s.name === activeName;
              const isHovered = actualIdx === nav.cursor;
              return (
                <Box key={s.id} paddingX={1} marginBottom={0}>
                  <Text color={isHovered ? theme.primary : "transparent"}>
                    {isHovered ? "▸" : " "}
                  </Text>
                  <Text
                    color={
                      isActive ? theme.success
                      : isHovered ? theme.text
                      : theme.textDim
                    }
                  >
                    {" "}{isActive ? "●" : "○"} {s.name}
                  </Text>
                  <Box marginLeft={2}>
                    <Text color={theme.dim}>
                      {s.model} · {s.messageCount} msgs
                    </Text>
                  </Box>
                  <Box marginLeft={1}>
                    <Text color={theme.dim}>
                      {new Date(s.createdAt).toLocaleDateString()}
                    </Text>
                  </Box>
                  {isActive ? <Text color={theme.success}> ✓</Text> : null}
                </Box>
              );
            })
          )}

          {/* Scroll indicator */}
          {scrollInfo.hasMoreBelow ? (
            <Box>
              <Text color={theme.dim}>  ↓ {scrollInfo.belowCount} more</Text>
            </Box>
          ) : null}
        </Box>

        {/* Footer */}
        <Box marginTop={1}>
          <Text color={theme.textDim}>
            ↑↓/jk · Enter select · Home/End
          </Text>
          <Text color={theme.dim}>
            {"  "}({nav.cursor + 1}/{sessions.length}) Esc close
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
