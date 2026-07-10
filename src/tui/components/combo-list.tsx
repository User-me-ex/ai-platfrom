import { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Theme, LocalCombo } from "../types";

const DEFAULT_COMBOS: LocalCombo[] = [
  {
    id: "general",
    name: "General Purpose",
    description: "Balanced for everyday coding, chat, and general tasks",
    models: ["gpt-4o", "claude-3.5-sonnet", "gemini-2.0-flash"],
    useCase: "Chat, code review, documentation, Q&A",
    icon: "⚖",
  },
  {
    id: "coding",
    name: "Coding-Focused",
    description: "Optimized for code generation and complex programming tasks",
    models: ["claude-3.5-sonnet", "gpt-4o", "codestral"],
    useCase: "Code generation, debugging, architecture planning",
    icon: "⌨",
  },
  {
    id: "reasoning",
    name: "Deep Reasoning",
    description: "Slow-thinking models for complex problem-solving and analysis",
    models: ["o3-mini", "claude-3.7-sonnet", "deepseek-r1"],
    useCase: "Math, logic, multi-step reasoning, research",
    icon: "🧠",
  },
  {
    id: "fast",
    name: "Lightning Fast",
    description: "Low-latency models for quick responses and simple tasks",
    models: ["gpt-4o-mini", "gemini-2.0-flash-lite", "claude-3.5-haiku"],
    useCase: "Quick answers, summarization, simple edits",
    icon: "⚡",
  },
  {
    id: "creative",
    name: "Creative & Writing",
    description: "Models with strong creative writing and content generation",
    models: ["claude-3.5-sonnet", "gpt-4o", "gemini-2.0-flash"],
    useCase: "Writing, marketing, creative brainstorming, storytelling",
    icon: "✍",
  },
  {
    id: "vision",
    name: "Vision & Multimodal",
    description: "Models with strong image understanding and multimodal capabilities",
    models: ["gpt-4o", "claude-3.5-sonnet", "gemini-2.0-flash"],
    useCase: "Image analysis, chart reading, visual reasoning",
    icon: "👁",
  },
  {
    id: "cost-effective",
    name: "Cost-Effective",
    description: "Best quality-per-dollar ratio, ideal for high-volume usage",
    models: ["gpt-4o-mini", "claude-3.5-haiku", "gemini-2.0-flash-lite"],
    useCase: "High-volume production, cost-sensitive workloads",
    icon: "💰",
  },
];

interface ComboListProps {
  onActivateCombo: (models: string[]) => void;
  onBack: () => void;
  theme: Theme;
}

export { DEFAULT_COMBOS };

const VISIBLE = 6;

export function ComboList({ onActivateCombo, onBack, theme }: ComboListProps) {
  const [cursor, setCursor] = useState(0);
  const [activeCombo, setActiveCombo] = useState<string | null>(null);

  useInput((_input, key) => {
    if (key.escape) { onBack(); return; }
    if (key.return) { const c = DEFAULT_COMBOS[cursor]; if (c) { setActiveCombo(c.id); onActivateCombo(c.models); } return; }
    if (key.upArrow) { setCursor((c) => Math.max(0, c - 1)); return; }
    if (key.downArrow) { setCursor((c) => Math.min(DEFAULT_COMBOS.length - 1, c + 1)); return; }
  });

  const startIdx = Math.max(0, cursor - Math.floor(VISIBLE / 3));
  const visible = DEFAULT_COMBOS.slice(startIdx, startIdx + VISIBLE);

  return (
    <Box flexDirection="column" width={76}>
      <Box marginBottom={1}>
        <Text color={theme.primary}>← </Text>
        <Text color={theme.dim} underline>Back</Text>
        <Text bold color={theme.text}>  Model Combos</Text>
        <Text color={theme.textDim}>  ({DEFAULT_COMBOS.length} presets)</Text>
      </Box>

      <Box flexDirection="column" height={20}>
        {visible.map((combo) => {
          const actualIdx = DEFAULT_COMBOS.indexOf(combo);
          const isHovered = actualIdx === cursor;
          const isActive = activeCombo === combo.id;
          return (
            <Box key={combo.id} paddingX={1} marginBottom={0} flexDirection="column">
              <Box>
                <Text color={isHovered ? theme.primary : "transparent"}>
                  {isHovered ? "▸" : " "}
                </Text>
                <Text color={isActive ? theme.success : isHovered ? theme.text : theme.text}>
                  {" "}{combo.icon} {combo.name}
                </Text>
                {isActive ? <Text color={theme.success}> ✓</Text> : null}
              </Box>
              <Box marginLeft={3}>
                <Text color={theme.textDim}>{combo.description}</Text>
              </Box>
              <Box marginLeft={3}>
                <Text color={theme.info}>{combo.useCase}</Text>
              </Box>
              <Box marginLeft={3}>
                <Text color={theme.dim}>Models: {combo.models.join(", ")}</Text>
              </Box>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text color={theme.textDim}>
          ↑↓ navigate · Enter activate · Esc back
          {DEFAULT_COMBOS.length > VISIBLE
            ? `  (${cursor + 1}–${Math.min(cursor + VISIBLE, DEFAULT_COMBOS.length)} of ${DEFAULT_COMBOS.length})`
            : ""}
        </Text>
      </Box>
    </Box>
  );
}
