/**
 * src/bridge/protocol.ts
 * Wire protocol interfaces, envelopes, error codes, and payload contracts
 * for communication between Node.js MCP Server and Aseprite Bridge (Lua / Mock).
 */
export declare const DEFAULT_BRIDGE_PORT = 32123;
export declare const DEFAULT_BRIDGE_HOST = "127.0.0.1";
export declare const DEFAULT_COMMAND_TIMEOUT_MS = 8000;
export declare const BRIDGE_PROTOCOL_VERSION = "1.1.0";
export declare function isBridgeProtocolCompatible(version: unknown): version is string;
export declare enum BridgeErrorCode {
    NO_ACTIVE_SPRITE = "NO_ACTIVE_SPRITE",
    INVALID_PARAMS = "INVALID_PARAMS",
    OUT_OF_BOUNDS = "OUT_OF_BOUNDS",
    LOCKED_LAYER = "LOCKED_LAYER",
    INVALID_LAYER = "INVALID_LAYER",
    INVALID_FRAME = "INVALID_FRAME",
    EXECUTION_ERROR = "EXECUTION_ERROR",
    TIMEOUT = "TIMEOUT",
    DISCONNECTED = "DISCONNECTED",
    UNKNOWN_COMMAND = "UNKNOWN_COMMAND",
    CONFIRMATION_REQUIRED = "CONFIRMATION_REQUIRED",
    CANNOT_DELETE_LAST_LAYER = "CANNOT_DELETE_LAST_LAYER",
    CANNOT_DELETE_LAST_FRAME = "CANNOT_DELETE_LAST_FRAME"
}
export interface BridgeRequestMessage {
    id: string;
    command: string;
    params: Record<string, unknown>;
}
export interface BridgeResponseError {
    code: string;
    message: string;
    details?: unknown;
}
export interface BridgeResponseMessage<T = unknown> {
    id: string;
    success: boolean;
    result?: T;
    error?: BridgeResponseError;
}
export type BridgeEventType = "revision_changed" | "sprite_switched" | "frame_changed" | "layer_changed";
export interface BridgeEventData {
    revision?: number;
    sessionId?: string;
    reason?: string;
    fromUndo?: boolean;
    activeFrame?: number;
    activeLayer?: string;
    activeSprite?: {
        filename: string;
        width: number;
        height: number;
    };
    [key: string]: unknown;
}
export interface BridgeHelloData {
    bridgeProtocolVersion: string;
    asepriteVersion: string;
    apiVersion: number;
    sessionId: string;
    revision: number;
    token?: string;
    capabilities: Record<string, boolean>;
}
export interface BridgeHelloMessage {
    event: "hello";
    data: BridgeHelloData;
}
export interface BridgeHelloAckMessage {
    event: "hello_ack";
    data: {
        bridgeProtocolVersion: string;
        sessionId: string;
        resyncRequired: boolean;
    };
}
export interface BridgeEventMessage {
    event: BridgeEventType | string;
    data?: BridgeEventData;
    params?: BridgeEventData;
}
export type BridgeRequest = BridgeRequestMessage;
export type BridgeResponse<T = unknown> = BridgeResponseMessage<T>;
export type BridgeEvent = BridgeEventMessage;
export type IncomingBridgeMessage = BridgeResponseMessage | BridgeEventMessage;
export declare function isBridgeResponseMessage(msg: unknown): msg is BridgeResponseMessage;
export declare function isBridgeEventMessage(msg: unknown): msg is BridgeEventMessage;
export declare class BridgeError extends Error {
    readonly code: string;
    readonly details?: unknown;
    constructor(message: string, code?: string, details?: unknown);
}
export interface BridgeBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface BridgeStatusResult {
    connected: boolean;
    hasActiveSprite: boolean;
    filename: string;
    width: number;
    height: number;
    colorMode: string;
    layersCount: number;
    framesCount: number;
    activeLayer: string;
    activeFrame: number;
    revision: number;
    bridgeProtocolVersion?: string | null;
    asepriteVersion?: string | null;
    apiVersion?: number | null;
    sessionId?: string | null;
    previousSessionId?: string | null;
    compatible?: boolean;
    capabilities?: Record<string, boolean>;
    sync?: {
        revision: number;
        sessionId: string | null;
        previousSessionId: string | null;
        resyncRequired: boolean;
        gap: boolean;
    };
}
export type AsepriteStatusResult = BridgeStatusResult;
export interface BridgeLayerInfo {
    index: number;
    name: string;
    isVisible: boolean;
    isEditable: boolean;
    isLocked?: boolean;
    opacity: number;
    blendMode: string;
    isGroup: boolean;
    isBackground: boolean;
    parentIndex?: number | null;
}
export interface BridgeFrameInfo {
    frameNumber: number;
    duration: number;
}
export interface BridgeSpriteInfoResult {
    width: number;
    height: number;
    colorMode: string;
    layers: BridgeLayerInfo[];
    frames: BridgeFrameInfo[];
    activeLayer: string;
    activeFrame: number;
    revision: number;
}
export interface BridgeCanvasResult {
    width: number;
    height: number;
    frameNumber: number;
    pngBase64: string;
    revision: number;
}
export interface BridgePixelGridResult {
    width: number;
    height: number;
    format: "hex" | "rgba" | "indexed" | "compact";
    grid: unknown[][];
    palette?: string[] | Record<string, string>;
    rows?: string[];
    revision: number;
}
export interface BridgeInspectResult {
    width: number;
    height: number;
    pngBase64: string;
    activeLayer: string;
    activeFrame: number;
    pixelGrid: BridgePixelGridResult;
    revision: number;
}
export interface BridgeSetPixelsResult {
    pixelsModified: number;
    bounds: BridgeBounds;
    revision: number;
    pngBase64?: string;
}
//# sourceMappingURL=protocol.d.ts.map