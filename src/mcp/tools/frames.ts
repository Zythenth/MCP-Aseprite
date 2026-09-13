// src/mcp/tools/frames.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CommandDispatcher } from "../../bridge/dispatcher.js";
import { BridgeState } from "../../bridge/state.js";
import { bridgeToolResult, confirmationError } from "./common.js";

export function registerFrameTools(
  server: McpServer,
  dispatcher: CommandDispatcher,
  stateTracker: BridgeState
): void {
  // list_frames
  server.tool(
    "list_frames",
    "Lists all animation frames with their frame numbers and durations in milliseconds.",
    {},
    async () => {
      try {
        const res = await dispatcher.send<any>("list_frames", {}, 5000);
        return { content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
      }
    }
  );

  // select_frame
  server.tool(
    "select_frame",
    "Changes active frame number in the editor.",
    {
      frameNumber: z.number().int().positive().describe("Frame number to select (1-indexed)"),
    },
    async (params) => {
      try {
        const res = await dispatcher.send<any>("select_frame", params, 5000);
        return { content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
      }
    }
  );

  // create_frame
  server.tool(
    "create_frame",
    "Creates a new blank animation frame after the specified frame or at the end.",
    {
      afterFrame: z.number().int().positive().optional().describe("Insert after this frame number (defaults to end)"),
      duration: z.number().int().positive().optional().default(100).describe("Frame duration in ms (default 100)"),
      returnPreview: z.boolean().optional().default(false),
    },
    async (params) => {
      try {
        const res = await dispatcher.send<any>("create_frame", params, 5000);
        return bridgeToolResult(res, stateTracker, params.returnPreview);
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
      }
    }
  );

  // duplicate_frame
  server.tool(
    "duplicate_frame",
    "Duplicates an existing frame and its cels.",
    {
      frameNumber: z.number().int().positive().describe("Frame number to duplicate (1-indexed)"),
      returnPreview: z.boolean().optional().default(false),
    },
    async (params) => {
      try {
        const res = await dispatcher.send<any>("duplicate_frame", params, 5000);
        return bridgeToolResult(res, stateTracker, params.returnPreview);
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
      }
    }
  );

  // delete_frame
  server.tool(
    "delete_frame",
    "Deletes an animation frame. Requires confirm: true.",
    {
      frameNumber: z.number().int().positive().describe("Frame number to delete (1-indexed)"),
      confirm: z.boolean().describe("Explicit confirmation to delete (must be true)"),
      returnPreview: z.boolean().optional().default(false),
    },
    async (params) => {
      if (!params.confirm) return confirmationError("delete_frame");
      try {
        const res = await dispatcher.send<any>("delete_frame", params, 5000);
        return bridgeToolResult(res, stateTracker, params.returnPreview);
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
      }
    }
  );

  // set_frame_duration
  server.tool(
    "set_frame_duration",
    "Sets duration for a frame in milliseconds.",
    {
      frameNumber: z.number().int().positive().describe("Target frame number"),
      durationMs: z.number().int().positive().describe("Duration in milliseconds"),
      returnPreview: z.boolean().optional().default(false),
    },
    async (params) => {
      try {
        const res = await dispatcher.send<any>("set_frame_duration", params, 5000);
        return bridgeToolResult(res, stateTracker, params.returnPreview);
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
      }
    }
  );

  // create_tag
  server.tool(
    "create_tag",
    "Creates an animation tag for a range of frames (e.g. 'walk', 'idle').",
    {
      name: z.string().describe("Tag name e.g. 'idle', 'run'"),
      fromFrame: z.number().int().positive().describe("Start frame number"),
      toFrame: z.number().int().positive().describe("End frame number"),
      color: z.string().optional().describe("Optional UI color for tag"),
      direction: z.enum(["forward", "reverse", "pingpong", "pingpong_reverse"]).optional().default("forward").describe("Playback direction for the tag"),
      returnPreview: z.boolean().optional().default(false),
    },
    async (params) => {
      try {
        const res = await dispatcher.send<any>("create_tag", params, 5000);
        return bridgeToolResult(res, stateTracker, params.returnPreview);
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
      }
    }
  );

  // list_tags
  server.tool(
    "list_tags",
    "Lists all animation tags defined in the sprite.",
    {},
    async () => {
      try {
        const res = await dispatcher.send<any>("list_tags", {}, 5000);
        return { content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
      }
    }
  );
}
