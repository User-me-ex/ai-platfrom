/**
 * 9 Router CLI — Input Box
 *
 * Enhanced input with:
 * - Command history (↑/↓ cycle through sent commands)
 * - Improved autocomplete with categories
 * - Responsive prompt
 * - Keyboard hints
 * - Blinking cursor
 * - Multi-line support indicator
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Box, Text, useInput } from "ink";
import type { Theme, CommandItem, CommandCategory } from "../types";
import { fuzzySearch } from "../utils/hooks";

interface InputBoxProps {
  theme: Theme;
  commands: CommandItem[];
  onSubmit: (text: string) => void;
  placeholder?: string;
  disabled?: boolean;
  rawMode?: boolean;
  externalInput?: string;
}

const CURSOR_CHARS = ["▎", " "];

const categoryOrder: CommandCategory[] = ["ai", "model", "session", "tools", "settings", "help"];

export function InputBox({
  theme,
  commands,
  onSubmit,
  placeholder = "Type a message...",
  disabled,
  rawMode,
  externalInput,
}: InputBoxProps) {
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<CommandItem[]>([]);
  const [selIdx, setSelIdx] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [cursorVisible, setCursorVisible] = useState(true);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const prevSelectedRef = useRef<string | null>(null);

  // Track the currently selected command ID so we can preserve it across filter changes
  useEffect(() => {
    const selected = suggestions[selIdx];
    if (selected) {
      prevSelectedRef.current = selected.id;
    }
  }, [selIdx, suggestions]);

  // Track if we're in rawMode vs controlled
  const isControlled = !rawMode && externalInput !== undefined;
  const effectiveInput = isControlled ? (externalInput ?? "") : input;

  // Blinking cursor
  useEffect(() => {
    if (disabled) return;
    const t = setInterval(() => setCursorVisible((v) => !v), 530);
    return () => clearInterval(t);
  }, [disabled]);

  // Update suggestions as user types — preserves cursor position when possible
  const updateSuggestions = useCallback(
    (val: string) => {
      if (val.startsWith("/")) {
        const q = val.slice(1).toLowerCase();
        if (q.length === 0) {
          // Show all commands when just "/"
          setSuggestions(commands);
          setShowSuggestions(commands.length > 0);
          setSelIdx(0);
          prevSelectedRef.current = null;
          return;
        }
        // Use the shared fuzzySearch with relevance scoring and sorting
        const scored = fuzzySearch(
          commands,
          q,
          (cmd) => `${cmd.name} ${cmd.description} ${cmd.aliases?.join(" ") ?? ""} ${cmd.category}`,
          50
        );
        const matched = scored.map((r) => r.item);

        setSuggestions(matched);
        setShowSuggestions(matched.length > 0);

        // Preserve cursor position: try to find the previously selected item
        const prevId = prevSelectedRef.current;
        if (prevId) {
          const newIdx = matched.findIndex((c) => c.id === prevId);
          if (newIdx >= 0) {
            setSelIdx(newIdx);
            return;
          }
        }
        setSelIdx(0);
      } else {
        setShowSuggestions(false);
      }
    },
    [commands]
  );

  useInput((value, key) => {
    if (!rawMode || disabled) return;

    // Enter — submit
    if (key.return) {
      // Complete from autocomplete if active
      if (showSuggestions && suggestions[selIdx]) {
        const completed = "/" + suggestions[selIdx].name + " ";
        setInput(completed);
        setShowSuggestions(false);
        updateSuggestions(completed);
        return;
      }

      const trimmed = input.trim();
      if (trimmed) {
        // Add to history
        setHistory((h) => [trimmed, ...h.slice(0, 49)]);
        setHistoryIdx(-1);
        onSubmit(trimmed);
        setInput("");
        setShowSuggestions(false);
      }
      return;
    }

    // Tab — complete from autocomplete
    if (key.tab) {
      if (showSuggestions && suggestions[selIdx]) {
        const completed = "/" + suggestions[selIdx].name + " ";
        setInput(completed);
        setShowSuggestions(false);
        updateSuggestions(completed);
      }
      return;
    }

    // Up/Down — navigate suggestions or history
    if (key.upArrow) {
      if (showSuggestions) {
        setSelIdx((i) => Math.max(0, i - 1));
        return;
      }
      // History: cycle back
      if (history.length > 0) {
        const newIdx = historyIdx === -1 ? 0 : Math.min(history.length - 1, historyIdx + 1);
        setHistoryIdx(newIdx);
        setInput(history[newIdx] ?? "");
        updateSuggestions(history[newIdx] ?? "");
      }
      return;
    }

    if (key.downArrow) {
      if (showSuggestions) {
        setSelIdx((i) => Math.min(suggestions.length - 1, i + 1));
        return;
      }
      // History: cycle forward
      if (historyIdx > 0) {
        const newIdx = historyIdx - 1;
        setHistoryIdx(newIdx);
        setInput(history[newIdx] ?? "");
        updateSuggestions(history[newIdx] ?? "");
      } else if (historyIdx === 0) {
        setHistoryIdx(-1);
        setInput("");
        updateSuggestions("");
      }
      return;
    }

    // Backspace/delete
    if (key.backspace || key.delete) {
      const next = effectiveInput.slice(0, -1);
      if (!isControlled) setInput(next);
      updateSuggestions(next);
      return;
    }

    // Escape — cancel suggestions or clear input
    if (key.escape) {
      if (showSuggestions) {
        setShowSuggestions(false);
        return;
      }
      if (effectiveInput) {
        if (!isControlled) setInput("");
        updateSuggestions("");
        return;
      }
      return;
    }

    // Ctrl+C — if input is empty, exit (handled by App)
    if (key.ctrl && value === "c") {
      return;
    }

    // Ctrl+U — clear line
    if (key.ctrl && value === "u") {
      if (!isControlled) setInput("");
      updateSuggestions("");
      return;
    }

    // Ctrl+L — clear screen (handled by App)
    if (key.ctrl && value === "l") {
      return;
    }

    // Regular input
    if (effectiveInput.length < 2000 && value.length === 1 && !key.ctrl && !key.meta) {
      const next = effectiveInput + value;
      if (!isControlled) setInput(next);
      updateSuggestions(next);
      return;
    }
  });

  // Sync from external input
  useEffect(() => {
    if (isControlled) {
      updateSuggestions(externalInput);
    }
  }, [externalInput, isControlled, updateSuggestions]);

  const cursor = cursorVisible ? CURSOR_CHARS[0] : CURSOR_CHARS[1];
  const displayInput = effectiveInput;

  // Group suggestions by category
  const groupedSuggestions = (() => {
    const groups = new Map<CommandCategory, CommandItem[]>();
    for (const cmd of suggestions) {
      const list = groups.get(cmd.category) ?? [];
      list.push(cmd);
      groups.set(cmd.category, list);
    }
    return groups;
  })();

  return (
    <Box flexDirection="column" marginX={1} marginTop={1}>
      {/* Autocomplete dropdown */}
      {showSuggestions && suggestions.length > 0 ? (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={theme.borderActive}
          paddingX={1}
          paddingY={0}
          marginBottom={1}
        >
          {[...categoryOrder].map((cat) => {
            const items = groupedSuggestions.get(cat);
            if (!items || items.length === 0) return null;
            return (
              <Box key={cat} flexDirection="column">
                {/* <Text color={theme.dim} bold>  {cat}</Text> */}
                {items.map((cmd) => {
                  const flatIdx = suggestions.indexOf(cmd);
                  return (
                    <Box key={cmd.id}>
                      <Text color={flatIdx === selIdx ? theme.primary : theme.textDim}>
                        {flatIdx === selIdx ? "▸" : " "}
                      </Text>
                      <Text
                        color={flatIdx === selIdx ? theme.text : theme.textDim}
                      >
                        {" /"}{cmd.name.padEnd(12)}
                      </Text>
                      <Text color={theme.textDim}>{cmd.description}</Text>
                      {cmd.shortcut ? (
                        <Text color={theme.dim}>  [{cmd.shortcut}]</Text>
                      ) : null}
                    </Box>
                  );
                })}
              </Box>
            );
          })}
          <Text color={theme.dim}>
            {suggestions.length > 0
              ? `  ${selIdx + 1}/${suggestions.length} · Tab to complete`
              : "  No matching commands"}
          </Text>
        </Box>
      ) : null}

      {/* Input line */}
      <Box flexDirection="column">
        <Box>
          <Text color={theme.primary}>├── </Text>
          <Text color={theme.primary} bold>❯</Text>
          {displayInput ? (
            <Text color={theme.text}>
              {" "}{displayInput}
              <Text color={theme.primary}>{cursor}</Text>
            </Text>
          ) : (
            <Text color={theme.placeholder}>
              {" "}{cursor}{placeholder}
            </Text>
          )}
        </Box>

        {/* Footer hints */}
        <Box>
          <Text color={theme.primary}>│ </Text>
          <Text color={theme.textDim}>
            Enter send · ↑↓ history · Esc clear · Tab complete · / commands
          </Text>
          {historyIdx >= 0 && history[historyIdx] ? (
            <Text color={theme.dim}>  [history {historyIdx + 1}/{history.length}]</Text>
          ) : null}
        </Box>

        <Text color={theme.primary}>└──</Text>
      </Box>
    </Box>
  );
}
