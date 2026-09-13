/**
 * src/bridge/wsServer.ts
 * Local WebSocket server strictly bound to 127.0.0.1:32123
 * Manages socket lifecycle, loopback IP security checks, and keepalive heartbeat.
 */
import type { CommandDispatcher } from "./dispatcher.js";
import type { BridgeState } from "./state.js";
export interface WsServerOptions {
    host?: string;
    port?: number;
    pingIntervalMs?: number;
    maxPayload?: number;
    token?: string;
    handshakeTimeoutMs?: number;
}
export declare class BridgeWebSocketServer {
    private static readonly MAX_PENDING_HANDSHAKES;
    private wss;
    private activeSocket;
    private readonly pendingHandshakes;
    private heartbeatTimer;
    private readonly host;
    private readonly port;
    private readonly pingIntervalMs;
    private readonly maxPayload;
    private readonly token?;
    private readonly handshakeTimeoutMs;
    private readonly dispatcher;
    private readonly state;
    constructor(dispatcher: CommandDispatcher, state: BridgeState, options?: WsServerOptions);
    start(): Promise<void>;
    private isLoopbackAddress;
    private handleConnection;
    private parseHello;
    private tokensMatch;
    private startHeartbeat;
    close(): Promise<void>;
    isConnected(): boolean;
    getPort(): number;
}
export declare function startWsServer(port?: number, host?: string, dispatcher?: CommandDispatcher, state?: BridgeState, optionsOrToken?: string | {
    token?: string;
    pingIntervalMs?: number;
    maxPayload?: number;
    handshakeTimeoutMs?: number;
}): Promise<BridgeWebSocketServer>;
//# sourceMappingURL=wsServer.d.ts.map