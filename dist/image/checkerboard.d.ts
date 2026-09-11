export interface RgbColor {
    r: number;
    g: number;
    b: number;
    a?: number;
}
export type CheckerboardColor = number | string | RgbColor;
export interface CheckerboardOptions {
    cellSize?: number;
    lightColor?: CheckerboardColor;
    darkColor?: CheckerboardColor;
}
/**
 * Normalizes any CheckerboardColor into an RgbColor.
 * Validates hexadecimal strings, finite numbers, and objects; cleanly falls back
 * to defaultVal on non-hex strings, invalid types, or NaN values.
 */
export declare function normalizeCheckerColor(c: CheckerboardColor | undefined, defaultVal: number): RgbColor;
/**
 * Composites an RGBA image onto an alternating light/dark checkerboard backdrop
 * using exact integer Porter-Duff source-over blending.
 *
 * Supports both legacy positional parameters and modern options object.
 */
export declare function applyCheckerboardBackdrop(srcData: Uint8Array, width: number, height: number, cellSizeOrOptions?: number | CheckerboardOptions, legacyLightGray?: number, legacyDarkGray?: number): Uint8Array;
/**
 * Generates an empty standalone checkerboard tile buffer of given dimensions.
 */
export declare function createCheckerboardBuffer(width: number, height: number, options?: CheckerboardOptions): Uint8Array;
//# sourceMappingURL=checkerboard.d.ts.map