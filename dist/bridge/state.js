/**
 * src/bridge/state.ts
 * Connection state tracker, active sprite cache, and monotonic revision tracker.
 */
import { EventEmitter } from "node:events";
import { logger } from "../logger.js";
export class BridgeState extends EventEmitter {
    _connected = false;
    _clientAddress = null;
    _connectedAt = null;
    _revision = 1;
    _activeSprite = null;
    isConnected() {
        return this._connected;
    }
    getClientAddress() {
        return this._clientAddress;
    }
    getConnectedAt() {
        return this._connectedAt;
    }
    getRevision() {
        return this._revision;
    }
    getActiveSprite() {
        return this._activeSprite ? { ...this._activeSprite } : null;
    }
    setConnected(connected, clientAddress) {
        if (this._connected === connected)
            return;
        this._connected = connected;
        if (connected) {
            this._clientAddress = clientAddress || null;
            this._connectedAt = new Date();
            logger.info(`BridgeState: Connected to client at ${this._clientAddress}`);
        }
        else {
            this._clientAddress = null;
            this._connectedAt = null;
            this._activeSprite = null;
            logger.info("BridgeState: Disconnected from client");
        }
        this.emit("connection_change", { connected, clientAddress: this._clientAddress });
    }
    setRevision(rev) {
        if (rev > this._revision) {
            this._revision = rev;
            logger.debug(`BridgeState: Revision updated to ${this._revision}`);
            this.emit("revision_change", { revision: this._revision });
        }
        return this._revision;
    }
    incrementRevision() {
        this._revision += 1;
        logger.debug(`BridgeState: Revision incremented to ${this._revision}`);
        this.emit("revision_change", { revision: this._revision });
        return this._revision;
    }
    updateActiveSprite(metadata) {
        this._activeSprite = metadata;
        this.emit("sprite_change", this._activeSprite);
    }
    handleBridgeEvent(eventName, data) {
        if (eventName === "revision_changed") {
            const incomingRev = typeof data?.revision === "number" ? data.revision : this._revision + 1;
            this.setRevision(incomingRev);
            if (typeof data?.activeFrame === "number" && this._activeSprite) {
                this._activeSprite.activeFrame = data.activeFrame;
            }
            if (typeof data?.activeLayer === "string" && this._activeSprite) {
                this._activeSprite.activeLayer = data.activeLayer;
            }
        }
        else if (eventName === "sprite_switched") {
            if (data?.activeSprite) {
                this.updateActiveSprite(data.activeSprite);
            }
            this.incrementRevision();
        }
    }
    getStatus() {
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
//# sourceMappingURL=state.js.map