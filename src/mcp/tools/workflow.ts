/**
 * src/mcp/tools/workflow.ts
 * MCP tools for the animation workflow lifecycle.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CommandDispatcher } from "../../bridge/dispatcher.js";
import type { BridgeState } from "../../bridge/state.js";
import {
  AnimationWorkflowState,
  MAX_FINDINGS,
  type FindingInput,
} from "../animationWorkflowState.js";
import { bridgeToolError, confirmationError } from "./common.js";

const boundsSchema = z
  .object({
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

export const transparencySummarySchema = z
  .object({
    hasTransparency: z.boolean(),
    transparentPixels: z.number().int().nonnegative(),
    translucentPixels: z.number().int().nonnegative(),
  })
  .strict();

const plannedPoseSchema = z
  .object({
    id: z.string().min(1).max(64).describe("Unique pose identifier"),
    name: z.string().min(1).max(128).describe("Name of the pose"),
    role: z.enum(["key", "breakdown", "anticipation", "hold", "inbetween"]),
    description: z.string().min(1).max(1024),
    targetFrame: z.number().int().positive().optional(),
  })
  .strict();

export const findingInputSchema = z
  .object({
    id: z.string().min(1).max(128).describe("Unique finding identifier"),
    category: z.string().min(1).max(128).describe("Finding category"),
    severity: z.enum(["critical", "high", "medium", "low"]),
    frameOrRange: z.union([
      z.number().int().positive(),
      z.string().min(1).max(64),
      z.object({ from: z.number().int().positive(), to: z.number().int().positive() }).strict(),
    ]),
    bounds: boundsSchema.optional(),
    description: z.string().min(1).max(2048),
    evidence: z.string().min(1).max(2048),
    suggestion: z.string().min(1).max(2048),
  })
  .strict();

const targetSelectionSchema = z
  .object({
    tagName: z.string().min(1).max(64).optional(),
    frameRange: z
      .object({
        from: z.number().int().positive(),
        to: z.number().int().positive(),
      })
      .strict()
      .optional(),
    frameNumbers: z.array(z.number().int().positive()).max(256).optional(),
  })
  .strict();

export function registerWorkflowTools(
  server: McpServer,
  _dispatcher: CommandDispatcher,
  stateTracker: BridgeState,
  workflowState: AnimationWorkflowState
): void {
  const syncState = () => {
    workflowState.setContext(
      stateTracker.getSessionId(),
      stateTracker.getActiveSprite()?.filename || null,
      stateTracker.getRevision()
    );
  };

  // 1. create_animation_workflow
  server.tool(
    "create_animation_workflow",
    "Initializes a new animation workflow session requiring a connected bridge and active sprite.",
    {
      name: z.string().min(1).max(128).describe("Name or title of this animation task"),
      authorId: z.string().min(1).max(64).describe("Identifier of the agent or user creating the workflow"),
      targetSelection: targetSelectionSchema.describe("Target tag or frame range selection"),
      strictCompletionRequired: z.boolean().default(true).describe("Enforce full completion gate before completion"),
    },
    async (args) => {
      try {
        syncState();
        if (!stateTracker.isConnected()) {
          return bridgeToolError("A connected Aseprite bridge session is required to create an animation workflow.");
        }
        const sessionId = stateTracker.getSessionId();
        if (!sessionId) {
          return bridgeToolError("No active bridge session ID found.");
        }
        const activeSprite = stateTracker.getActiveSprite();
        if (!activeSprite || !activeSprite.filename) {
          return bridgeToolError("An active sprite document is required to create an animation workflow.");
        }

        const wf = workflowState.createWorkflow({
          name: args.name,
          authorId: args.authorId,
          targetSelection: args.targetSelection,
          strictCompletionRequired: args.strictCompletionRequired,
          sessionId,
          spriteIdentifier: activeSprite.filename,
          framesCount: activeSprite.framesCount,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                workflowId: wf.workflowId,
                name: wf.name,
                authorId: wf.authorId,
                revision: wf.createdRevision,
                sessionId: wf.sessionId,
                sprite: wf.spriteIdentifier,
                initialFramesCount: wf.initialFramesCount,
                strictCompletionRequired: wf.strictCompletionRequired,
              }),
            },
          ],
        };
      } catch (err: any) {
        return bridgeToolError(err);
      }
    }
  );

  // 2. get_animation_workflow
  server.tool(
    "get_animation_workflow",
    "Returns the current compact summary and status of the active animation workflow.",
    {},
    async () => {
      try {
        syncState();
        const wf = workflowState.getWorkflow();
        if (!wf) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ active: false, message: "No active animation workflow." }),
              },
            ],
          };
        }

        const completion = workflowState.validateCompletion();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                active: true,
                workflowId: wf.workflowId,
                name: wf.name,
                authorId: wf.authorId,
                createdRevision: wf.createdRevision,
                currentRevision: workflowState.getRevision(),
                targetSelection: wf.targetSelection,
                hasReferenceAnalysis: Boolean(wf.referenceAnalysis),
                hasPlan: Boolean(wf.plan),
                plannedPosesCount: wf.plan?.keyPoses.length || 0,
                mappedKeyPosesCount: wf.keyPoses.size,
                hasKeyPoseReview: Boolean(wf.keyPoseReview),
                hasSelfReview: Boolean(wf.selfReview),
                qaSubmissionsCount: wf.qaSubmissions.length,
                findingsCount: wf.findings.size,
                unresolvedFindings: completion.unresolvedFindings,
                isComplete: completion.isComplete,
              }),
            },
          ],
        };
      } catch (err: any) {
        return bridgeToolError(err);
      }
    }
  );

  // 3. record_reference_analysis
  server.tool(
    "record_reference_analysis",
    "Records formal visual analysis of a reference image with exact character and design breakdown.",
    {
      referenceIdOuPath: z.string().min(1).max(256).describe("Path or identifier of the reference asset"),
      hash: z.string().min(1).max(128).describe("Deterministic content hash of the reference image"),
      dimensions: z
        .object({
          width: z.number().int().positive().max(8192),
          height: z.number().int().positive().max(8192),
        })
        .strict(),
      transparency: transparencySummarySchema.describe("Structured transparency summary from load_reference_image"),
      observedPalette: z.array(z.string().regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/)).min(1).max(256),
      silhouette: z.string().min(1).max(2048).describe("Silhouette readability and key shapes"),
      proportions: z.string().min(1).max(2048).describe("Character proportions and head-to-body scale"),
      anatomy: z.string().min(1).max(2048).describe("Anatomy, limb connections, musculature"),
      accessories: z.string().min(1).max(2048).describe("Garments, weapons, detached props"),
      rigidParts: z.string().min(1).max(2048).describe("Non-deforming structural components (armor, hilt)"),
      flexibleParts: z.string().min(1).max(2048).describe("Deforming components (cloth, hair, flesh)"),
      joints: z.string().min(1).max(2048).describe("Pivot points and rotational centers"),
      materials: z.string().min(1).max(2048).describe("Surface texture, metal, leather, cloth rendering"),
      emissiveRegions: z.string().min(1).max(2048).describe("Glowing regions or non-shaded accents"),
      lightDirection: z.string().min(1).max(1024).describe("Dominant light vector and ambient bounce"),
      outline: z.string().min(1).max(1024).describe("Outline thickness, selective color outline, AA behavior"),
      deformableRegions: z.string().min(1).max(2048).describe("Regions allowed to stretch or squash"),
      stableRegions: z.string().min(1).max(2048).describe("Regions that must preserve strict rigidity and volume"),
      allowedColors: z.array(z.string().regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/)).min(1).max(256),
      newColorsJustification: z.string().max(2048).optional(),
    },
    async (args) => {
      try {
        syncState();
        const res = workflowState.recordReferenceAnalysis(args);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                referenceIdOuPath: res.referenceIdOuPath,
                hash: res.hash,
                recordedAt: res.recordedAt,
              }),
            },
          ],
        };
      } catch (err: any) {
        return bridgeToolError(err);
      }
    }
  );

  // 4. record_animation_plan
  server.tool(
    "record_animation_plan",
    "Records the expanded animation plan (action, discriminated target, timing, planned key poses, arcs, rules, criteria).",
    {
      requestedAction: z.string().min(1).max(512).describe("Action description (e.g. 4-frame walk cycle)"),
      target: z.discriminatedUnion("type", [
        z
          .object({
            type: z.literal("tag"),
            tagName: z.string().min(1).max(64),
          })
          .strict(),
        z
          .object({
            type: z.literal("range"),
            frameRange: z
              .object({
                from: z.number().int().positive(),
                to: z.number().int().positive(),
              })
              .strict(),
          })
          .strict(),
      ]),
      totalDurationMs: z.number().positive().max(600000).describe("Total animation duration in milliseconds"),
      plannedFps: z.number().positive().max(120).describe("Target framerate"),
      frameCount: z.number().int().positive().max(1024).describe("Planned frame count"),
      loopType: z.enum(["forward", "reverse", "pingpong", "pingpong_reverse", "none", "loop"]),
      anticipation: z.string().min(1).max(2048).describe("Anticipation mechanics and preparatory frames"),
      contacts: z.string().min(1).max(2048).describe("Contact poses and ground interaction"),
      extremes: z.string().min(1).max(2048).describe("Extreme poses and maximum extension/flexion"),
      passing: z.string().min(1).max(2048).describe("Passing positions and limb crossovers"),
      recovery: z.string().min(1).max(2048).describe("Recovery and follow-through frames"),
      keyPoses: z.array(plannedPoseSchema).min(1).max(64).describe("Planned key poses with unique IDs"),
      inBetweenFrames: z.string().min(1).max(2048).describe("In-betweens, cushioning, and easing"),
      motionArcs: z.string().min(1).max(2048).describe("Trajectories and motion arcs"),
      rigidRegions: z.string().min(1).max(2048).describe("Volume-locked structural regions"),
      flexibleRegions: z.string().min(1).max(2048).describe("Squash, stretch, and secondary motion regions"),
      lightingRules: z.string().min(1).max(2048).describe("Highlight and shadow tracking rules across motion"),
      paletteRules: z.string().min(1).max(2048).describe("Color ramp consistency rules"),
      completionCriteria: z.array(z.string().min(1).max(512)).min(1).max(32).describe("Checklist for task completion"),
      authorId: z.string().min(1).max(64).optional(),
    },
    async (args) => {
      try {
        syncState();
        const plan = workflowState.recordPlan(args);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                requestedAction: plan.requestedAction,
                target: plan.target,
                keyPosesCount: plan.keyPoses.length,
                totalDurationMs: plan.totalDurationMs,
                plannedFps: plan.plannedFps,
                recordedAt: plan.recordedAt,
              }),
            },
          ],
        };
      } catch (err: any) {
        return bridgeToolError(err);
      }
    }
  );

  // 5. mark_key_pose
  server.tool(
    "mark_key_pose",
    "Marks a timeline frame as a key pose from the recorded plan. Role and name are inferred directly from the plan.",
    {
      poseId: z.string().min(1).max(64).describe("Pose ID matching a planned pose in record_animation_plan"),
      frameNumber: z.number().int().positive().max(10000).describe("1-indexed timeline frame number"),
      description: z.string().max(1024).optional().describe("Optional note on this realization"),
    },
    async (args) => {
      try {
        syncState();
        const activeSprite = stateTracker.getActiveSprite();
        const currentFramesCount = activeSprite?.framesCount || 10000;
        const mark = workflowState.markKeyPose({
          poseId: args.poseId,
          frameNumber: args.frameNumber,
          currentFramesCount,
          description: args.description,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                poseId: mark.poseId,
                name: mark.name,
                role: mark.role,
                frameNumber: mark.frameNumber,
                markedAt: mark.markedAt,
              }),
            },
          ],
        };
      } catch (err: any) {
        return bridgeToolError(err);
      }
    }
  );

  // 6. review_key_poses
  server.tool(
    "review_key_poses",
    "Reviews key poses against current revision and registered previewId. Accepts structured findings.",
    {
      previewId: z.string().min(1).max(128).describe("Preview ID previously rendered via render_animation_preview"),
      revision: z.number().int().positive().describe("Current sprite revision (must match current Bridge revision)"),
      notes: z.string().max(2048).optional(),
      findings: z.array(findingInputSchema).max(MAX_FINDINGS).optional().describe("Optional structured findings to log"),
    },
    async (args) => {
      try {
        syncState();
        const review = workflowState.reviewKeyPoses({
          previewId: args.previewId,
          revision: args.revision,
          notes: args.notes,
          findings: args.findings as FindingInput[] | undefined,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                passed: review.passed,
                revision: review.revision,
                previewId: review.previewId,
                reviewedAt: review.reviewedAt,
              }),
            },
          ],
        };
      } catch (err: any) {
        return bridgeToolError(err);
      }
    }
  );

  // 7. record_self_review
  const selfReviewCategoryItemSchema = z
    .object({
      status: z.enum(["pass", "attention_needed", "waived"]),
      notes: z.string().min(1).max(1024),
    })
    .strict();

  server.tool(
    "record_self_review",
    "Records author self-review covering all 22 exact categories. Uses preview's temporalHash automatically.",
    {
      previewId: z.string().min(1).max(128).describe("Preview ID previously rendered via render_animation_preview"),
      revision: z.number().int().positive().describe("Current sprite revision (must match current Bridge revision)"),
      selection: boundsSchema.optional().describe("Optional focal bounding box"),
      categories: z
        .record(selfReviewCategoryItemSchema)
        .describe("Evaluation across all 22 exact categories"),
      reviewerId: z.string().min(1).max(64).describe("Identifier of the author conducting self-review"),
      findings: z.array(findingInputSchema).max(MAX_FINDINGS).optional().describe("Optional structured findings to log"),
    },
    async (args) => {
      try {
        syncState();
        const review = workflowState.recordSelfReview({
          previewId: args.previewId,
          revision: args.revision,
          selection: args.selection,
          categories: args.categories,
          reviewerId: args.reviewerId,
          findings: args.findings as FindingInput[] | undefined,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                revision: review.revision,
                previewId: review.previewId,
                temporalHash: review.temporalHash,
                reviewedCategoriesCount: Object.keys(review.categories).length,
                reviewedAt: review.reviewedAt,
              }),
            },
          ],
        };
      } catch (err: any) {
        return bridgeToolError(err);
      }
    }
  );

  // 8. submit_animation_qa
  server.tool(
    "submit_animation_qa",
    "Submits independent QA evaluation. Reviewer must be different from author and confirm independence.",
    {
      reviewerId: z.string().min(1).max(64).describe("Independent reviewer identifier (must not match authorId)"),
      authorId: z.string().min(1).max(64).describe("Author identifier of the workflow (must match workflow.authorId)"),
      independenceConfirmed: z.literal(true).describe("Must confirm true that reviewer is independent of author"),
      previewId: z.string().min(1).max(128).describe("Preview ID previously rendered via render_animation_preview"),
      revision: z.number().int().positive().describe("Current sprite revision (must match current Bridge revision)"),
      result: z.enum(["aprovado", "aprovado_com_ressalvas", "reprovado"]).describe("Evaluation result in PT-BR"),
      feedback: z.string().min(1).max(4096).describe("Detailed QA feedback and observations"),
      findings: z.array(findingInputSchema).max(MAX_FINDINGS).optional().describe("Optional structured findings to log"),
    },
    async (args) => {
      try {
        syncState();
        const qa = workflowState.submitQa({
          reviewerId: args.reviewerId,
          authorId: args.authorId,
          independenceConfirmed: args.independenceConfirmed,
          previewId: args.previewId,
          revision: args.revision,
          result: args.result,
          feedback: args.feedback,
          findings: args.findings as FindingInput[] | undefined,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                reviewerId: qa.reviewerId,
                result: qa.result,
                revision: qa.revision,
                previewId: qa.previewId,
                submittedAt: qa.submittedAt,
              }),
            },
          ],
        };
      } catch (err: any) {
        return bridgeToolError(err);
      }
    }
  );

  // 9. resolve_animation_finding
  server.tool(
    "resolve_animation_finding",
    "Resolves or accepts an animation finding with non-empty justification. Critical severity cannot be accepted.",
    {
      findingId: z.string().min(1).max(128).describe("ID of the finding to resolve or accept"),
      status: z.enum(["resolved", "accepted"]).describe("Target status"),
      reason: z.string().min(1).max(2048).describe("Non-empty justification reason"),
    },
    async (args) => {
      try {
        syncState();
        const finding = workflowState.resolveFinding(args.findingId, {
          status: args.status,
          reason: args.reason,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                findingId: finding.id,
                severity: finding.severity,
                status: finding.status,
                updatedAt: finding.updatedAt,
              }),
            },
          ],
        };
      } catch (err: any) {
        return bridgeToolError(err);
      }
    }
  );

  // 10. validate_animation_completion
  server.tool(
    "validate_animation_completion",
    "Audits all animation workflow completion gates without mutating editor or blocking generic operations.",
    {},
    async () => {
      try {
        syncState();
        const completion = workflowState.validateCompletion();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(completion),
            },
          ],
        };
      } catch (err: any) {
        return bridgeToolError(err);
      }
    }
  );

  // 11. reset_animation_workflow
  server.tool(
    "reset_animation_workflow",
    "Destructively resets the active animation workflow metadata. Requires confirm: true.",
    {
      confirm: z.boolean().describe("Must be true to confirm resetting the animation workflow"),
    },
    async (args) => {
      if (!args.confirm) {
        return confirmationError("reset_animation_workflow");
      }
      try {
        syncState();
        workflowState.clearWorkflow("Manual reset");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true, message: "Animation workflow reset successfully." }),
            },
          ],
        };
      } catch (err: any) {
        return bridgeToolError(err);
      }
    }
  );
}
