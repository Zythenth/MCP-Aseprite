// src/mock/mockClient.ts
import WebSocket from "ws";
import { logger } from "../logger.js";
export class MockClient {
    engine;
    ws = null;
    host;
    port;
    autoReconnect;
    token;
    shouldRun = false;
    reconnectTimer = null;
    isConnectedState = false;
    constructor(engine, options = {}) {
        this.engine = engine;
        this.host = options.host ?? "127.0.0.1";
        this.port = options.port ?? 32123;
        this.autoReconnect = options.autoReconnect ?? false;
        this.token = options.token;
    }
    isConnected() {
        return this.isConnectedState && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }
    async connect() {
        this.shouldRun = true;
        let url = `ws://${this.host}:${this.port}`;
        if (this.token) {
            url += `/?token=${encodeURIComponent(this.token)}`;
        }
        return new Promise((resolve, reject) => {
            let resolved = false;
            try {
                this.ws = new WebSocket(url);
            }
            catch (err) {
                return reject(err);
            }
            this.ws.on("open", () => {
                this.isConnectedState = true;
                logger.info(`[MockClient] Connected to ${this.host}:${this.port}`);
                if (!resolved) {
                    resolved = true;
                    resolve();
                }
            });
            this.ws.on("message", (raw) => {
                this.handleRawMessage(raw);
            });
            this.ws.on("close", (code, reason) => {
                this.isConnectedState = false;
                this.ws = null;
                const reasonStr = reason ? reason.toString() : "";
                logger.debug(`[MockClient] Disconnected (code: ${code}, reason: ${reasonStr})`);
                if (!resolved) {
                    resolved = true;
                    reject(new Error(`Failed to connect to ${this.host}:${this.port}: connection closed with code ${code}`));
                }
                if (this.shouldRun && this.autoReconnect) {
                    this.reconnectTimer = setTimeout(() => {
                        if (this.shouldRun) {
                            this.connect().catch((e) => logger.debug(`[MockClient] Reconnect attempt failed: ${e.message}`));
                        }
                    }, 500);
                }
            });
            this.ws.on("error", (err) => {
                logger.debug(`[MockClient] Socket error: ${err.message}`);
                if (!resolved) {
                    resolved = true;
                    reject(err);
                }
            });
        });
    }
    async disconnect() {
        this.shouldRun = false;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            return new Promise((resolve) => {
                if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
                    this.ws = null;
                    this.isConnectedState = false;
                    return resolve();
                }
                this.ws.once("close", () => {
                    this.ws = null;
                    this.isConnectedState = false;
                    resolve();
                });
                this.ws.close();
            });
        }
    }
    handleRawMessage(raw) {
        let msg;
        try {
            msg = JSON.parse(raw.toString());
        }
        catch (e) {
            logger.error(`[MockClient] Received invalid JSON message: ${e.message}`);
            return;
        }
        if (!msg.id || !msg.command) {
            logger.warn("[MockClient] Received envelope missing id or command", msg);
            return;
        }
        let response;
        try {
            const result = this.engine.executeCommand(msg.command, msg.params ?? {});
            response = {
                id: msg.id,
                success: true,
                result,
            };
        }
        catch (err) {
            response = {
                id: msg.id,
                success: false,
                error: {
                    code: err.code ?? "MOCK_EXECUTION_ERROR",
                    message: err.message ?? String(err),
                },
            };
        }
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(response));
        }
    }
}
//# sourceMappingURL=mockClient.js.map