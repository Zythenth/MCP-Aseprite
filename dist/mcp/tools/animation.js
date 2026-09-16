import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { composeFilmstrip, composeOnionSkin, compareFrames } from "../../image/animation.js";
import { encodeRgbaToPngBase64 } from "../../image/png.js";
import { decodeBridgeCanvas } from "../../image/bridgeCanvas.js";
import { scaleNearestNeighbor } from "../../image/scaling.js";
import { computeCanonicalTemporalHash, analyzeAnimationTemporalPure, MAX_ANALYSIS_FRAMES, MAX_RIGID_REGIONS, MAX_CONTACT_POINTS, } from "../../image/temporalAnalysis.js";
import { resolveAnimationPlayback, } from "../animationSelection.js";
import { bridgeToolError, requireBridgeCapability } from "./common.js";
const MAX_FILMSTRIP_FRAMES = 64;
const MAX_RENDERED_PIXELS = 16_777_216;
const MAX_AGGREGATE_INPUT_PIXELS = 67_108_864;
const MAX_GIF_PREVIEW_BYTES = 10 * 1024 * 1024;
const animationDirectionSchema = z.enum(["forward", "reverse", "pingpong", "pingpong_reverse"]);
export function assertAnimationPixelBudget(width, height, frameCount, scale) {
    const inputPixels = width * height * frameCount;
    const outputPixels = width * scale * height * scale;
    if (!Number.isSafeInteger(inputPixels) || inputPixels > MAX_AGGREGATE_INPUT_PIXELS) {
        throw new Error(`Animation inputs exceed the ${MAX_AGGREGATE_INPUT_PIXELS.toLocaleString()} pixel safety limit.`);
    }
    if (!Number.isSafeInteger(outputPixels) || outputPixels > MAX_RENDERED_PIXELS) {
        throw new Error(`Rendered image exceeds the ${MAX_RENDERED_PIXELS.toLocaleString()} pixel safety limit.`);
    }
}
function scaledImage(image, scale) {
    assertAnimationPixelBudget(image.width, image.height, 1, scale);
    if (scale === 1)
        return image;
    const scaled = scaleNearestNeighbor(image.data, image.width, image.height, scale);
    return { width: scaled.width, height: scaled.height, data: scaled.data };
}
async function fetchFrame(dispatcher, state, frameNumber) {
    const result = await dispatcher.send("get_canvas", { frameIndex: frameNumber }, 10_000);
    if (typeof result.revision === "number")
        state.setRevision(result.revision);
    try {
        return decodeBridgeCanvas(result);
    }
    catch (error) {
        throw new Error(`Frame ${frameNumber} did not return valid canvas data: ${error instanceof Error ? error.message : String(error)}`);
    }
}
async function getFrameContext(dispatcher, state) {
    const info = await dispatcher.send("get_sprite_info", {}, 5_000);
    if (typeof info.revision === "number")
        state.setRevision(info.revision);
    const frameCount = Array.isArray(info.frames) ? info.frames.length : 0;
    if (frameCount < 1)
        throw new Error("The active sprite has no animation frames.");
    return {
        frameCount,
        activeFrame: Number(info.activeFrame) || 1,
        width: Number(info.width),
        height: Number(info.height),
    };
}
function imageToolResult(image, metadata) {
    const encoded = encodeRgbaToPngBase64(image.data, image.width, image.height);
    return {
        content: [
            { type: "image", data: encoded.base64, mimeType: "image/png" },
            { type: "text", text: JSON.stringify({ ...metadata, width: image.width, height: image.height }, null, 2) },
        ],
    };
}
function requireAnimationCapability(state, name) {
    requireBridgeCapability(state, name);
}
async function fetchAnimationInspection(dispatcher, state) {
    requireAnimationCapability(state, "animationInspection");
    const inspection = await dispatcher.send("inspect_animation", {}, 10_000);
    if (typeof inspection.revision === "number")
        state.setRevision(inspection.revision);
    if (!Number.isInteger(inspection.width) || !Number.isInteger(inspection.height)
        || inspection.width < 1 || inspection.height < 1
        || !Array.isArray(inspection.frames) || !Array.isArray(inspection.tags) || !Array.isArray(inspection.layers)) {
        throw new Error("Aseprite returned invalid animation inspection metadata.");
    }
    return inspection;
}
async function fetchPlaybackFrames(dispatcher, state, frameNumbers) {
    const unique = [...new Set(frameNumbers)];
    const cache = new Map();
    for (let offset = 0; offset < unique.length; offset += 8) {
        const batch = unique.slice(offset, offset + 8);
        const frames = await Promise.all(batch.map((frameNumber) => fetchFrame(dispatcher, state, frameNumber)));
        batch.forEach((frameNumber, index) => cache.set(frameNumber, frames[index]));
    }
    return frameNumbers.map((frameNumber) => cache.get(frameNumber));
}
function animationSelectionSchema() {
    return {
        tagName: z.string().min(1).max(128).optional().describe("Exact animation tag name"),
        tag: z.string().min(1).max(128).optional().describe("Alias for tagName; do not provide both"),
        fromFrame: z.number().int().positive().optional(),
        toFrame: z.number().int().positive().optional(),
        direction: animationDirectionSchema.optional().describe("Optional playback-direction override"),
    };
}
function normalizeAnimationSelection(params) {
    if (params.tagName && params.tag && params.tagName !== params.tag) {
        throw new Error("tag and tagName must match when both are provided.");
    }
    return { ...params, tagName: params.tagName ?? params.tag };
}
export function registerAnimationInspectionTools(server, dispatcher, state, workflowState) {
    server.tool("inspect_animation", "Returns structured temporal metadata for the full sprite and a selected tag or frame range, including timing, playback order, loops, layers, and cel coverage.", animationSelectionSchema(), async (params) => {
        try {
            const inspection = await fetchAnimationInspection(dispatcher, state);
            const playback = resolveAnimationPlayback(inspection, normalizeAnimationSelection(params));
            return { content: [{ type: "text", text: JSON.stringify({
                            success: true,
                            width: inspection.width,
                            height: inspection.height,
                            colorMode: inspection.colorMode,
                            frameCount: inspection.frames.length,
                            totalLayers: inspection.totalLayers ?? null,
                            totalCels: inspection.totalCels ?? null,
                            frames: inspection.frames,
                            tags: inspection.tags,
                            layers: inspection.layers,
                            playback,
                            loopBoundary: playback.frameNumbers.length > 1 ? {
                                lastSequenceFrame: playback.frameNumbers.at(-1),
                                firstSequenceFrame: playback.frameNumbers[0],
                            } : null,
                            revision: inspection.revision ?? state.getRevision(),
                        }, null, 2) }] };
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
    server.tool("render_animation_preview", "Returns a playable GIF plus a PNG contact sheet for mandatory temporal and structural review of a tag or frame range. Preview scaling affects only the returned media and never the source canvas; do not call resize_canvas to match preview dimensions.", {
        ...animationSelectionSchema(),
        loop: z.boolean().optional().describe("Override continuous looping; defaults to the selected tag repeat setting"),
        scale: z.number().int().min(1).max(8).optional().default(2).describe("Nearest-neighbor output scale; never changes the source canvas"),
        filmstripScale: z.number().int().min(1).max(8).optional().default(2),
        columns: z.number().int().min(1).max(16).optional().default(8),
        gap: z.number().int().min(0).max(8).optional().default(1),
    }, async (params) => {
        try {
            requireAnimationCapability(state, "animationGif");
            const inspection = await fetchAnimationInspection(dispatcher, state);
            const playback = resolveAnimationPlayback(inspection, normalizeAnimationSelection(params));
            if (playback.frameNumbers.length > MAX_FILMSTRIP_FRAMES) {
                throw new Error(`Animation preview is limited to ${MAX_FILMSTRIP_FRAMES} playback frames.`);
            }
            const scale = params.scale ?? 2;
            const filmstripScale = params.filmstripScale ?? 2;
            const columns = Math.min(params.columns ?? 8, playback.frameNumbers.length);
            const rows = Math.ceil(playback.frameNumbers.length / columns);
            const gap = params.gap ?? 1;
            assertAnimationPixelBudget(inspection.width, inspection.height, playback.frameNumbers.length, scale);
            assertAnimationPixelBudget(inspection.width, inspection.height, playback.frameNumbers.length, filmstripScale);
            const filmstripWidth = columns * inspection.width * filmstripScale + (columns - 1) * gap;
            const filmstripHeight = rows * inspection.height * filmstripScale + (rows - 1) * gap;
            if (filmstripWidth * filmstripHeight > MAX_RENDERED_PIXELS) {
                throw new Error(`Rendered filmstrip exceeds the ${MAX_RENDERED_PIXELS.toLocaleString()} pixel safety limit.`);
            }
            const loop = params.loop ?? playback.loopsContinuously;
            const gif = await dispatcher.send("render_animation_gif", {
                frameNumbers: playback.frameNumbers,
                tagName: playback.tagName ?? undefined,
                scale,
                loop,
            }, 30_000);
            if (typeof gif.gifBase64 !== "string" || gif.gifBase64.length === 0) {
                throw new Error("Aseprite did not return a GIF preview.");
            }
            const gifBytes = Buffer.from(gif.gifBase64, "base64");
            const signature = gifBytes.subarray(0, 6).toString("ascii");
            if ((signature !== "GIF87a" && signature !== "GIF89a") || gifBytes.length > MAX_GIF_PREVIEW_BYTES) {
                throw new Error("Aseprite returned an invalid or oversized GIF preview.");
            }
            if (!Array.isArray(gif.durationsMs)
                || gif.durationsMs.length !== playback.frames.length
                || gif.durationsMs.some((duration, index) => duration !== playback.frames[index].durationMs)) {
                throw new Error("Animation timing changed while the preview was being rendered; inspect and render again.");
            }
            const frames = await fetchPlaybackFrames(dispatcher, state, playback.frameNumbers);
            const verification = await fetchAnimationInspection(dispatcher, state);
            if (typeof inspection.revision === "number" && verification.revision !== inspection.revision) {
                throw new Error("The sprite changed while the preview was being rendered; render again for a coherent review.");
            }
            const filmstrip = composeFilmstrip(frames.map((frame) => scaledImage(frame, filmstripScale)), columns, gap);
            const encodedFilmstrip = encodeRgbaToPngBase64(filmstrip.data, filmstrip.width, filmstrip.height);
            const previewId = createHash("sha256").update(gifBytes).digest("hex");
            const effectiveRevision = inspection.revision ?? state.getRevision();
            const temporalHash = computeCanonicalTemporalHash(inspection.width, inspection.height, playback.frameNumbers, playback.frames.map((f) => f.durationMs), frames);
            if (workflowState) {
                workflowState.registerPreview({
                    previewId,
                    revision: effectiveRevision,
                    temporalHash,
                    playback: {
                        frameNumbers: playback.frameNumbers,
                        tagName: playback.tagName ?? undefined,
                        loop,
                    },
                    recordedAt: new Date().toISOString(),
                });
            }
            return { content: [
                    { type: "image", data: gif.gifBase64, mimeType: "image/gif" },
                    { type: "image", data: encodedFilmstrip.base64, mimeType: "image/png" },
                    { type: "text", text: JSON.stringify({
                            success: true,
                            previewId,
                            temporalHash,
                            contentOrder: ["playableGif", "contactSheet", "metadata"],
                            playback: { ...playback, loop },
                            gif: { width: gif.width, height: gif.height, scale, sizeBytes: gifBytes.length },
                            contactSheet: { width: filmstrip.width, height: filmstrip.height, columns, rows, gap, scale: filmstripScale },
                            revision: effectiveRevision,
                        }, null, 2) },
                ] };
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
    server.tool("analyze_animation_temporal", "Performs deterministic automated temporal analysis of animation playback sequences (adjacent pixel diffs, center of mass shifts, area changes, palette spikes, single-pixel flicker, rigid regions, loop seam, contact points, durations, and cel jumps).", {
        ...animationSelectionSchema(),
        rigidRegions: z.array(z.object({
            id: z.string().min(1).max(64).describe("Unique rigid region identifier"),
            x: z.number().int().finite().min(0).describe("X coordinate within canvas"),
            y: z.number().int().finite().min(0).describe("Y coordinate within canvas"),
            width: z.number().int().finite().positive().describe("Width of rigid region"),
            height: z.number().int().finite().positive().describe("Height of rigid region"),
        })).max(MAX_RIGID_REGIONS).optional().describe("Optional regions that must maintain pixel stability (max 16)"),
        contactPoints: z.array(z.object({
            id: z.string().min(1).max(64).describe("Unique contact point identifier"),
            positions: z.array(z.object({
                frameNumber: z.number().int().finite().positive().describe("Playback frame number"),
                x: z.number().int().finite().min(0).describe("X coordinate within canvas"),
                y: z.number().int().finite().min(0).describe("Y coordinate within canvas"),
            })).min(2).max(64).describe("Frame-by-frame expected positions for displacement evaluation (min 2, max 64)"),
            maxDisplacement: z.number().finite().min(0).optional().describe("Per-point displacement threshold in pixels"),
        })).max(MAX_CONTACT_POINTS).optional().describe("Optional contact points evaluated for displacement (max 16)"),
        maxContactPointDisplacement: z.number().finite().min(0).optional().default(0).describe("Maximum allowed Euclidean displacement between consecutive contact points (default: 0)"),
        pixelDiffThreshold: z.number().int().finite().min(0).max(255).optional().default(0).describe("Per-channel delta treated as unchanged (default: 0)"),
        maxAdjacentChangeRatio: z.number().finite().min(0).max(1).optional().default(0.85).describe("Threshold ratio for adjacent pixel difference spikes (default: 0.85)"),
        maxCenterShift: z.number().finite().min(0).optional().describe("Visual center shift threshold in pixels (default: max(w,h) * 0.40)"),
        maxAreaChangeRatio: z.number().finite().min(0).max(1).optional().default(0.60).describe("Relative threshold for sudden occupied area change (default: 0.60)"),
        maxCelPositionJump: z.number().finite().min(0).optional().describe("Displacement threshold in pixels for layer cel jumps (default: max(w,h) * 0.50)"),
        rigidTolerance: z.number().finite().min(0).max(1).optional().default(0.0).describe("Allowed ratio of mutated pixels in rigid regions (default: 0.0)"),
        checkLoopContinuity: z.boolean().optional().describe("Override loop continuity evaluation between last and first frame"),
    }, async (params) => {
        try {
            const inspection = await fetchAnimationInspection(dispatcher, state);
            const playback = resolveAnimationPlayback(inspection, normalizeAnimationSelection(params));
            if (playback.frameNumbers.length > MAX_ANALYSIS_FRAMES) {
                throw new Error(`Animation temporal analysis is limited to ${MAX_ANALYSIS_FRAMES} playback frames.`);
            }
            assertAnimationPixelBudget(inspection.width, inspection.height, playback.frameNumbers.length, 1);
            const frames = await fetchPlaybackFrames(dispatcher, state, playback.frameNumbers);
            const verification = await fetchAnimationInspection(dispatcher, state);
            const effectiveRevision = inspection.revision ?? state.getRevision();
            if (typeof inspection.revision === "number" && verification.revision !== inspection.revision) {
                throw new Error("The sprite changed while temporal analysis was being performed; analyze again for coherent results.");
            }
            const analysisResult = analyzeAnimationTemporalPure({
                width: inspection.width,
                height: inspection.height,
                playback,
                frameBuffers: frames,
                inspectionLayers: inspection.layers,
                rigidRegions: params.rigidRegions,
                contactPoints: params.contactPoints,
                thresholds: {
                    pixelDiffThreshold: params.pixelDiffThreshold,
                    maxAdjacentChangeRatio: params.maxAdjacentChangeRatio,
                    maxCenterShift: params.maxCenterShift,
                    maxAreaChangeRatio: params.maxAreaChangeRatio,
                    maxCelPositionJump: params.maxCelPositionJump,
                    rigidTolerance: params.rigidTolerance,
                    maxContactPointDisplacement: params.maxContactPointDisplacement,
                    checkLoopContinuity: params.checkLoopContinuity,
                },
            });
            const analysisId = randomUUID();
            let workflowCheck = {
                hasActiveWorkflow: false,
                matches: false,
                workflowId: undefined,
                workflowName: undefined,
                reason: undefined,
            };
            if (workflowState) {
                workflowState.registerTemporalAnalysis({
                    analysisId,
                    revision: effectiveRevision,
                    temporalHash: analysisResult.temporalHash,
                    targetSelection: {
                        tagName: playback.tagName ?? undefined,
                        frameRange: { from: playback.fromFrame, to: playback.toFrame },
                        frameNumbers: playback.frameNumbers,
                    },
                    playback: {
                        frameNumbers: playback.frameNumbers,
                        tagName: playback.tagName ?? undefined,
                        direction: playback.direction,
                        loop: playback.loopsContinuously,
                    },
                    summary: {
                        totalFrames: analysisResult.summary.totalFrames,
                        totalDurationMs: analysisResult.summary.totalDurationMs,
                        totalFindings: analysisResult.summary.totalFindings,
                        findingsCount: analysisResult.summary.findingsCount,
                        truncated: analysisResult.summary.truncated,
                        warningCount: analysisResult.summary.warningCount,
                        infoCount: analysisResult.summary.infoCount,
                    },
                    recordedAt: new Date().toISOString(),
                });
                const check = workflowState.checkActiveWorkflowMatch({ frameNumbers: playback.frameNumbers, tagName: playback.tagName ?? undefined }, effectiveRevision);
                workflowCheck = {
                    hasActiveWorkflow: check.hasActiveWorkflow,
                    matches: check.matches,
                    workflowId: check.workflowId,
                    workflowName: check.workflowName,
                    reason: check.reason,
                };
            }
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            success: true,
                            analysisId,
                            temporalHash: analysisResult.temporalHash,
                            playback: {
                                tagName: playback.tagName,
                                fromFrame: playback.fromFrame,
                                toFrame: playback.toFrame,
                                direction: playback.direction,
                                repeats: playback.repeats,
                                loopsContinuously: playback.loopsContinuously,
                                frameNumbers: playback.frameNumbers,
                                totalDurationMs: playback.totalDurationMs,
                                averageFps: playback.averageFps,
                            },
                            summary: analysisResult.summary,
                            findings: analysisResult.findings,
                            metrics: analysisResult.metrics,
                            workflow: {
                                hasActiveWorkflow: workflowCheck.hasActiveWorkflow,
                                matchesActiveWorkflow: workflowCheck.matches,
                                workflowId: workflowCheck.workflowId,
                                workflowName: workflowCheck.workflowName,
                                reason: workflowCheck.reason,
                            },
                            revision: effectiveRevision,
                        }, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
    server.tool("get_onion_skin", "Renders the current frame over red-tinted previous frames and green-tinted next frames for animation review.", {
        frameNumber: z.number().int().positive().optional().describe("Center frame (defaults to active frame)"),
        before: z.number().int().min(0).max(3).optional().default(1).describe("Previous frames to include"),
        after: z.number().int().min(0).max(3).optional().default(1).describe("Next frames to include"),
        opacity: z.number().min(0.05).max(0.9).optional().default(0.35).describe("Maximum opacity of adjacent frames"),
        scale: z.number().int().min(1).max(16).optional().default(4).describe("Nearest-neighbor preview scale"),
    }, async (params) => {
        try {
            const context = await getFrameContext(dispatcher, state);
            const center = params.frameNumber ?? context.activeFrame;
            if (center > context.frameCount)
                throw new Error(`frameNumber must be between 1 and ${context.frameCount}.`);
            const previousNumbers = Array.from({ length: Math.min(params.before ?? 1, center - 1) }, (_, index) => center - Math.min(params.before ?? 1, center - 1) + index);
            const nextNumbers = Array.from({ length: Math.min(params.after ?? 1, context.frameCount - center) }, (_, index) => center + index + 1);
            assertAnimationPixelBudget(context.width, context.height, previousNumbers.length + 1 + nextNumbers.length, params.scale ?? 4);
            const [previous, current, next] = await Promise.all([
                Promise.all(previousNumbers.map((frame) => fetchFrame(dispatcher, state, frame))),
                fetchFrame(dispatcher, state, center),
                Promise.all(nextNumbers.map((frame) => fetchFrame(dispatcher, state, frame))),
            ]);
            const onion = composeOnionSkin(previous, current, next, params.opacity ?? 0.35);
            const scale = params.scale ?? 4;
            return imageToolResult(scaledImage(onion, scale), {
                frameNumber: center,
                previousFrames: previousNumbers,
                nextFrames: nextNumbers,
                opacity: params.opacity ?? 0.35,
                scale,
                revision: state.getRevision(),
            });
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
    server.tool("get_filmstrip", "Renders a bounded frame range as a single filmstrip PNG for animation timing and consistency review.", {
        fromFrame: z.number().int().positive().optional().default(1),
        toFrame: z.number().int().positive().optional().describe("Last frame (defaults to the final frame)"),
        columns: z.number().int().min(1).max(16).optional().default(8),
        gap: z.number().int().min(0).max(8).optional().default(1),
        scale: z.number().int().min(1).max(8).optional().default(2),
    }, async (params) => {
        try {
            const context = await getFrameContext(dispatcher, state);
            const from = params.fromFrame ?? 1;
            const to = params.toFrame ?? context.frameCount;
            if (from > to || to > context.frameCount) {
                throw new Error(`Frame range must satisfy 1 <= fromFrame <= toFrame <= ${context.frameCount}.`);
            }
            const count = to - from + 1;
            if (count > MAX_FILMSTRIP_FRAMES)
                throw new Error(`Filmstrip is limited to ${MAX_FILMSTRIP_FRAMES} frames.`);
            const scale = params.scale ?? 2;
            const columns = Math.min(params.columns ?? 8, count);
            const rows = Math.ceil(count / columns);
            const gap = params.gap ?? 1;
            const estimatedWidth = columns * context.width * scale + (columns - 1) * gap;
            const estimatedHeight = rows * context.height * scale + (rows - 1) * gap;
            if (estimatedWidth * estimatedHeight > MAX_RENDERED_PIXELS) {
                throw new Error(`Rendered filmstrip exceeds the ${MAX_RENDERED_PIXELS.toLocaleString()} pixel safety limit.`);
            }
            const frameNumbers = Array.from({ length: count }, (_, index) => from + index);
            const frames = await Promise.all(frameNumbers.map((frame) => fetchFrame(dispatcher, state, frame)));
            const filmstrip = composeFilmstrip(frames.map((frame) => scaledImage(frame, scale)), columns, gap);
            return imageToolResult(filmstrip, {
                fromFrame: from,
                toFrame: to,
                frameCount: count,
                columns,
                rows,
                gap,
                scale,
                revision: state.getRevision(),
            });
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
    server.tool("compare_frames", "Highlights changed pixels between two frames and returns exact changed-pixel metrics and bounds.", {
        frameA: z.number().int().positive(),
        frameB: z.number().int().positive(),
        threshold: z.number().int().min(0).max(255).optional().default(0).describe("Maximum per-channel delta treated as unchanged"),
        scale: z.number().int().min(1).max(16).optional().default(4),
    }, async (params) => {
        try {
            const context = await getFrameContext(dispatcher, state);
            if (params.frameA > context.frameCount || params.frameB > context.frameCount) {
                throw new Error(`Frame numbers must be between 1 and ${context.frameCount}.`);
            }
            assertAnimationPixelBudget(context.width, context.height, 2, params.scale ?? 4);
            const [before, after] = await Promise.all([
                fetchFrame(dispatcher, state, params.frameA),
                fetchFrame(dispatcher, state, params.frameB),
            ]);
            const diff = compareFrames(before, after, params.threshold ?? 0);
            const scale = params.scale ?? 4;
            return imageToolResult(scaledImage(diff, scale), {
                frameA: params.frameA,
                frameB: params.frameB,
                threshold: params.threshold ?? 0,
                changedPixels: diff.changedPixels,
                changeRatio: diff.changeRatio,
                bounds: diff.bounds,
                scale,
                revision: state.getRevision(),
            });
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
}
//# sourceMappingURL=animation.js.map