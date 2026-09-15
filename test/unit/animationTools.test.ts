import { beforeEach, describe, expect, it } from "vitest";
import { encodeRgbaToPngBase64 } from "../../src/image/png.js";
import { registerAnimationInspectionTools } from "../../src/mcp/tools/animation.js";

type RegisteredTool = { handler: (params: any) => Promise<any> };

const gifBase64 = "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

function textPayload(result: any): any {
  const entry = [...result.content].reverse().find((item: any) => item.type === "text");
  return JSON.parse(entry.text);
}

describe("animation inspection and preview tools", () => {
  let tools: Map<string, RegisteredTool>;
  let commands: Array<{ command: string; params: any }>;
  let capabilities: Record<string, boolean>;
  let revision: number;
  let corruptTiming: boolean;

  beforeEach(() => {
    tools = new Map();
    commands = [];
    capabilities = { animationGif: true, animationInspection: true };
    revision = 7;
    corruptTiming = false;
    const pngBase64 = encodeRgbaToPngBase64(Uint8Array.from([
      255, 0, 0, 255,
      0, 0, 0, 0,
    ]), 2, 1).base64;
    const inspection = {
      success: true,
      width: 2,
      height: 1,
      colorMode: "rgb",
      frames: [
        { frameNumber: 1, durationMs: 100, celCount: 1 },
        { frameNumber: 2, durationMs: 200, celCount: 1 },
        { frameNumber: 3, durationMs: 100, celCount: 1 },
      ],
      tags: [{ name: "walk", from: 1, to: 3, direction: "pingpong", repeats: 0 }],
      layers: [{ name: "Body", celFrames: [1, 2, 3], celCount: 3 }],
      totalLayers: 1,
      totalCels: 3,
      revision,
    };
    const server: any = {
      tool: (name: string, _description: string, _schema: unknown, handler: RegisteredTool["handler"]) => {
        tools.set(name, { handler });
      },
    };
    const dispatcher: any = {
      send: async (command: string, params: any) => {
        commands.push({ command, params });
        if (command === "inspect_animation") return inspection;
        if (command === "render_animation_gif") {
          const durations = params.frameNumbers.map((frameNumber: number) => inspection.frames[frameNumber - 1].durationMs);
          if (corruptTiming) durations[0] += 1;
          return {
            success: true,
            gifBase64,
            durationsMs: durations,
            width: inspection.width * params.scale,
            height: inspection.height * params.scale,
          };
        }
        if (command === "get_canvas") return { pngBase64, revision };
        throw new Error(`Unexpected command: ${command}`);
      },
    };
    const state: any = {
      getCapabilities: () => ({ ...capabilities }),
      getRevision: () => revision,
      setRevision: (value: number) => { revision = value; },
    };
    registerAnimationInspectionTools(server, dispatcher, state);
  });

  it("returns structured timing, tag, layer, and loop-boundary metadata", async () => {
    const result = await tools.get("inspect_animation")!.handler({ tagName: "walk" });
    const payload = textPayload(result);
    expect(result.isError).toBeUndefined();
    expect(payload.playback.frameNumbers).toEqual([1, 2, 3, 2]);
    expect(payload.playback.totalDurationMs).toBe(600);
    expect(payload.playback.loopsContinuously).toBe(true);
    expect(payload.loopBoundary).toEqual({ lastSequenceFrame: 2, firstSequenceFrame: 1 });
    expect(payload.layers[0]).toMatchObject({ name: "Body", celCount: 3 });
  });

  it("returns a playable GIF and sequence-ordered contact sheet with a stable preview id", async () => {
    const result = await tools.get("render_animation_preview")!.handler({
      tagName: "walk",
      scale: 2,
      filmstripScale: 2,
      columns: 2,
      gap: 1,
    });
    const payload = textPayload(result);
    expect(result.isError).toBeUndefined();
    expect(result.content.filter((item: any) => item.type === "image").map((item: any) => item.mimeType)).toEqual([
      "image/gif",
      "image/png",
    ]);
    expect(payload.previewId).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.playback.frameNumbers).toEqual([1, 2, 3, 2]);
    expect(payload.playback.loop).toBe(true);
    expect(payload.contactSheet).toMatchObject({ columns: 2, rows: 2, width: 9, height: 5 });
    expect(commands.filter((entry) => entry.command === "get_canvas")).toHaveLength(3);
  });

  it("accepts tag as an explicit alias and rejects conflicting tag selectors", async () => {
    const aliasResult = await tools.get("render_animation_preview")!.handler({ tag: "walk", scale: 1, filmstripScale: 1 });
    expect(aliasResult.isError).toBeUndefined();
    const renderCommand = commands.find((entry) => entry.command === "render_animation_gif");
    expect(renderCommand?.params.frameNumbers).toEqual([1, 2, 3, 2]);

    const conflict = await tools.get("render_animation_preview")!.handler({ tagName: "walk", tag: "idle" });
    expect(conflict.isError).toBe(true);
    expect(textPayload(conflict).error).toMatch(/must match/i);
  });

  it("fails closed when the bridge lacks capabilities or timing changes during rendering", async () => {
    capabilities.animationGif = false;
    const unsupported = await tools.get("render_animation_preview")!.handler({ tagName: "walk" });
    expect(unsupported.isError).toBe(true);
    expect(textPayload(unsupported).error).toMatch(/animationGif/);

    capabilities.animationGif = true;
    corruptTiming = true;
    const incoherent = await tools.get("render_animation_preview")!.handler({ tagName: "walk" });
    expect(incoherent.isError).toBe(true);
    expect(textPayload(incoherent).error).toMatch(/timing changed/i);
  });
});
