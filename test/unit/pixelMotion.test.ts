import { describe, expect, it } from "vitest";
import { buildClusterTween, buildSmearFrame } from "../../src/image/pixelMotion.js";

describe("pixel motion generation", () => {
  it("moves a same-color cluster whole without interpolation colors", () => {
    const source = [["#00000000", "#FF0000FF", "#FF0000FF", "#00000000", "#00000000"]];
    const target = [["#00000000", "#00000000", "#00000000", "#FF0000FF", "#FF0000FF"]];
    const result = buildClusterTween(source, target, 0.5, "linear");
    expect(result.grid).toEqual([["#00000000", "#00000000", "#FF0000FF", "#FF0000FF", "#00000000"]]);
    expect(new Set(result.grid[0])).toEqual(new Set(["#00000000", "#FF0000FF"]));
  });

  it("keeps unmatched clusters crisp by handing them off instead of blending", () => {
    const source = [["#00FF00FF", "#00000000"]];
    const target = [["#00000000", "#0000FFFF"]];
    expect(buildClusterTween(source, target, 0.25, "linear").grid).toEqual(source);
    expect(buildClusterTween(source, target, 0.75, "linear").grid).toEqual(target);
  });

  it("creates a raster smear in the measured direction while preserving source colors", () => {
    const source = [["#00000000", "#FF00FFFF", "#00000000", "#00000000", "#00000000"]];
    const target = [["#00000000", "#00000000", "#00000000", "#00000000", "#FF00FFFF"]];
    const result = buildSmearFrame(source, target, 4);
    expect(result.motion).toEqual({ x: 3, y: 0 });
    expect(result.grid[0].filter((color) => color === "#FF00FFFF").length).toBeGreaterThan(1);
    expect(new Set(result.grid[0])).toEqual(new Set(["#00000000", "#FF00FFFF"]));
  });
});
