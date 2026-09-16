import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { MAX_BRIDGE_PAYLOAD_BYTES } from "../config.js";
import { logger } from "../logger.js";
import { BRIDGE_PROTOCOL_VERSION, SHARED_BRIDGE_PROTOCOL_VERSION, isBridgeProtocolCompatible, } from "./protocol.js";
function isStatusResult(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return false;
    const status = value;
    return (typeof status.connected === "boolean" &&
        typeof status.hasActiveSprite === "boolean" &&
        typeof status.filename === "string" &&
        typeof status.width === "number" &&
        typeof status.height === "number" &&
        typeof status.colorMode === "string" &&
        typeof status.layersCount === "number" &&
        typeof status.framesCount === "number" &&
        typeof status.activeLayer === "string" &&
        typeof status.activeFrame === "number" &&
        Number.isSafeInteger(status.revision) &&
        status.revision >= 0);
}
export class SharedBridgeClient extends EventEmitter {
    socket = null;
    closing = false;
    dispatcher;
    state;
    host;
    port;
    token;
    handshakeTimeoutMs;
    constructor(dispatcher, state, options) {
        super();
        this.dispatcher = dispatcher;
        this.state = state;
        this.host = options.host;
        this.port = options.port;
        this.token = options.token;
        this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? 5_000;
    }
    async connect() {
        if (this.socket?.readyState === WebSocket.OPEN)
            return;
        this.closing = false;
        const socket = new WebSocket(`ws://${this.host}:${this.port}`, {
            maxPayload: MAX_BRIDGE_PAYLOAD_BYTES,
        });
        this.socket = socket;
        await new Promise((resolve, reject) => {
            let acknowledged = false;
            let settled = false;
            const finish = (error) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(handshakeTimer);
                if (error)
                    reject(error);
                else
                    resolve();
            };
            const handshakeTimer = setTimeout(() => {
                socket.close(1008, "Shared bridge handshake timeout");
                finish(new Error("Timed out while connecting to the shared Aseprite bridge owner"));
            }, this.handshakeTimeoutMs);
            socket.on("open", () => {
                const hello = {
                    event: "peer_hello",
                    data: {
                        bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION,
                        sharedBridgeProtocolVersion: SHARED_BRIDGE_PROTOCOL_VERSION,
                        clientId: `mcp-${process.pid}-${randomUUID()}`,
                        ...(this.token ? { token: this.token } : {}),
                    },
                };
                socket.send(JSON.stringify(hello));
            });
            socket.on("message", (data, isBinary) => {
                if (isBinary) {
                    socket.close(1003, "Shared bridge messages must be text JSON");
                    return;
                }
                const raw = data.toString("utf-8");
                let message;
                try {
                    message = JSON.parse(raw);
                }
                catch {
                    socket.close(1002, "Invalid shared bridge JSON");
                    return;
                }
                if (!acknowledged) {
                    const ack = message;
                    if (ack.event !== "peer_ack" ||
                        !ack.data ||
                        !isBridgeProtocolCompatible(ack.data.bridgeProtocolVersion) ||
                        ack.data.sharedBridgeProtocolVersion !== SHARED_BRIDGE_PROTOCOL_VERSION ||
                        !isStatusResult(ack.data.status)) {
                        socket.close(1002, "Invalid shared bridge acknowledgement");
                        finish(new Error("Port owner is not a compatible aseprite-mcp shared bridge"));
                        return;
                    }
                    acknowledged = true;
                    this.applyOwnerStatus(ack.data.status);
                    finish();
                    return;
                }
                const stateMessage = message;
                if (stateMessage.event === "peer_state") {
                    if (!stateMessage.data || !isStatusResult(stateMessage.data.status)) {
                        socket.close(1002, "Invalid shared bridge state update");
                        return;
                    }
                    this.applyOwnerStatus(stateMessage.data.status);
                    return;
                }
                this.dispatcher.handleIncomingMessage(raw);
            });
            socket.on("close", (code, reason) => {
                const reasonText = reason.toString("utf-8") || "connection closed";
                this.deactivate(`Shared bridge owner disconnected (${code}: ${reasonText})`);
                if (!acknowledged) {
                    finish(new Error(`Could not connect to shared bridge owner: ${reasonText}`));
                }
                if (!this.closing)
                    this.emit("disconnect", { code, reason: reasonText });
            });
            socket.on("error", (error) => {
                logger.debug(`Shared bridge peer socket error: ${error.message}`);
                if (!acknowledged)
                    finish(error);
            });
        });
    }
    applyOwnerStatus(status) {
        const socket = this.socket;
        if (status.connected && socket?.readyState === WebSocket.OPEN) {
            this.dispatcher.setActiveSocket(socket);
            this.state.applyStatus(status, `shared:${this.host}:${this.port}`);
            return;
        }
        if (this.dispatcher.isConnected()) {
            this.dispatcher.clearActiveSocket("Shared bridge owner reports that Aseprite is disconnected");
        }
        this.state.applyStatus(status);
    }
    deactivate(reason) {
        if (this.dispatcher.isConnected())
            this.dispatcher.clearActiveSocket(reason);
        this.state.setConnected(false);
        this.socket = null;
    }
    isConnected() {
        return this.socket?.readyState === WebSocket.OPEN;
    }
    async close() {
        this.closing = true;
        const socket = this.socket;
        if (!socket || socket.readyState === WebSocket.CLOSED) {
            this.deactivate("Shared bridge peer stopped");
            return;
        }
        await new Promise((resolve) => {
            socket.once("close", () => resolve());
            socket.close(1000, "Shared bridge peer stopped");
        });
    }
}
//# sourceMappingURL=sharedClient.js.map