// src/image/checkerboard.ts
import { InvalidDimensionError, BufferSizeMismatchError } from "./png.js";
/**
 * Normalizes any CheckerboardColor into an RgbColor.
 * Validates hexadecimal strings, finite numbers, and objects; cleanly falls back
 * to defaultVal on non-hex strings, invalid types, or NaN values.
 */
export function normalizeCheckerColor(c, defaultVal) {
    const fallbackVal = Number.isFinite(defaultVal)
        ? Math.max(0, Math.min(255, Math.floor(defaultVal)))
        : 0;
    if (typeof c === "number" && Number.isFinite(c)) {
        const v = Math.max(0, Math.min(255, Math.floor(c)));
        return { r: v, g: v, b: v };
    }
    if (typeof c === "string") {
        const clean = c.trim().replace(/^#/, "");
        if (/^[0-9a-fA-F]{3}$/.test(clean)) {
            const r = parseInt(clean[0] + clean[0], 16);
            const g = parseInt(clean[1] + clean[1], 16);
            const b = parseInt(clean[2] + clean[2], 16);
            if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
                return { r, g, b };
            }
        }
        else if (/^[0-9a-fA-F]{6,}$/.test(clean)) {
            const r = parseInt(clean.substring(0, 2), 16);
            const g = parseInt(clean.substring(2, 4), 16);
            const b = parseInt(clean.substring(4, 6), 16);
            if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
                return { r, g, b };
            }
        }
    }
    if (c &&
        typeof c === "object" &&
        typeof c.r === "number" &&
        Number.isFinite(c.r) &&
        typeof c.g === "number" &&
        Number.isFinite(c.g) &&
        typeof c.b === "number" &&
        Number.isFinite(c.b)) {
        return {
            r: Math.max(0, Math.min(255, Math.floor(c.r))),
            g: Math.max(0, Math.min(255, Math.floor(c.g))),
            b: Math.max(0, Math.min(255, Math.floor(c.b))),
        };
    }
    return { r: fallbackVal, g: fallbackVal, b: fallbackVal };
}
/**
 * Packs RgbColor into little-endian 32-bit RGBA integer (0xFF_BB_GG_RR).
 */
function packRgba32(color, alpha = 255) {
    return (((alpha & 0xff) << 24) | ((color.b & 0xff) << 16) | ((color.g & 0xff) << 8) | (color.r & 0xff)) >>> 0;
}
/**
 * Composites an RGBA image onto an alternating light/dark checkerboard backdrop
 * using exact integer Porter-Duff source-over blending.
 *
 * Supports both legacy positional parameters and modern options object.
 */
export function applyCheckerboardBackdrop(srcData, width, height, cellSizeOrOptions, legacyLightGray, legacyDarkGray) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
        throw new InvalidDimensionError(width, height);
    }
    const expectedBytes = width * height * 4;
    if (srcData.length < expectedBytes) {
        throw new BufferSizeMismatchError(expectedBytes, srcData.length);
    }
    // Parse options
    let cellSize = 8;
    let lightColor = normalizeCheckerColor(undefined, 204);
    let darkColor = normalizeCheckerColor(undefined, 153);
    if (typeof cellSizeOrOptions === "number") {
        cellSize = Math.max(1, Math.floor(cellSizeOrOptions));
        lightColor = normalizeCheckerColor(legacyLightGray, 204);
        darkColor = normalizeCheckerColor(legacyDarkGray, 153);
    }
    else if (cellSizeOrOptions && typeof cellSizeOrOptions === "object") {
        if (cellSizeOrOptions.cellSize !== undefined) {
            cellSize = Math.max(1, Math.floor(cellSizeOrOptions.cellSize));
        }
        lightColor = normalizeCheckerColor(cellSizeOrOptions.lightColor, 204);
        darkColor = normalizeCheckerColor(cellSizeOrOptions.darkColor, 153);
    }
    const outBuffer = new ArrayBuffer(expectedBytes);
    const out32 = new Uint32Array(outBuffer);
    const alignedSrc = srcData.byteOffset % 4 === 0
        ? srcData
        : new Uint8Array(srcData.subarray(0, expectedBytes));
    const src32 = new Uint32Array(alignedSrc.buffer, alignedSrc.byteOffset, width * height);
    const light32 = packRgba32(lightColor, 255);
    const dark32 = packRgba32(darkColor, 255);
    const isPowerOfTwo = (cellSize & (cellSize - 1)) === 0;
    const shift = isPowerOfTwo ? Math.log2(cellSize) : 0;
    for (let y = 0; y < height; y++) {
        const yTile = isPowerOfTwo ? (y >> shift) : Math.floor(y / cellSize);
        const rowOffset = y * width;
        for (let x = 0; x < width; x++) {
            const xTile = isPowerOfTwo ? (x >> shift) : Math.floor(x / cellSize);
            const isLight = ((xTile ^ yTile) & 1) === 0;
            const bg32 = isLight ? light32 : dark32;
            const bg = isLight ? lightColor : darkColor;
            const idx = rowOffset + x;
            const pixel = src32[idx];
            const alpha = (pixel >>> 24) & 0xff;
            if (alpha === 255) {
                // Fast path 1: Fully opaque
                out32[idx] = pixel;
            }
            else if (alpha === 0) {
                // Fast path 2: Fully transparent
                out32[idx] = bg32;
            }
            else {
                // Path 3: Exact Porter-Duff Source-Over blend onto opaque background
                const invA = 255 - alpha;
                const r = pixel & 0xff;
                const g = (pixel >>> 8) & 0xff;
                const b = (pixel >>> 16) & 0xff;
                const outR = ((r * alpha + bg.r * invA + 127) / 255) | 0;
                const outG = ((g * alpha + bg.g * invA + 127) / 255) | 0;
                const outB = ((b * alpha + bg.b * invA + 127) / 255) | 0;
                out32[idx] = ((255 << 24) | (outB << 16) | (outG << 8) | outR) >>> 0;
            }
        }
    }
    return new Uint8Array(outBuffer);
}
/**
 * Generates an empty standalone checkerboard tile buffer of given dimensions.
 */
export function createCheckerboardBuffer(width, height, options = {}) {
    const empty = new Uint8Array(width * height * 4); // all zeros (alpha = 0)
    return applyCheckerboardBackdrop(empty, width, height, options);
}
//# sourceMappingURL=checkerboard.js.map