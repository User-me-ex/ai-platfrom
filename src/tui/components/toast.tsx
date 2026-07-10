import { useEffect } from "react";
import { Box, Text } from "ink";
import type { Theme, Notification } from "../types";

interface ToastContainerProps {
  theme: Theme;
  notifications: Notification[];
  onDismiss: (id: string) => void;
}

const typeStyles: Record<string, { icon: string; color: string }> = {
  info: { icon: "●", color: "#58A6FF" },
  success: { icon: "✓", color: "#3FB950" },
  error: { icon: "✗", color: "#F85149" },
  warning: { icon: "!", color: "#D29922" },
};

function ToastItem({ theme, notification, onDismiss }: { theme: Theme; notification: Notification; onDismiss: (id: string) => void }) {
  const style = (typeStyles[notification.type] ?? typeStyles.info)!;

  useEffect(() => {
    const dur = notification.duration ?? 4000;
    const t = setTimeout(() => onDismiss(notification.id), dur);
    return () => clearTimeout(t);
  }, [notification.id, notification.duration, onDismiss]);

  return (
    <Box
      borderStyle="round"
      borderColor={theme.border}
      paddingX={1}
      marginBottom={1}
    >
      <Text color={style.color}>{style.icon} </Text>
      <Text color={theme.text}>{notification.message}</Text>
    </Box>
  );
}

export function ToastContainer({ theme, notifications, onDismiss }: ToastContainerProps) {
  if (notifications.length === 0) return null;
  const visible = notifications.slice(-3);
  return (
    <Box position="absolute" right={0} bottom={0} flexDirection="column" minWidth={30}>
      {visible.map((n) => (
        <ToastItem key={n.id} theme={theme} notification={n} onDismiss={onDismiss} />
      ))}
    </Box>
  );
}
