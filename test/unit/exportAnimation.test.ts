import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BridgeState } from "../../src/bridge/state.js";
import {
  AnimationWorkflowState,
  ANIMATION_WORKFLOW_22_CATEGORIES,
} from "../../src/mcp/animationWorkflowState.js";
import { registerFileTools } from "../../src/mcp/tools/files.js";

function parseText(result: any): any {
  return JSON.parse(result.content.find((entry: any) => entry.type === "text").text);
}

describe("export_animation", () => {
  let root: string;
  let originalAllowed: string | undefined;
  let originalProjectRoot: string | undefined;
  let handler: (params: any) => Promise<any>;
  let saveProjectHandler: (params: any) => Promise<any>;
  let commands: Array<{ command: string; params: any }>;
  let failSequenceAt: number | null;
  let stateTracker: BridgeState;
  let workflowState: AnimationWorkflowState;

  beforeEach(() => {
    originalAllowed = process.env.ASEPRITE_ALLOWED_PATHS;
    originalProjectRoot = process.env.ASEPRITE_PROJECT_ROOT;
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mcp-animation-export-")));
    fs.mkdirSync(path.join(root, "exports"));
    process.env.ASEPRITE_ALLOWED_PATHS = root;
    process.env.ASEPRITE_PROJECT_ROOT = root;
    commands = [];
    failSequenceAt = null;
    let pngCall = 0;
    const inspection = {
      success: true,
      width: 16,
      height: 16,
      colorMode: "rgb",
      frames: [
        { frameNumber: 1, durationMs: 100 },
        { frameNumber: 2, durationMs: 120 },
        { frameNumber: 3, durationMs: 100 },
      ],
      tags: [{ name: "walk", from: 1, to: 3, direction: "pingpong", repeats: 0 }],
      layers: [],
      revision: 4,
    };
    const tools = new Map<string, (params: any) => Promise<any>>();
    const server: any = {
      tool: (name: string, _description: string, _schema: unknown, toolHandler: (params: any) => Promise<any>) => {
        tools.set(name, toolHandler);
      },
    };
    const dispatcher: any = {
      send: async (command: string, params: any) => {
        commands.push({ command, params });
        if (command === "inspect_animation") return inspection;
        if (command === "render_animation_gif") return { success: true, outputPath: params.outputPath };
        if (command === "export_sprite_sheet") return { success: true, outputPath: params.outputPath, frameNumbers: params.frameNumbers };
        if (command === "save_sprite_as") return { success: true, filePath: params.filePath };
        if (command === "export_png") {
          pngCall++;
          if (failSequenceAt === pngCall) throw new Error("simulated export failure");
          fs.writeFileSync(params.outputPath, `frame ${params.frameNumber}`);
          return { success: true, outputPath: params.outputPath, frameNumber: params.frameNumber };
        }
        throw new Error(`Unexpected command: ${command}`);
      },
    };
    stateTracker = new BridgeState();
    stateTracker.setConnected(true, "127.0.0.1");
    stateTracker.handleHello({
      bridgeProtocolVersion: "1.0.0",
      asepriteVersion: "1.3",
      apiVersion: 1,
      sessionId: "session_abc",
      revision: 4,
      capabilities: { animationGif: true, animationInspection: true },
    });
    stateTracker.updateActiveSprite({
      filename: "hero.aseprite",
      width: 16,
      height: 16,
      colorMode: "rgb",
      layersCount: 1,
      framesCount: 3,
      activeLayer: "Layer 1",
      activeFrame: 1,
    });
    workflowState = new AnimationWorkflowState(stateTracker);
    registerFileTools(server, dispatcher, stateTracker, workflowState);
    handler = tools.get("export_animation")!;
    saveProjectHandler = tools.get("save_project")!;
  });

  afterEach(() => {
    if (originalAllowed === undefined) delete process.env.ASEPRITE_ALLOWED_PATHS;
    else process.env.ASEPRITE_ALLOWED_PATHS = originalAllowed;
    if (originalProjectRoot === undefined) delete process.env.ASEPRITE_PROJECT_ROOT;
    else process.env.ASEPRITE_PROJECT_ROOT = originalProjectRoot;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("exports GIF and sprite-sheet playback in the exact expanded tag order", async () => {
    const gif = await handler({ format: "gif", outputPath: "exports/walk.gif", tagName: "walk", scale: 2 });
    expect(gif.isError).toBeUndefined();
    expect(commands.at(-1)).toMatchObject({
      command: "render_animation_gif",
      params: {
        outputPath: path.join(root, "exports", "walk.gif"),
        frameNumbers: [1, 2, 3, 2],
        scale: 2,
        loop: true,
        overwrite: false,
      },
    });

    const sheet = await handler({ format: "sprite_sheet", outputPath: "exports/walk.png", tagName: "walk", layout: "grid", columns: 2 });
    expect(sheet.isError).toBeUndefined();
    expect(commands.at(-1)).toMatchObject({
      command: "export_sprite_sheet",
      params: { frameNumbers: [1, 2, 3, 2], layout: "grid", columns: 2 },
    });
  });

  it("writes deterministic PNG-sequence names and reports their source frames", async () => {
    const result = await handler({
      format: "png_sequence",
      outputDirectory: "exports",
      baseName: "walk_left",
      tagName: "walk",
    });
    const payload = parseText(result);
    expect(result.isError).toBeUndefined();
    expect(payload.files.map((file: any) => [file.fileName, file.sourceFrame])).toEqual([
      ["walk_left_0001.png", 1],
      ["walk_left_0002.png", 2],
      ["walk_left_0003.png", 3],
      ["walk_left_0004.png", 2],
    ]);
    for (const file of payload.files) expect(fs.existsSync(file.outputPath)).toBe(true);
  });

  it("rolls back newly created no-clobber sequence files after a partial failure", async () => {
    failSequenceAt = 2;
    const result = await handler({ format: "png_sequence", outputDirectory: "exports", baseName: "broken", tagName: "walk" });
    expect(result.isError).toBe(true);
    expect(parseText(result).error).toMatch(/simulated export failure/i);
    expect(fs.readdirSync(path.join(root, "exports")).filter((name) => name.startsWith("broken_"))).toEqual([]);
  });

  it("fails before dispatch for unsupported APNG and existing no-clobber targets", async () => {
    const beforeApng = commands.length;
    const apng = await handler({ format: "apng", outputPath: "exports/walk.png", tagName: "walk" });
    expect(apng.isError).toBe(true);
    expect(parseText(apng).error).toMatch(/not supported/i);
    expect(commands.length).toBe(beforeApng);

    fs.writeFileSync(path.join(root, "exports", "existing.gif"), "old");
    const existing = await handler({ format: "gif", outputPath: "exports/existing.gif", tagName: "walk" });
    expect(existing.isError).toBe(true);
    expect(parseText(existing).error).toMatch(/already exists/i);
    expect(commands.at(-1)?.command).toBe("inspect_animation");
  });

  it("keeps ordinary and non-strict final exports usable without a workflow", async () => {
    const ordinary = await handler({ format: "png", outputPath: "exports/ordinary.png" });
    expect(ordinary.isError).toBeUndefined();

    const final = await handler({ format: "png", outputPath: "exports/final.png", final: true });
    expect(final.isError).toBeUndefined();
    expect(parseText(final).completionEvidence).toBeUndefined();
    expect(commands.filter(({ command }) => command === "inspect_animation")).toHaveLength(2);
  });

  it("blocks strict final export without a workflow before any dispatcher command", async () => {
    const before = commands.length;
    const result = await handler({
      format: "gif",
      outputPath: "exports/final.gif",
      final: true,
      strictWorkflowValidation: true,
    });
    const payload = parseText(result);

    expect(result.isError).toBe(true);
    expect(payload.code).toBe("WORKFLOW_COMPLETION_REQUIRED");
    expect(payload.failedGateNames).toContain("workflowExists");
    expect(payload.currentRevision).toBe(4);
    expect(commands).toHaveLength(before);
  });

  it("does not apply final-export gates to save_project", async () => {
    const save = await saveProjectHandler({ filePath: "exports/hero.aseprite" });
    expect(save.isError).toBeUndefined();
    expect(commands.at(-1)).toMatchObject({
      command: "save_sprite_as",
      params: { filePath: path.join(root, "exports", "hero.aseprite") },
    });
  });
});
