// src/image/preview.ts
import { generatePixelGridPreview as generatePreview, VisualInspectionOptions } from "./index.js";

export interface PixelGridPreviewOptions {
  scale?: number;
  showGrid?: boolean;
  showCoordinates?: boolean;
  checkerboard?: boolean;
  highlightRegion?: { x: number; y: number; width: number; height: number };
  highlightPixels?: Array<{ x: number; y: number }>;
}

/**
 * Generates an enhanced pixel-art preview with nearest-neighbor scaling,
 * pixel grid separators, coordinate rulers, and region highlights.
 * Delegates to the unified image pipeline in src/image/index.ts.
 */
export function generatePixelGridPreview(
  rawRgba: Uint8Array,
  spriteWidth: number,
  spriteHeight: number,
  options: PixelGridPreviewOptions = {}
): { buffer: Buffer; base64: string; width: number; height: number } {
  return generatePreview(rawRgba, spriteWidth, spriteHeight, options as VisualInspectionOptions);
}
