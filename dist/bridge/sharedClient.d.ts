import { EventEmitter } from "node:events";
import type { CommandDispatcher } from "./dispatcher.js";
import type { BridgeState } from "./state.js";
export interface SharedBridgeClientOptions {
    host: string;
    port: number;
    token?: string;
    handshakeTimeoutMs?: number;
}
export declare class SharedBridgeClient extends EventEmitter {
    private socket;
    private closing;
    private readonly dispatcher;
    private readonly state;
    private readonly host;
    private readonly port;
    private readonly token?;
    private readonly handshakeTimeoutMs;
    constructor(dispatcher: CommandDispatcher, state: BridgeState, options: SharedBridgeClientOptions);
    connect(): Promise<void>;
    private applyOwnerStatus;
    private deactivate;
    isConnected(): boolean;
    close(): Promise<void>;
}
//# sourceMappingURL=sharedClient.d.ts.map