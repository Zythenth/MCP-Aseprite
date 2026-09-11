// test/unit/image_stress.test.ts
import { describe, it, expect } from "vitest";
import {
  scaleNearestNeighbor,
  resizeNearestNeighbor,
} from "../../src/image/scaling.js";
import {
  applyCheckerboardBackdrop,
  createCheckerboardBuffer,
  normalizeCheckerColor,
  type RgbColor,
} from "../../src/image/checkerboard.js";
import {
  encodeRgbaToPngBuffer,
  encodeRgbaToPngBase64,
  decodePngBufferSync,
  decodePngBase64Sync,
  encodeRgbaToPngAsync,
  decodePngAsync,
  InvalidDimensionError,
  BufferSizeMismatchError,
  PngDecodeError,
} from "../../src/image/png.js";

// Deterministic PRNG (Linear Congruential Generator) for reproducible pseudo-random test buffers
function createPseudoRandom(seed = 123456789) {
  let state = seed;
  return function nextByte(): number {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state >>> 24) & 0xff;
  };
}

describe("Milestone 2 Empirical Stress & Adversarial Test Suite", () => {
  // =========================================================================
  // DOMAIN 1: NEAREST-NEIGHBOR SCALER (Zero Blurring & Strict Point Sampling)
  // =========================================================================
  describe("Domain 1: Nearest-Neighbor Scaler Zero-Blurring Proof", () => {
    it("STRESS-NN-1: 8x and 16x scaling on 1px checkerboard proves mathematically zero intermediate colors", () => {
      // 16x16 alternating black (0,0,0,255) and white (255,255,255,255) checkerboard
      const srcW = 16;
      const srcH = 16;
      const src = new Uint8Array(srcW * srcH * 4);

      for (let y = 0; y < srcH; y++) {
        for (let x = 0; x < srcW; x++) {
          const idx = (y * srcW + x) * 4;
          const isWhite = ((x ^ y) & 1) === 0;
          const val = isWhite ? 255 : 0;
          src[idx] = val;
          src[idx + 1] = val;
          src[idx + 2] = val;
          src[idx + 3] = 255;
        }
      }

      for (const scale of [8, 16]) {
        const scaled = scaleNearestNeighbor(src, srcW, srcH, scale);
        const expectedW = srcW * scale;
        const expectedH = srcH * scale;

        expect(scaled.width).toBe(expectedW);
        expect(scaled.height).toBe(expectedH);
        expect(scaled.scale).toBe(scale);
        expect(scaled.data.length).toBe(expectedW * expectedH * 4);

        const distinctColors = new Set<string>();

        // Exhaustively inspect every single pixel
        for (let y = 0; y < expectedH; y++) {
          const srcY = Math.floor(y / scale);
          for (let x = 0; x < expectedW; x++) {
            const srcX = Math.floor(x / scale);
            const dstIdx = (y * expectedW + x) * 4;
            const srcIdx = (srcY * srcW + srcX) * 4;

            const r = scaled.data[dstIdx];
            const g = scaled.data[dstIdx + 1];
            const b = scaled.data[dstIdx + 2];
            const a = scaled.data[dstIdx + 3];

            // 1. Strict point sampling equality
            expect(r).toBe(src[srcIdx]);
            expect(g).toBe(src[srcIdx + 1]);
            expect(b).toBe(src[srcIdx + 2]);
            expect(a).toBe(src[srcIdx + 3]);

            distinctColors.add(`${r},${g},${b},${a}`);
          }
        }

        // 2. Mathematical proof of ZERO blurring:
        // Output must contain ONLY pure black and pure white. Cardinality must be exactly 2.
        expect(distinctColors.size).toBe(2);
        expect(distinctColors.has("0,0,0,255")).toBe(true);
        expect(distinctColors.has("255,255,255,255")).toBe(true);
      }
    });

    it("STRESS-NN-2: 8x and 16x scaling on 1px lines proves razor-sharp boundaries without haloing or bleeding", () => {
      // 8x8 image with 1px vertical line and 1px horizontal line in contrasting colors
      const srcW = 8;
      const srcH = 8;
      const src = new Uint8Array(srcW * srcH * 4);

      // Background: dark blue (0, 0, 100, 255)
      // Vertical line at x=3: bright yellow (255, 255, 0, 255)
      // Horizontal line at y=4: bright red (255, 0, 0, 255)
      // Intersection at (3,4): bright white (255, 255, 255, 255)
      for (let y = 0; y < srcH; y++) {
        for (let x = 0; x < srcW; x++) {
          const idx = (y * srcW + x) * 4;
          if (x === 3 && y === 4) {
            src[idx] = 255; src[idx + 1] = 255; src[idx + 2] = 255; src[idx + 3] = 255;
          } else if (x === 3) {
            src[idx] = 255; src[idx + 1] = 255; src[idx + 2] = 0; src[idx + 3] = 255;
          } else if (y === 4) {
            src[idx] = 255; src[idx + 1] = 0; src[idx + 2] = 0; src[idx + 3] = 255;
          } else {
            src[idx] = 0; src[idx + 1] = 0; src[idx + 2] = 100; src[idx + 3] = 255;
          }
        }
      }

      for (const scale of [8, 16]) {
        const scaled = scaleNearestNeighbor(src, srcW, srcH, scale);
        const dstW = srcW * scale;
        const dstH = srcH * scale;

        const distinctColors = new Set<string>();

        for (let y = 0; y < dstH; y++) {
          const srcY = Math.floor(y / scale);
          for (let x = 0; x < dstW; x++) {
            const srcX = Math.floor(x / scale);
            const dstIdx = (y * dstW + x) * 4;
            const srcIdx = (srcY * srcW + srcX) * 4;

            const r = scaled.data[dstIdx];
            const g = scaled.data[dstIdx + 1];
            const b = scaled.data[dstIdx + 2];
            const a = scaled.data[dstIdx + 3];

            expect(r).toBe(src[srcIdx]);
            expect(g).toBe(src[srcIdx + 1]);
            expect(b).toBe(src[srcIdx + 2]);
            expect(a).toBe(src[srcIdx + 3]);

            distinctColors.add(`${r},${g},${b},${a}`);
          }
        }

        // Distinct colors must be EXACTLY 4 (background, vertical line, horizontal line, intersection)
        expect(distinctColors.size).toBe(4);
        expect(distinctColors.has("0,0,100,255")).toBe(true);
        expect(distinctColors.has("255,255,0,255")).toBe(true);
        expect(distinctColors.has("255,0,0,255")).toBe(true);
        expect(distinctColors.has("255,255,255,255")).toBe(true);

        // Boundary sharpness check: test immediate transition at line boundary
        // Column 3*scale - 1 must be background, Column 3*scale must be yellow line
        const boundaryX_before = 3 * scale - 1;
        const boundaryX_at = 3 * scale;
        const sampleY = 1 * scale; // row 1 (not horizontal line)
        const idxBefore = (sampleY * dstW + boundaryX_before) * 4;
        const idxAt = (sampleY * dstW + boundaryX_at) * 4;

        expect(scaled.data[idxBefore]).toBe(0);     // blue background R
        expect(scaled.data[idxBefore + 2]).toBe(100); // blue background B
        expect(scaled.data[idxAt]).toBe(255);       // yellow line R
        expect(scaled.data[idxAt + 1]).toBe(255);   // yellow line G
        expect(scaled.data[idxAt + 2]).toBe(0);     // yellow line B
      }
    });

    it("STRESS-NN-3: Odd, prime and asymmetric canvas dimensions scaled 8x and 16x maintain strict point sampling", () => {
      const testDimensions = [
        [1, 1],
        [3, 5],
        [7, 11],
        [17, 13],
        [31, 1],
        [1, 29],
      ];

      const rng = createPseudoRandom(42);

      for (const [w, h] of testDimensions) {
        const src = new Uint8Array(w * h * 4);
        for (let i = 0; i < src.length; i++) {
          src[i] = rng();
        }

        for (const scale of [8, 16]) {
          const scaled = scaleNearestNeighbor(src, w, h, scale);
          const dstW = w * scale;
          const dstH = h * scale;

          expect(scaled.width).toBe(dstW);
          expect(scaled.height).toBe(dstH);

          // Sample exhaustive grid
          for (let y = 0; y < dstH; y++) {
            const srcY = Math.floor(y / scale);
            for (let x = 0; x < dstW; x++) {
              const srcX = Math.floor(x / scale);
              const dstIdx = (y * dstW + x) * 4;
              const srcIdx = (srcY * w + srcX) * 4;

              expect(scaled.data[dstIdx]).toBe(src[srcIdx]);
              expect(scaled.data[dstIdx + 1]).toBe(src[srcIdx + 1]);
              expect(scaled.data[dstIdx + 2]).toBe(src[srcIdx + 2]);
              expect(scaled.data[dstIdx + 3]).toBe(src[srcIdx + 3]);
            }
          }
        }
      }
    });

    it("STRESS-NN-4: resizeNearestNeighbor preserves zero intermediate colors across arbitrary aspect ratios", () => {
      const srcW = 4;
      const srcH = 4;
      const src = new Uint8Array([
        255, 0, 0, 255,     0, 255, 0, 255,     0, 0, 255, 255,     255, 255, 0, 255,
        255, 0, 255, 255,   0, 255, 255, 255,   255, 255, 255, 255, 0, 0, 0, 255,
        128, 0, 0, 255,     0, 128, 0, 255,     0, 0, 128, 255,     128, 128, 0, 255,
        128, 0, 128, 255,   0, 128, 128, 255,   128, 128, 128, 255, 64, 64, 64, 255,
      ]);

      const sourceColors = new Set<string>();
      for (let i = 0; i < 16; i++) {
        const idx = i * 4;
        sourceColors.add(`${src[idx]},${src[idx + 1]},${src[idx + 2]},${src[idx + 3]}`);
      }
      expect(sourceColors.size).toBe(16);

      // Resize to non-integer multiple dimensions
      const targetSizes = [
        [13, 19],
        [27, 11],
        [32, 64],
        [64, 32],
      ];

      for (const [targetW, targetH] of targetSizes) {
        const res = resizeNearestNeighbor(src, srcW, srcH, targetW, targetH);
        expect(res.width).toBe(targetW);
        expect(res.height).toBe(targetH);

        for (let y = 0; y < targetH; y++) {
          const expectedSrcY = Math.min(srcH - 1, Math.floor((y * srcH) / targetH));
          for (let x = 0; x < targetW; x++) {
            const expectedSrcX = Math.min(srcW - 1, Math.floor((x * srcW) / targetW));
            const dstIdx = (y * targetW + x) * 4;
            const srcIdx = (expectedSrcY * srcW + expectedSrcX) * 4;

            expect(res.data[dstIdx]).toBe(src[srcIdx]);
            expect(res.data[dstIdx + 1]).toBe(src[srcIdx + 1]);
            expect(res.data[dstIdx + 2]).toBe(src[srcIdx + 2]);
            expect(res.data[dstIdx + 3]).toBe(src[srcIdx + 3]);

            const colorKey = `${res.data[dstIdx]},${res.data[dstIdx + 1]},${res.data[dstIdx + 2]},${res.data[dstIdx + 3]}`;
            expect(sourceColors.has(colorKey)).toBe(true);
          }
        }
      }
    });

    it("STRESS-NN-5: scaleNearestNeighbor rejects non-positive dimensions and buffer underruns", () => {
      const dummy = new Uint8Array(16);
      expect(() => scaleNearestNeighbor(dummy, 0, 2, 8)).toThrow(InvalidDimensionError);
      expect(() => scaleNearestNeighbor(dummy, 2, -1, 8)).toThrow(InvalidDimensionError);
      expect(() => scaleNearestNeighbor(dummy, 2.5, 2, 8)).toThrow(InvalidDimensionError);

      const shortBuf = new Uint8Array(15);
      expect(() => scaleNearestNeighbor(shortBuf, 2, 2, 8)).toThrow(BufferSizeMismatchError);
    });

    it("STRESS-NN-6: Unaligned memory buffers and subarray slices scale correctly at 8x and 16x", () => {
      // Create an unaligned buffer where byteOffset = 3
      const backing = new ArrayBuffer(4 * 4 * 4 + 7);
      const unaligned = new Uint8Array(backing, 3, 4 * 4 * 4);
      for (let i = 0; i < unaligned.length; i++) {
        unaligned[i] = (i * 17) % 256;
      }

      for (const scale of [8, 16]) {
        const scaled = scaleNearestNeighbor(unaligned, 4, 4, scale);
        expect(scaled.width).toBe(4 * scale);
        expect(scaled.height).toBe(4 * scale);

        // Verify first and last pixel
        const firstDstIdx = 0;
        expect(scaled.data[firstDstIdx]).toBe(unaligned[0]);
        expect(scaled.data[firstDstIdx + 1]).toBe(unaligned[1]);
        expect(scaled.data[firstDstIdx + 2]).toBe(unaligned[2]);
        expect(scaled.data[firstDstIdx + 3]).toBe(unaligned[3]);

        const lastDstIdx = ((4 * scale - 1) * (4 * scale) + (4 * scale - 1)) * 4;
        const lastSrcIdx = (3 * 4 + 3) * 4;
        expect(scaled.data[lastDstIdx]).toBe(unaligned[lastSrcIdx]);
        expect(scaled.data[lastDstIdx + 1]).toBe(unaligned[lastSrcIdx + 1]);
        expect(scaled.data[lastDstIdx + 2]).toBe(unaligned[lastSrcIdx + 2]);
        expect(scaled.data[lastDstIdx + 3]).toBe(unaligned[lastSrcIdx + 3]);
      }
    });
  });

  // =========================================================================
  // DOMAIN 2: INTEGER PORTER-DUFF ALPHA COMPOSITING
  // =========================================================================
  describe("Domain 2: Integer Porter-Duff Alpha Compositing Correctness", () => {
    // Mathematical reference oracle for exact Porter-Duff source-over blend:
    function porterDuffOracle(srcVal: number, alpha: number, bgVal: number): number {
      if (alpha === 255) return srcVal;
      if (alpha === 0) return bgVal;
      return Math.floor((srcVal * alpha + bgVal * (255 - alpha) + 127) / 255);
    }

    it("STRESS-PD-1: Exhaustive 256-alpha sweep on primary and boundary colors matches mathematical oracle exactly", () => {
      const lightColor: RgbColor = { r: 204, g: 204, b: 204 };
      const darkColor: RgbColor = { r: 153, g: 153, b: 153 };

      const testColors: [number, number, number][] = [
        [255, 0, 0],       // Red
        [0, 255, 0],       // Green
        [0, 0, 255],       // Blue
        [255, 255, 255],   // White
        [0, 0, 0],         // Black
        [128, 64, 192],    // Midtone
        [1, 254, 127],     // Boundary values
      ];

      // Test each color across all 256 alpha values (0..255) over both light and dark tiles
      for (const [r, g, b] of testColors) {
        // Create a 2x1 buffer: pixel (0,0) on light tile, pixel (1,0) on dark tile
        for (let a = 0; a <= 255; a++) {
          const src = new Uint8Array([
            r, g, b, a,
            r, g, b, a,
          ]);

          const result = applyCheckerboardBackdrop(src, 2, 1, {
            cellSize: 1,
            lightColor,
            darkColor,
          });

          // Pixel 0 (light tile)
          const expectedR0 = porterDuffOracle(r, a, lightColor.r);
          const expectedG0 = porterDuffOracle(g, a, lightColor.g);
          const expectedB0 = porterDuffOracle(b, a, lightColor.b);

          expect(result[0]).toBe(expectedR0);
          expect(result[1]).toBe(expectedG0);
          expect(result[2]).toBe(expectedB0);
          expect(result[3]).toBe(255); // Always opaque

          // Pixel 1 (dark tile)
          const expectedR1 = porterDuffOracle(r, a, darkColor.r);
          const expectedG1 = porterDuffOracle(g, a, darkColor.g);
          const expectedB1 = porterDuffOracle(b, a, darkColor.b);

          expect(result[4]).toBe(expectedR1);
          expect(result[5]).toBe(expectedG1);
          expect(result[6]).toBe(expectedB1);
          expect(result[7]).toBe(255); // Always opaque
        }
      }
    });

    it("STRESS-PD-2: Zero color drift or arithmetic overflow across all RGB cross-products", () => {
      // Test matrix of 8 sample intensities x 8 sample alphas = 64 combinations
      const sampleVals = [0, 1, 64, 127, 128, 192, 254, 255];
      const width = sampleVals.length;
      const height = sampleVals.length;
      const src = new Uint8Array(width * height * 4);

      for (let y = 0; y < height; y++) {
        const a = sampleVals[y];
        for (let x = 0; x < width; x++) {
          const v = sampleVals[x];
          const idx = (y * width + x) * 4;
          src[idx] = v;
          src[idx + 1] = 255 - v;
          src[idx + 2] = (v * 2) % 256;
          src[idx + 3] = a;
        }
      }

      const composited = applyCheckerboardBackdrop(src, width, height, {
        cellSize: 2,
        lightColor: "#E0E0E0",
        darkColor: "#404040",
      });

      const lightRgb = { r: 0xE0, g: 0xE0, b: 0xE0 };
      const darkRgb = { r: 0x40, g: 0x40, b: 0x40 };

      for (let y = 0; y < height; y++) {
        const yTile = Math.floor(y / 2);
        for (let x = 0; x < width; x++) {
          const xTile = Math.floor(x / 2);
          const isLight = ((xTile ^ yTile) & 1) === 0;
          const bg = isLight ? lightRgb : darkRgb;

          const idx = (y * width + x) * 4;
          const srcR = src[idx];
          const srcG = src[idx + 1];
          const srcB = src[idx + 2];
          const srcA = src[idx + 3];

          const outR = composited[idx];
          const outG = composited[idx + 1];
          const outB = composited[idx + 2];
          const outA = composited[idx + 3];

          // Strict boundary check: no negative values, no wrap-around overflow
          expect(outR).toBeGreaterThanOrEqual(0);
          expect(outR).toBeLessThanOrEqual(255);
          expect(outG).toBeGreaterThanOrEqual(0);
          expect(outG).toBeLessThanOrEqual(255);
          expect(outB).toBeGreaterThanOrEqual(0);
          expect(outB).toBeLessThanOrEqual(255);
          expect(outA).toBe(255);

          // Exact mathematical identity with oracle
          expect(outR).toBe(porterDuffOracle(srcR, srcA, bg.r));
          expect(outG).toBe(porterDuffOracle(srcG, srcA, bg.g));
          expect(outB).toBe(porterDuffOracle(srcB, srcA, bg.b));
        }
      }
    });

    it("STRESS-PD-3: Non-power-of-two cell sizes (3, 5, 7) and non-square aspect ratios evaluate tiles accurately", () => {
      const nonPowerOfTwoSizes = [3, 5, 7, 11];
      const w = 23;
      const h = 19;
      const empty = new Uint8Array(w * h * 4); // all alpha = 0

      for (const cellSize of nonPowerOfTwoSizes) {
        const result = applyCheckerboardBackdrop(empty, w, h, {
          cellSize,
          lightColor: 220,
          darkColor: 110,
        });

        for (let y = 0; y < h; y++) {
          const yTile = Math.floor(y / cellSize);
          for (let x = 0; x < w; x++) {
            const xTile = Math.floor(x / cellSize);
            const isLight = ((xTile ^ yTile) & 1) === 0;
            const expectedVal = isLight ? 220 : 110;

            const idx = (y * w + x) * 4;
            expect(result[idx]).toBe(expectedVal);
            expect(result[idx + 1]).toBe(expectedVal);
            expect(result[idx + 2]).toBe(expectedVal);
            expect(result[idx + 3]).toBe(255);
          }
        }
      }
    });

    it("STRESS-PD-4: Color format parser robustness across valid inputs and NaN behavior on non-hex strings", () => {
      // 1. Numeric color
      const c1 = normalizeCheckerColor(180, 204);
      expect(c1).toEqual({ r: 180, g: 180, b: 180 });

      // 2. 3-digit hex
      const c2 = normalizeCheckerColor("#FFF", 204);
      expect(c2).toEqual({ r: 255, g: 255, b: 255 });

      // 3. 6-digit hex
      const c3 = normalizeCheckerColor("#123456", 204);
      expect(c3).toEqual({ r: 0x12, g: 0x34, b: 0x56 });

      // 4. RGB object
      const c4 = normalizeCheckerColor({ r: 50, g: 100, b: 150 }, 204);
      expect(c4).toEqual({ r: 50, g: 100, b: 150 });

      // 5. Undefined input triggers clean fallback
      const c5 = normalizeCheckerColor(undefined, 204);
      expect(c5).toEqual({ r: 204, g: 204, b: 204 });

      // 6. Non-matching length (< 3 or 4-5) triggers fallback
      const c6Short = normalizeCheckerColor("ab", 204);
      expect(c6Short).toEqual({ r: 204, g: 204, b: 204 });

      // 7. SANITIZATION FIX VERIFICATION:
      // Non-hex strings cleanly trigger fallback to default without producing NaN values:
      const badHex = normalizeCheckerColor("invalid", 204);
      expect(badHex).toEqual({ r: 204, g: 204, b: 204 });
      expect(Number.isNaN(badHex.r)).toBe(false);
      expect(Number.isNaN(badHex.g)).toBe(false);
      expect(Number.isNaN(badHex.b)).toBe(false);

      // Downstream consequence: semi-transparent pixels blend cleanly with fallback instead of collapsing to pitch black
      const semiTransparent = new Uint8Array([200, 100, 50, 128]);
      const blendedResult = applyCheckerboardBackdrop(semiTransparent, 1, 1, {
        lightColor: "invalid",
      });
      expect(blendedResult[0]).toBe(202);
      expect(blendedResult[1]).toBe(152);
      expect(blendedResult[2]).toBe(127);
      expect(blendedResult[3]).toBe(255);
    });

    it("STRESS-PD-5: applyCheckerboardBackdrop validates dimensions and buffer bounds strictly", () => {
      const dummy = new Uint8Array(16);
      expect(() => applyCheckerboardBackdrop(dummy, -1, 2)).toThrow(InvalidDimensionError);
      expect(() => applyCheckerboardBackdrop(dummy, 2, 0)).toThrow(InvalidDimensionError);
      expect(() => applyCheckerboardBackdrop(new Uint8Array(8), 2, 2)).toThrow(BufferSizeMismatchError);
    });
  });

  // =========================================================================
  // DOMAIN 3: PNG ENCODING / DECODING ROUND-TRIP IDENTITY
  // =========================================================================
  describe("Domain 3: PNG Lossless Encoding/Decoding Round-Trip Identity", () => {
    it("STRESS-PNG-1: High-entropy pseudo-random RGBA buffers roundtrip with 100% byte-level identity", () => {
      const rng = createPseudoRandom(987654321);
      const testDimensions = [
        [1, 1],
        [2, 2],
        [3, 3],
        [8, 8],
        [16, 16],
        [33, 17],
        [50, 25],
      ];

      for (const [w, h] of testDimensions) {
        const totalBytes = w * h * 4;
        const original = new Uint8Array(totalBytes);
        for (let i = 0; i < totalBytes; i++) {
          original[i] = rng();
        }

        // 1. Sync Buffer Round-Trip
        const encodedBuffer = encodeRgbaToPngBuffer(original, w, h);
        const decodedBuffer = decodePngBufferSync(encodedBuffer);
        expect(decodedBuffer.width).toBe(w);
        expect(decodedBuffer.height).toBe(h);
        expect(decodedBuffer.data.length).toBe(totalBytes);

        for (let i = 0; i < totalBytes; i++) {
          if (decodedBuffer.data[i] !== original[i]) {
            throw new Error(
              `Sync Buffer Round-trip mismatch at byte ${i} (pixel ${Math.floor(i / 4)}, channel ${i % 4}): expected ${original[i]}, got ${decodedBuffer.data[i]} for size ${w}x${h}`
            );
          }
        }

        // 2. Sync Base64 Round-Trip
        const encodedBase64 = encodeRgbaToPngBase64(original, w, h);
        const decodedBase64 = decodePngBase64Sync(encodedBase64.base64);
        expect(decodedBase64.width).toBe(w);
        expect(decodedBase64.height).toBe(h);

        for (let i = 0; i < totalBytes; i++) {
          if (decodedBase64.data[i] !== original[i]) {
            throw new Error(
              `Sync Base64 Round-trip mismatch at byte ${i}: expected ${original[i]}, got ${decodedBase64.data[i]} for size ${w}x${h}`
            );
          }
        }
      }
    });

    it("STRESS-PNG-2: Async streaming encode/decode roundtrip produces byte-for-byte identical output", async () => {
      const rng = createPseudoRandom(55555555);
      const w = 24;
      const h = 24;
      const totalBytes = w * h * 4;
      const original = new Uint8Array(totalBytes);
      for (let i = 0; i < totalBytes; i++) {
        original[i] = rng();
      }

      const asyncResult = await encodeRgbaToPngAsync(original, w, h);
      expect(asyncResult.width).toBe(w);
      expect(asyncResult.height).toBe(h);
      expect(asyncResult.buffer.length).toBeGreaterThan(0);
      expect(asyncResult.base64.length).toBeGreaterThan(0);

      const decodedFromBuffer = await decodePngAsync(asyncResult.buffer);
      const decodedFromBase64 = await decodePngAsync(asyncResult.base64);

      expect(decodedFromBuffer.width).toBe(w);
      expect(decodedFromBuffer.height).toBe(h);
      expect(decodedFromBase64.width).toBe(w);
      expect(decodedFromBase64.height).toBe(h);

      for (let i = 0; i < totalBytes; i++) {
        expect(decodedFromBuffer.data[i]).toBe(original[i]);
        expect(decodedFromBase64.data[i]).toBe(original[i]);
      }
    });

    it("STRESS-PNG-3: Pathological RGBA buffers (solid colors, all-zero, alpha gradients, hidden colors in transparent pixels)", () => {
      const w = 16;
      const h = 16;
      const totalBytes = w * h * 4;

      // Case A: All zeroes
      const zeroBuf = new Uint8Array(totalBytes);
      const decodedZero = decodePngBufferSync(encodeRgbaToPngBuffer(zeroBuf, w, h));
      for (let i = 0; i < totalBytes; i++) {
        expect(decodedZero.data[i]).toBe(0);
      }

      // Case B: All 0xFF
      const solidBuf = new Uint8Array(totalBytes);
      solidBuf.fill(255);
      const decodedSolid = decodePngBufferSync(encodeRgbaToPngBuffer(solidBuf, w, h));
      for (let i = 0; i < totalBytes; i++) {
        expect(decodedSolid.data[i]).toBe(255);
      }

      // Case C: Critical pixel art case — non-zero RGB inside alpha=0 pixels
      // (Testing that PNG encoder does NOT clobber color values when alpha is 0)
      const hiddenColorBuf = new Uint8Array(totalBytes);
      for (let i = 0; i < totalBytes; i += 4) {
        hiddenColorBuf[i] = 123;     // R
        hiddenColorBuf[i + 1] = 234; // G
        hiddenColorBuf[i + 2] = 45;  // B
        hiddenColorBuf[i + 3] = 0;   // A = 0 (fully transparent)
      }
      const decodedHidden = decodePngBufferSync(encodeRgbaToPngBuffer(hiddenColorBuf, w, h));
      for (let i = 0; i < totalBytes; i += 4) {
        expect(decodedHidden.data[i]).toBe(123);
        expect(decodedHidden.data[i + 1]).toBe(234);
        expect(decodedHidden.data[i + 2]).toBe(45);
        expect(decodedHidden.data[i + 3]).toBe(0);
      }
    });

    it("STRESS-PNG-4: All deflate compression levels (0, 1, 6, 9) and filter types preserve 100% data fidelity", () => {
      const rng = createPseudoRandom(11223344);
      const w = 12;
      const h = 12;
      const totalBytes = w * h * 4;
      const original = new Uint8Array(totalBytes);
      for (let i = 0; i < totalBytes; i++) {
        original[i] = rng();
      }

      const deflateLevels = [0, 1, 6, 9];
      const filterTypes = [0, 1, 2, 3, 4]; // None, Sub, Up, Average, Paeth

      for (const deflateLevel of deflateLevels) {
        for (const filterType of filterTypes) {
          const encoded = encodeRgbaToPngBuffer(original, w, h, {
            deflateLevel,
            filterType,
          });

          const decoded = decodePngBufferSync(encoded);
          expect(decoded.width).toBe(w);
          expect(decoded.height).toBe(h);

          for (let i = 0; i < totalBytes; i++) {
            if (decoded.data[i] !== original[i]) {
              throw new Error(
                `Mismatch with deflateLevel=${deflateLevel} filterType=${filterType} at byte ${i}: expected ${original[i]}, got ${decoded.data[i]}`
              );
            }
          }
        }
      }
    });

    it("STRESS-PNG-5: Robust error handling on corrupted data, invalid headers, and bad base64 strings", () => {
      // 1. Truncated PNG header
      const truncatedBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // Only 4 bytes
      expect(() => decodePngBufferSync(truncatedBuf)).toThrow(PngDecodeError);

      // 2. Corrupted random non-PNG payload
      const garbageBuf = Buffer.from("NOT_A_VALID_PNG_FILE_AT_ALL_JUST_RANDOM_TEXT");
      expect(() => decodePngBufferSync(garbageBuf)).toThrow(PngDecodeError);

      // 3. Empty base64
      expect(() => decodePngBase64Sync("")).toThrow(PngDecodeError);

      // 4. Invalid base64 characters
      expect(() => decodePngBase64Sync("!@#$%^&*()")).toThrow(PngDecodeError);

      // 5. Dimension mismatch
      const shortBuf = new Uint8Array(12);
      expect(() => encodeRgbaToPngBuffer(shortBuf, 2, 2)).toThrow(BufferSizeMismatchError);
    });
  });
});
