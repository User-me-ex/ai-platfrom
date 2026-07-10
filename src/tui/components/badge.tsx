import { Box, Text } from "ink";
import type { Theme } from "../types";

interface BadgeProps {
  label: string;
  color?: string;
  dim?: boolean;
}

export function Badge({ label, color, dim }: BadgeProps) {
  return (
    <Box marginRight={1}>
      <Text color={dim ? "#636D7D" : color ?? "#58A6FF"} bold={!dim}>
        {label}
      </Text>
    </Box>
  );
}

interface ModelBadgeProps {
  capability: string;
  theme: Theme;
}

const capColors: Record<string, string> = {
  text: "#58A6FF",
  vision: "#3FB950",
  audio: "#D29922",
  live: "#BC8CFF",
  tools: "#F85149",
  mcp: "#79C0FF",
  reasoning: "#FF7B72",
};

export function ModelBadge({ capability, theme }: ModelBadgeProps) {
  const color = capColors[capability] ?? theme.dim;
  return <Text color={color} dimColor>{capability.toUpperCase()}</Text>;
}

interface CapabilityBadgeProps {
  label: string;
  theme: Theme;
}

export function CapabilityBadge({ label, theme }: CapabilityBadgeProps) {
  return (
    <Box marginRight={1}>
      <Text color={theme.textDim}>{label}</Text>
    </Box>
  );
}

interface StatusDotProps {
  color: string;
  label?: string;
}

export function StatusDot({ color, label }: StatusDotProps) {
  return (
    <Box marginRight={1}>
      <Text color={color}>●</Text>
      {label ? <Text> {label}</Text> : null}
    </Box>
  );
}
