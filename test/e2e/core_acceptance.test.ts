/**
 * Mandatory Core E2E Acceptance Flow Test Suite.
 * Validates the strict 9-step acceptance flow:
 *
 * 1. Connect MCP to Mock Bridge
 * 2. Create 32x32 sprite (new_sprite)
 * 3. Inspect PNG preview (inspect_sprite / get_canvas)
 * 4. Read pixel grid (get_pixel_grid)
 * 5. Batch paint red block (set_pixels)
 * 6. Confirm red state visually & numerically
 * 7. Batch paint blue block (set_pixels)
 * 8. Confirm blue state visually & numerically
 * 9. Atomic undo (undo) -> verify exact return to red state
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  TestHarness,
  assertToolSuccess,
  assertToolError,
  extractTextContent,
  extractImageContent,
  parsePngDimensions,
  assertPixelInGrid,
  assertRectInGrid,
  type PixelGridResult,
  type SpriteStatus,
  type Pixel,
} from "../harness/index.js";

describe("Mandatory Core E2E Acceptance Flow", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = new TestHarness();
    await harness.setup();
  });

  afterEach(async () => {
    await harness.teardown();
  });

  it("executes the complete 9-step core visual editing & atomic undo acceptance flow", async () => {
    // -------------------------------------------------------------------------
    // Step 1: Connect MCP to Bridge
    // -------------------------------------------------------------------------
    const statusRes = await harness.callTool("aseprite_status");
    assertToolSuccess(statusRes);
    const status = extractTextContent<SpriteStatus>(statusRes);
    expect(status.connected).toBe(true);

    // -------------------------------------------------------------------------
    // Step 2: Create 32x32 sprite (new_sprite)
    // -------------------------------------------------------------------------
    const createRes = await harness.callTool("new_sprite", {
      width: 32,
      height: 32,
      colorMode: "rgb",
    });
    assertToolSuccess(createRes);
    const createData = extractTextContent<any>(createRes);
    expect(createData.success).toBe(true);
    expect(createData.width).toBe(32);
    expect(createData.height).toBe(32);
    expect(createData.revision).toBe(1);

    // Verify status reflects the newly created sprite
    const statusAfterCreate = extractTextContent<SpriteStatus>(
      await harness.callTool("aseprite_status")
    );
    expect(statusAfterCreate.width).toBe(32);
    expect(statusAfterCreate.height).toBe(32);
    expect(statusAfterCreate.revision).toBe(1);

    // -------------------------------------------------------------------------
    // Step 3: Inspect PNG preview via inspect_sprite and get_canvas
    // -------------------------------------------------------------------------
    const inspectRes = await harness.callTool("inspect_sprite", { scale: 1 });
    assertToolSuccess(inspectRes);

    const inspectImg = extractImageContent(inspectRes);
    expect(inspectImg.mimeType).toBe("image/png");
    const inspectDims = parsePngDimensions(inspectImg.buffer);
    expect(inspectDims.width).toBe(32);
    expect(inspectDims.height).toBe(32);

    const inspectMeta = extractTextContent<any>(inspectRes);
    expect(inspectMeta.width).toBe(32);
    expect(inspectMeta.height).toBe(32);
    expect(inspectMeta.revision).toBe(1);

    // Test get_canvas with nearest-neighbor 8x scaling (32x32 -> 256x256)
    const canvasRes = await harness.callTool("get_canvas", { scale: 8 });
    assertToolSuccess(canvasRes);
    const canvasImg = extractImageContent(canvasRes);
    const canvasDims = parsePngDimensions(canvasImg.buffer);
    expect(canvasDims.width).toBe(256);
    expect(canvasDims.height).toBe(256);

    // -------------------------------------------------------------------------
    // Step 4: Read pixel grid via get_pixel_grid
    // -------------------------------------------------------------------------
    const gridRes = await harness.callTool("get_pixel_grid", { format: "hex" });
    assertToolSuccess(gridRes);
    const initialGrid = extractTextContent<PixelGridResult>(gridRes);
    expect(initialGrid.width).toBe(32);
    expect(initialGrid.height).toBe(32);

    // Confirm all 32x32 pixels are initially transparent (#00000000)
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        assertPixelInGrid(initialGrid, x, y, "#00000000");
      }
    }

    // -------------------------------------------------------------------------
    // Step 5: Batch paint red block (8x8 from (4,4) to (11,11)) with set_pixels
    // -------------------------------------------------------------------------
    const redPixels: Pixel[] = [];
    for (let y = 4; y <= 11; y++) {
      for (let x = 4; x <= 11; x++) {
        redPixels.push({ x, y, color: "#FF0000FF" });
      }
    }
    expect(redPixels.length).toBe(64);

    const paintRedRes = await harness.callTool("set_pixels", {
      pixels: redPixels,
      returnPreview: true,
    });
    assertToolSuccess(paintRedRes);

    const paintRedData = extractTextContent<any>(paintRedRes);
    expect(paintRedData.success).toBe(true);
    expect(paintRedData.pixelsModified).toBe(64);
    expect(paintRedData.bounds).toEqual({ x: 4, y: 4, width: 8, height: 8 });
    expect(paintRedData.revision).toBe(2);

    // Verify preview returned in the same call
    const redPreviewImg = extractImageContent(paintRedRes);
    const redPreviewDims = parsePngDimensions(redPreviewImg.buffer);
    expect(redPreviewDims.width).toBe(32);
    expect(redPreviewDims.height).toBe(32);

    // -------------------------------------------------------------------------
    // Step 6: Confirm red state visually and numerically
    // -------------------------------------------------------------------------
    const redGridRes = await harness.callTool("get_pixel_grid", { format: "hex" });
    assertToolSuccess(redGridRes);
    const redGrid = extractTextContent<PixelGridResult>(redGridRes);

    // Assert all 64 coordinates in the 8x8 block are #FF0000FF
    assertRectInGrid(redGrid, { x: 4, y: 4, width: 8, height: 8 }, "#FF0000FF");

    // Assert perimeter pixels remain transparent
    assertPixelInGrid(redGrid, 0, 0, "#00000000");
    assertPixelInGrid(redGrid, 3, 4, "#00000000");
    assertPixelInGrid(redGrid, 12, 11, "#00000000");
    assertPixelInGrid(redGrid, 31, 31, "#00000000");

    // Save snapshot of the confirmed red state grid for exact comparison later
    const redStateSnapshot = JSON.parse(JSON.stringify(redGrid.pixels));

    // -------------------------------------------------------------------------
    // Step 7: Batch paint blue block (4x4 sub-block from (6,6) to (9,9))
    // -------------------------------------------------------------------------
    const bluePixels: Pixel[] = [];
    for (let y = 6; y <= 9; y++) {
      for (let x = 6; x <= 9; x++) {
        bluePixels.push({ x, y, color: "#0000FFFF" });
      }
    }
    expect(bluePixels.length).toBe(16);

    const paintBlueRes = await harness.callTool("set_pixels", {
      pixels: bluePixels,
      returnPreview: true,
    });
    assertToolSuccess(paintBlueRes);

    const paintBlueData = extractTextContent<any>(paintBlueRes);
    expect(paintBlueData.success).toBe(true);
    expect(paintBlueData.pixelsModified).toBe(16);
    expect(paintBlueData.bounds).toEqual({ x: 6, y: 6, width: 4, height: 4 });
    expect(paintBlueData.revision).toBe(3);

    // -------------------------------------------------------------------------
    // Step 8: Confirm blue state visually and numerically
    // -------------------------------------------------------------------------
    const blueGridRes = await harness.callTool("get_pixel_grid", { format: "hex" });
    assertToolSuccess(blueGridRes);
    const blueGrid = extractTextContent<PixelGridResult>(blueGridRes);

    // Verify 4x4 inner block is blue
    assertRectInGrid(blueGrid, { x: 6, y: 6, width: 4, height: 4 }, "#0000FFFF");

    // Verify surrounding red border pixels remain red
    assertPixelInGrid(blueGrid, 4, 4, "#FF0000FF");
    assertPixelInGrid(blueGrid, 5, 5, "#FF0000FF");
    assertPixelInGrid(blueGrid, 10, 10, "#FF0000FF");
    assertPixelInGrid(blueGrid, 11, 11, "#FF0000FF");

    // Verify canvas background remains transparent
    assertPixelInGrid(blueGrid, 0, 0, "#00000000");
    assertPixelInGrid(blueGrid, 31, 31, "#00000000");

    // Visual inspection verification
    const blueInspectRes = await harness.callTool("inspect_sprite");
    const blueInspectImg = extractImageContent(blueInspectRes);
    expect(blueInspectImg.buffer.length).toBeGreaterThan(0);

    // -------------------------------------------------------------------------
    // Step 9: Atomic undo -> verify exact return to red state
    // -------------------------------------------------------------------------
    const undoRes = await harness.callTool("undo");
    assertToolSuccess(undoRes);
    const undoData = extractTextContent<any>(undoRes);
    expect(undoData.success).toBe(true);
    expect(undoData.restoredRevision).toBe(2);

    // Read back pixel grid and verify it is 100% pixel-for-pixel identical to red state
    const restoredGridRes = await harness.callTool("get_pixel_grid", { format: "hex" });
    assertToolSuccess(restoredGridRes);
    const restoredGrid = extractTextContent<PixelGridResult>(restoredGridRes);

    // Numerical assertion: every coordinate in the inner sub-block reverted to red
    assertRectInGrid(restoredGrid, { x: 6, y: 6, width: 4, height: 4 }, "#FF0000FF");
    assertRectInGrid(restoredGrid, { x: 4, y: 4, width: 8, height: 8 }, "#FF0000FF");

    // Full 32x32 matrix match against saved Step 6 snapshot
    expect(restoredGrid.pixels).toEqual(redStateSnapshot);

    // Final visual verification: inspect_sprite produces valid PNG of restored state
    const finalInspectRes = await harness.callTool("inspect_sprite");
    assertToolSuccess(finalInspectRes);
    const finalImg = extractImageContent(finalInspectRes);
    expect(finalImg.buffer.length).toBeGreaterThan(0);
  });

  it("handles single-step redo re-applying undone batch painting exactly", async () => {
    // Setup 16x16 sprite
    await harness.callTool("new_sprite", { width: 16, height: 16 });

    // Paint pixel at (2, 2) green
    await harness.callTool("set_pixel", { x: 2, y: 2, color: "#00FF00FF" });

    let grid = extractTextContent<PixelGridResult>(await harness.callTool("get_pixel_grid"));
    assertPixelInGrid(grid, 2, 2, "#00FF00FF");

    // Undo
    await harness.callTool("undo");
    grid = extractTextContent<PixelGridResult>(await harness.callTool("get_pixel_grid"));
    assertPixelInGrid(grid, 2, 2, "#00000000");

    // Redo
    const redoRes = await harness.callTool("redo");
    assertToolSuccess(redoRes);
    grid = extractTextContent<PixelGridResult>(await harness.callTool("get_pixel_grid"));
    assertPixelInGrid(grid, 2, 2, "#00FF00FF");
  });
});
