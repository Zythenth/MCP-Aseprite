export const DEFAULT_PORT = 32123;
export const DEFAULT_WS_PORT = DEFAULT_PORT;
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_COMMAND_TIMEOUT_MS = 8000;
export const HEAVY_COMMAND_TIMEOUT_MS = 15000;
export const WS_HEARTBEAT_INTERVAL_MS = 15000;
export const WS_HEARTBEAT_TIMEOUT_MS = 30000;

export const DEFAULT_SCALE = 8;
export const MIN_SCALE = 1;
export const MAX_SCALE = 64;
export const GRID_MIN_SCALE = 6;
export const RULER_MIN_SCALE = 8;
export const RULER_TOP_HEIGHT_PX = 20;
export const RULER_LEFT_WIDTH_PX = 24;
export const CHECKERBOARD_CELL_SIZE = 8;

export const MAX_CANVAS_DIMENSION = 4096;
export const MAX_PIXELS_BATCH = 100000;

export const COMPACT_PALETTE_CHARACTERS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const COMPACT_TRANSPARENT_CHAR = ".";

export const SERVER_NAME = "aseprite-mcp";
export const SERVER_VERSION = "0.1.0";
export const MCP_PROTOCOL_VERSION = "2024-11-05";

function parsePort(val: string | undefined, defaultVal: number): number {
  if (!val) return defaultVal;
  const parsed = parseInt(val, 10);
  if (isNaN(parsed) || parsed < 1024 || parsed > 65535) {
    return defaultVal;
  }
  return parsed;
}

function sanitizeHost(val: string | undefined, defaultVal: string): string {
  if (!val) return defaultVal;
  const trimmed = val.trim();
  // Strictly enforce loopback security boundary
  if (trimmed === "127.0.0.1" || trimmed === "localhost" || trimmed === "::1") {
    return trimmed;
  }
  return defaultVal;
}

export const PORT = parsePort(process.env.ASEPRITE_PORT || process.env.ASEPRITE_WS_PORT, DEFAULT_PORT);
export const HOST = sanitizeHost(process.env.ASEPRITE_HOST, DEFAULT_HOST);
export const COMMAND_TIMEOUT_MS = parsePort(process.env.ASEPRITE_COMMAND_TIMEOUT, DEFAULT_COMMAND_TIMEOUT_MS);

export const config = {
  port: PORT,
  host: HOST,
  commandTimeoutMs: COMMAND_TIMEOUT_MS,
  heavyCommandTimeoutMs: HEAVY_COMMAND_TIMEOUT_MS,
  wsHeartbeatIntervalMs: WS_HEARTBEAT_INTERVAL_MS,
  wsHeartbeatTimeoutMs: WS_HEARTBEAT_TIMEOUT_MS,
  defaultScale: DEFAULT_SCALE,
  minScale: MIN_SCALE,
  maxScale: MAX_SCALE,
  gridMinScale: GRID_MIN_SCALE,
  rulerMinScale: RULER_MIN_SCALE,
  rulerTopHeightPx: RULER_TOP_HEIGHT_PX,
  rulerLeftWidthPx: RULER_LEFT_WIDTH_PX,
  checkerboardCellSize: CHECKERBOARD_CELL_SIZE,
  maxCanvasDimension: MAX_CANVAS_DIMENSION,
  maxPixelsBatch: MAX_PIXELS_BATCH,
  compactPaletteChars: COMPACT_PALETTE_CHARACTERS,
  compactTransparentChar: COMPACT_TRANSPARENT_CHAR,
  serverName: SERVER_NAME,
  serverVersion: SERVER_VERSION,
  protocolVersion: MCP_PROTOCOL_VERSION,
} as const;