/**
 * 9 Router CLI — Provider Models
 *
 * Enhanced with shared navigation hook, fuzzy search,
 * scroll indicators, and full keyboard support.
 */

import { useState, useMemo } from "react";
import { Box, Text, useInput, useWindowSize } from "ink";
import type { Theme, ModelInfo } from "../types";
import { useNavigation, getScrollInfo } from "../utils/hooks";
import { formatProviderName } from "../utils/providers";

interface ProviderModelsProps {
  providerDisplayName: string;
  models: ModelInfo[];
  selectedModel: string;
  onSelect: (modelId: string) => void;
  onBack: () => void;
  theme: Theme;
}

export function ProviderModels({
  providerDisplayName,
  models,
  selectedModel,
  onSelect,
  onBack,
  theme,
}: ProviderModelsProps) {
  const { columns: termWidth, rows: termHeight } = useWindowSize();

  const overlayWidth = Math.min((termWidth ?? 80) - 4, 76);
  const overlayHeight = Math.min((termHeight ?? 24) - 4, 24);
  const maxVisible = Math.max(5, overlayHeight - 10);

  const [filter, setFilter] = useState("");
  const [focus, setFocus] = useState<"search" | "list">("search");

  const filtered = useMemo(() => {
    if (!filter) return models;
    const q = filter.toLowerCase();
    return models.filter((m) =>
      m.name.toLowerCase().includes(q) ||
      m.id.toLowerCase().includes(q)
    );
  }, [models, filter]);

  const nav = useNavigation({
    itemCount: filtered.length,
    pageSize: maxVisible,
  });

  const scrollInfo = getScrollInfo(nav.cursor, maxVisible, filtered.length);

  useInput((input, key) => {
    if (key.escape) { onBack(); return; }

    if (key.return) {
      const m = filtered[nav.cursor];
      if (m) { onSelect(m.id); return; }
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
        <Text bold color={theme.text}>
          {" "}{formatProviderName(providerDisplayName)} Models
        </Text>
        <Text color={theme.textDim}>  ({filtered.length} model{filtered.length !== 1 ? "s" : ""})</Text>
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
          {filter || "Type to search models..."}
        </Text>
        {focus === "search" ? <Text color={theme.primary}>▎</Text> : null}
      </Box>

      {/* Model list */}
      <Box flexDirection="column" overflowY="hidden">
        {scrollInfo.hasMoreAbove ? (
          <Text color={theme.dim}>  ↑ {scrollInfo.aboveCount} more</Text>
        ) : null}

        {visible.length === 0 ? (
          <Box alignItems="center" justifyContent="center" flexGrow={1}>
            <Box flexDirection="column" alignItems="center">
              <Text color={theme.textDim}>No models match "{filter}"</Text>
              <Text color={theme.dim}>Try a different search term</Text>
            </Box>
          </Box>
        ) : (
          visible.map((model, i) => {
            const actualIdx = startIdx + i;
            const isActive = model.id === selectedModel;
            const isHovered = actualIdx === nav.cursor && focus === "list";
            const ctxLabel = model.contextWindow >= 1_000_000
              ? `${(model.contextWindow / 1_000_000).toFixed(1)}M ctx`
              : `${(model.contextWindow / 1_000).toFixed(0)}K ctx`;
            return (
              <Box key={model.id} paddingX={1} marginBottom={0} flexDirection="column">
                <Box>
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
                    {" "}{isActive ? "●" : "○"} {model.name}
                  </Text>
                  <Box marginLeft={1}>
                    <Text color={theme.textDim}>{ctxLabel}</Text>
                  </Box>
                  {isActive ? <Text color={theme.success}> ✓</Text> : null}
                </Box>
                <Box marginLeft={3}>
                  {model.capabilities.map((c, ci) => (
                    <Text key={ci} color={theme.dim}> {c}</Text>
                  ))}
                  {model.capabilities.length === 0 ? <Text color={theme.dim}> —</Text> : null}
                </Box>
                {model.cost ? (
                  <Box marginLeft={3}>
                    <Text color={theme.dim}>{model.cost}</Text>
                  </Box>
                ) : null}
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
            ? "↑↓/jk · Enter select · Tab search · PgUp/PgDn"
            : "Type search · Tab list"}
        </Text>
        {filtered.length > maxVisible ? (
          <Text color={theme.dim}>
            {"  "}{nav.cursor + 1}–{Math.min(nav.cursor + maxVisible, filtered.length)}/{filtered.length}
          </Text>
        ) : null}
        <Text color={theme.textDim}> · Esc back</Text>
      </Box>
    </Box>
  );
}
