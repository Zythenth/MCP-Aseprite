/**
 * src/bridge/protocol.ts
 * Wire protocol interfaces, envelopes, error codes, and payload contracts
 * for communication between Node.js MCP Server and Aseprite Bridge (Lua / Mock).
 */

export const DEFAULT_BRIDGE_PORT = 32123;
export const DEFAULT_BRIDGE_HOST = "127.0.0.1";
export const DEFAULT_COMMAND_TIMEOUT_MS = 8000;
export const BRIDGE_PROTOCOL_VERSION = "1.2.0";
export const SHARED_BRIDGE_PROTOCOL_VERSION = "1.0.0";

export function isBridgeProtocolCompatible(version: unknown): version is string {
  if (typeof version !== "string") return false;
  const candidate = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  const current = /^(\d+)\.(\d+)\.(\d+)$/.exec(BRIDGE_PROTOCOL_VERSION);
  return candidate !== null && current !== null && candidate[1] === current[1];
}

export enum BridgeErrorCode {
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
  CANNOT_DELETE_LAST_FRAME = "CANNOT_DELETE_LAST_FRAME",
}

export interface BridgeRequestMessage {
  id: string; // e.g. "req_1694432000000_1_a1b2c"
  command: string; // e.g. "aseprite_status", "set_pixels", "get_canvas"
  params: Record<string, unknown>;
  timeoutMs?: number;
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

export type BridgeEventType =
  | "revision_changed"
  | "sprite_switched"
  | "frame_changed"
  | "layer_changed";

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

export interface BridgePeerHelloMessage {
  event: "peer_hello";
  data: {
    bridgeProtocolVersion: string;
    sharedBridgeProtocolVersion: string;
    clientId: string;
    token?: string;
  };
}

export interface BridgePeerAckMessage {
  event: "peer_ack";
  data: {
    bridgeProtocolVersion: string;
    sharedBridgeProtocolVersion: string;
    status: BridgeStatusResult;
  };
}

export interface BridgePeerStateMessage {
  event: "peer_state";
  data: {
    status: BridgeStatusResult;
  };
}

export interface BridgeEventMessage {
  event: BridgeEventType | string;
  data?: BridgeEventData;
  params?: BridgeEventData; // Compatibility alias
}

export type BridgeRequest = BridgeRequestMessage;
export type BridgeResponse<T = unknown> = BridgeResponseMessage<T>;
export type BridgeEvent = BridgeEventMessage;

export type IncomingBridgeMessage = BridgeResponseMessage | BridgeEventMessage;

export function isBridgeResponseMessage(msg: unknown): msg is BridgeResponseMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "id" in msg &&
    typeof (msg as any).id === "string" &&
    "success" in msg &&
    typeof (msg as any).success === "boolean"
  );
}

export function isBridgeRequestMessage(msg: unknown): msg is BridgeRequestMessage {
  if (typeof msg !== "object" || msg === null || Array.isArray(msg)) return false;
  const request = msg as Record<string, unknown>;
  return (
    typeof request.id === "string" &&
    request.id.length >= 1 &&
    request.id.length <= 160 &&
    typeof request.command === "string" &&
    request.command.length >= 1 &&
    request.command.length <= 128 &&
    typeof request.params === "object" &&
    request.params !== null &&
    !Array.isArray(request.params) &&
    (request.timeoutMs === undefined ||
      (Number.isSafeInteger(request.timeoutMs) && (request.timeoutMs as number) > 0))
  );
}

export function isBridgeEventMessage(msg: unknown): msg is BridgeEventMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "event" in msg &&
    typeof (msg as any).event === "string"
  );
}

export class BridgeError extends Error {
  public readonly code: string;
  public readonly details?: unknown;

  constructor(message: string, code: string = BridgeErrorCode.EXECUTION_ERROR, details?: unknown) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, BridgeError.prototype);
  }
}

// Common Payload Models
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
  duration: number; // in milliseconds
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
  pngBase64?: string;
  rgbaBase64?: string;
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
  pngBase64?: string;
  rgbaBase64?: string;
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
  rgbaBase64?: string;
  preview?: {
    width: number;
    height: number;
    pngBase64?: string;
    rgbaBase64?: string;
  };
}
