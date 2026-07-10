/**
 * 9 Router CLI — Main CLI Loop
 *
 * Initializes all subsystems and runs the main REPL (Read-Eval-Print Loop).
 */

import chalk from "chalk";

import { CommandRegistry } from "./commands/index";
import { CliRenderer } from "./render/index";
import { ConfigManager } from "./config/manager";
import { NineRouterClient } from "./router/client";
import { ConnectionManager } from "./router/connections";
import { ModelRegistry } from "./router/models";
import { ChatEngineImpl } from "./chat/engine";
import { SessionManagerImpl } from "./session/manager";
import { PluginManager } from "./plugins/manager";
import { createLogger } from "./logging/logger";
import { createBuiltinCommands } from "./commands/commands";
import { TuiEngine } from "./tui/engine";

import { eventBus } from "./core/events";
import { APP_DISPLAY_NAME } from "./core/constants";
import { join, resolve } from "path";

// Skills architecture
import { SkillEngine, SkillInstaller, ArchitectureInspector } from "./skills/index";
import { createSkillsCommand } from "./commands/skills-cmd";
import { createEvolveCommand } from "./commands/evolve-cmd";
import { createConnectCommand } from "./commands/connect-cmd";

// New subsystems
import { MemoryManager } from "./memory/index";
import { SecurityManager } from "./security/index";
import { AutomationManager } from "./automation/index";
import { AutonomousSkillManager } from "./skills/autonomous";
import { OrchestratorManager } from "./orchestrator/index";
import { WebManager } from "./web/index";
import { PersonaManager } from "./personas/index";
import { GatewayManager } from "./gateways/index";
import { CONFIG_DIR_NAME, SKILLS_DIR } from "./core/constants";

// Performance subsystems
import { PerformanceOrchestrator } from "./performance/index";
import { createPerformanceCommand } from "./commands/performance-cmd";

// New subsystem commands
import { createMemoryCommand } from "./commands/memory-cmd";
import { createSecurityCommand } from "./commands/security-cmd";
import { createCronCommand } from "./commands/cron-cmd";
import { createWebCommand } from "./commands/web-cmd";
import { createPersonaCommand } from "./commands/persona-cmd";
import { createOrchestrateCommand } from "./commands/orchestrate-cmd";
import { createGatewayCommand } from "./commands/gateway-cmd";

export class App {
  // Core systems
  config: ConfigManager;
  router: NineRouterClient;
  connections: ConnectionManager;
  models: ModelRegistry;
  chat: ChatEngineImpl;
  session: SessionManagerImpl;
  renderer: CliRenderer;
  plugins: PluginManager;
  tui: TuiEngine;
  logger: ReturnType<typeof createLogger>;
  commands: CommandRegistry;

  // Skills architecture
  skillEngine: SkillEngine;
  skillInstaller: SkillInstaller;
  architectureInspector: ArchitectureInspector;

  // New subsystems
  memory: MemoryManager;
  security: SecurityManager;
  automation: AutomationManager;
  autonomousSkills: AutonomousSkillManager;
  orchestrator: OrchestratorManager;
  web: WebManager;
  personas: PersonaManager;
  gateways: GatewayManager;

  // Performance subsystems
  performance: PerformanceOrchestrator;

  // State
  private running = true;
  private configDir: string;

  constructor() {
    // Initialize in dependency order
    this.config = new ConfigManager();
    this.logger = createLogger(this.config.get().logging.level);
    this.configDir = this.getConfigDir();

    this.router = new NineRouterClient(
      this.config.get().baseUrl,
      this.config.get().apiKey
    );
    this.connections = new ConnectionManager(this.router, this.config, this.logger);

    this.models = new ModelRegistry(this.router, this.config.get().modelRefreshInterval);
    this.chat = new ChatEngineImpl(this.router, this.models);
    this.session = new SessionManagerImpl();
    this.renderer = new CliRenderer(this.config.get().theme);
    this.tui = new TuiEngine({ version: "0.1.0" });
    this.commands = new CommandRegistry();
    this.plugins = new PluginManager(this.router, this.session, this.logger);

    // Skills architecture
    this.skillEngine = new SkillEngine(this.logger);
    this.architectureInspector = new ArchitectureInspector();
    this.skillInstaller = new SkillInstaller(this.skillEngine, this.logger);

    // New subsystems
    this.memory = new MemoryManager(this.configDir, eventBus);
    this.security = new SecurityManager(eventBus);
    this.automation = new AutomationManager(eventBus);
    this.autonomousSkills = new AutonomousSkillManager(this.configDir, eventBus);
    this.orchestrator = new OrchestratorManager(eventBus);
    this.web = new WebManager(this.configDir, eventBus);
    this.personas = new PersonaManager(this.configDir, eventBus);
    this.gateways = new GatewayManager(eventBus);

    // Performance subsystems
    this.performance = new PerformanceOrchestrator(this.configDir, resolve(process.cwd()), eventBus);

    // Register commands
    this.registerCommands();

    // Set up keybinding handlers
    this.setupKeybindings();

    // Set up event bus listeners
    this.setupEventListeners();
  }

  private getTuiModels(): import("./tui/types").ModelInfo[] {
    return this.models.listModels().map((m) => {
      const caps: Array<"vision" | "audio" | "tools" | "reasoning"> = [];
      if (m.capabilities?.vision) caps.push("vision");
      if (m.capabilities?.audio) caps.push("audio");
      if (m.capabilities?.toolUse) caps.push("tools");
      if (m.capabilities?.reasoning) caps.push("reasoning");
      return {
        id: m.id,
        name: m.name || m.id,
        provider: m.provider || "",
        providerDisplayName: m.providerDisplayName || m.provider || "",
        capabilities: caps,
        contextWindow: m.contextLength || 4096,
        speed: "",
        cost: m.pricing ? `$${m.pricing.input}/M in · $${m.pricing.output}/M out` : "",
      };
    });
  }

  /** Main entry point — initialize and run */
  async run(): Promise<void> {
    const connected = await this.initialize();
    this.showStartup(connected);

    // Enter REPL regardless of connection status
    await this.replLoop();

    await this.shutdown();
  }

  /** Initialize connections and load data */
  private async initialize(): Promise<boolean> {
    try {
      const connected = await this.router.ping();

      if (connected) {
        await this.models.refreshModels();
        this.models.startAutoRefresh();

        const defaultModel = this.config.get().defaultModel;
        if (defaultModel && this.models.getModel(defaultModel)) {
          this.chat.setModel(defaultModel);
        } else if (this.models.count > 0) {
          const firstModel = this.models.listModels()[0];
          if (firstModel) {
            this.chat.setModel(firstModel.id);
          }
        }

        const config = this.config.get();
        await this.plugins.loadPlugins(config.plugins.enabled);

        const skillsLoaded = await this.skillEngine.discoverSkills(
          join(process.cwd(), SKILLS_DIR)
        );
        if (skillsLoaded > 0) {
          this.logger.info(`Auto-loaded ${skillsLoaded} skill(s) from ${SKILLS_DIR}/`);
        }

        eventBus.emit("router:connected");
        return true;
      }

      this.logger.warn("9 Router not detected — entering offline mode");
      eventBus.emit("router:disconnected");
      return false;
    } catch (error) {
      this.logger.error("Initialization error:", error);
      return false;
    }
  }

  /** Show the startup banner */
  private showStartup(connected?: boolean): void {
    console.clear();

    const activeConn = this.connections.active();
    this.tui.setConnectionStatus(connected ? "connected" : "disconnected");
    const tuiModels = this.getTuiModels();
    this.tui.setAvailableModels(tuiModels);
    this.tui.setSelectedModel(this.chat.currentModel || "");
    // Set the initial provider based on the current model
    if (this.chat.currentModel) {
      const currentModelInfo = tuiModels.find((m) => m.id === this.chat.currentModel);
      if (currentModelInfo) {
        this.tui.setSelectedProvider(currentModelInfo.provider);
      }
    }
    this.tui.setSessionName(activeConn?.name ?? "local");
    this.tui.setConnectionData(
      this.connections.list().map((c) => ({ name: c.name, baseUrl: c.baseUrl, apiKey: c.apiKey })),
      this.connections.getActiveName()
    );
    this.tui.setConnectionHandler((action, value) => {
      if (action === "add") { this.connections.add(value); return; }
      if (action === "remove") { this.connections.remove(value); }
      if (action === "switch") { return this.connections.switch(value); }
      this.tui.setConnectionData(
        this.connections.list().map((c) => ({ name: c.name, baseUrl: c.baseUrl, apiKey: c.apiKey })),
        this.connections.getActiveName()
      );
    });
    this.tui.start();
  }

  /** The main read-eval-print loop */
  private async replLoop(): Promise<void> {
    const pingResult = await this.router.ping();
    if (pingResult) {
      this.tui.setConnectionStatus("connected");
    }

    this.tui.onSubmit((text: string) => {
      this.processInput(text);
    });

    while (this.running) {
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
    }
  }

  /** Process a line of user input */
  private async processInput(input: string): Promise<void> {
    if (input.startsWith("/")) {
      await this.processCommand(input);
      return;
    }

    if (!this.chat.currentModel) {
      this.tui.addMessage({
        id: crypto.randomUUID(),
        role: "system",
        content: "No model selected. Use /model <model-id> to select one.",
        timestamp: new Date(),
      });
      return;
    }

    try {
      await this.sendChatMessage(input);
    } catch (error) {
      this.logger.error("Chat error:", error);
      this.tui.addMessage({
        id: crypto.randomUUID(),
        role: "system",
        content: `✗ ${error instanceof Error ? error.message : "An error occurred"}`,
        timestamp: new Date(),
      });
    }
  }

/** Send a chat message and stream response through TUI */
private sessionTokensIn = 0;
private sessionTokensOut = 0;

private async sendChatMessage(content: string): Promise<void> {
  const msgId = crypto.randomUUID();
  const aiMsgId = crypto.randomUUID();

  // Add user message to TUI
  this.tui.addMessage({
    id: msgId,
    role: "user",
    content,
    timestamp: new Date(),
  });

  // Create empty assistant message for streaming
  this.tui.addMessage({
    id: aiMsgId,
    role: "assistant",
    content: "",
    timestamp: new Date(),
    isStreaming: true,
  });

  this.tui.setIsStreaming(true);
  let fullContent = "";

  try {
    await this.chat.sendMessage(content, (event) => {
      switch (event.type) {
        case "text":
          fullContent += event.content;
          this.tui.updateLastMessage(fullContent);
          break;

        case "thinking":
          break;

        case "done":
          this.tui.setIsStreaming(false);
          this.tui.updateLastMessage(fullContent);
          const msgs = this.tui.getMessages();
          const aiMsg = msgs.find((m) => m.id === aiMsgId);
          if (aiMsg) {
            aiMsg.isStreaming = false;
            if (event.usage) {
              aiMsg.tokensIn = event.usage.input;
              aiMsg.tokensOut = event.usage.output;
              this.sessionTokensIn += event.usage.input;
              this.sessionTokensOut += event.usage.output;
              this.tui.setContextUsage(this.sessionTokensIn, this.sessionTokensIn + this.sessionTokensOut);
              this.tui.setCostTokens(this.sessionTokensOut);
            }
          }
          break;

        case "error":
          this.tui.setIsStreaming(false);
          this.tui.updateLastMessage(`Error: ${event.message}`);
          break;
      }
    });
  } catch (error) {
    this.tui.setIsStreaming(false);
    if (error instanceof Error && error.name === "AbortError") {
      this.tui.addMessage({
        id: crypto.randomUUID(),
        role: "system",
        content: "Stream aborted.",
        timestamp: new Date(),
      });
    } else {
      throw error;
    }
  }
}

/** Process a slash command — capture output and show in TUI */
private async processCommand(input: string): Promise<void> {
  const parts = input.slice(1).split(/\s+/);
  const cmdName = parts[0]!;
  const args = parts.slice(1);

  eventBus.emit("command:before", cmdName);

  // Route to TUI overlays for interactive commands
  if (cmdName === "model" && args.length === 0) {
    if (this.models.count > 0) {
      this.tui.setAvailableModels(this.getTuiModels());
      this.tui.setView("model-picker");
    }
    return;
  }

  if (cmdName === "connect" && args.length === 0) {
    this.tui.setView("connect");
    return;
  }

  // Capture console.log output during command execution
  const lines: string[] = [];
  const origLog = console.log;
  console.log = (...msgs: unknown[]) => {
    const line = msgs.map((m) => String(m)).join(" ");
    lines.push(line);
    origLog(...msgs);
  };

    try {
      await this.commands.execute(cmdName, args, {
        config: this.config.get(),
        chat: this.chat,
        router: this.router,
        session: this.session,
        renderer: this.renderer,
        logger: this.logger,
        modelRegistry: this.models,
      });

    // Handle special exit commands
    if (cmdName === "exit" || cmdName === "quit") {
      this.running = false;
    }

    // Show command output in TUI
    if (lines.length > 1 || (lines.length === 1 && !lines[0]?.startsWith("✓") && !lines[0]?.startsWith("●"))) {
      this.tui.addMessage({
        id: crypto.randomUUID(),
        role: "system",
        content: `/${cmdName} ${args.join(" ")}\n${lines.join("\n")}`,
        timestamp: new Date(),
      });
    }
  } catch (error) {
    const errMsg = `✗ ${error instanceof Error ? error.message : "Command error"}`;
    lines.push(errMsg);
    this.tui.addMessage({
      id: crypto.randomUUID(),
      role: "system",
      content: `/${cmdName} ${args.join(" ")}\n${errMsg}`,
      timestamp: new Date(),
    });
  } finally {
    console.log = origLog;
  }

  eventBus.emit("command:after", cmdName);
}

  /** Register all built-in commands */
  private registerCommands(): void {
    // Note: commands are already registered in CommandRegistry constructor
    // Here we override them with actual implementations
    const cmds = createBuiltinCommands(this.commands);
    for (const cmd of cmds) {
      this.commands.register(cmd);
    }

    // Register skills commands
    this.commands.register(createSkillsCommand(this.skillEngine, this.skillInstaller));
    this.commands.register(createEvolveCommand(this.skillEngine, this.skillInstaller, this.architectureInspector));

    // Register connection management command
    this.commands.register(createConnectCommand(this.connections));

    // Register new subsystem commands
    this.commands.register(createMemoryCommand(this.memory));
    this.commands.register(createSecurityCommand(this.security));
    this.commands.register(createCronCommand(this.automation));
    this.commands.register(createWebCommand(this.web));
    this.commands.register(createPersonaCommand(this.personas));
    this.commands.register(createOrchestrateCommand(this.orchestrator));
    this.commands.register(createGatewayCommand(this.gateways));

    // Register performance command
    this.commands.register(createPerformanceCommand(this.performance));
  }

  /** Set up keyboard shortcut handlers */
  private setupKeybindings(): void {
    // onSubmit is set in replLoop() to pass user input to processInput
  }

  /** Set up event bus listeners */
  private setupEventListeners(): void {
    eventBus.on("model:changed", (modelId) => {
      this.config.setValue("defaultModel", modelId);
      this.config.save();
      // Update TUI display so the status bar reflects the new model and provider
      this.tui.setSelectedModel(modelId as string);
      const tuiModels = this.getTuiModels();
      const modelInfo = tuiModels.find((m) => m.id === modelId);
      if (modelInfo) {
        this.tui.setSelectedProvider(modelInfo.provider);
      }
    });

    eventBus.on("router:error", (error) => {
      this.logger.error("Router error:", error);
    });

    eventBus.on("error", (error) => {
      this.logger.error("Unhandled error:", error);
    });

    // Performance event listeners
    eventBus.on("perf:memory:high", (heapMB) => {
      this.logger.warn(`High memory usage: ${(heapMB as number).toFixed(0)}MB`);
      this.performance.memory.suggestGC();
    });

    // File system events
    eventBus.on("perf:filesystem:file:changed", (_filePath) => {
      void this.performance.fileSystem.indexer.incrementalIndex();
    });
  }

  private getConfigDir(): string {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
    const platform = process.platform;
    const base = platform === "win32" ? join(home, "AppData", "Roaming") : join(home, ".config");
    return join(base, CONFIG_DIR_NAME);
  }

  /** Graceful shutdown */
  private async shutdown(): Promise<void> {
    this.models.stopAutoRefresh();
    this.router.cancelRequest();
    this.config.save();
    this.performance.dispose();

    console.log(chalk.dim(`\n${APP_DISPLAY_NAME} stopped.`));
    process.exit(0);
  }
}
