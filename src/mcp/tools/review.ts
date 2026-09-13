import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CommandDispatcher } from "../../bridge/dispatcher.js";
import { BridgeState } from "../../bridge/state.js";
import { compareFrames } from "../../image/animation.js";
import { decodePngBase64Sync, encodeRgbaToPngBase64 } from "../../image/png.js";
import { ReviewState } from "../reviewState.js";
import { bridgeToolError, confirmationError } from "./common.js";

const lintRule = z.enum(["orphan_pixel", "broken_outline", "banding", "pillow_shading", "symmetry_drift", "tile_seam"]);

function requireSession(state: BridgeState): string {
  const sessionId = state.getSessionId();
  if (!sessionId) throw new Error("Aseprite bridge session is not connected.");
  return sessionId;
}

export function registerReviewTools(
  server: McpServer,
  dispatcher: CommandDispatcher,
  state: BridgeState,
  reviews: ReviewState
): void {
  server.tool(
    "create_review_checkpoint",
    "Captures an in-memory visual checkpoint for the current Aseprite bridge session. Checkpoints support later comparison and do not modify or save the sprite.",
    {
      label: z.string().min(1).max(120),
      frameNumber: z.number().int().positive().optional(),
      layerName: z.string().optional(),
    },
    async (params) => {
      try {
        const sessionId = requireSession(state);
        const result = await dispatcher.send<any>("get_canvas", {
          frameIndex: params.frameNumber,
          layerName: params.layerName,
        }, 10_000);
        if (typeof result.revision === "number") state.setRevision(result.revision);
        const checkpoint = reviews.addCheckpoint({
          label: params.label,
          sessionId,
          revision: result.revision ?? state.getRevision(),
          frameNumber: result.frameNumber,
          layerName: params.layerName,
          image: decodePngBase64Sync(result.pngBase64),
        });
        const { image, ...metadata } = checkpoint;
        return { content: [{ type: "text" as const, text: JSON.stringify({ ...metadata, width: image.width, height: image.height }, null, 2) }] };
      } catch (error) {
        return bridgeToolError(error);
      }
    }
  );

  server.tool(
    "list_review_checkpoints",
    "Lists in-memory visual checkpoints for the current bridge session.",
    {},
    async () => {
      try {
        return { content: [{ type: "text" as const, text: JSON.stringify({ checkpoints: reviews.listCheckpoints(requireSession(state)) }, null, 2) }] };
      } catch (error) {
        return bridgeToolError(error);
      }
    }
  );

  server.tool(
    "compare_review_checkpoint",
    "Compares the current rendered frame with an in-memory checkpoint and returns a highlighted diff image, exact changed-pixel count, and bounds.",
    {
      checkpointId: z.string().uuid(),
      threshold: z.number().int().min(0).max(255).optional().default(0),
    },
    async (params) => {
      try {
        const sessionId = requireSession(state);
        const checkpoint = reviews.getCheckpoint(params.checkpointId);
        if (!checkpoint) throw new Error("Review checkpoint not found.");
        if (checkpoint.sessionId !== sessionId) throw new Error("Checkpoint belongs to a different Aseprite bridge session.");
        const result = await dispatcher.send<any>("get_canvas", {
          frameIndex: checkpoint.frameNumber,
          layerName: checkpoint.layerName,
        }, 10_000);
        if (typeof result.revision === "number") state.setRevision(result.revision);
        const diff = compareFrames(checkpoint.image, decodePngBase64Sync(result.pngBase64), params.threshold ?? 0);
        const encoded = encodeRgbaToPngBase64(diff.data, diff.width, diff.height);
        return { content: [
          { type: "image" as const, data: encoded.base64, mimeType: "image/png" },
          { type: "text" as const, text: JSON.stringify({
            checkpointId: checkpoint.id,
            checkpointRevision: checkpoint.revision,
            currentRevision: result.revision,
            frameNumber: checkpoint.frameNumber,
            layerName: checkpoint.layerName,
            changedPixels: diff.changedPixels,
            changeRatio: diff.changeRatio,
            bounds: diff.bounds,
            threshold: params.threshold ?? 0,
          }, null, 2) },
        ] };
      } catch (error) {
        return bridgeToolError(error);
      }
    }
  );

  server.tool(
    "delete_review_checkpoint",
    "Deletes one in-memory review checkpoint. Requires confirm: true.",
    { checkpointId: z.string().uuid(), confirm: z.boolean() },
    async (params) => {
      if (!params.confirm) return confirmationError("delete_review_checkpoint");
      const checkpoint = reviews.getCheckpoint(params.checkpointId);
      if (!checkpoint || checkpoint.sessionId !== state.getSessionId()) return bridgeToolError(new Error("Review checkpoint not found."));
      return { content: [{ type: "text" as const, text: JSON.stringify({ success: reviews.deleteCheckpoint(params.checkpointId), checkpointId: params.checkpointId }, null, 2) }] };
    }
  );

  server.tool(
    "add_lint_waiver",
    "Records an explicit, reasoned waiver for a pixel-art lint finding in the current bridge session.",
    {
      rule: lintRule,
      reason: z.string().min(3).max(500),
      frameNumber: z.number().int().positive().optional(),
      layerName: z.string().optional(),
      x: z.number().int().min(0).optional(),
      y: z.number().int().min(0).optional(),
    },
    async (params) => {
      try {
        const waiver = reviews.addWaiver({ ...params, sessionId: requireSession(state) });
        return { content: [{ type: "text" as const, text: JSON.stringify(waiver, null, 2) }] };
      } catch (error) {
        return bridgeToolError(error);
      }
    }
  );

  server.tool(
    "list_lint_waivers",
    "Lists explicit pixel-art lint waivers for the current bridge session.",
    {},
    async () => {
      try {
        return { content: [{ type: "text" as const, text: JSON.stringify({ waivers: reviews.listWaivers(requireSession(state)) }, null, 2) }] };
      } catch (error) {
        return bridgeToolError(error);
      }
    }
  );

  server.tool(
    "delete_lint_waiver",
    "Deletes an explicit lint waiver. Requires confirm: true.",
    { waiverId: z.string().uuid(), confirm: z.boolean() },
    async (params) => {
      if (!params.confirm) return confirmationError("delete_lint_waiver");
      const waiver = reviews.listWaivers(state.getSessionId() ?? undefined).find((item) => item.id === params.waiverId);
      if (!waiver) return bridgeToolError(new Error("Lint waiver not found."));
      return { content: [{ type: "text" as const, text: JSON.stringify({ success: reviews.deleteWaiver(params.waiverId), waiverId: params.waiverId }, null, 2) }] };
    }
  );
}
