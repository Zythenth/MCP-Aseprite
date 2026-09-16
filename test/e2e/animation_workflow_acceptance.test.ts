import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BridgeState } from "../../src/bridge/state.js";
import { BRIDGE_PROTOCOL_VERSION } from "../../src/config.js";
import { encodeRgbaToPngBase64, encodeRgbaToPngBuffer } from "../../src/image/png.js";
import {
  ANIMATION_WORKFLOW_22_CATEGORIES,
  AnimationWorkflowState,
} from "../../src/mcp/animationWorkflowState.js";
import { registerAnimationInspectionTools } from "../../src/mcp/tools/animation.js";
import { registerBatchTools } from "../../src/mcp/tools/batch.js";
import { registerFileTools } from "../../src/mcp/tools/files.js";
import { registerWorkflowTools } from "../../src/mcp/tools/workflow.js";
import { registerApprovalTools } from "../../src/mcp/tools/approval.js";
import { ApprovalState } from "../../src/mcp/approvalState.js";

const GIF_BASE64 = "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

function textPayload(result: any): any {
  const entry = [...result.content].reverse().find((item: any) => item.type === "text");
  return JSON.parse(entry.text);
}

describe("Animation workflow E2E acceptance", () => {
  let root: string;
  let previousAllowed: string | undefined;
  let previousProjectRoot: string | undefined;

  beforeEach(() => {
    previousAllowed = process.env.ASEPRITE_ALLOWED_PATHS;
    previousProjectRoot = process.env.ASEPRITE_PROJECT_ROOT;
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mcp-animation-workflow-e2e-")));
    process.env.ASEPRITE_ALLOWED_PATHS = root;
    process.env.ASEPRITE_PROJECT_ROOT = root;
  });

  afterEach(() => {
    if (previousAllowed === undefined) delete process.env.ASEPRITE_ALLOWED_PATHS;
    else process.env.ASEPRITE_ALLOWED_PATHS = previousAllowed;
    if (previousProjectRoot === undefined) delete process.env.ASEPRITE_PROJECT_ROOT;
    else process.env.ASEPRITE_PROJECT_ROOT = previousProjectRoot;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("completes the audited workflow, invalidates stale QA, saves, and releases final export", async () => {
    const referencePath = path.join(root, "reference.png");
    const rgba = Uint8Array.from([
      255, 0, 0, 255,
      0, 0, 0, 0,
    ]);
    fs.writeFileSync(referencePath, encodeRgbaToPngBuffer(rgba, 2, 1));
    const framePng = encodeRgbaToPngBase64(rgba, 2, 1).base64;

    const state = new BridgeState();
    state.handleHello({
      bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION,
      asepriteVersion: "mock",
      apiVersion: 0,
      sessionId: "workflow-e2e-session",
      revision: 1,
      capabilities: {
        animationBatch: true,
        animationGif: true,
        animationInspection: true,
      },
    });
    state.setConnected(true, "127.0.0.1");
    state.updateActiveSprite({
      filename: path.join(root, "hero.aseprite"),
      width: 2,
      height: 1,
      colorMode: "rgb",
      layersCount: 1,
      framesCount: 2,
      activeLayer: "Layer 1",
      activeFrame: 1,
    });

    const workflowState = new AnimationWorkflowState(state);
    const tools = new Map<string, (args: any) => Promise<any>>();
    const server: any = {
      tool: (name: string, _description: string, _schema: unknown, handler: (args: any) => Promise<any>) => {
        tools.set(name, handler);
      },
    };
    let revision = 1;
    const dispatched: string[] = [];
    const dispatcher: any = {
      send: async (command: string, params: any) => {
        dispatched.push(command);
        if (command === "inspect_animation") {
          return {
            success: true,
            width: 2,
            height: 1,
            colorMode: "rgb",
            frames: [
              { frameNumber: 1, durationMs: 100, celCount: 1 },
              { frameNumber: 2, durationMs: 100, celCount: 1 },
            ],
            tags: [],
            layers: [{ name: "Layer 1", celFrames: [1, 2], celCount: 2 }],
            totalLayers: 1,
            totalCels: 2,
            revision,
          };
        }
        if (command === "render_animation_gif") {
          return {
            success: true,
            gifBase64: GIF_BASE64,
            durationsMs: params.frameNumbers.map(() => 100),
            width: 2,
            height: 1,
          };
        }
        if (command === "get_canvas") return { success: true, pngBase64: framePng, revision };
        if (command === "batch_animation_edits") {
          revision += 1;
          return {
            success: true,
            changed: true,
            revision,
            operationsApplied: params.operations.length,
            framesTouched: 1,
            pixelsChanged: 1,
            bounds: { x: 0, y: 0, width: 1, height: 1 },
          };
        }
        if (command === "save_sprite_as") return { success: true, filePath: params.filePath, revision };
        if (command === "export_png") return { success: true, outputPath: params.outputPath, revision };
        if (command === "show_human_approval") return { decision: "approved", feedback: "Approved in test", revision };
        throw new Error(`Unexpected command: ${command}`);
      },
    };

    registerWorkflowTools(server, dispatcher, state, workflowState);
    registerAnimationInspectionTools(server, dispatcher, state, workflowState);
    registerBatchTools(server, dispatcher, state);
    const approvalState = new ApprovalState();
    registerApprovalTools(server, dispatcher, state, approvalState);
    registerFileTools(server, dispatcher, state, workflowState, approvalState);
    const call = async (name: string, args: any = {}) => tools.get(name)!(args);

    const loaded = textPayload(await call("load_reference_image", { filePath: referencePath }));
    expect(loaded.recordedInWorkflow).toBe(true);

    expect((await call("create_animation_workflow", {
      name: "Walk cycle",
      authorId: "author",
      targetSelection: { frameRange: { from: 1, to: 2 } },
      strictCompletionRequired: true,
    })).isError).toBeUndefined();

    expect((await call("record_reference_analysis", {
      referenceIdOuPath: loaded.filePath,
      hash: loaded.hash,
      dimensions: { width: loaded.width, height: loaded.height },
      transparency: loaded.transparency,
      observedPalette: loaded.observedPalette,
      silhouette: "Readable two-frame silhouette",
      proportions: "Stable proportions",
      anatomy: "Stable joint placement",
      accessories: "No accessories",
      rigidParts: "Torso",
      flexibleParts: "Limbs",
      joints: "Hips and knees",
      materials: "Cloth",
      emissiveRegions: "None",
      lightDirection: "Upper left",
      outline: "Single-pixel dark outline",
      deformableRegions: "Legs",
      stableRegions: "Head and torso",
      allowedColors: loaded.observedPalette,
      newColorsJustification: "No new colors",
    })).isError).toBeUndefined();

    expect((await call("record_animation_plan", {
      requestedAction: "Two-frame walk cycle",
      target: { type: "range", frameRange: { from: 1, to: 2 } },
      totalDurationMs: 200,
      plannedFps: 10,
      frameCount: 2,
      loopType: "loop",
      anticipation: "Contact prepares the passing pose",
      contacts: "Frame 1 contact",
      extremes: "Frame 1 maximum stride",
      passing: "Frame 2 passing pose",
      recovery: "Frame 2 returns toward contact",
      keyPoses: [{ id: "contact", name: "Contact", role: "key", description: "Foot contact" }],
      inBetweenFrames: "Frame 2 is the in-between",
      motionArcs: "One-pixel vertical arc",
      rigidRegions: "Torso remains stable",
      flexibleRegions: "Legs alternate",
      lightingRules: "Highlights remain upper-left",
      paletteRules: "Reference palette only",
      completionCriteria: ["Readable loop", "Current independent QA"],
      authorId: "author",
    })).isError).toBeUndefined();
    expect((await call("mark_key_pose", { poseId: "contact", frameNumber: 1 })).isError).toBeUndefined();

    const categories = Object.fromEntries(
      ANIMATION_WORKFLOW_22_CATEGORIES.map((category) => [category, { status: "pass", notes: `Checked ${category}` }])
    );
    const reviewCurrentRevision = async () => {
      const previewResult = await call("render_animation_preview", {
        fromFrame: 1,
        toFrame: 2,
        direction: "forward",
        scale: 1,
        filmstripScale: 1,
      });
      expect(previewResult.isError).toBeUndefined();
      const preview = textPayload(previewResult);
      expect((await call("review_key_poses", { previewId: preview.previewId, revision })).isError).toBeUndefined();
      expect((await call("record_self_review", {
        previewId: preview.previewId,
        revision,
        categories,
        reviewerId: "author",
      })).isError).toBeUndefined();
      expect((await call("submit_animation_qa", {
        reviewerId: "independent-reviewer",
        authorId: "author",
        independenceConfirmed: true,
        previewId: preview.previewId,
        revision,
        result: "aprovado",
        feedback: "Independent review found no blocking defects",
      })).isError).toBeUndefined();
      return preview;
    };

    await reviewCurrentRevision();
    expect(textPayload(await call("validate_animation_completion")).isComplete).toBe(true);

    const correction = await call("batch_animation_edits", {
      operations: [{ op: "set_pixels", frameNumber: 1, pixels: [{ x: 0, y: 0, color: "#FF0000FF" }] }],
      returnPreview: false,
    });
    expect(correction.isError).toBeUndefined();
    expect(textPayload(correction).revision).toBe(2);
    expect(textPayload(await call("validate_animation_completion")).isComplete).toBe(false);

    const currentPreview = await reviewCurrentRevision();
    expect(textPayload(await call("validate_animation_completion")).isComplete).toBe(true);

    const saved = await call("save_project", { filePath: "hero_final.aseprite" });
    expect(saved.isError).toBeUndefined();

    const approval = textPayload(await call("request_human_approval", { summary: "Final workflow export", frameNumber: 1 }));
    expect(approval.decision).toBe("approved");

    const finalExport = await call("export_animation", {
      format: "png",
      outputPath: "hero_final.png",
      fromFrame: 1,
      toFrame: 2,
      final: true,
      humanApprovalId: approval.approvalId,
    });
    expect(finalExport.isError).toBeUndefined();
    expect(textPayload(finalExport).completionEvidence).toMatchObject({
      authorId: "author",
      currentRevision: 2,
      isComplete: true,
      preview: { previewId: currentPreview.previewId, revision: 2 },
      qa: { reviewerId: "independent-reviewer", authorId: "author", revision: 2, result: "aprovado" },
    });
    expect(dispatched).toContain("batch_animation_edits");
    expect(dispatched).toContain("save_sprite_as");
    expect(dispatched).toContain("export_png");
  });
});
