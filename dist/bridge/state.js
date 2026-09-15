/**
 * src/bridge/state.ts
 * Connection state tracker, active sprite cache, and monotonic revision tracker.
 */
import { EventEmitter } from "node:events";
import { logger } from "../logger.js";
import { isBridgeProtocolCompatible, } from "./protocol.js";
export class BridgeState extends EventEmitter {
    _connected = false;
    _clientAddress = null;
    _connectedAt = null;
    _revision = 1;
    _activeSprite = null;
    _bridgeProtocolVersion = null;
    _asepriteVersion = null;
    _apiVersion = null;
    _sessionId = null;
    _previousSessionId = null;
    _capabilities = {};
    _resyncRequired = true;
    _gap = true;
    _connectionIssue = null;
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
    getSessionId() {
        return this._sessionId;
    }
    getCapabilities() {
        return { ...this._capabilities };
    }
    getConnectionIssue() {
        return this._connectionIssue;
    }
    setConnectionIssue(issue) {
        if (this._connectionIssue === issue)
            return;
        this._connectionIssue = issue;
        this.emit("connection_issue", { issue });
    }
    isCompatible() {
        return isBridgeProtocolCompatible(this._bridgeProtocolVersion);
    }
    handleHello(data) {
        const previousSession = this._sessionId;
        const reconnecting = previousSession !== null;
        const sessionChanged = reconnecting && previousSession !== data.sessionId;
        if (sessionChanged)
            this._previousSessionId = previousSession;
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
    setConnected(connected, clientAddress) {
        if (this._connected === connected)
            return;
        this._connected = connected;
        if (connected) {
            this.setConnectionIssue(null);
            this._clientAddress = clientAddress || null;
            this._connectedAt = new Date();
            logger.info(`BridgeState: Connected to client at ${this._clientAddress}`);
        }
        else {
            this._clientAddress = null;
            this._connectedAt = null;
            this._activeSprite = null;
            this._resyncRequired = this._sessionId !== null;
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
    markSynchronized(sessionId, revision) {
        if (sessionId !== this._sessionId || revision !== this._revision)
            return false;
        this._resyncRequired = false;
        this._gap = false;
        this.emit("sync_change", { sessionId, revision, resyncRequired: false, gap: false });
        return true;
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
        else if (eventName === "frame_changed") {
            const frame = data?.activeFrame ?? data?.frameNumber;
            if (typeof frame === "number" && this._activeSprite) {
                this._activeSprite.activeFrame = frame;
            }
            this.emit("frame_change", { activeFrame: frame, frameId: data?.frameId });
        }
        else if (eventName === "layer_changed") {
            const layer = data?.activeLayer ?? data?.layerName;
            if (typeof layer === "string" && this._activeSprite) {
                this._activeSprite.activeLayer = layer;
            }
            this.emit("layer_change", { activeLayer: layer, layerId: data?.layerId });
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
//# sourceMappingURL=state.js.map