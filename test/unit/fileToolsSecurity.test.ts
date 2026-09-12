// test/unit/fileToolsSecurity.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerFileTools } from "../../src/mcp/tools/files.js";

describe("File MCP Tools Security Seams (registerFileTools)", () => {
  let originalEnv: string | undefined;
  let createdDirs: string[] = [];
  let registeredTools: Map<string, { schema: any; handler: (params: any) => Promise<any> }>;
  let sentCommands: Array<{ command: string; params: any; timeoutMs?: number }>;
  let activeFilename: string;

  function makeTempDir(prefix = "mcp-tools-sec-"): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const real = fs.realpathSync(dir);
    createdDirs.push(real);
    return real;
  }

  beforeEach(() => {
    originalEnv = process.env.ASEPRITE_ALLOWED_PATHS;
    registeredTools = new Map();
    sentCommands = [];
    activeFilename = "untitled.aseprite";

    const fakeServer: any = {
      tool: (name: string, _desc: string, schema: any, handler: any) => {
        registeredTools.set(name, { schema, handler });
      },
    };

    const fakeDispatcher: any = {
      send: async (command: string, params: any, timeoutMs?: number) => {
        sentCommands.push({ command, params, timeoutMs });
        if (command === "aseprite_status") {
          return { hasActiveSprite: true, filename: activeFilename, revision: 1 };
        }
        return { success: true, ...params, revision: 2 };
      },
    };

    const fakeStateTracker: any = {
      setRevision: () => {},
      getRevision: () => 1,
    };

    registerFileTools(fakeServer, fakeDispatcher, fakeStateTracker);
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ASEPRITE_ALLOWED_PATHS;
    } else {
      process.env.ASEPRITE_ALLOWED_PATHS = originalEnv;
    }

    for (const dir of createdDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore cleanup error
      }
    }
    createdDirs = [];
  });

  it("open_sprite rejects relative paths and paths outside allowed root without calling dispatcher.send", async () => {
    const allowedDir = makeTempDir("mcp-allowed-");
    const outsideDir = makeTempDir("mcp-outside-");
    process.env.ASEPRITE_ALLOWED_PATHS = allowedDir;

    const outsideFile = path.join(outsideDir, "sprite.aseprite");
    fs.writeFileSync(outsideFile, "fake-content");

    const openHandler = registeredTools.get("open_sprite")!.handler;

    // Relative path
    const relRes = await openHandler({ filePath: "relative.aseprite" });
    expect(relRes.isError).toBe(true);
    expect(sentCommands.find((c) => c.command === "open_sprite")).toBeUndefined();

    // Outside path
    const outRes = await openHandler({ filePath: outsideFile });
    expect(outRes.isError).toBe(true);
    expect(sentCommands.find((c) => c.command === "open_sprite")).toBeUndefined();
  });

  it("save_sprite_as and export_png reject relative paths without calling dispatcher.send", async () => {
    const allowedDir = makeTempDir("mcp-allowed-");
    process.env.ASEPRITE_ALLOWED_PATHS = allowedDir;

    const saveAsHandler = registeredTools.get("save_sprite_as")!.handler;
    const exportHandler = registeredTools.get("export_png")!.handler;

    const saveRes = await saveAsHandler({ filePath: "out.aseprite", overwrite: false });
    expect(saveRes.isError).toBe(true);
    expect(sentCommands.find((c) => c.command === "save_sprite_as")).toBeUndefined();

    const expRes = await exportHandler({ outputPath: "out.png", overwrite: false });
    expect(expRes.isError).toBe(true);
    expect(sentCommands.find((c) => c.command === "export_png")).toBeUndefined();
  });

  it("save_sprite rejects when active sprite has no filename or filename is outside root without sending save_sprite", async () => {
    const allowedDir = makeTempDir("mcp-allowed-");
    process.env.ASEPRITE_ALLOWED_PATHS = allowedDir;

    const saveHandler = registeredTools.get("save_sprite")!.handler;

    // Active sprite has empty filename
    activeFilename = "";
    const emptyRes = await saveHandler({});
    expect(emptyRes.isError).toBe(true);
    expect(sentCommands.find((c) => c.command === "save_sprite")).toBeUndefined();

    // Active sprite has relative or outside filename
    activeFilename = "untitled.aseprite";
    const outsideRes = await saveHandler({});
    expect(outsideRes.isError).toBe(true);
    expect(sentCommands.find((c) => c.command === "save_sprite")).toBeUndefined();
  });

  it("sends canonicalized paths to dispatcher when target resides inside allowed root", async () => {
    const allowedDir = makeTempDir("mcp-allowed-");
    process.env.ASEPRITE_ALLOWED_PATHS = allowedDir;

    const validAseFile = path.join(allowedDir, "drawing.aseprite");
    fs.writeFileSync(validAseFile, "content");
    const canonicalAse = fs.realpathSync(validAseFile);

    // 1. open_sprite
    const openHandler = registeredTools.get("open_sprite")!.handler;
    const openRes = await openHandler({ filePath: validAseFile });
    expect(openRes.isError).toBeUndefined();
    const openCmd = sentCommands.find((c) => c.command === "open_sprite");
    expect(openCmd).toBeDefined();
    expect(openCmd!.params.filePath).toBe(canonicalAse);

    // 2. save_sprite_as
    const validSaveTarget = path.join(allowedDir, "new_art.aseprite");
    const saveAsHandler = registeredTools.get("save_sprite_as")!.handler;
    const saveRes = await saveAsHandler({ filePath: validSaveTarget, overwrite: false });
    expect(saveRes.isError).toBeUndefined();
    const saveCmd = sentCommands.find((c) => c.command === "save_sprite_as");
    expect(saveCmd).toBeDefined();
    expect(saveCmd!.params.filePath).toBe(validSaveTarget);
    expect(saveCmd!.params.overwrite).toBe(false);

    // 3. export_png
    const validExportTarget = path.join(allowedDir, "output.png");
    const exportHandler = registeredTools.get("export_png")!.handler;
    const exportRes = await exportHandler({ outputPath: validExportTarget, scale: 2, overwrite: false });
    expect(exportRes.isError).toBeUndefined();
    const expCmd = sentCommands.find((c) => c.command === "export_png");
    expect(expCmd).toBeDefined();
    expect(expCmd!.params.outputPath).toBe(validExportTarget);
    expect(expCmd!.params.scale).toBe(2);
    expect(expCmd!.params.overwrite).toBe(false);

    // 4. save_sprite with valid active filename
    activeFilename = canonicalAse;
    const saveHandler = registeredTools.get("save_sprite")!.handler;
    const saveSpriteRes = await saveHandler({});
    expect(saveSpriteRes.isError).toBeUndefined();
    const saveSpriteCmd = sentCommands.find((c) => c.command === "save_sprite");
    expect(saveSpriteCmd).toBeDefined();
    expect(saveSpriteCmd!.params.expectedFilePath).toBe(canonicalAse);
  });
});
