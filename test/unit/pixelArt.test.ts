import { describe, expect, it } from "vitest";
import type { ImageBuffer } from "../../src/image/png.js";
import {
  analyzeImagePalette,
  deltaE2000,
  generateDitherPixels,
  generatePaletteRamp,
  lintPixelArt,
  parseHexColor,
  rgbaToHex,
  rgbToLab,
} from "../../src/image/pixelArt.js";

function image(width: number, height: number, pixels: number[][]): ImageBuffer {
  return { width, height, data: Uint8Array.from(pixels.flat()) };
}

describe("pixel-art color analysis", () => {
  it("parses supported hex forms and preserves alpha", () => {
    expect(parseHexColor("#F08")).toEqual({ r: 255, g: 0, b: 136, a: 255 });
    expect(parseHexColor("1234")).toEqual({ r: 17, g: 34, b: 51, a: 68 });
    expect(rgbaToHex({ r: 17, g: 34, b: 51, a: 68 })).toBe("#11223344");
    expect(() => parseHexColor("not-a-color")).toThrow(/Invalid hex color/);
  });

  it("matches the published CIEDE2000 reference pair", () => {
    const distance = deltaE2000(
      { l: 50, a: 2.6772, b: -79.7751 },
      { l: 50, a: 0, b: -82.7485 }
    );
    expect(distance).toBeCloseTo(2.0425, 4);
  });

  it("gives zero perceptual distance for an identical sRGB color", () => {
    const lab = rgbToLab(parseHexColor("#4A90E2"));
    expect(deltaE2000(lab, lab)).toBe(0);
  });

  it("reports used-color frequencies and perceptual near duplicates", () => {
    const result = analyzeImagePalette(image(3, 1, [
      [100, 100, 100, 255], [101, 101, 101, 255], [0, 0, 0, 0],
    ]), 3) as any;
    expect(result.colorCount).toBe(2);
    expect(result.transparentPixels).toBe(1);
    expect(result.nearDuplicates).toHaveLength(1);
  });

  it("bounds high-cardinality palette analysis before pairwise comparison becomes unsafe", () => {
    const pixels = Array.from({ length: 4097 }, (_, value) => [
      value & 0xff,
      value >> 8 & 0xff,
      value >> 16 & 0xff,
      255,
    ]);
    expect(() => analyzeImagePalette(image(4097, 1, pixels))).toThrow(/at most 4096 distinct opaque colors/);
  });

  it("generates deterministic ramps with the requested length", () => {
    const ramp = generatePaletteRamp("#8080C0FF", 5, 0.1, 0.9, 15);
    expect(ramp).toHaveLength(5);
    expect(new Set(ramp).size).toBe(5);
    expect(ramp.every((color) => /^#[0-9A-F]{8}$/.test(color))).toBe(true);
  });
});

describe("pixel-art lint and dithering", () => {
  it("finds an orphan pixel and a one-pixel outline gap", () => {
    const transparent = [0, 0, 0, 0];
    const black = [0, 0, 0, 255];
    const red = [255, 0, 0, 255];
    const pixels = Array.from({ length: 25 }, () => [...transparent]);
    pixels[1 * 5 + 1] = black;
    pixels[1 * 5 + 3] = black;
    pixels[3 * 5 + 2] = red;
    const report = lintPixelArt(image(5, 5, pixels));
    expect(report.findings.some((finding) => finding.rule === "broken_outline" && finding.x === 2 && finding.y === 1)).toBe(true);
    expect(report.findings.some((finding) => finding.rule === "orphan_pixel" && finding.x === 2 && finding.y === 3)).toBe(true);
  });

  it("reports truncation only when findings were actually dropped", () => {
    const pixels = Array.from({ length: 9 }, (_, index) => [index * 20, 0, 0, 255]);
    const report = lintPixelArt(image(9, 1, pixels), 1);
    expect(report.findings).toHaveLength(1);
    expect(report.truncated).toBe(true);
    expect(report.droppedFindings).toBeGreaterThan(0);

    const exact = lintPixelArt(image(1, 1, [[255, 0, 0, 255]]), 10);
    expect(exact.truncated).toBe(false);
    expect(exact.droppedFindings).toBe(0);
  });

  it("creates exact bounded Bayer pixels with predictable color proportions", () => {
    const pixels = generateDitherPixels(
      { x: 10, y: 20, width: 4, height: 4 },
      "#000000FF",
      "#FFFFFFFF",
      0.5,
      4
    );
    expect(pixels).toHaveLength(16);
    expect(pixels.filter((pixel) => pixel.color === "#FFFFFFFF")).toHaveLength(8);
    expect(pixels[0]).toEqual({ x: 10, y: 20, color: "#FFFFFFFF" });
    expect(pixels.at(-1)).toEqual({ x: 13, y: 23, color: "#FFFFFFFF" });
  });
});
