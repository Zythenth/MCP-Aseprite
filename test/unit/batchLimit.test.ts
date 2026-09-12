import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { MockAsepriteEngine } from "../../src/mock/mockEngine.js";
import { TestHarness } from "../harness/mockBridgeHarness.js";
import { MAX_PIXELS_BATCH } from "../../src/config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = fs.existsSync(path.resolve(__dirname, "../../src"))
  ? path.resolve(__dirname, "../../")
  : process.cwd();

describe("Batch Limit Unit Tests (MAX_PIXELS_BATCH = 100,000)", () => {
  it("config defines MAX_PIXELS_BATCH as 100000", () => {
    expect(MAX_PIXELS_BATCH).toBe(100000);
  });

  describe("MockAsepriteEngine batch limit enforcement", () => {
    it("accepts exactly 100,000 pixels in set_pixels without allocating large canvas", () => {
      const engine = new MockAsepriteEngine(16, 16);
      const singlePixel = { x: 0, y: 0, color: "#FF0000FF" };
      const batch100k = new Array(100000).fill(singlePixel);

      const res = engine.executeCommand("set_pixels", { pixels: batch100k });
      expect(res.pixelsModified).toBe(1);
      expect(engine.revision).toBe(2);
    });

    it("rejects 100,001 pixels in set_pixels", () => {
      const engine = new MockAsepriteEngine(16, 16);
      const singlePixel = { x: 0, y: 0, color: "#FF0000FF" };
      const batch100kPlus1 = new Array(100001).fill(singlePixel);

      expect(() => {
        engine.executeCommand("set_pixels", { pixels: batch100kPlus1 });
      }).toThrow(/Pixel batch size exceeds maximum allowed/);
    });

    it("accepts exactly 100,000 points in erase_pixels", () => {
      const engine = new MockAsepriteEngine(16, 16);
      const singlePoint = { x: 0, y: 0 };
      const batch100k = new Array(100000).fill(singlePoint);

      const res = engine.executeCommand("erase_pixels", { points: batch100k });
      expect(res).toBeDefined();
    });

    it("rejects 100,001 points in erase_pixels", () => {
      const engine = new MockAsepriteEngine(16, 16);
      const singlePoint = { x: 0, y: 0 };
      const batch100kPlus1 = new Array(100001).fill(singlePoint);

      expect(() => {
        engine.executeCommand("erase_pixels", { points: batch100kPlus1 });
      }).toThrow(/Points batch size exceeds maximum allowed/);
    });
  });

  describe("TestHarness batch limit enforcement", () => {
    it("accepts exactly 100,000 pixels in set_pixels", async () => {
      const harness = new TestHarness();
      await harness.setup();
      const singlePixel = { x: 0, y: 0, color: "#FF0000FF" };
      const batch100k = new Array(100000).fill(singlePixel);

      const res = await harness.callTool("set_pixels", { pixels: batch100k });
      expect(res.isError).toBeFalsy();
      await harness.teardown();
    });

    it("rejects 100,001 pixels in set_pixels", async () => {
      const harness = new TestHarness();
      await harness.setup();
      const singlePixel = { x: 0, y: 0, color: "#FF0000FF" };
      const batch100kPlus1 = new Array(100001).fill(singlePixel);

      const res = await harness.callTool("set_pixels", { pixels: batch100kPlus1 });
      expect(res.isError).toBe(true);
      const parsed = JSON.parse((res.content[0] as any).text);
      expect(parsed.code).toBe("BATCH_TOO_LARGE");
      await harness.teardown();
    });

    it("accepts exactly 100,000 points in erase_pixels", async () => {
      const harness = new TestHarness();
      await harness.setup();
      const singlePoint = { x: 0, y: 0 };
      const batch100k = new Array(100000).fill(singlePoint);

      const res = await harness.callTool("erase_pixels", { points: batch100k });
      expect(res.isError).toBeFalsy();
      await harness.teardown();
    });

    it("rejects 100,001 points in erase_pixels", async () => {
      const harness = new TestHarness();
      await harness.setup();
      const singlePoint = { x: 0, y: 0 };
      const batch100kPlus1 = new Array(100001).fill(singlePoint);

      const res = await harness.callTool("erase_pixels", { points: batch100kPlus1 });
      expect(res.isError).toBe(true);
      const parsed = JSON.parse((res.content[0] as any).text);
      expect(parsed.code).toBe("BATCH_TOO_LARGE");
      await harness.teardown();
    });
  });

  describe("Declarative batch limit checks", () => {
    it("validates lua bridge declares MAX_PIXELS_BATCH and validates count before transaction", () => {
      const luaPath = path.resolve(rootDir, "lua/aseprite-bridge.lua");
      const luaSrc = fs.readFileSync(luaPath, "utf-8");
      expect(luaSrc).toMatch(/local\s+MAX_PIXELS_BATCH\s*=\s*100000/);
      expect(luaSrc).toMatch(/#pixels\s*>\s*MAX_PIXELS_BATCH/);

      const checkIndex = luaSrc.indexOf("#pixels > MAX_PIXELS_BATCH");
      const txIndex = luaSrc.indexOf('app.transaction("MCP: set_pixels"');
      expect(checkIndex).toBeGreaterThan(-1);
      expect(txIndex).toBeGreaterThan(-1);
      expect(checkIndex).toBeLessThan(txIndex);

      expect(luaSrc).toMatch(/#params\.points\s*>\s*MAX_PIXELS_BATCH/);
      const eraseCheckIndex = luaSrc.indexOf("#params.points > MAX_PIXELS_BATCH");
      const eraseLoopIndex = luaSrc.indexOf("for _, pt in ipairs");
      expect(eraseCheckIndex).toBeGreaterThan(-1);
      expect(eraseLoopIndex).toBeGreaterThan(-1);
      expect(eraseCheckIndex).toBeLessThan(eraseLoopIndex);
    });

    it("validates editing.ts tool schemas constrain set_pixels and erase_pixels arrays", () => {
      const editingPath = path.resolve(rootDir, "src/mcp/tools/editing.ts");
      const editingSrc = fs.readFileSync(editingPath, "utf-8");
      expect(editingSrc).toMatch(/import\s*{[^}]*MAX_PIXELS_BATCH[^}]*}\s*from/);
      expect(editingSrc).toMatch(/pixels:\s*z\.array[\s\S]*?\.max\(MAX_PIXELS_BATCH\)/);
      expect(editingSrc).toMatch(/points:\s*z\.array[\s\S]*?\.max\(MAX_PIXELS_BATCH\)/);
    });
  });
});
