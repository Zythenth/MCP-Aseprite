import { getAllowedRoots, resolveProjectRoot } from "./security/fileAccess.js";
import { BRIDGE_PROTOCOL_VERSION } from "./bridge/protocol.js";
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
export const MAX_TILESET_PIXELS = 16_777_216;
export const MAX_BRIDGE_PAYLOAD_BYTES = 16 * 1024 * 1024;
export const MAX_PENDING_COMMANDS = 128;
export const COMPACT_PALETTE_CHARACTERS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const COMPACT_TRANSPARENT_CHAR = ".";
export const SERVER_NAME = "aseprite-mcp";
export const SERVER_VERSION = "0.1.0";
export const MCP_PROTOCOL_VERSION = "2024-11-05";
export { BRIDGE_PROTOCOL_VERSION };
export const MIN_PORT = 1024;
export const MAX_PORT = 65535;
/**
 * Minimum allowable command timeout in milliseconds (100 ms).
 * Prevents zero/negative or impractically short timeouts.
 */
export const MIN_COMMAND_TIMEOUT_MS = 100;
/**
 * Maximum allowable command timeout in milliseconds (300,000 ms = 5 minutes).
 * Accommodates heavy batch operations while preventing indefinite hangs.
 */
export const MAX_COMMAND_TIMEOUT_MS = 300_000;
/**
 * Strictly parses a port from an environment string.
 * Fails fast with an actionable Error if the input is explicitly provided but not a valid base-10 integer in 1024..65535.
 * Falls back to defaultVal only when the input is absent (undefined) or blank (empty/whitespace-only).
 */
export function parsePort(val, defaultVal = DEFAULT_PORT) {
    if (val === undefined)
        return defaultVal;
    const trimmed = val.trim();
    if (trimmed === "")
        return defaultVal;
    if (!/^[0-9]+$/.test(trimmed)) {
        throw new Error(`Invalid port '${val}': must be a base-10 integer between ${MIN_PORT} and ${MAX_PORT}.`);
    }
    const parsed = Number(trimmed);
    if (!Number.isSafeInteger(parsed) || parsed < MIN_PORT || parsed > MAX_PORT) {
        throw new Error(`Invalid port '${val}': must be an integer between ${MIN_PORT} and ${MAX_PORT} (got ${parsed}).`);
    }
    return parsed;
}
/**
 * Strictly parses a duration in milliseconds from an environment string.
 * Fails fast with an actionable Error if the input is explicitly provided but not a valid base-10 integer in MIN_COMMAND_TIMEOUT_MS..MAX_COMMAND_TIMEOUT_MS.
 * Falls back to defaultVal only when the input is absent (undefined) or blank (empty/whitespace-only).
 */
export function parseCommandTimeout(val, defaultVal = DEFAULT_COMMAND_TIMEOUT_MS) {
    if (val === undefined)
        return defaultVal;
    const trimmed = val.trim();
    if (trimmed === "")
        return defaultVal;
    if (!/^[0-9]+$/.test(trimmed)) {
        throw new Error(`Invalid ASEPRITE_COMMAND_TIMEOUT '${val}': must be a positive base-10 integer duration in milliseconds between ${MIN_COMMAND_TIMEOUT_MS} and ${MAX_COMMAND_TIMEOUT_MS}.`);
    }
    const parsed = Number(trimmed);
    if (!Number.isSafeInteger(parsed) ||
        parsed < MIN_COMMAND_TIMEOUT_MS ||
        parsed > MAX_COMMAND_TIMEOUT_MS) {
        throw new Error(`Invalid ASEPRITE_COMMAND_TIMEOUT '${val}': duration must be between ${MIN_COMMAND_TIMEOUT_MS} and ${MAX_COMMAND_TIMEOUT_MS} ms (got ${parsed}).`);
    }
    return parsed;
}
function sanitizeHost(val, defaultVal) {
    if (!val)
        return defaultVal;
    const trimmed = val.trim();
    // Strictly enforce loopback security boundary
    if (trimmed === "127.0.0.1" || trimmed === "localhost" || trimmed === "::1") {
        return trimmed;
    }
    return defaultVal;
}
export const BRIDGE_TOKEN_REGEX = /^[A-Za-z0-9._~-]+$/;
export const TOOLSETS = [
    "core", "visual", "editing", "files", "shapes", "layers", "frames", "palette",
    "cels", "slices", "selection", "tiles", "animation", "pixel-art", "review",
];
export function parseBooleanEnv(name, value, defaultValue = false) {
    if (value === undefined || value.trim() === "")
        return defaultValue;
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized))
        return true;
    if (["0", "false", "no", "off"].includes(normalized))
        return false;
    throw new Error(`Invalid ${name}: expected one of 1, 0, true, false, yes, no, on, or off.`);
}
export function parseToolsets(value) {
    if (value === undefined || value.trim() === "" || value.trim().toLowerCase() === "all")
        return [...TOOLSETS];
    const requested = value.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
    const unknown = requested.filter((entry) => !TOOLSETS.includes(entry));
    if (unknown.length > 0)
        throw new Error(`Invalid ASEPRITE_TOOLSETS value(s): ${unknown.join(", ")}.`);
    return [...new Set(["core", ...requested])];
}
export function parseBridgeToken(val) {
    if (val === undefined)
        return undefined;
    const trimmed = val.trim();
    if (trimmed === "")
        return undefined;
    if (trimmed.length < 16 || trimmed.length > 128) {
        throw new Error(`Invalid ASEPRITE_BRIDGE_TOKEN: length must be between 16 and 128 characters (got ${trimmed.length}).`);
    }
    if (!BRIDGE_TOKEN_REGEX.test(trimmed)) {
        throw new Error("Invalid ASEPRITE_BRIDGE_TOKEN: token must contain only URL-safe characters [A-Za-z0-9._~-].");
    }
    return trimmed;
}
export function resolvePortEnv() {
    const port = process.env.ASEPRITE_PORT;
    if (port !== undefined && port.trim() !== "") {
        return port;
    }
    const wsPort = process.env.ASEPRITE_WS_PORT;
    if (wsPort !== undefined && wsPort.trim() !== "") {
        return wsPort;
    }
    return port !== undefined ? port : wsPort;
}
export const PORT = parsePort(resolvePortEnv(), DEFAULT_PORT);
export const HOST = sanitizeHost(process.env.ASEPRITE_HOST, DEFAULT_HOST);
export const COMMAND_TIMEOUT_MS = parseCommandTimeout(process.env.ASEPRITE_COMMAND_TIMEOUT, DEFAULT_COMMAND_TIMEOUT_MS);
export const ALLOWED_PATHS = getAllowedRoots();
export const PROJECT_ROOT = resolveProjectRoot(process.env.ASEPRITE_PROJECT_ROOT, ALLOWED_PATHS);
export const BRIDGE_TOKEN = parseBridgeToken(process.env.ASEPRITE_BRIDGE_TOKEN);
export const READ_ONLY = parseBooleanEnv("ASEPRITE_READ_ONLY", process.env.ASEPRITE_READ_ONLY);
export const ENABLED_TOOLSETS = parseToolsets(process.env.ASEPRITE_TOOLSETS);
export const config = {
    port: PORT,
    host: HOST,
    commandTimeoutMs: COMMAND_TIMEOUT_MS,
    heavyCommandTimeoutMs: HEAVY_COMMAND_TIMEOUT_MS,
    bridgeToken: BRIDGE_TOKEN,
    readOnly: READ_ONLY,
    toolsets: ENABLED_TOOLSETS,
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
    maxTilesetPixels: MAX_TILESET_PIXELS,
    maxBridgePayloadBytes: MAX_BRIDGE_PAYLOAD_BYTES,
    maxPendingCommands: MAX_PENDING_COMMANDS,
    compactPaletteChars: COMPACT_PALETTE_CHARACTERS,
    compactTransparentChar: COMPACT_TRANSPARENT_CHAR,
    allowedPaths: ALLOWED_PATHS,
    projectRoot: PROJECT_ROOT,
    serverName: SERVER_NAME,
    serverVersion: SERVER_VERSION,
    protocolVersion: MCP_PROTOCOL_VERSION,
    bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION,
};
export { getAllowedRoots, resolveProjectRoot };
//# sourceMappingURL=config.js.map