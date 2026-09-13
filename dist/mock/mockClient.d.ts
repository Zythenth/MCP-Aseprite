import { MockAsepriteEngine } from "./mockEngine.js";
export interface MockClientOptions {
    host?: string;
    port?: number;
    autoReconnect?: boolean;
    token?: string;
}
export declare class MockClient {
    private engine;
    private ws;
    private host;
    private port;
    private autoReconnect;
    private token?;
    private shouldRun;
    private reconnectTimer;
    private isConnectedState;
    private readonly sessionId;
    constructor(engine: MockAsepriteEngine, options?: MockClientOptions);
    isConnected(): boolean;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    private handleRawMessage;
}
//# sourceMappingURL=mockClient.d.ts.map