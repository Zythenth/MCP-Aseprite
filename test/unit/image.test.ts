// test/unit/image.test.ts
import { describe, it, expect } from "vitest";
import {
  encodeRgbaToPngBase64,
  encodeRgbaToPngBuffer,
  decodePngBase64Sync,
  decodePngBufferSync,
  encodeRgbaToPngAsync,
  decodePngAsync,
  InvalidDimensionError,
  BufferSizeMismatchError,
  PngDecodeError,
} from "../../src/image/png.js";
import {
  scaleNearestNeighbor,
  resizeNearestNeighbor,
} from "../../src/image/scaling.js";
import {
  applyCheckerboardBackdrop,
  createCheckerboardBuffer,
  normalizeCheckerColor,
} from "../../src/image/checkerboard.js";
import {
  applyGridOverlay,
  parseColor,
} from "../../src/image/gridOverlay.js";
import {
  attachCoordinateRulers,
  calculateOptimalStep,
  calculateRulerThickness,
  drawText,
  drawNumber,
  measureText,
  FONT_3X5,
  FONT_5X7,
} from "../../src/image/rulers.js";
import {
  applyHighlights,
} from "../../src/image/highlights.js";
import {
  normalizeCelToCanvas,
  computeOverlap,
  canvasToCel,
  celToCanvas,
  isInsideCel,
  isInsideCanvas,
  expandCelToCanvas,
  trimCanvasToCel,
} from "../../src/image/normalizer.js";
import {
  buildCompactGrid,
  buildCompactGridFromRgba,
  decompressCompactGrid,
  calculateTokenSavings,
} from "../../src/image/compact.js";
import {
  renderVisualInspection,
  generatePixelGridPreview,
} from "../../src/image/index.js";

describe("Pure-JS Image Rendering Engine & Coordinate Normalizer", () => {
  // =========================================================================
  // 1. PNG ENCODING & DECODING (src/image/png.ts)
  // =========================================================================
  describe("PNG Encoding & Decoding", () => {
    it("encodeRgbaToPngBase64 and decodePngBase64Sync roundtrips without data loss", () => {
      const raw = new Uint8Array([
        255, 128, 64, 255,
        10, 20, 30, 255,
      ]);

      const { base64, buffer, width, height } = encodeRgbaToPngBase64(raw, 2, 1);
      expect(typeof base64).toBe("string");
      expect(base64.length).toBeGreaterThan(0);
      expect(buffer).toBeInstanceOf(Buffer);
      expect(width).toBe(2);
      expect(height).toBe(1);

      const decoded = decodePngBase64Sync(base64);
      expect(decoded.width).toBe(2);
      expect(decoded.height).toBe(1);
      expect(decoded.data[0]).toBe(255);
      expect(decoded.data[1]).toBe(128);
      expect(decoded.data[2]).toBe(64);
      expect(decoded.data[3]).toBe(255);
      expect(decoded.data[4]).toBe(10);
      expect(decoded.data[5]).toBe(20);
      expect(decoded.data[6]).toBe(30);
      expect(decoded.data[7]).toBe(255);
    });

    it("encodeRgbaToPngBuffer and decodePngBufferSync roundtrip raw buffers", () => {
      const raw = new Uint8Array([12, 34, 56, 78, 90, 100, 110, 255]);
      const buf = encodeRgbaToPngBuffer(raw, 2, 1);
      expect(buf).toBeInstanceOf(Buffer);
      // Verify PNG magic header: 0x89 'P' 'N' 'G' 0x0D 0x0A 0x1A 0x0A
      expect(buf[0]).toBe(0x89);
      expect(buf[1]).toBe(0x50);
      expect(buf[2]).toBe(0x4e);
      expect(buf[3]).toBe(0x47);

      const decoded = decodePngBufferSync(buf);
      expect(decoded.width).toBe(2);
      expect(decoded.height).toBe(1);
      expect(decoded.data[0]).toBe(12);
      expect(decoded.data[1]).toBe(34);
      expect(decoded.data[2]).toBe(56);
      expect(decoded.data[3]).toBe(78);
    });

    it("decodePngBase64Sync strips data URI prefix cleanly", () => {
      const raw = new Uint8Array([200, 100, 50, 255]);
      const { base64 } = encodeRgbaToPngBase64(raw, 1, 1);
      const dataUri = `data:image/png;base64,${base64}`;

      const decoded = decodePngBase64Sync(dataUri);
      expect(decoded.width).toBe(1);
      expect(decoded.height).toBe(1);
      expect(decoded.data[0]).toBe(200);
      expect(decoded.data[1]).toBe(100);
    });

    it("encodeRgbaToPngAsync and decodePngAsync perform asynchronous streaming roundtrip", async () => {
      const raw = new Uint8Array([42, 84, 126, 255, 1, 2, 3, 255]);
      const encoded = await encodeRgbaToPngAsync(raw, 2, 1);
      expect(encoded.base64).toBeDefined();

      const decoded = await decodePngAsync(encoded.base64);
      expect(decoded.width).toBe(2);
      expect(decoded.height).toBe(1);
      expect(decoded.data[0]).toBe(42);
      expect(decoded.data[1]).toBe(84);
    });

    it("throws InvalidDimensionError for invalid or non-positive dimensions", () => {
      const dummy = new Uint8Array(16);
      expect(() => encodeRgbaToPngBuffer(dummy, 0, 1)).toThrow(InvalidDimensionError);
      expect(() => encodeRgbaToPngBuffer(dummy, 2, -1)).toThrow(InvalidDimensionError);
      expect(() => encodeRgbaToPngBuffer(dummy, 1.5, 2)).toThrow(InvalidDimensionError);
    });

    it("throws BufferSizeMismatchError when buffer size is smaller than width * height * 4", () => {
      const shortBuf = new Uint8Array(4);
      expect(() => encodeRgbaToPngBuffer(shortBuf, 2, 2)).toThrow(BufferSizeMismatchError);
    });

    it("throws PngDecodeError on corrupted or empty base64 string", () => {
      expect(() => decodePngBase64Sync("")).toThrow(PngDecodeError);
      expect(() => decodePngBase64Sync("not_valid_png_base64_content")).toThrow(PngDecodeError);
    });
  });

  // =========================================================================
  // 2. NEAREST-NEIGHBOR SCALING (src/image/scaling.ts)
  // =========================================================================
  describe("Nearest-Neighbor Integer Scaling", () => {
    it("scaleNearestNeighbor scales 2x2 buffer to 4x4 with exact pixel replication and no blurring", () => {
      // 2x2 sprite: top-left red, top-right blue, bottom-left green, bottom-right white
      const src = new Uint8Array([
        255, 0, 0, 255,     0, 0, 255, 255,
        0, 255, 0, 255,     255, 255, 255, 255,
      ]);

      const { data, width, height } = scaleNearestNeighbor(src, 2, 2, 2);
      expect(width).toBe(4);
      expect(height).toBe(4);

      // Top-left 2x2 should all be red (255, 0, 0, 255)
      for (let y = 0; y < 2; y++) {
        for (let x = 0; x < 2; x++) {
          const idx = (y * 4 + x) * 4;
          expect(data[idx]).toBe(255);
          expect(data[idx + 1]).toBe(0);
          expect(data[idx + 2]).toBe(0);
          expect(data[idx + 3]).toBe(255);
        }
      }

      // Top-right 2x2 should all be blue (0, 0, 255, 255)
      for (let y = 0; y < 2; y++) {
        for (let x = 2; x < 4; x++) {
          const idx = (y * 4 + x) * 4;
          expect(data[idx]).toBe(0);
          expect(data[idx + 1]).toBe(0);
          expect(data[idx + 2]).toBe(255);
          expect(data[idx + 3]).toBe(255);
        }
      }
    });

    it("scaleNearestNeighbor at scale 1 returns copy without modifications", () => {
      const src = new Uint8Array([10, 20, 30, 40]);
      const res = scaleNearestNeighbor(src, 1, 1, 1);
      expect(res.width).toBe(1);
      expect(res.height).toBe(1);
      expect(res.scale).toBe(1);
      expect(res.data[0]).toBe(10);
      expect(res.data[3]).toBe(40);
    });

    it("scaleNearestNeighbor scales 1x1 sprite to 16x16 with all pixels identical", () => {
      const src = new Uint8Array([123, 234, 45, 255]);
      const { data, width, height, scale } = scaleNearestNeighbor(src, 1, 1, 16);
      expect(width).toBe(16);
      expect(height).toBe(16);
      expect(scale).toBe(16);

      for (let i = 0; i < 16 * 16; i++) {
        const idx = i * 4;
        expect(data[idx]).toBe(123);
        expect(data[idx + 1]).toBe(234);
        expect(data[idx + 2]).toBe(45);
        expect(data[idx + 3]).toBe(255);
      }
    });

    it("scaleNearestNeighbor scales odd dimensions accurately (3x5 at 2x -> 6x10)", () => {
      const src = new Uint8Array(3 * 5 * 4);
      // Put marker at (2, 4) bottom-right
      const markerIdx = (4 * 3 + 2) * 4;
      src[markerIdx] = 99; src[markerIdx + 1] = 88; src[markerIdx + 2] = 77; src[markerIdx + 3] = 255;

      const { data, width, height } = scaleNearestNeighbor(src, 3, 5, 2);
      expect(width).toBe(6);
      expect(height).toBe(10);

      // Scaled marker covers x=[4,5], y=[8,9]
      for (let y = 8; y <= 9; y++) {
        for (let x = 4; x <= 5; x++) {
          const idx = (y * 6 + x) * 4;
          expect(data[idx]).toBe(99);
          expect(data[idx + 1]).toBe(88);
          expect(data[idx + 2]).toBe(77);
          expect(data[idx + 3]).toBe(255);
        }
      }
    });

    it("resizeNearestNeighbor correctly resizes to arbitrary target dimensions", () => {
      const src = new Uint8Array([
        255, 0, 0, 255, 0, 255, 0, 255,
        0, 0, 255, 255, 255, 255, 0, 255,
      ]);
      const res = resizeNearestNeighbor(src, 2, 2, 6, 6);
      expect(res.width).toBe(6);
      expect(res.height).toBe(6);
      // Top-left pixel should be red
      expect(res.data[0]).toBe(255);
      expect(res.data[1]).toBe(0);
      // Bottom-right pixel should be yellow
      const brIdx = (5 * 6 + 5) * 4;
      expect(res.data[brIdx]).toBe(255);
      expect(res.data[brIdx + 1]).toBe(255);
    });

    it("handles unaligned typed array buffer offset without throwing", () => {
      // Create unaligned slice: byteOffset = 1
      const bigBuf = new ArrayBuffer(20);
      const unaligned = new Uint8Array(bigBuf, 1, 16);
      unaligned.fill(100);
      expect(() => scaleNearestNeighbor(unaligned, 2, 2, 2)).not.toThrow();
    });

    it("resizeNearestNeighbor rejects non-positive or non-integer source dimensions", () => {
      const dummy = new Uint8Array(16);
      expect(() => resizeNearestNeighbor(dummy, 0, 2, 4, 4)).toThrow(InvalidDimensionError);
      expect(() => resizeNearestNeighbor(dummy, 2, -1, 4, 4)).toThrow(InvalidDimensionError);
      expect(() => resizeNearestNeighbor(dummy, 2.5, 2, 4, 4)).toThrow(InvalidDimensionError);
    });

    it("resizeNearestNeighbor rejects non-positive or non-integer target dimensions", () => {
      const dummy = new Uint8Array(16);
      expect(() => resizeNearestNeighbor(dummy, 2, 2, 0, 4)).toThrow(InvalidDimensionError);
      expect(() => resizeNearestNeighbor(dummy, 2, 2, 4, -1)).toThrow(InvalidDimensionError);
      expect(() => resizeNearestNeighbor(dummy, 2, 2, 4.5, 4)).toThrow(InvalidDimensionError);
    });

    it("resizeNearestNeighbor throws BufferSizeMismatchError when source buffer is too small", () => {
      const shortBuf = new Uint8Array(12); // Expected 16 (2 * 2 * 4)
      expect(() => resizeNearestNeighbor(shortBuf, 2, 2, 4, 4)).toThrow(BufferSizeMismatchError);
    });

    it("resizeNearestNeighbor handles unaligned source buffer offset without throwing", () => {
      const bigBuf = new ArrayBuffer(24);
      const unaligned = new Uint8Array(bigBuf, 1, 16);
      unaligned.fill(128);
      expect(() => resizeNearestNeighbor(unaligned, 2, 2, 4, 4)).not.toThrow();
      const res = resizeNearestNeighbor(unaligned, 2, 2, 4, 4);
      expect(res.width).toBe(4);
      expect(res.height).toBe(4);
      expect(res.data[0]).toBe(128);
    });
  });

  // =========================================================================
  // 3. TRANSPARENCY CHECKERBOARD (src/image/checkerboard.ts)
  // =========================================================================
  describe("Transparency Checkerboard Backdrop", () => {
    it("applyCheckerboardBackdrop fills transparent pixels with alternating gray values", () => {
      // 2x2 image, all alpha = 0
      const src = new Uint8Array([
        0, 0, 0, 0,   0, 0, 0, 0,
        0, 0, 0, 0,   0, 0, 0, 0,
      ]);

      const result = applyCheckerboardBackdrop(src, 2, 2, 1, 204, 153);
      // (0,0) is light (204)
      expect(result[0]).toBe(204);
      expect(result[3]).toBe(255);
      // (1,0) is dark (153)
      expect(result[4]).toBe(153);
      expect(result[7]).toBe(255);
    });

    it("preserves fully opaque pixels without modification", () => {
      const src = new Uint8Array([
        10, 20, 30, 255,
        40, 50, 60, 255,
      ]);
      const res = applyCheckerboardBackdrop(src, 2, 1);
      expect(res[0]).toBe(10);
      expect(res[1]).toBe(20);
      expect(res[2]).toBe(30);
      expect(res[3]).toBe(255);
      expect(res[4]).toBe(40);
      expect(res[7]).toBe(255);
    });

    it("blends semi-transparent pixels using exact Porter-Duff math with +127 bias", () => {
      // Semi-transparent red: (200, 0, 0, 128) over light gray 204
      const src = new Uint8Array([200, 0, 0, 128]);
      const res = applyCheckerboardBackdrop(src, 1, 1, {
        cellSize: 8,
        lightColor: 204,
        darkColor: 153,
      });

      // Expected R = Math.floor((200 * 128 + 204 * (255 - 128) + 127) / 255)
      const expectedR = Math.floor((200 * 128 + 204 * 127 + 127) / 255);
      const expectedG = Math.floor((0 * 128 + 204 * 127 + 127) / 255);
      expect(res[0]).toBe(expectedR);
      expect(res[1]).toBe(expectedG);
      expect(res[3]).toBe(255); // Opaque output
    });

    it("supports custom hex color strings in checkerboard options", () => {
      const src = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]);
      const res = applyCheckerboardBackdrop(src, 2, 1, {
        cellSize: 1,
        lightColor: "#FFFFFF",
        darkColor: "#000000",
      });
      // (0,0) is white (255, 255, 255)
      expect(res[0]).toBe(255);
      expect(res[1]).toBe(255);
      expect(res[2]).toBe(255);
      // (1,0) is black (0, 0, 0)
      expect(res[4]).toBe(0);
      expect(res[5]).toBe(0);
      expect(res[6]).toBe(0);
    });

    it("createCheckerboardBuffer generates an opaque checkerboard grid", () => {
      const buf = createCheckerboardBuffer(4, 4, { cellSize: 2 });
      expect(buf.length).toBe(4 * 4 * 4);
      // All alpha should be 255
      for (let i = 0; i < 16; i++) {
        expect(buf[i * 4 + 3]).toBe(255);
      }
    });

    it("normalizeCheckerColor handles numbers, 3-char hex, 6-char hex, and objects", () => {
      expect(normalizeCheckerColor(100, 200)).toEqual({ r: 100, g: 100, b: 100 });
      expect(normalizeCheckerColor("#F00", 200)).toEqual({ r: 255, g: 0, b: 0 });
      expect(normalizeCheckerColor("#00FF00", 200)).toEqual({ r: 0, g: 255, b: 0 });
      expect(normalizeCheckerColor({ r: 50, g: 60, b: 70 }, 200)).toEqual({ r: 50, g: 60, b: 70 });
      expect(normalizeCheckerColor(undefined, 180)).toEqual({ r: 180, g: 180, b: 180 });
    });

    it("normalizeCheckerColor safely falls back to defaultVal on non-hex strings and edge cases", () => {
      // Non-hex strings of length >= 6 that previously produced NaN
      expect(normalizeCheckerColor("invalid", 204)).toEqual({ r: 204, g: 204, b: 204 });
      expect(normalizeCheckerColor("#GGGGGG", 204)).toEqual({ r: 204, g: 204, b: 204 });
      expect(normalizeCheckerColor("#ZZZZZZ", 204)).toEqual({ r: 204, g: 204, b: 204 });
      expect(normalizeCheckerColor("checkerboard", 204)).toEqual({ r: 204, g: 204, b: 204 });

      // Non-hex 3-char strings
      expect(normalizeCheckerColor("xyz", 204)).toEqual({ r: 204, g: 204, b: 204 });
      expect(normalizeCheckerColor("#GGG", 204)).toEqual({ r: 204, g: 204, b: 204 });

      // Empty, whitespace and malformed strings
      expect(normalizeCheckerColor("", 204)).toEqual({ r: 204, g: 204, b: 204 });
      expect(normalizeCheckerColor("   ", 204)).toEqual({ r: 204, g: 204, b: 204 });
      expect(normalizeCheckerColor("#", 204)).toEqual({ r: 204, g: 204, b: 204 });
      expect(normalizeCheckerColor("#12", 204)).toEqual({ r: 204, g: 204, b: 204 });
      expect(normalizeCheckerColor("#12345", 204)).toEqual({ r: 204, g: 204, b: 204 });

      // Non-string / invalid primitive types and non-finite numbers
      expect(normalizeCheckerColor(NaN as any, 204)).toEqual({ r: 204, g: 204, b: 204 });
      expect(normalizeCheckerColor(Infinity as any, 204)).toEqual({ r: 204, g: 204, b: 204 });
      expect(normalizeCheckerColor(null as any, 204)).toEqual({ r: 204, g: 204, b: 204 });
      expect(normalizeCheckerColor(true as any, 204)).toEqual({ r: 204, g: 204, b: 204 });

      // Malformed object inputs
      expect(normalizeCheckerColor({} as any, 204)).toEqual({ r: 204, g: 204, b: 204 });
      expect(normalizeCheckerColor({ r: NaN, g: 100, b: 100 } as any, 204)).toEqual({ r: 204, g: 204, b: 204 });
      expect(normalizeCheckerColor({ r: "bad", g: 100, b: 100 } as any, 204)).toEqual({ r: 204, g: 204, b: 204 });
    });

    it("applyCheckerboardBackdrop falls back to defaults without collapsing transparent or semi-transparent pixels to black on invalid colors", () => {
      // 1. Fully transparent pixel over invalid colors
      const transparentSrc = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]);
      const resTransparent = applyCheckerboardBackdrop(transparentSrc, 2, 1, {
        cellSize: 1,
        lightColor: "invalid",
        darkColor: "#GGGGGG",
      });
      // (0,0) is light -> default 204 (not black 0)
      expect(resTransparent[0]).toBe(204);
      expect(resTransparent[1]).toBe(204);
      expect(resTransparent[2]).toBe(204);
      expect(resTransparent[3]).toBe(255);
      // (1,0) is dark -> default 153 (not black 0)
      expect(resTransparent[4]).toBe(153);
      expect(resTransparent[5]).toBe(153);
      expect(resTransparent[6]).toBe(153);
      expect(resTransparent[7]).toBe(255);

      // 2. Semi-transparent pixel over invalid color: must not collapse to black
      const semiSrc = new Uint8Array([200, 100, 50, 128]);
      const resSemi = applyCheckerboardBackdrop(semiSrc, 1, 1, {
        cellSize: 8,
        lightColor: "#ZZZZZZ",
      });
      expect(resSemi[0]).toBe(202);
      expect(resSemi[1]).toBe(152);
      expect(resSemi[2]).toBe(127);
      expect(resSemi[3]).toBe(255);
    });
  });

  // =========================================================================
  // 4. GRID OVERLAY (src/image/gridOverlay.ts)
  // =========================================================================
  describe("1px Pixel Grid Overlay", () => {
    it("parseColor correctly handles hex variations and objects", () => {
      expect(parseColor("#FFF")).toEqual({ r: 255, g: 255, b: 255, a: 1.0 });
      expect(parseColor("#FF000080")).toEqual({ r: 255, g: 0, b: 0, a: 128 / 255 });
      expect(parseColor({ r: 10, g: 20, b: 30, a: 0.5 })).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    });

    it("draws 1px boundary lines at scaled cell boundaries", () => {
      // 2x2 sprite at scale 8 -> 16x16 canvas, all black opaque
      const canvas = new Uint8Array(16 * 16 * 4);
      for (let i = 0; i < 16 * 16; i++) {
        canvas[i * 4 + 3] = 255;
      }

      const res = applyGridOverlay(canvas, 16, 16, {
        scale: 8,
        spriteWidth: 2,
        spriteHeight: 2,
        color: "#FFFFFF",
        opacity: 1.0,
      });

      // Grid line should exist at vertical boundary x = 8
      const vLineIdx = (4 * 16 + 8) * 4;
      expect(res[vLineIdx]).toBe(255); // White line

      // Non-boundary cell center (x = 4, y = 4) should remain black
      const centerIdx = (4 * 16 + 4) * 4;
      expect(res[centerIdx]).toBe(0);
    });

    it("bypasses grid rendering when scale < minScale", () => {
      const src = new Uint8Array(8 * 8 * 4).fill(50);
      const res = applyGridOverlay(src, 8, 8, {
        scale: 2,
        minScale: 4,
      });
      // Exactly identical buffer
      expect(Buffer.from(res).compare(Buffer.from(src))).toBe(0);
    });

    it("respects inPlace false by returning a new buffer without modifying source", () => {
      const src = new Uint8Array(16 * 16 * 4).fill(0);
      const res = applyGridOverlay(src, 16, 16, {
        scale: 8,
        inPlace: false,
      });
      expect(res).not.toBe(src);
      expect(src.every((b) => b === 0)).toBe(true);
    });
  });

  // =========================================================================
  // 5. COORDINATE RULERS & MICRO-FONTS (src/image/rulers.ts)
  // =========================================================================
  describe("Coordinate Rulers & Micro-Fonts", () => {
    it("measureText computes exact width and height for FONT_3X5 and FONT_5X7", () => {
      const dim3x5 = measureText("10", FONT_3X5);
      // 2 chars * 3 width + 1 spacing = 7px
      expect(dim3x5.width).toBe(7);
      expect(dim3x5.height).toBe(5);

      const dim5x7 = measureText("10", FONT_5X7);
      // 2 chars * 5 width + 1 spacing = 11px
      expect(dim5x7.width).toBe(11);
      expect(dim5x7.height).toBe(7);
    });

    it("calculateOptimalStep chooses collision-free interval", () => {
      // At scale 4 with max coordinate 128 (3 digits = 11px), 11 + 4 = 15px needed
      // step 5 * scale 4 = 20px >= 15px -> returns 5
      const step = calculateOptimalStep(4, 128, FONT_3X5);
      expect(step * 4).toBeGreaterThanOrEqual(15);
    });

    it("drawText renders readable glyphs into canvas buffer", () => {
      const canvas = new Uint8Array(10 * 10 * 4);
      drawText(canvas, 10, 10, 1, 1, "1", FONT_3X5, 255, 255, 255);
      // Center column of digit '1' should have white pixels
      const centerPixelIdx = (2 * 10 + 2) * 4;
      expect(canvas[centerPixelIdx]).toBe(255);
    });

    it("attachCoordinateRulers adds margins and expands total dimensions", () => {
      const spriteW = 4;
      const spriteH = 4;
      const scale = 16;
      const scaledW = spriteW * scale; // 64
      const scaledH = spriteH * scale; // 64
      const scaledImg = new Uint8Array(scaledW * scaledH * 4).fill(100);

      const result = attachCoordinateRulers(scaledImg, spriteW, spriteH, scale, {
        rulerTop: 20,
        rulerLeft: 20,
      });

      expect(result.width).toBe(20 + 64);
      expect(result.height).toBe(20 + 64);
      expect(result.rulerTop).toBe(20);
      expect(result.rulerLeft).toBe(20);
      expect(result.scaledWidth).toBe(64);
      expect(result.scaledHeight).toBe(64);

      // Verify blitted sprite pixel at (rulerLeft + 5, rulerTop + 5)
      const blitIdx = ((20 + 5) * result.width + (20 + 5)) * 4;
      expect(result.data[blitIdx]).toBe(100);
    });

    it("attachCoordinateRulers renders negative origin coordinates without crashing", () => {
      const scaledImg = new Uint8Array(32 * 32 * 4).fill(50);
      expect(() =>
        attachCoordinateRulers(scaledImg, 2, 2, 16, {
          originX: -5,
          originY: -5,
          rulerTop: 24,
          rulerLeft: 24,
        })
      ).not.toThrow();
    });
  });

  // =========================================================================
  // 6. HIGHLIGHTS (src/image/highlights.ts)
  // =========================================================================
  describe("Region & Pixel Highlight Overlays", () => {
    it("renders region bounding box outline with gold default color", () => {
      const canvas = new Uint8Array(32 * 32 * 4).fill(0);
      // Set opaque black
      for (let i = 0; i < 32 * 32; i++) canvas[i * 4 + 3] = 255;

      const res = applyHighlights(canvas, 32, 32, {
        scale: 8,
        regions: [{ x: 1, y: 1, width: 2, height: 2, strokeWidth: 1 }],
      });

      // Top-left corner of region (x=8, y=8) should be gold (#FFD700: 255, 215, 0)
      const cornerIdx = (8 * 32 + 8) * 4;
      expect(res[cornerIdx]).toBe(255);
      expect(res[cornerIdx + 1]).toBe(215);
      expect(res[cornerIdx + 2]).toBe(0);
    });

    it("applies tinted translucent fill wash over region interior", () => {
      const canvas = new Uint8Array(16 * 16 * 4).fill(0);
      for (let i = 0; i < 16 * 16; i++) canvas[i * 4 + 3] = 255;

      const res = applyHighlights(canvas, 16, 16, {
        scale: 8,
        regions: [
          {
            x: 0,
            y: 0,
            width: 2,
            height: 2,
            outline: false,
            fillColor: "#0000FF",
            fillOpacity: 0.5,
          },
        ],
      });

      // Interior pixel (x=4, y=4) should be tinted blue (around 128)
      const idx = (4 * 16 + 4) * 4;
      expect(res[idx + 2]).toBe(128);
    });

    it("highlights individual pixel cells and clips out-of-bounds coords safely", () => {
      const canvas = new Uint8Array(16 * 16 * 4);
      expect(() =>
        applyHighlights(canvas, 16, 16, {
          scale: 8,
          pixels: [{ x: 0, y: 0, color: "#00FFFF" }],
          regions: [{ x: -5, y: -5, width: 20, height: 20 }], // Partially out of bounds
          crosshairs: [{ x: 1, y: 1 }],
        })
      ).not.toThrow();
    });

    it("renders pixel perimeter outlines correctly without syntax quirks", () => {
      const canvas = new Uint8Array(16 * 16 * 4);
      const res = applyHighlights(canvas, 16, 16, {
        scale: 8,
        pixels: [
          { x: 0, y: 0, color: "#00FFFF", strokeWidth: 1, outline: true },
        ],
      });
      // Pixel (0, 0) scaled 8x covers [0..7, 0..7]. Top-left corner (0,0) must have cyan stroke
      expect(res[0]).toBe(0);     // R
      expect(res[1]).toBe(255);   // G (cyan)
      expect(res[2]).toBe(255);   // B (cyan)
      expect(res[3]).toBe(255);   // A

      // Top edge at (4, 0)
      const topIdx = (0 * 16 + 4) * 4;
      expect(res[topIdx + 1]).toBe(255);
      expect(res[topIdx + 2]).toBe(255);

      // Center of cell (4, 4) should remain blank/unstroked (0,0,0,0)
      const centerIdx = (4 * 16 + 4) * 4;
      expect(res[centerIdx + 3]).toBe(0);
    });
  });

  // =========================================================================
  // 7. CEL-TO-CANVAS NORMALIZATION (src/image/normalizer.ts)
  // =========================================================================
  describe("Cel-to-Canvas Coordinate Normalizer", () => {
    it("computeOverlap calculates geometric intersection accurately", () => {
      const overlap = computeOverlap(
        { x: 4, y: 4, width: 8, height: 8 },
        { width: 16, height: 16 }
      );
      expect(overlap).not.toBeNull();
      expect(overlap!.canvasX).toBe(4);
      expect(overlap!.canvasY).toBe(4);
      expect(overlap!.width).toBe(8);
      expect(overlap!.height).toBe(8);
      expect(overlap!.celOffsetX).toBe(0);
      expect(overlap!.celOffsetY).toBe(0);
    });

    it("computeOverlap returns null for non-overlapping disjoint cels", () => {
      const overlap = computeOverlap(
        { x: 20, y: 20, width: 5, height: 5 },
        { width: 16, height: 16 }
      );
      expect(overlap).toBeNull();
    });

    it("normalizeCelToCanvas correctly normalizes smaller offset cel onto canvas", () => {
      // 4x4 cel with red pixels at (2, 2) in an 8x8 canvas
      const celPixels = new Uint8Array(4 * 4 * 4);
      for (let i = 0; i < 16; i++) {
        celPixels[i * 4] = 255;
        celPixels[i * 4 + 3] = 255;
      }

      const canvas = normalizeCelToCanvas(
        { bounds: { x: 2, y: 2, width: 4, height: 4 }, pixels: celPixels },
        { width: 8, height: 8 }
      );

      // Outside cel (0, 0) should be transparent (0)
      expect(canvas[0]).toBe(0);
      expect(canvas[3]).toBe(0);

      // Inside cel (2, 2) should be red (255, 0, 0, 255)
      const insideIdx = (2 * 8 + 2) * 4;
      expect(canvas[insideIdx]).toBe(255);
      expect(canvas[insideIdx + 3]).toBe(255);
    });

    it("normalizeCelToCanvas clips negative coordinates properly", () => {
      // 4x4 cel at (-2, -2) in 4x4 canvas: only bottom-right 2x2 of cel is visible at canvas top-left (0,0)
      const celPixels = new Uint8Array(4 * 4 * 4);
      for (let i = 0; i < 16; i++) {
        celPixels[i * 4 + 1] = 200; // Green
        celPixels[i * 4 + 3] = 255;
      }

      const canvas = normalizeCelToCanvas(
        { bounds: { x: -2, y: -2, width: 4, height: 4 }, pixels: celPixels },
        { width: 4, height: 4 }
      );

      // Canvas top-left (0, 0) should contain the clipped cel pixel
      expect(canvas[1]).toBe(200);
      expect(canvas[3]).toBe(255);

      // Canvas bottom-right (3, 3) should be transparent
      const brIdx = (3 * 4 + 3) * 4;
      expect(canvas[brIdx + 3]).toBe(0);
    });

    it("coordinate translation helpers (canvasToCel, celToCanvas, isInsideCel) work reliably", () => {
      const bounds = { x: 10, y: 20, width: 5, height: 5 };
      expect(canvasToCel({ x: 12, y: 23 }, bounds)).toEqual({ x: 2, y: 3 });
      expect(celToCanvas({ x: 2, y: 3 }, bounds)).toEqual({ x: 12, y: 23 });
      expect(isInsideCel({ x: 12, y: 23 }, bounds)).toBe(true);
      expect(isInsideCel({ x: 9, y: 20 }, bounds)).toBe(false);
      expect(isInsideCanvas({ x: 5, y: 5 }, { width: 10, height: 10 })).toBe(true);
      expect(isInsideCanvas({ x: 10, y: 5 }, { width: 10, height: 10 })).toBe(false);
    });

    it("expandCelToCanvas and trimCanvasToCel round-trip correctly", () => {
      const canvasDim = { width: 8, height: 8 };
      const celPixels = new Uint8Array(2 * 2 * 4);
      celPixels.fill(255); // Opaque white 2x2
      const cel = { bounds: { x: 3, y: 3, width: 2, height: 2 }, pixels: celPixels };

      const expanded = expandCelToCanvas(cel, canvasDim);
      expect(expanded.bounds).toEqual({ x: 0, y: 0, width: 8, height: 8 });

      const trimmed = trimCanvasToCel(expanded.pixels, canvasDim);
      expect(trimmed.bounds).toEqual({ x: 3, y: 3, width: 2, height: 2 });
    });
  });

  // =========================================================================
  // 8. COMPACT MINI-PALETTE COMPRESSOR (src/image/compact.ts)
  // =========================================================================
  describe("Compact Mini-Palette Compressor", () => {
    it("buildCompactGrid generates indexed mini-palette and compact string grid", () => {
      const hexGrid = [
        ["#00000000", "#FF0000FF", "#FF0000FF"],
        ["#00000000", "#0000FFFF", "#00000000"],
      ];

      const compact = buildCompactGrid(hexGrid, 3, 2);
      expect(Object.keys(compact.colors).length).toBe(3);
      expect(compact.grid.length).toBe(2);
      expect(compact.grid[0].length).toBe(3);
      // Same token for duplicate colors
      expect(compact.grid[0][1]).toBe(compact.grid[0][2]);
    });

    it("assigns '.' strictly to transparent and frequency-sorts non-transparent colors", () => {
      const hexGrid = [
        ["#00000000", "#FF0000FF", "#FF0000FF"],
        ["#00000000", "#0000FFFF", "#FF0000FF"],
      ];
      // Counts: #FF0000FF (3 occurrences) -> Rank 1 'A'
      // #0000FFFF (1 occurrence) -> Rank 2 'B'
      // #00000000 (2 occurrences) -> '.'
      const compact = buildCompactGrid(hexGrid, 3, 2);
      expect(compact.palette["."]).toBe("#00000000");
      expect(compact.palette["A"]).toBe("#FF0000FF");
      expect(compact.palette["B"]).toBe("#0000FFFF");
      expect(compact.rows[0]).toBe(".AA");
      expect(compact.rows[1]).toBe(".BA");
    });

    it("decompressCompactGrid provides 100% loss-free round-trip reconstruction", () => {
      const original = [
        ["#00000000", "#112233FF", "#445566FF"],
        ["#445566FF", "#00000000", "#112233FF"],
      ];
      const compact = buildCompactGrid(original, 3, 2);
      const recovered = decompressCompactGrid(compact);
      expect(recovered).toEqual(original);
    });

    it("buildCompactGridFromRgba produces matching compact matrix directly from Uint8Array", () => {
      const rgba = new Uint8Array([
        255, 0, 0, 255,   0, 0, 0, 0,
        0, 255, 0, 255,   255, 0, 0, 255,
      ]);
      const compact = buildCompactGridFromRgba(rgba, 2, 2);
      expect(compact.width).toBe(2);
      expect(compact.height).toBe(2);
      expect(compact.palette["."]).toBe("#00000000");
      expect(compact.rows[0][0]).toBe(compact.rows[1][1]); // Both red
    });

    it("calculateTokenSavings reports high compression ratio", () => {
      const hexGrid = Array(16).fill(null).map(() => Array(16).fill("#FF0000FF"));
      const compact = buildCompactGrid(hexGrid, 16, 16);
      const stats = calculateTokenSavings(compact, 16, 16);
      expect(stats.savingsRatio).toBeGreaterThan(0.7);
      expect(stats.estimatedTokensSaved).toBeGreaterThan(100);
    });
  });

  // =========================================================================
  // 9. UNIFIED PIPELINE & VISUAL INSPECTION (src/image/index.ts)
  // =========================================================================
  describe("Unified Visual Inspection Pipeline", () => {
    it("generatePixelGridPreview generates visual image with grid lines and highlights", () => {
      const spriteRgba = new Uint8Array(8 * 8 * 4);
      for (let i = 0; i < 8 * 8; i++) {
        spriteRgba[i * 4] = 255;
        spriteRgba[i * 4 + 1] = 0;
        spriteRgba[i * 4 + 2] = 0;
        spriteRgba[i * 4 + 3] = 255;
      }

      const preview = generatePixelGridPreview(spriteRgba, 8, 8, {
        scale: 16,
        showGrid: true,
        showCoordinates: true,
        highlightRegion: { x: 2, y: 2, width: 4, height: 4 },
        highlightPixels: [{ x: 5, y: 5 }],
      });

      expect(preview.width).toBeGreaterThan(8 * 16);
      expect(preview.height).toBeGreaterThan(8 * 16);
      expect(preview.base64).toBeDefined();
      expect(preview.buffer).toBeInstanceOf(Buffer);
    });

    it("renderVisualInspection returns complete metadata and valid PNG buffer", () => {
      const raw = new Uint8Array(4 * 4 * 4).fill(120);
      const res = renderVisualInspection(raw, 4, 4, {
        scale: 8,
        showGrid: true,
        showCoordinates: true,
      });

      expect(res.mimeType).toBe("image/png");
      expect(res.scale).toBe(8);
      expect(res.spriteWidth).toBe(4);
      expect(res.spriteHeight).toBe(4);
      expect(res.width).toBe(res.rulerOffset + 4 * 8);
      expect(res.height).toBe(res.rulerOffset + 4 * 8);
      // Valid PNG header
      expect(res.buffer[0]).toBe(0x89);
      expect(res.buffer[1]).toBe(0x50);
    });

    it("renderVisualInspection integrates cel normalization seamlessly", () => {
      const celData = new Uint8Array(2 * 2 * 4).fill(255);
      const res = renderVisualInspection(celData, 2, 2, {
        celBounds: { x: 1, y: 1, width: 2, height: 2 },
        canvasDimensions: { width: 4, height: 4 },
        scale: 8,
        showCoordinates: false,
      });

      expect(res.spriteWidth).toBe(4);
      expect(res.spriteHeight).toBe(4);
      expect(res.width).toBe(32);
      expect(res.height).toBe(32);
    });
  });
});
