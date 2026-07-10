import { Box, Text } from "ink";
import type { Theme } from "../types";

interface DialogProps {
  theme: Theme;
  title: string;
  width?: number;
  height?: number;
  children: React.ReactNode;
  footer?: string;
  onClose?: () => void;
}

export function Dialog({ theme, title, width = 60, height, children, footer }: DialogProps) {
  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" width="100%">
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.borderActive}
        padding={1}
        width={width}
        height={height}
      >
        <Box marginBottom={1}>
          <Text bold color={theme.primary}>{title}</Text>
        </Box>
        <Box flexDirection="column">
          {children}
        </Box>
        {footer ? (
          <Box marginTop={1}>
            <Text color={theme.textDim}>{footer}</Text>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}
