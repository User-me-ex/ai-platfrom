/**
 * 9 Router CLI — Command Palette
 *
 * Modern command palette with:
 * - Fuzzy search with highlighted matches
 * - Category grouping with visual separators
 * - Right-side preview panel for selected command
 * - Scroll indicators (↑ more / ↓ more)
 * - Full keyboard navigation (vim keys, page keys, home/end)
 * - Auto-scroll selection into view
 * - Responsive height based on terminal
 * - Preview showing description, aliases, shortcut, usage, params
 */

import { useState, useMemo, useCallback, useRef } from "react";
import { Box, Text, useInput, useWindowSize } from "ink";
import type { Theme, CommandItem, CommandCategory } from "../types";
import { fuzzySearch, useNavigation, getScrollInfo } from "../utils/hooks";

interface CommandPaletteProps {
  theme: Theme;
  commands: CommandItem[];
  query: string;
  onSelect: (command: CommandItem) => void;
  onClose: () => void;
  onQueryChange: (query: string) => void;
}

const categoryLabels: Record<CommandCategory, string> = {
  ai: "AI & Chat",
  model: "Models",
  session: "Sessions",
  tools: "Tools",
  settings: "Settings",
  help: "Help & Docs",
  navigation: "Navigation",
};

const categoryIcons: Record<CommandCategory, string> = {
  ai: "🤖",
  model: "🧠",
  session: "💬",
  tools: "🔧",
  settings: "⚙️",
  help: "❓",
  navigation: "🧭",
};

const categoryOrder: CommandCategory[] = ["ai", "model", "session", "tools", "settings", "help"];

interface CommandCardProps {
  command: CommandItem;
  isSelected: boolean;
  theme: Theme;
}

function CommandCard({ command, isSelected, theme }: CommandCardProps) {
  return (
    <Box flexDirection="column" width="100%">
      <Box>
        <Text color={isSelected ? theme.primary : theme.textDim}>
          {isSelected ? "▸" : " "}
        </Text>
        <Text color={isSelected ? theme.text : theme.textDim}>
          {" /"}{command.name}
        </Text>
        <Box marginLeft={1} flexGrow={1}>
          <Text color={isSelected ? theme.textDim : theme.dim} wrap="truncate-end">
            {command.description}
          </Text>
        </Box>
        {command.shortcut ? (
          <Box marginLeft={1}>
            <Text color={theme.dim}>{command.shortcut}</Text>
          </Box>
        ) : null}
        {command.icon ? (
          <Text color={theme.dim}> {command.icon}</Text>
        ) : null}
      </Box>
    </Box>
  );
}

interface PreviewPanelProps {
  command: CommandItem | null;
  theme: Theme;
  width: number;
}

function PreviewPanel({ command, theme, width }: PreviewPanelProps) {
  if (!command) {
    return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="single"
      borderColor={theme.border}
      paddingX={1}
    >
        <Box marginBottom={1}>
          <Text color={theme.dim}>Command Preview</Text>
        </Box>
        <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
          <Text color={theme.textDim}>Select a command</Text>
          <Text color={theme.dim}>to see details</Text>
        </Box>
      </Box>
    );
  }

  const catLabel = categoryLabels[command.category] ?? command.category;
  const catIcon = categoryIcons[command.category] ?? "📁";

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="single"
      borderColor={theme.borderActive}
      paddingX={1}
      paddingY={1}
    >
      {/* Header */}
      <Box marginBottom={1}>
        <Text color={theme.primary} bold>
          {catIcon} /{command.name}
        </Text>
      </Box>

      {/* Description */}
      <Box marginBottom={1}>
        <Text color={theme.textDim}>{command.description}</Text>
      </Box>

      {/* Category badge */}
      <Box marginBottom={1}>
        <Box
          borderStyle="round"
          borderColor={theme.border}
          paddingX={1}
        >
          <Text color={theme.info}>{catLabel}</Text>
        </Box>
      </Box>

      {/* Details */}
      <Box flexDirection="column">
        {command.shortcut ? (
          <Box marginBottom={0}>
            <Text color={theme.dim}>Shortcut: </Text>
            <Text color={theme.primary}>{command.shortcut}</Text>
          </Box>
        ) : null}

        {command.aliases && command.aliases.length > 0 ? (
          <Box marginBottom={0}>
            <Text color={theme.dim}>Aliases: </Text>
            <Text color={theme.textDim}>{command.aliases.map((a) => `/${a}`).join(", ")}</Text>
          </Box>
        ) : null}

        {command.icon ? (
          <Box marginBottom={0}>
            <Text color={theme.dim}>Icon:      </Text>
            <Text color={theme.textDim}>{command.icon}</Text>
          </Box>
        ) : null}
      </Box>

      {/* Usage hint */}
      <Box marginTop={1}>
        <Text color={theme.dim}>Type /{command.name}</Text>
        <Text color={theme.textDim}> to run</Text>
      </Box>

      {/* Footer */}
      <Box marginTop={1}>
        <Text color={theme.dim}>───</Text>
      </Box>
      <Box>
        <Text color={theme.placeholder}>Enter to execute · Esc to close</Text>
      </Box>
    </Box>
  );
}

export function CommandPalette({ theme, commands, query, onSelect, onClose, onQueryChange }: CommandPaletteProps) {
  const { columns: termWidth, rows: termHeight } = useWindowSize();
  const [localQuery, setLocalQuery] = useState(query);
  const [focusZone, setFocusZone] = useState<"list" | "preview">("list");
  const prevSelectedRef = useRef<string | null>(null);

  // Responsive sizing
  const overlayWidth = Math.min((termWidth ?? 80) - 4, 120);
  const listWidth = Math.floor(overlayWidth * 0.58);
  const previewWidth = overlayWidth - listWidth - 2;
  const hasPreviewRoom = (termWidth ?? 80) >= 72;
  const overlayHeight = Math.min((termHeight ?? 24) - 4, 30);
  const listHeight = overlayHeight - 8; // header + search + footer space
  const maxVisibleItems = Math.max(5, listHeight);

  // Fuzzy search results
  const searchResults = useMemo(() => {
    return fuzzySearch(
      commands,
      localQuery,
      (cmd) => `${cmd.name} ${cmd.description} ${cmd.aliases?.join(" ") ?? ""} ${cmd.category}`,
      200
    );
  }, [commands, localQuery]);

  const filteredCommands = useMemo(() => searchResults.map((r) => r.item), [searchResults]);

  // Group by category for display
  const groupedCommands = useMemo(() => {
    const groups: Map<CommandCategory, CommandItem[]> = new Map();
    for (const cmd of filteredCommands) {
      const list = groups.get(cmd.category) ?? [];
      list.push(cmd);
      groups.set(cmd.category, list);
    }
    return groups;
  }, [filteredCommands]);

  // Build flat list with category headers for cursor navigation
  const flatItems = useMemo(() => {
    const items: Array<{ type: "category"; label: string; category: CommandCategory } | { type: "command"; command: CommandItem }> = [];
    for (const cat of categoryOrder) {
      const cmds = groupedCommands.get(cat);
      if (!cmds || cmds.length === 0) continue;
      items.push({ type: "category" as const, label: categoryLabels[cat], category: cat });
      for (const cmd of cmds) {
        items.push({ type: "command" as const, command: cmd });
      }
    }
    return items;
  }, [groupedCommands]);

  // Only command items for cursor (skip category headers)
  const commandOnlyItems = useMemo(
    () => flatItems.filter((i): i is { type: "command"; command: CommandItem } => i.type === "command"),
    [flatItems]
  );

  const nav = useNavigation({
    itemCount: commandOnlyItems.length,
    pageSize: maxVisibleItems,
  });

  // Map nav cursor to flat item index
  const selectedCommand = commandOnlyItems[nav.cursor]?.command ?? null;

  // Track the selected command for cursor preservation
  if (selectedCommand) {
    prevSelectedRef.current = selectedCommand.id;
  }

  // Calculate scroll info
  const scrollInfo = getScrollInfo(nav.cursor, maxVisibleItems, commandOnlyItems.length);

  // Focus zones
  const cycleFocus = useCallback(() => {
    if (hasPreviewRoom) {
      setFocusZone((z) => (z === "list" ? "preview" : "list"));
    }
  }, [hasPreviewRoom]);

  /** Preserve cursor position when filter changes */
  const updateQueryAndPreserveCursor = useCallback((newQuery: string) => {
    // First update the query (this will cause re-memo with new filtered results)
    setLocalQuery(newQuery);
    onQueryChange(newQuery);
    // After the next render, the useNavigation will auto-adjust
    // Try to preserve position by finding the previously selected item
    const prevId = prevSelectedRef.current;
    if (prevId && newQuery) {
      // Check if the previously selected command still matches
      const stillMatches = commands.find((c) => c.id === prevId &&
        fuzzySearch([c], newQuery, (cmd) => `${cmd.name} ${cmd.description}`).length > 0
      );
      if (!stillMatches) {
        nav.resetCursor();
      }
    } else {
      nav.resetCursor();
    }
  }, [commands, onQueryChange, nav]);

  useInput((input, key) => {
    // Always close on escape
    if (key.escape) {
      onClose();
      return;
    }

    // Submit on enter
    if (key.return) {
      if (selectedCommand) {
        onSelect(selectedCommand);
      }
      return;
    }

    // Tab to cycle focus between list and preview
    if (key.tab) {
      cycleFocus();
      return;
    }

    // Handle search input — preserve cursor position
    if (input.length === 1 && !key.ctrl && !key.meta && !key.escape) {
      updateQueryAndPreserveCursor(localQuery + input);
      return;
    }

    // Backspace/delete — preserve cursor position
    if (key.backspace || key.delete) {
      updateQueryAndPreserveCursor(localQuery.slice(0, -1));
      return;
    }

    // Delegate navigation to the focused zone
    if (focusZone === "list") {
      nav.handleKey(input, key);
    }

    // Left/right arrows for focus switching
    if (key.leftArrow && focusZone === "preview") {
      setFocusZone("list");
    }
    if (key.rightArrow && focusZone === "list" && hasPreviewRoom) {
      setFocusZone("preview");
    }
  });

  // Build visible items
  const visibleItems = useMemo(() => {
    type VisibleCategory = { type: "category"; label: string; icon: string; category: CommandCategory };
    type VisibleCommand = { type: "command"; command: CommandItem; isSelected: boolean };
    type VisibleItem = VisibleCategory | VisibleCommand;

    const result: VisibleItem[] = [];
    let cmdIndex = 0;

    for (const cat of categoryOrder) {
      const cmds = groupedCommands.get(cat);
      if (!cmds || cmds.length === 0) continue;

      result.push({ type: "category" as const, label: categoryLabels[cat], icon: categoryIcons[cat] ?? "📁", category: cat });

      for (const cmd of cmds) {
        const isSelected = cmdIndex === nav.cursor && focusZone === "list";
        result.push({ type: "command" as const, command: cmd, isSelected });
        cmdIndex++;
      }
    }

    return result;
  }, [groupedCommands, nav.cursor, focusZone]);

  // Calculate visible slice
  const visibleSlice = useMemo(() => {
    // Map from command-only index to flat index
    const flatIndexMap = new Map<number, number>();
    let cmdIdx = 0;
    let flatIdx = 0;
    for (const cat of categoryOrder) {
      const cmds = groupedCommands.get(cat);
      if (!cmds || cmds.length === 0) continue;
      flatIdx++; // skip category header
      for (const _cmd of cmds) {
        void _cmd;
        flatIndexMap.set(cmdIdx, flatIdx);
        cmdIdx++;
        flatIdx++;
      }
    }

    const startCmdIdx = Math.max(0, nav.cursor - Math.floor(maxVisibleItems / 3));
    const targetFlatStart = flatIndexMap.get(startCmdIdx) ?? 0;

    // Count items from targetFlatStart
    let count = 0;
    let currentFlat = targetFlatStart;
    while (currentFlat < visibleItems.length && count < maxVisibleItems) {
      count++;
      currentFlat++;
    }

    return visibleItems.slice(targetFlatStart, targetFlatStart + count);
  }, [visibleItems, nav.cursor, maxVisibleItems, groupedCommands]);

  return (
    <Box flexDirection="column" alignItems="center" width="100%">
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
          <Text bold color={theme.primary}>⌨ Command Palette  </Text>
          <Text color={theme.textDim}>
            {filteredCommands.length} command{filteredCommands.length !== 1 ? "s" : ""}
            {localQuery ? ` for "${localQuery}"` : ""}
          </Text>
        </Box>

        {/* Search input */}
        <Box
          borderStyle="single"
          borderColor={theme.borderActive}
          marginBottom={1}
          paddingX={1}
        >
          <Text color={theme.primary}>/ </Text>
          {localQuery ? (
            <Text color={theme.text}>{localQuery}<Text color={theme.primary}>▎</Text></Text>
          ) : (
            <>
              <Text color={theme.placeholder}>search commands...</Text>
              <Text color={theme.primary}>▎</Text>
            </>
          )}
        </Box>

        {/* Main content: list + preview */}
        <Box flexDirection="row" flexGrow={1}>
          {/* Command list */}
          <Box
            flexDirection="column"
            width={hasPreviewRoom ? listWidth : "100%"}
            height={listHeight}
            overflowY="hidden"
          >
            {/* Scroll indicators */}
            {scrollInfo.hasMoreAbove && focusZone === "list" ? (
              <Box>
                <Text color={theme.textDim}>  ↑ {scrollInfo.aboveCount} more</Text>
              </Box>
            ) : null}

            {/* Items */}
            {visibleSlice.length === 0 ? (
              <Box justifyContent="center" alignItems="center" flexGrow={1}>
                <Box flexDirection="column" alignItems="center">
                  <Text color={theme.textDim}>No commands found</Text>
                  {localQuery ? (
                    <Text color={theme.dim}>Try a different search term</Text>
                  ) : null}
                </Box>
              </Box>
            ) : (
              <Box flexDirection="column">
                {visibleSlice.map((item, idx) => {
                  if (item.type === "category") {
                    return (
                      <Box key={item.category} marginTop={idx > 0 ? 1 : 0} marginBottom={0}>
                        <Text color={theme.dim} bold>
                          {"  "}{item.icon} {item.label}
                        </Text>
                      </Box>
                    );
                  }
                  return (
                    <CommandCard
                      key={item.command.id}
                      command={item.command}
                      isSelected={item.isSelected}
                      theme={theme}
                    />
                  );
                })}
              </Box>
            )}

            {/* Scroll indicators */}
            {scrollInfo.hasMoreBelow && focusZone === "list" ? (
              <Box>
                <Text color={theme.textDim}>  ↓ {scrollInfo.belowCount} more</Text>
              </Box>
            ) : null}
          </Box>

          {/* Preview panel */}
          {hasPreviewRoom ? (
            <Box marginLeft={1} width={previewWidth}>
              <PreviewPanel
                command={selectedCommand}
                theme={theme}
                width={previewWidth}
              />
            </Box>
          ) : null}
        </Box>

        {/* Footer with keyboard hints */}
        <Box marginTop={1}>
          <Text color={theme.textDim}>
            ↑↓/jk nav · Enter exec · </Text>
            {hasPreviewRoom ? <Text color={theme.textDim}>Tab switch · </Text> : null}
            <Text color={theme.textDim}>
            {localQuery ? "" : "Type to search"} · </Text>
            <Text color={theme.textDim}>Esc close</Text>
          {commandOnlyItems.length > maxVisibleItems ? (
            <Text color={theme.dim}>
              {" · "}{nav.cursor + 1}–{Math.min(nav.cursor + maxVisibleItems, commandOnlyItems.length)}/{commandOnlyItems.length}
            </Text>
          ) : null}
        </Box>

        {/* Focus zone indicator */}
        <Box>
          <Text color={focusZone === "list" ? theme.primary : theme.dim}>
            {focusZone === "list" ? "●" : "○"} List
          </Text>
          {hasPreviewRoom ? (
            <>
              <Text color={theme.textDim}> </Text>
              <Text color={focusZone === "preview" ? theme.primary : theme.dim}>
                {focusZone === "preview" ? "●" : "○"} Preview
              </Text>
            </>
          ) : null}
        </Box>
      </Box>
    </Box>
  );
}

// ─── Submenu ─────────────────────────────────────────────────────────────────

interface SubmenuProps {
  theme: Theme;
  title: string;
  items: Array<{
    id: string;
    label: string;
    description?: string;
    badges?: string[];
    group?: string;
  }>;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function Submenu({ theme, title, items, onSelect, onClose }: SubmenuProps) {
  const { columns: termWidth, rows: termHeight } = useWindowSize();

  const overlayWidth = Math.min((termWidth ?? 80) - 4, 64);
  const overlayHeight = Math.min((termHeight ?? 24) - 4, 24);
  const maxVisible = Math.max(5, overlayHeight - 8);

  const nav = useNavigation({
    itemCount: items.length,
    pageSize: maxVisible,
  });

  const grouped = useMemo(() => {
    const groups = new Map<string, typeof items>();
    for (const item of items) {
      const groupKey = item.group ?? "Options";
      const list = groups.get(groupKey) ?? [];
      list.push(item);
      groups.set(groupKey, list);
    }
    return groups;
  }, [items]);

  const scrollInfo = getScrollInfo(nav.cursor, maxVisible, items.length);

  useInput((input, key) => {
    if (key.escape) { onClose(); return; }
    if (key.return) {
      const selected = items[nav.cursor];
      if (selected) onSelect(selected.id);
      return;
    }
    nav.handleKey(input, key);
  });

  // Build visible items respecting group headers
  const flatGrouped = useMemo(() => {
    type GItem = { type: "group"; label: string } | { type: "item"; item: (typeof items)[0]; isSelected: boolean };
    const result: GItem[] = [];
    let idx = 0;
    for (const [group, gItems] of grouped) {
      result.push({ type: "group", label: group });
      for (const item of gItems) {
        result.push({ type: "item", item, isSelected: idx === nav.cursor });
        idx++;
      }
    }
    return result;
  }, [grouped, nav.cursor]);

  const startFlatIdx = Math.max(0, flatGrouped.findIndex((i) => i.type === "item" && nav.cursor <= flatGrouped.filter(f => f.type === "item").indexOf(i as any)) - 2);
  const visible = flatGrouped.slice(startFlatIdx, startFlatIdx + maxVisible);

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
        <Box marginBottom={1}>
          <Text bold color={theme.primary}>{title}</Text>
          <Text color={theme.textDim}>  ({items.length} options)</Text>
        </Box>

        <Box flexDirection="column" flexGrow={1} overflowY="hidden">
          {scrollInfo.hasMoreAbove ? (
            <Text color={theme.dim}>  ↑ {scrollInfo.aboveCount} more</Text>
          ) : null}

          {visible.map((item) => {
            if (item.type === "group") {
              return (
                <Box key={item.label}>
                  <Text color={theme.dim} bold>  {item.label}</Text>
                </Box>
              );
            }
            return (
              <Box key={item.item.id} paddingLeft={1}>
                <Text color={item.isSelected ? theme.primary : theme.textDim}>
                  {item.isSelected ? "▸" : " "}
                </Text>
                <Text color={item.isSelected ? theme.text : theme.textDim}>
                  {" "}{item.item.label}
                </Text>
                {item.item.description ? (
                  <Text color={theme.textDim}>  {item.item.description}</Text>
                ) : null}
                {item.item.badges ? (
                  <Box marginLeft={1}>
                    {item.item.badges.map((b, bi) => (
                      <Text key={bi} color={theme.dim}>[{b}] </Text>
                    ))}
                  </Box>
                ) : null}
              </Box>
            );
          })}

          {scrollInfo.hasMoreBelow ? (
            <Text color={theme.dim}>  ↓ {scrollInfo.belowCount} more</Text>
          ) : null}
        </Box>

        <Box marginTop={1}>
          <Text color={theme.textDim}>
            ↑↓/jk nav · Enter select · </Text>
            <Text color={theme.textDim}>
            {nav.cursor + 1}/{items.length} · </Text>
            <Text color={theme.textDim}>Esc close</Text>
        </Box>
      </Box>
    </Box>
  );
}
