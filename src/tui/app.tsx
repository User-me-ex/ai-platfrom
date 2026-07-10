import { useState, useCallback, useEffect, useMemo, createContext, useContext } from "react";
import { Box, Text, useInput, useWindowSize } from "ink";
import { StatusBar } from "./components/status-bar";
import { ChatView } from "./components/chat-view";
import { InputBox } from "./components/input-box";
import { CommandPalette, Submenu } from "./components/command-palette";
import { Spinner } from "./components/spinner";
import { Sidebar } from "./components/sidebar";
import { ToastContainer } from "./components/toast";
import { ModelPicker } from "./model-picker";
import { SessionList } from "./components/session-list";
import { ConnectView } from "./connect-view";
import { QuotaView } from "./quota-view";
import { StartScreen } from "./start-screen";
import { getTheme, type ThemeName } from "./themes";
import type { TuiView, ConnectionStatus, Message, SessionInfo, PermissionRequest, Notification, Action, CommandItem, ModelInfo, PermissionMode, SubmenuItem, TuiConnection } from "./types";
import { COMMANDS } from "./types";

export interface TuiConfig {
  version: string;
}

interface StateSnapshot {
  view: TuiView;
  messages: Message[];
  currentInput: string;
  isStreaming: boolean;
  connectionStatus: ConnectionStatus;
  selectedModel: string;
  selectedProvider: string;
  availableModels: ModelInfo[];
  sessionName: string;
  sessionList: SessionInfo[];
  permissionRequest: PermissionRequest | null;
  notifications: Notification[];
  themeName: ThemeName;
  sidebarOpen: boolean;
  contextUsage: number;
  maxContext: number;
  costTokens: number;
  permissionMode: PermissionMode;
  showCommandPalette: boolean;
  commandPaletteQuery: string;
  submenuItems: SubmenuItem[];
  submenuTitle: string;
  submenuOnSelect: string;
  connList: TuiConnection[];
  connActiveName: string | null;
}

interface AppProps {
  config: TuiConfig;
  stateRef: { current: StateSnapshot };
  dispatch: (action: Action) => void;
  rawMode: boolean;
  onSendMessage: (text: string) => void;
  onCancelStream: () => void;
  onSelectModel: (model: string) => void;
  onCloseView: () => void;
  onNotify: (fn: () => void) => void;
  onConnAdd: (conn: TuiConnection) => void;
  onConnRemove: (name: string) => void;
  onConnSwitch: (name: string) => Promise<boolean>;
}

export const ThemeCtx = createContext<ReturnType<typeof getTheme> | null>(null);
export const useTheme = () => useContext(ThemeCtx) ?? getTheme("dark");

export function App({ config, stateRef: { current: state }, dispatch, rawMode, onSendMessage, onCancelStream, onSelectModel, onCloseView, onNotify, onConnAdd, onConnRemove, onConnSwitch }: AppProps) {
  const [, forceRender] = useState(0);
  const { rows: winHeight, columns: winWidth } = useWindowSize();

  const rerender = useCallback(() => {
    forceRender((n) => n + 1);
  }, []);

  useEffect(() => {
    onNotify(rerender);
  }, [rerender, onNotify]);

  const theme = useMemo(() => getTheme(state.themeName || "dark"), [state.themeName]);

  const height = winHeight ?? 24;
  const width = winWidth ?? 80;
  const statusBarHeight = 1;
  const inputBoxHeight = 4;
  const contentHeight = height - statusBarHeight - inputBoxHeight - 1;
  const sidebarWidth = state.sidebarOpen ? 28 : 0;
  const mainWidth = width - sidebarWidth;

  useInput((input, key) => {
    if (!rawMode) return;

    if (key.ctrl && input === "c") {
      if (state.isStreaming) onCancelStream();
      else process.exit(0);
      return;
    }

    if (key.ctrl && input === "k") {
      dispatch({ type: "SET_COMMAND_PALETTE", show: true });
      return;
    }

    if (key.ctrl && input === "p") {
      if (state.availableModels.length > 0) {
        dispatch({ type: "SET_VIEW", view: "model-picker" });
      }
      return;
    }

    if (key.ctrl && input === "q") {
      dispatch({ type: "SET_VIEW", view: "quota" });
      return;
    }

    if (key.ctrl && input === "l") {
      dispatch({ type: "SET_VIEW", view: "help" });
      return;
    }

    if (key.ctrl && input === "t") {
      const themes: ThemeName[] = ["dark", "light", "oled", "dracula", "nord", "catppuccin", "tokyo-night", "gruvbox"];
      const idx = Math.max(0, themes.indexOf(state.themeName ?? "dark"));
      const next: ThemeName = themes[(idx + 1) % themes.length] ?? "dark";
      dispatch({ type: "SET_THEME", theme: next });
      dispatch({ type: "ADD_NOTIFICATION", notification: { id: crypto.randomUUID(), message: `Theme: ${next}`, type: "info", timestamp: new Date(), duration: 1500 } });
      return;
    }

    if (key.ctrl && input === "r") {
      dispatch({ type: "SET_VIEW", view: "session-list" });
      return;
    }

    if (key.ctrl && input === "m") {
      dispatch({ type: "SET_VIEW", view: "model-picker" });
      return;
    }

    if (key.ctrl && input === "/") {
      dispatch({ type: "SET_VIEW", view: "help" });
      return;
    }

    if (key.ctrl && input === "b") {
      dispatch({ type: "SET_SIDEBAR", open: !state.sidebarOpen });
      return;
    }

    if (key.escape) {
      if (state.view === "model-picker") {
        return;
      }
      if (state.view !== "chat" && state.view !== "start") {
        onCloseView();
      }
      return;
    }

    if (state.view === "help") {
      if (key.escape) {
        dispatch({ type: "SET_VIEW", view: "chat" });
      }
      return;
    }
  });

  const handleSubmit = useCallback((text: string) => {
    onSendMessage(text);
  }, [onSendMessage]);

  const handleCommandSelect = useCallback((cmd: CommandItem) => {
    if (cmd.submenu) {
      dispatch({ type: "SET_VIEW", view: "submenu" });
    } else {
      onSendMessage(`/${cmd.name}`);
      dispatch({ type: "SET_COMMAND_PALETTE", show: false });
    }
  }, [onSendMessage, dispatch]);

  const handleSubmenuSelect = useCallback((id: string) => {
    onSendMessage(`/${id}`);
    dispatch({ type: "SET_VIEW", view: "chat" });
  }, [onSendMessage, dispatch]);

  const handleDismissNotification = useCallback((id: string) => {
    dispatch({ type: "REMOVE_NOTIFICATION", id });
  }, [dispatch]);

  const renderOverlay = () => {
    switch (state.view) {
      case "start":
        return (
          <StartScreen
            connectionStatus={state.connectionStatus}
            version={config.version}
            modelsCount={state.availableModels.length}
            defaultModel={state.selectedModel}
            theme={theme}
          />
        );
      case "model-picker":
        return (
          <ModelPicker
            models={state.availableModels}
            selectedModel={state.selectedModel}
            onSelect={onSelectModel}
            onClose={onCloseView}
            theme={theme}
          />
        );
      case "quota":
        return (
          <QuotaView
            theme={theme}
            models={state.availableModels}
            selectedModel={state.selectedModel}
            contextUsage={state.contextUsage}
            maxContext={state.maxContext}
            costTokens={state.costTokens}
            messagesCount={state.messages.length}
            onClose={onCloseView}
          />
        );
      case "connect":
        return (
          <ConnectView
            theme={theme}
            connections={state.connList}
            activeName={state.connActiveName}
            onAdd={onConnAdd}
            onRemove={onConnRemove}
            onSwitch={onConnSwitch}
            onClose={onCloseView}
          />
        );
      default:
        return null;
    }
  };

  return (
    <ThemeCtx.Provider value={theme}>
      <Box flexDirection="column" width={width}>
        {renderOverlay() ? (
          renderOverlay()
        ) : (
          <Box flexDirection="row" width={width}>
            {state.sidebarOpen ? (
              <Sidebar
                theme={theme}
                sessionName={state.sessionName}
                sessionList={state.sessionList}
                selectedModel={state.selectedModel}
                selectedProvider={state.selectedProvider}
                messageCount={state.messages.length}
                isOpen={true}
                onClose={() => dispatch({ type: "SET_SIDEBAR", open: false })}
              />
            ) : null}

            <Box flexDirection="column" width={mainWidth}>
              <ChatView
                theme={theme}
                messages={state.messages}
                isStreaming={state.isStreaming}
                height={contentHeight}
              />

              {state.isStreaming ? (
                <Box paddingLeft={1} paddingRight={1} marginBottom={1}>
                  <Spinner theme={theme} message="Generating response" showTimer type="braille" />
                </Box>
              ) : (
                <InputBox
                  theme={theme}
                  commands={COMMANDS}
                  onSubmit={handleSubmit}
                  placeholder="Type a message... (/help for commands)"
                  disabled={state.isStreaming}
                  rawMode={rawMode}
                  externalInput={state.currentInput}
                />
              )}

              <StatusBar
                theme={theme}
                connectionStatus={state.connectionStatus}
                selectedModel={state.selectedModel}
                selectedProvider={state.selectedProvider}
                sessionName={state.sessionName}
                messageCount={state.messages.length}
                isStreaming={state.isStreaming}
                contextUsage={state.contextUsage}
                maxContext={state.maxContext}
                costTokens={state.costTokens}
                permissionMode={state.permissionMode}
                sidebarOpen={state.sidebarOpen}
              />
            </Box>
          </Box>
        )}

        {state.showCommandPalette ? (
          <Box position="absolute" width={width}>
            <CommandPalette
              theme={theme}
              commands={COMMANDS}
              query={state.commandPaletteQuery}
              onSelect={handleCommandSelect}
              onClose={() => dispatch({ type: "SET_COMMAND_PALETTE", show: false })}
              onQueryChange={(q) => dispatch({ type: "SET_COMMAND_PALETTE", show: true, query: q })}
            />
          </Box>
        ) : null}

        {state.view === "submenu" && state.submenuItems.length > 0 ? (
          <Box position="absolute" width={width}>
            <Submenu
              theme={theme}
              title={state.submenuTitle}
              items={state.submenuItems}
              onSelect={handleSubmenuSelect}
              onClose={() => dispatch({ type: "SET_VIEW", view: "chat" })}
            />
          </Box>
        ) : null}

        {state.view === "session-list" ? (
          <Box position="absolute" width={width}>
            <SessionList
              sessions={state.sessionList}
              activeName={state.sessionName}
              onSelect={(name) => {
                dispatch({ type: "SET_SESSION", name });
                dispatch({ type: "SET_VIEW", view: "chat" });
              }}
              onClose={() => dispatch({ type: "SET_VIEW", view: "chat" })}
              theme={theme}
            />
          </Box>
        ) : null}

        {state.view === "help" ? (
          <Box position="absolute" width={width}>
            <HelpOverlay theme={theme} onClose={() => dispatch({ type: "SET_VIEW", view: "chat" })} />
          </Box>
        ) : null}

        <ToastContainer
          theme={theme}
          notifications={state.notifications}
          onDismiss={handleDismissNotification}
        />
      </Box>
    </ThemeCtx.Provider>
  );
}

function HelpOverlay({ theme }: { theme: ReturnType<typeof getTheme>; onClose: () => void }) {
  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" width="100%">
      <Box flexDirection="column" borderStyle="round" borderColor={theme.borderActive} padding={1} width={64}>
        <Box marginBottom={1}>
          <Text bold color={theme.primary}>Help & Commands</Text>
        </Box>
        <Box flexDirection="column">
          <Text color={theme.dim} bold>Keyboard Shortcuts</Text>
          {[
            ["Ctrl+K", "Command Palette"],
            ["Ctrl+P", "Model Picker"],
            ["Ctrl+Q", "Quota & Usage"],
            ["Ctrl+T", "Cycle Theme"],
            ["Ctrl+L", "Help"],
            ["Ctrl+R", "Recent Sessions"],
            ["Ctrl+B", "Toggle Sidebar"],
            ["Ctrl+/", "Help Overlay"],
            ["Esc", "Close / Cancel"],
            ["Tab", "Autocomplete"],
            ["↑↓", "Navigate"],
          ].map(([k, desc]) => (
            <Box key={k ?? ""} marginLeft={1}>
              <Text color={theme.primary}>{(k ?? "").padEnd(10)}</Text>
              <Text color={theme.text}>{desc}</Text>
            </Box>
          ))}
          <Box marginTop={1}>
            <Text color={theme.dim} bold>Slash Commands</Text>
          </Box>
          {COMMANDS.map((cmd) => (
            <Box key={cmd.id} marginLeft={1}>
              <Text color={theme.primary}>/{cmd.id.padEnd(14)}</Text>
              <Text color={theme.textDim}>{cmd.description}</Text>
            </Box>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text color={theme.textDim}>Esc to close</Text>
        </Box>
      </Box>
    </Box>
  );
}
