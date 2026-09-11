import { MockAsepriteEngine } from "./mockEngine.js";
import { MockClient, MockClientOptions } from "./mockClient.js";
export interface MockBridgeOptions extends MockClientOptions {
    initialWidth?: number;
    initialHeight?: number;
    hasActiveSprite?: boolean;
}
export interface MockBridgeInstance {
    engine: MockAsepriteEngine;
    client: MockClient;
    stop: () => Promise<void>;
    reset: (width?: number, height?: number) => void;
}
export declare function startMockBridge(options?: MockBridgeOptions): Promise<MockBridgeInstance>;
export declare function stopMockBridge(): Promise<void>;
export declare function getActiveMockBridge(): MockBridgeInstance | null;
export { MockAsepriteEngine, MockClient };
//# sourceMappingURL=index.d.ts.map