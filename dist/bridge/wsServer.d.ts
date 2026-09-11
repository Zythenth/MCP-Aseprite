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
}
export declare class BridgeWebSocketServer {
    private wss;
    private activeSocket;
    private heartbeatTimer;
    private readonly host;
    private readonly port;
    private readonly pingIntervalMs;
    private readonly dispatcher;
    private readonly state;
    constructor(dispatcher: CommandDispatcher, state: BridgeState, options?: WsServerOptions);
    start(): Promise<void>;
    private isLoopbackAddress;
    private handleConnection;
    private startHeartbeat;
    close(): Promise<void>;
    isConnected(): boolean;
    getPort(): number;
}
export declare function startWsServer(port?: number, host?: string, dispatcher?: CommandDispatcher, state?: BridgeState): Promise<BridgeWebSocketServer>;
//# sourceMappingURL=wsServer.d.ts.map