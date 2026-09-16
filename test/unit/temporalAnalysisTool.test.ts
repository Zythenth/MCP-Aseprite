import { beforeEach, describe, expect, it } from "vitest";
import { encodeRgbaToPngBase64 } from "../../src/image/png.js";
import { registerAnimationInspectionTools } from "../../src/mcp/tools/animation.js";
import { AnimationWorkflowState } from "../../src/mcp/animationWorkflowState.js";

type RegisteredTool = { handler: (params: any) => Promise<any> };

const gifBase64 = "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

function textPayload(result: any): any {
  const entry = [...result.content].reverse().find((item: any) => item.type === "text");
  return JSON.parse(entry.text);
}

describe("analyze_animation_temporal tool layer", () => {
  let tools: Map<string, RegisteredTool>;
  let commands: Array<{ command: string; params: any }>;
  let capabilities: Record<string, boolean>;
  let revision: number;
  let workflowState: AnimationWorkflowState;
  let framePngs: Map<number, string>;
  let mutateRevisionDuringFetch: boolean;

  beforeEach(() => {
    tools = new Map();
    commands = [];
    capabilities = { animationGif: true, animationInspection: true };
    revision = 5;
    mutateRevisionDuringFetch = false;

    // 3 distinct 4x4 frames
    framePngs = new Map([
      [1, encodeRgbaToPngBase64(new Uint8Array(4 * 4 * 4).fill(20), 4, 4).base64],
      [2, encodeRgbaToPngBase64(new Uint8Array(4 * 4 * 4).fill(60), 4, 4).base64],
      [3, encodeRgbaToPngBase64(new Uint8Array(4 * 4 * 4).fill(100), 4, 4).base64],
    ]);

    const inspection = {
      success: true,
      width: 4,
      height: 4,
      colorMode: "rgb",
      frames: [
        { frameNumber: 1, durationMs: 100, celCount: 1 },
        { frameNumber: 2, durationMs: 120, celCount: 1 },
        { frameNumber: 3, durationMs: 100, celCount: 1 },
      ],
      tags: [
        { name: "walk", from: 1, to: 3, direction: "forward", repeats: 0 },
        { name: "bounce", from: 1, to: 3, direction: "pingpong", repeats: 0 },
      ],
      layers: [
        {
          name: "Main",
          celFrames: [1, 2, 3],
          celCount: 3,
          cels: [
            { frameNumber: 1, x: 0, y: 0, bounds: { x: 0, y: 0, width: 4, height: 4 }, position: { x: 0, y: 0 } },
            { frameNumber: 2, x: 1, y: 0, bounds: { x: 1, y: 0, width: 4, height: 4 }, position: { x: 1, y: 0 } },
            { frameNumber: 3, x: 0, y: 0, bounds: { x: 0, y: 0, width: 4, height: 4 }, position: { x: 0, y: 0 } },
          ],
        },
      ],
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
        if (command === "inspect_animation") return { ...inspection, revision };
        if (command === "render_animation_gif") {
          return {
            success: true,
            gifBase64,
            durationsMs: params.frameNumbers.map((fn: number) => inspection.frames[fn - 1].durationMs),
            width: inspection.width * (params.scale || 1),
            height: inspection.height * (params.scale || 1),
          };
        }
        if (command === "get_canvas") {
          if (mutateRevisionDuringFetch) {
            revision += 1;
          }
          const pngBase64 = framePngs.get(params.frameIndex) || framePngs.get(1)!;
          return { pngBase64, revision };
        }
        throw new Error(`Unexpected command: ${command}`);
      },
    };

    const state: any = {
      getCapabilities: () => ({ ...capabilities }),
      getRevision: () => revision,
      setRevision: (value: number) => { revision = value; },
    };

    workflowState = new AnimationWorkflowState();
    workflowState.setContext("sess-1", "test.aseprite", revision);

    registerAnimationInspectionTools(server, dispatcher, state, workflowState);
  });

  it("performs temporal analysis with forward direction", async () => {
    const result = await tools.get("analyze_animation_temporal")!.handler({
      tagName: "walk",
      direction: "forward",
    });

    const payload = textPayload(result);
    expect(result.isError).toBeUndefined();
    expect(payload.success).toBe(true);
    expect(payload.playback.frameNumbers).toEqual([1, 2, 3]);
    expect(payload.playback.direction).toBe("forward");
    expect(payload.temporalHash).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.summary.totalFrames).toBe(3);
    expect(payload.summary.passedRules).toBeDefined();
  });

  it("performs temporal analysis with reverse direction", async () => {
    const result = await tools.get("analyze_animation_temporal")!.handler({
      fromFrame: 1,
      toFrame: 3,
      direction: "reverse",
    });

    const payload = textPayload(result);
    expect(result.isError).toBeUndefined();
    expect(payload.playback.frameNumbers).toEqual([3, 2, 1]);
    expect(payload.playback.direction).toBe("reverse");
  });

  it("performs temporal analysis with pingpong and pingpong_reverse directions", async () => {
    const pingpongResult = await tools.get("analyze_animation_temporal")!.handler({
      fromFrame: 1,
      toFrame: 3,
      direction: "pingpong",
    });
    const pingpongPayload = textPayload(pingpongResult);
    expect(pingpongPayload.playback.frameNumbers).toEqual([1, 2, 3, 2]);

    const revPingpongResult = await tools.get("analyze_animation_temporal")!.handler({
      fromFrame: 1,
      toFrame: 3,
      direction: "pingpong_reverse",
    });
    const revPingpongPayload = textPayload(revPingpongResult);
    expect(revPingpongPayload.playback.frameNumbers).toEqual([3, 2, 1, 2]);
  });

  it("fails closed when revision changes during analysis (incoherent state)", async () => {
    mutateRevisionDuringFetch = true;
    const result = await tools.get("analyze_animation_temporal")!.handler({
      tagName: "walk",
    });
    expect(result.isError).toBe(true);
    expect(textPayload(result).error).toMatch(/sprite changed while temporal analysis was being performed/i);
  });

  it("matches identical canonical temporal hash between render_animation_preview and analyze_animation_temporal", async () => {
    const previewResult = await tools.get("render_animation_preview")!.handler({
      tagName: "walk",
    });
    const previewPayload = textPayload(previewResult);

    const analysisResult = await tools.get("analyze_animation_temporal")!.handler({
      tagName: "walk",
    });
    const analysisPayload = textPayload(analysisResult);

    expect(previewPayload.temporalHash).toBeDefined();
    expect(analysisPayload.temporalHash).toBeDefined();
    expect(analysisPayload.temporalHash).toBe(previewPayload.temporalHash);
  });

  it("registers evidence in AnimationWorkflowState and checks active workflow correspondence", async () => {
    // Create an active workflow targeting tag "walk"
    workflowState.createWorkflow({
      name: "Walk Cycle",
      authorId: "animator-1",
      targetSelection: { tagName: "walk" },
      strictCompletionRequired: false,
      sessionId: "sess-1",
      spriteIdentifier: "test.aseprite",
      framesCount: 3,
    });

    const result = await tools.get("analyze_animation_temporal")!.handler({
      tagName: "walk",
    });
    const payload = textPayload(result);

    expect(payload.workflow.hasActiveWorkflow).toBe(true);
    expect(payload.workflow.matchesActiveWorkflow).toBe(true);
    expect(payload.workflow.workflowName).toBe("Walk Cycle");

    // Check that evidence is saved in workflowState registry
    const registered = workflowState.getRegisteredTemporalAnalyses();
    expect(registered.length).toBeGreaterThan(0);
    const last = registered.at(-1)!;
    expect(last.analysisId).toBe(payload.analysisId);
    expect(last.temporalHash).toBe(payload.temporalHash);
    expect(last.revision).toBe(revision);
  });

  it("reports when temporal analysis does not match active workflow targetSelection", async () => {
    // Workflow targeting range 1..2
    workflowState.createWorkflow({
      name: "Idle Jump",
      authorId: "animator-1",
      targetSelection: { frameRange: { from: 1, to: 2 } },
      strictCompletionRequired: false,
      sessionId: "sess-1",
      spriteIdentifier: "test.aseprite",
      framesCount: 3,
    });

    // Run analysis on tag "walk" (which has frames 1..3)
    const result = await tools.get("analyze_animation_temporal")!.handler({
      tagName: "walk",
    });
    const payload = textPayload(result);

    expect(payload.workflow.hasActiveWorkflow).toBe(true);
    expect(payload.workflow.matchesActiveWorkflow).toBe(false);
    expect(payload.workflow.reason).toMatch(/frameRange/i);
  });

  it("accepts and evaluates optional rigidRegions and contactPoints parameters with displacement tracking", async () => {
    const result = await tools.get("analyze_animation_temporal")!.handler({
      tagName: "walk",
      rigidRegions: [{ id: "core", x: 0, y: 0, width: 2, height: 2 }],
      contactPoints: [
        {
          id: "foot",
          positions: [
            { frameNumber: 1, x: 1, y: 3 },
            { frameNumber: 2, x: 2, y: 3 },
          ],
          maxDisplacement: 0,
        },
      ],
      maxContactPointDisplacement: 0,
    });
    const payload = textPayload(result);
    expect(result.isError).toBeUndefined();
    expect(payload.success).toBe(true);
    expect(payload.summary).toBeDefined();
    expect(payload.summary.totalFindings).toBeDefined();
    expect(payload.summary.truncated).toBe(false);

    // Finding for displacement should be detected
    const displacementFinding = payload.findings.find((f: any) => f.ruleId === "contact_point_displacement");
    expect(displacementFinding).toBeDefined();
    expect(displacementFinding.observedMetrics).toMatchObject({
      pointId: "foot",
      fromFrame: 1,
      toFrame: 2,
      dx: 1,
      dy: 0,
      distance: 1,
      threshold: 0,
    });
  });
});
