#!/usr/bin/env node

// 1. EARLY STDOUT GUARD (Must be the very first import and execution)
import { installStdoutGuard, logger } from "./logger.js";
installStdoutGuard();

// 2. Core Dependencies and Configuration
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "./config.js";
import { createMcpServer } from "./mcp/server.js";
import { BridgeWebSocketServer } from "./bridge/wsServer.js";
import { CommandDispatcher } from "./bridge/dispatcher.js";
import { BridgeState } from "./bridge/state.js";
import { startMockBridge, stopMockBridge } from "./mock/index.js";

async function main(): Promise<void> {
  logger.info(`Starting ${config.serverName} v${config.serverVersion}...`);

  // 3. Instantiate Bridge State and Correlated Command Dispatcher
  const dispatcher = new CommandDispatcher();
  const state = new BridgeState();

  // Forward unsolicited bridge events to the state tracker
  dispatcher.on("bridge_event", ({ event, data }) => {
    state.handleBridgeEvent(event, data);
  });

  // 4. Initialize WebSocket Server for Aseprite / Mock Bridge
  logger.info(`Binding WebSocket server to ${config.host}:${config.port}...`);
  const wsServer = new BridgeWebSocketServer(dispatcher, state, {
    host: config.host,
    port: config.port,
    token: config.bridgeToken,
  });
  await wsServer.start();
  logger.info(`WebSocket server active on ws://${config.host}:${config.port}`);

  // Optional: Start in-memory Mock Bridge if requested via environment
  if (process.env.ASEPRITE_MCP_MOCK === "1") {
    logger.info("Starting in-memory Mock Bridge client for headless testing...");
    await startMockBridge({
      host: config.host,
      port: config.port,
      token: config.bridgeToken,
    });
    logger.info("Mock Bridge connected successfully.");
  }

  // 5. Initialize MCP Server and Register Tools
  logger.info("Initializing MCP server...");
  const server = createMcpServer(dispatcher, state);

  // 6. Connect Stdio Transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info(`${config.serverName} connected to stdio transport successfully.`);

  // 7. Graceful Shutdown and Lifecycle Hooks
  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info(`Received ${signal}. Starting graceful shutdown...`);

    try {
      if (process.env.ASEPRITE_MCP_MOCK === "1") {
        await stopMockBridge();
      }
      if (wsServer && typeof wsServer.close === "function") {
        await wsServer.close();
        logger.info("WebSocket server closed.");
      }
      if (server && typeof server.close === "function") {
        await server.close();
        logger.info("MCP server closed.");
      }
    } catch (err) {
      logger.error("Error encountered during graceful shutdown:", err);
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  process.on("uncaughtException", (error: Error) => {
    logger.error("Uncaught exception in server process:", error);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason: unknown) => {
    logger.error("Unhandled promise rejection in server process:", reason);
  });
}

main().catch((err: unknown) => {
  logger.error("Fatal initialization error in main():", err);
  process.exit(1);
});
