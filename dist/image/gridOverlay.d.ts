import type { RgbColor } from "./checkerboard.js";
export type { RgbColor };
export type ColorInput = string | RgbColor;
export interface GridOverlayOptions {
    /** Nearest-neighbor integer scale multiplier (e.g. 4, 8, 16). */
    scale: number;
    /** Width of the original sprite in unscaled pixels. If omitted, derived from (width - offsetX) / scale. */
    spriteWidth?: number;
    /** Height of the original sprite in unscaled pixels. If omitted, derived from (height - offsetY) / scale. */
    spriteHeight?: number;
    /** Grid line color. Defaults to white: { r: 255, g: 255, b: 255 }. */
    color?: ColorInput;
    /** Grid line opacity (0.0 to 1.0). If omitted, adaptive: 0.35 if scale >= 8, else 0.20. */
    opacity?: number;
    /** Minimum scale factor required to render grid lines. Default: 4. */
    minScale?: number;
    /** X offset on destination canvas in pixels (e.g. rulerLeft). Default: 0. */
    offsetX?: number;
    /** Y offset on destination canvas in pixels (e.g. rulerTop). Default: 0. */
    offsetY?: number;
    /** Whether to draw the outer border bounding the sprite canvas. Default: true. */
    includeOuterBorders?: boolean;
    /** If true, mutates dstData in place. If false, returns a newly allocated Uint8Array. Default: false. */
    inPlace?: boolean;
}
/**
 * Parses Hex (#RGB, #RGBA, #RRGGBB, #RRGGBBAA) or RgbColor into normalized RGBA components.
 */
export declare function parseColor(color?: ColorInput, defaultAlpha?: number): {
    r: number;
    g: number;
    b: number;
    a: number;
};
/**
 * Draws 1px grid lines at pixel boundaries on an integer-scaled RGBA canvas.
 */
export declare function applyGridOverlay(dstData: Uint8Array, width: number, height: number, options: GridOverlayOptions): Uint8Array;
//# sourceMappingURL=gridOverlay.d.ts.map