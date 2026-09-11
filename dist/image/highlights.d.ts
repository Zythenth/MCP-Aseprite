import { ColorInput } from "./gridOverlay.js";
export interface HighlightRegion {
    /** Unscaled sprite X coordinate of region top-left. */
    x: number;
    /** Unscaled sprite Y coordinate of region top-left. */
    y: number;
    /** Unscaled width of region in sprite pixels. */
    width: number;
    /** Unscaled height of region in sprite pixels. */
    height: number;
    /** Outline stroke color. Default: "#FFD700" (Gold). */
    color?: ColorInput;
    /** Outline thickness in canvas pixels. Default: 2. */
    strokeWidth?: number;
    /** Whether to draw the outline box. Default: true. */
    outline?: boolean;
    /** Fill overlay color. If specified, blends a semi-transparent color wash over region interior. */
    fillColor?: ColorInput;
    /** Fill overlay opacity (0.0 to 1.0). Default: 0.20 if fillColor is defined, else 0. */
    fillOpacity?: number;
}
export interface HighlightPixel {
    /** Unscaled sprite X coordinate of pixel. */
    x: number;
    /** Unscaled sprite Y coordinate of pixel. */
    y: number;
    /** Pixel highlight color. Default: "#00FFFF" (Cyan). */
    color?: ColorInput;
    /** Outline stroke thickness in canvas pixels. Default: 1. */
    strokeWidth?: number;
    /** Whether to draw cell perimeter outline. Default: true. */
    outline?: boolean;
    /** Optional fill color for pixel interior. Defaults to color if fillOpacity > 0. */
    fillColor?: ColorInput;
    /** Fill tint opacity (0.0 to 1.0). Default: 0 (outline only). */
    fillOpacity?: number;
}
export interface CrosshairHighlight {
    /** Unscaled sprite X coordinate of target pixel. */
    x: number;
    /** Unscaled sprite Y coordinate of target pixel. */
    y: number;
    /** Crosshair line color. Default: "#FF3366". */
    color?: ColorInput;
    /** Crosshair line opacity (0.0 to 1.0). Default: 0.6. */
    opacity?: number;
    /** Optional dash pattern [dashLength, gapLength] in canvas pixels. If omitted, solid line. */
    dashPattern?: [number, number];
}
export interface HighlightOptions {
    /** Integer scale multiplier of the target canvas. */
    scale: number;
    /** Width of the original sprite in pixels. If omitted, derived from canvas. */
    spriteWidth?: number;
    /** Height of the original sprite in pixels. If omitted, derived from canvas. */
    spriteHeight?: number;
    /** X offset on canvas where sprite begins (e.g. rulerLeft). Default: 0. */
    offsetX?: number;
    /** Y offset on canvas where sprite begins (e.g. rulerTop). Default: 0. */
    offsetY?: number;
    /** List of rectangular regions to highlight. */
    regions?: HighlightRegion[];
    /** List of individual pixel coordinates to highlight. */
    pixels?: HighlightPixel[];
    /** List of crosshair targets to render. */
    crosshairs?: CrosshairHighlight[];
    /** If true, mutates dstData in place. If false, returns a newly allocated Uint8Array. Default: false. */
    inPlace?: boolean;
}
/**
 * Applies region bounding boxes, tinted overlay fills, pixel cell outlines, and crosshairs
 * onto a scaled RGBA canvas.
 */
export declare function applyHighlights(dstData: Uint8Array, canvasWidth: number, canvasHeight: number, options: HighlightOptions): Uint8Array;
//# sourceMappingURL=highlights.d.ts.map