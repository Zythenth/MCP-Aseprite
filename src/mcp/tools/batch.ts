import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CommandDispatcher } from "../../bridge/dispatcher.js";
import type { BridgeState } from "../../bridge/state.js";
import {
  MAX_PIXELS_BATCH,
  MAX_ANIMATION_BATCH_OPERATIONS,
  MAX_ANIMATION_BATCH_FRAMES,
  MAX_ANIMATION_BATCH_PAYLOAD_BYTES,
} from "../../config.js";
import { bridgeToolError, bridgeToolResult, requireBridgeCapability } from "./common.js";

const layerSelector = {
  layerName: z.string().min(1).max(128).optional().describe("Target layer name; mutually exclusive with layerIndex"),
  layerIndex: z.number().int().min(0).optional().describe("Target flattened layer index; mutually exclusive with layerName"),
};

const frameSelector = {
  frameNumber: z.number().int().positive().optional().describe("Target frame (1-indexed; defaults to active frame)"),
};

export const batchOperationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("set_pixels"),
    pixels: z.array(
      z.object({
        x: z.number().int().describe("X coordinate in canvas space (0-indexed)"),
        y: z.number().int().describe("Y coordinate in canvas space (0-indexed)"),
        color: z.string().describe("Hex color e.g. #FF0000FF, #363636FF, or #00000000"),
      })
    ).min(1).max(MAX_PIXELS_BATCH).describe("Batch of pixel coordinates and hex colors to paint"),
    ...layerSelector,
    ...frameSelector,
  }),
  z.object({
    op: z.literal("erase_pixels"),
    points: z.array(
      z.object({
        x: z.number().int().describe("X coordinate in canvas space"),
        y: z.number().int().describe("Y coordinate in canvas space"),
      })
    ).min(1).max(MAX_PIXELS_BATCH).describe("List of (x, y) pixel coordinates to erase"),
    ...layerSelector,
    ...frameSelector,
  }),
  z.object({
    op: z.literal("set_cel_position"),
    x: z.number().int().describe("Target absolute X coordinate"),
    y: z.number().int().describe("Target absolute Y coordinate"),
    ...layerSelector,
    ...frameSelector,
  }),
  z.object({
    op: z.literal("set_cel_opacity"),
    opacity: z.number().int().min(0).max(255).describe("Target opacity (0-255)"),
    ...layerSelector,
    ...frameSelector,
  }),
  z.object({
    op: z.literal("set_frame_duration"),
    frameNumber: z.number().int().positive().describe("Target frame number (1-indexed)"),
    durationMs: z.number().int().min(1).max(60000).describe("Duration in milliseconds (1..60000)"),
  }),
]);

export type BatchOperation = z.infer<typeof batchOperationSchema>;

export const batchOperationsArraySchema = z
  .array(batchOperationSchema)
  .min(1)
  .max(MAX_ANIMATION_BATCH_OPERATIONS);

export function registerBatchTools(
  server: McpServer,
  dispatcher: CommandDispatcher,
  stateTracker: BridgeState
): void {
  server.tool(
    "batch_animation_edits",
    "Executes an atomic batch of animation edits across frames and cels in a single transaction.",
    {
      operations: batchOperationsArraySchema.describe(
        "Atomic array of animation edit operations (1..64)"
      ),
      returnPreview: z
        .boolean()
        .optional()
        .default(false)
        .describe("When true, returns updated preview image"),
    },
    async (params) => {
      try {
        requireBridgeCapability(stateTracker, "animationBatch");

        const ops = params.operations;

        // Verify payload byte size in UTF-8
        const payloadJson = JSON.stringify(params);
        const payloadBytes = Buffer.byteLength(payloadJson, "utf8");
        if (payloadBytes > MAX_ANIMATION_BATCH_PAYLOAD_BYTES) {
          throw new Error(
            `Batch payload size (${payloadBytes} bytes) exceeds safety limit of ${MAX_ANIMATION_BATCH_PAYLOAD_BYTES} bytes (4 MiB).`
          );
        }

        // Verify total pixels and points count across all operations
        let totalPixelsOrPoints = 0;
        const touchedFrames = new Set<number>();

        for (const op of ops) {
          if (op.op === "set_pixels") {
            totalPixelsOrPoints += op.pixels.length;
          } else if (op.op === "erase_pixels") {
            totalPixelsOrPoints += op.points.length;
          }

          if ("frameNumber" in op && typeof op.frameNumber === "number") {
            touchedFrames.add(op.frameNumber);
          }
        }

        if (totalPixelsOrPoints > MAX_PIXELS_BATCH) {
          throw new Error(
            `Total pixels/points across batch operations (${totalPixelsOrPoints}) exceeds safety limit of ${MAX_PIXELS_BATCH}.`
          );
        }

        if (touchedFrames.size > MAX_ANIMATION_BATCH_FRAMES) {
          throw new Error(
            `Batch affects ${touchedFrames.size} unique frames, exceeding limit of ${MAX_ANIMATION_BATCH_FRAMES}.`
          );
        }

        const res = await dispatcher.send<any>("batch_animation_edits", params, 30000);
        return bridgeToolResult(res, stateTracker, params.returnPreview);
      } catch (error) {
        return bridgeToolError(error);
      }
    }
  );
}
