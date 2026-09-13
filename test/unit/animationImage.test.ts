import { describe, expect, it } from "vitest";
import { composeFilmstrip, composeOnionSkin, compareFrames } from "../../src/image/animation.js";
import { assertAnimationPixelBudget } from "../../src/mcp/tools/animation.js";
import type { ImageBuffer } from "../../src/image/png.js";

function image(width: number, height: number, pixels: number[][]): ImageBuffer {
  return { width, height, data: Uint8Array.from(pixels.flat()) };
}

describe("animation image composition", () => {
  it("rejects rendered and aggregate animation workloads beyond their memory budgets", () => {
    expect(() => assertAnimationPixelBudget(4096, 4096, 1, 16)).toThrow(/Rendered image exceeds/);
    expect(() => assertAnimationPixelBudget(4096, 4096, 7, 1)).toThrow(/Animation inputs exceed/);
    expect(() => assertAnimationPixelBudget(64, 64, 7, 4)).not.toThrow();
  });

  it("lays equal-sized frames into a filmstrip without interpolation", () => {
    const red = image(1, 1, [[255, 0, 0, 255]]);
    const green = image(1, 1, [[0, 255, 0, 255]]);
    const blue = image(1, 1, [[0, 0, 255, 255]]);

    const result = composeFilmstrip([red, green, blue], 2, 1);

    expect({ width: result.width, height: result.height }).toEqual({ width: 3, height: 3 });
    expect(Array.from(result.data.slice(0, 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(result.data.slice(8, 12))).toEqual([0, 255, 0, 255]);
    expect(Array.from(result.data.slice(24, 28))).toEqual([0, 0, 255, 255]);
  });

  it("keeps the current frame opaque while tinting adjacent frames", () => {
    const transparent = image(2, 1, [[0, 0, 0, 0], [0, 0, 0, 0]]);
    const previous = image(2, 1, [[255, 255, 255, 255], [0, 0, 0, 0]]);
    const current = image(2, 1, [[0, 0, 0, 0], [20, 40, 60, 255]]);

    const result = composeOnionSkin([previous], current, [transparent], 0.5);

    expect(Array.from(result.data.slice(0, 4))).toEqual([255, 72, 96, 128]);
    expect(Array.from(result.data.slice(4, 8))).toEqual([20, 40, 60, 255]);
  });

  it("returns exact frame-difference counts and minimal bounds", () => {
    const before = image(2, 2, [
      [0, 0, 0, 0], [10, 10, 10, 255],
      [20, 20, 20, 255], [30, 30, 30, 255],
    ]);
    const after = image(2, 2, [
      [0, 0, 0, 0], [12, 10, 10, 255],
      [20, 20, 20, 255], [80, 30, 30, 255],
    ]);

    const exact = compareFrames(before, after, 0);
    expect(exact.changedPixels).toBe(2);
    expect(exact.bounds).toEqual({ x: 1, y: 0, width: 1, height: 2 });
    expect(exact.changeRatio).toBe(0.5);

    const tolerant = compareFrames(before, after, 2);
    expect(tolerant.changedPixels).toBe(1);
    expect(tolerant.bounds).toEqual({ x: 1, y: 1, width: 1, height: 1 });
  });

  it("rejects mismatched frame dimensions", () => {
    const one = image(1, 1, [[0, 0, 0, 0]]);
    const two = image(2, 1, [[0, 0, 0, 0], [0, 0, 0, 0]]);
    expect(() => compareFrames(one, two)).toThrow(/identical dimensions/);
  });
});
