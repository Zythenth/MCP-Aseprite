import { z } from "zod";
import { composeFilmstrip } from "../../image/animation.js";
import { decodeBridgeCanvas } from "../../image/bridgeCanvas.js";
import { encodeRgbaToPngBase64 } from "../../image/png.js";
import { LIVE_PAINTING_STAGES, } from "../livePaintingState.js";
import { bridgeToolError, confirmationError } from "./common.js";
const stageSchema = z.enum(LIVE_PAINTING_STAGES);
const speedSchema = z.enum(["slow", "normal", "fast"]);
function requireConnectedSprite(state) {
    if (!state.isConnected())
        throw new Error("A connected Aseprite bridge session is required for live painting.");
    const sessionId = state.getSessionId();
    const sprite = state.getActiveSprite();
    if (!sessionId || !sprite?.filename)
        throw new Error("An active Aseprite sprite is required for live painting.");
    return { sessionId, spriteIdentifier: sprite.filename };
}
async function refreshStatus(dispatcher, state) {
    const status = await dispatcher.send("aseprite_status", {}, 5_000);
    state.applyStatus(status, state.getClientAddress() ?? undefined);
}
function textResult(value) {
    return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}
async function captureCanvas(dispatcher, state, frameNumber, layerName) {
    const result = await dispatcher.send("get_canvas", { frameIndex: frameNumber, layerName }, 10_000);
    if (typeof result.revision === "number")
        state.setRevision(result.revision);
    return {
        frameNumber: result.frameNumber,
        layerName,
        revision: typeof result.revision === "number" ? result.revision : state.getRevision(),
        image: decodeBridgeCanvas(result),
    };
}
export function registerLivePaintingTools(server, dispatcher, state, livePainting) {
    server.tool("start_live_painting", "Starts an observable live pixel-art process. It captures the initial canvas, then only one atomic Aseprite mutation is allowed per declared stage so each completed stage can be safely undone and reviewed.", {
        title: z.string().min(1).max(120),
        speed: speedSchema.optional().default("normal").describe("Display pacing hint: slow (900ms), normal (350ms), or fast (100ms) between completed stages"),
        commentaryMode: z.boolean().optional().default(false).describe("Require a short explanation for every stage"),
        stages: z.array(stageSchema).min(1).max(LIVE_PAINTING_STAGES.length).optional().default([...LIVE_PAINTING_STAGES]),
        frameNumber: z.number().int().positive().optional().describe("Frame captured as the initial visual state"),
        layerName: z.string().min(1).max(256).optional().describe("Optional isolated layer for the initial visual state"),
    }, async (params) => {
        try {
            await refreshStatus(dispatcher, state);
            const binding = requireConnectedSprite(state);
            const initial = await captureCanvas(dispatcher, state, params.frameNumber, params.layerName);
            const run = livePainting.start({
                title: params.title,
                ...binding,
                revision: initial.revision,
                speed: params.speed,
                commentaryMode: params.commentaryMode,
                stageOrder: params.stages,
                initialSnapshot: initial,
            });
            const snapshot = livePainting.getReplayImages()[0];
            return {
                content: [
                    { type: "image", data: encodeRgbaToPngBase64(snapshot.image.data, snapshot.image.width, snapshot.image.height).base64, mimeType: "image/png" },
                    { type: "text", text: JSON.stringify({ success: true, livePaintingId: run.id, livePainting: livePainting.getSummary(), initialSnapshotId: snapshot.id }, null, 2) },
                ],
            };
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
    server.tool("get_live_painting_status", "Returns live painting controls, current stage, next stage, and the recommended delay for the selected speed.", {}, async () => textResult({ active: Boolean(livePainting.getSummary()), livePainting: livePainting.getSummary() }));
    server.tool("begin_live_painting_stage", "Opens the next planned live painting stage. Paint exactly one atomic Aseprite operation, inspect it in the editor, then complete the stage to capture its PNG snapshot.", {
        stage: stageSchema,
        description: z.string().min(1).max(1000),
        comment: z.string().min(1).max(500).optional(),
    }, async (params) => {
        try {
            const stage = livePainting.beginStage({ name: params.stage, description: params.description, comment: params.comment });
            return textResult({ success: true, stage, recommendedDelayMs: livePainting.getSummary().recommendedDelayMs });
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
    server.tool("complete_live_painting_stage", "Captures the current Aseprite canvas as a PNG snapshot after the active stage. The returned image is the visual proof for this stage.", {
        frameNumber: z.number().int().positive().optional(),
        layerName: z.string().min(1).max(256).optional(),
    }, async (params) => {
        try {
            const captured = await captureCanvas(dispatcher, state, params.frameNumber, params.layerName);
            const stage = livePainting.completeStage(captured);
            const snapshot = livePainting.getSnapshot(stage.snapshotId);
            if (!snapshot)
                throw new Error("Live painting snapshot was not retained.");
            return {
                content: [
                    { type: "image", data: encodeRgbaToPngBase64(snapshot.image.data, snapshot.image.width, snapshot.image.height).base64, mimeType: "image/png" },
                    { type: "text", text: JSON.stringify({ success: true, stage, snapshot: { ...snapshot, image: undefined }, livePainting: livePainting.getSummary() }, null, 2) },
                ],
            };
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
    server.tool("pause_live_painting", "Pauses a live painting process. While paused, all Aseprite mutations are blocked until it is continued or cancelled.", {}, async () => {
        try {
            return textResult({ success: true, livePainting: livePainting.pause() });
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
    server.tool("continue_live_painting", "Continues a paused live painting process.", {}, async () => {
        try {
            return textResult({ success: true, livePainting: livePainting.continue() });
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
    server.tool("set_live_painting_speed", "Changes the pacing hint for subsequent live painting stages without changing the sprite.", { speed: speedSchema }, async (params) => {
        try {
            return textResult({ success: true, livePainting: livePainting.setSpeed(params.speed) });
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
    server.tool("cancel_live_painting", "Stops live painting and unlocks normal editing. Completed artwork is deliberately retained; cancellation never silently rolls it back.", { confirm: z.boolean() }, async (params) => {
        if (!params.confirm)
            return confirmationError("cancel_live_painting");
        try {
            return textResult({ success: true, artworkRetained: true, livePainting: livePainting.cancel() });
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
    server.tool("undo_live_painting_stage", "Undoes the complete most recently captured live painting stage. Every stage has exactly one atomic Aseprite mutation, so this operation is a single reliable undo.", { confirm: z.boolean() }, async (params) => {
        if (!params.confirm)
            return confirmationError("undo_live_painting_stage");
        try {
            livePainting.getLastUndoableStage();
            const result = await dispatcher.send("undo", { returnPreview: false }, 10_000);
            if (typeof result.revision === "number")
                state.setRevision(result.revision);
            const undone = livePainting.confirmUndoLastStage();
            return textResult({ success: true, undoneStage: undone, undoResult: result, livePainting: livePainting.getSummary() });
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
    server.tool("finish_live_painting", "Marks the live painting process complete after every planned stage has a captured visual snapshot.", {}, async () => {
        try {
            return textResult({ success: true, livePainting: livePainting.complete() });
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
    server.tool("list_live_painting_snapshots", "Lists the initial canvas and every completed-stage PNG snapshot retained for the current live painting process.", {}, async () => textResult({ snapshots: livePainting.listSnapshots() }));
    server.tool("get_live_painting_snapshot", "Returns one retained PNG snapshot from the live painting visual log.", { snapshotId: z.string().uuid() }, async (params) => {
        try {
            const snapshot = livePainting.getSnapshot(params.snapshotId);
            if (!snapshot)
                throw new Error("Live painting snapshot not found.");
            return {
                content: [
                    { type: "image", data: encodeRgbaToPngBase64(snapshot.image.data, snapshot.image.width, snapshot.image.height).base64, mimeType: "image/png" },
                    { type: "text", text: JSON.stringify({ ...snapshot, image: undefined }, null, 2) },
                ],
            };
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
    server.tool("render_live_painting_replay", "Renders the retained visual log as an ordered PNG filmstrip from the initial canvas through each completed stage.", {
        columns: z.number().int().min(1).max(MAX_SNAPSHOT_COLUMNS).optional().default(4),
        gap: z.number().int().min(0).max(32).optional().default(1),
    }, async (params) => {
        try {
            const snapshots = livePainting.getReplayImages();
            if (snapshots.length === 0)
                throw new Error("No live painting snapshots are available.");
            const filmstrip = composeFilmstrip(snapshots.map((snapshot) => snapshot.image), params.columns, params.gap);
            return {
                content: [
                    { type: "image", data: encodeRgbaToPngBase64(filmstrip.data, filmstrip.width, filmstrip.height).base64, mimeType: "image/png" },
                    { type: "text", text: JSON.stringify({ snapshots: snapshots.map(({ image, ...snapshot }) => ({ ...snapshot, width: image.width, height: image.height })), columns: Math.min(params.columns, snapshots.length), gap: params.gap, width: filmstrip.width, height: filmstrip.height }, null, 2) },
                ],
            };
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
}
const MAX_SNAPSHOT_COLUMNS = 16;
//# sourceMappingURL=livePainting.js.map