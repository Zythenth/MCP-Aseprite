import type { BridgeState } from "../../bridge/state.js";
export declare function bridgeToolResult(result: any, stateTracker: BridgeState, returnPreview?: boolean): any;
export declare function bridgeToolError(error: unknown): any;
export declare function confirmationError(operation: string): any;
export declare function requireBridgeCapability(state: BridgeState, capability: string): void;
//# sourceMappingURL=common.d.ts.map