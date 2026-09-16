/**
 * src/bridge/dispatcher.ts
 * Correlated JSON-RPC command envelope dispatcher with request IDs and timeouts.
 */
import { WebSocket } from "ws";
import { EventEmitter } from "node:events";
import { logger } from "../logger.js";
import { BridgeErrorCode, BridgeError, DEFAULT_COMMAND_TIMEOUT_MS, isBridgeResponseMessage, isBridgeEventMessage, } from "./protocol.js";
import { MAX_BRIDGE_PAYLOAD_BYTES, MAX_PENDING_COMMANDS } from "../config.js";
export class CommandDispatcher extends EventEmitter {
    activeSocket = null;
    pending = new Map();
    counter = 0;
    maxPendingCommands;
    maxPayloadBytes;
    constructor(options = {}) {
        super();
        this.maxPendingCommands = options.maxPendingCommands ?? MAX_PENDING_COMMANDS;
        this.maxPayloadBytes = options.maxPayloadBytes ?? MAX_BRIDGE_PAYLOAD_BYTES;
    }
    setActiveSocket(socket) {
        this.activeSocket = socket;
    }
    isConnected() {
        return this.activeSocket !== null && this.activeSocket.readyState === WebSocket.OPEN;
    }
    generateId() {
        const ts = Date.now();
        const count = ++this.counter;
        const rnd = Math.random().toString(36).substring(2, 7);
        return `req_${ts}_${count}_${rnd}`;
    }
    async send(command, params = {}, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS) {
        if (!this.isConnected()) {
            throw new BridgeError("Aseprite is not connected via WebSocket bridge. Please start the bridge script in Aseprite.", BridgeErrorCode.DISCONNECTED);
        }
        if (this.pending.size >= this.maxPendingCommands) {
            throw new BridgeError(`Maximum pending bridge requests reached (${this.maxPendingCommands})`, BridgeErrorCode.INVALID_PARAMS, { pendingCount: this.pending.size, maxPending: this.maxPendingCommands });
        }
        const id = this.generateId();
        const requestMessage = { id, command, params, timeoutMs };
        const serialized = JSON.stringify(requestMessage);
        const payloadBytes = Buffer.byteLength(serialized, "utf-8");
        if (payloadBytes > this.maxPayloadBytes) {
            throw new BridgeError(`Request payload exceeds maximum allowed size (${payloadBytes} bytes > ${this.maxPayloadBytes} bytes)`, BridgeErrorCode.INVALID_PARAMS, { byteLength: payloadBytes, maxPayloadBytes: this.maxPayloadBytes });
        }
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                const timeoutError = new BridgeError(`Command '${command}' timed out after ${timeoutMs}ms`, BridgeErrorCode.TIMEOUT);
                logger.warn(`Command timeout`, { id, command, timeoutMs });
                reject(timeoutError);
            }, timeoutMs);
            const deferred = {
                id,
                command,
                resolve,
                reject,
                timer,
                sentAt: Date.now(),
                timeoutMs,
            };
            this.pending.set(id, deferred);
            this.activeSocket.send(serialized, (err) => {
                if (err) {
                    clearTimeout(timer);
                    this.pending.delete(id);
                    logger.error(`Failed to send command '${command}' over WebSocket: ${err.message}`);
                    reject(new BridgeError(`Socket transmission error: ${err.message}`, BridgeErrorCode.EXECUTION_ERROR));
                }
            });
        });
    }
    handleIncomingMessage(raw) {
        let parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            logger.warn(`Received non-JSON message over bridge WebSocket: ${raw.slice(0, 150)}`);
            return;
        }
        if (isBridgeResponseMessage(parsed)) {
            this.handleResponse(parsed);
            return;
        }
        if (isBridgeEventMessage(parsed)) {
            this.handleEvent(parsed);
            return;
        }
        logger.warn(`Unrecognized envelope received over bridge WebSocket`, { preview: raw.slice(0, 150) });
    }
    handleResponse(msg) {
        const deferred = this.pending.get(msg.id);
        if (!deferred) {
            logger.warn(`Received response for unknown or already timed-out request ID: ${msg.id}`);
            return;
        }
        clearTimeout(deferred.timer);
        this.pending.delete(msg.id);
        const elapsed = Date.now() - deferred.sentAt;
        logger.debug(`Command '${deferred.command}' completed in ${elapsed}ms`, { id: msg.id, success: msg.success });
        if (msg.success) {
            deferred.resolve(msg.result);
        }
        else {
            const errCode = msg.error?.code || BridgeErrorCode.EXECUTION_ERROR;
            const errMsg = msg.error?.message || `Bridge command '${deferred.command}' failed`;
            deferred.reject(new BridgeError(errMsg, errCode, msg.error?.details));
        }
    }
    handleEvent(msg) {
        const eventName = msg.event;
        const eventData = msg.data || msg.params || {};
        logger.debug(`Bridge unsolicited event: ${eventName}`, eventData);
        if (eventName !== "error" || this.listenerCount("error") > 0) {
            this.emit(eventName, eventData);
        }
        else {
            logger.warn(`Bridge unsolicited error event received without error listener:`, eventData);
        }
        this.emit("bridge_event", { event: eventName, data: eventData });
    }
    clearActiveSocket(reason) {
        this.activeSocket = null;
        const count = this.pending.size;
        if (count > 0) {
            logger.warn(`Aborting ${count} pending bridge commands due to disconnect: ${reason}`);
            for (const req of this.pending.values()) {
                clearTimeout(req.timer);
                req.reject(new BridgeError(`Command '${req.command}' aborted: ${reason}`, BridgeErrorCode.DISCONNECTED));
            }
            this.pending.clear();
        }
    }
    getPendingCount() {
        return this.pending.size;
    }
}
//# sourceMappingURL=dispatcher.js.map