/**
 * src/bridge/state.ts
 * Connection state tracker, active sprite cache, and monotonic revision tracker.
 */

import { EventEmitter } from "node:events";
import { logger } from "../logger.js";
import {
  type BridgeHelloData,
  type BridgeStatusResult,
  isBridgeProtocolCompatible,
} from "./protocol.js";

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

export class BridgeState extends EventEmitter {
  private _connected: boolean = false;
  private _clientAddress: string | null = null;
  private _connectedAt: Date | null = null;
  private _revision: number = 1;
  private _activeSprite: ActiveSpriteMetadata | null = null;
  private _bridgeProtocolVersion: string | null = null;
  private _asepriteVersion: string | null = null;
  private _apiVersion: number | null = null;
  private _sessionId: string | null = null;
  private _previousSessionId: string | null = null;
  private _capabilities: Record<string, boolean> = {};
  private _resyncRequired: boolean = true;
  private _gap: boolean = true;

  public isConnected(): boolean {
    return this._connected;
  }

  public getClientAddress(): string | null {
    return this._clientAddress;
  }

  public getConnectedAt(): Date | null {
    return this._connectedAt;
  }

  public getRevision(): number {
    return this._revision;
  }

  public getActiveSprite(): ActiveSpriteMetadata | null {
    return this._activeSprite ? { ...this._activeSprite } : null;
  }

  public getSessionId(): string | null {
    return this._sessionId;
  }

  public getCapabilities(): Record<string, boolean> {
    return { ...this._capabilities };
  }

  public isCompatible(): boolean {
    return isBridgeProtocolCompatible(this._bridgeProtocolVersion);
  }

  public handleHello(data: BridgeHelloData): { resyncRequired: boolean } {
    const previousSession = this._sessionId;
    const reconnecting = previousSession !== null;
    const sessionChanged = reconnecting && previousSession !== data.sessionId;

    if (sessionChanged) this._previousSessionId = previousSession;
    this._sessionId = data.sessionId;
    this._bridgeProtocolVersion = data.bridgeProtocolVersion;
    this._asepriteVersion = data.asepriteVersion;
    this._apiVersion = data.apiVersion;
    this._capabilities = { ...data.capabilities };
    this._revision = data.revision;
    this._resyncRequired = reconnecting;
    this._gap = sessionChanged;

    this.emit("hello", {
      ...data,
      previousSessionId: this._previousSessionId,
      resyncRequired: this._resyncRequired,
      gap: this._gap,
    });
    return { resyncRequired: this._resyncRequired };
  }

  public setConnected(connected: boolean, clientAddress?: string): void {
    if (this._connected === connected) return;

    this._connected = connected;
    if (connected) {
      this._clientAddress = clientAddress || null;
      this._connectedAt = new Date();
      logger.info(`BridgeState: Connected to client at ${this._clientAddress}`);
    } else {
      this._clientAddress = null;
      this._connectedAt = null;
      this._activeSprite = null;
      this._resyncRequired = this._sessionId !== null;
      logger.info("BridgeState: Disconnected from client");
    }

    this.emit("connection_change", { connected, clientAddress: this._clientAddress });
  }

  public setRevision(rev: number): number {
    if (rev > this._revision) {
      this._revision = rev;
      logger.debug(`BridgeState: Revision updated to ${this._revision}`);
      this.emit("revision_change", { revision: this._revision });
    }
    return this._revision;
  }

  public markSynchronized(sessionId: string, revision: number): boolean {
    if (sessionId !== this._sessionId || revision !== this._revision) return false;
    this._resyncRequired = false;
    this._gap = false;
    this.emit("sync_change", { sessionId, revision, resyncRequired: false, gap: false });
    return true;
  }

  public incrementRevision(): number {
    this._revision += 1;
    logger.debug(`BridgeState: Revision incremented to ${this._revision}`);
    this.emit("revision_change", { revision: this._revision });
    return this._revision;
  }

  public updateActiveSprite(metadata: ActiveSpriteMetadata | null): void {
    this._activeSprite = metadata;
    this.emit("sprite_change", this._activeSprite);
  }

  public handleBridgeEvent(eventName: string, data: any): void {
    if (eventName === "revision_changed") {
      const incomingRev = typeof data?.revision === "number" ? data.revision : this._revision + 1;
      this.setRevision(incomingRev);
      if (typeof data?.activeFrame === "number" && this._activeSprite) {
        this._activeSprite.activeFrame = data.activeFrame;
      }
      if (typeof data?.activeLayer === "string" && this._activeSprite) {
        this._activeSprite.activeLayer = data.activeLayer;
      }
    } else if (eventName === "frame_changed") {
      const frame = data?.activeFrame ?? data?.frameNumber;
      if (typeof frame === "number" && this._activeSprite) {
        this._activeSprite.activeFrame = frame;
      }
      this.emit("frame_change", { activeFrame: frame, frameId: data?.frameId });
    } else if (eventName === "layer_changed") {
      const layer = data?.activeLayer ?? data?.layerName;
      if (typeof layer === "string" && this._activeSprite) {
        this._activeSprite.activeLayer = layer;
      }
      this.emit("layer_change", { activeLayer: layer, layerId: data?.layerId });
    } else if (eventName === "sprite_switched") {
      if (data?.activeSprite) {
        this.updateActiveSprite(data.activeSprite);
      }
      this.incrementRevision();
    }
  }

  public getStatus(): BridgeStatusResult {
    return {
      connected: this._connected,
      hasActiveSprite: this._activeSprite !== null,
      filename: this._activeSprite?.filename || "",
      width: this._activeSprite?.width || 0,
      height: this._activeSprite?.height || 0,
      colorMode: this._activeSprite?.colorMode || "",
      layersCount: this._activeSprite?.layersCount || 0,
      framesCount: this._activeSprite?.framesCount || 0,
      activeLayer: this._activeSprite?.activeLayer || "",
      activeFrame: this._activeSprite?.activeFrame || 1,
      revision: this._revision,
      bridgeProtocolVersion: this._bridgeProtocolVersion,
      asepriteVersion: this._asepriteVersion,
      apiVersion: this._apiVersion,
      sessionId: this._sessionId,
      previousSessionId: this._previousSessionId,
      compatible: this.isCompatible(),
      capabilities: { ...this._capabilities },
      sync: {
        revision: this._revision,
        sessionId: this._sessionId,
        previousSessionId: this._previousSessionId,
        resyncRequired: !this._connected || this._resyncRequired,
        gap: this._gap,
      },
    };
  }
}

export { BridgeState as ConnectionStateTracker };
