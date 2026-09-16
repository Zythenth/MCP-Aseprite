import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BridgeState } from "../../src/bridge/state.js";
import {
  AnimationWorkflowState,
  ANIMATION_WORKFLOW_22_CATEGORIES,
} from "../../src/mcp/animationWorkflowState.js";
import { registerWorkflowTools } from "../../src/mcp/tools/workflow.js";
import { registerAnimationInspectionTools } from "../../src/mcp/tools/animation.js";
import { registerFileTools } from "../../src/mcp/tools/files.js";
import { ApprovalState } from "../../src/mcp/approvalState.js";
import { encodeRgbaToPngBuffer } from "../../src/image/png.js";
import { createPolicyToolRegistrar, MUTATING_TOOLS } from "../../src/mcp/toolPolicy.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CommandDispatcher } from "../../src/bridge/dispatcher.js";
import { BRIDGE_PROTOCOL_VERSION } from "../../src/config.js";

describe("Animation Workflow State and Tools - Full Contract Verification", () => {
  let stateTracker: BridgeState;
  let workflowState: AnimationWorkflowState;

  const valid22Categories: Record<string, { status: "pass" | "attention_needed" | "waived"; notes: string }> = {};
  for (const cat of ANIMATION_WORKFLOW_22_CATEGORIES) {
    valid22Categories[cat] = { status: "pass", notes: `Validated ${cat}` };
  }

  const validReferenceEvidence = {
    referenceId: "sha256:abcd1234efgh5678",
    hash: "sha256:abcd1234efgh5678",
    filePath: "C:/project/refs/hero_walk.png",
    fileName: "hero_walk.png",
    projectRelativePath: "refs/hero_walk.png",
    dimensions: { width: 32, height: 48 },
    transparency: {
      hasTransparency: true,
      transparentPixels: 512,
      translucentPixels: 0,
    },
    observedPalette: ["#00000000", "#112233FF", "#FFAA00FF", "#FFFFFFFF"],
    sessionId: "session_abc",
    recordedAt: new Date().toISOString(),
  };

  const validReferenceAnalysis = {
    referenceIdOuPath: "refs/hero_walk.png",
    hash: "sha256:abcd1234efgh5678",
    dimensions: { width: 32, height: 48 },
    transparency: {
      hasTransparency: true,
      transparentPixels: 512,
      translucentPixels: 0,
    },
    observedPalette: ["#00000000", "#112233FF", "#FFAA00FF", "#FFFFFFFF"],
    silhouette: "Chunky heroic silhouette with wide shoulders and narrow waist",
    proportions: "3-head tall chibi hero with oversized boots",
    anatomy: "Jointed humanoid structure with defined elbows and knees",
    accessories: "Shoulder cape and broadsword on back",
    rigidParts: "Chest plate, sword blade, shoulder pauldrons",
    flexibleParts: "Cape hem, boots leather, tunic skirt",
    joints: "Shoulders, elbows, hips, knees, ankles",
    materials: "Burnished iron, coarse linen, boiled leather",
    emissiveRegions: "Runes etched on sword blade glowing orange",
    lightDirection: "Directional light from upper-left (135 degrees)",
    outline: "Dark selective outline (#112233FF), no broken 1px lines",
    deformableRegions: "Knees bend, cape sways with secondary motion",
    stableRegions: "Head volume, chest armor proportions locked",
    allowedColors: ["#00000000", "#112233FF", "#FFAA00FF", "#FFFFFFFF"],
    newColorsJustification: "No new colors added; strictly adheres to reference palette",
  };

  const validPlan = {
    requestedAction: "4-frame walk cycle loop",
    target: { type: "range" as const, frameRange: { from: 1, to: 4 } },
    totalDurationMs: 400,
    plannedFps: 10,
    frameCount: 4,
    loopType: "loop" as const,
    anticipation: "Weight transfers onto front foot with subtle squash",
    contacts: "Frame 1 right contact, Frame 3 left contact",
    extremes: "Maximum stride reach at frame 1 and 3",
    passing: "Frame 2 right passing, Frame 4 left passing",
    recovery: "Straightening leg rebounds body height by 1px",
    keyPoses: [
      { id: "contact_1", name: "Right Contact", role: "key" as const, description: "Right heel strikes" },
      { id: "passing_1", name: "Right Passing", role: "passing" as any, description: "Left leg passes right leg" },
      { id: "contact_2", name: "Left Contact", role: "key" as const, description: "Left heel strikes" },
      { id: "passing_2", name: "Right Passing", role: "passing" as any, description: "Right leg passes left leg" },
    ],
    inBetweenFrames: "Linear easing between contacts and passings",
    motionArcs: "Head bobs gently in a parabolic arc with 1px amplitude",
    rigidRegions: "Torso and head volume locked without skew",
    flexibleRegions: "Cape trails 1 frame behind pelvic movement",
    lightingRules: "Cast shadows follow ground contact baseline",
    paletteRules: "Highlights stay anchored to top-left surfaces",
    completionCriteria: ["Seamless 4-frame loop", "Zero foot sliding", "No orphan pixels"],
  };

  beforeEach(() => {
    stateTracker = new BridgeState();
    stateTracker.handleHello({
      bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION,
      asepriteVersion: "mock",
      apiVersion: 0,
      sessionId: "session_abc",
      revision: 1,
      capabilities: { animationBatch: true, animationGif: true, animationInspection: true },
    });
    stateTracker.setConnected(true, "127.0.0.1");
    stateTracker.updateActiveSprite({
      filename: "C:/sprites/hero.aseprite",
      width: 32,
      height: 48,
      colorMode: "rgb",
      layersCount: 3,
      framesCount: 4,
      activeLayer: "Hero",
      activeFrame: 1,
    });
    workflowState = new AnimationWorkflowState(stateTracker);
    workflowState.registerLoadedReference({ ...validReferenceEvidence, sessionId: "session_abc" });
  });

  describe("Lifecycle, Connection & Sprite Change Resets", () => {
    it("creates workflow with verified session and active sprite; rejects fake defaults", () => {
      const wf = workflowState.createWorkflow({
        name: "Walk Cycle",
        authorId: "animator_1",
        targetSelection: { frameRange: { from: 1, to: 4 } },
        strictCompletionRequired: true,
        sessionId: "session_abc",
        spriteIdentifier: "C:/sprites/hero.aseprite",
        framesCount: 4,
      });

      expect(wf.name).toBe("Walk Cycle");
      expect(wf.sessionId).toBe("session_abc");
      expect(wf.spriteIdentifier).toBe("C:/sprites/hero.aseprite");
      expect(wf.initialFramesCount).toBe(4);
    });

    it("clears workflow state on disconnect", () => {
      workflowState.createWorkflow({
        name: "Walk Cycle",
        authorId: "animator_1",
        targetSelection: { frameRange: { from: 1, to: 4 } },
        strictCompletionRequired: true,
        sessionId: "session_abc",
        spriteIdentifier: "C:/sprites/hero.aseprite",
        framesCount: 4,
      });
      expect(workflowState.getWorkflow()).not.toBeNull();

      stateTracker.setConnected(false);
      expect(workflowState.getWorkflow()).toBeNull();
    });

    it("clears workflow state on session change via hello event", () => {
      workflowState.createWorkflow({
        name: "Walk Cycle",
        authorId: "animator_1",
        targetSelection: { frameRange: { from: 1, to: 4 } },
        strictCompletionRequired: true,
        sessionId: "session_abc",
        spriteIdentifier: "C:/sprites/hero.aseprite",
        framesCount: 4,
      });

      stateTracker.handleHello({
        bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION,
        asepriteVersion: "mock",
        apiVersion: 0,
        sessionId: "session_new",
        revision: 1,
        capabilities: {},
      });

      expect(workflowState.getWorkflow()).toBeNull();
    });

    it("clears workflow state on sprite_change even if filename matches", () => {
      workflowState.createWorkflow({
        name: "Walk Cycle",
        authorId: "animator_1",
        targetSelection: { frameRange: { from: 1, to: 4 } },
        strictCompletionRequired: true,
        sessionId: "session_abc",
        spriteIdentifier: "C:/sprites/hero.aseprite",
        framesCount: 4,
      });
      expect(workflowState.getWorkflow()).not.toBeNull();

      // Trigger sprite_change event with same filename
      stateTracker.updateActiveSprite({
        filename: "C:/sprites/hero.aseprite",
        width: 32,
        height: 48,
        colorMode: "rgb",
        layersCount: 3,
        framesCount: 4,
        activeLayer: "Hero",
        activeFrame: 1,
      });

      expect(workflowState.getWorkflow()).toBeNull();
    });
  });

  describe("Reference Analysis & Animation Plan", () => {
    it("records reference analysis with all 20 required fields", () => {
      workflowState.createWorkflow({
        name: "Walk Cycle",
        authorId: "animator_1",
        targetSelection: { frameRange: { from: 1, to: 4 } },
        strictCompletionRequired: true,
        sessionId: "session_abc",
        spriteIdentifier: "C:/sprites/hero.aseprite",
        framesCount: 4,
      });

      const analysis = workflowState.recordReferenceAnalysis(validReferenceAnalysis);
      expect(analysis.referenceIdOuPath).toBe("refs/hero_walk.png");
      expect(analysis.hash).toBe("sha256:abcd1234efgh5678");
      expect(analysis.dimensions).toEqual({ width: 32, height: 48 });
      expect(analysis.rigidParts).toContain("Chest plate");
      expect(analysis.flexibleParts).toContain("Cape hem");
      expect(analysis.emissiveRegions).toContain("Runes");
      expect(analysis.recordedAt).toBeDefined();
    });

    it("records expanded animation plan and validates coherence (unique IDs, positive timing, valid range)", () => {
      workflowState.createWorkflow({
        name: "Walk Cycle",
        authorId: "animator_1",
        targetSelection: { frameRange: { from: 1, to: 4 } },
        strictCompletionRequired: true,
        sessionId: "session_abc",
        spriteIdentifier: "C:/sprites/hero.aseprite",
        framesCount: 4,
      });

      // Valid plan succeeds
      const plan = workflowState.recordPlan(validPlan as any);
      expect(plan.requestedAction).toBe("4-frame walk cycle loop");
      expect(plan.keyPoses.length).toBe(4);

      // Incoherent plan with duplicate pose IDs fails
      expect(() =>
        workflowState.recordPlan({
          ...validPlan,
          keyPoses: [
            { id: "p1", name: "Pose 1", role: "key", description: "d" },
            { id: "p1", name: "Pose 1 dup", role: "key", description: "d" },
          ],
        } as any)
      ).toThrow(/duplicate pose id/i);

      // Incoherent plan with inverted frame range fails
      expect(() =>
        workflowState.recordPlan({
          ...validPlan,
          target: { type: "range", frameRange: { from: 5, to: 2 } },
        } as any)
      ).toThrow(/from must be <= to/i);

      // Non-positive frameCount fails
      expect(() =>
        workflowState.recordPlan({
          ...validPlan,
          frameCount: 0,
        } as any)
      ).toThrow(/positive integer/i);
    });
  });

  describe("Mark Key Pose & Contract Verification", () => {
    beforeEach(() => {
      workflowState.createWorkflow({
        name: "Walk Cycle",
        authorId: "animator_1",
        targetSelection: { frameRange: { from: 1, to: 4 } },
        strictCompletionRequired: true,
        sessionId: "session_abc",
        spriteIdentifier: "C:/sprites/hero.aseprite",
        framesCount: 4,
      });
      workflowState.recordPlan(validPlan as any);
    });

    it("marks key pose using role and name directly from plan, rejecting invalid pose IDs", () => {
      expect(() =>
        workflowState.markKeyPose({
          poseId: "unknown_pose",
          frameNumber: 1,
          currentFramesCount: 4,
        })
      ).toThrow(/does not exist in the recorded animation plan/i);

      const mark = workflowState.markKeyPose({
        poseId: "contact_1",
        frameNumber: 1,
        currentFramesCount: 4,
      });
      expect(mark.poseId).toBe("contact_1");
      expect(mark.name).toBe("Right Contact");
      expect(mark.role).toBe("key");
      expect(mark.frameNumber).toBe(1);
    });

    it("rejects marking key pose outside sprite framesCount or outside target range", () => {
      expect(() =>
        workflowState.markKeyPose({
          poseId: "contact_1",
          frameNumber: 99,
          currentFramesCount: 4,
        })
      ).toThrow(/outside the active sprite's current frames/i);
    });
  });

  describe("Preview Registration, Revision Parity & Self-Review (22 Categories)", () => {
    beforeEach(() => {
      workflowState.createWorkflow({
        name: "Walk Cycle",
        authorId: "animator_1",
        targetSelection: { frameRange: { from: 1, to: 4 } },
        strictCompletionRequired: true,
        sessionId: "session_abc",
        spriteIdentifier: "C:/sprites/hero.aseprite",
        framesCount: 4,
      });
      workflowState.recordPlan(validPlan as any);
      workflowState.markKeyPose({ poseId: "contact_1", frameNumber: 1, currentFramesCount: 4 });
      workflowState.markKeyPose({ poseId: "passing_1", frameNumber: 2, currentFramesCount: 4 });
      workflowState.markKeyPose({ poseId: "contact_2", frameNumber: 3, currentFramesCount: 4 });
      workflowState.markKeyPose({ poseId: "passing_2", frameNumber: 4, currentFramesCount: 4 });
    });

    it("registers preview evidence and enforces preview registration in review_key_poses", () => {
      // Unregistered preview must throw
      expect(() =>
        workflowState.reviewKeyPoses({
          previewId: "unregistered_prev",
          revision: 1,
        })
      ).toThrow(/not registered/i);

      // Register preview at revision 1
      workflowState.registerPreview({
        previewId: "prev_rev_1",
        revision: 1,
        temporalHash: "hash_deterministic_123",
        playback: { frameNumbers: [1, 2, 3, 4], loop: true },
        recordedAt: new Date().toISOString(),
      });

      // Revision mismatch must throw
      expect(() =>
        workflowState.reviewKeyPoses({
          previewId: "prev_rev_1",
          revision: 2, // Mismatch with current revision (1)
        })
      ).toThrow(/does not match current sprite revision/i);

      // Valid review passes
      const review = workflowState.reviewKeyPoses({
        previewId: "prev_rev_1",
        revision: 1,
        notes: "Poses aligned to baseline",
      });
      expect(review.passed).toBe(true);
    });

    it("requires exactly the 22 categories in self-review and adopts preview's temporalHash", () => {
      workflowState.registerPreview({
        previewId: "prev_rev_1",
        revision: 1,
        temporalHash: "hash_deterministic_123",
        playback: { frameNumbers: [1, 2, 3, 4], loop: true },
        recordedAt: new Date().toISOString(),
      });

      const incomplete = { ...valid22Categories };
      delete (incomplete as any)["first_last_frame_consistency"];

      expect(() =>
        workflowState.recordSelfReview({
          previewId: "prev_rev_1",
          revision: 1,
          categories: incomplete,
          reviewerId: "animator_1",
        })
      ).toThrow(/must cover all 22 categories.*first_last_frame_consistency/i);

      // Complete 22 categories succeeds and adopts hash_deterministic_123
      const selfReview = workflowState.recordSelfReview({
        previewId: "prev_rev_1",
        revision: 1,
        categories: valid22Categories,
        reviewerId: "animator_1",
      });
      expect(selfReview.temporalHash).toBe("hash_deterministic_123");
      expect(Object.keys(selfReview.categories).length).toBe(22);
    });
  });

  describe("Findings Registration, Severity Blocks & Resolution", () => {
    beforeEach(() => {
      workflowState.createWorkflow({
        name: "Walk Cycle",
        authorId: "animator_1",
        targetSelection: { frameRange: { from: 1, to: 4 } },
        strictCompletionRequired: true,
        sessionId: "session_abc",
        spriteIdentifier: "C:/sprites/hero.aseprite",
        framesCount: 4,
      });
      workflowState.recordPlan(validPlan as any);
      workflowState.registerPreview({
        previewId: "prev_rev_1",
        revision: 1,
        temporalHash: "hash_deterministic_123",
        playback: { frameNumbers: [1, 2, 3, 4], loop: true },
        recordedAt: new Date().toISOString(),
      });
    });

    it("accepts structured findings during review_key_poses and blocks review on open critical", () => {
      // Mark all key poses so mapped poses check passes
      workflowState.markKeyPose({ poseId: "contact_1", frameNumber: 1, currentFramesCount: 4 });
      workflowState.markKeyPose({ poseId: "passing_1", frameNumber: 2, currentFramesCount: 4 });
      workflowState.markKeyPose({ poseId: "contact_2", frameNumber: 3, currentFramesCount: 4 });
      workflowState.markKeyPose({ poseId: "passing_2", frameNumber: 4, currentFramesCount: 4 });

      expect(() =>
        workflowState.reviewKeyPoses({
          previewId: "prev_rev_1",
          revision: 1,
          findings: [
            {
              id: "crit_01",
              category: "silhouette",
              severity: "critical",
              frameOrRange: 1,
              description: "Broken silhouette",
              evidence: "Missing leg",
              suggestion: "Redraw",
            },
          ],
        })
      ).toThrow(/open critical finding/i);

      // The finding was registered with status "open"
      const wf = workflowState.getWorkflow()!;
      expect(wf.findings.has("crit_01")).toBe(true);
      expect(wf.findings.get("crit_01")!.status).toBe("open");

      // Resolve finding with justification
      workflowState.resolveFinding("crit_01", { status: "resolved", reason: "Leg redrawn on frame 1" });
      expect(wf.findings.get("crit_01")!.status).toBe("resolved");

      // Review passes now
      expect(workflowState.reviewKeyPoses({ previewId: "prev_rev_1", revision: 1 }).passed).toBe(true);
    });

    it("forbids accepting critical findings; allows accepting high findings with justification", () => {
      workflowState.addFinding({
        id: "crit_02",
        category: "proportions",
        severity: "critical",
        frameOrRange: 2,
        description: "Severely distorted head",
        evidence: "10px width jump",
        suggestion: "Scale head back",
      });

      expect(() =>
        workflowState.resolveFinding("crit_02", { status: "accepted", reason: "Artistic choice" })
      ).toThrow(/cannot accept findings with 'critical' severity/i);

      workflowState.addFinding({
        id: "high_01",
        category: "jitter",
        severity: "high",
        frameOrRange: 3,
        description: "1px sword jitter",
        evidence: "Blade vibrates",
        suggestion: "Lock pixel alignment",
      });

      const accepted = workflowState.resolveFinding("high_01", {
        status: "accepted",
        reason: "Intentional kinetic rumble before strike",
      });
      expect(accepted.status).toBe("accepted");
      expect(accepted.acceptedReason).toContain("kinetic rumble");
    });
  });

  describe("Independent QA Submission in PT-BR & Staleness", () => {
    beforeEach(() => {
      workflowState.createWorkflow({
        name: "Walk Cycle",
        authorId: "author_agent",
        targetSelection: { frameRange: { from: 1, to: 4 } },
        strictCompletionRequired: true,
        sessionId: "session_abc",
        spriteIdentifier: "C:/sprites/hero.aseprite",
        framesCount: 4,
      });
      workflowState.recordReferenceAnalysis(validReferenceAnalysis);
      workflowState.recordPlan(validPlan as any);
      workflowState.registerPreview({
        previewId: "prev_rev_1",
        revision: 1,
        temporalHash: "hash_deterministic_123",
        playback: { frameNumbers: [1, 2, 3, 4], loop: true },
        recordedAt: new Date().toISOString(),
      });
      workflowState.markKeyPose({ poseId: "contact_1", frameNumber: 1, currentFramesCount: 4 });
      workflowState.markKeyPose({ poseId: "passing_1", frameNumber: 2, currentFramesCount: 4 });
      workflowState.markKeyPose({ poseId: "contact_2", frameNumber: 3, currentFramesCount: 4 });
      workflowState.markKeyPose({ poseId: "passing_2", frameNumber: 4, currentFramesCount: 4 });
      workflowState.reviewKeyPoses({ previewId: "prev_rev_1", revision: 1 });
      workflowState.recordSelfReview({
        previewId: "prev_rev_1",
        revision: 1,
        categories: valid22Categories,
        reviewerId: "author_agent",
      });
    });

    it("requires reviewerId != authorId, authorId match, independenceConfirmed, and PT-BR result", () => {
      // authorId mismatch
      expect(() =>
        workflowState.submitQa({
          reviewerId: "qa_agent",
          authorId: "wrong_author",
          independenceConfirmed: true,
          previewId: "prev_rev_1",
          revision: 1,
          result: "aprovado",
          feedback: "Great",
        })
      ).toThrow(/does not match workflow authorId/i);

      // reviewerId === authorId
      expect(() =>
        workflowState.submitQa({
          reviewerId: "author_agent",
          authorId: "author_agent",
          independenceConfirmed: true,
          previewId: "prev_rev_1",
          revision: 1,
          result: "aprovado",
          feedback: "Self approval",
        })
      ).toThrow(/reviewerId to be different from authorId/i);

      // Valid independent submission
      const qa = workflowState.submitQa({
        reviewerId: "qa_agent",
        authorId: "author_agent",
        independenceConfirmed: true,
        previewId: "prev_rev_1",
        revision: 1,
        result: "aprovado",
        feedback: "Independent QA complete: 0 defects found",
      });
      expect(qa.result).toBe("aprovado");
      expect(qa.reviewerId).toBe("qa_agent");
    });

    it("blocks QA approval if unaddressed high findings exist", () => {
      workflowState.addFinding({
        id: "high_99",
        category: "loop_continuity",
        severity: "high",
        frameOrRange: 4,
        description: "Seam pop",
        evidence: "Jump between 4 and 1",
        suggestion: "Match stride",
      });

      expect(() =>
        workflowState.submitQa({
          reviewerId: "qa_agent",
          authorId: "author_agent",
          independenceConfirmed: true,
          previewId: "prev_rev_1",
          revision: 1,
          result: "aprovado",
          feedback: "Attempted approval",
        })
      ).toThrow(/unaddressed high findings/i);
    });

    it("validates full gate completion at current revision and invalidates on revision increment", () => {
      workflowState.submitQa({
        reviewerId: "qa_agent",
        authorId: "author_agent",
        independenceConfirmed: true,
        previewId: "prev_rev_1",
        revision: 1,
        result: "aprovado",
        feedback: "Independent QA pass",
      });

      const gate = workflowState.validateCompletion();
      expect(gate.isComplete).toBe(true);
      expect(gate.gates.referenceAnalyzed.passed).toBe(true);
      expect(gate.gates.currentPreview.passed).toBe(true);
      expect(gate.gates.keyPosesReviewed.passed).toBe(true);
      expect(gate.gates.selfReviewCompleted.passed).toBe(true);
      expect(gate.gates.qaApproved.passed).toBe(true);

      // Revision increments in Aseprite
      stateTracker.setRevision(2);

      const staleGate = workflowState.validateCompletion();
      expect(staleGate.isComplete).toBe(false);
      expect(staleGate.gates.currentPreview.passed).toBe(false);
      expect(staleGate.gates.keyPosesReviewed.passed).toBe(false);
      expect(staleGate.gates.selfReviewCompleted.passed).toBe(false);
      expect(staleGate.gates.qaApproved.passed).toBe(false);
      expect(staleGate.gates.revisionNotStale.passed).toBe(false);
    });

    it("gates a final export with current workflow evidence and blocks it after a mutation", async () => {
      workflowState.submitQa({
        reviewerId: "qa_agent",
        authorId: "author_agent",
        independenceConfirmed: true,
        previewId: "prev_rev_1",
        revision: 1,
        result: "aprovado",
        feedback: "Independent QA pass",
      });

      const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mcp-final-gate-")));
      const previousAllowed = process.env.ASEPRITE_ALLOWED_PATHS;
      const previousProjectRoot = process.env.ASEPRITE_PROJECT_ROOT;
      process.env.ASEPRITE_ALLOWED_PATHS = tempRoot;
      process.env.ASEPRITE_PROJECT_ROOT = tempRoot;
      const commands: string[] = [];
      const registeredTools = new Map<string, any>();
      const fakeServer = {
        tool: (name: string, _description: string, _schema: any, handler: any) => registeredTools.set(name, handler),
      } as unknown as McpServer;
      const fakeDispatcher = {
        send: async (command: string, params: any) => {
          commands.push(command);
          if (command === "inspect_animation") {
            return {
              success: true,
              width: 32,
              height: 48,
              colorMode: "rgb",
              frames: [1, 2, 3, 4].map((frameNumber) => ({ frameNumber, durationMs: 100 })),
              tags: [],
              layers: [],
              revision: 1,
            };
          }
          if (command === "export_png") return { success: true, outputPath: params.outputPath };
          throw new Error(`Unexpected command: ${command}`);
        },
      } as unknown as CommandDispatcher;

      try {
        const approvalState = new ApprovalState();
        const approval = approvalState.record({ decision: "approved", feedback: "QA accepted", revision: 1, sessionId: stateTracker.getSessionId() });
        registerFileTools(fakeServer, fakeDispatcher, stateTracker, workflowState, approvalState);
        const exportAnimation = registeredTools.get("export_animation");
        const success = await exportAnimation({
          format: "png",
          outputPath: "final.png",
          final: true,
          humanApprovalId: approval.approvalId,
        });
        const successPayload = JSON.parse(success.content[0].text);
        expect(success.isError).toBeUndefined();
        expect(successPayload.completionEvidence).toMatchObject({
          workflowId: workflowState.getWorkflow()!.workflowId,
          authorId: "author_agent",
          currentRevision: 1,
          isComplete: true,
          preview: { previewId: "prev_rev_1", revision: 1, temporalHash: "hash_deterministic_123" },
          qa: { reviewerId: "qa_agent", authorId: "author_agent", revision: 1, result: "aprovado" },
        });

        stateTracker.setRevision(2);
        const beforeBlocked = commands.length;
        const blocked = await exportAnimation({
          format: "png",
          outputPath: "stale.png",
          final: true,
        });
        const blockedPayload = JSON.parse(blocked.content[0].text);
        expect(blocked.isError).toBe(true);
        expect(blockedPayload.code).toBe("WORKFLOW_COMPLETION_REQUIRED");
        expect(blockedPayload.failedGateNames).toEqual(expect.arrayContaining([
          "currentPreview",
          "keyPosesReviewed",
          "selfReviewCompleted",
          "qaApproved",
          "revisionNotStale",
        ]));
        expect(commands).toHaveLength(beforeBlocked);
      } finally {
        if (previousAllowed === undefined) delete process.env.ASEPRITE_ALLOWED_PATHS;
        else process.env.ASEPRITE_ALLOWED_PATHS = previousAllowed;
        if (previousProjectRoot === undefined) delete process.env.ASEPRITE_PROJECT_ROOT;
        else process.env.ASEPRITE_PROJECT_ROOT = previousProjectRoot;
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    });
  });

  describe("MCP Tool Layer Integration & Error Handling", () => {
    it("create_animation_workflow returns consistent JSON error when disconnected or without active sprite", async () => {
      const registeredTools = new Map<string, any>();
      const fakeServer = {
        tool: (name: string, description: string, schema: any, handler: any) => {
          registeredTools.set(name, handler);
        },
      } as unknown as McpServer;

      const fakeDispatcher = {} as CommandDispatcher;
      registerWorkflowTools(fakeServer, fakeDispatcher, stateTracker, workflowState);

      // Disconnect
      stateTracker.setConnected(false);
      const res = await registeredTools.get("create_animation_workflow")({
        name: "Test",
        authorId: "author",
        targetSelection: { frameRange: { from: 1, to: 4 } },
        strictCompletionRequired: true,
      });

      expect(res.isError).toBe(true);
      const text = JSON.parse(res.content[0].text);
      expect(text.success).toBe(false);
      expect(text.error).toContain("connected Aseprite bridge session is required");
    });

    it("reset_animation_workflow returns confirmationError when confirm is false", async () => {
      const registeredTools = new Map<string, any>();
      const fakeServer = {
        tool: (name: string, description: string, schema: any, handler: any) => {
          registeredTools.set(name, handler);
        },
      } as unknown as McpServer;

      const fakeDispatcher = {} as CommandDispatcher;
      registerWorkflowTools(fakeServer, fakeDispatcher, stateTracker, workflowState);

      const res = await registeredTools.get("reset_animation_workflow")({ confirm: false });
      expect(res.isError).toBe(true);
      const text = JSON.parse(res.content[0].text);
      expect(text.success).toBe(false);
      expect(text.error).toContain("confirm: true");
    });

    it("registers preview via render_animation_preview and passes previewId to workflow tools", async () => {
      const registeredTools = new Map<string, any>();
      const fakeServer = {
        tool: (name: string, description: string, schema: any, handler: any) => {
          registeredTools.set(name, handler);
        },
      } as unknown as McpServer;

      // Mock dispatcher for animation preview
      const gifBuffer = Buffer.from("GIF89a" + "0".repeat(100));
      const fakeDispatcher = {
        send: async (cmd: string, params: any) => {
          if (cmd === "inspect_animation") {
            return {
              width: 1,
              height: 1,
              colorMode: "rgb",
              frames: [
                { frameNumber: 1, durationMs: 100 },
                { frameNumber: 2, durationMs: 100 },
              ],
              tags: [],
              layers: [],
              revision: 1,
            };
          }
          if (cmd === "render_animation_gif") {
            return {
              gifBase64: gifBuffer.toString("base64"),
              width: 1,
              height: 1,
              durationsMs: [100, 100],
            };
          }
          if (cmd === "get_canvas") {
            // Minimal 1x1 RGBA png
            const pBuf = Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
              "base64"
            );
            return { pngBase64: pBuf.toString("base64"), revision: 1 };
          }
          return {};
        },
      } as unknown as CommandDispatcher;

      registerAnimationInspectionTools(fakeServer, fakeDispatcher, stateTracker, workflowState);
      registerWorkflowTools(fakeServer, fakeDispatcher, stateTracker, workflowState);

      // Render animation preview
      const previewRes = await registeredTools.get("render_animation_preview")({});
      expect(previewRes.isError).toBeUndefined();
      const metadata = JSON.parse(previewRes.content[2].text);
      expect(metadata.previewId).toBeDefined();
      expect(metadata.temporalHash).toBeDefined();

      // Verify preview was registered in workflowState
      const reg = workflowState.getRegisteredPreview(metadata.previewId);
      expect(reg).toBeDefined();
      expect(reg!.temporalHash).toBe(metadata.temporalHash);
    });
  });

  describe("Loaded Reference Registry (32 limit, FIFO eviction, lookup & clearing)", () => {
    it("enforces max limit of 32 references and evicts oldest entries (FIFO)", () => {
      workflowState.clearLoadedReferences();
      expect(workflowState.getLoadedReferences().length).toBe(0);

      // Register 35 distinct references
      for (let i = 0; i < 35; i++) {
        workflowState.registerLoadedReference({
          ...validReferenceEvidence,
          referenceId: `ref_${i}`,
          hash: `hash_${i}`,
          filePath: `C:/refs/hero_${i}.png`,
          fileName: `hero_${i}.png`,
          projectRelativePath: `refs/hero_${i}.png`,
        });
      }

      const refs = workflowState.getLoadedReferences();
      expect(refs.length).toBe(32);

      // Oldest 3 (hash_0, hash_1, hash_2) must have been evicted
      expect(workflowState.getLoadedReference("hash_0")).toBeUndefined();
      expect(workflowState.getLoadedReference("hash_1")).toBeUndefined();
      expect(workflowState.getLoadedReference("hash_2")).toBeUndefined();

      // Recent ones (hash_3..hash_34) must exist
      expect(workflowState.getLoadedReference("hash_3")).toBeDefined();
      expect(workflowState.getLoadedReference("hash_34")).toBeDefined();
    });

    it("retrieves loaded reference by hash, referenceId, filePath, fileName, or projectRelativePath", () => {
      workflowState.clearLoadedReferences();
      workflowState.registerLoadedReference({
        ...validReferenceEvidence,
        referenceId: "custom_ref_id_999",
        hash: "sha256:target_hash_999",
        filePath: "C:/my_project/assets/sprites/boss.png",
        fileName: "boss.png",
        projectRelativePath: "assets/sprites/boss.png",
      });

      expect(workflowState.getLoadedReference("sha256:target_hash_999")).toBeDefined();
      expect(workflowState.getLoadedReference("custom_ref_id_999")?.hash).toBe("sha256:target_hash_999");
      expect(workflowState.getLoadedReference("C:/my_project/assets/sprites/boss.png")?.hash).toBe("sha256:target_hash_999");
      expect(workflowState.getLoadedReference("boss.png")?.hash).toBe("sha256:target_hash_999");
      expect(workflowState.getLoadedReference("assets/sprites/boss.png")?.hash).toBe("sha256:target_hash_999");
      expect(workflowState.getLoadedReference("non_existent")).toBeUndefined();
    });

    it("clears reference registry on bridge disconnect, session change, and sprite change", () => {
      // 1. Clear on disconnect
      workflowState.clearLoadedReferences();
      workflowState.registerLoadedReference(validReferenceEvidence);
      expect(workflowState.getLoadedReferences().length).toBe(1);

      stateTracker.setConnected(false);
      expect(workflowState.getLoadedReferences().length).toBe(0);

      // 2. Clear on session change via hello event
      stateTracker.setConnected(true, "127.0.0.1");
      workflowState.registerLoadedReference(validReferenceEvidence);
      expect(workflowState.getLoadedReferences().length).toBe(1);

      stateTracker.handleHello({
        bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION,
        asepriteVersion: "mock",
        apiVersion: 0,
        sessionId: "session_changed_xyz",
        revision: 1,
        capabilities: {},
      });
      expect(workflowState.getLoadedReferences().length).toBe(0);

      // 3. Clear on sprite change
      workflowState.registerLoadedReference(validReferenceEvidence);
      expect(workflowState.getLoadedReferences().length).toBe(1);

      stateTracker.updateActiveSprite({
        filename: "C:/sprites/different_hero.aseprite",
        width: 32,
        height: 48,
        colorMode: "rgb",
        layersCount: 3,
        framesCount: 4,
        activeLayer: "Hero",
        activeFrame: 1,
      });
      expect(workflowState.getLoadedReferences().length).toBe(0);
    });
  });

  describe("load_reference_image integration with active session & workflowState", () => {
    let tmpDir: string;
    let registeredTools: Map<string, any>;
    let pngPath: string;

    beforeEach(() => {
      tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mcp-ref-workflow-")));
      process.env.ASEPRITE_ALLOWED_PATHS = tmpDir;
      process.env.ASEPRITE_PROJECT_ROOT = tmpDir;

      pngPath = path.join(tmpDir, "test_hero.png");
      const rgba = Uint8Array.from([255, 0, 0, 255, 0, 0, 0, 0]); // 1 red pixel, 1 transparent pixel
      fs.writeFileSync(pngPath, encodeRgbaToPngBuffer(rgba, 2, 1));

      registeredTools = new Map();
      const fakeServer = {
        tool: (name: string, description: string, schema: any, handler: any) => {
          registeredTools.set(name, handler);
        },
      } as unknown as McpServer;

      const fakeDispatcher = {
        send: async () => ({ success: true }),
      } as unknown as CommandDispatcher;

      registerFileTools(fakeServer, fakeDispatcher, stateTracker, workflowState);
    });

    it("registers reference evidence derived from file into workflowState during active session", async () => {
      workflowState.clearLoadedReferences();

      const res = await registeredTools.get("load_reference_image")({
        filePath: pngPath,
      });

      expect(res.isError).toBeUndefined();
      const metadata = JSON.parse(res.content[1].text);
      expect(metadata.recordedInWorkflow).toBe(true);
      expect(metadata.hash).toBeDefined();

      const registered = workflowState.getLoadedReference(metadata.hash);
      expect(registered).toBeDefined();
      expect(registered!.hash).toBe(metadata.hash);
      expect(registered!.dimensions).toEqual({ width: 2, height: 1 });
      expect(registered!.transparency).toEqual({
        hasTransparency: true,
        transparentPixels: 1,
        translucentPixels: 0,
      });
      expect(registered!.observedPalette).toEqual(["#FF0000FF"]);
      expect(registered!.sessionId).toBe("session_abc");
    });

    it("allows standalone generic loading when disconnected without throwing or registering in workflow", async () => {
      stateTracker.setConnected(false);
      workflowState.clearLoadedReferences();

      const res = await registeredTools.get("load_reference_image")({
        filePath: pngPath,
      });

      expect(res.isError).toBeUndefined();
      const metadata = JSON.parse(res.content[1].text);
      expect(metadata.recordedInWorkflow).toBe(false);
      expect(workflowState.getLoadedReferences().length).toBe(0);
    });
  });

  describe("record_reference_analysis strict matching against loaded references", () => {
    beforeEach(() => {
      workflowState.createWorkflow({
        name: "Walk Cycle",
        authorId: "animator_1",
        targetSelection: { frameRange: { from: 1, to: 4 } },
        strictCompletionRequired: true,
        sessionId: "session_abc",
        spriteIdentifier: "C:/sprites/hero.aseprite",
        framesCount: 4,
      });
    });

    it("rejects analysis if reference is not loaded in current session", () => {
      expect(() =>
        workflowState.recordReferenceAnalysis({
          ...validReferenceAnalysis,
          hash: "sha256:not_registered_hash",
        })
      ).toThrow(/does not match loaded reference hash/i);
    });

    it("rejects analysis if dimensions do not match loaded reference", () => {
      expect(() =>
        workflowState.recordReferenceAnalysis({
          ...validReferenceAnalysis,
          dimensions: { width: 64, height: 64 },
        })
      ).toThrow(/dimensions 64x64 do not match/i);
    });

    it("rejects analysis if transparency does not match loaded reference", () => {
      expect(() =>
        workflowState.recordReferenceAnalysis({
          ...validReferenceAnalysis,
          transparency: {
            hasTransparency: false,
            transparentPixels: 0,
            translucentPixels: 0,
          },
        })
      ).toThrow(/transparency does not match/i);
    });

    it("rejects analysis if observedPalette does not match loaded reference", () => {
      expect(() =>
        workflowState.recordReferenceAnalysis({
          ...validReferenceAnalysis,
          observedPalette: ["#00000000", "#999999FF"],
        })
      ).toThrow(/observedPalette does not match/i);
    });
  });

  describe("TargetSelection coverage enforcement in preview reviews", () => {
    beforeEach(() => {
      workflowState.createWorkflow({
        name: "Walk Cycle",
        authorId: "animator_1",
        targetSelection: { frameRange: { from: 1, to: 4 } },
        strictCompletionRequired: true,
        sessionId: "session_abc",
        spriteIdentifier: "C:/sprites/hero.aseprite",
        framesCount: 4,
      });
      workflowState.recordPlan(validPlan as any);
      workflowState.markKeyPose({ poseId: "contact_1", frameNumber: 1, currentFramesCount: 4 });
      workflowState.markKeyPose({ poseId: "passing_1", frameNumber: 2, currentFramesCount: 4 });
      workflowState.markKeyPose({ poseId: "contact_2", frameNumber: 3, currentFramesCount: 4 });
      workflowState.markKeyPose({ poseId: "passing_2", frameNumber: 4, currentFramesCount: 4 });
    });

    it("rejects review_key_poses when preview only covers partial frames of targetSelection", () => {
      workflowState.registerPreview({
        previewId: "partial_prev",
        revision: 1,
        temporalHash: "hash_partial",
        playback: { frameNumbers: [1, 2], loop: true },
        recordedAt: new Date().toISOString(),
      });

      expect(() =>
        workflowState.reviewKeyPoses({
          previewId: "partial_prev",
          revision: 1,
        })
      ).toThrow(/does not cover workflow targetSelection.*Missing frames: 3, 4/i);
    });

    it("rejects record_self_review when preview has extra frames outside targetSelection", () => {
      workflowState.registerPreview({
        previewId: "extra_prev",
        revision: 1,
        temporalHash: "hash_extra",
        playback: { frameNumbers: [1, 2, 3, 4, 5], loop: true },
        recordedAt: new Date().toISOString(),
      });

      expect(() =>
        workflowState.recordSelfReview({
          previewId: "extra_prev",
          revision: 1,
          categories: valid22Categories,
          reviewerId: "animator_1",
        })
      ).toThrow(/does not cover workflow targetSelection.*Extra frames: 5/i);
    });

    it("rejects submit_animation_qa when preview tag does not match workflow tag", () => {
      // Re-create workflow with tagName targetSelection
      workflowState.createWorkflow({
        name: "Walk Cycle",
        authorId: "animator_1",
        targetSelection: { tagName: "Walk" },
        strictCompletionRequired: true,
        sessionId: "session_abc",
        spriteIdentifier: "C:/sprites/hero.aseprite",
        framesCount: 4,
      });

      workflowState.registerPreview({
        previewId: "tag_mismatch_prev",
        revision: 1,
        temporalHash: "hash_tag",
        playback: { frameNumbers: [1, 2, 3, 4], tagName: "Run", loop: true },
        recordedAt: new Date().toISOString(),
      });

      expect(() =>
        workflowState.submitQa({
          reviewerId: "qa_agent",
          authorId: "animator_1",
          independenceConfirmed: true,
          previewId: "tag_mismatch_prev",
          revision: 1,
          result: "aprovado",
          feedback: "Review done",
        })
      ).toThrow(/requires tag 'Walk'/i);
    });
  });

  describe("Animation plan coherence with targetSelection and bounds", () => {
    it("rejects plan when target tag or range is incoherent with targetSelection", () => {
      workflowState.createWorkflow({
        name: "Walk Cycle",
        authorId: "animator_1",
        targetSelection: { tagName: "Walk" },
        strictCompletionRequired: true,
        sessionId: "session_abc",
        spriteIdentifier: "C:/sprites/hero.aseprite",
        framesCount: 4,
      });

      // Target type range when workflow targetSelection is tag
      expect(() =>
        workflowState.recordPlan({
          ...validPlan,
          target: { type: "range", frameRange: { from: 1, to: 4 } },
        } as any)
      ).toThrow(/not coherent with workflow targetSelection tag 'Walk'/i);

      // Target tag Run when workflow targetSelection is tag Walk
      expect(() =>
        workflowState.recordPlan({
          ...validPlan,
          target: { type: "tag", tagName: "Run" },
        } as any)
      ).toThrow(/not coherent with workflow targetSelection tag 'Walk'/i);
    });

    it("rejects plan when frameCount does not match target range or pose targetFrame is outside", () => {
      workflowState.createWorkflow({
        name: "Walk Cycle",
        authorId: "animator_1",
        targetSelection: { frameRange: { from: 1, to: 4 } },
        strictCompletionRequired: true,
        sessionId: "session_abc",
        spriteIdentifier: "C:/sprites/hero.aseprite",
        framesCount: 4,
      });

      // frameCount 6 when range 1..4 requires 4
      expect(() =>
        workflowState.recordPlan({
          ...validPlan,
          frameCount: 6,
        } as any)
      ).toThrow(/frameCount \(6\) is not coherent with target frameRange count \(4\)/i);

      // targetFrame outside range (e.g. 5)
      expect(() =>
        workflowState.recordPlan({
          ...validPlan,
          keyPoses: [
            { id: "p1", name: "Pose 1", role: "key", description: "d", targetFrame: 5 },
          ],
        } as any)
      ).toThrow(/targetFrame \(5\) is outside plan target range \(1..4\)/i);
    });
  });

  describe("Atomic batch findings pre-validation and rollback", () => {
    beforeEach(() => {
      workflowState.createWorkflow({
        name: "Walk Cycle",
        authorId: "animator_1",
        targetSelection: { frameRange: { from: 1, to: 4 } },
        strictCompletionRequired: true,
        sessionId: "session_abc",
        spriteIdentifier: "C:/sprites/hero.aseprite",
        framesCount: 4,
      });
      workflowState.recordPlan(validPlan as any);
      workflowState.markKeyPose({ poseId: "contact_1", frameNumber: 1, currentFramesCount: 4 });
      workflowState.markKeyPose({ poseId: "passing_1", frameNumber: 2, currentFramesCount: 4 });
      workflowState.markKeyPose({ poseId: "contact_2", frameNumber: 3, currentFramesCount: 4 });
      workflowState.markKeyPose({ poseId: "passing_2", frameNumber: 4, currentFramesCount: 4 });
      workflowState.registerPreview({
        previewId: "prev_rev_1",
        revision: 1,
        temporalHash: "hash_deterministic_123",
        playback: { frameNumbers: [1, 2, 3, 4], loop: true },
        recordedAt: new Date().toISOString(),
      });
    });

    it("rejects batch with duplicate finding IDs inside the batch and adds zero findings", () => {
      expect(() =>
        workflowState.reviewKeyPoses({
          previewId: "prev_rev_1",
          revision: 1,
          findings: [
            {
              id: "batch_dup_1",
              category: "silhouette",
              severity: "low",
              frameOrRange: 1,
              description: "Desc 1",
              evidence: "Ev 1",
              suggestion: "Sugg 1",
            },
            {
              id: "batch_dup_1", // Duplicate ID in batch
              category: "spacing",
              severity: "low",
              frameOrRange: 2,
              description: "Desc 2",
              evidence: "Ev 2",
              suggestion: "Sugg 2",
            },
          ],
        })
      ).toThrow(/duplicate finding ID 'batch_dup_1' within the incoming batch/i);

      // Workflow findings must remain 0
      expect(workflowState.getWorkflow()!.findings.size).toBe(0);
    });

    it("rejects batch colliding with an existing finding ID and adds zero findings from the batch", () => {
      workflowState.addFinding({
        id: "existing_finding_01",
        category: "timing",
        severity: "medium",
        frameOrRange: 1,
        description: "Old",
        evidence: "Old",
        suggestion: "Old",
      });
      expect(workflowState.getWorkflow()!.findings.size).toBe(1);

      expect(() =>
        workflowState.recordSelfReview({
          previewId: "prev_rev_1",
          revision: 1,
          categories: valid22Categories,
          reviewerId: "animator_1",
          findings: [
            {
              id: "new_unique_finding",
              category: "timing",
              severity: "medium",
              frameOrRange: 2,
              description: "New",
              evidence: "New",
              suggestion: "New",
            },
            {
              id: "existing_finding_01", // Collision
              category: "timing",
              severity: "medium",
              frameOrRange: 3,
              description: "Collision",
              evidence: "Collision",
              suggestion: "Collision",
            },
          ],
        })
      ).toThrow(/already exists in workflow/i);

      // new_unique_finding must NOT have been added
      expect(workflowState.getWorkflow()!.findings.size).toBe(1);
      expect(workflowState.getWorkflow()!.findings.has("new_unique_finding")).toBe(false);
    });

    it("rejects batch when total findings would exceed MAX_FINDINGS (256)", () => {
      const wf = workflowState.getWorkflow()!;
      // Pre-fill 255 findings
      for (let i = 0; i < 255; i++) {
        workflowState.addFinding({
          id: `bulk_finding_${i}`,
          category: "timing",
          severity: "low",
          frameOrRange: 1,
          description: "d",
          evidence: "e",
          suggestion: "s",
        });
      }
      expect(wf.findings.size).toBe(255);

      // Try adding 2 findings (255 + 2 = 257 > 256)
      expect(() =>
        workflowState.validateAndAddFindingsBatch([
          { id: "overflow_1", category: "timing", severity: "low", frameOrRange: 1, description: "d", evidence: "e", suggestion: "s" },
          { id: "overflow_2", category: "timing", severity: "low", frameOrRange: 1, description: "d", evidence: "e", suggestion: "s" },
        ])
      ).toThrow(/total findings \(257\) would exceed maximum limit of 256/i);

      expect(wf.findings.size).toBe(255);
    });
  });
});
