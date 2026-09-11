// src/image/highlights.ts
import { ColorInput, parseColor } from "./gridOverlay.js";

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
export function applyHighlights(
  dstData: Uint8Array,
  canvasWidth: number,
  canvasHeight: number,
  options: HighlightOptions
): Uint8Array {
  const target = options.inPlace ? dstData : new Uint8Array(dstData);
  const scale = Math.max(1, Math.floor(options.scale));
  const offsetX = options.offsetX ?? 0;
  const offsetY = options.offsetY ?? 0;

  const blendPixel = (idx: number, r: number, g: number, b: number, alpha: number) => {
    if (alpha <= 0) return;
    if (alpha >= 1) {
      target[idx] = r;
      target[idx + 1] = g;
      target[idx + 2] = b;
      target[idx + 3] = 255;
      return;
    }
    const invA = 1 - alpha;
    target[idx] = Math.round(target[idx] * invA + r * alpha);
    target[idx + 1] = Math.round(target[idx + 1] * invA + g * alpha);
    target[idx + 2] = Math.round(target[idx + 2] * invA + b * alpha);
    target[idx + 3] = 255;
  };

  // 1. Render Region Tinted Fills (Layer 1)
  if (options.regions) {
    for (const reg of options.regions) {
      if (reg.width <= 0 || reg.height <= 0) continue;
      const fillOpacity = reg.fillOpacity ?? (reg.fillColor ? 0.20 : 0);
      if (fillOpacity <= 0) continue;

      const fillColor = parseColor(reg.fillColor ?? reg.color ?? "#FFD700", fillOpacity);

      const minX = Math.max(0, offsetX + reg.x * scale);
      const minY = Math.max(0, offsetY + reg.y * scale);
      const maxX = Math.min(canvasWidth - 1, offsetX + (reg.x + reg.width) * scale - 1);
      const maxY = Math.min(canvasHeight - 1, offsetY + (reg.y + reg.height) * scale - 1);

      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          blendPixel((y * canvasWidth + x) * 4, fillColor.r, fillColor.g, fillColor.b, fillColor.a);
        }
      }
    }
  }

  // 2. Render Pixel Tinted Fills (Layer 2)
  if (options.pixels) {
    for (const px of options.pixels) {
      const fillOpacity = px.fillOpacity ?? 0;
      if (fillOpacity <= 0) continue;

      const fillColor = parseColor(px.fillColor ?? px.color ?? "#00FFFF", fillOpacity);
      const minX = Math.max(0, offsetX + px.x * scale);
      const minY = Math.max(0, offsetY + px.y * scale);
      const maxX = Math.min(canvasWidth - 1, offsetX + (px.x + 1) * scale - 1);
      const maxY = Math.min(canvasHeight - 1, offsetY + (px.y + 1) * scale - 1);

      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          blendPixel((y * canvasWidth + x) * 4, fillColor.r, fillColor.g, fillColor.b, fillColor.a);
        }
      }
    }
  }

  // 3. Render Region Outlines (Layer 3)
  if (options.regions) {
    for (const reg of options.regions) {
      if (reg.width <= 0 || reg.height <= 0) continue;
      if (reg.outline === false) continue;

      const strokeWidth = Math.max(1, reg.strokeWidth ?? 2);
      const strokeColor = parseColor(reg.color ?? "#FFD700", 1.0);

      const innerMinX = offsetX + reg.x * scale;
      const innerMinY = offsetY + reg.y * scale;
      const innerMaxX = offsetX + (reg.x + reg.width) * scale - 1;
      const innerMaxY = offsetY + (reg.y + reg.height) * scale - 1;

      // Stroke outward from bounding box
      for (let t = 0; t < strokeWidth; t++) {
        const curMinX = Math.max(0, innerMinX - t);
        const curMaxX = Math.min(canvasWidth - 1, innerMaxX + t);
        const topY = innerMinY - t;
        const btmY = innerMaxY + t;

        // Top & bottom horizontal stroke segments
        if (topY >= 0 && topY < canvasHeight) {
          for (let x = curMinX; x <= curMaxX; x++) {
            blendPixel((topY * canvasWidth + x) * 4, strokeColor.r, strokeColor.g, strokeColor.b, strokeColor.a);
          }
        }
        if (btmY >= 0 && btmY < canvasHeight) {
          for (let x = curMinX; x <= curMaxX; x++) {
            blendPixel((btmY * canvasWidth + x) * 4, strokeColor.r, strokeColor.g, strokeColor.b, strokeColor.a);
          }
        }

        // Left & right vertical stroke segments
        const curMinY = Math.max(0, innerMinY - t);
        const curMaxY = Math.min(canvasHeight - 1, innerMaxY + t);
        const leftX = innerMinX - t;
        const rightX = innerMaxX + t;

        if (leftX >= 0 && leftX < canvasWidth) {
          for (let y = curMinY; y <= curMaxY; y++) {
            blendPixel((y * canvasWidth + leftX) * 4, strokeColor.r, strokeColor.g, strokeColor.b, strokeColor.a);
          }
        }
        if (rightX >= 0 && rightX < canvasWidth) {
          for (let y = curMinY; y <= curMaxY; y++) {
            blendPixel((y * canvasWidth + rightX) * 4, strokeColor.r, strokeColor.g, strokeColor.b, strokeColor.a);
          }
        }
      }
    }
  }

  // 4. Render Pixel Outlines (Layer 4)
  if (options.pixels) {
    for (const px of options.pixels) {
      if (px.outline === false) continue;

      const strokeWidth = Math.max(1, px.strokeWidth ?? 1);
      const strokeColor = parseColor(px.color ?? "#00FFFF", 1.0);

      const cellMinX = offsetX + px.x * scale;
      const cellMinY = offsetY + px.y * scale;
      const cellMaxX = offsetX + (px.x + 1) * scale - 1;
      const cellMaxY = offsetY + (px.y + 1) * scale - 1;

      // Draw perimeter outline inside cell bounds
      for (let t = 0; t < strokeWidth; t++) {
        const topY = cellMinY + t;
        const btmY = cellMaxY - t;
        const leftX = cellMinX + t;
        const rightX = cellMaxX - t;

        if (topY >= 0 && topY < canvasHeight) {
          for (let x = Math.max(0, cellMinX); x <= Math.min(canvasWidth - 1, cellMaxX); x++) {
            blendPixel((topY * canvasWidth + x) * 4, strokeColor.r, strokeColor.g, strokeColor.b, strokeColor.a);
          }
        }
        if (btmY >= 0 && btmY < canvasHeight && btmY !== topY) {
          for (let x = Math.max(0, cellMinX); x <= Math.min(canvasWidth - 1, cellMaxX); x++) {
            blendPixel((btmY * canvasWidth + x) * 4, strokeColor.r, strokeColor.g, strokeColor.b, strokeColor.a);
          }
        }
        if (leftX >= 0 && leftX < canvasWidth) {
          for (let y = Math.max(0, cellMinY); y <= Math.min(canvasHeight - 1, cellMaxY); y++) {
            blendPixel((y * canvasWidth + leftX) * 4, strokeColor.r, strokeColor.g, strokeColor.b, strokeColor.a);
          }
        }
        if (rightX >= 0 && rightX < canvasWidth && rightX !== leftX) {
          for (let y = Math.max(0, cellMinY); y <= Math.min(canvasHeight - 1, cellMaxY); y++) {
            blendPixel((y * canvasWidth + rightX) * 4, strokeColor.r, strokeColor.g, strokeColor.b, strokeColor.a);
          }
        }
      }
    }
  }

  // 5. Render Crosshairs (Layer 5)
  if (options.crosshairs) {
    for (const ch of options.crosshairs) {
      const color = parseColor(ch.color ?? "#FF3366", ch.opacity ?? 0.6);
      const cx = offsetX + ch.x * scale + Math.floor(scale / 2);
      const cy = offsetY + ch.y * scale + Math.floor(scale / 2);

      const [dashLen, gapLen] = ch.dashPattern ?? [0, 0];
      const isDashed = dashLen > 0 && gapLen > 0;
      const period = dashLen + gapLen;

      // Horizontal crosshair
      if (cy >= 0 && cy < canvasHeight) {
        for (let x = 0; x < canvasWidth; x++) {
          if (isDashed && (x % period) >= dashLen) continue;
          blendPixel((cy * canvasWidth + x) * 4, color.r, color.g, color.b, color.a);
        }
      }

      // Vertical crosshair
      if (cx >= 0 && cx < canvasWidth) {
        for (let y = 0; y < canvasHeight; y++) {
          if (isDashed && (y % period) >= dashLen) continue;
          blendPixel((y * canvasWidth + cx) * 4, color.r, color.g, color.b, color.a);
        }
      }
    }
  }

  return target;
}
