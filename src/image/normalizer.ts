// src/image/normalizer.ts

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

export interface CelBounds extends Rect {}

export interface CelData {
  bounds: CelBounds;
  pixels: Uint8Array; // RGBA buffer (bounds.width * bounds.height * 4)
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
  clearColor?: { r: number; g: number; b: number; a: number };
}

/**
 * Computes the geometric intersection between cel bounds and canvas bounds.
 * Returns null if the cel does not overlap the canvas at all.
 */
export function computeOverlap(
  celBounds: CelBounds,
  canvas: CanvasDimensions
): OverlapWindow | null {
  if (celBounds.width <= 0 || celBounds.height <= 0 || canvas.width <= 0 || canvas.height <= 0) {
    return null;
  }

  const xLeft = Math.max(0, celBounds.x);
  const yTop = Math.max(0, celBounds.y);
  const xRight = Math.min(canvas.width, celBounds.x + celBounds.width);
  const yBottom = Math.min(canvas.height, celBounds.y + celBounds.height);

  if (xRight <= xLeft || yBottom <= yTop) {
    return null;
  }

  return {
    canvasX: xLeft,
    canvasY: yTop,
    width: xRight - xLeft,
    height: yBottom - yTop,
    celOffsetX: xLeft - celBounds.x,
    celOffsetY: yTop - celBounds.y,
  };
}

/**
 * Translates canvas coordinates to cel-local coordinates.
 */
export function canvasToCel(canvasPoint: Point, celBounds: CelBounds): Point {
  return {
    x: canvasPoint.x - celBounds.x,
    y: canvasPoint.y - celBounds.y,
  };
}

/**
 * Translates cel-local coordinates to canvas coordinates.
 */
export function celToCanvas(celPoint: Point, celBounds: CelBounds): Point {
  return {
    x: celPoint.x + celBounds.x,
    y: celPoint.y + celBounds.y,
  };
}

/**
 * Checks whether a canvas coordinate falls inside the cel's bounding box.
 */
export function isInsideCel(canvasPoint: Point, celBounds: CelBounds): boolean {
  const localX = canvasPoint.x - celBounds.x;
  const localY = canvasPoint.y - celBounds.y;
  return localX >= 0 && localX < celBounds.width && localY >= 0 && localY < celBounds.height;
}

/**
 * Checks whether a point is within the canvas boundaries.
 */
export function isInsideCanvas(point: Point, canvas: CanvasDimensions): boolean {
  return point.x >= 0 && point.x < canvas.width && point.y >= 0 && point.y < canvas.height;
}

/**
 * Normalizes an arbitrary Cel pixel buffer onto a full canvas RGBA buffer.
 * Non-overlapping areas are padded with transparent pixels (#00000000).
 * Cels extending outside canvas dimensions are cleanly clipped.
 */
export function normalizeCelToCanvas(
  cel: CelData,
  canvas: CanvasDimensions,
  options?: NormalizerOptions
): Uint8Array {
  const canvasBufferSize = canvas.width * canvas.height * 4;
  const dst = new Uint8Array(canvasBufferSize);

  // Apply optional non-zero clear color
  if (options?.clearColor) {
    const { r, g, b, a } = options.clearColor;
    for (let i = 0; i < canvasBufferSize; i += 4) {
      dst[i] = r;
      dst[i + 1] = g;
      dst[i + 2] = b;
      dst[i + 3] = a;
    }
  }

  const overlap = computeOverlap(cel.bounds, canvas);
  if (!overlap) {
    return dst;
  }

  const celW = cel.bounds.width;
  const canW = canvas.width;
  const copyBytesPerRow = overlap.width * 4;

  for (let r = 0; r < overlap.height; r++) {
    const srcRow = overlap.celOffsetY + r;
    const dstRow = overlap.canvasY + r;

    const srcOffset = (srcRow * celW + overlap.celOffsetX) * 4;
    const dstOffset = (dstRow * canW + overlap.canvasX) * 4;

    dst.set(cel.pixels.subarray(srcOffset, srcOffset + copyBytesPerRow), dstOffset);
  }

  return dst;
}

/**
 * Expands a cel to full canvas dimensions (mirrors Aseprite ensureCanvasSizedCel).
 */
export function expandCelToCanvas(cel: CelData, canvas: CanvasDimensions): CelData {
  return {
    bounds: { x: 0, y: 0, width: canvas.width, height: canvas.height },
    pixels: normalizeCelToCanvas(cel, canvas),
  };
}

/**
 * Trims an RGBA canvas buffer down to the minimum bounding box containing non-transparent pixels.
 */
export function trimCanvasToCel(canvasBuffer: Uint8Array, canvas: CanvasDimensions): CelData {
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < canvas.height; y++) {
    const rowOffset = y * canvas.width * 4;
    for (let x = 0; x < canvas.width; x++) {
      const a = canvasBuffer[rowOffset + x * 4 + 3];
      if (a > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX === -1) {
    // Completely transparent
    return {
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      pixels: new Uint8Array(0),
    };
  }

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const trimmed = new Uint8Array(width * height * 4);

  for (let r = 0; r < height; r++) {
    const srcOffset = ((minY + r) * canvas.width + minX) * 4;
    const dstOffset = r * width * 4;
    trimmed.set(canvasBuffer.subarray(srcOffset, srcOffset + width * 4), dstOffset);
  }

  return {
    bounds: { x: minX, y: minY, width, height },
    pixels: trimmed,
  };
}
