import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { encodeRgbaToPngBuffer } from "../../src/image/png.js";
import { registerFileTools } from "../../src/mcp/tools/files.js";
import { resolveProjectPath } from "../../src/security/fileAccess.js";

type RegisteredTool = { handler: (params: any) => Promise<any> };

function parseText(result: any): any {
  const text = result.content.find((entry: any) => entry.type === "text")?.text;
  return JSON.parse(text);
}

describe("reference discovery, loading, and project saving", () => {
  let root: string;
  let outside: string;
  let originalAllowed: string | undefined;
  let originalProjectRoot: string | undefined;
  let tools: Map<string, RegisteredTool>;
  let commands: Array<{ command: string; params: any }>;

  const writePng = (filePath: string, pixels?: number[]): void => {
    const rgba = Uint8Array.from(pixels ?? [255, 0, 0, 255, 0, 0, 0, 0]);
    fs.writeFileSync(filePath, encodeRgbaToPngBuffer(rgba, 2, 1));
  };

  beforeEach(() => {
    originalAllowed = process.env.ASEPRITE_ALLOWED_PATHS;
    originalProjectRoot = process.env.ASEPRITE_PROJECT_ROOT;
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mcp-reference-root-")));
    outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mcp-reference-outside-")));
    process.env.ASEPRITE_ALLOWED_PATHS = root;
    process.env.ASEPRITE_PROJECT_ROOT = root;
    tools = new Map();
    commands = [];
    const server: any = {
      tool: (name: string, _description: string, _schema: unknown, handler: RegisteredTool["handler"]) => {
        tools.set(name, { handler });
      },
    };
    const dispatcher: any = {
      send: async (command: string, params: any) => {
        commands.push({ command, params });
        if (command === "aseprite_status") return { filename: path.join(root, "hero.aseprite") };
        if (command === "list_tags") return { tags: [{ name: "Walk Left" }] };
        return { success: true, ...params };
      },
    };
    registerFileTools(server, dispatcher, {
      setRevision: () => {},
      getRevision: () => 1,
      getCapabilities: () => ({ referenceImageDecode: true }),
    } as any);
  });

  afterEach(() => {
    if (originalAllowed === undefined) delete process.env.ASEPRITE_ALLOWED_PATHS;
    else process.env.ASEPRITE_ALLOWED_PATHS = originalAllowed;
    if (originalProjectRoot === undefined) delete process.env.ASEPRITE_PROJECT_ROOT;
    else process.env.ASEPRITE_PROJECT_ROOT = originalProjectRoot;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("finds exact reference names deterministically within explicit bounded directories", async () => {
    const references = path.join(root, "references");
    const nested = path.join(references, "nested");
    fs.mkdirSync(nested, { recursive: true });
    writePng(path.join(references, "other.png"));
    writePng(path.join(nested, "hero.png"));
    fs.writeFileSync(path.join(nested, "hero.txt"), "not an image");

    const result = await tools.get("find_reference_images")!.handler({
      directory: "references",
      fileName: "hero.png",
      recursive: true,
      maxDepth: 4,
      maxResults: 10,
    });
    const metadata = parseText(result);
    expect(result.isError).toBeUndefined();
    expect(metadata.count).toBe(1);
    expect(metadata.images[0]).toMatchObject({
      fileName: "hero.png",
      projectRelativePath: "references/nested/hero.png",
      relativeToSearchDirectory: "nested/hero.png",
      format: "png",
    });
    expect(commands).toEqual([]);
  });

  it("does not traverse directory links and rejects a missing target beneath an escaping link", async () => {
    const link = path.join(root, "escape");
    try {
      fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
    } catch (error: any) {
      if (error.code === "EPERM") return;
      throw error;
    }

    expect(() => resolveProjectPath(path.join("escape", "missing.png"), [root], root)).toThrow(/outside allowed roots/i);
    const result = await tools.get("find_reference_images")!.handler({
      recursive: true,
      maxDepth: 8,
      maxResults: 100,
    });
    const metadata = parseText(result);
    expect(metadata.images).toEqual([]);
    expect(metadata.skipped).toEqual([expect.objectContaining({ error: "symbolic links are not traversed" })]);
  });

  it("loads a PNG reference without changing Aseprite and returns transparency and palette metadata", async () => {
    const reference = path.join(root, "hero.png");
    writePng(reference);

    const result = await tools.get("load_reference_image")!.handler({
      fileName: "hero.png",
      nearDuplicateThreshold: 3,
    });
    const metadata = parseText(result);
    const image = result.content.find((entry: any) => entry.type === "image");
    expect(result.isError).toBeUndefined();
    expect(image).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(metadata).toMatchObject({
      fileName: "hero.png",
      projectRelativePath: "hero.png",
      sourceFormat: "png",
      width: 2,
      height: 1,
      hasTransparency: true,
      transparentPixels: 1,
      translucentPixels: 0,
    });
    expect(metadata.palette.colors[0]).toMatchObject({ hex: "#FF0000FF", count: 1 });
    expect(commands).toEqual([]);
  });

  it("rejects oversized PNG dimensions before decoding pixel data", async () => {
    const reference = path.join(root, "huge.png");
    const header = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header, 0);
    header.writeUInt32BE(13, 8);
    header.write("IHDR", 12, "ascii");
    header.writeUInt32BE(100_000, 16);
    header.writeUInt32BE(100_000, 20);
    fs.writeFileSync(reference, header);

    const result = await tools.get("load_reference_image")!.handler({ filePath: reference });
    expect(result.isError).toBe(true);
    expect(parseText(result).error).toMatch(/dimensions.*exceed/i);
    expect(commands).toEqual([]);
  });

  it("rejects oversized JPEG and WebP dimensions before asking Aseprite to decode them", async () => {
    const jpeg = Buffer.from([
      0xff, 0xd8,
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x27, 0x10, 0x27, 0x10,
      0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
      0xff, 0xd9,
    ]);
    fs.writeFileSync(path.join(root, "huge.jpg"), jpeg);

    const webp = Buffer.alloc(30);
    webp.write("RIFF", 0, "ascii");
    webp.writeUInt32LE(22, 4);
    webp.write("WEBP", 8, "ascii");
    webp.write("VP8X", 12, "ascii");
    webp.writeUInt32LE(10, 16);
    const dimensionMinusOne = 9_999;
    webp[24] = dimensionMinusOne & 0xff;
    webp[25] = (dimensionMinusOne >> 8) & 0xff;
    webp[26] = (dimensionMinusOne >> 16) & 0xff;
    webp[27] = dimensionMinusOne & 0xff;
    webp[28] = (dimensionMinusOne >> 8) & 0xff;
    webp[29] = (dimensionMinusOne >> 16) & 0xff;
    fs.writeFileSync(path.join(root, "huge.webp"), webp);

    for (const fileName of ["huge.jpg", "huge.webp"]) {
      const result = await tools.get("load_reference_image")!.handler({ fileName });
      expect(result.isError).toBe(true);
      expect(parseText(result).error).toMatch(/dimensions.*exceed/i);
    }
    expect(commands).toEqual([]);
  });

  it("saves an exact supplied .aseprite name and generates a deterministic descriptive fallback", async () => {
    const sprites = path.join(root, "sprites");
    fs.mkdirSync(sprites);
    const handler = tools.get("save_project")!.handler;

    const exact = await handler({ directory: "sprites", fileName: "Hero Walk.aseprite", overwrite: false });
    expect(parseText(exact)).toMatchObject({ fileName: "Hero Walk.aseprite", generatedFileName: false });
    expect(commands.at(-1)).toMatchObject({
      command: "save_sprite_as",
      params: { filePath: path.join(sprites, "Hero Walk.aseprite"), overwrite: false },
    });

    const generated = await handler({ directory: "sprites", assetName: "Khá Zir Worker", animationName: "Walk Left", overwrite: false });
    expect(parseText(generated)).toMatchObject({ fileName: "kha_zir_worker_walk_left.aseprite", generatedFileName: true });
    expect(commands.at(-1)?.params.filePath).toBe(path.join(sprites, "kha_zir_worker_walk_left.aseprite"));
  });

  it("rejects rewritten, nested, or non-aseprite file names before dispatch", async () => {
    const sprites = path.join(root, "sprites");
    fs.mkdirSync(sprites);
    const handler = tools.get("save_project")!.handler;
    const before = commands.length;

    for (const fileName of ["hero.png", "nested/hero.aseprite", "../hero.aseprite"]) {
      const result = await handler({ directory: "sprites", fileName, overwrite: false });
      expect(result.isError).toBe(true);
    }
    expect(commands.length).toBe(before);
  });
});
