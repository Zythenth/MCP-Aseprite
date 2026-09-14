import { describe, it, expect, beforeEach } from "vitest";
import {
  MockAsepriteEngine,
  packRgba,
  unpackRgba,
  hexToRgba,
  rgbaToHex,
} from "../../src/mock/mockEngine.js";

describe("MockAsepriteEngine Unit Tests", () => {
  let engine: MockAsepriteEngine;

  beforeEach(() => {
    engine = new MockAsepriteEngine(32, 32);
  });

  it("should initialize default 32x32 document with 1 layer, 1 frame, revision 1", () => {
    const status = engine.getStatus();
    expect(status.connected).toBe(true);
    expect(status.hasActiveSprite).toBe(true);
    expect(status.width).toBe(32);
    expect(status.height).toBe(32);
    expect(status.colorMode).toBe("rgb");
    expect(status.layersCount).toBe(1);
    expect(status.framesCount).toBe(1);
    expect(status.activeLayer).toBe("Layer 1");
    expect(status.activeFrame).toBe(1);
    expect(status.revision).toBe(1);
  });

  it("should correctly pack, unpack, and convert hex colors", () => {
    const redPacked = packRgba(255, 0, 0, 255);
    expect(unpackRgba(redPacked)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(rgbaToHex(redPacked)).toBe("#FF0000FF");

    expect(hexToRgba("#FF0000FF")).toBe(redPacked);
    expect(hexToRgba("#FF0000")).toBe(redPacked);
    expect(hexToRgba("FF0000")).toBe(redPacked);

    const transparent = packRgba(0, 0, 0, 0);
    expect(rgbaToHex(transparent)).toBe("#00000000");
    expect(hexToRgba("#00000000")).toBe(transparent);
  });

  it("should paint batch of pixels and support atomic single-step undo and redo", () => {
    // 1. Paint 2x2 red block
    const redPixels = [
      { x: 0, y: 0, color: "#FF0000FF" },
      { x: 1, y: 0, color: "#FF0000FF" },
      { x: 0, y: 1, color: "#FF0000FF" },
      { x: 1, y: 1, color: "#FF0000FF" },
    ];
    const redRes = engine.executeCommand("set_pixels", { pixels: redPixels });
    expect(redRes.pixelsModified).toBe(4);
    expect(engine.revision).toBe(2);

    // Verify grid
    const gridAfterRed = engine.executeCommand("get_pixel_grid", { format: "hex" });
    expect(gridAfterRed.grid[0][0]).toBe("#FF0000FF");
    expect(gridAfterRed.grid[0][1]).toBe("#FF0000FF");
    expect(gridAfterRed.grid[1][0]).toBe("#FF0000FF");
    expect(gridAfterRed.grid[1][1]).toBe("#FF0000FF");
    expect(gridAfterRed.grid[2][2]).toBe("#00000000");

    // 2. Overwrite with 2x2 blue block
    const bluePixels = [
      { x: 0, y: 0, color: "#0000FFFF" },
      { x: 1, y: 0, color: "#0000FFFF" },
      { x: 0, y: 1, color: "#0000FFFF" },
      { x: 1, y: 1, color: "#0000FFFF" },
    ];
    const blueRes = engine.executeCommand("set_pixels", { pixels: bluePixels });
    expect(blueRes.pixelsModified).toBe(4);
    expect(engine.revision).toBe(3);

    const gridAfterBlue = engine.executeCommand("get_pixel_grid", { format: "hex" });
    expect(gridAfterBlue.grid[0][0]).toBe("#0000FFFF");
    expect(gridAfterBlue.grid[1][1]).toBe("#0000FFFF");

    // 3. Undo blue block -> must revert to red state in one step
    const undoRes = engine.executeCommand("undo", {});
    expect(undoRes.success).toBe(true);
    expect(engine.revision).toBe(4);

    const gridAfterUndo = engine.executeCommand("get_pixel_grid", { format: "hex" });
    expect(gridAfterUndo.grid[0][0]).toBe("#FF0000FF");
    expect(gridAfterUndo.grid[0][1]).toBe("#FF0000FF");
    expect(gridAfterUndo.grid[1][0]).toBe("#FF0000FF");
    expect(gridAfterUndo.grid[1][1]).toBe("#FF0000FF");

    // 4. Redo blue block
    const redoRes = engine.executeCommand("redo", {});
    expect(redoRes.success).toBe(true);
    expect(engine.revision).toBe(5);

    const gridAfterRedo = engine.executeCommand("get_pixel_grid", { format: "hex" });
    expect(gridAfterRedo.grid[0][0]).toBe("#0000FFFF");
  });

  it("should generate valid Base64 PNG image containing PNG magic signature", () => {
    const b64 = engine.exportFramePngBase64(1);
    expect(typeof b64).toBe("string");
    expect(b64.length).toBeGreaterThan(0);

    const buffer = Buffer.from(b64, "base64");
    // Standard PNG signature bytes: 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
    expect(buffer[0]).toBe(0x89);
    expect(buffer[1]).toBe(0x50); // P
    expect(buffer[2]).toBe(0x4E); // N
    expect(buffer[3]).toBe(0x47); // G
  });

  it("should support get_pixel_grid in hex, rgba, and compact formats", () => {
    engine.executeCommand("set_pixel", { x: 5, y: 5, color: "#11223344" });

    const hexGrid = engine.executeCommand("get_pixel_grid", { format: "hex" });
    expect(hexGrid.format).toBe("hex");
    expect(hexGrid.grid[5][5]).toBe("#11223344");

    const rgbaGrid = engine.executeCommand("get_pixel_grid", { format: "rgba" });
    expect(rgbaGrid.format).toBe("rgba");
    expect(rgbaGrid.grid[5][5]).toEqual({ r: 0x11, g: 0x22, b: 0x33, a: 0x44 });

    const compactGrid = engine.executeCommand("get_pixel_grid", { format: "compact" });
    expect(compactGrid.format).toBe("compact");
    expect(Array.isArray(compactGrid.palette)).toBe(true);
    expect(typeof compactGrid.grid[5][5]).toBe("number");
  });

  it("should return cel metadata on non-group layers in inspect_animation", () => {
    const inspection = engine.executeCommand("inspect_animation", {});
    expect(inspection.success).toBe(true);
    expect(Array.isArray(inspection.layers)).toBe(true);
    expect(inspection.layers.length).toBeGreaterThan(0);
    const layer = inspection.layers[0];
    expect(Array.isArray(layer.cels)).toBe(true);
    expect(layer.cels.length).toBe(1);
    expect(layer.cels[0]).toMatchObject({
      frameNumber: 1,
      x: 0,
      y: 0,
      bounds: { x: 0, y: 0, width: 32, height: 32 },
      position: { x: 0, y: 0 },
    });
  });
});