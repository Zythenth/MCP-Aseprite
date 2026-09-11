// test/unit/challenger_m2_2_stress.test.ts
import { describe, it, expect } from "vitest";
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
  attachCoordinateRulers,
  calculateOptimalStep,
  calculateRulerThickness,
  drawText,
  drawNumber,
  measureText,
  FONT_3X5,
  FONT_5X7,
  GlyphFont,
} from "../../src/image/rulers.js";

describe("Milestone 2 Challenger 2: Empirical Stress & Adversarial Hardening", () => {
  // =========================================================================
  // MISSION 1: CEL-TO-CANVAS NORMALIZER EXTREME BOUNDARY CONDITIONS
  // =========================================================================
  describe("Mission 1: Cel-to-Canvas Normalizer Extreme Boundaries", () => {
    it("1.1 Extreme negative offsets: cels completely negative (x=-10, y=-10, 5x5 cel on 16x16 canvas)", () => {
      const celPixels = new Uint8Array(5 * 5 * 4).fill(255);
      const cel = { bounds: { x: -10, y: -10, width: 5, height: 5 }, pixels: celPixels };
      const canvasDim = { width: 16, height: 16 };

      const overlap = computeOverlap(cel.bounds, canvasDim);
      expect(overlap).toBeNull();

      const result = normalizeCelToCanvas(cel, canvasDim);
      expect(result.length).toBe(16 * 16 * 4);
      // Entire buffer must remain untouched transparent (#00000000)
      expect(result.every((byte) => byte === 0)).toBe(true);
    });

    it("1.2 Extreme negative offsets: cel partially overlapping from negative space (x=-10, y=-10, 15x15 cel on 16x16 canvas)", () => {
      // 15x15 cel placed at (-10, -10). Overlap with canvas is (0,0) to (5,5) -> 5x5 pixels
      const celW = 15;
      const celH = 15;
      const celPixels = new Uint8Array(celW * celH * 4);
      // Fill cel with identifiable values based on cel coordinates
      for (let cy = 0; cy < celH; cy++) {
        for (let cx = 0; cx < celW; cx++) {
          const idx = (cy * celW + cx) * 4;
          celPixels[idx] = cx;       // R = cx
          celPixels[idx + 1] = cy;   // G = cy
          celPixels[idx + 2] = 200;  // B = 200
          celPixels[idx + 3] = 255;  // A = 255
        }
      }

      const cel = { bounds: { x: -10, y: -10, width: celW, height: celH }, pixels: celPixels };
      const canvasDim = { width: 16, height: 16 };

      const overlap = computeOverlap(cel.bounds, canvasDim);
      expect(overlap).not.toBeNull();
      expect(overlap!.canvasX).toBe(0);
      expect(overlap!.canvasY).toBe(0);
      expect(overlap!.width).toBe(5);
      expect(overlap!.height).toBe(5);
      expect(overlap!.celOffsetX).toBe(10);
      expect(overlap!.celOffsetY).toBe(10);

      const result = normalizeCelToCanvas(cel, canvasDim);
      expect(result.length).toBe(16 * 16 * 4);

      // Verify mapped region (0..4, 0..4) has cel pixels from (10..14, 10..14)
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
          const idx = (y * 16 + x) * 4;
          expect(result[idx]).toBe(10 + x);      // R
          expect(result[idx + 1]).toBe(10 + y);  // G
          expect(result[idx + 2]).toBe(200);     // B
          expect(result[idx + 3]).toBe(255);     // A
        }
      }

      // Verify everything outside the 5x5 overlap is strictly #00000000
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          if (x >= 5 || y >= 5) {
            const idx = (y * 16 + x) * 4;
            expect(result[idx]).toBe(0);
            expect(result[idx + 1]).toBe(0);
            expect(result[idx + 2]).toBe(0);
            expect(result[idx + 3]).toBe(0);
          }
        }
      }
    });

    it("1.3 Extreme positive offsets: cel completely outside sprite (x=1000, y=1000, 32x32 cel on 64x64 canvas)", () => {
      const celPixels = new Uint8Array(32 * 32 * 4).fill(128);
      const cel = { bounds: { x: 1000, y: 1000, width: 32, height: 32 }, pixels: celPixels };
      const canvasDim = { width: 64, height: 64 };

      const overlap = computeOverlap(cel.bounds, canvasDim);
      expect(overlap).toBeNull();

      const result = normalizeCelToCanvas(cel, canvasDim);
      expect(result.length).toBe(64 * 64 * 4);
      expect(result.every((b) => b === 0)).toBe(true);
    });

    it("1.4 Boundary perimeter tests: cels touching edges and corners from outside", () => {
      const canvasDim = { width: 32, height: 32 };
      const celPixels = new Uint8Array(10 * 10 * 4).fill(255);

      // Immediately to the right: x=32 (canvas is 0..31)
      expect(computeOverlap({ x: 32, y: 0, width: 10, height: 10 }, canvasDim)).toBeNull();
      // Immediately below: y=32
      expect(computeOverlap({ x: 0, y: 32, width: 10, height: 10 }, canvasDim)).toBeNull();
      // Immediately to the left: x=-10 (extends to 0, which is exclusive right boundary)
      expect(computeOverlap({ x: -10, y: 0, width: 10, height: 10 }, canvasDim)).toBeNull();
      // Immediately above: y=-10
      expect(computeOverlap({ x: 0, y: -10, width: 10, height: 10 }, canvasDim)).toBeNull();

      // 1px overlap at bottom-right corner: x=31, y=31, width=10, height=10
      const cornerOverlap = computeOverlap({ x: 31, y: 31, width: 10, height: 10 }, canvasDim);
      expect(cornerOverlap).not.toBeNull();
      expect(cornerOverlap!.canvasX).toBe(31);
      expect(cornerOverlap!.canvasY).toBe(31);
      expect(cornerOverlap!.width).toBe(1);
      expect(cornerOverlap!.height).toBe(1);

      const result = normalizeCelToCanvas(
        { bounds: { x: 31, y: 31, width: 10, height: 10 }, pixels: celPixels },
        canvasDim
      );
      expect(result.length).toBe(32 * 32 * 4);
      const cornerIdx = (31 * 32 + 31) * 4;
      expect(result[cornerIdx]).toBe(255);
      expect(result[cornerIdx + 3]).toBe(255);
      // Adjacent pixel (30, 31) must be 0
      expect(result[(31 * 32 + 30) * 4]).toBe(0);
    });

    it("1.5 Oversized cels: massive cel (500x500) enclosing small canvas (16x16) at negative offset (-200, -200)", () => {
      const celW = 500;
      const celH = 500;
      const celPixels = new Uint8Array(celW * celH * 4);
      // Mark cel pixel at (205, 205) with red
      const markCelX = 205;
      const markCelY = 205;
      const celIdx = (markCelY * celW + markCelX) * 4;
      celPixels[celIdx] = 255;
      celPixels[celIdx + 3] = 255;

      const cel = { bounds: { x: -200, y: -200, width: celW, height: celH }, pixels: celPixels };
      const canvasDim = { width: 16, height: 16 };

      const overlap = computeOverlap(cel.bounds, canvasDim);
      expect(overlap).not.toBeNull();
      expect(overlap!.canvasX).toBe(0);
      expect(overlap!.canvasY).toBe(0);
      expect(overlap!.width).toBe(16);
      expect(overlap!.height).toBe(16);
      expect(overlap!.celOffsetX).toBe(200);
      expect(overlap!.celOffsetY).toBe(200);

      const result = normalizeCelToCanvas(cel, canvasDim);
      expect(result.length).toBe(16 * 16 * 4);

      // (205, 205) in cel corresponds to canvas (5, 5) since offset is 200
      const canvasMarkIdx = (5 * 16 + 5) * 4;
      expect(result[canvasMarkIdx]).toBe(255);
      expect(result[canvasMarkIdx + 3]).toBe(255);

      // Check canvas (0, 0) is cel (200, 200) which was not set (0)
      expect(result[0]).toBe(0);
    });

    it("1.6 0x0 Dimensions: zero width/height cels and canvases", () => {
      const dummyPixels = new Uint8Array(0);

      // Zero-width cel
      expect(computeOverlap({ x: 0, y: 0, width: 0, height: 10 }, { width: 10, height: 10 })).toBeNull();
      // Zero-height cel
      expect(computeOverlap({ x: 0, y: 0, width: 10, height: 0 }, { width: 10, height: 10 })).toBeNull();
      // Zero-width canvas
      expect(computeOverlap({ x: 0, y: 0, width: 10, height: 10 }, { width: 0, height: 10 })).toBeNull();
      // Zero-height canvas
      expect(computeOverlap({ x: 0, y: 0, width: 10, height: 10 }, { width: 10, height: 0 })).toBeNull();
      // 0x0 cel on 0x0 canvas
      expect(computeOverlap({ x: 0, y: 0, width: 0, height: 0 }, { width: 0, height: 0 })).toBeNull();

      // normalizeCelToCanvas on 0x0 canvas produces 0-length Uint8Array without error
      const res0 = normalizeCelToCanvas(
        { bounds: { x: 0, y: 0, width: 0, height: 0 }, pixels: dummyPixels },
        { width: 0, height: 0 }
      );
      expect(res0.length).toBe(0);

      // normalizeCelToCanvas with 0x0 cel on 10x10 canvas produces 10x10 zero buffer
      const res10 = normalizeCelToCanvas(
        { bounds: { x: 0, y: 0, width: 0, height: 0 }, pixels: dummyPixels },
        { width: 10, height: 10 }
      );
      expect(res10.length).toBe(10 * 10 * 4);
      expect(res10.every((b) => b === 0)).toBe(true);

      // trimCanvasToCel with all-zero canvas returns 0x0 bounds and empty buffer
      const trimmed = trimCanvasToCel(new Uint8Array(10 * 10 * 4), { width: 10, height: 10 });
      expect(trimmed.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
      expect(trimmed.pixels.length).toBe(0);

      // trimCanvasToCel with 0x0 canvas returns 0x0 bounds cleanly
      const trimmed0 = trimCanvasToCel(new Uint8Array(0), { width: 0, height: 0 });
      expect(trimmed0.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
      expect(trimmed0.pixels.length).toBe(0);
    });

    it("1.7 Custom clearColor fills non-overlapping regions with exact RGBA values", () => {
      const celPixels = new Uint8Array(2 * 2 * 4).fill(255); // 2x2 white
      const cel = { bounds: { x: 1, y: 1, width: 2, height: 2 }, pixels: celPixels };
      const canvasDim = { width: 4, height: 4 };

      const clearColor = { r: 50, g: 100, b: 150, a: 200 };
      const result = normalizeCelToCanvas(cel, canvasDim, { clearColor });

      expect(result.length).toBe(4 * 4 * 4);

      // Outside pixel (0, 0) should be clearColor
      expect(result[0]).toBe(50);
      expect(result[1]).toBe(100);
      expect(result[2]).toBe(150);
      expect(result[3]).toBe(200);

      // Inside pixel (1, 1) should be cel pixel (255, 255, 255, 255)
      const insideIdx = (1 * 4 + 1) * 4;
      expect(result[insideIdx]).toBe(255);
      expect(result[insideIdx + 1]).toBe(255);
      expect(result[insideIdx + 2]).toBe(255);
      expect(result[insideIdx + 3]).toBe(255);
    });

    it("1.8 Coordinate translation helpers handle negative and out-of-bounds inputs without arithmetic drift", () => {
      const bounds = { x: -20, y: -30, width: 50, height: 60 };
      expect(canvasToCel({ x: -15, y: -25 }, bounds)).toEqual({ x: 5, y: 5 });
      expect(celToCanvas({ x: 5, y: 5 }, bounds)).toEqual({ x: -15, y: -25 });

      expect(isInsideCel({ x: -20, y: -30 }, bounds)).toBe(true);  // top-left edge
      expect(isInsideCel({ x: 29, y: 29 }, bounds)).toBe(true);    // bottom-right edge
      expect(isInsideCel({ x: 30, y: 29 }, bounds)).toBe(false);   // outside x
      expect(isInsideCel({ x: 29, y: 30 }, bounds)).toBe(false);   // outside y
      expect(isInsideCel({ x: -21, y: -30 }, bounds)).toBe(false); // left of bounds

      expect(isInsideCanvas({ x: 0, y: 0 }, { width: 10, height: 10 })).toBe(true);
      expect(isInsideCanvas({ x: 9, y: 9 }, { width: 10, height: 10 })).toBe(true);
      expect(isInsideCanvas({ x: -1, y: 0 }, { width: 10, height: 10 })).toBe(false);
      expect(isInsideCanvas({ x: 10, y: 5 }, { width: 10, height: 10 })).toBe(false);
    });
  });

  // =========================================================================
  // MISSION 2: COMPACT MINI-PALETTE ADVERSARIAL STRESS & INVERSION
  // =========================================================================
  describe("Mission 2: Compact Mini-Palette Adversarial Stress & Inversion", () => {
    // Helper to generate deterministic pseudo-random hex colors
    function generateDistinctColors(count: number): string[] {
      const colors = new Set<string>();
      let seed = 123456789;
      while (colors.size < count) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const r = ((seed >> 16) & 0xff).toString(16).padStart(2, "0").toUpperCase();
        const g = ((seed >> 8) & 0xff).toString(16).padStart(2, "0").toUpperCase();
        const b = (seed & 0xff).toString(16).padStart(2, "0").toUpperCase();
        // Skip #00000000 to keep them all non-transparent
        const color = `#${r}${g}${b}FF`;
        colors.add(color);
      }
      return Array.from(colors);
    }

    it("2.1 Adversarial stress with 64 distinct non-transparent colors (>62 alphabet limit)", () => {
      const distinct64 = generateDistinctColors(64);
      expect(distinct64.length).toBe(64);

      // Create an 8x8 grid where every cell has a unique color
      const grid: string[][] = [];
      for (let y = 0; y < 8; y++) {
        const row: string[] = [];
        for (let x = 0; x < 8; x++) {
          row.push(distinct64[y * 8 + x]);
        }
        grid.push(row);
      }

      const compact = buildCompactGrid(grid, 8, 8);
      // Since 64 > 62 (alphabet size), singleChar must be false
      expect(compact.isSingleChar).toBe(false);
      expect(compact.colorCount).toBe(64);

      // Decompress and assert 100% loss-free roundtrip
      const recovered = decompressCompactGrid(compact);
      expect(recovered).toEqual(grid);
    });

    it("2.2 Stress with 64 non-transparent colors PLUS transparent (#00000000) (total 65 colors)", () => {
      const distinct64 = generateDistinctColors(64);
      // Create an 9x8 grid with 64 distinct colors and 8 transparent pixels
      const grid: string[][] = [];
      let colorIdx = 0;
      for (let y = 0; y < 9; y++) {
        const row: string[] = [];
        for (let x = 0; x < 8; x++) {
          if (y === 0) {
            row.push("#00000000"); // 8 transparent pixels
          } else {
            row.push(distinct64[colorIdx++]);
          }
        }
        grid.push(row);
      }

      const compact = buildCompactGrid(grid, 8, 9);
      expect(compact.isSingleChar).toBe(false);
      expect(compact.palette["."]).toBe("#00000000");
      expect(compact.colorCount).toBe(65);

      const recovered = decompressCompactGrid(compact);
      expect(recovered).toEqual(grid);
    });

    it("2.3 Single-color sprites: 1x1, 16x16, 64x64, 128x128 solid fill", () => {
      const solidColor = "#123456FF";
      const sizes = [1, 16, 64, 128];

      for (const size of sizes) {
        const grid: string[][] = Array(size)
          .fill(null)
          .map(() => Array(size).fill(solidColor));

        const compact = buildCompactGrid(grid, size, size);
        expect(compact.colorCount).toBe(1);
        expect(compact.palette["A"]).toBe(solidColor);
        expect(compact.isSingleChar).toBe(true);

        const recovered = decompressCompactGrid(compact);
        expect(recovered).toEqual(grid);
      }
    });

    it("2.4 All-transparent sprites: 1x1, 16x16, 64x64, 128x128 full #00000000", () => {
      const sizes = [1, 16, 64, 128];

      for (const size of sizes) {
        const grid: string[][] = Array(size)
          .fill(null)
          .map(() => Array(size).fill("#00000000"));

        const compact = buildCompactGrid(grid, size, size);
        expect(compact.colorCount).toBe(1);
        expect(compact.palette["."]).toBe("#00000000");
        expect(compact.isSingleChar).toBe(true);

        // Every row must be purely '.'
        for (const row of compact.rows) {
          expect(row).toBe(".".repeat(size));
        }

        const recovered = decompressCompactGrid(compact);
        expect(recovered).toEqual(grid);
      }
    });

    it("2.5 Large dimensions (128x128 = 16,384 pixels) with 64 colors roundtrips loss-free with high performance", () => {
      const distinct64 = generateDistinctColors(64);
      const width = 128;
      const height = 128;

      const grid: string[][] = [];
      for (let y = 0; y < height; y++) {
        const row: string[] = [];
        for (let x = 0; x < width; x++) {
          row.push(distinct64[(x + y) % 64]);
        }
        grid.push(row);
      }

      const t0 = performance.now();
      const compact = buildCompactGrid(grid, width, height);
      const tCompress = performance.now() - t0;

      expect(compact.width).toBe(128);
      expect(compact.height).toBe(128);
      expect(compact.colorCount).toBe(64);

      const t1 = performance.now();
      const recovered = decompressCompactGrid(compact);
      const tDecompress = performance.now() - t1;

      expect(recovered.length).toBe(128);
      expect(recovered[0].length).toBe(128);
      expect(recovered).toEqual(grid);

      // Assert high performance: < 500ms on modern V8
      expect(tCompress).toBeLessThan(500);
      expect(tDecompress).toBeLessThan(500);
    });

    it("2.6 Direct RGBA buffer compression (buildCompactGridFromRgba) on 128x128 buffer roundtrips loss-free", () => {
      const width = 128;
      const height = 128;
      const rgba = new Uint8Array(width * height * 4);

      // Fill with patterned colors
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          if ((x + y) % 5 === 0) {
            // Transparent
            rgba[idx] = 0;
            rgba[idx + 1] = 0;
            rgba[idx + 2] = 0;
            rgba[idx + 3] = 0;
          } else {
            rgba[idx] = (x * 2) % 256;
            rgba[idx + 1] = (y * 2) % 256;
            rgba[idx + 2] = 128;
            rgba[idx + 3] = 255;
          }
        }
      }

      const compact = buildCompactGridFromRgba(rgba, width, height);
      expect(compact.width).toBe(128);
      expect(compact.height).toBe(128);
      expect(compact.palette["."]).toBe("#00000000");

      const recovered = decompressCompactGrid(compact);

      // Verify spot samples against original RGBA values
      for (let y = 0; y < height; y += 16) {
        for (let x = 0; x < width; x += 16) {
          const idx = (y * width + x) * 4;
          const r = rgba[idx].toString(16).padStart(2, "0").toUpperCase();
          const g = rgba[idx + 1].toString(16).padStart(2, "0").toUpperCase();
          const b = rgba[idx + 2].toString(16).padStart(2, "0").toUpperCase();
          const a = rgba[idx + 3].toString(16).padStart(2, "0").toUpperCase();
          const expectedHex = `#${r}${g}${b}${a}`;
          expect(recovered[y][x]).toBe(expectedHex);
        }
      }
    });

    it("2.7 calculateTokenSavings behaves reliably across edge cases without NaN", () => {
      const grid = [["#FF0000FF"]];
      const compact = buildCompactGrid(grid, 1, 1);
      const stats = calculateTokenSavings(compact, 1, 1);

      expect(Number.isFinite(stats.rawHexChars)).toBe(true);
      expect(Number.isFinite(stats.compactChars)).toBe(true);
      expect(Number.isFinite(stats.savingsRatio)).toBe(true);
      expect(Number.isFinite(stats.estimatedTokensSaved)).toBe(true);
      expect(stats.savingsRatio).toBeGreaterThanOrEqual(0);
      expect(stats.savingsRatio).toBeLessThanOrEqual(1);
    });
  });

  // =========================================================================
  // MISSION 3: RULER MICRO-FONT COORDINATE RENDERING & COLLISION STRESS
  // =========================================================================
  describe("Mission 3: Ruler Micro-font Rendering, Buffer Bounds & Label Collisions", () => {
    it("3.1 Direct glyph and number rendering for coordinates 0, 9, 10, 99, 100, 999 with FONT_3X5 & FONT_5X7", () => {
      const testCoords = [0, 9, 10, 99, 100, 999];
      const fonts: Array<{ name: string; font: GlyphFont }> = [
        { name: "3x5", font: FONT_3X5 },
        { name: "5x7", font: FONT_5X7 },
      ];

      for (const { font } of fonts) {
        for (const coord of testCoords) {
          const str = coord.toString();
          const dim = measureText(str, font);

          // Buffer sized exactly to glyph dimensions
          const canvas = new Uint8Array(dim.width * dim.height * 4);
          drawNumber(canvas, dim.width, dim.height, 0, 0, coord, font, 255, 255, 255);

          // Assert buffer has non-zero pixels written
          const hasPixels = canvas.some((byte) => byte === 255);
          expect(hasPixels).toBe(true);

          // Assert no memory overflow: array bounds intact
          expect(canvas.length).toBe(dim.width * dim.height * 4);
        }
      }
    });

    it("3.2 Boundary clipping: drawText handles out-of-bounds negative and exceeding start coordinates safely", () => {
      const canvas = new Uint8Array(20 * 20 * 4);

      // Should not throw or corrupt memory when rendering outside buffer boundaries
      expect(() => drawText(canvas, 20, 20, -10, -5, "999", FONT_3X5)).not.toThrow();
      expect(() => drawText(canvas, 20, 20, 18, 18, "999", FONT_3X5)).not.toThrow();
      expect(() => drawText(canvas, 20, 20, 100, 100, "999", FONT_3X5)).not.toThrow();
      expect(() => drawText(canvas, 20, 20, -100, -100, "999", FONT_3X5)).not.toThrow();
    });

    it("3.3 attachCoordinateRulers memory safety with coordinates reaching 999 across scales", () => {
      const scales = [1, 2, 4, 8, 16];
      const testOrigins = [0, 9, 10, 99, 100, 999];

      for (const scale of scales) {
        for (const origin of testOrigins) {
          const spriteW = 16;
          const spriteH = 16;
          const scaledImg = new Uint8Array(spriteW * scale * spriteH * scale * 4).fill(80);

          const result = attachCoordinateRulers(scaledImg, spriteW, spriteH, scale, {
            originX: origin,
            originY: origin,
            rulerTop: 24,
            rulerLeft: 24,
          });

          // Strict canvas size assertion
          const expectedTotalW = 24 + spriteW * scale;
          const expectedTotalH = 24 + spriteH * scale;
          expect(result.width).toBe(expectedTotalW);
          expect(result.height).toBe(expectedTotalH);
          expect(result.data.length).toBe(expectedTotalW * expectedTotalH * 4);
        }
      }
    });

    it("3.4 Zero-Overlap Invariant: Verify adjacent labels NEVER overlap along Top Ruler across coordinates 0..999", () => {
      // We test various scales and coordinate windows covering 0, 9, 10, 99, 100, 999
      const testCases = [
        { name: "Coords 0..20", originX: 0, width: 20 },
        { name: "Coords around 9..10", originX: 5, width: 15 },
        { name: "Coords around 99..100", originX: 90, width: 25 },
        { name: "Coords up to 999", originX: 980, width: 25 },
        { name: "Large span 0..1000", originX: 0, width: 1000 },
      ];

      const scales = [1, 2, 4, 8, 16];
      const fonts = [FONT_3X5, FONT_5X7];

      for (const tc of testCases) {
        for (const scale of scales) {
          for (const font of fonts) {
            const stepX = calculateOptimalStep(scale, tc.width + Math.abs(tc.originX), font);

            // Compute the horizontal bounding box [left, right] for each rendered label
            const rulerLeft = 24;
            const scaledWidth = tc.width * scale;
            const totalWidth = rulerLeft + scaledWidth;

            interface LabelBox {
              coord: number;
              text: string;
              left: number;
              right: number;
            }
            const boxes: LabelBox[] = [];

            for (let px = 0; px < tc.width; px++) {
              if (px % stepX === 0) {
                const coord = px + tc.originX;
                const text = coord.toString();
                const dim = measureText(text, font);
                const cellStartX = rulerLeft + px * scale;
                const cellCenterX = cellStartX + Math.floor(scale / 2);
                let textX = cellCenterX - Math.floor(dim.width / 2);

                // Exact clamping logic from attachCoordinateRulers
                textX = Math.max(rulerLeft, Math.min(totalWidth - dim.width - 1, textX));

                boxes.push({
                  coord,
                  text,
                  left: textX,
                  right: textX + dim.width - 1,
                });
              }
            }

            // Assert NO adjacent label boxes overlap: box[i].right < box[i+1].left
            for (let i = 0; i < boxes.length - 1; i++) {
              const current = boxes[i];
              const next = boxes[i + 1];

              const gap = next.left - current.right - 1;
              expect(
                gap,
                `Label overlap detected between "${current.text}" (${current.left}..${current.right}) and "${next.text}" (${next.left}..${next.right}) at scale ${scale} for ${tc.name}`
              ).toBeGreaterThanOrEqual(0);
            }
          }
        }
      }
    });

    it("3.5 Zero-Overlap Invariant: Verify adjacent labels NEVER overlap along Left Ruler across coordinates 0..999", () => {
      const testCases = [
        { name: "Coords 0..20", originY: 0, height: 20 },
        { name: "Coords around 9..10", originY: 5, height: 15 },
        { name: "Coords around 99..100", originY: 90, height: 25 },
        { name: "Coords up to 999", originY: 980, height: 25 },
      ];

      const scales = [1, 2, 4, 8, 16];
      const fonts = [FONT_3X5, FONT_5X7];

      for (const tc of testCases) {
        for (const scale of scales) {
          for (const font of fonts) {
            const stepY = calculateOptimalStep(scale, tc.height + Math.abs(tc.originY), font);

            const rulerTop = 24;
            const scaledHeight = tc.height * scale;
            const totalHeight = rulerTop + scaledHeight;

            interface LabelBoxY {
              coord: number;
              text: string;
              top: number;
              bottom: number;
            }
            const boxes: LabelBoxY[] = [];

            for (let py = 0; py < tc.height; py++) {
              if (py % stepY === 0) {
                const coord = py + tc.originY;
                const text = coord.toString();
                const cellStartY = rulerTop + py * scale;
                const cellCenterY = cellStartY + Math.floor(scale / 2);
                let textY = cellCenterY - Math.floor(font.charHeight / 2);

                // Exact clamping logic from attachCoordinateRulers
                textY = Math.max(rulerTop, Math.min(totalHeight - font.charHeight - 1, textY));

                boxes.push({
                  coord,
                  text,
                  top: textY,
                  bottom: textY + font.charHeight - 1,
                });
              }
            }

            // Assert NO adjacent vertical label boxes overlap: box[i].bottom < box[i+1].top
            for (let i = 0; i < boxes.length - 1; i++) {
              const current = boxes[i];
              const next = boxes[i + 1];

              const gap = next.top - current.bottom - 1;
              expect(
                gap,
                `Vertical label overlap detected between "${current.text}" (${current.top}..${current.bottom}) and "${next.text}" (${next.top}..${next.bottom}) at scale ${scale} for ${tc.name}`
              ).toBeGreaterThanOrEqual(0);
            }
          }
        }
      }
    });

    it("3.6 Extreme ruler boundary cases: 0x0 sprite dimensions, showTop=false, showLeft=false", () => {
      const dummyScaled = new Uint8Array(0);

      // 0x0 sprite with rulers attached
      const res0 = attachCoordinateRulers(dummyScaled, 0, 0, 8, {
        rulerTop: 20,
        rulerLeft: 20,
      });
      expect(res0.width).toBe(20);
      expect(res0.height).toBe(20);
      expect(res0.data.length).toBe(20 * 20 * 4);

      // showTop = false, showLeft = false
      const scaledImg = new Uint8Array(16 * 16 * 4).fill(100);
      const resNoRulers = attachCoordinateRulers(scaledImg, 2, 2, 8, {
        showTop: false,
        showLeft: false,
      });
      expect(resNoRulers.width).toBe(16);
      expect(resNoRulers.height).toBe(16);
      expect(resNoRulers.rulerTop).toBe(0);
      expect(resNoRulers.rulerLeft).toBe(0);
      expect(resNoRulers.data.length).toBe(16 * 16 * 4);
      expect(resNoRulers.data[0]).toBe(100);
    });

    it("3.7 Visual integrity verification: attachCoordinateRulers preserves hollow glyph pixels without overlap corruption", () => {
      // Repro parameters: originX=980, spriteWidth=25, scale=1
      const spriteW = 25;
      const spriteH = 10;
      const scale = 1;
      const scaledImg = new Uint8Array(spriteW * spriteH * 4).fill(0);

      const result = attachCoordinateRulers(scaledImg, spriteW, spriteH, scale, {
        originX: 980,
        originY: 0,
        rulerTop: 24,
        rulerLeft: 24,
        font: "3x5",
      });

      // Total dimensions
      expect(result.width).toBe(24 + 25); // 49
      expect(result.height).toBe(24 + 10); // 34

      // Inspect glyph row y = 14 (rulerTop - 6 - font.charHeight + 1 = 24 - 6 - 5 + 1 = 14)
      // Label "980" last digit '0' is at x = 32..34. Its hollow center is col 33.
      // In a non-overlapping rendering, col 33 in digit '0' is preserved background (#1E = 30).
      // Zero-overlap collision guard prevents "1000" from overwriting col 33 with textColor (#C8 = 200).
      const pixelIdx = (14 * result.width + 33) * 4;
      const r = result.data[pixelIdx];
      expect(r).toBe(30); // Background (#1E = 30) preserved; zero glyph collision!

      // Also verify explicit stepX: 20 (forced collision scenario) suppresses colliding label
      const forcedResult = attachCoordinateRulers(scaledImg, spriteW, spriteH, scale, {
        originX: 980,
        originY: 0,
        rulerTop: 24,
        rulerLeft: 24,
        font: "3x5",
        stepX: 20,
      });
      const forcedPixelIdx = (14 * forcedResult.width + 33) * 4;
      expect(forcedResult.data[forcedPixelIdx]).toBe(30);
    });
  });
});
