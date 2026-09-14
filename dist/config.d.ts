import { getAllowedRoots, resolveProjectRoot } from "./security/fileAccess.js";
import { BRIDGE_PROTOCOL_VERSION } from "./bridge/protocol.js";
export declare const DEFAULT_PORT = 32123;
export declare const DEFAULT_WS_PORT = 32123;
export declare const DEFAULT_HOST = "127.0.0.1";
export declare const DEFAULT_COMMAND_TIMEOUT_MS = 8000;
export declare const HEAVY_COMMAND_TIMEOUT_MS = 15000;
export declare const WS_HEARTBEAT_INTERVAL_MS = 15000;
export declare const WS_HEARTBEAT_TIMEOUT_MS = 30000;
export declare const DEFAULT_SCALE = 8;
export declare const MIN_SCALE = 1;
export declare const MAX_SCALE = 64;
export declare const GRID_MIN_SCALE = 6;
export declare const RULER_MIN_SCALE = 8;
export declare const RULER_TOP_HEIGHT_PX = 20;
export declare const RULER_LEFT_WIDTH_PX = 24;
export declare const CHECKERBOARD_CELL_SIZE = 8;
export declare const MAX_CANVAS_DIMENSION = 4096;
export declare const MAX_PIXELS_BATCH = 100000;
export declare const MAX_TILESET_PIXELS = 16777216;
export declare const MAX_BRIDGE_PAYLOAD_BYTES: number;
export declare const MAX_PENDING_COMMANDS = 128;
export declare const MAX_ANIMATION_BATCH_OPERATIONS = 64;
export declare const MAX_ANIMATION_BATCH_FRAMES = 64;
export declare const MAX_ANIMATION_BATCH_PAYLOAD_BYTES: number;
export declare const COMPACT_PALETTE_CHARACTERS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export declare const COMPACT_TRANSPARENT_CHAR = ".";
export declare const SERVER_NAME = "aseprite-mcp";
export declare const SERVER_VERSION = "0.1.0";
export declare const MCP_PROTOCOL_VERSION = "2024-11-05";
export { BRIDGE_PROTOCOL_VERSION };
export declare const MIN_PORT = 1024;
export declare const MAX_PORT = 65535;
/**
 * Minimum allowable command timeout in milliseconds (100 ms).
 * Prevents zero/negative or impractically short timeouts.
 */
export declare const MIN_COMMAND_TIMEOUT_MS = 100;
/**
 * Maximum allowable command timeout in milliseconds (300,000 ms = 5 minutes).
 * Accommodates heavy batch operations while preventing indefinite hangs.
 */
export declare const MAX_COMMAND_TIMEOUT_MS = 300000;
/**
 * Strictly parses a port from an environment string.
 * Fails fast with an actionable Error if the input is explicitly provided but not a valid base-10 integer in 1024..65535.
 * Falls back to defaultVal only when the input is absent (undefined) or blank (empty/whitespace-only).
 */
export declare function parsePort(val: string | undefined, defaultVal?: number): number;
/**
 * Strictly parses a duration in milliseconds from an environment string.
 * Fails fast with an actionable Error if the input is explicitly provided but not a valid base-10 integer in MIN_COMMAND_TIMEOUT_MS..MAX_COMMAND_TIMEOUT_MS.
 * Falls back to defaultVal only when the input is absent (undefined) or blank (empty/whitespace-only).
 */
export declare function parseCommandTimeout(val: string | undefined, defaultVal?: number): number;
export declare const BRIDGE_TOKEN_REGEX: RegExp;
export declare const TOOLSETS: readonly ["core", "visual", "editing", "files", "shapes", "layers", "frames", "palette", "cels", "slices", "selection", "tiles", "animation", "pixel-art", "review"];
export type Toolset = typeof TOOLSETS[number];
export declare function parseBooleanEnv(name: string, value: string | undefined, defaultValue?: boolean): boolean;
export declare function parseToolsets(value: string | undefined): Toolset[];
export declare function parseBridgeToken(val: string | undefined): string | undefined;
export declare function resolvePortEnv(): string | undefined;
export declare const PORT: number;
export declare const HOST: string;
export declare const COMMAND_TIMEOUT_MS: number;
export declare const ALLOWED_PATHS: string[];
export declare const PROJECT_ROOT: string;
export declare const BRIDGE_TOKEN: string | undefined;
export declare const READ_ONLY: boolean;
export declare const ENABLED_TOOLSETS: ("core" | "visual" | "editing" | "files" | "shapes" | "layers" | "frames" | "palette" | "cels" | "slices" | "selection" | "tiles" | "animation" | "pixel-art" | "review")[];
export declare const config: {
    readonly port: number;
    readonly host: string;
    readonly commandTimeoutMs: number;
    readonly heavyCommandTimeoutMs: 15000;
    readonly bridgeToken: string | undefined;
    readonly readOnly: boolean;
    readonly toolsets: ("core" | "visual" | "editing" | "files" | "shapes" | "layers" | "frames" | "palette" | "cels" | "slices" | "selection" | "tiles" | "animation" | "pixel-art" | "review")[];
    readonly wsHeartbeatIntervalMs: 15000;
    readonly wsHeartbeatTimeoutMs: 30000;
    readonly defaultScale: 8;
    readonly minScale: 1;
    readonly maxScale: 64;
    readonly gridMinScale: 6;
    readonly rulerMinScale: 8;
    readonly rulerTopHeightPx: 20;
    readonly rulerLeftWidthPx: 24;
    readonly checkerboardCellSize: 8;
    readonly maxCanvasDimension: 4096;
    readonly maxPixelsBatch: 100000;
    readonly maxTilesetPixels: 16777216;
    readonly maxBridgePayloadBytes: number;
    readonly maxPendingCommands: 128;
    readonly maxAnimationBatchOperations: 64;
    readonly maxAnimationBatchFrames: 64;
    readonly maxAnimationBatchPayloadBytes: number;
    readonly compactPaletteChars: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    readonly compactTransparentChar: ".";
    readonly allowedPaths: string[];
    readonly projectRoot: string;
    readonly serverName: "aseprite-mcp";
    readonly serverVersion: "0.1.0";
    readonly protocolVersion: "2024-11-05";
    readonly bridgeProtocolVersion: "1.2.0";
};
export { getAllowedRoots, resolveProjectRoot };
//# sourceMappingURL=config.d.ts.map