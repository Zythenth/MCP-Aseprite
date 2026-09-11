import { encodeRgbaToPngBase64 } from "./png.js";
import { scaleNearestNeighbor } from "./scaling.js";
import { applyCheckerboardBackdrop, CheckerboardColor } from "./checkerboard.js";
import { applyGridOverlay, ColorInput } from "./gridOverlay.js";
import { attachCoordinateRulers } from "./rulers.js";
import { applyHighlights, HighlightRegion, HighlightPixel, CrosshairHighlight } from "./highlights.js";
import { normalizeCelToCanvas, CelBounds, CanvasDimensions } from "./normalizer.js";

// Re-export all submodules
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
export function renderVisualInspection(
  sourceData: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  options: VisualInspectionOptions = {}
): VisualInspectionResult {
  let canvasData = sourceData;
  let spriteW = sourceWidth;
  let spriteH = sourceHeight;

  // 1. Cel-to-Canvas Normalization (if cel bounds provided)
  if (options.celBounds && options.canvasDimensions) {
    canvasData = normalizeCelToCanvas(
      { bounds: options.celBounds, pixels: sourceData },
      options.canvasDimensions
    );
    spriteW = options.canvasDimensions.width;
    spriteH = options.canvasDimensions.height;
  }

  // 2. Checkerboard Backdrop for Transparency
  const useCheckerboard = options.checkerboard ?? true;
  const backdropData = useCheckerboard
    ? applyCheckerboardBackdrop(canvasData, spriteW, spriteH, {
        cellSize: options.checkerboardCellSize ?? 8,
        lightColor: options.checkerboardLight ?? 204,
        darkColor: options.checkerboardDark ?? 153,
      })
    : canvasData;

  // 3. Nearest-Neighbor Integer Scaling
  const scale = Math.max(1, Math.floor(options.scale ?? 16));
  const scaled = scaleNearestNeighbor(backdropData, spriteW, spriteH, scale);

  // 4. Pixel Grid Lines (applied in-place to scaled image)
  const showGrid = options.showGrid ?? true;
  if (showGrid && scale >= 4) {
    applyGridOverlay(scaled.data, scaled.width, scaled.height, {
      scale,
      spriteWidth: spriteW,
      spriteHeight: spriteH,
      opacity: options.gridAlpha,
      color: options.gridColor,
      inPlace: true,
    });
  }

  // 5. Region and Pixel Highlights
  const regions: HighlightRegion[] = [];
  if (options.highlightRegion) {
    regions.push(options.highlightRegion);
  }
  if (options.highlightRegions) {
    regions.push(...options.highlightRegions);
  }

  const pixels: HighlightPixel[] = [];
  if (options.highlightPixel) {
    pixels.push(options.highlightPixel);
  }
  if (options.highlightPixels) {
    pixels.push(...options.highlightPixels);
  }

  if (regions.length > 0 || pixels.length > 0 || options.crosshairs) {
    applyHighlights(scaled.data, scaled.width, scaled.height, {
      scale,
      spriteWidth: spriteW,
      spriteHeight: spriteH,
      regions: regions.length > 0 ? regions : undefined,
      pixels: pixels.length > 0 ? pixels : undefined,
      crosshairs: options.crosshairs,
      inPlace: true,
    });
  }

  // 6. Coordinate Rulers
  const showCoordinates = options.showCoordinates ?? (scale >= 12);
  let finalData = scaled.data;
  let finalWidth = scaled.width;
  let finalHeight = scaled.height;
  let rulerOffset = 0;

  if (showCoordinates) {
    const ruled = attachCoordinateRulers(scaled.data, spriteW, spriteH, scale, {
      step: options.rulerStep,
      font: options.rulerFont,
    });
    finalData = ruled.data;
    finalWidth = ruled.width;
    finalHeight = ruled.height;
    rulerOffset = ruled.rulerTop;
  }

  // 7. Pure-JS PNG Encoding
  const { buffer, base64 } = encodeRgbaToPngBase64(finalData, finalWidth, finalHeight);

  return {
    buffer,
    base64,
    mimeType: "image/png",
    width: finalWidth,
    height: finalHeight,
    spriteWidth: spriteW,
    spriteHeight: spriteH,
    scale,
    rulerOffset,
  };
}

/**
 * Backward-compatibility wrapper matching the original preview.ts signature.
 */
export function generatePixelGridPreview(
  rawRgba: Uint8Array,
  spriteWidth: number,
  spriteHeight: number,
  options: VisualInspectionOptions = {}
): { buffer: Buffer; base64: string; width: number; height: number } {
  const result = renderVisualInspection(rawRgba, spriteWidth, spriteHeight, options);
  return {
    buffer: result.buffer,
    base64: result.base64,
    width: result.width,
    height: result.height,
  };
}
