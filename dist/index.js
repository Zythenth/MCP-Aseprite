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
const BRIDGE_RETRY_DELAY_MS = 2_000;
function isAddressInUse(error) {
    return (typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "EADDRINUSE");
}
async function main() {
    logger.info(`Starting ${config.serverName} v${config.serverVersion}...`);
    // 3. Instantiate Bridge State and Correlated Command Dispatcher
    const dispatcher = new CommandDispatcher();
    const state = new BridgeState();
    // Forward unsolicited bridge events to the state tracker
    dispatcher.on("bridge_event", ({ event, data }) => {
        state.handleBridgeEvent(event, data);
    });
    // 4. Initialize MCP Server before binding the bridge port. This guarantees that
    // a client can obtain aseprite_status and the actionable port-conflict state.
    logger.info("Initializing MCP server...");
    const server = createMcpServer(dispatcher, state);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info(`${config.serverName} connected to stdio transport successfully.`);
    // 5. Bridge startup retries only for a local port conflict. A stale standalone
    // server no longer hides every MCP tool from the client, and releasing its port
    // lets this client recover without a restart.
    let wsServer = null;
    let retryTimer = null;
    let mockBridgeStarted = false;
    let isShuttingDown = false;
    const startBridge = async () => {
        if (isShuttingDown || wsServer)
            return;
        logger.info(`Binding WebSocket server to ${config.host}:${config.port}...`);
        const candidate = new BridgeWebSocketServer(dispatcher, state, {
            host: config.host,
            port: config.port,
            token: config.bridgeToken,
        });
        try {
            await candidate.start();
            wsServer = candidate;
            state.setConnectionIssue(null);
            logger.info(`WebSocket server active on ws://${config.host}:${config.port}`);
            if (process.env.ASEPRITE_MCP_MOCK === "1" && !mockBridgeStarted) {
                logger.info("Starting in-memory Mock Bridge client for headless testing...");
                await startMockBridge({
                    host: config.host,
                    port: config.port,
                    token: config.bridgeToken,
                });
                mockBridgeStarted = true;
                logger.info("Mock Bridge connected successfully.");
            }
        }
        catch (error) {
            if (!isAddressInUse(error))
                throw error;
            state.setConnectionIssue(`The Aseprite bridge port ${config.port} is owned by another aseprite-mcp process. Stop the standalone process (for example start.ps1) and this MCP client will retry automatically.`);
            logger.error(`Bridge port ${config.port} is occupied; retrying in ${BRIDGE_RETRY_DELAY_MS}ms.`);
            if (!retryTimer && !isShuttingDown) {
                retryTimer = setTimeout(() => {
                    retryTimer = null;
                    void startBridge().catch((retryError) => {
                        logger.error("Bridge retry failed unexpectedly:", retryError);
                    });
                }, BRIDGE_RETRY_DELAY_MS);
            }
        }
    };
    // 6. Graceful Shutdown and Lifecycle Hooks
    const shutdown = async (signal) => {
        if (isShuttingDown)
            return;
        isShuttingDown = true;
        logger.info(`Received ${signal}. Starting graceful shutdown...`);
        try {
            if (retryTimer) {
                clearTimeout(retryTimer);
                retryTimer = null;
            }
            if (mockBridgeStarted) {
                await stopMockBridge();
            }
            if (wsServer) {
                await wsServer.close();
                logger.info("WebSocket server closed.");
            }
            if (server && typeof server.close === "function") {
                await server.close();
                logger.info("MCP server closed.");
            }
        }
        catch (err) {
            logger.error("Error encountered during graceful shutdown:", err);
        }
        finally {
            process.exit(0);
        }
    };
    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
    await startBridge();
    process.on("uncaughtException", (error) => {
        logger.error("Uncaught exception in server process:", error);
        process.exit(1);
    });
    process.on("unhandledRejection", (reason) => {
        logger.error("Unhandled promise rejection in server process:", reason);
    });
}
main().catch((err) => {
    logger.error("Fatal initialization error in main():", err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map