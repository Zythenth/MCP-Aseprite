import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = fs.existsSync(path.resolve(__dirname, "../../src"))
  ? path.resolve(__dirname, "../../")
  : process.cwd();

describe("Lua Bridge Contract Parity Tests (100% Parity)", () => {
  it("dynamically validates 100% parity between TypeScript dispatcher commands and Lua handlers with zero missing handlers", () => {
    // 1. Scan src/mcp/tools/*.ts dynamically for dispatcher.send calls
    const toolsDir = path.resolve(rootDir, "src/mcp/tools");
    const toolFiles = fs.readdirSync(toolsDir).filter((file) => file.endsWith(".ts"));

    expect(toolFiles.length).toBeGreaterThan(0);

    const sendRegex = /dispatcher\.send(?:<[^>]+>)?\(\s*["']([^"']+)["']/g;
    const tsCommands = new Set<string>();

    for (const file of toolFiles) {
      const filePath = path.join(toolsDir, file);
      const content = fs.readFileSync(filePath, "utf-8");
      let match: RegExpExecArray | null;
      while ((match = sendRegex.exec(content)) !== null) {
        tsCommands.add(match[1]);
      }
    }

    expect(tsCommands.size).toBeGreaterThan(0);

    // 2. Scan lua/aseprite-bridge.lua for handlers.<name> = function
    const luaPath = path.resolve(rootDir, "lua/aseprite-bridge.lua");
    const luaContent = fs.readFileSync(luaPath, "utf-8");

    const handlerRegex = /handlers\.([a-zA-Z0-9_]+)\s*=/g;
    const luaHandlers = new Set<string>();
    let handlerMatch: RegExpExecArray | null;
    while ((handlerMatch = handlerRegex.exec(luaContent)) !== null) {
      luaHandlers.add(handlerMatch[1]);
    }

    const bracketHandlerRegex = /handlers\[["']([^"']+)["']\]\s*=/g;
    while ((handlerMatch = bracketHandlerRegex.exec(luaContent)) !== null) {
      luaHandlers.add(handlerMatch[1]);
    }

    expect(luaHandlers.size).toBeGreaterThan(0);

    // 3. 100% Parity check: zero missing handlers for any TypeScript command!
    const missingHandlers = Array.from(tsCommands)
      .filter((cmd) => !luaHandlers.has(cmd))
      .sort();
    expect(missingHandlers).toEqual([]);

    // 4. Verify Phase 2 added handlers exist specifically in Lua bridge
    expect(luaHandlers.has("duplicate_frame")).toBe(true);
    expect(luaHandlers.has("move_layer")).toBe(true);
    expect(luaHandlers.has("get_changes_since")).toBe(true);
  });

  describe("Static Architectural and Contract Invariant Validations", () => {
    it("validates MAX_CHANGE_JOURNAL_ENTRIES = 128 and handlers.get_changes_since with params.sinceRevision in Lua bridge", () => {
      const luaPath = path.resolve(rootDir, "lua/aseprite-bridge.lua");
      const luaContent = fs.readFileSync(luaPath, "utf-8");

      expect(luaContent).toMatch(/local\s+MAX_CHANGE_JOURNAL_ENTRIES\s*=\s*128/);
      expect(luaContent).toMatch(/handlers\.get_changes_since\s*=\s*function/);
      expect(luaContent).toMatch(/params\.sinceRevision/);
      expect(luaContent).not.toMatch(/params\.revision/);
    });

    it("bounds tileset memory and validates tile writes before creating a cel", () => {
      const luaContent = fs.readFileSync(path.resolve(rootDir, "lua/aseprite-bridge.lua"), "utf-8");
      expect(luaContent).toMatch(/local\s+MAX_TILESET_PIXELS\s*=\s*16777216/);
      expect(luaContent).toMatch(/width\s*\*\s*height\s*\*\s*count\s*>\s*MAX_TILESET_PIXELS/);

      const setTiles = /handlers\.set_tiles\s*=\s*function\s*\(params\)([\s\S]*?)(?:\n\s*handlers\.|$)/.exec(luaContent)?.[1];
      expect(setTiles).toBeDefined();
      expect(setTiles!.indexOf('type(params.tiles) ~= "table"')).toBeLessThan(setTiles!.indexOf("spr:newCel"));
      expect(setTiles).toMatch(/app\.transaction\(["']MCP set tiles["'][\s\S]*?spr:newCel/);
    });

    it("tracks linked cels and uses Aseprite's native same-layer link command", () => {
      const luaContent = fs.readFileSync(path.resolve(rootDir, "lua/aseprite-bridge.lua"), "utf-8");
      expect(luaContent).toMatch(/local\s+function\s+linkedCelsForCel\s*\(spr,\s*cel\)/);
      expect(luaContent).toMatch(/ipairs\(spr\.cels\s+or\s+\{\}\)/);
      expect(luaContent).toMatch(/Source and target cel must be different/);
      expect(luaContent).toMatch(/Linked cels must belong to the same image layer/);
      expect(luaContent).toMatch(/app\.command\.LinkCels\s*\(\s*\)/);
    });

    it("validates complete absence of revisionSnapshots in TestHarness", () => {
      const harnessPath = path.resolve(rootDir, "test/harness/mockBridgeHarness.ts");
      const harnessContent = fs.readFileSync(harnessPath, "utf-8");

      expect(harnessContent).not.toContain("revisionSnapshots");
      expect(harnessContent).not.toContain("recordSnapshot");
    });

    it("validates that shared layer and frame resolvers exist and are called by pixel and inspection handlers", () => {
      const luaPath = path.resolve(rootDir, "lua/aseprite-bridge.lua");
      const luaContent = fs.readFileSync(luaPath, "utf-8");

      expect(luaContent).toMatch(/local\s+function\s+resolveTargetLayer\s*\(/);
      expect(luaContent).toMatch(/local\s+function\s+resolveTargetFrame\s*\(/);

      // Verify handlers call the shared resolvers
      const handlersToCheck = ["set_pixels", "get_pixel_grid", "flood_fill", "replace_color"];
      for (const handler of handlersToCheck) {
        const handlerRegex = new RegExp(`handlers\\.${handler}\\s*=\\s*function\\s*\\(params\\)([\\s\\S]*?)(?:\\n\\s*handlers\\.|\\n\\s*--|\\n\\s*return|$)`);
        const match = handlerRegex.exec(luaContent);
        expect(match).not.toBeNull();
        const body = match![1];
        expect(body).toContain("resolveTargetLayer");
        expect(body).toContain("resolveTargetFrame");
      }
    });

    it("uses the real Aseprite layer editability API without reading a nonexistent isLocked field", () => {
      const luaPath = path.resolve(rootDir, "lua/aseprite-bridge.lua");
      const luaContent = fs.readFileSync(luaPath, "utf-8");

      expect(luaContent).not.toContain("layer.isLocked");
      expect(luaContent).not.toContain("targetLayer.isLocked");
      expect(luaContent).toContain("targetLayer.isEditable == false");
      expect(luaContent).toContain("isLocked = layer.isEditable == false");
    });

    it("validates that flood_fill in Lua does not use O(n^2) table.remove queue operations", () => {
      const luaPath = path.resolve(rootDir, "lua/aseprite-bridge.lua");
      const luaContent = fs.readFileSync(luaPath, "utf-8");

      const floodFillRegex = /handlers\.flood_fill\s*=\s*function\s*\(params\)([\s\S]*?)(?:\n\s*handlers\.|\n\s*--)/;
      const match = floodFillRegex.exec(luaContent);
      expect(match).not.toBeNull();
      const body = match![1];
      expect(body).not.toMatch(/table\.remove\s*\(\s*queue/);
      expect(body).toMatch(/head\s*=\s*head\s*\+\s*1/);
    });

    it("validates that mode-aware helper functions are defined in Lua bridge", () => {
      const luaPath = path.resolve(rootDir, "lua/aseprite-bridge.lua");
      const luaContent = fs.readFileSync(luaPath, "utf-8");

      expect(luaContent).toMatch(/local\s+function\s+decodePixelToRgba\s*\(/);
      expect(luaContent).toMatch(/local\s+function\s+encodeColorToPixel\s*\(/);
      expect(luaContent).toMatch(/local\s+function\s+getTransparentPixel\s*\(/);
      expect(luaContent).toMatch(/local\s+function\s+parseHexRgba\s*\(/);
    });

    it("validates decodePixelToRgba handles RGB, GRAYSCALE (grayaV/grayaA), and INDEXED (palette lookup + transparentColor)", () => {
      const luaPath = path.resolve(rootDir, "lua/aseprite-bridge.lua");
      const luaContent = fs.readFileSync(luaPath, "utf-8");

      const helperMatch = /local\s+function\s+decodePixelToRgba\s*\(([^)]+)\)([\s\S]*?)(?=\nlocal\s+function\s+encodeColorToPixel)/.exec(luaContent);
      expect(helperMatch).not.toBeNull();
      const helperBody = helperMatch![2];

      // RGB mode
      expect(helperBody).toContain("ColorMode.RGB");
      expect(helperBody).toMatch(/app\.pixelColor\.rgbaR\s*\(/);

      // Grayscale mode uses graya functions
      expect(helperBody).toContain("ColorMode.GRAYSCALE");
      expect(helperBody).toMatch(/app\.pixelColor\.grayaV\s*\(/);
      expect(helperBody).toMatch(/app\.pixelColor\.grayaA\s*\(/);

      // Indexed mode reads through palette and represents transparentColor with alpha 0
      expect(helperBody).toContain("ColorMode.INDEXED");
      expect(helperBody).toMatch(/pal:\s*getColor\s*\(/);
      expect(helperBody).toContain("transparentColor");
    });

    it("validates encodeColorToPixel handles RGB (rgba), GRAYSCALE (grayPixel), and INDEXED (transparentColor / index)", () => {
      const luaPath = path.resolve(rootDir, "lua/aseprite-bridge.lua");
      const luaContent = fs.readFileSync(luaPath, "utf-8");

      const helperMatch = /local\s+function\s+encodeColorToPixel\s*\(([^)]+)\)([\s\S]*?)(?=\nlocal\s+function\s+colorToHex)/.exec(luaContent);
      expect(helperMatch).not.toBeNull();
      const helperBody = helperMatch![2];

      // RGB mode
      expect(helperBody).toContain("ColorMode.RGB");
      expect(helperBody).toMatch(/app\.pixelColor\.rgba\s*\(/);

      // Grayscale mode uses grayPixel
      expect(helperBody).toContain("ColorMode.GRAYSCALE");
      expect(helperBody).toContain("grayPixel");

      // Indexed mode uses transparentColor for alpha 0 and .index for closest palette match
      expect(helperBody).toContain("ColorMode.INDEXED");
      expect(helperBody).toContain("transparentColor");
      expect(helperBody).toContain(".index");
    });

    it("validates get_pixel_grid preserves indexed format as raw native integer and decodes visible RGBA for hex/rgba/compact", () => {
      const luaPath = path.resolve(rootDir, "lua/aseprite-bridge.lua");
      const luaContent = fs.readFileSync(luaPath, "utf-8");

      const handlerMatch = /handlers\.get_pixel_grid\s*=\s*function\s*\(params\)([\s\S]*?)(?:\n\s*handlers\.|\n\s*--)/.exec(luaContent);
      expect(handlerMatch).not.toBeNull();
      const body = handlerMatch![1];

      // Absent cel / canvas background uses getTransparentPixel
      expect(body).toContain("getTransparentPixel");

      // Indexed format preserves raw native integer
      expect(body).toMatch(/format\s*==\s*["']indexed["']\s*then[\s\S]*?table\.insert\s*\(\s*row\s*,\s*colorInt\s*\)/);

      // Hex, rgba, and compact formats route through mode-aware decoding
      expect(body).toContain("decodePixelToRgba");
      expect(body).toContain("colorToHex");

      // No unconditional decoding of native pixel as RGBA
      expect(body).not.toMatch(/app\.pixelColor\.rgbaR\s*\(\s*colorInt\s*\)/);
    });

    it("validates set_pixels encodes and compares native-mode pixel values for idempotency", () => {
      const luaPath = path.resolve(rootDir, "lua/aseprite-bridge.lua");
      const luaContent = fs.readFileSync(luaPath, "utf-8");

      const handlerMatch = /handlers\.set_pixels\s*=\s*function\s*\(params\)([\s\S]*?)(?:\n\s*handlers\.|\n\s*--)/.exec(luaContent);
      expect(handlerMatch).not.toBeNull();
      const body = handlerMatch![1];

      expect(body).toContain("encodeColorToPixel");
      expect(body).toMatch(/prevNative\s*~=\s*targetNative/);
      expect(body).toMatch(/img:drawPixel\s*\(\s*p\.x\s*,\s*p\.y\s*,\s*targetNative\s*\)/);
      expect(body).not.toMatch(/parseHexColor\s*\(\s*p\.color\s*\)/);
    });

    it("validates flood_fill and replace_color compare decoded RGBA channels in sprite mode", () => {
      const luaPath = path.resolve(rootDir, "lua/aseprite-bridge.lua");
      const luaContent = fs.readFileSync(luaPath, "utf-8");

      const floodMatch = /handlers\.flood_fill\s*=\s*function\s*\(params\)([\s\S]*?)(?:\n\s*handlers\.|\n\s*--)/.exec(luaContent);
      expect(floodMatch).not.toBeNull();
      const floodBody = floodMatch![1];

      expect(floodBody).toContain("getTransparentPixel");
      expect(floodBody).toContain("encodeColorToPixel");
      expect(floodBody).toContain("decodePixelToRgba");
      expect(floodBody).toContain("colorDiff");
      expect(floodBody).not.toMatch(/app\.pixelColor\.rgbaR\s*\(\s*cInt\s*\)/);

      const replaceMatch = /handlers\.replace_color\s*=\s*function\s*\(params\)([\s\S]*?)(?:\n\s*handlers\.|\n\s*--)/.exec(luaContent);
      expect(replaceMatch).not.toBeNull();
      const replaceBody = replaceMatch![1];

      expect(replaceBody).toContain("getTransparentPixel");
      expect(replaceBody).toContain("parseHexRgba");
      expect(replaceBody).toContain("decodePixelToRgba");
      expect(replaceBody).toContain("colorDiff");
      expect(replaceBody).not.toMatch(/app\.pixelColor\.rgbaR\s*\(\s*cInt\s*\)/);
    });

    it("validates create_layer resolves parentGroup recursively, requires single group match before mutation, and sets layer.parent", () => {
      const luaPath = path.resolve(rootDir, "lua/aseprite-bridge.lua");
      const luaContent = fs.readFileSync(luaPath, "utf-8");

      const createLayerMatch = /handlers\.create_layer\s*=\s*function\s*\(params\)([\s\S]*?)(?:\n\s*handlers\.|\n\s*--)/.exec(luaContent);
      expect(createLayerMatch).not.toBeNull();
      const body = createLayerMatch![1];

      // Resolves parentGroup with findLayersByNameRecursive
      expect(body).toContain("params.parentGroup");
      expect(body).toContain("findLayersByNameRecursive");

      // Validations before newLayer
      const validationPos = body.indexOf("findLayersByNameRecursive");
      const newLayerPos = body.indexOf("spr:newLayer()");
      expect(validationPos).toBeGreaterThan(-1);
      expect(newLayerPos).toBeGreaterThan(validationPos);

      // Rejection rules: zero matches, multiple matches (ambiguous), and non-group
      expect(body).toMatch(/#matched\s*==\s*0/);
      expect(body).toMatch(/#matched\s*>\s*1/);
      expect(body).toMatch(/not\s+matched\[1\]\.isGroup/);

      // Assigns layer.parent to the resolved group
      expect(body).toMatch(/\.parent\s*=\s*targetGroup/);
    });

    it("validates create_frame validates afterFrame, inserts at position via newEmptyFrame, rejects durationMs, and returns required fields", () => {
      const luaPath = path.resolve(rootDir, "lua/aseprite-bridge.lua");
      const luaContent = fs.readFileSync(luaPath, "utf-8");

      const createFrameMatch = /handlers\.create_frame\s*=\s*function\s*\(params\)([\s\S]*?)(?:\n\s*handlers\.|\n\s*--)/.exec(luaContent);
      expect(createFrameMatch).not.toBeNull();
      const body = createFrameMatch![1];

      // Rejects durationMs alias
      expect(body).toContain("params.durationMs");

      // Validates afterFrame within 1..#spr.frames
      expect(body).toContain("params.afterFrame");
      expect(body).toMatch(/af\s*<\s*1\s+or\s+af\s*>\s*#spr\.frames/);

      // Uses documented spr:newEmptyFrame(pos) where pos is afterFrame + 1 or #spr.frames + 1
      expect(body).toMatch(/params\.afterFrame\s+and\s+\(params\.afterFrame\s*\+\s*1\)\s+or\s+\(#spr\.frames\s*\+\s*1\)/);
      expect(body).toMatch(/spr:newEmptyFrame\s*\(\s*pos\s*\)/);

      // Duration in milliseconds converted to seconds for Aseprite
      expect(body).toMatch(/durMs\s*\/\s*1000/);

      // Returns frameNumber, createdFrameNumber, totalFrames, durationMs, revision
      expect(body).toContain("frameNumber =");
      expect(body).toContain("createdFrameNumber =");
      expect(body).toContain("totalFrames =");
      expect(body).toContain("durationMs =");
      expect(body).toMatch(/return\s+finishMutation\s*\(/);
    });

    it("validates create_tag validates frame bounds before newTag, applies color via parseHexRgba, and list_tags returns canonical #RRGGBBAA color", () => {
      const luaPath = path.resolve(rootDir, "lua/aseprite-bridge.lua");
      const luaContent = fs.readFileSync(luaPath, "utf-8");

      const createTagMatch = /handlers\.create_tag\s*=\s*function\s*\(params\)([\s\S]*?)(?:\n\s*handlers\.|\n\s*--)/.exec(luaContent);
      expect(createTagMatch).not.toBeNull();
      const createBody = createTagMatch![1];

      // Validates bounds before spr:newTag
      const boundsCheckPos = createBody.indexOf("fromFrame > toFrame");
      const newTagPos = createBody.indexOf("spr:newTag");
      expect(boundsCheckPos).toBeGreaterThan(-1);
      expect(newTagPos).toBeGreaterThan(boundsCheckPos);
      expect(createBody).toMatch(/fromFrame\s*<\s*1\s+or\s+fromFrame\s*>\s*#spr\.frames/);
      expect(createBody).toMatch(/toFrame\s*<\s*1\s+or\s+toFrame\s*>\s*#spr\.frames/);

      // Color assigned via parseHexRgba and Color{ r, g, b, a }
      expect(createBody).toContain("parseHexRgba(params.color)");
      expect(createBody).toMatch(/Color\s*\{\s*r\s*=\s*rgba\.r/);

      // list_tags includes canonical #RRGGBBAA color
      const listTagsMatch = /handlers\.list_tags\s*=\s*function\s*\(params\)([\s\S]*?)(?:\n\s*handlers\.|\n\s*--)/.exec(luaContent);
      expect(listTagsMatch).not.toBeNull();
      const listBody = listTagsMatch![1];

      expect(listBody).toMatch(/string\.format\s*\(\s*["']#%02X%02X%02X%02X["']/);
      expect(listBody).toContain("from = t.fromFrame.frameNumber");
      expect(listBody).toContain("to = t.toFrame.frameNumber");
    });

    it("validates find_palette_color respects findNearest, exact matches, non-exact rejection, and required return fields", () => {
      const luaPath = path.resolve(rootDir, "lua/aseprite-bridge.lua");
      const luaContent = fs.readFileSync(luaPath, "utf-8");

      const findPaletteMatch = /handlers\.find_palette_color\s*=\s*function\s*\(params\)([\s\S]*?)(?:\n\s*handlers\.|\n\s*--)/.exec(luaContent);
      expect(findPaletteMatch).not.toBeNull();
      const body = findPaletteMatch![1];

      // Uses parseHexRgba and iterates over palette
      expect(body).toContain("parseHexRgba(params.color)");
      expect(body).toMatch(/for\s+i\s*=\s*0\s*,\s*#pal\s*-\s*1\s+do/);
      expect(body).toContain("pal:getColor(i)");

      // Supports findNearest parameter
      expect(body).toContain("params.findNearest");

      // When no exact match and findNearest == false, returns found = false, exact = false without index
      expect(body).toMatch(/if\s+not\s+isExact\s+and\s+not\s+findNearest\s+then[\s\S]*?found\s*=\s*false[\s\S]*?exact\s*=\s*false/);

      // Returns found, index, hex, exact, distance
      expect(body).toContain("found = true");
      expect(body).toContain("index = bestIdx");
      expect(body).toContain("hex =");
      expect(body).toContain("exact = isExact");
      expect(body).toContain("distance =");
    });

    it("validates resize_canvas uses CanvasSize and Rectangle, rejects spr:resize, and returns contentOffset and dimensions", () => {
      const luaPath = path.resolve(rootDir, "lua/aseprite-bridge.lua");
      const luaContent = fs.readFileSync(luaPath, "utf-8");

      const resizeMatch = /handlers\.resize_canvas\s*=\s*function\s*\(params\)([\s\S]*?)(?:\n\s*handlers\.|\n\s*--)/.exec(luaContent);
      expect(resizeMatch).not.toBeNull();
      const body = resizeMatch![1];

      // Calls app.command.CanvasSize and Rectangle
      expect(body).toContain("app.command.CanvasSize");
      expect(body).toContain("Rectangle");

      // Uses executeMcpMutation
      expect(body).toContain("executeMcpMutation");

      // Strictly forbids spr:resize
      expect(body).not.toMatch(/spr:\s*resize/);
      expect(body).not.toMatch(/:resize\s*\(/);

      // Anchors and content offset
      expect(body).toContain("contentOffset =");
      expect(body).toContain("top_left");
      expect(body).toContain("center");
      expect(body).toContain("top_right");
      expect(body).toContain("bottom_left");
      expect(body).toContain("bottom_right");
    });

    it("validates export_png uses temporary Image, drawSprite, default resize without interpolation, and palette-aware saveAs without mutating revision", () => {
      const luaPath = path.resolve(rootDir, "lua/aseprite-bridge.lua");
      const luaContent = fs.readFileSync(luaPath, "utf-8");

      const exportMatch = /handlers\.export_png\s*=\s*function\s*\(params\)([\s\S]*?)(?:\n\s*handlers\.|\n\s*--)/.exec(luaContent);
      expect(exportMatch).not.toBeNull();
      const body = exportMatch![1];

      // Temporary Image and drawSprite
      expect(body).toMatch(/Image\s*\(\s*spr\.spec\s*\)/);
      expect(body).toContain("drawSprite");

      // Resizes temporary image using default non-interpolating resize (omitting method)
      expect(body).toMatch(/compImg:resize\s*\{\s*width\s*=\s*spr\.width\s*\*\s*scale\s*,\s*height\s*=\s*spr\.height\s*\*\s*scale\s*\}/);
      expect(body).not.toMatch(/method\s*=\s*["']bilinear["']/);
      expect(body).not.toMatch(/method\s*=\s*["']rotsprite["']/);

      // Saves with palette for indexed mode
      expect(body).toContain("ColorMode.INDEXED");
      expect(body).toMatch(/saveAs\s*\{\s*filename\s*=\s*params\.outputPath\s*,\s*palette\s*=\s*pal\s*\}/);

      // Validates frame via resolveTargetFrame
      expect(body).toContain("resolveTargetFrame");

      // Does not mutate revision
      expect(body).not.toContain("state.revision");
    });

    it("validates get_canvas supports isolated layer rendering without mutating active layer/frame or revision", () => {
      const luaPath = path.resolve(rootDir, "lua/aseprite-bridge.lua");
      const luaContent = fs.readFileSync(luaPath, "utf-8");

      // Check in-memory frame compositor and RGBA serializer
      const helperMatch = /local\s+function\s+renderFrameImage\s*\(([^)]+)\)([\s\S]*?)(?=\nlocal\s+function\s+imageRgbaBase64)/.exec(luaContent);
      expect(helperMatch).not.toBeNull();
      const helperBody = helperMatch![2];

      expect(helperBody).toContain("targetLayer");
      expect(helperBody).toContain("compImg:drawImage");
      expect(helperBody).toContain("cel.position");
      expect(helperBody).toContain("cel.image");
      expect(helperBody).toContain("math.floor(((cel.opacity or 255) * (targetLayer.opacity or 255) + 127) / 255)");
      expect(helperBody).not.toContain("saveAs");
      expect(helperBody).not.toContain("io.open");

      const rgbaHelperMatch = /local\s+function\s+imageRgbaBase64\s*\(([^)]+)\)([\s\S]*?)(?=\nlocal\s+function\s+attachFramePreview)/.exec(luaContent);
      expect(rgbaHelperMatch).not.toBeNull();
      expect(rgbaHelperMatch![2]).toContain("image:getPixel(x, y)");
      expect(rgbaHelperMatch![2]).toContain("decodePixelToRgba(sprite");
      expect(rgbaHelperMatch![2]).toContain("base64Encode(table.concat(pixels))");

      const previewHelperMatch = /local\s+function\s+attachFramePreview\s*\(([^)]+)\)([\s\S]*?)(?=\nlocal\s+function\s+exportImagePngBase64)/.exec(luaContent);
      expect(previewHelperMatch).not.toBeNull();
      expect(previewHelperMatch![2]).toContain("rgbaBase64 = imageRgbaBase64(compImg, sprite)");
      expect(previewHelperMatch![2]).not.toContain("saveAs");
      expect(previewHelperMatch![2]).not.toContain("io.open");
      expect(luaContent).not.toContain("exportFramePngBase64");

      // Check handlers.get_canvas
      const getCanvasMatch = /handlers\.get_canvas\s*=\s*function\s*\(params\)([\s\S]*?)(?:\n\s*handlers\.|\n\s*--)/.exec(luaContent);
      expect(getCanvasMatch).not.toBeNull();
      const body = getCanvasMatch![1];

      expect(body).toContain("resolveTargetFrame");
      expect(body).toContain("findLayersByNameRecursive");
      expect(body).toContain("#matched == 0");
      expect(body).toContain("#matched > 1");
      expect(body).toContain("targetLayer.isGroup");
      expect(body).toContain("renderFrameImage(spr, frameNum, targetLayer)");
      expect(body).toContain("rgbaBase64 = imageRgbaBase64(composed, spr)");
      expect(body).not.toContain("exportFramePngBase64");
      expect(body).not.toContain("saveAs");
      expect(body).not.toContain("io.open");
      expect(body).not.toContain("state.revision =");
    });

    it("validates get_pixel_grid validates and iterates native region, crops at borders, and returns canonical region metadata", () => {
      const luaPath = path.resolve(rootDir, "lua/aseprite-bridge.lua");
      const luaContent = fs.readFileSync(luaPath, "utf-8");

      const gridMatch = /handlers\.get_pixel_grid\s*=\s*function\s*\(params\)([\s\S]*?)(?:\n\s*handlers\.|\n\s*--)/.exec(luaContent);
      expect(gridMatch).not.toBeNull();
      const body = gridMatch![1];

      // Region validation
      expect(body).toContain("params.region");
      expect(body).toContain("Region origin outside canvas bounds.");
      expect(body).toMatch(/rw\s*=\s*math\.min\s*\(\s*width\s*,\s*spr\.width\s*-\s*x\s*\)/);
      expect(body).toMatch(/rh\s*=\s*math\.min\s*\(\s*height\s*,\s*spr\.height\s*-\s*y\s*\)/);

      // Iterates only within region
      expect(body).toMatch(/for\s+y\s*=\s*ry\s*,\s*ry\s*\+\s*rh\s*-\s*1\s+do/);
      expect(body).toMatch(/for\s+x\s*=\s*rx\s*,\s*rx\s*\+\s*rw\s*-\s*1\s+do/);

      // Returns canonical origin and region
      expect(body).toContain("result.origin = { x = rx, y = ry }");
      expect(body).toContain("result.region = { x = rx, y = ry, width = rw, height = rh }");
      expect(body).toContain("width = rw");
      expect(body).toContain("height = rh");
    });

    it("validates animation inspection and GIF rendering are bounded, preserve timing, and restore editor state", () => {
      const luaPath = path.resolve(rootDir, "lua/aseprite-bridge.lua");
      const luaContent = fs.readFileSync(luaPath, "utf-8");

      const inspectMatch = /handlers\.inspect_animation\s*=\s*function\s*\(params\)([\s\S]*?)(?:\n\s*handlers\.|\n\s*--)/.exec(luaContent);
      expect(inspectMatch).not.toBeNull();
      const inspectBody = inspectMatch![1];
      expect(inspectBody).toContain("#spr.frames > 1024");
      expect(inspectBody).toContain("totalLayers > 512");
      expect(inspectBody).toContain("totalCels > 100000");
      expect(inspectBody).toMatch(/local\s+function\s+visit\s*\(container,\s*parentPath\)/);
      expect(inspectBody).toContain("node.children = visit(layer, layerPath)");
      expect(inspectBody).toContain("durationMs = durationMs");
      expect(inspectBody).toContain("repeats = tag.repeats or 0");
      expect(inspectBody).toContain("totalDurationMs = totalDurationMs");
      expect(inspectBody).toContain("node.cels = {}");
      expect(inspectBody).toContain("frameNumber = cel.frame.frameNumber");
      expect(inspectBody).toContain("bounds = b");
      expect(inspectBody).toContain("position = { x = cel.position.x, y = cel.position.y }");

      expect(luaContent).toMatch(/handlers\.render_animation_gif\s*=\s*function/);
      const helperMatch = /local\s+function\s+renderAnimationGif\s*\(params\)([\s\S]*?)(?=\r?\n\s*-- -+\r?\n\s*-- Helper: Ensure Canvas-Sized Cel)/.exec(luaContent);
      expect(helperMatch).not.toBeNull();
      const helperBody = helperMatch![1];
      expect(helperBody).toContain("#params.frameNumbers > 64");
      expect(helperBody).toContain("scale > 8");
      expect(helperBody).toContain("67108864");
      expect(helperBody).toContain("10485760");
      expect(helperBody).toContain("frameImage:drawSprite(sourceSprite, rawFrameNumber");
      expect(helperBody).toContain("targetFrame.duration = sourceFrame.duration");
      expect(helperBody).not.toContain("previewSprite:newTag");
      expect(helperBody).toContain("app.preferences.gif");
      expect(helperBody).toContain("gifPreferences.show_alert = false");
      expect(helperBody).toContain("gifPreferences.loop = params.loop == true");
      expect(helperBody).toContain("gifPreferences.show_alert = originalGifShowAlert");
      expect(helperBody).toContain("gifPreferences.loop = originalGifLoop");
      expect(helperBody).toContain("File appeared before export and overwrite is false");
      expect(helperBody).toContain('file:seek("end")');
      expect(helperBody).toContain('file:seek("set", 0)');
      expect(helperBody).toContain("previewSprite:close()");
      expect(helperBody).toContain("app.sprite = sourceSprite");
      expect(helperBody).toContain("app.frame = sourceSprite.frames");
      expect(helperBody).toContain("os.remove(outputPath)");
      const restoreCall = helperBody.indexOf("closePreviewAndRestoreSource()", helperBody.indexOf("local result ="));
      const temporaryRead = helperBody.indexOf('io.open(outputPath, "rb")', restoreCall);
      expect(restoreCall).toBeGreaterThan(-1);
      expect(temporaryRead).toBeGreaterThan(restoreCall);
    });

    it("validates file operation handlers enforce strict path matching and no-clobber rules", () => {
      const luaPath = path.resolve(rootDir, "lua/aseprite-bridge.lua");
      const luaContent = fs.readFileSync(luaPath, "utf-8");

      // Check handlers.save_sprite
      const saveSpriteMatch = /handlers\.save_sprite\s*=\s*function\s*\(params\)([\s\S]*?)(?:\n\s*handlers\.|\n\s*--)/.exec(luaContent);
      expect(saveSpriteMatch).not.toBeNull();
      const saveBody = saveSpriteMatch![1];
      expect(saveBody).toContain("expectedFilePath");
      expect(saveBody).toContain(':gsub("\\\\", "/")');
      expect(saveBody).toContain("expected ~= actual");
      expect(saveBody).toContain("app.command.SaveFile()");

      // Check handlers.save_sprite_as
      const saveAsMatch = /handlers\.save_sprite_as\s*=\s*function\s*\(params\)([\s\S]*?)(?:\n\s*handlers\.|\n\s*--)/.exec(luaContent);
      expect(saveAsMatch).not.toBeNull();
      const saveAsBody = saveAsMatch![1];
      expect(saveAsBody).toContain("params.filePath");
      expect(saveAsBody).toMatch(/params\.overwrite\s*~=\s*true/);
      expect(saveAsBody).toMatch(/io\.open\s*\(\s*params\.filePath/);
      expect(saveAsBody).toContain("spr:saveAs(params.filePath)");

      // Check export_png no-clobber
      const exportMatch = /handlers\.export_png\s*=\s*function\s*\(params\)([\s\S]*?)(?:\n\s*handlers\.|\n\s*--)/.exec(luaContent);
      expect(exportMatch).not.toBeNull();
      const exportBody = exportMatch![1];
      expect(exportBody).toMatch(/params\.overwrite\s*~=\s*true/);
      expect(exportBody).toMatch(/io\.open\s*\(\s*params\.outputPath/);
    });

    it("validates Lua bridge port/token env parsing, conditional query parameter, and secret leakage prevention", () => {
      const luaPath = path.resolve(rootDir, "lua/aseprite-bridge.lua");
      const luaContent = fs.readFileSync(luaPath, "utf-8");

      // 1. Env port reading with trimmed empty string fallback and strict precedence
      expect(luaContent).toMatch(/function\s+parseEnvPort\s*\(\)/);
      expect(luaContent).toMatch(/getTrimmed\s*\(\s*["']ASEPRITE_PORT["']\s*\)\s*or\s*getTrimmed\s*\(\s*["']ASEPRITE_WS_PORT["']\s*\)/);
      expect(luaContent).toMatch(/#trimmed\s*==\s*0\s+then\s+return\s+nil/);
      expect(luaContent).toContain("1024");
      expect(luaContent).toContain("65535");
      expect(luaContent).toContain("32123");

      // 2. Env token reading and explicit ASCII charset validation (locale-independent)
      expect(luaContent).toMatch(/os\.getenv\s*\(\s*["']ASEPRITE_BRIDGE_TOKEN["']\s*\)/);
      expect(luaContent).toContain("#trimmed < 16");
      expect(luaContent).toContain("#trimmed > 128");
      expect(luaContent).toContain("[^A-Za-z0-9%._%~%-]");
      expect(luaContent).not.toMatch(/\[\^%w/);

      // 3. Token is sent only in the authenticated hello payload, never in the URL
      expect(luaContent).toMatch(/WS_URL\s*=\s*WS_BASE_URL/);
      expect(luaContent).not.toMatch(/WS_URL\s*=.*[?&]token=/);
      expect(luaContent).toMatch(/event\s*=\s*["']hello["']/);
      expect(luaContent).toMatch(/token\s*=\s*BRIDGE_TOKEN/);

      // 4. Token never leaked in UI labels or tips
      expect(luaContent).not.toMatch(/app\.tip\([^)]*BRIDGE_TOKEN/);
      expect(luaContent).not.toMatch(/dlg:modify\{[^}]*BRIDGE_TOKEN/);
      expect(luaContent).not.toMatch(/dlg:label\{[^}]*BRIDGE_TOKEN/);
      expect(luaContent).toContain("Auth: ");
      expect(luaContent).toContain("enabled");
      expect(luaContent).toContain("disabled");

      // 5. WebSocketMessageType.ERROR uses generic message without raw err to prevent token/URL leakage to UI
      const wsErrorMatch = /WebSocketMessageType\.ERROR\s+then([\s\S]*?)(?:elseif|end)/.exec(luaContent);
      expect(wsErrorMatch).not.toBeNull();
      const wsErrorBody = wsErrorMatch![1];
      expect(wsErrorBody).toContain('dlg:modify{ id = "status_lbl", text = "Connection error (check server logs)" }');
      expect(wsErrorBody).not.toContain("tostring(err)");
      expect(wsErrorBody).not.toMatch(/\.\.\s*err\b/);

      // 6. Zero hardcoded secrets
      expect(luaContent).not.toMatch(/token\s*=\s*["'][A-Za-z0-9]{16,}["']/);
    });

    it("validates move_frame contract: Cel.frame, single app.transaction, temporary frame, deleteFrame, and absence of forbidden operations", () => {
      const luaPath = path.resolve(rootDir, "lua/aseprite-bridge.lua");
      const luaContent = fs.readFileSync(luaPath, "utf-8");

      const handlerMatch = /handlers\.move_frame\s*=\s*function\s*\(params\)([\s\S]*?)(?=\r?\nhandlers\.set_frame_durations)/.exec(luaContent);
      expect(handlerMatch).not.toBeNull();
      const body = handlerMatch![1];

      // Verifying Cel.frame
      expect(body).toMatch(/\.frame\s*=/);

      // Single app.transaction
      const transactions = body.match(/app\.transaction\s*\(/g);
      expect(transactions).not.toBeNull();
      expect(transactions!.length).toBe(1);

      // Temporary frame and deleteFrame
      expect(body).toMatch(/newEmptyFrame|newFrame/);
      expect(body).toContain("deleteFrame");

      // Absence in handler body of newCel, app.command, LinkCels, and deleteCel
      expect(body).not.toContain("newCel");
      expect(body).not.toContain("app.command");
      expect(body).not.toContain("LinkCels");
      expect(body).not.toContain("deleteCel");
    });

    it("validates set_frame_durations contract: handles both modes, 256 limit, and validates/normalizes before executeMcpMutation", () => {
      const luaPath = path.resolve(rootDir, "lua/aseprite-bridge.lua");
      const luaContent = fs.readFileSync(luaPath, "utf-8");

      const handlerMatch = /handlers\.set_frame_durations\s*=\s*function\s*\(params\)([\s\S]*?)(?=\r?\nhandlers\.create_tag)/.exec(luaContent);
      expect(handlerMatch).not.toBeNull();
      const body = handlerMatch![1];

      // Confirme a presença dos dois modos (Mode A: explicit durations list, Mode B: range parameters)
      expect(body).toContain("hasDurations");
      expect(body).toContain("hasRangePart");
      expect(body).toMatch(/params\.durations/);
      expect(body).toMatch(/fromFrame/);
      expect(body).toMatch(/toFrame/);
      expect(body).toMatch(/durationMs/);

      // Limite 256
      expect(body).toMatch(/256/);

      // Confirme que todas as validações/normalização aparecem antes de executeMcpMutation
      const mutationIdx = body.indexOf("executeMcpMutation");
      expect(mutationIdx).toBeGreaterThan(-1);

      const mixValidationIdx = body.indexOf("Cannot mix durations and range parameters");
      const missingModeValidationIdx = body.indexOf("Must provide either durations or fromFrame");
      const rangeRequiredValidationIdx = body.indexOf("Range mode requires fromFrame, toFrame, and durationMs");
      const fromFrameValidationIdx = body.indexOf("Invalid fromFrame");
      const toFrameValidationIdx = body.indexOf("Invalid toFrame");
      const orderValidationIdx = body.indexOf("fromFrame must be <= toFrame");
      const rangeLimitIdx = body.indexOf("Range exceeds maximum of 256 frames");
      const listLimitIdx = body.indexOf("durations must be a list with 1 to 256 items");
      const duplicateFrameValidationIdx = body.indexOf("Duplicate frameNumber");
      const normalizationIdx = body.indexOf("local normalizedDurations = {}");

      expect(mixValidationIdx).toBeGreaterThan(-1);
      expect(missingModeValidationIdx).toBeGreaterThan(-1);
      expect(rangeRequiredValidationIdx).toBeGreaterThan(-1);
      expect(fromFrameValidationIdx).toBeGreaterThan(-1);
      expect(toFrameValidationIdx).toBeGreaterThan(-1);
      expect(orderValidationIdx).toBeGreaterThan(-1);
      expect(rangeLimitIdx).toBeGreaterThan(-1);
      expect(listLimitIdx).toBeGreaterThan(-1);
      expect(duplicateFrameValidationIdx).toBeGreaterThan(-1);
      expect(normalizationIdx).toBeGreaterThan(-1);

      expect(mixValidationIdx).toBeLessThan(mutationIdx);
      expect(missingModeValidationIdx).toBeLessThan(mutationIdx);
      expect(rangeRequiredValidationIdx).toBeLessThan(mutationIdx);
      expect(fromFrameValidationIdx).toBeLessThan(mutationIdx);
      expect(toFrameValidationIdx).toBeLessThan(mutationIdx);
      expect(orderValidationIdx).toBeLessThan(mutationIdx);
      expect(rangeLimitIdx).toBeLessThan(mutationIdx);
      expect(listLimitIdx).toBeLessThan(mutationIdx);
      expect(duplicateFrameValidationIdx).toBeLessThan(mutationIdx);
      expect(normalizationIdx).toBeLessThan(mutationIdx);
    });

    it("validates update_tag handler checks duplicate name and no-op before mutation, and preserves tag data", () => {
      const luaPath = path.resolve(rootDir, "lua/aseprite-bridge.lua");
      const luaContent = fs.readFileSync(luaPath, "utf-8");

      const handlerMatch = /handlers\.update_tag\s*=\s*function\s*\(params\)([\s\S]*?)(?=\r?\nhandlers\.delete_tag)/.exec(luaContent);
      expect(handlerMatch).not.toBeNull();
      const body = handlerMatch![1];

      const existsIdx = body.indexOf("Tag already exists");
      const noOpMatch = /changed\s*=\s*false/.exec(body);
      const mutationIdx = body.indexOf("executeMcpMutation");

      expect(existsIdx).toBeGreaterThan(-1);
      expect(noOpMatch).not.toBeNull();
      expect(mutationIdx).toBeGreaterThan(-1);

      expect(existsIdx).toBeLessThan(mutationIdx);
      expect(noOpMatch!.index).toBeLessThan(mutationIdx);

      expect(body).toContain("targetTag.data");
      expect(body).toContain("finalTag.data");
    });

    it("validates batch_animation_edits handler contract: capability, allowlist, validation before mutation, single atomic transaction, no dynamic dispatch, cache by object+ipairs, and early no-op", () => {
      const luaPath = path.resolve(rootDir, "lua/aseprite-bridge.lua");
      const luaContent = fs.readFileSync(luaPath, "utf-8");

      // 1. Capability advertisement
      expect(luaContent).toMatch(/animationBatch\s*=\s*true/);

      // 2. Extract handler body up to handlers.undo
      const handlerMatch = /handlers\.batch_animation_edits\s*=\s*function\s*\(params\)([\s\S]*?)(?=\r?\nhandlers\.undo\s*=)/.exec(luaContent);
      expect(handlerMatch).not.toBeNull();
      const body = handlerMatch![1];

      // 3. Explicit allowlist
      expect(body).toMatch(/set_pixels\s*=\s*true/);
      expect(body).toMatch(/erase_pixels\s*=\s*true/);
      expect(body).toMatch(/set_cel_position\s*=\s*true/);
      expect(body).toMatch(/set_cel_opacity\s*=\s*true/);
      expect(body).toMatch(/set_frame_duration\s*=\s*true/);

      // 4. Exactly 1 executeMcpMutation and 1 app.transaction
      const executeMutationMatches = body.match(/executeMcpMutation/g) || [];
      const appTransactionMatches = body.match(/app\.transaction/g) || [];
      expect(executeMutationMatches.length).toBe(1);
      expect(appTransactionMatches.length).toBe(1);

      // 5. No dynamic execution / handlers.set_pixels / dofile / loadstring / os.execute
      expect(body).not.toMatch(/handlers\./);
      expect(body).not.toMatch(/handlers\[/);
      expect(body).not.toMatch(/loadstring/);
      expect(body).not.toMatch(/dofile/);
      expect(body).not.toMatch(/os\.execute/);

      // 6. Cache by layer object and deterministic application via ipairs
      expect(body).toMatch(/celCache\[layer\]/);
      expect(body).toMatch(/ipairs\(celCacheList\)/);
      expect(body).not.toMatch(/\bpairs\s*\(\s*celCache\s*\)/);
      expect(body).not.toMatch(/\bpairs\s*\(\s*celCacheList\s*\)/);

      // 7. Validation, planning, and no-op check happen strictly BEFORE executeMcpMutation
      const mutationIdx = body.indexOf("executeMcpMutation");
      const denseValidationIdx = body.indexOf("isDenseArray");
      const payloadLimitIdx = body.indexOf("4 * 1024 * 1024");
      const opLimitIdx = body.indexOf("64");
      const pixelLimitIdx = body.indexOf("100000");
      const boundsCheckIdx = body.indexOf("out of canvas bounds");
      const colorCheckIdx = body.indexOf("encodeColorToPixel");
      const ambiguityCheckIdx = body.indexOf("ambiguous semantics");
      const noOpCheckIdx = body.indexOf("if not hasRealChange then");

      expect(mutationIdx).toBeGreaterThan(-1);
      expect(denseValidationIdx).toBeGreaterThan(-1);
      expect(payloadLimitIdx).toBeGreaterThan(-1);
      expect(opLimitIdx).toBeGreaterThan(-1);
      expect(pixelLimitIdx).toBeGreaterThan(-1);
      expect(boundsCheckIdx).toBeGreaterThan(-1);
      expect(colorCheckIdx).toBeGreaterThan(-1);
      expect(ambiguityCheckIdx).toBeGreaterThan(-1);
      expect(noOpCheckIdx).toBeGreaterThan(-1);

      expect(denseValidationIdx).toBeLessThan(mutationIdx);
      expect(payloadLimitIdx).toBeLessThan(mutationIdx);
      expect(opLimitIdx).toBeLessThan(mutationIdx);
      expect(pixelLimitIdx).toBeLessThan(mutationIdx);
      expect(boundsCheckIdx).toBeLessThan(mutationIdx);
      expect(colorCheckIdx).toBeLessThan(mutationIdx);
      expect(ambiguityCheckIdx).toBeLessThan(mutationIdx);
      expect(noOpCheckIdx).toBeLessThan(mutationIdx);
    });
  });
});
