import { ColorInput } from "./gridOverlay.js";
export interface GlyphFont {
    charWidth: number;
    charHeight: number;
    spacing: number;
    glyphs: Record<string, number[]>;
}
export declare const FONT_3X5: GlyphFont;
export declare const FONT_5X7: GlyphFont;
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
export declare function measureText(text: string, font?: GlyphFont): {
    width: number;
    height: number;
};
/**
 * Draws a single glyph bitmap onto an RGBA canvas.
 */
export declare function drawGlyph(dstData: Uint8Array, dstWidth: number, dstHeight: number, startX: number, startY: number, glyph: number[], font: GlyphFont, r: number, g: number, b: number, a?: number): void;
/**
 * Renders a text string onto an RGBA canvas using pure bitmap micro-font.
 */
export declare function drawText(dstData: Uint8Array, dstWidth: number, dstHeight: number, startX: number, startY: number, text: string, font?: GlyphFont, r?: number, g?: number, b?: number, a?: number): void;
/**
 * Renders an integer number onto an RGBA canvas.
 */
export declare function drawNumber(dstData: Uint8Array, dstWidth: number, dstHeight: number, startX: number, startY: number, num: number, font?: GlyphFont, r?: number, g?: number, b?: number, a?: number): void;
/**
 * Dynamically computes an optimal coordinate stepping interval ensuring zero label collisions.
 */
export declare function calculateOptimalStep(scale: number, maxCoord: number, font?: GlyphFont): number;
/**
 * Computes default thickness for rulers based on font height and ticks.
 */
export declare function calculateRulerThickness(scale: number, _maxCoord?: number, font?: GlyphFont): number;
/**
 * Attaches coordinate rulers to the top and left edges of a scaled RGBA image.
 */
export declare function attachCoordinateRulers(scaledImage: Uint8Array, spriteWidth: number, spriteHeight: number, scale: number, options?: RulerOptions): RulersResult;
//# sourceMappingURL=rulers.d.ts.map