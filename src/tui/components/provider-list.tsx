/**
 * 9 Router CLI — Provider List
 *
 * Enhanced with shared navigation hook, fuzzy search,
 * scroll indicators, and full keyboard support.
 */

import { useState, useMemo } from "react";
import { Box, Text, useInput, useWindowSize } from "ink";
import type { Theme } from "../types";
import { useNavigation, getScrollInfo } from "../utils/hooks";
import { formatProviderName } from "../utils/providers";

interface ProviderListProps {
  providers: { name: string; modelCount: number; displayName: string }[];
  onSelect: (provider: string) => void;
  onBack: () => void;
  theme: Theme;
}

export function ProviderList({ providers, onSelect, onBack, theme }: ProviderListProps) {
  const { columns: termWidth, rows: termHeight } = useWindowSize();

  const overlayWidth = Math.min((termWidth ?? 80) - 4, 72);
  const overlayHeight = Math.min((termHeight ?? 24) - 4, 24);
  const maxVisible = Math.max(5, overlayHeight - 10);

  const [filter, setFilter] = useState("");
  const [focus, setFocus] = useState<"search" | "list">("search");

  const filtered = useMemo(() => {
    if (!filter) return providers;
    const q = filter.toLowerCase();
    return providers.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      p.displayName.toLowerCase().includes(q)
    );
  }, [providers, filter]);

  const nav = useNavigation({
    itemCount: filtered.length,
    pageSize: maxVisible,
  });

  const scrollInfo = getScrollInfo(nav.cursor, maxVisible, filtered.length);

  useInput((input, key) => {
    if (key.escape) { onBack(); return; }

    if (key.return) {
      const p = filtered[nav.cursor];
      if (p) onSelect(p.name);
      return;
    }

    if (key.tab) {
      setFocus((f) => f === "search" ? "list" : "search");
      return;
    }

    if (focus === "list") {
      nav.handleKey(input, key);
      return;
    }

    // Search zone
    if (focus === "search") {
      if (key.backspace || key.delete) { setFilter((f) => f.slice(0, -1)); nav.resetCursor(); return; }
      if (input.length === 1 && !key.ctrl && !key.meta) { setFilter((f) => f + input); nav.resetCursor(); return; }
      if (key.upArrow || key.downArrow) { setFocus("list"); return; }
    }
  });

  const startIdx = Math.max(0, nav.cursor - Math.floor(maxVisible / 3));
  const visible = filtered.slice(startIdx, startIdx + maxVisible);

  return (
    <Box flexDirection="column" width={overlayWidth} height={overlayHeight}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text color={theme.primary}>← </Text>
        <Text color={theme.dim} underline>Back</Text>
        <Text bold color={theme.text}>  🏢 Browse Providers</Text>
        <Text color={theme.textDim}>  ({filtered.length} of {providers.length})</Text>
      </Box>

      {/* Search */}
      <Box
        borderStyle="single"
        borderColor={focus === "search" ? theme.borderActive : theme.border}
        marginBottom={1}
        paddingX={1}
      >
        <Text color={theme.textDim}>🔍 </Text>
        <Text color={filter ? theme.text : theme.placeholder}>
          {filter || "Type to search providers..."}
        </Text>
        {focus === "search" ? <Text color={theme.primary}>▎</Text> : null}
      </Box>

      {/* Provider list */}
      <Box flexDirection="column" overflowY="hidden">
        {scrollInfo.hasMoreAbove ? (
          <Text color={theme.dim}>  ↑ {scrollInfo.aboveCount} more</Text>
        ) : null}

        {visible.length === 0 ? (
          <Box alignItems="center" justifyContent="center" flexGrow={1}>
            <Box flexDirection="column" alignItems="center">
              <Text color={theme.textDim}>No providers match "{filter}"</Text>
              <Text color={theme.dim}>Try a different search term</Text>
            </Box>
          </Box>
        ) : (
          visible.map((p, i) => {
            const actualIdx = startIdx + i;
            const isHovered = actualIdx === nav.cursor && focus === "list";
            return (
              <Box key={p.name} paddingX={1} marginBottom={0}>
                <Text color={isHovered ? theme.primary : "transparent"}>
                  {isHovered ? "▸" : " "}
                </Text>
                <Text color={isHovered ? theme.text : theme.textDim}>
                  {" "}{formatProviderName(p.displayName)}
                </Text>
                <Box marginLeft={2}>
                  <Text color={theme.dim}>{p.modelCount} model{p.modelCount !== 1 ? "s" : ""}</Text>
                </Box>
                {/* Model count bar */}
                <Box marginLeft={1}>
                  <Text color={theme.border}>
                    {"["}
                    <Text color={theme.success}>
                      {"█".repeat(Math.min(p.modelCount, 20))}
                    </Text>
                    <Text color={theme.dim}>
                      {"░".repeat(Math.max(0, 20 - Math.min(p.modelCount, 20)))}
                    </Text>
                    {"]"}
                  </Text>
                </Box>
              </Box>
            );
          })
        )}

        {scrollInfo.hasMoreBelow ? (
          <Text color={theme.dim}>  ↓ {scrollInfo.belowCount} more</Text>
        ) : null}
      </Box>

      {/* Footer */}
      <Box marginTop={1}>
        <Text color={theme.textDim}>
          {focus === "list"
            ? "↑↓/jk · Enter view · Tab search"
            : "Type search · Tab list · Enter go"}
        </Text>
        <Text color={theme.dim}>
          {"  "}({nav.cursor + 1}/{filtered.length}) Esc back
        </Text>
      </Box>
    </Box>
  );
}
