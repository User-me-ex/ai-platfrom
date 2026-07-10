import { render, type Instance } from "ink";
import { PassThrough } from "stream";
import { App } from "./app";
import type { TuiConfig } from "./app";
import type { Message, Action, ConnectionStatus, TuiView, PermissionMode, ModelInfo, SubmenuItem, ThemeName, Notification, TuiConnection } from "./types";

interface StdinProxy extends PassThrough {
  isTTY: boolean;
  isRaw: boolean;
  setRawMode: (mode: boolean) => void;
  ref: () => void;
  unref: () => void;
}

function createStdinProxy(realStdin: NodeJS.ReadStream): StdinProxy {
  if (typeof (realStdin as any)?.setRawMode === "function") {
    return realStdin as unknown as StdinProxy;
  }

  const proxy = new PassThrough() as StdinProxy;

  Object.defineProperty(proxy, "isTTY", { value: true });
  Object.defineProperty(proxy, "isRaw", { value: false, writable: true });

  proxy.setRawMode = (_mode: boolean) => {
    proxy.isRaw = _mode;
  };

  proxy.ref = () => {};
  proxy.unref = () => {};

  return proxy;
}

function canUseRawMode(): boolean {
  try {
    const s = process.stdin;
    return typeof (s as any)?.setRawMode === "function" && !!s.isTTY;
  } catch {
    return false;
  }
}

export class TuiEngine {
  private instance: Instance | null = null;
  private state: {
    view: TuiView;
    messages: Message[];
    isStreaming: boolean;
    connectionStatus: ConnectionStatus;
    selectedModel: string;
    selectedProvider: string;
    availableModels: ModelInfo[];
    sessionName: string;
    sessionList: { id: string; name: string; model: string; messageCount: number; createdAt: Date; isActive: boolean }[];
    permissionRequest: { id: string; toolName: string; description: string; resolve: (allowed: boolean) => void } | null;
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
  };
  private dispatchQueue: Action[] = [];
  private submitHandler: ((text: string) => void) | null = null;
  private rerender: (() => void) | null = null;
  private stateRef: { current: any };
  private rawMode: boolean;
  private stdinHandler: ((chunk: Buffer) => void) | null = null;
  private connHandler: ((action: "add" | "remove" | "switch", value: any) => void | boolean | Promise<boolean>) | null = null;

  constructor(private config: TuiConfig) {
    this.state = {
      view: "chat",
      messages: [],
      isStreaming: false,
      connectionStatus: "disconnected",
      selectedModel: "",
      selectedProvider: "",
      availableModels: [],
      sessionName: "default",
      sessionList: [],
      permissionRequest: null,
      notifications: [],
      themeName: "dark",
      sidebarOpen: false,
      contextUsage: 0,
      maxContext: 128000,
      costTokens: 0,
      permissionMode: "accept",
      showCommandPalette: false,
      commandPaletteQuery: "",
      submenuItems: [],
      submenuTitle: "",
      submenuOnSelect: "",
      connList: [],
      connActiveName: null,
    };
    this.stateRef = { current: { ...this.state, currentInput: "" } };
    this.rawMode = canUseRawMode();
  }

  onSubmit(handler: (text: string) => void): void {
    this.submitHandler = handler;
  }

  start(): void {
    const dispatch = (action: Action) => {
      this.dispatchQueue.push(action);
      this.processDispatch(action);
    };

    this.syncRef();

    const stdin = createStdinProxy(process.stdin);

    if (!this.rawMode) {
      try { (process.stdin as any).resume?.(); } catch {}

      let lineBuffer = "";
      const onData = (chunk: Buffer) => {
        const str = typeof chunk === "string" ? chunk : chunk.toString();
        for (const ch of str) {
          if (ch === "\r" || ch === "\n") {
            if (lineBuffer.trim()) {
              this.submitHandler?.(lineBuffer.trim());
            }
            lineBuffer = "";
          } else if (ch === "\x7f" || ch === "\b") {
            lineBuffer = lineBuffer.slice(0, -1);
          } else if (ch.charCodeAt(0) >= 32) {
            lineBuffer += ch;
          }
          this.stateRef.current.currentInput = lineBuffer;
          this.scheduleRerender();
        }
      };
      this.stdinHandler = onData;
      process.stdin.on("data", onData);
    }

    this.instance = render(
      <App
        config={this.config}
        stateRef={this.stateRef}
        dispatch={dispatch}
        rawMode={this.rawMode}
        onSendMessage={(text) => {
          this.state.messages.push({
            id: crypto.randomUUID(),
            role: "user",
            content: text,
            timestamp: new Date(),
          });
          this.syncRef();
          this.scheduleRerender();
          this.submitHandler?.(text);
        }}
        onCancelStream={() => {
          this.state.isStreaming = false;
          this.syncRef();
          this.scheduleRerender();
        }}
        onSelectModel={(modelId) => {
          this.state.selectedModel = modelId;
          // Look up the provider from available models
          const modelInfo = this.state.availableModels.find((m) => m.id === modelId);
          if (modelInfo) {
            this.state.selectedProvider = modelInfo.provider;
          }
          this.state.view = "chat";
          this.syncRef();
          this.scheduleRerender();
        }}
        onCloseView={() => {
          this.state.view = "chat";
          this.state.showCommandPalette = false;
          this.syncRef();
          this.scheduleRerender();
        }}
        onNotify={(fn) => {
          this.rerender = fn;
        }}
        onConnAdd={(conn) => {
          this.connHandler?.("add", conn);
        }}
        onConnRemove={(name) => {
          this.connHandler?.("remove", name);
        }}
        onConnSwitch={async (name) => {
          return (await this.connHandler?.("switch", name)) === true;
        }}
      />,
      { stdin: stdin as unknown as NodeJS.ReadStream, alternateScreen: true }
    );
  }

  stop(): void {
    if (this.stdinHandler && typeof (process.stdin as any).off === "function") {
      (process.stdin as any).off("data", this.stdinHandler);
    }
    try { (process.stdin as any).pause?.(); } catch {}
    this.instance?.unmount();
    this.instance?.waitUntilExit();
  }

  clear(): void {
    this.state.messages = [];
    this.syncRef();
    this.scheduleRerender();
  }

  setView(view: import("./types").TuiView): void {
    this.state.view = view;
    this.syncRef();
    this.scheduleRerender();
  }

  setConnectionHandler(handler: (action: "add" | "remove" | "switch", value: any) => void | boolean | Promise<boolean>): void {
    this.connHandler = handler;
  }

  setConnectionData(connections: TuiConnection[], activeName: string | null): void {
    this.state.connList = connections;
    this.state.connActiveName = activeName;
    this.syncRef();
    this.scheduleRerender();
  }

  setConnectionStatus(status: ConnectionStatus): void {
    this.state.connectionStatus = status;
    this.syncRef();
    this.scheduleRerender();
  }

  setSelectedModel(model: string): void {
    this.state.selectedModel = model;
    this.syncRef();
    this.scheduleRerender();
  }

  setSelectedProvider(provider: string): void {
    this.state.selectedProvider = provider;
    this.syncRef();
    this.scheduleRerender();
  }

  setAvailableModels(models: ModelInfo[]): void {
    this.state.availableModels = models;
    this.syncRef();
    this.scheduleRerender();
  }

  setSessionName(name: string): void {
    this.state.sessionName = name;
    this.syncRef();
    this.scheduleRerender();
  }

  setIsStreaming(streaming: boolean): void {
    this.state.isStreaming = streaming;
    this.syncRef();
    this.scheduleRerender();
  }

  setPermissionMode(mode: PermissionMode): void {
    this.state.permissionMode = mode;
    this.syncRef();
    this.scheduleRerender();
  }

  setContextUsage(used: number, max: number): void {
    this.state.contextUsage = used;
    this.state.maxContext = max;
    this.syncRef();
    this.scheduleRerender();
  }

  setCostTokens(tokens: number): void {
    this.state.costTokens = tokens;
    this.syncRef();
    this.scheduleRerender();
  }

  setTheme(theme: ThemeName): void {
    this.state.themeName = theme;
    this.syncRef();
    this.scheduleRerender();
  }

  toggleSidebar(): void {
    this.state.sidebarOpen = !this.state.sidebarOpen;
    this.syncRef();
    this.scheduleRerender();
  }

  addNotification(notification: Notification): void {
    this.state.notifications.push(notification);
    this.syncRef();
    this.scheduleRerender();
  }

  addMessage(msg: Message): void {
    this.state.messages.push(msg);
    this.syncRef();
    this.scheduleRerender();
  }

  updateLastMessage(content: string): void {
    const last = this.state.messages[this.state.messages.length - 1];
    if (last) {
      last.content = content;
      this.syncRef();
      this.scheduleRerender();
    }
  }

  getMessages(): Message[] {
    return this.state.messages;
  }

  clearMessages(): void {
    this.state.messages = [];
    this.syncRef();
    this.scheduleRerender();
  }

  private syncRef(): void {
    const s = this.stateRef.current;
    s.view = this.state.view;
    s.messages = this.state.messages;
    s.isStreaming = this.state.isStreaming;
    s.connectionStatus = this.state.connectionStatus;
    s.selectedModel = this.state.selectedModel;
    s.selectedProvider = this.state.selectedProvider;
    s.availableModels = this.state.availableModels;
    s.sessionName = this.state.sessionName;
    s.sessionList = this.state.sessionList;
    s.permissionRequest = this.state.permissionRequest;
    s.notifications = this.state.notifications;
    s.themeName = this.state.themeName;
    s.sidebarOpen = this.state.sidebarOpen;
    s.contextUsage = this.state.contextUsage;
    s.maxContext = this.state.maxContext;
    s.costTokens = this.state.costTokens;
    s.permissionMode = this.state.permissionMode;
    s.showCommandPalette = this.state.showCommandPalette;
    s.commandPaletteQuery = this.state.commandPaletteQuery;
    s.submenuItems = this.state.submenuItems;
    s.submenuTitle = this.state.submenuTitle;
    s.submenuOnSelect = this.state.submenuOnSelect;
    s.connList = this.state.connList;
    s.connActiveName = this.state.connActiveName;
  }

  private scheduleRerender(): void {
    if (this.rerender) {
      setImmediate(this.rerender);
    }
  }

  private processDispatch(action: Action): void {
    switch (action.type) {
      case "ADD_MESSAGE":
        this.state.messages.push(action.message);
        break;
      case "UPDATE_MESSAGE": {
        const msg = this.state.messages.find((m) => m.id === action.id);
        if (msg) msg.content = action.content;
        break;
      }
      case "STREAM_TOKEN": {
        const last = this.state.messages[this.state.messages.length - 1];
        if (last) last.content += action.token;
        break;
      }
      case "SET_STREAMING":
        this.state.isStreaming = action.isStreaming;
        break;
      case "SET_CONNECTION":
        this.state.connectionStatus = action.status;
        break;
      case "SET_MODEL":
        this.state.selectedModel = action.model;
        break;
      case "SET_PROVIDER":
        this.state.selectedProvider = action.provider;
        break;
      case "SET_MODELS":
        this.state.availableModels = action.models;
        break;
      case "SET_SESSION":
        this.state.sessionName = action.name;
        break;
      case "SET_SESSION_LIST":
        this.state.sessionList = action.sessions;
        break;
      case "SET_PERMISSION":
        this.state.permissionRequest = action.request;
        break;
      case "SET_PERMISSION_MODE":
        this.state.permissionMode = action.mode;
        break;
      case "ADD_NOTIFICATION":
        this.state.notifications.push(action.notification);
        break;
      case "REMOVE_NOTIFICATION": {
        this.state.notifications = this.state.notifications.filter((n) => n.id !== action.id);
        break;
      }
      case "CLEAR_MESSAGES":
        this.state.messages = [];
        break;
      case "SET_VIEW":
        this.state.view = action.view;
        break;
      case "SET_THEME":
        this.state.themeName = action.theme;
        break;
      case "SET_SIDEBAR":
        this.state.sidebarOpen = action.open;
        break;
      case "SET_CONTEXT_USAGE":
        this.state.contextUsage = action.used;
        this.state.maxContext = action.max;
        break;
      case "SET_COST_TOKENS":
        this.state.costTokens = action.tokens;
        break;
      case "SET_COMMAND_PALETTE":
        this.state.showCommandPalette = action.show;
        this.state.commandPaletteQuery = action.query ?? "";
        break;
      case "SET_INPUT":
        break;
    }
    this.syncRef();
    this.scheduleRerender();
  }
}
