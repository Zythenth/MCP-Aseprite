// test/unit/tools.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { PNG } from "pngjs";
import { MockAsepriteEngine } from "../../src/mock/mockEngine.js";
import { applyLegacyRegionFallback } from "../../src/mcp/tools/visual.js";

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
    expect(diff.changed).toBe(true);
    expect(diff.sinceRevision).toBe(rev0);
    expect(diff.currentRevision).toBe(engine.revision);
    expect(diff.pixelsChanged).toBe(2);
    expect(diff.bounds.x).toBe(3);
    expect(diff.bounds.y).toBe(4);
    expect(diff.bounds.width).toBe(3);
    expect(diff.bounds.height).toBe(5);
  });

  it("get_changes_since returns changed: false when sinceRevision matches currentRevision", () => {
    const diff = engine.executeCommand("get_changes_since", { sinceRevision: engine.revision });
    expect(diff).toEqual({
      changed: false,
      sinceRevision: engine.revision,
      currentRevision: engine.revision,
      sessionId: engine.sessionId,
      resyncRequired: false,
      gap: false,
      pixelsChanged: 0,
      bounds: null,
      changes: [],
    });
  });

  it("get_changes_since returns fullRefreshRequired for future revision", () => {
    const diff = engine.executeCommand("get_changes_since", { sinceRevision: engine.revision + 50 });
    expect(diff.changed).toBe(true);
    expect(diff.fullRefreshRequired).toBe(true);
  });

  it("get_changes_since returns fullRefreshRequired for structural gap (create_layer)", () => {
    const rev0 = engine.revision;
    engine.executeCommand("set_pixels", { pixels: [{ x: 1, y: 1, color: "#FF0000FF" }] });
    engine.executeCommand("create_layer", { name: "NewLayer" });
    engine.executeCommand("set_pixels", { pixels: [{ x: 2, y: 2, color: "#00FF00FF" }] });

    const diff = engine.executeCommand("get_changes_since", { sinceRevision: rev0 });
    expect(diff.changed).toBe(true);
    expect(diff.fullRefreshRequired).toBe(true);
  });

  it("get_changes_since returns fullRefreshRequired when an undo occurred", () => {
    const rev0 = engine.revision;
    engine.executeCommand("set_pixels", { pixels: [{ x: 1, y: 1, color: "#FF0000FF" }] });
    engine.executeCommand("undo", {});

    const diff = engine.executeCommand("get_changes_since", { sinceRevision: rev0 });
    expect(diff.changed).toBe(true);
    expect(diff.fullRefreshRequired).toBe(true);
  });

  it("get_changes_since returns fullRefreshRequired after journal pruning (> 128 mutations)", () => {
    const baseRev = engine.revision;
    for (let i = 0; i < 129; i++) {
      engine.executeCommand("set_pixels", {
        pixels: [{ x: 0, y: 0, color: i % 2 === 0 ? "#FF0000FF" : "#00FF00FF" }],
      });
    }

    const prunedDiff = engine.executeCommand("get_changes_since", { sinceRevision: baseRev });
    expect(prunedDiff.changed).toBe(true);
    expect(prunedDiff.fullRefreshRequired).toBe(true);

    const recentDiff = engine.executeCommand("get_changes_since", { sinceRevision: engine.revision - 10 });
    expect(recentDiff.changed).toBe(true);
    expect(recentDiff.fullRefreshRequired).toBe(false);
    expect(recentDiff.pixelsChanged).toBe(10);
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

  describe("Phase 4A: Target Selection, Color Tolerance, and Actual Change Counting", () => {
    it("layerName and layerIndex target the requested layer without changing the active layer", () => {
      engine.executeCommand("create_layer", { name: "Foreground" });
      expect(engine.activeLayerIndex).toBe(0);

      // Write to Foreground by layerName
      const resName = engine.executeCommand("set_pixel", {
        layerName: "Foreground",
        x: 4,
        y: 4,
        color: "#112233FF",
      });
      expect(resName.pixelsModified).toBe(1);
      expect(engine.activeLayerIndex).toBe(0); // active layer remains unchanged!

      // Write to Foreground by layerIndex
      const resIndex = engine.executeCommand("set_pixel", {
        layerIndex: 1,
        x: 5,
        y: 5,
        color: "#445566FF",
      });
      expect(resIndex.pixelsModified).toBe(1);
      expect(engine.activeLayerIndex).toBe(0); // active layer remains unchanged!

      // Verify Foreground cel has the pixels
      const fgGrid = engine.executeCommand("get_pixel_grid", { layerName: "Foreground", format: "hex" });
      expect(fgGrid.grid[4][4]).toBe("#112233FF");
      expect(fgGrid.grid[5][5]).toBe("#445566FF");

      // Verify active layer (Background, index 0) cel does NOT have them
      const bgGrid = engine.executeCommand("get_pixel_grid", { layerIndex: 0, format: "hex" });
      expect(bgGrid.grid[4][4]).toBe("#00000000");
      expect(bgGrid.grid[5][5]).toBe("#00000000");
    });

    it("frameNumber targets a non-active frame without changing active frame", () => {
      engine.executeCommand("create_frame", { duration: 100 });
      expect(engine.activeFrameNumber).toBe(1);

      const res = engine.executeCommand("set_pixel", {
        frameNumber: 2,
        x: 8,
        y: 8,
        color: "#FF00FFFF",
      });
      expect(res.pixelsModified).toBe(1);
      expect(engine.activeFrameNumber).toBe(1); // active frame unchanged!

      const frame2Grid = engine.executeCommand("get_pixel_grid", { frameIndex: 2, format: "hex" });
      expect(frame2Grid.grid[8][8]).toBe("#FF00FFFF");

      const frame1Grid = engine.executeCommand("get_pixel_grid", { frameIndex: 1, format: "hex" });
      expect(frame1Grid.grid[8][8]).toBe("#00000000");
    });

    it("conflicting layer selectors fail", () => {
      engine.executeCommand("create_layer", { name: "ExtraLayer" });
      // Layer 0 is "Layer 1", Layer 1 is "ExtraLayer"
      expect(() => {
        engine.executeCommand("set_pixel", {
          layerIndex: 0,
          layerName: "ExtraLayer",
          x: 0,
          y: 0,
          color: "#FF0000FF",
        });
      }).toThrow(/Conflicting layer selectors/);
    });

    it("repeated writes of the same color report zero changes and do not advance revision", () => {
      const initialRev = engine.revision;
      const res1 = engine.executeCommand("set_pixel", { x: 3, y: 3, color: "#FF0000FF" });
      expect(res1.pixelsModified).toBe(1);
      expect(res1.revision).toBe(initialRev + 1);

      // Repeat identical write
      const res2 = engine.executeCommand("set_pixel", { x: 3, y: 3, color: "#FF0000FF" });
      expect(res2.pixelsModified).toBe(0);
      expect(res2.revision).toBe(initialRev + 1); // revision did NOT advance!

      // Batch with same color
      const res3 = engine.executeCommand("set_pixels", {
        pixels: [
          { x: 3, y: 3, color: "#FF0000FF" },
          { x: 3, y: 3, color: "#FF0000FF" },
        ],
      });
      expect(res3.pixelsModified).toBe(0);
      expect(res3.revision).toBe(initialRev + 1);
    });

    it("tolerance 0 versus nonzero changes flood_fill and replace_color behavior", () => {
      // Paint baseline: (0,0) is #FF0000FF, (1,0) is #FE0000FF (Manhattan RGBA delta = 1)
      engine.executeCommand("set_pixels", {
        pixels: [
          { x: 0, y: 0, color: "#FF0000FF" },
          { x: 1, y: 0, color: "#FE0000FF" },
        ],
      });

      // replace_color with tolerance 0 should only replace exact #FF0000FF
      engine.executeCommand("replace_color", {
        fromColor: "#FF0000FF",
        toColor: "#00FF00FF",
        tolerance: 0,
      });
      let grid = engine.executeCommand("get_pixel_grid", { format: "hex" });
      expect(grid.grid[0][0]).toBe("#00FF00FF");
      expect(grid.grid[0][1]).toBe("#FE0000FF");

      // Reset (0,0) back to #FF0000FF
      engine.executeCommand("set_pixel", { x: 0, y: 0, color: "#FF0000FF" });

      // replace_color with tolerance 1 (delta 1 <= 1*4) replaces both #FF0000FF and #FE0000FF
      engine.executeCommand("replace_color", {
        fromColor: "#FF0000FF",
        toColor: "#0000FFFF",
        tolerance: 1,
      });
      grid = engine.executeCommand("get_pixel_grid", { format: "hex" });
      expect(grid.grid[0][0]).toBe("#0000FFFF");
      expect(grid.grid[0][1]).toBe("#0000FFFF");

      // Test flood_fill with tolerance:
      engine.executeCommand("set_pixels", {
        pixels: [
          { x: 10, y: 10, color: "#101010FF" },
          { x: 11, y: 10, color: "#111111FF" }, // Manhattan delta = 1+1+1 = 3
        ],
      });
      // Flood fill at (10,10) with tolerance 0 does not cross to (11,10)
      engine.executeCommand("flood_fill", { x: 10, y: 10, color: "#AABBCCFF", tolerance: 0 });
      grid = engine.executeCommand("get_pixel_grid", { format: "hex" });
      expect(grid.grid[10][10]).toBe("#AABBCCFF");
      expect(grid.grid[10][11]).toBe("#111111FF");

      // Repaint baseline before second flood fill
      engine.executeCommand("set_pixels", {
        pixels: [
          { x: 10, y: 10, color: "#101010FF" },
          { x: 11, y: 10, color: "#111111FF" },
        ],
      });

      // Flood fill with tolerance 1 (3 <= 1*4) crosses and fills
      engine.executeCommand("flood_fill", { x: 10, y: 10, color: "#FFFFFF00", tolerance: 1 });
      grid = engine.executeCommand("get_pixel_grid", { format: "hex" });
      expect(grid.grid[10][10]).toBe("#FFFFFF00");
      expect(grid.grid[10][11]).toBe("#FFFFFF00");
    });

    it("invalid frame and layer selectors fail with clear errors", () => {
      expect(() => {
        engine.executeCommand("set_pixel", { layerIndex: 999, x: 0, y: 0, color: "#FF0000FF" });
      }).toThrow(/Invalid layerIndex/);

      expect(() => {
        engine.executeCommand("set_pixel", { layerName: "NoSuchLayer", x: 0, y: 0, color: "#FF0000FF" });
      }).toThrow(/Layer 'NoSuchLayer' not found/);

      expect(() => {
        engine.executeCommand("set_pixel", { frameNumber: 999, x: 0, y: 0, color: "#FF0000FF" });
      }).toThrow(/Invalid frame/);

      expect(() => {
        engine.executeCommand("flood_fill", { x: -1, y: 0, color: "#FF0000FF" });
      }).toThrow(/Seed coordinate \(-1, 0\) out of bounds/);
    });

    it("get_pixel_grid handles indexed format and indexedSource flag correctly", () => {
      // In RGB mode
      const rgbGrid = engine.executeCommand("get_pixel_grid", { format: "indexed" });
      expect(rgbGrid.indexedSource).toBe(false);
      expect(typeof rgbGrid.grid[0][0]).toBe("number");

      // In indexed mode
      engine.colorMode = "indexed";
      const idxGrid = engine.executeCommand("get_pixel_grid", { format: "indexed" });
      expect(idxGrid.indexedSource).toBe(true);
      expect(typeof idxGrid.grid[0][0]).toBe("number");
    });
  });

  describe("Public Schema Parity (parentGroup, afterFrame, create_tag color, findNearest)", () => {
    it("find_palette_color handles exact match, exact miss with findNearest: false, and nearest match", () => {
      engine.reset();
      engine.executeCommand("set_palette_color", { index: 10, color: "#112233FF" });
      engine.executeCommand("set_palette_color", { index: 11, color: "#445566FF" });

      // 1. Exact match
      const exactRes = engine.executeCommand("find_palette_color", { color: "#112233FF", findNearest: false });
      expect(exactRes.found).toBe(true);
      expect(exactRes.exact).toBe(true);
      expect(exactRes.index).toBe(10);
      expect(exactRes.hex).toBe("#112233FF");
      expect(exactRes.distance).toBe(0);

      // 2. Exact miss with findNearest: false returns found: false, exact: false without index
      const missRes = engine.executeCommand("find_palette_color", { color: "#112238FF", findNearest: false });
      expect(missRes.found).toBe(false);
      expect(missRes.exact).toBe(false);
      expect((missRes as any).index).toBeUndefined();

      // 3. Nearest match succeeds with found: true, exact: false, and correct distance
      const nearestRes = engine.executeCommand("find_palette_color", { color: "#112238FF", findNearest: true });
      expect(nearestRes.found).toBe(true);
      expect(nearestRes.exact).toBe(false);
      expect(nearestRes.index).toBe(10);
      expect(nearestRes.hex).toBe("#112233FF");
      expect(nearestRes.distance).toBe(5);
    });

    it("create_layer with parentGroup handles success, missing group, non-group, and ambiguous names", () => {
      engine.reset();
      const initialCount = engine.layers.length;

      // 1. Create a valid group
      const groupRes = engine.executeCommand("create_group", { name: "Characters" });
      expect(groupRes.group.isGroup).toBe(true);
      const groupIdx = groupRes.group.index;

      // 2. Success: create_layer with valid parentGroup sets parentIndex
      const layerRes = engine.executeCommand("create_layer", { name: "Hero", parentGroup: "Characters" });
      expect(layerRes.success).toBe(true);
      expect(layerRes.layer.parentIndex).toBe(groupIdx);
      const heroLayer = engine.layers.find((l) => l.name === "Hero");
      expect(heroLayer?.parentIndex).toBe(groupIdx);

      const countAfterSuccess = engine.layers.length;

      // 3. Missing parentGroup throws before mutation
      expect(() => {
        engine.executeCommand("create_layer", { name: "Villain", parentGroup: "NonExistent" });
      }).toThrow(/Parent group 'NonExistent' not found/);
      expect(engine.layers.length).toBe(countAfterSuccess);

      // 4. Non-group layer as parent throws before mutation
      expect(() => {
        engine.executeCommand("create_layer", { name: "Weapon", parentGroup: "Hero" });
      }).toThrow(/Layer 'Hero' is not a group/);
      expect(engine.layers.length).toBe(countAfterSuccess);

      // 5. Ambiguous parentGroup (multiple groups with same name) throws before mutation
      engine.executeCommand("create_group", { name: "AmbiguousGroup" });
      engine.executeCommand("create_group", { name: "AmbiguousGroup" });
      const countBeforeAmbiguous = engine.layers.length;

      expect(() => {
        engine.executeCommand("create_layer", { name: "Item", parentGroup: "AmbiguousGroup" });
      }).toThrow(/Ambiguous parentGroup 'AmbiguousGroup'/);
      expect(engine.layers.length).toBe(countBeforeAmbiguous);
    });

    it("create_frame preserves pixels on shifted frames, adjusts activeFrameNumber, and validates afterFrame", () => {
      engine.reset();
      // Setup frame 1 with pixel
      engine.executeCommand("set_pixel", { frameNumber: 1, x: 2, y: 2, color: "#111111FF" });

      // Create frame 2 and paint pixel
      engine.executeCommand("create_frame", { duration: 150 });
      expect(engine.frames.length).toBe(2);
      engine.executeCommand("set_pixel", { frameNumber: 2, x: 4, y: 4, color: "#222222FF" });

      // Verify frame 2 pixel before insertion
      const cel2Before = engine.cels.get("0:2");
      expect(cel2Before).toBeDefined();

      // Insert new frame at position 2 (afterFrame: 1)
      engine.activeFrameNumber = 2; // currently at frame 2
      const insertRes = engine.executeCommand("create_frame", { afterFrame: 1, duration: 200 });
      expect(insertRes.success).toBe(true);
      expect(insertRes.frameNumber).toBe(2);
      expect(insertRes.createdFrameNumber).toBe(2);
      expect(insertRes.totalFrames).toBe(3);
      expect(insertRes.durationMs).toBe(200);

      // Frame array renumbered
      expect(engine.frames.map((f) => f.frameNumber)).toEqual([1, 2, 3]);

      // Previous frame 2 is now shifted to frame 3, and its pixel at (4,4) is preserved!
      const shiftedGrid = engine.executeCommand("get_pixel_grid", { frameIndex: 3, format: "hex" });
      expect(shiftedGrid.grid[4][4]).toBe("#222222FF");

      // Frame 1 pixel at (2,2) remains untouched
      const frame1Grid = engine.executeCommand("get_pixel_grid", { frameIndex: 1, format: "hex" });
      expect(frame1Grid.grid[2][2]).toBe("#111111FF");

      // Newly inserted frame 2 is blank (transparent)
      const frame2Grid = engine.executeCommand("get_pixel_grid", { frameIndex: 2, format: "hex" });
      expect(frame2Grid.grid[4][4]).toBe("#00000000");

      // Active frame adjusted from 2 to 3 because insertion occurred before/at it
      expect(engine.activeFrameNumber).toBe(3);

      // Invalid afterFrame values throw before mutation
      const framesCountBefore = engine.frames.length;
      expect(() => {
        engine.executeCommand("create_frame", { afterFrame: 0 });
      }).toThrow(/Invalid afterFrame/);
      expect(() => {
        engine.executeCommand("create_frame", { afterFrame: 999 });
      }).toThrow(/Invalid afterFrame/);
      expect(() => {
        engine.executeCommand("create_frame", { durationMs: 100 } as any);
      }).toThrow(/create_frame accepts 'duration'/);
      expect(engine.frames.length).toBe(framesCountBefore);
    });

    it("create_tag normalizes color to canonical #RRGGBBAA and validates frame range before mutation", () => {
      engine.reset();
      engine.executeCommand("create_frame", { duration: 100 });
      engine.executeCommand("create_frame", { duration: 100 });
      expect(engine.frames.length).toBe(3);

      // 1. Success with color normalization (3-digit or lowercase)
      const tagRes = engine.executeCommand("create_tag", {
        name: "walk",
        fromFrame: 1,
        toFrame: 2,
        color: "#f00f",
      });
      expect(tagRes.success).toBe(true);

      const listRes = engine.executeCommand("list_tags", {});
      expect(listRes.tags.length).toBe(1);
      expect(listRes.tags[0].name).toBe("walk");
      expect(listRes.tags[0].from).toBe(1);
      expect(listRes.tags[0].to).toBe(2);
      expect(listRes.tags[0].color).toBe("#FF0000FF");

      // 2. Invalid range: fromFrame > toFrame throws before mutation
      expect(() => {
        engine.executeCommand("create_tag", { name: "invalid", fromFrame: 3, toFrame: 1 });
      }).toThrow(/fromFrame must be <= toFrame/);
      expect(engine.tags.length).toBe(1);

      // 3. Invalid range: toFrame > total frames throws before mutation
      expect(() => {
        engine.executeCommand("create_tag", { name: "invalid", fromFrame: 1, toFrame: 99 });
      }).toThrow(/out of range/);
      expect(engine.tags.length).toBe(1);

      // 4. Invalid range: fromFrame < 1 throws before mutation
      expect(() => {
        engine.executeCommand("create_tag", { name: "invalid", fromFrame: 0, toFrame: 2 });
      }).toThrow(/out of range/);
      expect(engine.tags.length).toBe(1);
    });
  });

  describe("resize_canvas and export_png canonical behavior and validation", () => {
    it("resize_canvas expands correctly for all 5 anchors and preserves existing content while exposing blank pixels", () => {
      // 1. top_left
      engine = new MockAsepriteEngine(10, 10);
      engine.executeCommand("set_pixel", { x: 2, y: 2, color: "#FF0000FF" });
      engine.executeCommand("set_pixel", { x: 7, y: 7, color: "#00FF00FF" });
      const revBeforeTL = engine.revision;
      const resTL = engine.executeCommand("resize_canvas", { width: 14, height: 14, anchor: "top_left" });
      expect(resTL.success).toBe(true);
      expect(resTL.previousWidth).toBe(10);
      expect(resTL.previousHeight).toBe(10);
      expect(resTL.width).toBe(14);
      expect(resTL.height).toBe(14);
      expect(resTL.anchor).toBe("top_left");
      expect(resTL.contentOffset).toEqual({ x: 0, y: 0 });
      expect(resTL.revision).toBe(revBeforeTL + 1);

      const gridTL = engine.executeCommand("get_pixel_grid", { format: "hex" });
      expect(gridTL.grid[2][2]).toBe("#FF0000FF");
      expect(gridTL.grid[7][7]).toBe("#00FF00FF");
      expect(gridTL.grid[13][13]).toBe("#00000000");

      // 2. center (10x10 -> 14x14: dx = (14-10)/2 = 2, dy = 2)
      engine = new MockAsepriteEngine(10, 10);
      engine.executeCommand("set_pixel", { x: 2, y: 2, color: "#FF0000FF" });
      engine.executeCommand("set_pixel", { x: 7, y: 7, color: "#00FF00FF" });
      const resCenter = engine.executeCommand("resize_canvas", { width: 14, height: 14, anchor: "center" });
      expect(resCenter.anchor).toBe("center");
      expect(resCenter.contentOffset).toEqual({ x: 2, y: 2 });
      const gridCenter = engine.executeCommand("get_pixel_grid", { format: "hex" });
      expect(gridCenter.grid[4][4]).toBe("#FF0000FF");
      expect(gridCenter.grid[9][9]).toBe("#00FF00FF");
      expect(gridCenter.grid[2][2]).toBe("#00000000"); // old pos is blank now
      expect(gridCenter.grid[0][0]).toBe("#00000000");

      // 3. top_right (10x10 -> 14x14: dx = 4, dy = 0)
      engine = new MockAsepriteEngine(10, 10);
      engine.executeCommand("set_pixel", { x: 2, y: 2, color: "#FF0000FF" });
      engine.executeCommand("set_pixel", { x: 7, y: 7, color: "#00FF00FF" });
      const resTR = engine.executeCommand("resize_canvas", { width: 14, height: 14, anchor: "top_right" });
      expect(resTR.anchor).toBe("top_right");
      expect(resTR.contentOffset).toEqual({ x: 4, y: 0 });
      const gridTR = engine.executeCommand("get_pixel_grid", { format: "hex" });
      expect(gridTR.grid[2][6]).toBe("#FF0000FF");
      expect(gridTR.grid[7][11]).toBe("#00FF00FF");
      expect(gridTR.grid[2][2]).toBe("#00000000");

      // 4. bottom_left (10x10 -> 14x14: dx = 0, dy = 4)
      engine = new MockAsepriteEngine(10, 10);
      engine.executeCommand("set_pixel", { x: 2, y: 2, color: "#FF0000FF" });
      engine.executeCommand("set_pixel", { x: 7, y: 7, color: "#00FF00FF" });
      const resBL = engine.executeCommand("resize_canvas", { width: 14, height: 14, anchor: "bottom_left" });
      expect(resBL.anchor).toBe("bottom_left");
      expect(resBL.contentOffset).toEqual({ x: 0, y: 4 });
      const gridBL = engine.executeCommand("get_pixel_grid", { format: "hex" });
      expect(gridBL.grid[6][2]).toBe("#FF0000FF");
      expect(gridBL.grid[11][7]).toBe("#00FF00FF");
      expect(gridBL.grid[2][2]).toBe("#00000000");

      // 5. bottom_right (10x10 -> 14x14: dx = 4, dy = 4)
      engine = new MockAsepriteEngine(10, 10);
      engine.executeCommand("set_pixel", { x: 2, y: 2, color: "#FF0000FF" });
      engine.executeCommand("set_pixel", { x: 7, y: 7, color: "#00FF00FF" });
      const resBR = engine.executeCommand("resize_canvas", { width: 14, height: 14, anchor: "bottom_right" });
      expect(resBR.anchor).toBe("bottom_right");
      expect(resBR.contentOffset).toEqual({ x: 4, y: 4 });
      const gridBR = engine.executeCommand("get_pixel_grid", { format: "hex" });
      expect(gridBR.grid[6][6]).toBe("#FF0000FF");
      expect(gridBR.grid[11][11]).toBe("#00FF00FF");
      expect(gridBR.grid[2][2]).toBe("#00000000");
    });

    it("resize_canvas shrinks correctly for all 5 anchors and clips out-of-bounds content", () => {
      // 1. top_left (10x10 -> 6x6: dx = 0, dy = 0)
      engine = new MockAsepriteEngine(10, 10);
      engine.executeCommand("set_pixel", { x: 2, y: 2, color: "#FF0000FF" });
      engine.executeCommand("set_pixel", { x: 7, y: 7, color: "#00FF00FF" });
      const resTL = engine.executeCommand("resize_canvas", { width: 6, height: 6, anchor: "top_left" });
      expect(resTL.contentOffset).toEqual({ x: 0, y: 0 });
      const gridTL = engine.executeCommand("get_pixel_grid", { format: "hex" });
      expect(gridTL.grid.length).toBe(6);
      expect(gridTL.grid[0].length).toBe(6);
      expect(gridTL.grid[2][2]).toBe("#FF0000FF"); // inside bounds, preserved

      // 2. center (10x10 -> 6x6: dx = -2, dy = -2)
      engine = new MockAsepriteEngine(10, 10);
      engine.executeCommand("set_pixel", { x: 4, y: 4, color: "#FF0000FF" }); // (4-2, 4-2) = (2, 2)
      engine.executeCommand("set_pixel", { x: 0, y: 0, color: "#00FF00FF" }); // (0-2, 0-2) = (-2, -2) clipped
      const resCenter = engine.executeCommand("resize_canvas", { width: 6, height: 6, anchor: "center" });
      expect(resCenter.contentOffset).toEqual({ x: -2, y: -2 });
      const gridCenter = engine.executeCommand("get_pixel_grid", { format: "hex" });
      expect(gridCenter.grid[2][2]).toBe("#FF0000FF");

      // 3. top_right (10x10 -> 6x6: dx = -4, dy = 0)
      engine = new MockAsepriteEngine(10, 10);
      engine.executeCommand("set_pixel", { x: 8, y: 2, color: "#FF0000FF" }); // (8-4, 2) = (4, 2)
      engine.executeCommand("set_pixel", { x: 2, y: 2, color: "#00FF00FF" }); // (2-4, 2) = (-2, 2) clipped
      const resTR = engine.executeCommand("resize_canvas", { width: 6, height: 6, anchor: "top_right" });
      expect(resTR.contentOffset).toEqual({ x: -4, y: 0 });
      const gridTR = engine.executeCommand("get_pixel_grid", { format: "hex" });
      expect(gridTR.grid[2][4]).toBe("#FF0000FF");

      // 4. bottom_left (10x10 -> 6x6: dx = 0, dy = -4)
      engine = new MockAsepriteEngine(10, 10);
      engine.executeCommand("set_pixel", { x: 2, y: 8, color: "#FF0000FF" }); // (2, 8-4) = (2, 4)
      engine.executeCommand("set_pixel", { x: 2, y: 2, color: "#00FF00FF" }); // (2, 2-4) = (2, -2) clipped
      const resBL = engine.executeCommand("resize_canvas", { width: 6, height: 6, anchor: "bottom_left" });
      expect(resBL.contentOffset).toEqual({ x: 0, y: -4 });
      const gridBL = engine.executeCommand("get_pixel_grid", { format: "hex" });
      expect(gridBL.grid[4][2]).toBe("#FF0000FF");

      // 5. bottom_right (10x10 -> 6x6: dx = -4, dy = -4)
      engine = new MockAsepriteEngine(10, 10);
      engine.executeCommand("set_pixel", { x: 8, y: 8, color: "#FF0000FF" }); // (8-4, 8-4) = (4, 4)
      engine.executeCommand("set_pixel", { x: 2, y: 2, color: "#00FF00FF" }); // clipped
      const resBR = engine.executeCommand("resize_canvas", { width: 6, height: 6, anchor: "bottom_right" });
      expect(resBR.contentOffset).toEqual({ x: -4, y: -4 });
      const gridBR = engine.executeCommand("get_pixel_grid", { format: "hex" });
      expect(gridBR.grid[4][4]).toBe("#FF0000FF");
    });

    it("resize_canvas validates dimensions and anchors before mutation", () => {
      engine = new MockAsepriteEngine(16, 16);
      const revBefore = engine.revision;

      expect(() => {
        engine.executeCommand("resize_canvas", { width: 0, height: 16 });
      }).toThrow(/Canvas dimensions must be integers/);

      expect(() => {
        engine.executeCommand("resize_canvas", { width: 16, height: -5 });
      }).toThrow(/Canvas dimensions must be integers/);

      expect(() => {
        engine.executeCommand("resize_canvas", { width: 5000, height: 16 });
      }).toThrow(/Canvas dimensions must be integers/);

      expect(() => {
        engine.executeCommand("resize_canvas", { width: 16, height: 16, anchor: "invalid_anchor" as any });
      }).toThrow(/Invalid anchor/);

      // State and revision unchanged
      expect(engine.revision).toBe(revBefore);
      expect(engine.width).toBe(16);
      expect(engine.height).toBe(16);
    });

    it("export_png validates frame and scale, returns metadata, and does not mutate revision or state", () => {
      engine = new MockAsepriteEngine(16, 16);
      engine.executeCommand("create_frame", { duration: 150 });
      expect(engine.frames.length).toBe(2);

      // Explicitly select frame 2 to test default-to-active behavior with non-1 active frame
      engine.executeCommand("select_frame", { frameNumber: 2 });
      expect(engine.activeFrameNumber).toBe(2);

      const revBefore = engine.revision;
      const activeFrameBefore = engine.activeFrameNumber;
      const widthBefore = engine.width;
      const heightBefore = engine.height;

      // 1. Default frame (active frame, which is 2) and default scale (1)
      const res1 = engine.executeCommand("export_png", { outputPath: "output/frame2.png" });
      expect(res1.success).toBe(true);
      expect(res1.outputPath).toBe("output/frame2.png");
      expect(res1.frameNumber).toBe(2);
      expect(res1.scale).toBe(1);
      expect(res1.width).toBe(16);
      expect(res1.height).toBe(16);

      // 2. Explicit frame 1 and scale 4
      const res2 = engine.executeCommand("export_png", { outputPath: "output/frame1_scaled.png", frameNumber: 1, scale: 4 });
      expect(res2.success).toBe(true);
      expect(res2.outputPath).toBe("output/frame1_scaled.png");
      expect(res2.frameNumber).toBe(1);
      expect(res2.scale).toBe(4);
      expect(res2.width).toBe(64);
      expect(res2.height).toBe(64);

      // Verify ZERO mutation of engine state
      expect(engine.revision).toBe(revBefore);
      expect(engine.activeFrameNumber).toBe(activeFrameBefore);
      expect(engine.width).toBe(widthBefore);
      expect(engine.height).toBe(heightBefore);

      // 3. Validation errors
      expect(() => {
        engine.executeCommand("export_png", { outputPath: "" });
      }).toThrow(/outputPath is required/);

      expect(() => {
        engine.executeCommand("export_png", { outputPath: "out.png", frameNumber: 0 });
      }).toThrow(/Invalid frame/);

      expect(() => {
        engine.executeCommand("export_png", { outputPath: "out.png", frameNumber: 99 });
      }).toThrow(/Invalid frame/);

      expect(() => {
        engine.executeCommand("export_png", { outputPath: "out.png", scale: 0 });
      }).toThrow(/Invalid scale/);

      expect(() => {
        engine.executeCommand("export_png", { outputPath: "out.png", scale: 33 });
      }).toThrow(/Invalid scale/);

      expect(() => {
        engine.executeCommand("export_png", { outputPath: "out.png", scale: 2.5 as any });
      }).toThrow(/Invalid scale/);

      expect(engine.revision).toBe(revBefore);
    });
  });

  describe("visual inspection & token efficiency (get_canvas layer isolation and get_pixel_grid region)", () => {
    it("get_canvas renders isolated layer differently from composite without mutating active state or visibility", () => {
      engine = new MockAsepriteEngine(16, 16);
      engine.executeCommand("set_pixel", { x: 2, y: 2, color: "#FF0000FF" }); // Layer 1 (index 0)

      engine.executeCommand("create_layer", { name: "Overlay" }); // Layer 2 (index 1)
      engine.executeCommand("set_pixel", { layerName: "Overlay", x: 5, y: 5, color: "#00FF00FF" });

      const activeLayerBefore = engine.activeLayerIndex;
      const activeFrameBefore = engine.activeFrameNumber;
      const revBefore = engine.revision;
      const layer0VisBefore = engine.layers[0].isVisible;
      const layer1VisBefore = engine.layers[1].isVisible;

      // 1. Composite canvas
      const compCanvas = engine.executeCommand("get_canvas", {});
      expect(compCanvas.pngBase64).toBeDefined();

      // 2. Isolated layer canvas
      const overlayCanvas = engine.executeCommand("get_canvas", { layerName: "Overlay" });
      expect(overlayCanvas.pngBase64).toBeDefined();

      // Isolated layer rendering differs from composite
      expect(overlayCanvas.pngBase64).not.toBe(compCanvas.pngBase64);

      // Verify ZERO mutation of active state or visibility
      expect(engine.activeLayerIndex).toBe(activeLayerBefore);
      expect(engine.activeFrameNumber).toBe(activeFrameBefore);
      expect(engine.revision).toBe(revBefore);
      expect(engine.layers[0].isVisible).toBe(layer0VisBefore);
      expect(engine.layers[1].isVisible).toBe(layer1VisBefore);

      // Decode PNGs with pngjs to verify exact pixels
      const compPng = PNG.sync.read(Buffer.from(compCanvas.pngBase64, "base64"));
      const overlayPng = PNG.sync.read(Buffer.from(overlayCanvas.pngBase64, "base64"));

      // Composite contains pixel from Layer 1 at (2, 2) [red] and Layer 2 at (5, 5) [green]
      const compIdx22 = (2 * 16 + 2) * 4;
      expect(compPng.data[compIdx22 + 0]).toBe(255); // R
      expect(compPng.data[compIdx22 + 1]).toBe(0);   // G
      expect(compPng.data[compIdx22 + 2]).toBe(0);   // B
      expect(compPng.data[compIdx22 + 3]).toBe(255); // A

      const compIdx55 = (5 * 16 + 5) * 4;
      expect(compPng.data[compIdx55 + 0]).toBe(0);   // R
      expect(compPng.data[compIdx55 + 1]).toBe(255); // G
      expect(compPng.data[compIdx55 + 2]).toBe(0);   // B
      expect(compPng.data[compIdx55 + 3]).toBe(255); // A

      // Isolated overlay layer PNG:
      // Requested layer pixel at (5, 5) is present and fully opaque
      const overlayIdx55 = (5 * 16 + 5) * 4;
      expect(overlayPng.data[overlayIdx55 + 0]).toBe(0);   // R
      expect(overlayPng.data[overlayIdx55 + 1]).toBe(255); // G
      expect(overlayPng.data[overlayIdx55 + 2]).toBe(0);   // B
      expect(overlayPng.data[overlayIdx55 + 3]).toBe(255); // A

      // Pixel exclusive to another layer (2, 2) is transparent
      const overlayIdx22 = (2 * 16 + 2) * 4;
      expect(overlayPng.data[overlayIdx22 + 3]).toBe(0); // A === 0

      // Observable effective layer opacity: set opacity to 128
      engine.executeCommand("set_layer_opacity", { name: "Overlay", opacity: 128 });
      const revBeforeTranslucent = engine.revision;
      const translucentCanvas = engine.executeCommand("get_canvas", { layerName: "Overlay" });
      expect(engine.revision).toBe(revBeforeTranslucent); // get_canvas does not mutate
      const translucentPng = PNG.sync.read(Buffer.from(translucentCanvas.pngBase64, "base64"));
      expect(translucentPng.data[overlayIdx55 + 3]).toBe(128); // Observable alpha 128

      // Restore layer opacity for remaining assertions
      engine.executeCommand("set_layer_opacity", { name: "Overlay", opacity: 255 });

      // 3. Frame targeting without changing active frame
      engine.executeCommand("create_frame", { duration: 100 });
      const frameCanvas = engine.executeCommand("get_canvas", { frameIndex: 2 });
      expect(frameCanvas.frameNumber).toBe(2);
      expect(engine.activeFrameNumber).toBe(activeFrameBefore);

      // 4. Error on non-existent layer
      expect(() => {
        engine.executeCommand("get_canvas", { layerName: "NonExistent" });
      }).toThrow(/not found/);

      // 5. Error on group layer
      engine.executeCommand("create_group", { name: "GroupA" });
      expect(() => {
        engine.executeCommand("get_canvas", { layerName: "GroupA" });
      }).toThrow("Cannot render group layer.");

      // 6. Error on ambiguous layerName
      engine.executeCommand("create_layer", { name: "DuplicateName" });
      engine.executeCommand("create_layer", { name: "DuplicateName" });
      expect(() => {
        engine.executeCommand("get_canvas", { layerName: "DuplicateName" });
      }).toThrow(/Ambiguous/);
    });

    it("get_pixel_grid iterates exact native region, clips to borders, and rejects invalid origins/dimensions", () => {
      engine = new MockAsepriteEngine(32, 32);
      engine.executeCommand("set_pixel", { x: 2, y: 2, color: "#FF0000FF" });
      engine.executeCommand("set_pixel", { x: 3, y: 3, color: "#00FF00FF" });
      engine.executeCommand("set_pixel", { x: 10, y: 10, color: "#0000FFFF" });

      const revBefore = engine.revision;

      // 1. Exact region
      const exactRes = engine.executeCommand("get_pixel_grid", {
        region: { x: 2, y: 2, width: 2, height: 2 },
        format: "hex",
      });
      expect(exactRes.width).toBe(2);
      expect(exactRes.height).toBe(2);
      expect(exactRes.origin).toEqual({ x: 2, y: 2 });
      expect(exactRes.region).toEqual({ x: 2, y: 2, width: 2, height: 2 });
      expect(exactRes.grid.length).toBe(2);
      expect(exactRes.grid[0].length).toBe(2);
      expect(exactRes.grid[0][0]).toBe("#FF0000FF");
      expect(exactRes.grid[1][1]).toBe("#00FF00FF");

      // 2. Border clipping (30,30 on 32x32 clips 10x10 to 2x2)
      const borderRes = engine.executeCommand("get_pixel_grid", {
        region: { x: 30, y: 30, width: 10, height: 10 },
        format: "hex",
      });
      expect(borderRes.width).toBe(2);
      expect(borderRes.height).toBe(2);
      expect(borderRes.origin).toEqual({ x: 30, y: 30 });
      expect(borderRes.region).toEqual({ x: 30, y: 30, width: 2, height: 2 });
      expect(borderRes.grid.length).toBe(2);
      expect(borderRes.grid[0].length).toBe(2);

      // 3. Compact palette restricted strictly to region
      const compactRes = engine.executeCommand("get_pixel_grid", {
        region: { x: 2, y: 2, width: 2, height: 2 },
        format: "compact",
      });
      expect(compactRes.width).toBe(2);
      expect(compactRes.height).toBe(2);
      expect(compactRes.palette).toContain("#FF0000FF");
      expect(compactRes.palette).toContain("#00FF00FF");
      // #0000FFFF at (10, 10) is outside the region and must NOT be in palette
      expect(compactRes.palette).not.toContain("#0000FFFF");

      // 4. Invalid origin outside canvas bounds
      expect(() => {
        engine.executeCommand("get_pixel_grid", { region: { x: 32, y: 0, width: 4, height: 4 } });
      }).toThrow(/Region origin outside canvas bounds/);

      expect(() => {
        engine.executeCommand("get_pixel_grid", { region: { x: 0, y: 35, width: 4, height: 4 } });
      }).toThrow(/Region origin outside canvas bounds/);

      // 5. Invalid negative coordinates or zero/negative dimensions
      expect(() => {
        engine.executeCommand("get_pixel_grid", { region: { x: -1, y: 0, width: 4, height: 4 } });
      }).toThrow(/must be non-negative integers/);

      expect(() => {
        engine.executeCommand("get_pixel_grid", { region: { x: 0, y: 0, width: 0, height: 4 } });
      }).toThrow(/must be positive integers/);

      expect(() => {
        engine.executeCommand("get_pixel_grid", { region: { x: 0, y: 0, width: 4, height: -2 } });
      }).toThrow(/must be positive integers/);

      // Zero mutation
      expect(engine.revision).toBe(revBefore);
    });

    it("applyLegacyRegionFallback validates canvas dimensions and out-of-bounds origins", () => {
      expect(() =>
        applyLegacyRegionFallback({ width: 0, height: 10, grid: [[]] }, { x: 0, y: 0, width: 2, height: 2 })
      ).toThrow(/Invalid canvas dimensions/);

      expect(() =>
        applyLegacyRegionFallback({ width: 10, height: -1, grid: [[]] }, { x: 0, y: 0, width: 2, height: 2 })
      ).toThrow(/Invalid canvas dimensions/);

      expect(() =>
        applyLegacyRegionFallback({ width: 10, height: 10, grid: [[]] }, { x: 10, y: 0, width: 2, height: 2 })
      ).toThrow(/Region origin outside canvas bounds/);

      expect(() =>
        applyLegacyRegionFallback({ width: 10, height: 10, grid: [[]] }, { x: 0, y: 15, width: 2, height: 2 })
      ).toThrow(/Region origin outside canvas bounds/);
    });

    it("applyLegacyRegionFallback crops subgrid, updates width/height/origin/region, and clips to borders", () => {
      const legacyRes = {
        width: 10,
        height: 10,
        format: "hex",
        grid: Array.from({ length: 10 }, (_, y) =>
          Array.from({ length: 10 }, (_, x) => `c_${x}_${y}`)
        ),
      };
      const result = applyLegacyRegionFallback(legacyRes, { x: 8, y: 8, width: 5, height: 5 });
      expect(result.width).toBe(2);
      expect(result.height).toBe(2);
      expect(result.origin).toEqual({ x: 8, y: 8 });
      expect(result.region).toEqual({ x: 8, y: 8, width: 2, height: 2 });
      expect(result.grid).toEqual([
        ["c_8_8", "c_9_8"],
        ["c_8_9", "c_9_9"],
      ]);
    });

    it("applyLegacyRegionFallback remaps compact format palette to strictly used indices and preserves missing palette", () => {
      const compactRes = {
        width: 4,
        height: 4,
        format: "compact",
        palette: ["#00000000", "#FF0000FF", "#00FF00FF", "#0000FFFF", "#FFFF00FF"],
        grid: [
          [1, 2, 3, 4],
          [2, 1, 4, 3],
          [3, 4, 1, 2],
          [4, 3, 2, 1],
        ],
      };
      // Request region { x: 0, y: 0, width: 2, height: 2 } which only uses indices 1 (#FF0000FF) and 2 (#00FF00FF)
      const croppedCompact = applyLegacyRegionFallback(compactRes, { x: 0, y: 0, width: 2, height: 2 });
      expect(croppedCompact.width).toBe(2);
      expect(croppedCompact.height).toBe(2);
      expect(croppedCompact.origin).toEqual({ x: 0, y: 0 });
      expect(croppedCompact.region).toEqual({ x: 0, y: 0, width: 2, height: 2 });
      // Palette must contain only the 2 colors used in the subgrid
      expect(croppedCompact.palette).toEqual(["#FF0000FF", "#00FF00FF"]);
      // Subgrid indices must be remapped to 0 and 1
      expect(croppedCompact.grid).toEqual([
        [0, 1],
        [1, 0],
      ]);

      // If palette is not an array, preserves data without throwing
      const noPaletteRes = {
        width: 4,
        height: 4,
        format: "compact",
        grid: [
          [1, 2],
          [2, 1],
        ],
      };
      const safeResult = applyLegacyRegionFallback(noPaletteRes, { x: 0, y: 0, width: 2, height: 2 });
      expect(safeResult.width).toBe(2);
      expect(safeResult.height).toBe(2);
      expect(safeResult.grid).toEqual([
        [1, 2],
        [2, 1],
      ]);
    });
  });

  describe("MockAsepriteEngine file security and parity operations", () => {
    it("save_sprite rejects missing expectedFilePath and filename mismatch, and accepts matching path", () => {
      // Missing expectedFilePath
      expect(() => engine.executeCommand("save_sprite", {})).toThrow(/expectedFilePath is required/i);
      expect(() => engine.executeCommand("save_sprite", { expectedFilePath: "" })).toThrow(/expectedFilePath is required/i);

      // Mismatch
      expect(() => engine.executeCommand("save_sprite", { expectedFilePath: "other.aseprite" })).toThrow(
        /Sprite filename mismatch/i
      );

      // Match (engine.filename default is "untitled.aseprite")
      const res = engine.executeCommand("save_sprite", { expectedFilePath: "untitled.aseprite" });
      expect(res.success).toBe(true);
      expect(res.filename).toBe("untitled.aseprite");

      // Match with alternative slash normalization
      engine.filename = "C:\\path\\to\\my_sprite.aseprite";
      const resNorm = engine.executeCommand("save_sprite", { expectedFilePath: "C:/path/to/my_sprite.aseprite" });
      expect(resNorm.success).toBe(true);
    });

    it("save_sprite_as and export_png register path; second attempt without overwrite rejects and overwrite: true accepts", () => {
      const saveTarget = "test_art.aseprite";
      const resSave1 = engine.executeCommand("save_sprite_as", { filePath: saveTarget });
      expect(resSave1.success).toBe(true);
      expect(engine.mockExistingFiles.has(saveTarget)).toBe(true);

      // Second attempt without overwrite
      expect(() => engine.executeCommand("save_sprite_as", { filePath: saveTarget, overwrite: false })).toThrow(
        /File already exists and overwrite is false/i
      );

      // Second attempt with overwrite: true
      const resSave2 = engine.executeCommand("save_sprite_as", { filePath: saveTarget, overwrite: true });
      expect(resSave2.success).toBe(true);

      // export_png
      const exportTarget = "export_sheet.png";
      const resExp1 = engine.executeCommand("export_png", { outputPath: exportTarget });
      expect(resExp1.success).toBe(true);
      expect(engine.mockExistingFiles.has(exportTarget)).toBe(true);

      // Second attempt without overwrite
      expect(() => engine.executeCommand("export_png", { outputPath: exportTarget, overwrite: false })).toThrow(
        /File already exists and overwrite is false/i
      );

      // Second attempt with overwrite: true
      const resExp2 = engine.executeCommand("export_png", { outputPath: exportTarget, overwrite: true });
      expect(resExp2.success).toBe(true);
    });

    it("export_png with invalid frame or scale does not reserve path, allowing subsequent valid call to pass without overwrite", () => {
      const exportTarget = "unreserved.png";

      // Invalid frame
      expect(() =>
        engine.executeCommand("export_png", { outputPath: exportTarget, frameNumber: 999 })
      ).toThrow(/Invalid frame/i);
      expect(engine.mockExistingFiles.has(exportTarget)).toBe(false);

      // Invalid scale
      expect(() =>
        engine.executeCommand("export_png", { outputPath: exportTarget, scale: 50 })
      ).toThrow(/Invalid scale/i);
      expect(engine.mockExistingFiles.has(exportTarget)).toBe(false);

      // Subsequent valid call with overwrite: false (or omitted) must succeed because path was not reserved
      const res = engine.executeCommand("export_png", { outputPath: exportTarget });
      expect(res.success).toBe(true);
      expect(engine.mockExistingFiles.has(exportTarget)).toBe(true);
    });
  });
});
