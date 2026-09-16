#!/usr/bin/env node
import { installStdoutGuard, logger } from "../logger.js";
installStdoutGuard();
import { config } from "../config.js";
import { CommandDispatcher } from "./dispatcher.js";
import { BridgeState } from "./state.js";
import { BridgeWebSocketServer } from "./wsServer.js";
import { startMockBridge, stopMockBridge } from "../mock/index.js";
function parseIdleTimeout(value) {
    if (!value || !/^\d+$/.test(value.trim()))
        return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 100 ? parsed : null;
}
async function main() {
    const dispatcher = new CommandDispatcher();
    const state = new BridgeState();
    dispatcher.on("bridge_event", ({ event, data }) => state.handleBridgeEvent(event, data));
    const server = new BridgeWebSocketServer(dispatcher, state, {
        host: config.host,
        port: config.port,
        token: config.bridgeToken,
    });
    let shuttingDown = false;
    let mockStarted = false;
    let idleTimer = null;
    const shutdown = async (signal) => {
        if (shuttingDown)
            return;
        shuttingDown = true;
        logger.info(`Persistent bridge daemon received ${signal}; shutting down.`);
        if (idleTimer)
            clearInterval(idleTimer);
        if (mockStarted)
            await stopMockBridge();
        await server.close();
        process.exit(0);
    };
    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
    await server.start();
    logger.info(`Persistent Aseprite bridge daemon listening on ws://${config.host}:${config.port}.`);
    if (process.env.ASEPRITE_MCP_MOCK === "1") {
        await startMockBridge({
            host: config.host,
            port: config.port,
            token: config.bridgeToken,
        });
        mockStarted = true;
    }
    const idleTimeoutMs = parseIdleTimeout(process.env.ASEPRITE_MCP_DAEMON_IDLE_MS);
    if (idleTimeoutMs !== null) {
        let idleSince = Date.now();
        idleTimer = setInterval(() => {
            if (server.getPeerCount() > 0) {
                idleSince = Date.now();
            }
            else if (Date.now() - idleSince >= idleTimeoutMs) {
                void shutdown("idle timeout");
            }
        }, Math.min(500, idleTimeoutMs));
    }
}
main().catch((error) => {
    logger.error("Persistent Aseprite bridge daemon failed:", error);
    process.exit(1);
});
//# sourceMappingURL=daemon.js.map