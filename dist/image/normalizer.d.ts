export interface Point {
    x: number;
    y: number;
}
export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface CanvasDimensions {
    width: number;
    height: number;
}
export interface CelBounds extends Rect {
}
export interface CelData {
    bounds: CelBounds;
    pixels: Uint8Array;
}
export interface OverlapWindow {
    canvasX: number;
    canvasY: number;
    width: number;
    height: number;
    celOffsetX: number;
    celOffsetY: number;
}
export interface NormalizerOptions {
    clearColor?: {
        r: number;
        g: number;
        b: number;
        a: number;
    };
}
/**
 * Computes the geometric intersection between cel bounds and canvas bounds.
 * Returns null if the cel does not overlap the canvas at all.
 */
export declare function computeOverlap(celBounds: CelBounds, canvas: CanvasDimensions): OverlapWindow | null;
/**
 * Translates canvas coordinates to cel-local coordinates.
 */
export declare function canvasToCel(canvasPoint: Point, celBounds: CelBounds): Point;
/**
 * Translates cel-local coordinates to canvas coordinates.
 */
export declare function celToCanvas(celPoint: Point, celBounds: CelBounds): Point;
/**
 * Checks whether a canvas coordinate falls inside the cel's bounding box.
 */
export declare function isInsideCel(canvasPoint: Point, celBounds: CelBounds): boolean;
/**
 * Checks whether a point is within the canvas boundaries.
 */
export declare function isInsideCanvas(point: Point, canvas: CanvasDimensions): boolean;
/**
 * Normalizes an arbitrary Cel pixel buffer onto a full canvas RGBA buffer.
 * Non-overlapping areas are padded with transparent pixels (#00000000).
 * Cels extending outside canvas dimensions are cleanly clipped.
 */
export declare function normalizeCelToCanvas(cel: CelData, canvas: CanvasDimensions, options?: NormalizerOptions): Uint8Array;
/**
 * Expands a cel to full canvas dimensions (mirrors Aseprite ensureCanvasSizedCel).
 */
export declare function expandCelToCanvas(cel: CelData, canvas: CanvasDimensions): CelData;
/**
 * Trims an RGBA canvas buffer down to the minimum bounding box containing non-transparent pixels.
 */
export declare function trimCanvasToCel(canvasBuffer: Uint8Array, canvas: CanvasDimensions): CelData;
//# sourceMappingURL=normalizer.d.ts.map