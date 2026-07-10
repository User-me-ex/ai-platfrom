/**
 * 9 Router CLI — All Models Grid
 *
 * Enhanced with shared navigation hook, fuzzy search,
 * filter chips, scroll indicators, and vim-style keys.
 */

import { useState, useMemo } from "react";
import { Box, Text, useInput, useWindowSize } from "ink";
import type { Theme, ModelInfo, ModelCapability, SortKey } from "../types";
import { useNavigation, getScrollInfo } from "../utils/hooks";
import { formatProviderName } from "../utils/providers";

interface AllModelsGridProps {
  models: ModelInfo[];
  selectedModel: string;
  onSelect: (modelId: string) => void;
  onBack: () => void;
  theme: Theme;
}

type FocusZone = "search" | "filters" | "list";

const CAP_TAGS: { key: ModelCapability; label: string }[] = [
  { key: "vision", label: "Vision" },
  { key: "audio", label: "Audio" },
  { key: "tools", label: "Tools" },
  { key: "reasoning", label: "Reasoning" },
];

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "context", label: "Context" },
  { key: "pricing", label: "Price" },
  { key: "provider", label: "Provider" },
];

export function AllModelsGrid({ models, selectedModel, onSelect, onBack, theme }: AllModelsGridProps) {
  const { columns: termWidth, rows: termHeight } = useWindowSize();

  const overlayWidth = Math.min((termWidth ?? 80) - 4, 80);
  const overlayHeight = Math.min((termHeight ?? 24) - 4, 28);
  const maxVisible = Math.max(5, overlayHeight - 14);

  const [filter, setFilter] = useState("");
  const [focus, setFocus] = useState<FocusZone>("search");
  const [provFilter, setProvFilter] = useState<string | null>(null);
  const [capFilter, setCapFilter] = useState<ModelCapability | null>(null);
  const [sort, setSort] = useState<SortKey>("name");
  const [sortAsc, setSortAsc] = useState(true);
  const [filterChipCursor, setFilterChipCursor] = useState(0);

  const providers = useMemo(() => {
    const set = new Set(models.map((m) => m.provider).filter(Boolean));
    return [...set].sort();
  }, [models]);

  const filtered = useMemo(() => {
    let result = [...models];
    if (filter) {
      const q = filter.toLowerCase();
      result = result.filter((m) =>
        m.name.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q)
      );
    }
    if (provFilter) result = result.filter((m) => m.provider === provFilter);
    if (capFilter) result = result.filter((m) => m.capabilities.includes(capFilter));
    result.sort((a, b) => {
      let cmp = 0;
      switch (sort) {
        case "name": cmp = a.name.localeCompare(b.name); break;
        case "context": cmp = a.contextWindow - b.contextWindow; break;
        case "pricing": cmp = (a.cost || "").localeCompare(b.cost || ""); break;
        case "provider": cmp = a.provider.localeCompare(b.provider); break;
      }
      return sortAsc ? cmp : -cmp;
    });
    return result;
  }, [models, filter, provFilter, capFilter, sort, sortAsc]);

  const nav = useNavigation({
    itemCount: filtered.length,
    pageSize: maxVisible,
  });

  const scrollInfo = getScrollInfo(nav.cursor, maxVisible, filtered.length);

  // Filter chip handlers
  const chips = [
    {
      label: provFilter ? `Provider: ${formatProviderName(provFilter)}` : "Provider: All",
      onActivate: () => {
        if (!provFilter) { const f = providers[0]; if (f) setProvFilter(f); }
        else {
          const idx = providers.indexOf(provFilter);
          if (idx >= 0 && idx < providers.length - 1) { const n = providers[idx + 1]; if (n) setProvFilter(n); else setProvFilter(null); }
          else setProvFilter(null);
        }
        nav.resetCursor();
      },
      onCycle: () => {
        if (!provFilter) { const f = providers[0]; if (f) setProvFilter(f); }
        else {
          const idx = providers.indexOf(provFilter);
          if (idx >= 0 && idx < providers.length - 1) { const n = providers[idx + 1]; if (n) setProvFilter(n); else setProvFilter(null); }
          else setProvFilter(null);
        }
        nav.resetCursor();
      },
    },
    {
      label: capFilter ? `Cap: ${capFilter}` : "Cap: All",
      onActivate: () => {
        if (!capFilter) { const f = CAP_TAGS[0]; if (f) setCapFilter(f.key); }
        else {
          const idx = CAP_TAGS.findIndex((c) => c.key === capFilter);
          if (idx >= 0 && idx < CAP_TAGS.length - 1) { const n = CAP_TAGS[idx + 1]; if (n) setCapFilter(n.key); else setCapFilter(null); }
          else setCapFilter(null);
        }
        nav.resetCursor();
      },
      onCycle: () => {
        if (!capFilter) { const f = CAP_TAGS[0]; if (f) setCapFilter(f.key); }
        else {
          const idx = CAP_TAGS.findIndex((c) => c.key === capFilter);
          if (idx >= 0 && idx < CAP_TAGS.length - 1) { const n = CAP_TAGS[idx + 1]; if (n) setCapFilter(n.key); else setCapFilter(null); }
          else setCapFilter(null);
        }
        nav.resetCursor();
      },
    },
    {
      label: `Sort: ${sort}${sortAsc ? " ↑" : " ↓"}`,
      onActivate: () => {
        const idx = SORT_OPTIONS.findIndex((s) => s.key === sort);
        if (idx >= 0 && idx < SORT_OPTIONS.length - 1) { const n = SORT_OPTIONS[idx + 1]; if (n) setSort(n.key); }
        else setSort("name");
        setSortAsc(true);
        nav.resetCursor();
      },
      onCycle: () => {
        setSortAsc((a) => !a);
      },
    },
  ];

  useInput((input, key) => {
    if (key.escape && focus === "search") { onBack(); return; }
    if (key.escape) { setFocus("search"); return; }

    if (key.tab) {
      setFocus((f) => f === "search" ? "filters" : f === "filters" ? "list" : "search");
      setFilterChipCursor(0);
      return;
    }

    if (key.return) {
      if (focus === "list") {
        const m = filtered[nav.cursor];
        if (m) { onSelect(m.id); return; }
      }
      if (focus === "filters" && chips[filterChipCursor]) {
        chips[filterChipCursor].onActivate();
        return;
      }
    }

    // Delegate navigation
    if (focus === "list") {
      nav.handleKey(input, key);
      return;
    }

    if (focus === "filters") {
      if (key.leftArrow) { setFilterChipCursor((c) => Math.max(0, c - 1)); return; }
      if (key.rightArrow) { setFilterChipCursor((c) => Math.min(chips.length - 1, c + 1)); return; }
      if (key.upArrow || key.downArrow) {
        // Cycle the active chip
        chips[filterChipCursor]?.onCycle();
        return;
      }
      if (key.backspace || key.delete) { setProvFilter(null); setCapFilter(null); return; }
      return;
    }

    // Search zone
    if (focus === "search") {
      if (key.backspace || key.delete) { setFilter((f) => f.slice(0, -1)); nav.resetCursor(); return; }
      if (input.length === 1 && !key.ctrl && !key.meta) { setFilter((f) => f + input); nav.resetCursor(); return; }
      // Arrow keys move to list
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
        <Text bold color={theme.text}>  📋 All Models</Text>
        <Text color={theme.textDim}>  ({filtered.length} of {models.length})</Text>
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
          {filter || "Search by name, provider, keyword..."}
        </Text>
        {focus === "search" ? <Text color={theme.primary}>▎</Text> : null}
      </Box>

      {/* Filter chips */}
      <Box marginBottom={1} gap={1}>
        {chips.map((chip, i) => (
          <Box
            key={i}
            borderStyle="round"
            borderColor={focus === "filters" && filterChipCursor === i ? theme.borderActive : theme.border}
            paddingX={1}
          >
            <Text color={theme.dim}>{chip.label}</Text>
          </Box>
        ))}
        <Text color={theme.textDim}>Tab</Text>
      </Box>

      {/* Model list */}
      <Box flexDirection="column" overflowY="hidden">
        {scrollInfo.hasMoreAbove ? (
          <Text color={theme.dim}>  ↑ {scrollInfo.aboveCount} more</Text>
        ) : null}

        {visible.length === 0 ? (
          <Box alignItems="center" justifyContent="center" flexGrow={1}>
            <Box flexDirection="column" alignItems="center">
              <Text color={theme.textDim}>No models match your criteria</Text>
              {filter ? <Text color={theme.dim}>Try adjusting filters</Text> : null}
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
                    <Text color={theme.info}>{formatProviderName(model.providerDisplayName)}</Text>
                  </Box>
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
            ? "↑↓/jk nav · Enter select · Tab zone · PgUp/PgDn"
            : focus === "filters"
            ? "←→ chip · ↑↓ cycle · Enter toggle · Del reset · Tab"
            : "Type search · ↑↓ list · Tab filter · Esc back"}
        </Text>
        {focus === "list" && filtered.length > maxVisible ? (
          <Text color={theme.dim}>
            {"  "}{nav.cursor + 1}–{Math.min(nav.cursor + maxVisible, filtered.length)}/{filtered.length}
          </Text>
        ) : null}
      </Box>

      {/* Focus indicator */}
      <Box>
        <Text color={focus === "search" ? theme.primary : theme.dim}>Search </Text>
        <Text color={focus === "filters" ? theme.primary : theme.dim}>Filters </Text>
        <Text color={focus === "list" ? theme.primary : theme.dim}>List</Text>
      </Box>
    </Box>
  );
}
