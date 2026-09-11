// src/image/rulers.ts
import { ColorInput, parseColor } from "./gridOverlay.js";

export interface GlyphFont {
  charWidth: number;
  charHeight: number;
  spacing: number;
  glyphs: Record<string, number[]>;
}

// 3x5 Bitmap Font (Compact: 3px wide, 5px high)
export const FONT_3X5: GlyphFont = {
  charWidth: 3,
  charHeight: 5,
  spacing: 1,
  glyphs: {
    "0": [0b111, 0b101, 0b101, 0b101, 0b111],
    "1": [0b010, 0b110, 0b010, 0b010, 0b111],
    "2": [0b111, 0b001, 0b111, 0b100, 0b111],
    "3": [0b111, 0b001, 0b111, 0b001, 0b111],
    "4": [0b101, 0b101, 0b111, 0b001, 0b001],
    "5": [0b111, 0b100, 0b111, 0b001, 0b111],
    "6": [0b111, 0b100, 0b111, 0b101, 0b111],
    "7": [0b111, 0b001, 0b010, 0b010, 0b010],
    "8": [0b111, 0b101, 0b111, 0b101, 0b111],
    "9": [0b111, 0b101, 0b111, 0b001, 0b111],
    "-": [0b000, 0b000, 0b111, 0b000, 0b000],
    "+": [0b000, 0b010, 0b111, 0b010, 0b000],
    ":": [0b000, 0b010, 0b000, 0b010, 0b000],
    ",": [0b000, 0b000, 0b000, 0b010, 0b100],
    "x": [0b101, 0b101, 0b010, 0b101, 0b101],
    "y": [0b101, 0b101, 0b111, 0b001, 0b110],
    " ": [0b000, 0b000, 0b000, 0b000, 0b000],
  },
};

// 5x7 Bitmap Font (High legibility: 5px wide, 7px high)
export const FONT_5X7: GlyphFont = {
  charWidth: 5,
  charHeight: 7,
  spacing: 1,
  glyphs: {
    "0": [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
    "1": [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
    "2": [0b01110, 0b10001, 0b00001, 0b00110, 0b01100, 0b10000, 0b11111],
    "3": [0b01110, 0b10001, 0b00001, 0b00110, 0b00001, 0b10001, 0b01110],
    "4": [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
    "5": [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
    "6": [0b01110, 0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
    "7": [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
    "8": [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
    "9": [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00001, 0b01110],
    "-": [0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000],
    "+": [0b00000, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00000],
    ":": [0b00000, 0b01100, 0b01100, 0b00000, 0b01100, 0b01100, 0b00000],
    ",": [0b00000, 0b00000, 0b00000, 0b00000, 0b01100, 0b00100, 0b01000],
    "x": [0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b00000, 0b00000],
    "y": [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00000],
    " ": [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000],
  },
};

export interface RulerOptions {
  /** Thickness of the ruler in pixels (used for both top & left if not overridden). Default: auto-calculated (18-24px). */
  rulerSize?: number;
  /** Thickness of top ruler in pixels. Default: rulerSize. */
  rulerTop?: number;
  /** Thickness of left ruler in pixels. Default: rulerSize. */
  rulerLeft?: number;
  /** Interval step for coordinate labels (e.g. 1, 5, 10). If omitted, dynamically calculated to prevent label collision. */
  step?: number;
  /** Separate step for X-axis labels. */
  stepX?: number;
  /** Separate step for Y-axis labels. */
  stepY?: number;
  /** Origin X coordinate offset (sprite coordinate at x=0). Default: 0. */
  originX?: number;
  /** Origin Y coordinate offset (sprite coordinate at y=0). Default: 0. */
  originY?: number;
  /** Bitmap font size: "3x5" or "5x7". Default: "3x5". */
  font?: "3x5" | "5x7";
  /** Background color for ruler gutter. Default: "#1E1E1E". */
  backgroundColor?: ColorInput;
  /** Corner origin box color. Default: "#181818". */
  cornerColor?: ColorInput;
  /** Coordinate label text color. Default: "#C8C8C8". */
  textColor?: ColorInput;
  /** 1px divider line color between ruler and canvas. Default: "#505050". */
  dividerColor?: ColorInput;
  /** Tick mark color. Default: "#707070". */
  tickColor?: ColorInput;
  /** Whether to draw tick marks. Default: true. */
  showTicks?: boolean;
  /** Whether to draw top ruler (X coordinates). Default: true. */
  showTop?: boolean;
  /** Whether to draw left ruler (Y coordinates). Default: true. */
  showLeft?: boolean;
}

export interface RulersResult {
  data: Uint8Array;
  width: number;
  height: number;
  rulerTop: number;
  rulerLeft: number;
  scaledWidth: number;
  scaledHeight: number;
}

/**
 * Calculates rendered pixel width and height for a text string under the chosen font.
 */
export function measureText(text: string, font: GlyphFont = FONT_3X5): { width: number; height: number } {
  if (text.length === 0) return { width: 0, height: font.charHeight };
  const width = text.length * font.charWidth + (text.length - 1) * font.spacing;
  return { width, height: font.charHeight };
}

/**
 * Draws a single glyph bitmap onto an RGBA canvas.
 */
export function drawGlyph(
  dstData: Uint8Array,
  dstWidth: number,
  dstHeight: number,
  startX: number,
  startY: number,
  glyph: number[],
  font: GlyphFont,
  r: number,
  g: number,
  b: number,
  a = 255
): void {
  for (let row = 0; row < font.charHeight; row++) {
    const y = startY + row;
    if (y < 0 || y >= dstHeight) continue;
    const bits = glyph[row];
    for (let col = 0; col < font.charWidth; col++) {
      const x = startX + col;
      if (x < 0 || x >= dstWidth) continue;
      if ((bits >> (font.charWidth - 1 - col)) & 1) {
        const idx = (y * dstWidth + x) * 4;
        dstData[idx] = r;
        dstData[idx + 1] = g;
        dstData[idx + 2] = b;
        dstData[idx + 3] = a;
      }
    }
  }
}

/**
 * Renders a text string onto an RGBA canvas using pure bitmap micro-font.
 */
export function drawText(
  dstData: Uint8Array,
  dstWidth: number,
  dstHeight: number,
  startX: number,
  startY: number,
  text: string,
  font: GlyphFont = FONT_3X5,
  r = 200,
  g = 200,
  b = 200,
  a = 255
): void {
  let curX = startX;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const glyph = font.glyphs[char] ?? font.glyphs[" "];
    if (glyph) {
      drawGlyph(dstData, dstWidth, dstHeight, curX, startY, glyph, font, r, g, b, a);
    }
    curX += font.charWidth + font.spacing;
  }
}

/**
 * Renders an integer number onto an RGBA canvas.
 */
export function drawNumber(
  dstData: Uint8Array,
  dstWidth: number,
  dstHeight: number,
  startX: number,
  startY: number,
  num: number,
  font: GlyphFont = FONT_3X5,
  r = 200,
  g = 200,
  b = 200,
  a = 255
): void {
  drawText(dstData, dstWidth, dstHeight, startX, startY, num.toString(), font, r, g, b, a);
}

/**
 * Dynamically computes an optimal coordinate stepping interval ensuring zero label collisions.
 */
export function calculateOptimalStep(scale: number, maxCoord: number, font: GlyphFont = FONT_3X5): number {
  const sampleLabel = maxCoord.toString();
  const labelWidth = measureText(sampleLabel, font).width;
  // At low scales (scale <= 2), edge-clamping can displace the first label rightward and
  // boundary labels leftward by up to labelWidth/2 each, reducing inter-label gap by ~labelWidth.
  // We expand required minimum spacing to guarantee zero overlap across compact viewports.
  const minRequiredSpacing = scale <= 2
    ? Math.ceil(labelWidth * 1.5 + 6)
    : labelWidth + 4;

  const candidateSteps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500];
  for (const step of candidateSteps) {
    if (step * scale >= minRequiredSpacing) {
      return step;
    }
  }
  return 1000;
}

/**
 * Computes default thickness for rulers based on font height and ticks.
 */
export function calculateRulerThickness(scale: number, _maxCoord: number = 0, font: GlyphFont = FONT_3X5): number {
  const base = font.charHeight + 12;
  return Math.max(base, Math.min(32, Math.floor(scale * 1.5)));
}

/**
 * Attaches coordinate rulers to the top and left edges of a scaled RGBA image.
 */
export function attachCoordinateRulers(
  scaledImage: Uint8Array,
  spriteWidth: number,
  spriteHeight: number,
  scale: number,
  options: RulerOptions = {}
): RulersResult {
  const font = options.font === "5x7" ? FONT_5X7 : FONT_3X5;
  const showTop = options.showTop ?? true;
  const showLeft = options.showLeft ?? true;

  const defaultThickness = options.rulerSize ?? calculateRulerThickness(scale, Math.max(spriteWidth, spriteHeight), font);
  const rulerTop = showTop ? (options.rulerTop ?? defaultThickness) : 0;
  const rulerLeft = showLeft ? (options.rulerLeft ?? defaultThickness) : 0;

  const scaledWidth = spriteWidth * scale;
  const scaledHeight = spriteHeight * scale;
  const totalWidth = rulerLeft + scaledWidth;
  const totalHeight = rulerTop + scaledHeight;

  const canvas = new Uint8Array(totalWidth * totalHeight * 4);

  // Background colors
  const bg = parseColor(options.backgroundColor ?? "#1E1E1E");
  const cornerBg = parseColor(options.cornerColor ?? "#181818");
  const textColor = parseColor(options.textColor ?? "#C8C8C8");
  const dividerColor = parseColor(options.dividerColor ?? "#505050");
  const tickColor = parseColor(options.tickColor ?? "#707070");
  const showTicks = options.showTicks ?? true;

  // 1. Fill entire canvas with background
  for (let i = 0; i < totalWidth * totalHeight; i++) {
    const idx = i * 4;
    canvas[idx] = bg.r;
    canvas[idx + 1] = bg.g;
    canvas[idx + 2] = bg.b;
    canvas[idx + 3] = 255;
  }

  // 2. Tint top-left corner origin box
  if (rulerLeft > 0 && rulerTop > 0) {
    for (let y = 0; y < rulerTop; y++) {
      for (let x = 0; x < rulerLeft; x++) {
        const idx = (y * totalWidth + x) * 4;
        canvas[idx] = cornerBg.r;
        canvas[idx + 1] = cornerBg.g;
        canvas[idx + 2] = cornerBg.b;
      }
    }
  }

  // 3. Blit scaled image into canvas at (rulerLeft, rulerTop)
  const scaledRowBytes = scaledWidth * 4;
  for (let y = 0; y < scaledHeight; y++) {
    const srcOffset = y * scaledRowBytes;
    const dstOffset = ((y + rulerTop) * totalWidth + rulerLeft) * 4;
    canvas.set(scaledImage.subarray(srcOffset, srcOffset + scaledRowBytes), dstOffset);
  }

  // 4. Draw 1px Dividers
  if (rulerTop > 0) {
    const dividerY = rulerTop - 1;
    for (let x = 0; x < totalWidth; x++) {
      const idx = (dividerY * totalWidth + x) * 4;
      canvas[idx] = dividerColor.r;
      canvas[idx + 1] = dividerColor.g;
      canvas[idx + 2] = dividerColor.b;
      canvas[idx + 3] = 255;
    }
  }
  if (rulerLeft > 0) {
    const dividerX = rulerLeft - 1;
    for (let y = 0; y < totalHeight; y++) {
      const idx = (y * totalWidth + dividerX) * 4;
      canvas[idx] = dividerColor.r;
      canvas[idx + 1] = dividerColor.g;
      canvas[idx + 2] = dividerColor.b;
      canvas[idx + 3] = 255;
    }
  }

  // 5. Render Top Ruler (X coordinates)
  if (rulerTop > 0 && showTop) {
    const originX = options.originX ?? 0;
    const stepX = options.stepX ?? options.step ?? calculateOptimalStep(scale, spriteWidth + Math.abs(originX), font);
    let lastDrawnRightX = -1;

    for (let px = 0; px < spriteWidth; px++) {
      const cellStartX = rulerLeft + px * scale;
      const isMajor = px % stepX === 0;

      // Tick marks along divider
      if (showTicks && rulerTop >= 6) {
        const tickLen = isMajor ? 4 : (scale >= 6 ? 2 : 0);
        if (tickLen > 0) {
          for (let ty = 0; ty < tickLen; ty++) {
            const y = rulerTop - 2 - ty;
            if (y >= 0 && cellStartX < totalWidth) {
              const idx = (y * totalWidth + cellStartX) * 4;
              canvas[idx] = tickColor.r;
              canvas[idx + 1] = tickColor.g;
              canvas[idx + 2] = tickColor.b;
              canvas[idx + 3] = 255;
            }
          }
        }
      }

      // Coordinate Number
      if (isMajor) {
        const coord = px + originX;
        const text = coord.toString();
        const textDim = measureText(text, font);
        const cellCenterX = cellStartX + Math.floor(scale / 2);
        let textX = cellCenterX - Math.floor(textDim.width / 2);

        // Clamp inside ruler bounds
        textX = Math.max(rulerLeft, Math.min(totalWidth - textDim.width - 1, textX));
        const textY = Math.max(1, rulerTop - 6 - font.charHeight);

        // Collision avoidance: guarantee zero overlap with previously drawn label
        if (lastDrawnRightX >= 0 && textX <= lastDrawnRightX + 1) {
          continue;
        }

        drawText(canvas, totalWidth, totalHeight, textX, textY, text, font, textColor.r, textColor.g, textColor.b);
        lastDrawnRightX = textX + textDim.width - 1;
      }
    }
  }

  // 6. Render Left Ruler (Y coordinates)
  if (rulerLeft > 0 && showLeft) {
    const originY = options.originY ?? 0;
    const stepY = options.stepY ?? options.step ?? calculateOptimalStep(scale, spriteHeight + Math.abs(originY), font);
    let lastDrawnBottomY = -1;

    for (let py = 0; py < spriteHeight; py++) {
      const cellStartY = rulerTop + py * scale;
      const isMajor = py % stepY === 0;

      // Tick marks along divider
      if (showTicks && rulerLeft >= 6) {
        const tickLen = isMajor ? 4 : (scale >= 6 ? 2 : 0);
        if (tickLen > 0) {
          for (let tx = 0; tx < tickLen; tx++) {
            const x = rulerLeft - 2 - tx;
            if (x >= 0 && cellStartY < totalHeight) {
              const idx = (cellStartY * totalWidth + x) * 4;
              canvas[idx] = tickColor.r;
              canvas[idx + 1] = tickColor.g;
              canvas[idx + 2] = tickColor.b;
              canvas[idx + 3] = 255;
            }
          }
        }
      }

      // Coordinate Number
      if (isMajor) {
        const coord = py + originY;
        const text = coord.toString();
        const textDim = measureText(text, font);
        const cellCenterY = cellStartY + Math.floor(scale / 2);
        let textY = cellCenterY - Math.floor(font.charHeight / 2);

        // Clamp inside ruler bounds
        textY = Math.max(rulerTop, Math.min(totalHeight - font.charHeight - 1, textY));
        const textX = Math.max(1, rulerLeft - 6 - textDim.width);

        // Collision avoidance: guarantee zero overlap with previously drawn vertical label
        if (lastDrawnBottomY >= 0 && textY <= lastDrawnBottomY + 1) {
          continue;
        }

        drawText(canvas, totalWidth, totalHeight, textX, textY, text, font, textColor.r, textColor.g, textColor.b);
        lastDrawnBottomY = textY + font.charHeight - 1;
      }
    }
  }

  return {
    data: canvas,
    width: totalWidth,
    height: totalHeight,
    rulerTop,
    rulerLeft,
    scaledWidth,
    scaledHeight,
  };
}
