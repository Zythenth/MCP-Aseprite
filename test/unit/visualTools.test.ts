import { beforeEach, describe, expect, it } from "vitest";
import { decodePngBase64Sync } from "../../src/image/png.js";
import { registerVisualTools } from "../../src/mcp/tools/visual.js";

type RegisteredTool = { handler: (params: any) => Promise<any> };

describe("visual tools with in-memory bridge canvas", () => {
  let tools: Map<string, RegisteredTool>;

  beforeEach(() => {
    tools = new Map();
    const rgba = Uint8Array.from([
      255, 0, 0, 255,
      0, 0, 255, 128,
    ]);
    const canvas = {
      width: 2,
      height: 1,
      frameNumber: 3,
      rgbaBase64: Buffer.from(rgba).toString("base64"),
      revision: 9,
    };
    const server: any = {
      tool: (name: string, _description: string, _schema: unknown, handler: RegisteredTool["handler"]) => {
        tools.set(name, { handler });
      },
    };
    const dispatcher: any = {
      send: async (command: string) => {
        if (command === "get_canvas") return canvas;
        if (command === "inspect_sprite") {
          return { ...canvas, activeLayer: "Body", activeFrame: 3, pixelGrid: { width: 2, height: 1, grid: [] } };
        }
        throw new Error(`Unexpected command: ${command}`);
      },
    };
    const state: any = { setRevision: () => undefined };
    registerVisualTools(server, dispatcher, state);
  });

  it("returns a valid PNG from get_canvas when the bridge returns only RGBA", async () => {
    const result = await tools.get("get_canvas")!.handler({ scale: 1, checkerboard: false });
    expect(result.isError).toBeUndefined();
    const image = result.content.find((entry: any) => entry.type === "image");
    const decoded = decodePngBase64Sync(image.data);
    expect({ width: decoded.width, height: decoded.height, data: Array.from(decoded.data) }).toEqual({
      width: 2,
      height: 1,
      data: [255, 0, 0, 255, 0, 0, 255, 128],
    });
  });

  it("renders the coordinate-grid preview from the same in-memory RGBA response", async () => {
    const result = await tools.get("get_pixel_grid_preview")!.handler({
      frameIndex: 3,
      scale: 4,
      showGrid: true,
      showCoordinates: true,
      checkerboard: true,
    });
    expect(result.isError).toBeUndefined();
    const image = result.content.find((entry: any) => entry.type === "image");
    expect(() => decodePngBase64Sync(image.data)).not.toThrow();
  });

  it("renders inspect_sprite when the bridge returns RGBA instead of a temporary PNG", async () => {
    const result = await tools.get("inspect_sprite")!.handler({ scale: 4, format: "compact", includePixels: true });
    expect(result.isError).toBeUndefined();
    const image = result.content.find((entry: any) => entry.type === "image");
    const decoded = decodePngBase64Sync(image.data);
    expect({ width: decoded.width, height: decoded.height }).toEqual({ width: 8, height: 4 });
  });
});
