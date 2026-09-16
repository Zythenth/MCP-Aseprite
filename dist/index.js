#!/usr/bin/env node
// 1. EARLY STDOUT GUARD (Must be the very first import and execution)
import { installStdoutGuard, logger } from "./logger.js";
installStdoutGuard();
// 2. Core Dependencies and Configuration
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "./config.js";
import { createMcpServer } from "./mcp/server.js";
import { SharedBridgeClient } from "./bridge/sharedClient.js";
import { launchBridgeDaemon } from "./bridge/daemonLauncher.js";
import { CommandDispatcher } from "./bridge/dispatcher.js";
import { BridgeState } from "./bridge/state.js";
const BRIDGE_RETRY_DELAY_MS = 1_000;
const DAEMON_SPAWN_COOLDOWN_MS = 5_000;
function isConnectionRefused(error) {
    if (typeof error !== "object" || error === null)
        return false;
    if ("code" in error && error.code === "ECONNREFUSED")
        return true;
    return error instanceof Error && error.message.includes("ECONNREFUSED");
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
    // 5. Every stdio process joins a persistent local bridge daemon. The daemon is
    // auto-started on demand and outlives individual conversations, so Aseprite
    // keeps one stable socket while MCP clients come and go.
    let sharedBridge = null;
    let retryTimer = null;
    let isShuttingDown = false;
    let bridgeStartInProgress = false;
    let lastDaemonSpawnAt = 0;
    const scheduleBridgeRetry = () => {
        if (retryTimer || isShuttingDown)
            return;
        retryTimer = setTimeout(() => {
            retryTimer = null;
            void startBridge().catch((retryError) => {
                logger.error("Bridge retry failed unexpectedly:", retryError);
            });
        }, BRIDGE_RETRY_DELAY_MS);
    };
    const startBridge = async () => {
        if (isShuttingDown || sharedBridge || bridgeStartInProgress)
            return;
        bridgeStartInProgress = true;
        logger.info(`Joining persistent Aseprite bridge on ${config.host}:${config.port}...`);
        const peer = new SharedBridgeClient(dispatcher, state, {
            host: config.host,
            port: config.port,
            token: config.bridgeToken,
        });
        sharedBridge = peer;
        peer.once("disconnect", () => {
            if (sharedBridge !== peer)
                return;
            sharedBridge = null;
            if (isShuttingDown)
                return;
            state.setConnectionIssue("Persistent bridge stopped; restarting it automatically.");
            scheduleBridgeRetry();
        });
        try {
            await peer.connect();
            if (isShuttingDown) {
                await peer.close();
                return;
            }
            if (sharedBridge !== peer || !peer.isConnected()) {
                sharedBridge = null;
                state.setConnectionIssue("Persistent bridge stopped; restarting it automatically.");
                scheduleBridgeRetry();
                return;
            }
            state.setConnectionIssue(null);
            logger.info(`Joined persistent Aseprite bridge on ws://${config.host}:${config.port}.`);
        }
        catch (error) {
            if (sharedBridge === peer)
                sharedBridge = null;
            await peer.close().catch(() => undefined);
            if (isShuttingDown)
                return;
            if (isConnectionRefused(error) && Date.now() - lastDaemonSpawnAt >= DAEMON_SPAWN_COOLDOWN_MS) {
                lastDaemonSpawnAt = Date.now();
                const daemon = launchBridgeDaemon();
                state.setConnectionIssue(`Starting the persistent Aseprite bridge daemon on port ${config.port}; retrying automatically.`);
                logger.info(`Persistent bridge daemon launch requested (pid ${daemon.pid ?? "pending"}).`);
            }
            else {
                state.setConnectionIssue(`Could not join the persistent bridge on port ${config.port}; aseprite-mcp will keep retrying automatically.`);
                logger.warn(`Persistent bridge join failed: ${error instanceof Error ? error.message : String(error)}`);
            }
            scheduleBridgeRetry();
        }
        finally {
            bridgeStartInProgress = false;
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
            if (sharedBridge) {
                await sharedBridge.close();
                sharedBridge = null;
                logger.info("Shared bridge peer closed.");
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