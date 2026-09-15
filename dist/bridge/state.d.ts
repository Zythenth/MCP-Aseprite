/**
 * src/bridge/state.ts
 * Connection state tracker, active sprite cache, and monotonic revision tracker.
 */
import { EventEmitter } from "node:events";
import { type BridgeHelloData, type BridgeStatusResult } from "./protocol.js";
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
    private _bridgeProtocolVersion;
    private _asepriteVersion;
    private _apiVersion;
    private _sessionId;
    private _previousSessionId;
    private _capabilities;
    private _resyncRequired;
    private _gap;
    private _connectionIssue;
    isConnected(): boolean;
    getClientAddress(): string | null;
    getConnectedAt(): Date | null;
    getRevision(): number;
    getActiveSprite(): ActiveSpriteMetadata | null;
    getSessionId(): string | null;
    getCapabilities(): Record<string, boolean>;
    getConnectionIssue(): string | null;
    setConnectionIssue(issue: string | null): void;
    isCompatible(): boolean;
    handleHello(data: BridgeHelloData): {
        resyncRequired: boolean;
    };
    setConnected(connected: boolean, clientAddress?: string): void;
    setRevision(rev: number): number;
    markSynchronized(sessionId: string, revision: number): boolean;
    incrementRevision(): number;
    updateActiveSprite(metadata: ActiveSpriteMetadata | null): void;
    handleBridgeEvent(eventName: string, data: any): void;
    getStatus(): BridgeStatusResult;
}
export { BridgeState as ConnectionStateTracker };
//# sourceMappingURL=state.d.ts.map