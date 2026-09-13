import type { ImageBuffer } from "./png.js";
export interface RgbaColor {
    r: number;
    g: number;
    b: number;
    a: number;
}
export interface LabColor {
    l: number;
    a: number;
    b: number;
}
export interface PixelArtFinding {
    rule: "orphan_pixel" | "broken_outline" | "banding" | "pillow_shading" | "symmetry_drift" | "tile_seam";
    severity: "info" | "warning";
    confidence: "low" | "medium" | "high";
    message: string;
    x?: number;
    y?: number;
    details?: Record<string, unknown>;
}
export declare function rgbaToHex(color: RgbaColor): string;
export declare function parseHexColor(input: string): RgbaColor;
export declare function rgbToLab(color: RgbaColor): LabColor;
/** CIEDE2000 perceptual color difference. */
export declare function deltaE2000(left: LabColor, right: LabColor): number;
export declare function generatePaletteRamp(baseColor: string, steps: number, shadowLightness: number, highlightLightness: number, hueShift: number): string[];
export declare function analyzeImagePalette(image: ImageBuffer, nearDuplicateThreshold?: number): Record<string, unknown>;
export declare function lintPixelArt(image: ImageBuffer, maxFindings?: number): {
    findings: PixelArtFinding[];
    summary: Record<string, number>;
    truncated: boolean;
    droppedFindings: number;
};
export declare function generateDitherPixels(region: {
    x: number;
    y: number;
    width: number;
    height: number;
}, colorA: string, colorB: string, amount: number, matrixSize: 2 | 4 | 8): Array<{
    x: number;
    y: number;
    color: string;
}>;
//# sourceMappingURL=pixelArt.d.ts.map