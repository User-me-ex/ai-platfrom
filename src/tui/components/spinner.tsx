import { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { Theme } from "../types";

interface SpinnerProps {
  theme: Theme;
  message?: string;
  showTimer?: boolean;
  type?: "dots" | "braille" | "line" | "pulse";
}

const FRAMES: Record<string, string[]> = {
  dots: ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"],
  braille: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  line: ["|", "/", "-", "\\"],
  pulse: ["█", "▓", "▒", "░", "▒", "▓"],
};

export function Spinner({ theme, message = "Thinking", showTimer = true, type = "braille" }: SpinnerProps) {
  const [frame, setFrame] = useState(0);
  const [startTime] = useState(Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const f = (FRAMES[type] ?? FRAMES.braille)!;
    const t = setInterval(() => setFrame((i) => (i + 1) % f.length), 80);
    return () => clearInterval(t);
  }, [type]);

  useEffect(() => {
    if (!showTimer) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(t);
  }, [showTimer, startTime]);

  const elapsedStr = showTimer
    ? ` ${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`
    : "";

  const currentFrames = (FRAMES[type] ?? FRAMES.braille)!;
  return (
    <Box>
      <Text color={theme.primary}>{currentFrames[frame]}</Text>
      <Text color={theme.textDim}> {message}{elapsedStr}</Text>
    </Box>
  );
}

interface ProgressBarProps {
  theme: Theme;
  percent: number;
  width?: number;
  showLabel?: boolean;
}

export function ProgressBar({ theme, percent, width = 20, showLabel = true }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, percent));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);

  return (
    <Box>
      <Text color={theme.primary}>{bar}</Text>
      {showLabel ? <Text color={theme.textDim}> {clamped}%</Text> : null}
    </Box>
  );
}
