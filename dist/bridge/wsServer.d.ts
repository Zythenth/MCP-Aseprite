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
    allowRemote?: boolean;
    allowedRemoteIps?: string[];
}
export declare class BridgeWebSocketServer {
    private static readonly MAX_PENDING_HANDSHAKES;
    private static readonly MAX_PEER_CONNECTIONS;
    private static readonly BUSY_BRIDGE_REJECTION_GRACE_MS;
    private wss;
    private activeSocket;
    private readonly peerSockets;
    private readonly pendingHandshakes;
    private heartbeatTimer;
    private readonly host;
    private readonly port;
    private readonly pingIntervalMs;
    private readonly maxPayload;
    private readonly token?;
    private readonly handshakeTimeoutMs;
    private readonly allowRemote;
    private readonly allowedRemoteIps;
    private readonly dispatcher;
    private readonly state;
    constructor(dispatcher: CommandDispatcher, state: BridgeState, options?: WsServerOptions);
    start(): Promise<void>;
    private isLoopbackAddress;
    private handleConnection;
    private parseHandshake;
    private parsePeerHello;
    private handlePeerRequest;
    private sendPeerResponse;
    private broadcastBridgeEvent;
    private broadcastPeerStatus;
    private parseHello;
    private tokensMatch;
    private startHeartbeat;
    close(): Promise<void>;
    isConnected(): boolean;
    getPeerCount(): number;
    getPort(): number;
}
export declare function startWsServer(port?: number, host?: string, dispatcher?: CommandDispatcher, state?: BridgeState, optionsOrToken?: string | {
    token?: string;
    pingIntervalMs?: number;
    maxPayload?: number;
    handshakeTimeoutMs?: number;
}): Promise<BridgeWebSocketServer>;
//# sourceMappingURL=wsServer.d.ts.map