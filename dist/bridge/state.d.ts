/**
 * src/bridge/state.ts
 * Connection state tracker, active sprite cache, and monotonic revision tracker.
 */
import { EventEmitter } from "node:events";
import type { BridgeStatusResult } from "./protocol.js";
export interface ActiveSpriteMetadata {
    filename: string;
    width: number;
    height: number;
    colorMode: string;
    layersCount: number;
    framesCount: number;
    activeLayer: string;
    activeFrame: number;
}
export declare class BridgeState extends EventEmitter {
    private _connected;
    private _clientAddress;
    private _connectedAt;
    private _revision;
    private _activeSprite;
    isConnected(): boolean;
    getClientAddress(): string | null;
    getConnectedAt(): Date | null;
    getRevision(): number;
    getActiveSprite(): ActiveSpriteMetadata | null;
    setConnected(connected: boolean, clientAddress?: string): void;
    setRevision(rev: number): number;
    incrementRevision(): number;
    updateActiveSprite(metadata: ActiveSpriteMetadata | null): void;
    handleBridgeEvent(eventName: string, data: any): void;
    getStatus(): BridgeStatusResult;
}
export { BridgeState as ConnectionStateTracker };
//# sourceMappingURL=state.d.ts.map