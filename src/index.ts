#!/usr/bin/env bun
/**
 * 9 Router CLI — Entry Point
 *
 * Bootstraps the application, handles CLI arguments, and starts the main loop.
 */

import { App } from "./cli";
import { BIN_NAME } from "./core/constants";

async function main() {
  const args = process.argv.slice(2);

  // Handle version flag
  if (args.includes("--version") || args.includes("-v")) {
    const version = "0.1.0";
    console.log(`${BIN_NAME} v${version}`);
    process.exit(0);
  }

  // Handle help flag
  if (args.includes("--help") || args.includes("-h")) {
    showHelp();
    process.exit(0);
  }

  // Handle single-shot command mode
  // e.g., 9r "what is the weather?" -m gpt-4o
  if (args.length > 0 && !args[0]!.startsWith("-")) {
    await runSingleShot(args);
    return;
  }

  // Start interactive mode
  try {
    const app = new App();
    await app.run();
  } catch (error) {
    console.error("Fatal error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/** Run a single-shot query and exit */
async function runSingleShot(args: string[]): Promise<void> {
  const { NineRouterClient } = await import("./router/client");
  const { ConfigManager } = await import("./config/manager");
  const { ModelRegistry } = await import("./router/models");
  const { ChatEngineImpl } = await import("./chat/engine");

  const config = new ConfigManager();
  const router = new NineRouterClient(config.get().baseUrl, config.get().apiKey);
  const models = new ModelRegistry(router);

  // Parse flags
  let modelId = config.get().defaultModel;
  let message: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "-m" || arg === "--model") {
      modelId = args[++i] ?? "";
    } else {
      message.push(arg);
    }
  }

  // Refresh models to find the specified model
  try {
    await models.refreshModels();
  } catch {
    // Continue with cached models
  }

  if (!modelId && models.count > 0) {
    modelId = models.listModels()[0]?.id ?? "";
  }

  if (!modelId) {
    console.error("No model available. Is 9 Router running?");
    process.exit(1);
  }

  const chat = new ChatEngineImpl(router, models);
  chat.startChat(modelId);

  const query = message.join(" ");
  if (!query) {
    console.error("Usage: 9r <message> [-m <model>]");
    process.exit(1);
  }

  try {
    const response = await chat.sendMessage(query);
    console.log(response);
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  process.exit(0);
}

/** Show CLI help */
function showHelp(): void {
  console.log(`${BIN_NAME} — AI CLI for 9 Router`);
  console.log("");
  console.log("Usage:");
  console.log(`  ${BIN_NAME}                  Start interactive mode`);
  console.log(`  ${BIN_NAME} <message>        Send a single message`);
  console.log(`  ${BIN_NAME} <message> -m <model>  Send with a specific model`);
  console.log(`  ${BIN_NAME} --help           Show this help`);
  console.log(`  ${BIN_NAME} --version        Show version`);
  console.log("");
  console.log("Interactive Commands:");
  console.log("  /chat <msg>     Start or continue a conversation");
  console.log("  /model [id]     Switch model");
  console.log("  /models         List all available models");
  console.log("  /new            Start a new conversation");
  console.log("  /history        View conversation history");
  console.log("  /clear          Clear screen");
  console.log("  /help           Show help");
  console.log("  /config         View/set configuration");
  console.log("  /status         Show connection status");
  console.log("  /exit           Exit");
  console.log("");
  console.log("For more information, visit https://9router.com");
}

// Run the application
main().catch((error) => {
  console.error("Fatal error:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
