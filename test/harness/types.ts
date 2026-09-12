/**
 * Type definitions for E2E Test Harness & MCP Server Interface Contracts.
 */

export interface ImageContent {
  type: "image";
  data: string; // Base64-encoded image data
  mimeType: string; // e.g. "image/png"
}

export interface TextContent {
  type: "text";
  text: string; // JSON stringified metadata or textual information
}

export type ToolCallContent = ImageContent | TextContent;

export interface ToolCallResult {
  content: ToolCallContent[];
  isError?: boolean;
}

export interface BridgeRequest {
  id: string; // "req_<timestamp>_<uuid>"
  command: string; // tool name e.g. "set_pixels", "get_canvas"
  params: Record<string, any>;
}

export interface BridgeResponse {
  id: string; // Matches request id
  success: boolean;
  result?: any;
  error?: {
    code: string;
    message: string;
  };
}

export interface BridgeEvent {
  event: "revision_changed" | "sprite_switched";
  data: {
    revision: number;
    reason?: string;
  };
}

export interface Pixel {
  x: number;
  y: number;
  color: string; // "#RRGGBBAA" or "#RRGGBB"
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpriteStatus {
  connected: boolean;
  file?: string | null;
  width?: number;
  height?: number;
  colorMode?: "rgb" | "indexed" | "grayscale";
  layers?: number;
  frames?: number;
  activeLayer?: number;
  activeFrame?: number;
  revision?: number;
}

export interface SpriteInfo {
  width: number;
  height: number;
  colorMode: "rgb" | "indexed" | "grayscale";
  totalLayers: number;
  totalFrames: number;
  activeLayerIndex: number;
  activeFrameNumber: number;
  revision: number;
  layers?: Array<{
    index: number;
    name: string;
    isGroup: boolean;
    isVisible: boolean;
    isLocked: boolean;
    opacity: number;
    blendMode: string;
    parentIndex: number | null;
  }>;
  frames?: Array<{
    frameNumber: number;
    durationMs: number;
  }>;
}

export interface InspectSpriteResult {
  width: number;
  height: number;
  activeFrame: number;
  activeLayer: number;
  revision: number;
  pixelGrid?: PixelGridResult;
}

export interface PixelGridResult {
  width: number;
  height: number;
  format: "hex" | "rgba" | "indexed" | "compact";
  pixels?: string[][] | Array<Array<{ r: number; g: number; b: number; a: number }>> | number[][];
  palette?: string[];
  matrix?: string[][];
}

export interface PaletteColor {
  index: number;
  hex: string;
  rgba: { r: number; g: number; b: number; a: number };
}

export interface LayerInfo {
  index: number;
  name: string;
  isGroup: boolean;
  isVisible: boolean;
  isLocked: boolean;
  opacity: number;
  blendMode: string;
  parentIndex: number | null;
}

export interface FrameInfo {
  frameNumber: number;
  durationMs: number;
}

export interface TagInfo {
  name: string;
  fromFrame: number;
  toFrame: number;
  direction: "forward" | "reverse" | "pingpong";
  color?: string;
}

export interface TestHarnessOptions {
  wsPort?: number;
  timeoutMs?: number;
  autoConnect?: boolean;
}
