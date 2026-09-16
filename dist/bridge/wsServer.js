/**
 * src/bridge/wsServer.ts
 * Local WebSocket server strictly bound to 127.0.0.1:32123
 * Manages socket lifecycle, loopback IP security checks, and keepalive heartbeat.
 */
import { WebSocketServer, WebSocket } from "ws";
import { timingSafeEqual } from "node:crypto";
import { logger } from "../logger.js";
import { BRIDGE_PROTOCOL_VERSION, SHARED_BRIDGE_PROTOCOL_VERSION, DEFAULT_BRIDGE_HOST, DEFAULT_BRIDGE_PORT, isBridgeProtocolCompatible, isBridgeEventMessage, isBridgeRequestMessage, BridgeError, BridgeErrorCode, } from "./protocol.js";
import { MAX_BRIDGE_PAYLOAD_BYTES, MAX_COMMAND_TIMEOUT_MS, MAX_PENDING_COMMANDS, MIN_COMMAND_TIMEOUT_MS, } from "../config.js";
export class BridgeWebSocketServer {
    static MAX_PENDING_HANDSHAKES = MAX_PENDING_COMMANDS;
    static MAX_PEER_CONNECTIONS = MAX_PENDING_COMMANDS;
    static BUSY_BRIDGE_REJECTION_GRACE_MS = 1000;
    wss = null;
    activeSocket = null;
    peerSockets = new Set();
    pendingHandshakes = new Set();
    heartbeatTimer = null;
    host;
    port;
    pingIntervalMs;
    maxPayload;
    token;
    handshakeTimeoutMs;
    allowRemote;
    allowedRemoteIps;
    dispatcher;
    state;
    constructor(dispatcher, state, options = {}) {
        this.dispatcher = dispatcher;
        this.state = state;
        this.host = options.host || DEFAULT_BRIDGE_HOST;
        this.port = options.port !== undefined ? options.port : DEFAULT_BRIDGE_PORT;
        this.pingIntervalMs = options.pingIntervalMs || 15000;
        this.maxPayload = options.maxPayload !== undefined ? options.maxPayload : MAX_BRIDGE_PAYLOAD_BYTES;
        this.token = options.token;
        this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? 5000;
        this.allowRemote = options.allowRemote === true;
        this.allowedRemoteIps = new Set(options.allowedRemoteIps ?? []);
        if (this.allowRemote && (!this.token || this.token.length < 32)) {
            throw new Error("Remote bridge mode requires a token of at least 32 characters.");
        }
        if (!this.allowRemote && !this.isLoopbackAddress(this.host)) {
            throw new Error("Refusing non-loopback bridge bind without explicit remote mode.");
        }
        if (this.allowRemote && this.allowedRemoteIps.size === 0) {
            throw new Error("Remote bridge mode requires an explicit allowedRemoteIps allowlist.");
        }
    }
    async start() {
        return new Promise((resolve, reject) => {
            try {
                let started = false;
                this.wss = new WebSocketServer({
                    host: this.host,
                    port: this.port,
                    maxPayload: this.maxPayload,
                });
                this.wss.on("listening", () => {
                    started = true;
                    const addr = this.wss?.address();
                    const actualPort = typeof addr === "object" && addr !== null ? addr.port : this.port;
                    logger.info(`Bridge WebSocket server listening on ${this.host}:${actualPort}${this.allowRemote ? " (authenticated private remote mode)" : " (loopback)"}`);
                    if (!this.token) {
                        logger.warn("Bridge WebSocket authentication is disabled on loopback");
                    }
                    this.startHeartbeat();
                    resolve();
                });
                this.wss.on("error", (err) => {
                    logger.error(`Bridge WebSocket server startup error: ${err.message}`, { code: err.code });
                    if (err.code === "EADDRINUSE") {
                        logger.error(`Port ${this.port} is already in use. Ensure no other instance is running.`);
                    }
                    if (!started) {
                        this.wss = null;
                        reject(err);
                    }
                });
                this.wss.on("connection", (socket, req) => {
                    this.handleConnection(socket, req);
                });
            }
            catch (err) {
                reject(err);
            }
        });
    }
    isLoopbackAddress(ip) {
        if (!ip)
            return false;
        return (ip === "127.0.0.1" ||
            ip === "::ffff:127.0.0.1" ||
            ip === "::1" ||
            ip === "localhost");
    }
    handleConnection(socket, req) {
        const remoteIp = req.socket.remoteAddress;
        const normalizedIp = remoteIp?.replace(/^::ffff:/, "");
        const allowedRemote = this.allowRemote && normalizedIp !== undefined && this.allowedRemoteIps.has(normalizedIp);
        if (!this.isLoopbackAddress(remoteIp) && !allowedRemote) {
            logger.warn(`Security alert: Terminated unauthorized bridge connection from ${remoteIp}`);
            socket.terminate();
            return;
        }
        if (this.pendingHandshakes.size >= BridgeWebSocketServer.MAX_PENDING_HANDSHAKES) {
            logger.warn(`Rejected bridge connection from ${remoteIp}: too many pending handshakes`);
            socket.close(1013, "Too many pending bridge handshakes");
            return;
        }
        logger.debug(`Bridge connection candidate accepted from ${remoteIp}; awaiting hello`);
        socket.isAlive = true;
        this.pendingHandshakes.add(socket);
        let promoted = false;
        let role = "candidate";
        let cleanedUp = false;
        const cleanupCandidate = () => {
            if (cleanedUp)
                return;
            cleanedUp = true;
            clearTimeout(handshakeTimer);
            this.pendingHandshakes.delete(socket);
        };
        const rejectCandidate = (code, reason) => {
            cleanupCandidate();
            logger.warn(`Rejected bridge connection from ${remoteIp}: ${reason}`);
            socket.close(code, reason);
        };
        // Aseprite's IXWebSocket reconnects immediately when a connection opens
        // and the server closes it straight away. Tell a valid competing bridge
        // why it was rejected first, giving current extensions one UI tick to
        // stop their native socket; old extensions still receive a bounded close.
        const rejectBusyBridge = () => {
            const reason = "Another Aseprite bridge is already connected";
            cleanupCandidate();
            logger.warn(`Rejected bridge connection from ${remoteIp}: ${reason}`);
            const rejection = {
                event: "hello_rejected",
                data: {
                    code: "BRIDGE_BUSY",
                    retryAfterMs: BridgeWebSocketServer.BUSY_BRIDGE_REJECTION_GRACE_MS,
                },
            };
            socket.send(JSON.stringify(rejection));
            const closeTimer = setTimeout(() => {
                if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
                    socket.close(1008, reason);
                }
            }, BridgeWebSocketServer.BUSY_BRIDGE_REJECTION_GRACE_MS);
            socket.once("close", () => clearTimeout(closeTimer));
            socket.once("error", () => clearTimeout(closeTimer));
        };
        const handshakeTimer = setTimeout(() => {
            if (!promoted)
                rejectCandidate(1008, "Bridge hello timeout");
        }, this.handshakeTimeoutMs);
        socket.on("pong", () => {
            socket.isAlive = true;
        });
        socket.on("message", (data, isBinary) => {
            if (isBinary) {
                if (!promoted) {
                    rejectCandidate(1003, "Bridge hello must be text JSON");
                }
                else {
                    logger.warn("Received unexpected binary frame over bridge WebSocket; ignoring");
                }
                return;
            }
            const raw = data.toString("utf-8");
            if (!promoted) {
                const handshake = this.parseHandshake(raw);
                if (!handshake.ok) {
                    rejectCandidate(handshake.code, handshake.reason);
                    return;
                }
                if (handshake.kind === "peer") {
                    if (this.peerSockets.size >= BridgeWebSocketServer.MAX_PEER_CONNECTIONS) {
                        rejectCandidate(1013, "Too many shared MCP bridge peers");
                        return;
                    }
                    cleanupCandidate();
                    promoted = true;
                    role = "peer";
                    this.peerSockets.add(socket);
                    const acknowledgement = {
                        event: "peer_ack",
                        data: {
                            bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION,
                            sharedBridgeProtocolVersion: SHARED_BRIDGE_PROTOCOL_VERSION,
                            status: this.state.getStatus(),
                        },
                    };
                    socket.send(JSON.stringify(acknowledgement));
                    logger.info(`Shared MCP bridge peer connected from ${remoteIp} (${handshake.data.clientId})`);
                    return;
                }
                if (this.activeSocket &&
                    (this.activeSocket.readyState === WebSocket.OPEN ||
                        this.activeSocket.readyState === WebSocket.CONNECTING)) {
                    rejectBusyBridge();
                    return;
                }
                cleanupCandidate();
                promoted = true;
                role = "bridge";
                this.activeSocket = socket;
                const sync = this.state.handleHello(handshake.data);
                this.state.setConnected(true, remoteIp);
                this.dispatcher.setActiveSocket(socket);
                const acknowledgement = {
                    event: "hello_ack",
                    data: {
                        bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION,
                        sessionId: handshake.data.sessionId,
                        resyncRequired: sync.resyncRequired,
                    },
                };
                socket.send(JSON.stringify(acknowledgement));
                logger.info(`Bridge client authenticated from ${remoteIp} (Aseprite ${handshake.data.asepriteVersion}, session ${handshake.data.sessionId})`);
                this.broadcastPeerStatus();
                return;
            }
            if (role === "peer") {
                this.handlePeerRequest(socket, raw);
                return;
            }
            this.dispatcher.handleIncomingMessage(raw);
            this.broadcastBridgeEvent(raw);
        });
        socket.on("close", (code, reason) => {
            cleanupCandidate();
            const reasonStr = reason ? reason.toString("utf-8") : "";
            logger.info(`Bridge connection closed (code: ${code}, reason: '${reasonStr || "normal"}')`);
            if (role === "peer") {
                this.peerSockets.delete(socket);
            }
            else if (this.activeSocket === socket) {
                this.activeSocket = null;
                this.state.setConnected(false);
                this.dispatcher.clearActiveSocket("Bridge socket closed");
                this.broadcastPeerStatus();
            }
        });
        socket.on("error", (err) => {
            cleanupCandidate();
            logger.error(`Bridge socket error: ${err.message}`);
            if (role === "peer") {
                this.peerSockets.delete(socket);
            }
            else if (this.activeSocket === socket) {
                this.activeSocket = null;
                this.state.setConnected(false);
                this.dispatcher.clearActiveSocket(`Bridge socket error: ${err.message}`);
                this.broadcastPeerStatus();
            }
        });
    }
    parseHandshake(raw) {
        let message;
        try {
            message = JSON.parse(raw);
        }
        catch {
            return { ok: false, code: 1002, reason: "First message must be valid JSON" };
        }
        if (typeof message === "object" &&
            message !== null &&
            !Array.isArray(message) &&
            message.event === "peer_hello") {
            return this.parsePeerHello(message);
        }
        const bridgeHello = this.parseHello(raw);
        return bridgeHello.ok
            ? { ok: true, kind: "bridge", data: bridgeHello.data }
            : bridgeHello;
    }
    parsePeerHello(message) {
        const envelope = message;
        if (!envelope.data || typeof envelope.data !== "object" || Array.isArray(envelope.data)) {
            return { ok: false, code: 1002, reason: "Invalid shared bridge hello" };
        }
        const data = envelope.data;
        if (!isBridgeProtocolCompatible(data.bridgeProtocolVersion)) {
            return { ok: false, code: 1002, reason: "Incompatible shared bridge protocol" };
        }
        if (data.sharedBridgeProtocolVersion !== SHARED_BRIDGE_PROTOCOL_VERSION) {
            return { ok: false, code: 1002, reason: "Incompatible shared bridge relay protocol" };
        }
        if (typeof data.clientId !== "string" || data.clientId.length < 8 || data.clientId.length > 160) {
            return { ok: false, code: 1002, reason: "Invalid shared bridge client identifier" };
        }
        if (this.token && !this.tokensMatch(this.token, data.token)) {
            return { ok: false, code: 1008, reason: "Invalid bridge authentication" };
        }
        return {
            ok: true,
            kind: "peer",
            data: {
                bridgeProtocolVersion: data.bridgeProtocolVersion,
                sharedBridgeProtocolVersion: data.sharedBridgeProtocolVersion,
                clientId: data.clientId,
                token: typeof data.token === "string" ? data.token : undefined,
            },
        };
    }
    handlePeerRequest(socket, raw) {
        let message;
        try {
            message = JSON.parse(raw);
        }
        catch {
            socket.close(1002, "Shared bridge request must be valid JSON");
            return;
        }
        if (!isBridgeRequestMessage(message)) {
            socket.close(1002, "Invalid shared bridge request");
            return;
        }
        const request = message;
        if (request.timeoutMs !== undefined &&
            (request.timeoutMs < MIN_COMMAND_TIMEOUT_MS || request.timeoutMs > MAX_COMMAND_TIMEOUT_MS)) {
            this.sendPeerResponse(socket, {
                id: request.id,
                success: false,
                error: {
                    code: BridgeErrorCode.INVALID_PARAMS,
                    message: `Invalid command timeout: expected ${MIN_COMMAND_TIMEOUT_MS}..${MAX_COMMAND_TIMEOUT_MS} ms`,
                },
            });
            return;
        }
        void this.dispatcher
            .send(request.command, request.params, request.timeoutMs)
            .then((result) => {
            this.sendPeerResponse(socket, { id: request.id, success: true, result });
        })
            .catch((error) => {
            const bridgeError = error instanceof BridgeError
                ? error
                : new BridgeError(error instanceof Error ? error.message : "Shared bridge command failed");
            this.sendPeerResponse(socket, {
                id: request.id,
                success: false,
                error: {
                    code: bridgeError.code,
                    message: bridgeError.message,
                    details: bridgeError.details,
                },
            });
        });
    }
    sendPeerResponse(socket, response) {
        if (socket.readyState === WebSocket.OPEN)
            socket.send(JSON.stringify(response));
    }
    broadcastBridgeEvent(raw) {
        let message;
        try {
            message = JSON.parse(raw);
        }
        catch {
            return;
        }
        if (!isBridgeEventMessage(message))
            return;
        for (const peer of this.peerSockets) {
            if (peer.readyState === WebSocket.OPEN)
                peer.send(raw);
        }
    }
    broadcastPeerStatus() {
        const message = {
            event: "peer_state",
            data: { status: this.state.getStatus() },
        };
        const serialized = JSON.stringify(message);
        for (const peer of this.peerSockets) {
            if (peer.readyState === WebSocket.OPEN)
                peer.send(serialized);
        }
    }
    parseHello(raw) {
        let message;
        try {
            message = JSON.parse(raw);
        }
        catch {
            return { ok: false, code: 1002, reason: "First message must be a valid bridge hello" };
        }
        if (!message || typeof message !== "object" || Array.isArray(message)) {
            return { ok: false, code: 1002, reason: "First message must be a bridge hello object" };
        }
        const envelope = message;
        if (envelope.event !== "hello" || !envelope.data || typeof envelope.data !== "object" || Array.isArray(envelope.data)) {
            return { ok: false, code: 1002, reason: "First message must be bridge hello" };
        }
        const data = envelope.data;
        if (!isBridgeProtocolCompatible(data.bridgeProtocolVersion)) {
            return {
                ok: false,
                code: 1002,
                reason: `Incompatible bridge protocol; server requires ${BRIDGE_PROTOCOL_VERSION}`,
            };
        }
        if (typeof data.asepriteVersion !== "string" || data.asepriteVersion.length < 1 || data.asepriteVersion.length > 64) {
            return { ok: false, code: 1002, reason: "Invalid Aseprite version in bridge hello" };
        }
        if (!Number.isSafeInteger(data.apiVersion) || data.apiVersion < 0) {
            return { ok: false, code: 1002, reason: "Invalid API version in bridge hello" };
        }
        if (typeof data.sessionId !== "string" || data.sessionId.length < 8 || data.sessionId.length > 128) {
            return { ok: false, code: 1002, reason: "Invalid session identifier in bridge hello" };
        }
        if (!Number.isSafeInteger(data.revision) || data.revision < 0) {
            return { ok: false, code: 1002, reason: "Invalid revision in bridge hello" };
        }
        if (!data.capabilities || typeof data.capabilities !== "object" || Array.isArray(data.capabilities)) {
            return { ok: false, code: 1002, reason: "Invalid capabilities in bridge hello" };
        }
        const capabilityEntries = Object.entries(data.capabilities);
        if (capabilityEntries.length > 64 ||
            capabilityEntries.some(([name, enabled]) => name.length < 1 || name.length > 64 || typeof enabled !== "boolean")) {
            return { ok: false, code: 1002, reason: "Invalid capabilities in bridge hello" };
        }
        if (this.token && !this.tokensMatch(this.token, data.token)) {
            return { ok: false, code: 1008, reason: "Invalid bridge authentication" };
        }
        return {
            ok: true,
            data: {
                bridgeProtocolVersion: data.bridgeProtocolVersion,
                asepriteVersion: data.asepriteVersion,
                apiVersion: data.apiVersion,
                sessionId: data.sessionId,
                revision: data.revision,
                token: typeof data.token === "string" ? data.token : undefined,
                capabilities: Object.fromEntries(capabilityEntries),
            },
        };
    }
    tokensMatch(expected, provided) {
        if (typeof provided !== "string")
            return false;
        const expectedBuffer = Buffer.from(expected, "utf-8");
        const providedBuffer = Buffer.from(provided, "utf-8");
        return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
    }
    startHeartbeat() {
        if (this.heartbeatTimer)
            clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = setInterval(() => {
            if (this.activeSocket) {
                if (this.activeSocket.isAlive === false) {
                    logger.warn("Bridge client heartbeat failed (no pong response); terminating socket");
                    this.activeSocket.terminate();
                    this.activeSocket = null;
                    this.state.setConnected(false);
                    this.dispatcher.clearActiveSocket("Heartbeat timeout");
                    this.broadcastPeerStatus();
                }
                else {
                    this.activeSocket.isAlive = false;
                    this.activeSocket.ping();
                }
            }
            for (const peer of this.peerSockets) {
                if (peer.isAlive === false) {
                    peer.terminate();
                    this.peerSockets.delete(peer);
                }
                else {
                    peer.isAlive = false;
                    peer.ping();
                }
            }
        }, this.pingIntervalMs);
    }
    async close() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        if (this.activeSocket) {
            this.activeSocket.terminate();
            this.activeSocket = null;
        }
        for (const socket of this.pendingHandshakes)
            socket.terminate();
        this.pendingHandshakes.clear();
        for (const socket of this.peerSockets)
            socket.terminate();
        this.peerSockets.clear();
        this.state.setConnected(false);
        this.dispatcher.clearActiveSocket("Server stopping");
        if (this.wss) {
            return new Promise((resolve) => {
                this.wss.close(() => {
                    logger.info("Bridge WebSocket server closed");
                    this.wss = null;
                    resolve();
                });
            });
        }
    }
    isConnected() {
        return this.activeSocket !== null && this.activeSocket.readyState === WebSocket.OPEN;
    }
    getPeerCount() {
        return this.peerSockets.size;
    }
    getPort() {
        if (this.wss) {
            const addr = this.wss.address();
            if (typeof addr === "object" && addr !== null) {
                return addr.port;
            }
        }
        return this.port;
    }
}
export async function startWsServer(port, host, dispatcher, state, optionsOrToken) {
    const activeDispatcher = dispatcher || new (await import("./dispatcher.js")).CommandDispatcher();
    const activeState = state || new (await import("./state.js")).BridgeState();
    const extraOptions = typeof optionsOrToken === "string"
        ? { token: optionsOrToken }
        : optionsOrToken || {};
    const server = new BridgeWebSocketServer(activeDispatcher, activeState, { port, host, ...extraOptions });
    await server.start();
    return server;
}
//# sourceMappingURL=wsServer.js.map