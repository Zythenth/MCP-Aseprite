import { CheckerboardColor } from "./checkerboard.js";
import { ColorInput } from "./gridOverlay.js";
import { HighlightRegion, HighlightPixel, CrosshairHighlight } from "./highlights.js";
import { CelBounds, CanvasDimensions } from "./normalizer.js";
export * from "./png.js";
export * from "./scaling.js";
export * from "./checkerboard.js";
export * from "./gridOverlay.js";
export * from "./rulers.js";
export * from "./highlights.js";
export * from "./normalizer.js";
export * from "./compact.js";
export type { RgbColor } from "./checkerboard.js";
export interface VisualInspectionOptions {
    /** Nearest-neighbor integer scale multiplier (e.g. 4, 8, 16). Default: 16. */
    scale?: number;
    /** Whether to apply checkerboard backdrop behind transparent pixels. Default: true. */
    checkerboard?: boolean;
    /** Checkerboard cell tile size in pixels. Default: 8. */
    checkerboardCellSize?: number;
    /** Checkerboard light tile color. Default: 204 (#CCCCCC). */
    checkerboardLight?: CheckerboardColor;
    /** Checkerboard dark tile color. Default: 153 (#999999). */
    checkerboardDark?: CheckerboardColor;
    /** Whether to draw 1px pixel grid boundary lines. Default: true. */
    showGrid?: boolean;
    /** Grid line opacity (0.0 to 1.0). */
    gridAlpha?: number;
    /** Grid line color. */
    gridColor?: ColorInput;
    /** Whether to attach top and left coordinate rulers with micro-font. Default: scale >= 12. */
    showCoordinates?: boolean;
    /** Coordinate stepping interval (e.g. 1, 5, 10). If omitted, dynamic collision-free step is used. */
    rulerStep?: number;
    /** Rulers micro-font: "3x5" or "5x7". Default: "3x5". */
    rulerFont?: "3x5" | "5x7";
    /** Single rectangular bounding box to highlight. */
    highlightRegion?: HighlightRegion;
    /** Multiple rectangular bounding boxes to highlight. */
    highlightRegions?: HighlightRegion[];
    /** Single pixel coordinate to highlight. */
    highlightPixel?: HighlightPixel;
    /** Multiple pixel coordinates to highlight. */
    highlightPixels?: HighlightPixel[];
    /** Crosshairs to render. */
    crosshairs?: CrosshairHighlight[];
    /** Cel bounding box for automatic cel-to-canvas normalization. */
    celBounds?: CelBounds;
    /** Total canvas dimensions for cel normalization. */
    canvasDimensions?: CanvasDimensions;
}
export interface VisualInspectionResult {
    buffer: Buffer;
    base64: string;
    mimeType: "image/png";
    width: number;
    height: number;
    spriteWidth: number;
    spriteHeight: number;
    scale: number;
    rulerOffset: number;
}
/**
 * Unified high-level visual inspection image pipeline.
 * Composes cel normalization, transparency checkerboard, nearest-neighbor scaling,
 * 1px pixel grid separators, coordinate rulers, and region/pixel highlights into a PNG.
 */
export declare function renderVisualInspection(sourceData: Uint8Array, sourceWidth: number, sourceHeight: number, options?: VisualInspectionOptions): VisualInspectionResult;
/**
 * Backward-compatibility wrapper matching the original preview.ts signature.
 */
export declare function generatePixelGridPreview(rawRgba: Uint8Array, spriteWidth: number, spriteHeight: number, options?: VisualInspectionOptions): {
    buffer: Buffer;
    base64: string;
    width: number;
    height: number;
};
//# sourceMappingURL=index.d.ts.map