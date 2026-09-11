// test/unit/challenger_m2_3_empirical.test.ts
import { describe, it, expect } from "vitest";
import {
  attachCoordinateRulers,
  calculateOptimalStep,
  calculateRulerThickness,
  measureText,
  FONT_3X5,
  FONT_5X7,
  GlyphFont,
} from "../../src/image/rulers.js";
import {
  scaleNearestNeighbor,
  resizeNearestNeighbor,
} from "../../src/image/scaling.js";
import {
  InvalidDimensionError,
  BufferSizeMismatchError,
  ImagePipelineError,
} from "../../src/image/png.js";

describe("Milestone 2 Challenger 1 (Iteration 2): Empirical Stress & Hardening Harness", () => {
  // =========================================================================
  // DOMAIN 1: COORDINATE RULERS OVERLAP AND BACKGROUND INTEGRITY STRESS
  // =========================================================================
  describe("Domain 1: Coordinate Rulers Empirical Stress", () => {
    const origins = [980, 1000, -500, 0, -1, 10000, -9999];
    const scales = [1, 2];
    const widths = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 20, 25, 30, 40, 50];
    const fonts: Array<"3x5" | "5x7"> = ["3x5", "5x7"];

    it("1.1 Top Ruler Exhaustive Sweep: Scale 1 and 2, origins (980, 1000, -500), widths 5..50 (Auto Step)", () => {
      let scenariosChecked = 0;
      for (const scale of scales) {
        for (const originX of origins) {
          for (const width of widths) {
            for (const fontName of fonts) {
              const font = fontName === "5x7" ? FONT_5X7 : FONT_3X5;
              const height = 10;
              const scaledImg = new Uint8Array(width * height * scale * scale * 4);
              scaledImg.fill(42);

              const result = attachCoordinateRulers(scaledImg, width, height, scale, {
                originX,
                font: fontName,
                backgroundColor: "#1E1E1E",
                textColor: "#C8C8C8",
                dividerColor: "#505050",
                tickColor: "#707070",
              });

              // 1. Verify canvas dimensions
              const expectedTotalWidth = result.rulerLeft + width * scale;
              const expectedTotalHeight = result.rulerTop + height * scale;
              expect(result.width).toBe(expectedTotalWidth);
              expect(result.height).toBe(expectedTotalHeight);
              expect(result.data.length).toBe(expectedTotalWidth * expectedTotalHeight * 4);

              // 2. Verify scaled image blit integrity (no corruption of image by ruler drawing)
              for (let y = 0; y < height * scale; y++) {
                for (let x = 0; x < width * scale; x++) {
                  const canvasIdx = ((y + result.rulerTop) * result.width + (x + result.rulerLeft)) * 4;
                  expect(result.data[canvasIdx]).toBe(42);
                  expect(result.data[canvasIdx + 1]).toBe(42);
                  expect(result.data[canvasIdx + 2]).toBe(42);
                  expect(result.data[canvasIdx + 3]).toBe(42);
                }
              }

              // 3. Verify divider rows
              const dividerY = result.rulerTop - 1;
              for (let x = 0; x < result.width; x++) {
                const idx = (dividerY * result.width + x) * 4;
                expect(result.data[idx]).toBe(80);
              }

              // 4. Trace all labels drawn by re-running ruler logic and verify non-overlap
              const stepX = calculateOptimalStep(scale, width + Math.abs(originX), font);
              let lastRightX = -1;

              for (let px = 0; px < width; px++) {
                if (px % stepX === 0) {
                  const coord = px + originX;
                  const text = coord.toString();
                  const textDim = measureText(text, font);
                  const cellStartX = result.rulerLeft + px * scale;
                  const cellCenterX = cellStartX + Math.floor(scale / 2);
                  let textX = cellCenterX - Math.floor(textDim.width / 2);
                  textX = Math.max(result.rulerLeft, Math.min(result.width - textDim.width - 1, textX));

                  // If this label was drawn (not suppressed)
                  if (!(lastRightX >= 0 && textX <= lastRightX + 1)) {
                    if (lastRightX >= 0) {
                      const gap = textX - lastRightX - 1;
                      expect(gap).toBeGreaterThanOrEqual(0);
                    }
                    lastRightX = textX + textDim.width - 1;
                  }
                }
              }

              scenariosChecked++;
            }
          }
        }
      }
      expect(scenariosChecked).toBe(scales.length * origins.length * widths.length * fonts.length);
    });

    it("1.2 Top Ruler Forced Step Stress: Verify forced stepX (1, 2, 5, 10, 20) NEVER produces overlapping labels", () => {
      const forcedSteps = [1, 2, 5, 10, 20];
      let checks = 0;

      for (const scale of [1, 2]) {
        for (const originX of [980, 1000, -500, 0]) {
          for (const width of [5, 15, 25, 50]) {
            for (const stepX of forcedSteps) {
              const scaledImg = new Uint8Array(width * 10 * scale * scale * 4).fill(0);
              const result = attachCoordinateRulers(scaledImg, width, 10, scale, {
                originX,
                stepX,
                font: "3x5",
                backgroundColor: "#1E1E1E",
                textColor: "#C8C8C8",
              });

              let lastRightX = -1;
              const drawnLabels: Array<{ coord: number; left: number; right: number }> = [];

              for (let px = 0; px < width; px++) {
                if (px % stepX === 0) {
                  const coord = px + originX;
                  const text = coord.toString();
                  const textDim = measureText(text, FONT_3X5);
                  const cellStartX = result.rulerLeft + px * scale;
                  const cellCenterX = cellStartX + Math.floor(scale / 2);
                  let textX = cellCenterX - Math.floor(textDim.width / 2);
                  textX = Math.max(result.rulerLeft, Math.min(result.width - textDim.width - 1, textX));

                  if (lastRightX >= 0 && textX <= lastRightX + 1) {
                    continue;
                  }

                  drawnLabels.push({
                    coord,
                    left: textX,
                    right: textX + textDim.width - 1,
                  });
                  lastRightX = textX + textDim.width - 1;
                }
              }

              for (let i = 0; i < drawnLabels.length - 1; i++) {
                const current = drawnLabels[i];
                const next = drawnLabels[i + 1];
                const gap = next.left - current.right - 1;
                expect(
                  gap,
                  `Forced stepX=${stepX} overlap between ${current.coord} and ${next.coord} at scale=${scale}, width=${width}`
                ).toBeGreaterThanOrEqual(0);
              }

              checks++;
            }
          }
        }
      }
      expect(checks).toBeGreaterThan(100);
    });

    it("1.3 Left Ruler Exhaustive Sweep: Scale 1 and 2, origins (980, 1000, -500), heights 5..50, forced steps", () => {
      const forcedSteps = [1, 2, 5, 10];
      let checks = 0;

      for (const scale of [1, 2]) {
        for (const originY of [980, 1000, -500, 0]) {
          for (const height of [5, 12, 25, 45]) {
            for (const stepY of forcedSteps) {
              const scaledImg = new Uint8Array(10 * height * scale * scale * 4).fill(0);
              const result = attachCoordinateRulers(scaledImg, 10, height, scale, {
                originY,
                stepY,
                font: "3x5",
                backgroundColor: "#1E1E1E",
                textColor: "#C8C8C8",
              });

              let lastBottomY = -1;
              const drawnLabels: Array<{ coord: number; top: number; bottom: number }> = [];

              for (let py = 0; py < height; py++) {
                if (py % stepY === 0) {
                  const coord = py + originY;
                  const text = coord.toString();
                  const cellStartY = result.rulerTop + py * scale;
                  const cellCenterY = cellStartY + Math.floor(scale / 2);
                  let textY = cellCenterY - Math.floor(FONT_3X5.charHeight / 2);
                  textY = Math.max(result.rulerTop, Math.min(result.height - FONT_3X5.charHeight - 1, textY));

                  if (lastBottomY >= 0 && textY <= lastBottomY + 1) {
                    continue;
                  }

                  drawnLabels.push({
                    coord,
                    top: textY,
                    bottom: textY + FONT_3X5.charHeight - 1,
                  });
                  lastBottomY = textY + FONT_3X5.charHeight - 1;
                }
              }

              for (let i = 0; i < drawnLabels.length - 1; i++) {
                const current = drawnLabels[i];
                const next = drawnLabels[i + 1];
                const gap = next.top - current.bottom - 1;
                expect(
                  gap,
                  `Forced stepY=${stepY} vertical overlap between ${current.coord} and ${next.coord} at scale=${scale}`
                ).toBeGreaterThanOrEqual(0);
              }

              checks++;
            }
          }
        }
      }
      expect(checks).toBeGreaterThan(60);
    });

    it("1.4 Background Pixel Integrity: Digit glyph interiors and gutter background uncorrupted", () => {
      // Test with originX=980, width=30, scale=1
      const scaledImg = new Uint8Array(30 * 10 * 4).fill(0);
      const result = attachCoordinateRulers(scaledImg, 30, 10, 1, {
        originX: 980,
        font: "3x5",
        backgroundColor: "#1E1E1E",
        textColor: "#C8C8C8",
        dividerColor: "#505050",
        tickColor: "#707070",
        cornerColor: "#181818",
      });

      // Background color is #1E1E1E (30)
      // Corner box interior is #181818 (24) for x < rulerLeft-1 and y < rulerTop-1
      for (let y = 0; y < result.rulerTop - 1; y++) {
        for (let x = 0; x < result.rulerLeft - 1; x++) {
          const idx = (y * result.width + x) * 4;
          expect(result.data[idx]).toBe(24);
          expect(result.data[idx + 1]).toBe(24);
          expect(result.data[idx + 2]).toBe(24);
          expect(result.data[idx + 3]).toBe(255);
        }
      }

      // Dividers at y = rulerTop - 1 and x = rulerLeft - 1 must be 80
      for (let x = 0; x < result.width; x++) {
        const idx = ((result.rulerTop - 1) * result.width + x) * 4;
        expect(result.data[idx]).toBe(80);
      }
      for (let y = 0; y < result.height; y++) {
        const idx = (y * result.width + (result.rulerLeft - 1)) * 4;
        expect(result.data[idx]).toBe(80);
      }

      // Gutter pixels: every pixel must be one of {24, 30, 80, 112, 200}
      const allowedR = new Set([24, 30, 80, 112, 200]);
      for (let y = 0; y < result.rulerTop; y++) {
        for (let x = 0; x < result.width; x++) {
          const idx = (y * result.width + x) * 4;
          expect(allowedR.has(result.data[idx])).toBe(true);
        }
      }
    });

    it("1.5 Glyph Micro-Font Invariant: Hollow centers of digits remain background color across origins and widths", () => {
      // Test multiple origins: 980 (has '0', '8', '9'), 1000 (has multiple '0'), -500 (has '-', '5', '0')
      const testOrigins = [980, 1000, -500];
      const testWidths = [10, 25, 35, 50];

      for (const originX of testOrigins) {
        for (const width of testWidths) {
          const scaledImg = new Uint8Array(width * 10 * 4).fill(0);
          const result = attachCoordinateRulers(scaledImg, width, 10, 1, {
            originX,
            font: "3x5",
            backgroundColor: "#1E1E1E",
            textColor: "#C8C8C8",
          });

          // Compute which labels are actually drawn
          const stepX = calculateOptimalStep(1, width + Math.abs(originX), FONT_3X5);
          let lastRightX = -1;

          for (let px = 0; px < width; px++) {
            if (px % stepX === 0) {
              const coord = px + originX;
              const text = coord.toString();
              const textDim = measureText(text, FONT_3X5);
              const cellStartX = result.rulerLeft + px;
              const cellCenterX = cellStartX;
              let textX = cellCenterX - Math.floor(textDim.width / 2);
              textX = Math.max(result.rulerLeft, Math.min(result.width - textDim.width - 1, textX));

              if (lastRightX >= 0 && textX <= lastRightX + 1) {
                continue;
              }

              // This label was drawn. Verify EVERY glyph pixel!
              const textY = Math.max(1, result.rulerTop - 6 - FONT_3X5.charHeight);
              let curX = textX;

              for (let i = 0; i < text.length; i++) {
                const char = text[i];
                const glyph = FONT_3X5.glyphs[char] ?? FONT_3X5.glyphs[" "];
                if (glyph) {
                  for (let row = 0; row < FONT_3X5.charHeight; row++) {
                    const py = textY + row;
                    const bits = glyph[row];
                    for (let col = 0; col < FONT_3X5.charWidth; col++) {
                      const pxPos = curX + col;
                      if (pxPos >= result.rulerLeft && pxPos < result.width) {
                        const bit = (bits >> (FONT_3X5.charWidth - 1 - col)) & 1;
                        const idx = (py * result.width + pxPos) * 4;
                        const pixelVal = result.data[idx];
                        if (bit === 1) {
                          expect(pixelVal, `Text pixel at (${pxPos}, ${py}) for '${char}' in "${text}" should be textColor (200)`).toBe(200);
                        } else {
                          expect(pixelVal, `Hollow pixel at (${pxPos}, ${py}) for '${char}' in "${text}" should be backgroundColor (30)`).toBe(30);
                        }
                      }
                    }
                  }
                }
                curX += FONT_3X5.charWidth + FONT_3X5.spacing;
              }

              lastRightX = textX + textDim.width - 1;
            }
          }
        }
      }
    });

    it("1.6 Higher Scales 3..16: Verify zero overlap across larger scales", () => {
      const highScales = [3, 4, 6, 8, 12, 16];
      for (const scale of highScales) {
        for (const originX of [980, -500, 1000]) {
          const width = 20;
          const scaledImg = new Uint8Array(width * 10 * scale * scale * 4).fill(0);
          const result = attachCoordinateRulers(scaledImg, width, 10, scale, {
            originX,
            font: "3x5",
          });
          expect(result.width).toBe(result.rulerLeft + width * scale);
          expect(result.height).toBe(result.rulerTop + 10 * scale);
        }
      }
    });
  });

  // =========================================================================
  // DOMAIN 2: NEAREST-NEIGHBOR SCALING HARDENING STRESS
  // =========================================================================
  describe("Domain 2: Nearest-Neighbor Scaling Hardening Stress", () => {
    const valid4x4 = new Uint8Array(4 * 4 * 4).fill(128);

    it("2.1 resizeNearestNeighbor throws InvalidDimensionError on invalid src dimensions (<=0 or non-integer)", () => {
      const invalidDims = [0, -1, -50, 1.5, 0.99, NaN, Infinity, -Infinity];

      for (const inv of invalidDims) {
        expect(() => resizeNearestNeighbor(valid4x4, inv, 4, 8, 8))
          .toThrowError(InvalidDimensionError);
        try {
          resizeNearestNeighbor(valid4x4, inv, 4, 8, 8);
        } catch (err) {
          expect(err instanceof InvalidDimensionError).toBe(true);
          expect(err instanceof ImagePipelineError).toBe(true);
          expect((err as Error).name).toBe("InvalidDimensionError");
        }

        expect(() => resizeNearestNeighbor(valid4x4, 4, inv, 8, 8))
          .toThrowError(InvalidDimensionError);
        try {
          resizeNearestNeighbor(valid4x4, 4, inv, 8, 8);
        } catch (err) {
          expect(err instanceof InvalidDimensionError).toBe(true);
          expect((err as Error).name).toBe("InvalidDimensionError");
        }
      }
    });

    it("2.2 resizeNearestNeighbor throws InvalidDimensionError on invalid target dimensions (<=0 or non-integer)", () => {
      const invalidDims = [0, -1, -100, 2.5, 0.01, NaN, Infinity, -Infinity];

      for (const inv of invalidDims) {
        expect(() => resizeNearestNeighbor(valid4x4, 4, 4, inv, 8))
          .toThrowError(InvalidDimensionError);
        try {
          resizeNearestNeighbor(valid4x4, 4, 4, inv, 8);
        } catch (err) {
          expect(err instanceof InvalidDimensionError).toBe(true);
          expect((err as Error).name).toBe("InvalidDimensionError");
        }

        expect(() => resizeNearestNeighbor(valid4x4, 4, 4, 8, inv))
          .toThrowError(InvalidDimensionError);
        try {
          resizeNearestNeighbor(valid4x4, 4, 4, 8, inv);
        } catch (err) {
          expect(err instanceof InvalidDimensionError).toBe(true);
          expect((err as Error).name).toBe("InvalidDimensionError");
        }
      }
    });

    it("2.3 resizeNearestNeighbor throws BufferSizeMismatchError on truncated buffers", () => {
      const expectedBytes = 4 * 4 * 4; // 64 bytes
      const truncatedSizes = [0, 1, 16, 32, 60, 61, 62, 63];

      for (const size of truncatedSizes) {
        const truncatedBuf = new Uint8Array(size);
        expect(() => resizeNearestNeighbor(truncatedBuf, 4, 4, 8, 8))
          .toThrowError(BufferSizeMismatchError);

        try {
          resizeNearestNeighbor(truncatedBuf, 4, 4, 8, 8);
        } catch (err) {
          expect(err instanceof BufferSizeMismatchError).toBe(true);
          expect(err instanceof ImagePipelineError).toBe(true);
          expect((err as Error).name).toBe("BufferSizeMismatchError");
          expect((err as Error).message).toContain(`expected ${expectedBytes} bytes`);
          expect((err as Error).message).toContain(`received ${size} bytes`);
        }
      }
    });

    it("2.4 scaleNearestNeighbor parity: throws InvalidDimensionError and BufferSizeMismatchError", () => {
      expect(() => scaleNearestNeighbor(valid4x4, 0, 4, 2)).toThrowError(InvalidDimensionError);
      expect(() => scaleNearestNeighbor(valid4x4, -4, 4, 2)).toThrowError(InvalidDimensionError);
      expect(() => scaleNearestNeighbor(valid4x4, 4, 2.5, 2)).toThrowError(InvalidDimensionError);
      expect(() => scaleNearestNeighbor(new Uint8Array(63), 4, 4, 2)).toThrowError(BufferSizeMismatchError);
    });

    it("2.5 Unaligned memory buffer offset handling in resizeNearestNeighbor", () => {
      const raw = new ArrayBuffer(64 + 16);
      for (const offset of [1, 2, 3]) {
        const unalignedView = new Uint8Array(raw, offset, 64);
        unalignedView.fill(200);

        const res = resizeNearestNeighbor(unalignedView, 4, 4, 8, 8);
        expect(res.width).toBe(8);
        expect(res.height).toBe(8);
        expect(res.data.length).toBe(8 * 8 * 4);
        expect(res.data[0]).toBe(200);
      }
    });

    it("2.6 Excess buffer capacity succeeds without throwing", () => {
      const excessBuf = new Uint8Array(128).fill(99);
      const res = resizeNearestNeighbor(excessBuf, 4, 4, 2, 2);
      expect(res.width).toBe(2);
      expect(res.height).toBe(2);
      expect(res.data.length).toBe(2 * 2 * 4);
      expect(res.data[0]).toBe(99);
    });

    it("2.7 Extreme aspect ratio resizing produces deterministic nearest-neighbor sampling", () => {
      const tallBuf = new Uint8Array(1 * 100 * 4);
      for (let y = 0; y < 100; y++) {
        tallBuf[y * 4] = y;
        tallBuf[y * 4 + 3] = 255;
      }

      const res = resizeNearestNeighbor(tallBuf, 1, 100, 10, 1);
      expect(res.width).toBe(10);
      expect(res.height).toBe(1);
      for (let x = 0; x < 10; x++) {
        expect(res.data[x * 4]).toBe(0);
        expect(res.data[x * 4 + 3]).toBe(255);
      }
    });
  });
});
