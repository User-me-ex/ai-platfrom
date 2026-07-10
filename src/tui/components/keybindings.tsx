import { Box, Text } from "ink";
import type { Theme } from "../types";

export interface KeyBinding {
  keys: string;
  description: string;
}

interface KeybindingsProps {
  theme: Theme;
  bindings: KeyBinding[];
}

export function Keybindings({ theme, bindings }: KeybindingsProps) {
  return (
    <Box flexDirection="row" gap={2}>
      {bindings.map((b, i) => (
        <Box key={i}>
          <Text color={theme.textDim}>· </Text>
          <Text color={theme.textDim}>{b.keys} </Text>
          <Text color={theme.dim}>{b.description}</Text>
        </Box>
      ))}
    </Box>
  );
}
