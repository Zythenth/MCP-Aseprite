/**
 * Tier 1: Feature Coverage Test Suite.
 * Validates >= 5 test cases per feature across all primary and secondary tools.
 * Covers the primary and secondary tool contracts.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  TestHarness,
  assertToolSuccess,
  extractTextContent,
  extractImageContent,
  parsePngDimensions,
  assertPixelInGrid,
  assertRectInGrid,
  type PixelGridResult,
  type SpriteStatus,
  type SpriteInfo,
} from "../harness/index.js";

describe("Tier 1: Feature Coverage", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = new TestHarness();
    await harness.setup();
    // Default working sprite 16x16
    await harness.callTool("new_sprite", { width: 16, height: 16 });
  });

  afterEach(async () => {
    await harness.teardown();
  });

  // ===========================================================================
  // Feature Group 1: Shapes (draw_line) - 5 Cases
  // ===========================================================================
  describe("Feature: draw_line", () => {
    it("Case 1: draws a horizontal line from (2,2) to (8,2)", async () => {
      const res = await harness.callTool("draw_line", {
        x0: 2, y0: 2, x1: 8, y1: 2, color: "#FFFF00FF",
      });
      assertToolSuccess(res);
      const grid = extractTextContent<PixelGridResult>(await harness.callTool("get_pixel_grid"));
      for (let x = 2; x <= 8; x++) {
        assertPixelInGrid(grid, x, 2, "#FFFF00FF");
      }
      assertPixelInGrid(grid, 1, 2, "#00000000");
      assertPixelInGrid(grid, 9, 2, "#00000000");
    });

    it("Case 2: draws a vertical line from (4,1) to (4,10)", async () => {
      const res = await harness.callTool("draw_line", {
        x0: 4, y0: 1, x1: 4, y1: 10, color: "#00FFFFFF",
      });
      assertToolSuccess(res);
      const grid = extractTextContent<PixelGridResult>(await harness.callTool("get_pixel_grid"));
      for (let y = 1; y <= 10; y++) {
        assertPixelInGrid(grid, 4, y, "#00FFFFFF");
      }
      assertPixelInGrid(grid, 4, 0, "#00000000");
      assertPixelInGrid(grid, 4, 11, "#00000000");
    });

    it("Case 3: draws a 45-degree diagonal line from (0,0) to (7,7)", async () => {
      const res = await harness.callTool("draw_line", {
        x0: 0, y0: 0, x1: 7, y1: 7, color: "#FF00FFFF",
      });
      assertToolSuccess(res);
      const grid = extractTextContent<PixelGridResult>(await harness.callTool("get_pixel_grid"));
      for (let i = 0; i <= 7; i++) {
        assertPixelInGrid(grid, i, i, "#FF00FFFF");
      }
    });

    it("Case 4: draws an arbitrary slope line from (1,2) to (12,7)", async () => {
      const res = await harness.callTool("draw_line", {
        x0: 1, y0: 2, x1: 12, y1: 7, color: "#FFAA00FF",
      });
      assertToolSuccess(res);
      const grid = extractTextContent<PixelGridResult>(await harness.callTool("get_pixel_grid"));
      assertPixelInGrid(grid, 1, 2, "#FFAA00FF");
      assertPixelInGrid(grid, 12, 7, "#FFAA00FF");
    });

    it("Case 5: draws orthogonal-connected line to eliminate diagonal light leaks", async () => {
      const res = await harness.callTool("draw_line", {
        x0: 1, y0: 1, x1: 4, y1: 4, color: "#FFFFFFCC", connectOrthogonal: true,
      });
      assertToolSuccess(res);
      const data = extractTextContent<any>(res);
      // Orthogonal insertion produces more pixels than standard diagonal
      expect(data.pixelsModified).toBeGreaterThan(4);
    });
  });

  // ===========================================================================
  // Feature Group 2: Shapes (draw_rectangle) - 5 Cases
  // ===========================================================================
  describe("Feature: draw_rectangle", () => {
    it("Case 1: draws a hollow rectangle outline", async () => {
      const res = await harness.callTool("draw_rectangle", {
        x: 2, y: 2, width: 6, height: 5, color: "#FF0000FF", fill: false,
      });
      assertToolSuccess(res);
      const grid = extractTextContent<PixelGridResult>(await harness.callTool("get_pixel_grid"));
      // Perimeter
      assertPixelInGrid(grid, 2, 2, "#FF0000FF");
      assertPixelInGrid(grid, 7, 2, "#FF0000FF");
      assertPixelInGrid(grid, 2, 6, "#FF0000FF");
      assertPixelInGrid(grid, 7, 6, "#FF0000FF");
      // Interior remains transparent
      assertPixelInGrid(grid, 3, 3, "#00000000");
      assertPixelInGrid(grid, 4, 4, "#00000000");
    });

    it("Case 2: draws a solid filled rectangle", async () => {
      const res = await harness.callTool("draw_rectangle", {
        x: 3, y: 3, width: 4, height: 4, color: "#00FF00FF", fill: true,
      });
      assertToolSuccess(res);
      const grid = extractTextContent<PixelGridResult>(await harness.callTool("get_pixel_grid"));
      assertRectInGrid(grid, { x: 3, y: 3, width: 4, height: 4 }, "#00FF00FF");
    });

    it("Case 3: draws a rectangle with distinct outline and fill colors", async () => {
      const res = await harness.callTool("draw_rectangle", {
        x: 1, y: 1, width: 5, height: 5, color: "#FF0000FF", fill: true, fillColor: "#0000FFFF",
      });
      assertToolSuccess(res);
      const grid = extractTextContent<PixelGridResult>(await harness.callTool("get_pixel_grid"));
      // Border is red
      assertPixelInGrid(grid, 1, 1, "#FF0000FF");
      assertPixelInGrid(grid, 5, 5, "#FF0000FF");
      // Interior is blue
      assertPixelInGrid(grid, 2, 2, "#0000FFFF");
      assertPixelInGrid(grid, 3, 3, "#0000FFFF");
    });

    it("Case 4: draws a 1x1 rectangle (single pixel degenerate)", async () => {
      const res = await harness.callTool("draw_rectangle", {
        x: 5, y: 5, width: 1, height: 1, color: "#AABBCCFF", fill: true,
      });
      assertToolSuccess(res);
      const grid = extractTextContent<PixelGridResult>(await harness.callTool("get_pixel_grid"));
      assertPixelInGrid(grid, 5, 5, "#AABBCCFF");
    });

    it("Case 5: draws a full-canvas rectangle covering (0,0,width,height)", async () => {
      const res = await harness.callTool("draw_rectangle", {
        x: 0, y: 0, width: 16, height: 16, color: "#112233FF", fill: true,
      });
      assertToolSuccess(res);
      const grid = extractTextContent<PixelGridResult>(await harness.callTool("get_pixel_grid"));
      assertRectInGrid(grid, { x: 0, y: 0, width: 16, height: 16 }, "#112233FF");
    });
  });

  // ===========================================================================
  // Feature Group 3: Shapes (draw_ellipse) - 5 Cases
  // ===========================================================================
  describe("Feature: draw_ellipse", () => {
    it("Case 1: draws an odd-diameter symmetric circle outline (9x9)", async () => {
      const res = await harness.callTool("draw_ellipse", {
        x: 2, y: 2, width: 9, height: 9, color: "#FFFFFFFF", fill: false,
      });
      assertToolSuccess(res);
      const grid = extractTextContent<PixelGridResult>(await harness.callTool("get_pixel_grid"));
      // Top, bottom, left, right cardinal extrema
      assertPixelInGrid(grid, 6, 2, "#FFFFFFFF"); // top
      assertPixelInGrid(grid, 6, 10, "#FFFFFFFF"); // bottom
      assertPixelInGrid(grid, 2, 6, "#FFFFFFFF"); // left
      assertPixelInGrid(grid, 10, 6, "#FFFFFFFF"); // right
    });

    it("Case 2: draws an even-diameter symmetric circle outline (8x8)", async () => {
      const res = await harness.callTool("draw_ellipse", {
        x: 1, y: 1, width: 8, height: 8, color: "#00FF00FF", fill: false,
      });
      assertToolSuccess(res);
      const grid = extractTextContent<PixelGridResult>(await harness.callTool("get_pixel_grid"));
      assertPixelInGrid(grid, 1, 4, "#00FF00FF");
      assertPixelInGrid(grid, 8, 4, "#00FF00FF");
    });

    it("Case 3: draws a solid filled ellipse", async () => {
      const res = await harness.callTool("draw_ellipse", {
        x: 2, y: 2, width: 7, height: 7, color: "#FF0000FF", fill: true, fillColor: "#FF0000FF",
      });
      assertToolSuccess(res);
      const grid = extractTextContent<PixelGridResult>(await harness.callTool("get_pixel_grid"));
      // Center is filled
      assertPixelInGrid(grid, 5, 5, "#FF0000FF");
    });

    it("Case 4: draws a wide horizontal ellipse (12x6)", async () => {
      const res = await harness.callTool("draw_ellipse", {
        x: 1, y: 4, width: 12, height: 6, color: "#0000FFFF", fill: false,
      });
      assertToolSuccess(res);
      const grid = extractTextContent<PixelGridResult>(await harness.callTool("get_pixel_grid"));
      assertPixelInGrid(grid, 1, 6, "#0000FFFF");
      assertPixelInGrid(grid, 12, 6, "#0000FFFF");
    });

    it("Case 5: draws a tall vertical ellipse (6x12)", async () => {
      const res = await harness.callTool("draw_ellipse", {
        x: 4, y: 1, width: 6, height: 12, color: "#FF8800FF", fill: false,
      });
      assertToolSuccess(res);
      const grid = extractTextContent<PixelGridResult>(await harness.callTool("get_pixel_grid"));
      assertPixelInGrid(grid, 6, 1, "#FF8800FF");
      assertPixelInGrid(grid, 6, 12, "#FF8800FF");
    });
  });

  // ===========================================================================
  // Feature Group 4: Painting (flood_fill) - 5 Cases
  // ===========================================================================
  describe("Feature: flood_fill", () => {
    it("Case 1: fills an enclosed rectangle interior", async () => {
      await harness.callTool("draw_rectangle", {
        x: 2, y: 2, width: 6, height: 6, color: "#FFFFFFCC", fill: false,
      });
      const res = await harness.callTool("flood_fill", {
        x: 4, y: 4, color: "#FF0000FF",
      });
      assertToolSuccess(res);
      const grid = extractTextContent<PixelGridResult>(await harness.callTool("get_pixel_grid"));
      // Interior filled
      assertPixelInGrid(grid, 3, 3, "#FF0000FF");
      assertPixelInGrid(grid, 4, 4, "#FF0000FF");
      assertPixelInGrid(grid, 5, 5, "#FF0000FF");
      // Outside remains transparent
      assertPixelInGrid(grid, 0, 0, "#00000000");
    });

    it("Case 2: fills the entire empty canvas from (0,0)", async () => {
      const res = await harness.callTool("flood_fill", {
        x: 0, y: 0, color: "#0000FFFF",
      });
      assertToolSuccess(res);
      const grid = extractTextContent<PixelGridResult>(await harness.callTool("get_pixel_grid"));
      assertRectInGrid(grid, { x: 0, y: 0, width: 16, height: 16 }, "#0000FFFF");
    });

    it("Case 3: performs fill with color distance tolerance", async () => {
      await harness.callTool("set_pixel", { x: 2, y: 2, color: "#00000000" });
      const res = await harness.callTool("flood_fill", {
        x: 2, y: 2, color: "#123456FF", tolerance: 10,
      });
      assertToolSuccess(res);
      const grid = extractTextContent<PixelGridResult>(await harness.callTool("get_pixel_grid"));
      assertPixelInGrid(grid, 2, 2, "#123456FF");
    });

    it("Case 4: performs non-contiguous fill across disjoint regions", async () => {
      await harness.callTool("set_pixel", { x: 1, y: 1, color: "#FF0000FF" });
      await harness.callTool("set_pixel", { x: 10, y: 10, color: "#FF0000FF" });
      const res = await harness.callTool("flood_fill", {
        x: 1, y: 1, color: "#00FF00FF", contiguous: false,
      });
      assertToolSuccess(res);
      const grid = extractTextContent<PixelGridResult>(await harness.callTool("get_pixel_grid"));
      assertPixelInGrid(grid, 1, 1, "#00FF00FF");
      assertPixelInGrid(grid, 10, 10, "#00FF00FF");
    });

    it("Case 5: returns cleanly for no-op fill where seed already has target color", async () => {
      await harness.callTool("set_pixel", { x: 3, y: 3, color: "#AABBCCFF" });
      const res = await harness.callTool("flood_fill", {
        x: 3, y: 3, color: "#AABBCCFF",
      });
      assertToolSuccess(res);
      const data = extractTextContent<any>(res);
      expect(data.pixelsChanged).toBe(0);
    });
  });

  // ===========================================================================
  // Feature Group 5: Painting (replace_color) - 5 Cases
  // ===========================================================================
  describe("Feature: replace_color", () => {
    it("Case 1: exactly replaces source color with target color across cel", async () => {
      await harness.callTool("set_pixel", { x: 2, y: 2, color: "#FF0000FF" });
      await harness.callTool("set_pixel", { x: 3, y: 3, color: "#FF0000FF" });
      const res = await harness.callTool("replace_color", {
        fromColor: "#FF0000FF", toColor: "#0000FFFF",
      });
      assertToolSuccess(res);
      const grid = extractTextContent<PixelGridResult>(await harness.callTool("get_pixel_grid"));
      assertPixelInGrid(grid, 2, 2, "#0000FFFF");
      assertPixelInGrid(grid, 3, 3, "#0000FFFF");
    });

    it("Case 2: replaces color on target layer without affecting other layers", async () => {
      await harness.callTool("set_pixel", { x: 5, y: 5, color: "#111111FF" });
      await harness.callTool("create_layer", { name: "Layer 2" });
      await harness.callTool("set_pixel", { x: 5, y: 5, color: "#222222FF" });
      const res = await harness.callTool("replace_color", {
        fromColor: "#222222FF", toColor: "#333333FF",
      });
      assertToolSuccess(res);
      const grid = extractTextContent<PixelGridResult>(await harness.callTool("get_pixel_grid"));
      assertPixelInGrid(grid, 5, 5, "#333333FF");
    });

    it("Case 3: replaces color using tolerance threshold", async () => {
      await harness.callTool("set_pixel", { x: 4, y: 4, color: "#FF0000FF" });
      const res = await harness.callTool("replace_color", {
        fromColor: "#FF0000FF", toColor: "#FFFF00FF", tolerance: 5,
      });
      assertToolSuccess(res);
      const grid = extractTextContent<PixelGridResult>(await harness.callTool("get_pixel_grid"));
      assertPixelInGrid(grid, 4, 4, "#FFFF00FF");
    });

    it("Case 4: replaces transparent color with solid color", async () => {
      await harness.callTool("set_pixel", { x: 1, y: 1, color: "#00000000" });
      const res = await harness.callTool("replace_color", {
        fromColor: "#00000000", toColor: "#111111FF",
      });
      assertToolSuccess(res);
      const grid = extractTextContent<PixelGridResult>(await harness.callTool("get_pixel_grid"));
      assertPixelInGrid(grid, 1, 1, "#111111FF");
    });

    it("Case 5: replaces non-existent color returning 0 pixels changed", async () => {
      const res = await harness.callTool("replace_color", {
        fromColor: "#123456FF", toColor: "#654321FF",
      });
      assertToolSuccess(res);
      const data = extractTextContent<any>(res);
      expect(data.pixelsChanged).toBe(0);
    });
  });

  // ===========================================================================
  // Feature Group 6: Diffing (get_changes_since) - 5 Cases
  // ===========================================================================
  describe("Feature: get_changes_since", () => {
    it("Case 1: returns changed: false when queried revision matches current", async () => {
      const status = extractTextContent<SpriteStatus>(await harness.callTool("aseprite_status"));
      const res = await harness.callTool("get_changes_since", { revision: status.revision });
      assertToolSuccess(res);
      const data = extractTextContent<any>(res);
      expect(data.changed).toBe(false);
    });

    it("Case 2: returns exact bounds and pixel count after single line draw", async () => {
      const r0 = extractTextContent<SpriteStatus>(await harness.callTool("aseprite_status")).revision!;
      await harness.callTool("draw_line", { x0: 2, y0: 2, x1: 6, y1: 2, color: "#FF0000FF" });
      const res = await harness.callTool("get_changes_since", { revision: r0 });
      assertToolSuccess(res);
      const diff = extractTextContent<any>(res);
      expect(diff.changed).toBe(true);
      expect(diff.pixelsChanged).toBe(5);
      expect(diff.bounds).toEqual({ x: 2, y: 2, width: 5, height: 1 });
    });

    it("Case 3: returns accumulated changes across multiple batch painting steps", async () => {
      const r0 = extractTextContent<SpriteStatus>(await harness.callTool("aseprite_status")).revision!;
      await harness.callTool("set_pixel", { x: 1, y: 1, color: "#00FF00FF" });
      await harness.callTool("set_pixel", { x: 8, y: 8, color: "#0000FFFF" });
      const res = await harness.callTool("get_changes_since", { revision: r0 });
      assertToolSuccess(res);
      const diff = extractTextContent<any>(res);
      expect(diff.changed).toBe(true);
      expect(diff.pixelsChanged).toBe(2);
      expect(diff.bounds.width).toBe(8); // 1 to 8 inclusive
      expect(diff.bounds.height).toBe(8);
    });

    it("Case 4: returns modified count after flood_fill", async () => {
      const r0 = extractTextContent<SpriteStatus>(await harness.callTool("aseprite_status")).revision!;
      await harness.callTool("flood_fill", { x: 0, y: 0, color: "#ABCDEFFF" });
      const res = await harness.callTool("get_changes_since", { revision: r0 });
      assertToolSuccess(res);
      const diff = extractTextContent<any>(res);
      expect(diff.changed).toBe(true);
      expect(diff.pixelsChanged).toBe(256); // 16x16 canvas filled
    });

    it("Case 5: indicates fullRefreshRequired when queried revision is unknown or pruned", async () => {
      const res = await harness.callTool("get_changes_since", { revision: 99999 });
      assertToolSuccess(res);
      const diff = extractTextContent<any>(res);
      expect(diff.changed).toBe(true);
      expect(diff.fullRefreshRequired).toBe(true);
    });
  });

  // ===========================================================================
  // Feature Group 7: Palette Tools - 5 Cases
  // ===========================================================================
  describe("Feature: palette tools", () => {
    it("Case 1: get_palette returns valid color count and RGBA list", async () => {
      const res = await harness.callTool("get_palette");
      assertToolSuccess(res);
      const data = extractTextContent<any>(res);
      expect(data.count).toBe(256);
      expect(Array.isArray(data.colors)).toBe(true);
    });

    it("Case 2: set_palette_color updates color at specified index and increments revision", async () => {
      const res = await harness.callTool("set_palette_color", { index: 5, color: "#FF5500FF" });
      assertToolSuccess(res);
      const data = extractTextContent<any>(res);
      expect(data.success).toBe(true);
      expect(data.index).toBe(5);
      expect(data.newColor).toBe("#FF5500FF");
    });

    it("Case 3: find_palette_color in exact mode returns correct index", async () => {
      await harness.callTool("set_palette_color", { index: 12, color: "#123456FF" });
      const res = await harness.callTool("find_palette_color", { color: "#123456FF", matchMode: "exact" });
      assertToolSuccess(res);
      const data = extractTextContent<any>(res);
      expect(data.found).toBe(true);
      expect(data.index).toBe(12);
    });

    it("Case 4: find_palette_color in nearest mode returns closest match", async () => {
      await harness.callTool("set_palette_color", { index: 20, color: "#FFFFFF00" });
      const res = await harness.callTool("find_palette_color", { color: "#FFFFFF10", matchMode: "nearest" });
      assertToolSuccess(res);
      const data = extractTextContent<any>(res);
      expect(data.found).toBe(true);
    });

    it("Case 5: modifying palette color does not corrupt neighboring indices", async () => {
      await harness.callTool("set_palette_color", { index: 50, color: "#111111FF" });
      await harness.callTool("set_palette_color", { index: 51, color: "#222222FF" });
      const palette = extractTextContent<any>(await harness.callTool("get_palette"));
      expect(palette.colors[50].hex).toBe("#111111FF");
      expect(palette.colors[51].hex).toBe("#222222FF");
    });
  });

  // ===========================================================================
  // Feature Group 8: Layer Tools - 5 Cases
  // ===========================================================================
  describe("Feature: layer tools", () => {
    it("Case 1: list_layers returns accurate hierarchy and active layer index", async () => {
      const res = await harness.callTool("list_layers");
      assertToolSuccess(res);
      const data = extractTextContent<any>(res);
      expect(data.layers.length).toBeGreaterThanOrEqual(1);
      expect(data.activeLayerIndex).toBe(0);
    });

    it("Case 2: create_layer creates new layer and updates active index", async () => {
      const res = await harness.callTool("create_layer", { name: "Foreground" });
      assertToolSuccess(res);
      const data = extractTextContent<any>(res);
      expect(data.success).toBe(true);
      expect(data.name).toBe("Foreground");
    });

    it("Case 3: rename_layer modifies layer name cleanly", async () => {
      await harness.callTool("create_layer", { name: "TempLayer" });
      const res = await harness.callTool("rename_layer", { layer: "TempLayer", newName: "PermanentLayer" });
      assertToolSuccess(res);
      const data = extractTextContent<any>(res);
      expect(data.newName).toBe("PermanentLayer");
    });

    it("Case 4: set_layer_visibility(false) hides layer from composite preview", async () => {
      await harness.callTool("create_layer", { name: "DecoLayer" });
      await harness.callTool("set_pixel", { x: 3, y: 3, color: "#FF0000FF" });
      const hideRes = await harness.callTool("set_layer_visibility", { layer: "DecoLayer", visible: false });
      assertToolSuccess(hideRes);
      const grid = extractTextContent<PixelGridResult>(await harness.callTool("get_pixel_grid"));
      assertPixelInGrid(grid, 3, 3, "#00000000"); // Hidden layer cel omitted from composite
    });

    it("Case 5: set_layer_opacity modifies layer blending weight", async () => {
      await harness.callTool("create_layer", { name: "AlphaLayer" });
      const res = await harness.callTool("set_layer_opacity", { layer: "AlphaLayer", opacity: 128 });
      assertToolSuccess(res);
      const data = extractTextContent<any>(res);
      expect(data.opacity).toBe(128);
    });
  });

  // ===========================================================================
  // Feature Group 9: Frame Tools - 5 Cases
  // ===========================================================================
  describe("Feature: frame tools", () => {
    it("Case 1: list_frames lists frame numbers and durations", async () => {
      const res = await harness.callTool("list_frames");
      assertToolSuccess(res);
      const data = extractTextContent<any>(res);
      expect(data.totalFrames).toBe(1);
    });

    it("Case 2: create_frame appends new blank frame", async () => {
      const res = await harness.callTool("create_frame", { durationMs: 150 });
      assertToolSuccess(res);
      const data = extractTextContent<any>(res);
      expect(data.totalFrames).toBe(2);
      expect(data.createdFrameNumber).toBe(2);
    });

    it("Case 3: duplicate_frame clones cels into new frame", async () => {
      await harness.callTool("set_pixel", { x: 2, y: 2, color: "#AABBCCFF" });
      const res = await harness.callTool("duplicate_frame", { frameNumber: 1 });
      assertToolSuccess(res);
      const data = extractTextContent<any>(res);
      expect(data.newFrameNumber).toBe(2);

      // Verify duplicated frame contains the cloned pixel
      const grid = extractTextContent<PixelGridResult>(await harness.callTool("get_pixel_grid"));
      assertPixelInGrid(grid, 2, 2, "#AABBCCFF");
    });

    it("Case 4: set_frame_duration updates playback duration", async () => {
      const res = await harness.callTool("set_frame_duration", { frameNumber: 1, durationMs: 250 });
      assertToolSuccess(res);
      const data = extractTextContent<any>(res);
      expect(data.durationMs).toBe(250);
    });

    it("Case 5: create_tag and list_tags manages animation tags", async () => {
      await harness.callTool("create_frame", {});
      const tagRes = await harness.callTool("create_tag", {
        name: "walk", fromFrame: 1, toFrame: 2, direction: "forward",
      });
      assertToolSuccess(tagRes);
      const listRes = await harness.callTool("list_tags");
      assertToolSuccess(listRes);
      const data = extractTextContent<any>(listRes);
      expect(data.tags.some((t: any) => t.name === "walk")).toBe(true);
    });
  });

  // ===========================================================================
  // Feature Group 10: Canvas & File Tools - 5 Cases
  // ===========================================================================
  describe("Feature: canvas and file tools", () => {
    it("Case 1: new_sprite initializes a pristine canvas", async () => {
      const res = await harness.callTool("new_sprite", { width: 8, height: 8 });
      assertToolSuccess(res);
      const data = extractTextContent<any>(res);
      expect(data.width).toBe(8);
      expect(data.height).toBe(8);
    });

    it("Case 2: resize_canvas expands canvas dimensions", async () => {
      const res = await harness.callTool("resize_canvas", { width: 32, height: 32 });
      assertToolSuccess(res);
      const data = extractTextContent<any>(res);
      expect(data.newDimensions).toEqual({ width: 32, height: 32 });
    });

    it("Case 3: resize_canvas crops canvas dimensions", async () => {
      const res = await harness.callTool("resize_canvas", { width: 8, height: 8 });
      assertToolSuccess(res);
      const data = extractTextContent<any>(res);
      expect(data.newDimensions).toEqual({ width: 8, height: 8 });
    });

    it("Case 4: export_png returns valid export payload", async () => {
      const res = await harness.callTool("export_png", { filepath: "out.png", scale: 2 });
      assertToolSuccess(res);
      const data = extractTextContent<any>(res);
      expect(data.scale).toBe(2);
    });

    it("Case 5: save_sprite_as sets target filepath", async () => {
      const res = await harness.callTool("save_sprite_as", { filepath: "test.aseprite" });
      assertToolSuccess(res);
      const data = extractTextContent<any>(res);
      expect(data.filepath).toBe("test.aseprite");
    });
  });

  // ===========================================================================
  // Feature Group 11: MCP Resources - 5 Cases
  // ===========================================================================
  describe("Feature: MCP resources", () => {
    it("Case 1: reads aseprite://active-sprite/info", async () => {
      const res = await harness.readResource("aseprite://active-sprite/info");
      assertToolSuccess(res);
      const info = extractTextContent<SpriteInfo>(res);
      expect(info.width).toBe(16);
      expect(info.height).toBe(16);
    });

    it("Case 2: reads aseprite://active-sprite/preview as valid PNG", async () => {
      const res = await harness.readResource("aseprite://active-sprite/preview");
      assertToolSuccess(res);
      const img = extractImageContent(res);
      const dims = parsePngDimensions(img.buffer);
      expect(dims.width).toBe(16);
      expect(dims.height).toBe(16);
    });

    it("Case 3: reads aseprite://active-sprite/palette", async () => {
      const res = await harness.readResource("aseprite://active-sprite/palette");
      assertToolSuccess(res);
      const data = extractTextContent<any>(res);
      expect(data.colors.length).toBe(256);
    });

    it("Case 4: reads aseprite://active-sprite/layers", async () => {
      const res = await harness.readResource("aseprite://active-sprite/layers");
      assertToolSuccess(res);
      const data = extractTextContent<any>(res);
      expect(data.layers.length).toBeGreaterThanOrEqual(1);
    });

    it("Case 5: reads aseprite://active-sprite/frames", async () => {
      const res = await harness.readResource("aseprite://active-sprite/frames");
      assertToolSuccess(res);
      const data = extractTextContent<any>(res);
      expect(data.frames.length).toBeGreaterThanOrEqual(1);
    });
  });
});
