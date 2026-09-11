/**
 * src/bridge/state.ts
 * Connection state tracker, active sprite cache, and monotonic revision tracker.
 */

import { EventEmitter } from "node:events";
import { logger } from "../logger.js";
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

export class BridgeState extends EventEmitter {
  private _connected: boolean = false;
  private _clientAddress: string | null = null;
  private _connectedAt: Date | null = null;
  private _revision: number = 1;
  private _activeSprite: ActiveSpriteMetadata | null = null;

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
    };
  }
}

export { BridgeState as ConnectionStateTracker };