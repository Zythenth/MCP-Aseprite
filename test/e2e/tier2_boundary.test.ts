/**
 * Tier 2: Boundary & Corner Cases Test Suite.
 * Validates >= 5 boundary cases per category:
 *
 * 1. Coordinates & Bounds (out-of-bounds, zero/extreme dimensions, 1x1 edge case)
 * 2. Colors & Alpha (#00000000 preservation, semi-alpha, malformed hex, shorthands, case normalization)
 * 3. Layer Deletion & Locks (mandatory confirmation, last layer guard, locked layers, hidden layers)
 * 4. Frame Deletion & Animation Ranges (confirmation guard, last frame guard, duration bounds, tag ranges)
 * 5. Undo/Redo Extremes (empty stack rejection, multi-undo sequence, redo stack invalidation, resize undo)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  TestHarness,
  assertToolSuccess,
  assertToolError,
  extractTextContent,
  assertPixelInGrid,
  type PixelGridResult,
  type SpriteStatus,
} from "../harness/index.js";

describe("Tier 2: Boundary & Corner Cases", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = new TestHarness();
    await harness.setup();
    await harness.callTool("new_sprite", { width: 16, height: 16 });
  });

  afterEach(async () => {
    await harness.teardown();
  });

  // ===========================================================================
  // Boundary Category 1: Coordinates & Bounds - 5 Cases
  // ===========================================================================
  describe("Category 1: Coordinates & Bounds", () => {
    it("Case 1: rejects negative coordinates with OUT_OF_BOUNDS", async () => {
      const res = await harness.callTool("set_pixels", {
        pixels: [{ x: -1, y: 5, color: "#FF0000FF" }],
      });
      assertToolError(res, "OUT_OF_BOUNDS");
    });

    it("Case 2: boundary coordinate (width-1, height-1) succeeds, while (width, height) is rejected", async () => {
      // Max boundary on 16x16: (15, 15) must succeed
      const okRes = await harness.callTool("set_pixel", { x: 15, y: 15, color: "#00FF00FF" });
      assertToolSuccess(okRes);

      // (16, 16) is out of bounds
      const failRes = await harness.callTool("set_pixel", { x: 16, y: 16, color: "#00FF00FF" });
      assertToolError(failRes, "OUT_OF_BOUNDS");
    });

    it("Case 3: rejects zero dimensions for shapes with INVALID_DIMENSIONS", async () => {
      const resZeroW = await harness.callTool("draw_rectangle", {
        x: 2, y: 2, width: 0, height: 5, color: "#FF0000FF",
      });
      assertToolError(resZeroW, "INVALID_DIMENSIONS");

      const resZeroH = await harness.callTool("draw_rectangle", {
        x: 2, y: 2, width: 5, height: 0, color: "#FF0000FF",
      });
      assertToolError(resZeroH, "INVALID_DIMENSIONS");
    });

    it("Case 4: operates on 1x1 canvas without division-by-zero or crashes", async () => {
      const createRes = await harness.callTool("new_sprite", { width: 1, height: 1 });
      assertToolSuccess(createRes);

      const paintRes = await harness.callTool("set_pixel", { x: 0, y: 0, color: "#AABBCCFF" });
      assertToolSuccess(paintRes);

      const gridRes = await harness.callTool("get_pixel_grid");
      assertToolSuccess(gridRes);
      const grid = extractTextContent<PixelGridResult>(gridRes);
      assertPixelInGrid(grid, 0, 0, "#AABBCCFF");

      const undoRes = await harness.callTool("undo");
      assertToolSuccess(undoRes);
    });

    it("Case 5: validates max dimension limits (4096 boundary)", async () => {
      const validMax = await harness.callTool("new_sprite", { width: 4096, height: 1 });
      assertToolSuccess(validMax);

      const overLimit = await harness.callTool("new_sprite", { width: 4097, height: 1 });
      assertToolError(overLimit, "INVALID_DIMENSIONS");
    });
  });

  // ===========================================================================
  // Boundary Category 2: Colors & Alpha - 5 Cases
  // ===========================================================================
  describe("Category 2: Colors & Alpha", () => {
    it("Case 1: preserves full transparent alpha #00000000 exactly without converting to black", async () => {
      // First paint solid color
      await harness.callTool("set_pixel", { x: 4, y: 4, color: "#FF0000FF" });
      let grid = extractTextContent<PixelGridResult>(await harness.callTool("get_pixel_grid"));
      assertPixelInGrid(grid, 4, 4, "#FF0000FF");

      // Now set back to #00000000
      const eraseRes = await harness.callTool("set_pixel", { x: 4, y: 4, color: "#00000000" });
      assertToolSuccess(eraseRes);
      grid = extractTextContent<PixelGridResult>(await harness.callTool("get_pixel_grid"));
      assertPixelInGrid(grid, 4, 4, "#00000000");
    });

    it("Case 2: handles semi-transparent alpha #FF00007F correctly", async () => {
      const res = await harness.callTool("set_pixel", { x: 5, y: 5, color: "#FF00007F" });
      assertToolSuccess(res);
      const grid = extractTextContent<PixelGridResult>(await harness.callTool("get_pixel_grid"));
      assertPixelInGrid(grid, 5, 5, "#FF00007F");
    });

    it("Case 3: rejects malformed hex color strings", async () => {
      const res = await harness.callTool("set_pixel", { x: 1, y: 1, color: "#ZZTOP" });
      assertToolError(res);
    });

    it("Case 4: normalizes 3-char and 4-char shorthand hex colors to #RRGGBBAA", async () => {
      // #F00 -> #FF0000FF
      await harness.callTool("set_pixel", { x: 1, y: 1, color: "#F00" });
      let grid = extractTextContent<PixelGridResult>(await harness.callTool("get_pixel_grid"));
      assertPixelInGrid(grid, 1, 1, "#FF0000FF");

      // #0F08 -> #00FF0088
      await harness.callTool("set_pixel", { x: 2, y: 2, color: "#0F08" });
      grid = extractTextContent<PixelGridResult>(await harness.callTool("get_pixel_grid"));
      assertPixelInGrid(grid, 2, 2, "#00FF0088");
    });

    it("Case 5: treats lowercase and uppercase hex strings identically", async () => {
      await harness.callTool("set_pixel", { x: 3, y: 3, color: "#aabbccdd" });
      const grid = extractTextContent<PixelGridResult>(await harness.callTool("get_pixel_grid"));
      assertPixelInGrid(grid, 3, 3, "#AABBCCDD");
    });
  });

  // ===========================================================================
  // Boundary Category 3: Layer Deletion & Locks - 5 Cases
  // ===========================================================================
  describe("Category 3: Layer Deletion & Locks", () => {
    it("Case 1: rejects layer deletion without confirm: true with CONFIRMATION_REQUIRED", async () => {
      await harness.callTool("create_layer", { name: "ExtraLayer" });
      const res = await harness.callTool("delete_layer", { layer: "ExtraLayer" }); // missing confirm: true
      assertToolError(res, "CONFIRMATION_REQUIRED");
    });

    it("Case 2: rejects deleting the last remaining layer with CANNOT_DELETE_LAST_LAYER", async () => {
      const res = await harness.callTool("delete_layer", { layer: 0, confirm: true });
      assertToolError(res, "CANNOT_DELETE_LAST_LAYER");
    });

    it("Case 3: rejects painting on a locked layer with LAYER_LOCKED", async () => {
      // Mock layer lock
      const listRes = await harness.callTool("list_layers");
      const listData = extractTextContent<any>(listRes);
      harness.setLayerLocked(listData.layers[0].index, true);

      const paintRes = await harness.callTool("set_pixel", { x: 2, y: 2, color: "#FF0000FF" });
      assertToolError(paintRes, "LAYER_LOCKED");
    });

    it("Case 4: updates cel on hidden layer without displaying on composite render", async () => {
      await harness.callTool("create_layer", { name: "HiddenLayer" });
      await harness.callTool("set_layer_visibility", { layer: "HiddenLayer", visible: false });

      // Painting on hidden layer succeeds
      const paintRes = await harness.callTool("set_pixel", { x: 6, y: 6, color: "#00FF00FF" });
      assertToolSuccess(paintRes);

      // Hidden layer's own cel was actually updated
      const celGrid = extractTextContent<PixelGridResult>(await harness.callTool("get_pixel_grid", { layerName: "HiddenLayer" }));
      assertPixelInGrid(celGrid, 6, 6, "#00FF00FF");

      // But composite render omits it (remains transparent)
      const inspect = extractTextContent<any>(await harness.callTool("inspect_sprite"));
      assertPixelInGrid(inspect.pixelGrid, 6, 6, "#00000000");
    });

    it("Case 5: rejects deleting a non-existent layer with LAYER_NOT_FOUND", async () => {
      await harness.callTool("create_layer", { name: "ValidLayer" });
      const res = await harness.callTool("delete_layer", { layer: "NonExistentLayer", confirm: true });
      assertToolError(res, "LAYER_NOT_FOUND");
    });
  });

  // ===========================================================================
  // Boundary Category 4: Frame Deletion & Animation Ranges - 5 Cases
  // ===========================================================================
  describe("Category 4: Frame Deletion & Animation Ranges", () => {
    it("Case 1: rejects frame deletion without confirm: true with CONFIRMATION_REQUIRED", async () => {
      await harness.callTool("create_frame", {});
      const res = await harness.callTool("delete_frame", { frameNumber: 2 });
      assertToolError(res, "CONFIRMATION_REQUIRED");
    });

    it("Case 2: rejects deleting the only remaining frame with CANNOT_DELETE_LAST_FRAME", async () => {
      const res = await harness.callTool("delete_frame", { frameNumber: 1, confirm: true });
      assertToolError(res, "CANNOT_DELETE_LAST_FRAME");
    });

    it("Case 3: rejects zero or negative frame duration with INVALID_ARGUMENT", async () => {
      const resZero = await harness.callTool("set_frame_duration", { frameNumber: 1, durationMs: 0 });
      assertToolError(resZero, "INVALID_ARGUMENT");

      const resNegative = await harness.callTool("set_frame_duration", { frameNumber: 1, durationMs: -50 });
      assertToolError(resNegative, "INVALID_ARGUMENT");
    });

    it("Case 4: rejects animation tag creation where fromFrame > toFrame with INVALID_TAG_RANGE", async () => {
      await harness.callTool("create_frame", {});
      const res = await harness.callTool("create_tag", {
        name: "invalid_walk", fromFrame: 2, toFrame: 1,
      });
      assertToolError(res, "INVALID_TAG_RANGE");
    });

    it("Case 5: rejects animation tag referencing non-existent frame with FRAME_OUT_OF_RANGE", async () => {
      const res = await harness.callTool("create_tag", {
        name: "out_of_range", fromFrame: 1, toFrame: 99,
      });
      assertToolError(res, "FRAME_OUT_OF_RANGE");
    });
  });

  // ===========================================================================
  // Boundary Category 5: Undo / Redo Extremes - 5 Cases
  // ===========================================================================
  describe("Category 5: Undo / Redo Extremes", () => {
    it("Case 1: calling undo on a pristine sprite returns clean error NO_UNDO_TRANSACTIONS", async () => {
      const res = await harness.callTool("undo");
      assertToolError(res, "NO_UNDO_TRANSACTIONS");
    });

    it("Case 2: calling redo on an empty redo stack returns clean error NO_REDO_TRANSACTIONS", async () => {
      const res = await harness.callTool("redo");
      assertToolError(res, "NO_REDO_TRANSACTIONS");
    });

    it("Case 3: reverts multiple sequential edits (10 operations) in exact reverse order", async () => {
      for (let i = 0; i < 10; i++) {
        await harness.callTool("set_pixel", { x: i, y: 0, color: "#FF0000FF" });
      }

      // Undo all 10 in sequence
      for (let i = 9; i >= 0; i--) {
        const undoRes = await harness.callTool("undo");
        assertToolSuccess(undoRes);
        const grid = extractTextContent<PixelGridResult>(await harness.callTool("get_pixel_grid"));
        assertPixelInGrid(grid, i, 0, "#00000000");
      }

      // Final undo should fail cleanly
      const finalUndo = await harness.callTool("undo");
      assertToolError(finalUndo, "NO_UNDO_TRANSACTIONS");
    });

    it("Case 4: new drawing operation after undo completely purges the redo stack", async () => {
      await harness.callTool("set_pixel", { x: 2, y: 2, color: "#111111FF" });
      await harness.callTool("undo");

      // Perform a new drawing operation
      await harness.callTool("set_pixel", { x: 3, y: 3, color: "#222222FF" });

      // Redo should now be empty and fail
      const redoRes = await harness.callTool("redo");
      assertToolError(redoRes, "NO_REDO_TRANSACTIONS");
    });

    it("Case 5: undo of resize_canvas restores original canvas dimensions", async () => {
      const origStatus = extractTextContent<SpriteStatus>(await harness.callTool("aseprite_status"));
      expect(origStatus.width).toBe(16);
      expect(origStatus.height).toBe(16);

      // Resize to 32x32
      await harness.callTool("resize_canvas", { width: 32, height: 32 });
      let status = extractTextContent<SpriteStatus>(await harness.callTool("aseprite_status"));
      expect(status.width).toBe(32);
      expect(status.height).toBe(32);

      // Undo resize
      const undoRes = await harness.callTool("undo");
      assertToolSuccess(undoRes);

      status = extractTextContent<SpriteStatus>(await harness.callTool("aseprite_status"));
      expect(status.width).toBe(16);
      expect(status.height).toBe(16);
    });
  });
});
