import { z } from "zod";
import { bridgeToolError, bridgeToolResult, confirmationError, requireBridgeCapability } from "./common.js";
export function registerFrameTools(server, dispatcher, stateTracker) {
    // list_frames
    server.tool("list_frames", "Lists all animation frames with their frame numbers and durations in milliseconds.", {}, async () => {
        try {
            const res = await dispatcher.send("list_frames", {}, 5000);
            return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
        }
        catch (err) {
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
        }
    });
    // select_frame
    server.tool("select_frame", "Changes active frame number in the editor.", {
        frameNumber: z.number().int().positive().describe("Frame number to select (1-indexed)"),
    }, async (params) => {
        try {
            const res = await dispatcher.send("select_frame", params, 5000);
            return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
        }
        catch (err) {
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
        }
    });
    // create_frame
    server.tool("create_frame", "Creates a new blank animation frame after the specified frame or at the end.", {
        afterFrame: z.number().int().positive().optional().describe("Insert after this frame number (defaults to end)"),
        duration: z.number().int().positive().optional().default(100).describe("Frame duration in ms (default 100)"),
        returnPreview: z.boolean().optional().default(false),
    }, async (params) => {
        try {
            const res = await dispatcher.send("create_frame", params, 5000);
            return bridgeToolResult(res, stateTracker, params.returnPreview);
        }
        catch (err) {
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
        }
    });
    // duplicate_frame
    server.tool("duplicate_frame", "Duplicates an existing frame and its cels.", {
        frameNumber: z.number().int().positive().describe("Frame number to duplicate (1-indexed)"),
        returnPreview: z.boolean().optional().default(false),
    }, async (params) => {
        try {
            const res = await dispatcher.send("duplicate_frame", params, 5000);
            return bridgeToolResult(res, stateTracker, params.returnPreview);
        }
        catch (err) {
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
        }
    });
    // delete_frame
    server.tool("delete_frame", "Deletes an animation frame. Requires confirm: true.", {
        frameNumber: z.number().int().positive().describe("Frame number to delete (1-indexed)"),
        confirm: z.boolean().describe("Explicit confirmation to delete (must be true)"),
        returnPreview: z.boolean().optional().default(false),
    }, async (params) => {
        if (!params.confirm)
            return confirmationError("delete_frame");
        try {
            const res = await dispatcher.send("delete_frame", params, 5000);
            return bridgeToolResult(res, stateTracker, params.returnPreview);
        }
        catch (err) {
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
        }
    });
    // set_frame_duration
    server.tool("set_frame_duration", "Sets duration for a frame in milliseconds.", {
        frameNumber: z.number().int().positive().describe("Target frame number"),
        durationMs: z.number().int().positive().describe("Duration in milliseconds"),
        returnPreview: z.boolean().optional().default(false),
    }, async (params) => {
        try {
            const res = await dispatcher.send("set_frame_duration", params, 5000);
            return bridgeToolResult(res, stateTracker, params.returnPreview);
        }
        catch (err) {
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
        }
    });
    // create_tag
    server.tool("create_tag", "Creates an animation tag for a range of frames (e.g. 'walk', 'idle').", {
        name: z.string().describe("Tag name e.g. 'idle', 'run'"),
        fromFrame: z.number().int().positive().describe("Start frame number"),
        toFrame: z.number().int().positive().describe("End frame number"),
        color: z.string().optional().describe("Optional UI color for tag"),
        direction: z.enum(["forward", "reverse", "pingpong", "pingpong_reverse"]).optional().default("forward").describe("Playback direction for the tag"),
        repeats: z.number().int().min(0).max(65535).optional().default(0).describe("Playback repetitions; 0 means continuous looping"),
        returnPreview: z.boolean().optional().default(false),
    }, async (params) => {
        try {
            const res = await dispatcher.send("create_tag", params, 5000);
            return bridgeToolResult(res, stateTracker, params.returnPreview);
        }
        catch (err) {
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
        }
    });
    // list_tags
    server.tool("list_tags", "Lists all animation tags defined in the sprite.", {}, async () => {
        try {
            const res = await dispatcher.send("list_tags", {}, 5000);
            return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
        }
        catch (err) {
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
        }
    });
    server.tool("move_frame", "Moves one complete frame to a new timeline position and shifts intervening frames in one Undo transaction.", {
        fromFrame: z.number().int().positive(),
        toFrame: z.number().int().positive(),
        returnPreview: z.boolean().optional().default(false),
    }, async (params) => {
        try {
            requireBridgeCapability(stateTracker, "timelineEditing");
            return bridgeToolResult(await dispatcher.send("move_frame", params, 15000), stateTracker, params.returnPreview);
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
    server.tool("set_frame_durations", "Sets up to 256 frame durations atomically, useful for timing and spacing passes. Accepts either Mode A (explicit 'durations' list) or Mode B (range via 'fromFrame', 'toFrame', and 'durationMs').", {
        durations: z.array(z.object({
            frameNumber: z.number().int().positive(),
            durationMs: z.number().int().min(1).max(60000),
        })).min(1).max(256).optional().describe("Mode A: Explicit list of frame numbers and durations (1-256 items)."),
        fromFrame: z.number().int().positive().optional().describe("Mode B: Start frame number (inclusive) of the range."),
        toFrame: z.number().int().positive().optional().describe("Mode B: End frame number (inclusive) of the range."),
        durationMs: z.number().int().min(1).max(60000).optional().describe("Mode B: Duration in milliseconds for all frames in the range."),
        returnPreview: z.boolean().optional().default(false),
    }, async (params) => {
        try {
            const hasDurations = params.durations !== undefined;
            const hasRangePart = params.fromFrame !== undefined || params.toFrame !== undefined || params.durationMs !== undefined;
            if (hasDurations && hasRangePart) {
                throw new Error("Cannot mix 'durations' and range parameters ('fromFrame', 'toFrame', 'durationMs'). Provide exactly one mode.");
            }
            if (!hasDurations && !hasRangePart) {
                throw new Error("Must provide either 'durations' (Mode A) or 'fromFrame', 'toFrame', and 'durationMs' (Mode B).");
            }
            if (hasRangePart && (params.fromFrame === undefined || params.toFrame === undefined || params.durationMs === undefined)) {
                throw new Error("Range mode requires all of 'fromFrame', 'toFrame', and 'durationMs'.");
            }
            requireBridgeCapability(stateTracker, "timelineEditing");
            return bridgeToolResult(await dispatcher.send("set_frame_durations", params, 10000), stateTracker, params.returnPreview);
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
    server.tool("update_tag", "Updates an existing animation tag's name, range, direction, repeats, or UI color atomically.", {
        name: z.string().min(1).max(128).describe("Exact current tag name"),
        newName: z.string().min(1).max(128).optional(),
        fromFrame: z.number().int().positive().optional(),
        toFrame: z.number().int().positive().optional(),
        color: z.string().regex(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i).optional(),
        direction: z.enum(["forward", "reverse", "pingpong", "pingpong_reverse"]).optional(),
        repeats: z.number().int().min(0).max(65535).optional(),
        returnPreview: z.boolean().optional().default(false),
    }, async (params) => {
        try {
            requireBridgeCapability(stateTracker, "timelineEditing");
            return bridgeToolResult(await dispatcher.send("update_tag", params, 10000), stateTracker, params.returnPreview);
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
    server.tool("delete_tag", "Deletes an animation tag without deleting its frames. Requires confirm: true.", {
        name: z.string().min(1).max(128),
        confirm: z.boolean(),
        returnPreview: z.boolean().optional().default(false),
    }, async (params) => {
        if (!params.confirm)
            return confirmationError("delete_tag");
        try {
            requireBridgeCapability(stateTracker, "timelineEditing");
            return bridgeToolResult(await dispatcher.send("delete_tag", params, 10000), stateTracker, params.returnPreview);
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
}
//# sourceMappingURL=frames.js.map