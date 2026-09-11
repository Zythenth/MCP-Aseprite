// test/unit/tools.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { MockAsepriteEngine } from "../../src/mock/mockEngine.js";

describe("Aseprite Tools & Mock Engine Execution", () => {
  let engine: MockAsepriteEngine;

  beforeEach(() => {
    engine = new MockAsepriteEngine(32, 32);
  });

  it("get_sprite_info returns correct layers, frames, dimensions, and revision", () => {
    const info = engine.executeCommand("get_sprite_info", {});
    expect(info.width).toBe(32);
    expect(info.height).toBe(32);
    expect(info.colorMode).toBe("rgb");
    expect(info.layers.length).toBe(1);
    expect(info.frames.length).toBe(1);
    expect(info.revision).toBe(1);
  });

  it("get_canvas returns pngBase64 and dimensions", () => {
    const canvas = engine.executeCommand("get_canvas", { frameIndex: 1 });
    expect(canvas.width).toBe(32);
    expect(canvas.height).toBe(32);
    expect(typeof canvas.pngBase64).toBe("string");
    expect(canvas.revision).toBe(1);
  });

  it("get_pixel_grid returns hex, rgba, and compact formats", () => {
    // 1. hex
    const hexRes = engine.executeCommand("get_pixel_grid", { format: "hex" });
    expect(hexRes.width).toBe(32);
    expect(hexRes.grid.length).toBe(32);
    expect(hexRes.grid[0][0]).toBe("#00000000");

    // 2. rgba
    const rgbaRes = engine.executeCommand("get_pixel_grid", { format: "rgba" });
    expect(rgbaRes.grid[0][0]).toEqual({ r: 0, g: 0, b: 0, a: 0 });

    // 3. compact
    const compactRes = engine.executeCommand("get_pixel_grid", { format: "compact" });
    expect(Array.isArray(compactRes.palette)).toBe(true);
    expect(typeof compactRes.grid[0][0]).toBe("number");
  });

  it("inspect_sprite combines canvas png and pixel grid", () => {
    const inspect = engine.executeCommand("inspect_sprite", { scale: 1 });
    expect(inspect.width).toBe(32);
    expect(inspect.height).toBe(32);
    expect(typeof inspect.pngBase64).toBe("string");
    expect(inspect.pixelGrid).toBeDefined();
  });

  it("set_pixels paints batch of pixels, computes bounds, and supports returnPreview", () => {
    const pixels = [
      { x: 5, y: 5, color: "#FF0000FF" },
      { x: 6, y: 5, color: "#FF0000FF" },
      { x: 5, y: 6, color: "#FF0000FF" },
      { x: 6, y: 6, color: "#FF0000FF" },
    ];

    const res = engine.executeCommand("set_pixels", { pixels, returnPreview: true });
    expect(res.pixelsModified).toBe(4);
    expect(res.bounds).toEqual({ x: 5, y: 5, width: 2, height: 2 });
    expect(res.revision).toBe(2);
    expect(typeof res.pngBase64).toBe("string");

    // Verify in pixel grid
    const grid = engine.executeCommand("get_pixel_grid", { format: "hex" });
    expect(grid.grid[5][5]).toBe("#FF0000FF");
    expect(grid.grid[6][6]).toBe("#FF0000FF");
    expect(grid.grid[0][0]).toBe("#00000000");
  });

  it("erase_pixels makes pixels transparent", () => {
    engine.executeCommand("set_pixel", { x: 10, y: 10, color: "#FFFFFFFF" });
    const eraseRes = engine.executeCommand("erase_pixels", { points: [{ x: 10, y: 10 }] });
    expect(eraseRes.pixelsModified).toBe(1);

    const grid = engine.executeCommand("get_pixel_grid", { format: "hex" });
    expect(grid.grid[10][10]).toBe("#00000000");
  });

  it("draw_line, draw_rectangle, and draw_ellipse rasterize correctly", () => {
    // draw_line
    const lineRes = engine.executeCommand("draw_line", {
      x1: 0, y1: 0, x2: 4, y2: 4, color: "#00FF00FF", thickness: 1
    });
    expect(lineRes.pixelsModified).toBe(5);

    // draw_rectangle filled
    const rectRes = engine.executeCommand("draw_rectangle", {
      x: 10, y: 10, width: 3, height: 3, color: "#0000FFFF", filled: true
    });
    expect(rectRes.pixelsModified).toBe(9);

    // draw_ellipse
    const ellipseRes = engine.executeCommand("draw_ellipse", {
      x: 20, y: 20, width: 6, height: 6, color: "#FFFF00FF", filled: true
    });
    expect(ellipseRes.pixelsModified).toBeGreaterThan(0);
  });

  it("flood_fill fills contiguous matching area", () => {
    // Draw hollow square
    engine.executeCommand("draw_rectangle", { x: 2, y: 2, width: 5, height: 5, color: "#FFFFFF20", filled: false });
    // Flood fill center
    const fillRes = engine.executeCommand("flood_fill", { x: 4, y: 4, color: "#FF00FFFF", tolerance: 0 });
    expect(fillRes.pixelsModified).toBeGreaterThan(0);
  });

  it("replace_color replaces specific color across cel", () => {
    engine.executeCommand("set_pixel", { x: 1, y: 1, color: "#FF0000FF" });
    engine.executeCommand("set_pixel", { x: 2, y: 2, color: "#FF0000FF" });

    const replaceRes = engine.executeCommand("replace_color", {
      fromColor: "#FF0000FF",
      toColor: "#00FF00FF",
    });
    expect(replaceRes.pixelsModified).toBe(2);

    const grid = engine.executeCommand("get_pixel_grid", { format: "hex" });
    expect(grid.grid[1][1]).toBe("#00FF00FF");
    expect(grid.grid[2][2]).toBe("#00FF00FF");
  });

  it("undo and redo revert and replay changes atomically", () => {
    const revBefore = engine.revision;
    engine.executeCommand("set_pixels", {
      pixels: [
        { x: 1, y: 1, color: "#FF0000FF" },
        { x: 2, y: 2, color: "#FF0000FF" },
      ],
    });
    expect(engine.revision).toBe(revBefore + 1);

    // Undo
    const undoRes = engine.executeCommand("undo", {});
    expect(undoRes.success).toBe(true);
    const gridAfterUndo = engine.executeCommand("get_pixel_grid", { format: "hex" });
    expect(gridAfterUndo.grid[1][1]).toBe("#00000000");

    // Redo
    const redoRes = engine.executeCommand("redo", {});
    expect(redoRes.success).toBe(true);
    const gridAfterRedo = engine.executeCommand("get_pixel_grid", { format: "hex" });
    expect(gridAfterRedo.grid[1][1]).toBe("#FF0000FF");
  });

  it("get_changes_since returns deltas and bounds since revision", () => {
    const rev0 = engine.revision;
    engine.executeCommand("set_pixels", {
      pixels: [
        { x: 3, y: 4, color: "#FF0000FF" },
        { x: 5, y: 8, color: "#FF0000FF" },
      ],
    });

    const diff = engine.executeCommand("get_changes_since", { sinceRevision: rev0 });
    expect(diff.modifiedPixels).toBe(2);
    expect(diff.bounds.x).toBe(3);
    expect(diff.bounds.y).toBe(4);
    expect(diff.bounds.width).toBe(3);
    expect(diff.bounds.height).toBe(5);
  });

  it("palette tools retrieve and update palette", () => {
    const pal = engine.executeCommand("get_palette", {});
    expect(pal.count).toBe(256);

    engine.executeCommand("set_palette_color", { index: 15, color: "#AABBCCFF" });
    const match = engine.executeCommand("find_palette_color", { color: "#AABBCCFF" });
    expect(match.index).toBe(15);
    expect(match.exact).toBe(true);
  });

  it("layer tools manage layer hierarchy and properties", () => {
    const created = engine.executeCommand("create_layer", { name: "Lineart" });
    expect(created.success).toBe(true);
    expect(created.layer.name).toBe("Lineart");

    const layersList = engine.executeCommand("list_layers", {});
    expect(layersList.layers.length).toBe(2);

    engine.executeCommand("set_layer_opacity", { name: "Lineart", opacity: 128 });
    const updated = engine.executeCommand("list_layers", {});
    const lineart = updated.layers.find((l: any) => l.name === "Lineart");
    expect(lineart.opacity).toBe(128);

    engine.executeCommand("delete_layer", { name: "Lineart", confirm: true });
    const afterDelete = engine.executeCommand("list_layers", {});
    expect(afterDelete.layers.length).toBe(1);
  });

  it("frame tools manage animation frames and tags", () => {
    engine.executeCommand("create_frame", { duration: 150 });
    const framesList = engine.executeCommand("list_frames", {});
    expect(framesList.frames.length).toBe(2);

    engine.executeCommand("create_tag", { name: "run", fromFrame: 1, toFrame: 2 });
    const tagsList = engine.executeCommand("list_tags", {});
    expect(tagsList.tags.length).toBe(1);
    expect(tagsList.tags[0].name).toBe("run");
  });

  it("canvas resizing preserves existing pixel data without blurring", () => {
    engine.executeCommand("set_pixel", { x: 2, y: 2, color: "#FFFFFFFF" });
    const resizeRes = engine.executeCommand("resize_canvas", { width: 64, height: 64 });
    expect(resizeRes.width).toBe(64);
    expect(resizeRes.height).toBe(64);

    const grid = engine.executeCommand("get_pixel_grid", { format: "hex" });
    expect(grid.width).toBe(64);
    expect(grid.height).toBe(64);
    expect(grid.grid[2][2]).toBe("#FFFFFFFF");
  });
});
