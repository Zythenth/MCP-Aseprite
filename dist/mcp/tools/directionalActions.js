import { z } from "zod";
import { decodeBridgeCanvas } from "../../image/bridgeCanvas.js";
import { buildClusterTween } from "../../image/pixelMotion.js";
import { analyzeAnimationTemporalPure } from "../../image/temporalAnalysis.js";
import { resolveAnimationPlayback } from "../animationSelection.js";
import { buildDirectionalActionPlan, directionsFor, evaluateMirrorability } from "../directionalActions.js";
import { bridgeToolError } from "./common.js";
const MAX_TIMELINE_FRAMES = 128;
const MAX_MIRROR_PIXELS_PER_LAYER = 100_000;
const actionSchema = z.enum(["walk", "run", "idle", "attack", "hit", "death", "dash", "cast", "interaction"]);
const actionInputSchema = {
    action: actionSchema,
    directions: z.union([z.literal(4), z.literal(8)]),
    frames: z.number().int().min(2).max(24),
    fps: z.number().int().min(1).max(60),
    stridePx: z.number().int().min(0).max(64),
    style: z.string().min(1).max(512),
    tagPrefix: z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/).optional(),
    attackKind: z.enum(["melee", "ranged"]).optional(),
    hitForcePx: z.number().int().min(0).max(64).optional(),
    damageType: z.string().min(1).max(128).optional(),
    deathStyle: z.enum(["forward", "backward", "disintegrate", "mechanical_explosion"]).optional(),
    interactionKind: z.enum(["pickup", "open", "press", "mine", "cut", "terminal", "talk"]).optional(),
    targetHeightPx: z.number().int().min(-4096).max(4096).optional(),
    targetOffsetX: z.number().int().min(-4096).max(4096).optional(),
    targetOffsetY: z.number().int().min(-4096).max(4096).optional(),
};
const contactSchema = z.object({
    tagName: z.string().min(1).max(128),
    id: z.string().min(1).max(128),
    positions: z.array(z.object({
        frameNumber: z.number().int().positive(),
        x: z.number().int().nonnegative(),
        y: z.number().int().nonnegative(),
    })).min(2).max(64),
    maxDisplacement: z.number().nonnegative().optional(),
});
const groundContactSchema = z.object({
    tagName: z.string().min(1).max(128),
    frameNumbers: z.array(z.number().int().positive()).min(1).max(24),
    groundY: z.number().int().nonnegative(),
});
const armSwingSchema = z.object({
    tagName: z.string().min(1).max(128),
    axis: z.enum(["x", "y"]),
    leftHand: z.array(z.object({ frameNumber: z.number().int().positive(), x: z.number().int().nonnegative(), y: z.number().int().nonnegative() })).min(2).max(64),
    rightHand: z.array(z.object({ frameNumber: z.number().int().positive(), x: z.number().int().nonnegative(), y: z.number().int().nonnegative() })).min(2).max(64),
});
const keyPoseSchema = z.object({
    direction: z.enum(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]),
    frameNumbers: z.array(z.number().int().positive()).min(2).max(24),
});
function imageLayerNames(layers) {
    const names = [];
    const visit = (nodes) => {
        for (const layer of nodes) {
            if (layer.isGroup && layer.children)
                visit(layer.children);
            else if (layer.isImage)
                names.push(layer.name);
        }
    };
    visit(layers);
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
    if (duplicates.length)
        throw new Error(`Mirroring requires unique image-layer names; duplicated name '${duplicates[0]}' was found.`);
    return names;
}
function validatePixelGrid(result, width, height, layerName) {
    if (!result || typeof result !== "object")
        throw new Error(`Aseprite did not return a pixel grid for layer '${layerName}'.`);
    const candidate = result;
    if (candidate.width !== width || candidate.height !== height || !Array.isArray(candidate.grid) || candidate.grid.length !== height) {
        throw new Error(`Aseprite returned an invalid canvas-sized pixel grid for layer '${layerName}'.`);
    }
    if (candidate.grid.some((row) => !Array.isArray(row) || row.length !== width || row.some((color) => typeof color !== "string"))) {
        throw new Error(`Aseprite returned an invalid pixel row for layer '${layerName}'.`);
    }
    return candidate.grid;
}
function gridPixels(grid) {
    return grid.flatMap((row, y) => row.map((color, x) => ({ x, y, color })));
}
function keyPoseOutputIndices(keyPoseCount, frameCount) {
    if (keyPoseCount > frameCount)
        throw new Error(`Cannot place ${keyPoseCount} key poses into ${frameCount} output frames.`);
    const positions = Array.from({ length: keyPoseCount }, (_, index) => Math.round(index * (frameCount - 1) / (keyPoseCount - 1)));
    if (new Set(positions).size !== positions.length)
        throw new Error("Key poses collapse onto the same output frame; increase the requested frame count.");
    return positions;
}
async function inspect(dispatcher, state) {
    const result = await dispatcher.send("inspect_animation", {}, 10_000);
    if (typeof result.revision === "number")
        state.setRevision(result.revision);
    const tags = Array.isArray(result.tags)
        ? result.tags
        : result.tags && typeof result.tags === "object" && Object.keys(result.tags).length === 0
            ? []
            : null;
    if (!Array.isArray(result.frames) || !tags || !Array.isArray(result.layers)) {
        throw new Error("Aseprite returned incomplete animation inspection data.");
    }
    return { ...result, tags };
}
function planFromArgs(args) {
    return buildDirectionalActionPlan(args);
}
function tagNamesMissing(inspection, names) {
    const present = new Set(inspection.tags.map((tag) => tag.name));
    return names.filter((name) => !present.has(name));
}
function ensureSourceFrame(inspection, frameNumber) {
    if (!inspection.frames.some((frame) => frame.frameNumber === frameNumber)) {
        throw new Error(`Source frame ${frameNumber} does not exist in the active sprite.`);
    }
}
function contactsForTag(contacts, tagName) {
    return contacts
        .filter((contact) => contact.tagName === tagName)
        .map(({ tagName: _tagName, ...contact }) => contact);
}
function groundContactsForTag(contacts, tagName) {
    return contacts.filter((contact) => contact.tagName === tagName);
}
function armSwingForTag(swings, tagName) {
    return swings.filter((swing) => swing.tagName === tagName);
}
function evaluateArmSwing(swing) {
    const leftByFrame = new Map(swing.leftHand.map((point) => [point.frameNumber, point]));
    const rightByFrame = new Map(swing.rightHand.map((point) => [point.frameNumber, point]));
    const frameNumbers = [...leftByFrame.keys()].filter((frameNumber) => rightByFrame.has(frameNumber)).sort((a, b) => a - b);
    let pairedSteps = 0;
    let oppositeSteps = 0;
    for (let index = 1; index < frameNumbers.length; index += 1) {
        const previous = frameNumbers[index - 1];
        const current = frameNumbers[index];
        const leftDelta = leftByFrame.get(current)[swing.axis] - leftByFrame.get(previous)[swing.axis];
        const rightDelta = rightByFrame.get(current)[swing.axis] - rightByFrame.get(previous)[swing.axis];
        if (leftDelta === 0 || rightDelta === 0)
            continue;
        pairedSteps += 1;
        if (leftDelta * rightDelta < 0)
            oppositeSteps += 1;
    }
    return {
        axis: swing.axis,
        pairedSteps,
        oppositeSteps,
        passed: pairedSteps > 0 && oppositeSteps > 0,
        reason: pairedSteps === 0
            ? "No paired non-zero hand motion was supplied on the selected axis."
            : oppositeSteps > 0
                ? "At least one paired hand-motion step is opposed."
                : "Both hands moved in the same direction on every measurable step.",
    };
}
async function rollbackTimelineCreation(dispatcher, createdTagNames, createdFrameNumbers) {
    const failures = [];
    for (const name of [...createdTagNames].reverse()) {
        try {
            await dispatcher.send("delete_tag", { name, confirm: true }, 10_000);
        }
        catch (error) {
            failures.push(`tag '${name}': ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    for (const frameNumber of [...createdFrameNumbers].reverse()) {
        try {
            await dispatcher.send("delete_frame", { frameNumber, confirm: true }, 10_000);
        }
        catch (error) {
            failures.push(`frame ${frameNumber}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return failures;
}
export function registerDirectionalActionTools(server, dispatcher, state) {
    server.tool("plan_directional_animation", "Builds a directional pixel-art action plan for walk, run, idle, attack, hit, death, dash, cast, or interaction. It produces per-direction tags, pose choreography, timing, events for engine export, and explicit QA checks; it never invents or paints character pixels.", actionInputSchema, async (args) => {
        try {
            return { content: [{ type: "text", text: JSON.stringify({ success: true, plan: planFromArgs(args) }, null, 2) }] };
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
    server.tool("create_directional_animation_timeline", "Creates a complete 4- or 8-direction timeline by duplicating a supplied pose-base frame, applying the requested timing, and creating one tag per direction. The copied frames are deliberate editable pose slots: draw the action poses before QA; the tool does not pretend an unchanged pose is a finished walk, run, or attack.", { ...actionInputSchema, sourceFrame: z.number().int().positive() }, async (args) => {
        const createdTagNames = [];
        const createdFrameNumbers = [];
        try {
            const plan = planFromArgs(args);
            const totalFrames = plan.tags.length * plan.framesPerDirection;
            if (totalFrames > MAX_TIMELINE_FRAMES) {
                throw new Error(`Directional timeline would create ${totalFrames} frames; the limit is ${MAX_TIMELINE_FRAMES}. Reduce frames or directions.`);
            }
            const before = await inspect(dispatcher, state);
            ensureSourceFrame(before, args.sourceFrame);
            const conflicts = plan.tags.filter((tag) => before.tags.some((existing) => existing.name === tag.name));
            if (conflicts.length)
                throw new Error(`Refusing to overwrite existing tag '${conflicts[0].name}'. Choose another tagPrefix.`);
            const createdTags = [];
            let sourceFrameToCopy = args.sourceFrame;
            for (const tag of plan.tags) {
                const frames = [];
                for (let index = 0; index < plan.framesPerDirection; index += 1) {
                    const duplicate = await dispatcher.send("duplicate_frame", { frameNumber: sourceFrameToCopy }, 10_000);
                    const frameNumber = duplicate.newFrameNumber ?? duplicate.newFrame;
                    if (typeof frameNumber !== "number" || !Number.isInteger(frameNumber) || frameNumber < 1)
                        throw new Error("Aseprite did not return a newly duplicated frame number.");
                    createdFrameNumbers.push(frameNumber);
                    await dispatcher.send("set_frame_duration", { frameNumber, durationMs: plan.frameDurationMs }, 10_000);
                    frames.push(frameNumber);
                    if (frameNumber === sourceFrameToCopy)
                        sourceFrameToCopy += 1;
                }
                await dispatcher.send("create_tag", { name: tag.name, fromFrame: frames[0], toFrame: frames.at(-1), direction: "forward", repeats: plan.action === "walk" || plan.action === "run" || plan.action === "idle" ? 0 : 1 }, 10_000);
                createdTagNames.push(tag.name);
                createdTags.push({
                    direction: tag.direction,
                    name: tag.name,
                    fromFrame: frames[0],
                    toFrame: frames.at(-1),
                    events: plan.events.map((event) => ({ ...event, frameNumber: frames[event.frameOffset] })),
                });
            }
            const after = await inspect(dispatcher, state);
            const missing = tagNamesMissing(after, createdTags.map((tag) => tag.name));
            if (missing.length)
                throw new Error(`Aseprite did not retain created tag '${missing[0]}'.`);
            return { content: [{ type: "text", text: JSON.stringify({
                            success: true,
                            createdTags,
                            poseBaseFrame: args.sourceFrame,
                            copiedPoseSlots: totalFrames,
                            frameDurationMs: plan.frameDurationMs,
                            poseSequence: plan.poseSequence,
                            nextRequiredStep: "Replace each copied pose slot with its planned pixel-art pose, then call analyze_directional_animation with contact coordinates.",
                            qaChecks: plan.qaChecks,
                            revision: after.revision ?? state.getRevision(),
                        }, null, 2) }] };
        }
        catch (error) {
            if (!createdTagNames.length && !createdFrameNumbers.length)
                return bridgeToolError(error);
            const cleanupFailures = await rollbackTimelineCreation(dispatcher, createdTagNames, createdFrameNumbers);
            const originalMessage = error instanceof Error ? error.message : String(error);
            const cleanupMessage = cleanupFailures.length
                ? `Cleanup could not remove ${cleanupFailures.join("; ")}.`
                : "All timeline frames and tags created by this failed request were removed.";
            return bridgeToolError(new Error(`Directional timeline creation failed: ${originalMessage} ${cleanupMessage}`));
        }
    });
    server.tool("generate_directional_animation_from_key_poses", "Generates an editable 4- or 8-direction action cycle from two or more artist-drawn key poses per direction. It creates independent output frames, uses crisp same-color cluster interpolation only between supplied poses, applies timing and tags, and returns engine events. It never claims that interpolation replaces visual pose review.", { ...actionInputSchema, keyPoses: z.array(keyPoseSchema).min(4).max(8) }, async (args) => {
        const createdTagNames = [];
        const createdFrameNumbers = [];
        try {
            const plan = planFromArgs(args);
            const totalFrames = plan.tags.length * plan.framesPerDirection;
            if (totalFrames > MAX_TIMELINE_FRAMES) {
                throw new Error(`Directional timeline would create ${totalFrames} frames; the limit is ${MAX_TIMELINE_FRAMES}. Reduce frames or directions.`);
            }
            const expectedDirections = directionsFor(args.directions);
            const suppliedKeyPoses = new Map();
            for (const keyPose of args.keyPoses) {
                if (!expectedDirections.includes(keyPose.direction))
                    throw new Error(`Direction '${keyPose.direction}' is not available in ${args.directions}-direction mode.`);
                if (suppliedKeyPoses.has(keyPose.direction))
                    throw new Error(`Key poses for direction '${keyPose.direction}' were supplied more than once.`);
                if (keyPose.frameNumbers.length > args.frames)
                    throw new Error(`Direction '${keyPose.direction}' supplies more key poses than the requested ${args.frames} output frames.`);
                if (new Set(keyPose.frameNumbers).size !== keyPose.frameNumbers.length)
                    throw new Error(`Key poses for direction '${keyPose.direction}' must use distinct source frames.`);
                suppliedKeyPoses.set(keyPose.direction, [...keyPose.frameNumbers]);
            }
            for (const direction of expectedDirections) {
                if (!suppliedKeyPoses.has(direction))
                    throw new Error(`Missing artist-drawn key poses for direction '${direction}'.`);
            }
            const before = await inspect(dispatcher, state);
            const conflicts = plan.tags.filter((tag) => before.tags.some((existing) => existing.name === tag.name));
            if (conflicts.length)
                throw new Error(`Refusing to overwrite existing tag '${conflicts[0].name}'. Choose another tagPrefix.`);
            const existingFrames = new Set(before.frames.map((frame) => frame.frameNumber));
            for (const [direction, frameNumbers] of suppliedKeyPoses) {
                for (const frameNumber of frameNumbers) {
                    if (!existingFrames.has(frameNumber))
                        throw new Error(`Key pose frame ${frameNumber} for direction '${direction}' does not exist in the active sprite.`);
                }
            }
            if (before.width * before.height > MAX_MIRROR_PIXELS_PER_LAYER) {
                throw new Error(`Key-pose generation is limited to ${MAX_MIRROR_PIXELS_PER_LAYER.toLocaleString()} pixels per image layer.`);
            }
            const layerNames = imageLayerNames(before.layers);
            if (!layerNames.length)
                throw new Error("No image layers are available for key-pose generation.");
            const sourceGrids = new Map();
            for (const direction of expectedDirections) {
                const frames = suppliedKeyPoses.get(direction);
                const grids = await Promise.all(frames.map(async (frameNumber) => {
                    const pairs = await Promise.all(layerNames.map(async (layerName) => {
                        const result = await dispatcher.send("get_pixel_grid", { frameIndex: frameNumber, layerName, format: "hex" }, 10_000);
                        return [layerName, validatePixelGrid(result, before.width, before.height, layerName)];
                    }));
                    return new Map(pairs);
                }));
                sourceGrids.set(direction, grids);
            }
            const lastExistingFrame = before.frames.at(-1)?.frameNumber;
            if (typeof lastExistingFrame !== "number" || !Number.isInteger(lastExistingFrame) || lastExistingFrame < 1) {
                throw new Error("The active sprite has no frame available after the supplied key poses.");
            }
            let insertAfterFrame = lastExistingFrame;
            const generatedTags = [];
            const outputByDirection = new Map();
            for (const tag of plan.tags) {
                const frames = [];
                for (let index = 0; index < plan.framesPerDirection; index += 1) {
                    const created = await dispatcher.send("create_frame", {
                        afterFrame: insertAfterFrame,
                        duration: plan.frameDurationMs,
                    }, 10_000);
                    const returnedFrameNumber = created.createdFrameNumber ?? created.frameNumber;
                    if (typeof returnedFrameNumber !== "number" || !Number.isInteger(returnedFrameNumber) || returnedFrameNumber < 1)
                        throw new Error("Aseprite did not return a generated frame number.");
                    frames.push(returnedFrameNumber);
                    createdFrameNumbers.push(returnedFrameNumber);
                    insertAfterFrame = returnedFrameNumber;
                }
                outputByDirection.set(tag.direction, frames);
            }
            const generatedInBetweens = [];
            for (const tag of plan.tags) {
                const frames = outputByDirection.get(tag.direction);
                const grids = sourceGrids.get(tag.direction);
                const keyPositions = keyPoseOutputIndices(grids.length, frames.length);
                for (let outputIndex = 0; outputIndex < frames.length; outputIndex += 1) {
                    const exactKeyIndex = keyPositions.indexOf(outputIndex);
                    const leftKeyIndex = exactKeyIndex >= 0 ? exactKeyIndex : keyPositions.findIndex((position) => position > outputIndex) - 1;
                    const rightKeyIndex = exactKeyIndex >= 0 ? exactKeyIndex : leftKeyIndex + 1;
                    const progress = exactKeyIndex >= 0 ? 0 : (outputIndex - keyPositions[leftKeyIndex]) / (keyPositions[rightKeyIndex] - keyPositions[leftKeyIndex]);
                    let movedClusters = 0;
                    let unmatchedClusters = 0;
                    for (const layerName of layerNames) {
                        const grid = exactKeyIndex >= 0
                            ? grids[exactKeyIndex].get(layerName)
                            : (() => {
                                const tween = buildClusterTween(grids[leftKeyIndex].get(layerName), grids[rightKeyIndex].get(layerName), progress, "ease_in_out");
                                movedClusters += tween.movedClusters;
                                unmatchedClusters += tween.unmatchedClusters;
                                return tween.grid;
                            })();
                        await dispatcher.send("set_pixels", { frameNumber: frames[outputIndex], layerName, pixels: gridPixels(grid) }, 30_000);
                    }
                    if (exactKeyIndex < 0) {
                        generatedInBetweens.push({
                            direction: tag.direction,
                            frameNumber: frames[outputIndex],
                            betweenKeyPoseIndices: [leftKeyIndex, rightKeyIndex],
                            movedClusters,
                            unmatchedClusters,
                        });
                    }
                }
                await dispatcher.send("create_tag", {
                    name: tag.name,
                    fromFrame: frames[0],
                    toFrame: frames.at(-1),
                    direction: "forward",
                    repeats: plan.action === "walk" || plan.action === "run" || plan.action === "idle" ? 0 : 1,
                }, 10_000);
                createdTagNames.push(tag.name);
                generatedTags.push({
                    direction: tag.direction,
                    name: tag.name,
                    fromFrame: frames[0],
                    toFrame: frames.at(-1),
                    events: plan.events.map((event) => ({ ...event, frameNumber: frames[event.frameOffset] })),
                });
            }
            const after = await inspect(dispatcher, state);
            const missing = tagNamesMissing(after, generatedTags.map((tag) => tag.name));
            if (missing.length)
                throw new Error(`Aseprite did not retain generated tag '${missing[0]}'.`);
            return { content: [{ type: "text", text: JSON.stringify({
                            success: true,
                            action: plan.action,
                            generatedTags,
                            sourceKeyPoses: Object.fromEntries([...suppliedKeyPoses.entries()]),
                            generatedInBetweens,
                            frameDurationMs: plan.frameDurationMs,
                            algorithm: "same-color 4-connected cluster interpolation with crisp half-way shape handoff",
                            reviewRequired: true,
                            nextRequiredStep: "Inspect every generated in-between and all key poses, then call analyze_directional_animation with exact contact and hand tracks.",
                            qaChecks: plan.qaChecks,
                            revision: after.revision ?? state.getRevision(),
                        }, null, 2) }] };
        }
        catch (error) {
            if (!createdTagNames.length && !createdFrameNumbers.length)
                return bridgeToolError(error);
            const cleanupFailures = await rollbackTimelineCreation(dispatcher, createdTagNames, createdFrameNumbers);
            const originalMessage = error instanceof Error ? error.message : String(error);
            const cleanupMessage = cleanupFailures.length
                ? `Cleanup could not remove ${cleanupFailures.join("; ")}.`
                : "All generated frames and tags from this failed key-pose request were removed.";
            return bridgeToolError(new Error(`Directional key-pose generation failed: ${originalMessage} ${cleanupMessage}`));
        }
    });
    server.tool("analyze_directional_animation", "Runs deterministic temporal QA for every planned direction. It checks real tags, timings, duplicate frames, bounds, jitter, palette drift, loop seams, and supplied foot-contact coordinates. It reports visual-only checks separately instead of falsely claiming it can infer anatomy or weapon handedness from pixels.", {
        ...actionInputSchema,
        contacts: z.array(contactSchema).max(128).default([]),
        groundContacts: z.array(groundContactSchema).max(32).default([]),
        armSwings: z.array(armSwingSchema).max(32).default([]),
        maxVerticalBobPx: z.number().int().min(0).max(64).optional(),
        walkReference: z.object({ fps: z.number().int().min(1).max(60), stridePx: z.number().int().min(0).max(64) }).optional(),
        walkContactFrameCount: z.number().int().positive().max(24).optional(),
    }, async (args) => {
        try {
            const plan = planFromArgs(args);
            const inspection = await inspect(dispatcher, state);
            const missing = tagNamesMissing(inspection, plan.tags.map((tag) => tag.name));
            if (missing.length)
                throw new Error(`Missing required directional tag '${missing[0]}'.`);
            const perDirection = [];
            for (const tag of plan.tags) {
                const playback = resolveAnimationPlayback(inspection, { tagName: tag.name });
                const frames = await Promise.all(playback.frameNumbers.map(async (frameNumber) => {
                    const canvas = await dispatcher.send("get_canvas", { frameIndex: frameNumber }, 10_000);
                    if (typeof canvas.revision === "number")
                        state.setRevision(canvas.revision);
                    return decodeBridgeCanvas(canvas);
                }));
                const contacts = contactsForTag(args.contacts, tag.name);
                const temporal = analyzeAnimationTemporalPure({
                    width: inspection.width,
                    height: inspection.height,
                    playback,
                    frameBuffers: frames,
                    inspectionLayers: inspection.layers,
                    contactPoints: contacts.length ? contacts : undefined,
                    thresholds: { checkLoopContinuity: plan.action === "walk" || plan.action === "run" || plan.action === "idle" },
                });
                const groundChecks = groundContactsForTag(args.groundContacts, tag.name).flatMap((groundContact) => groundContact.frameNumbers.map((frameNumber) => {
                    const metric = temporal.metrics.perFrameMetrics.find((candidate) => candidate.frameNumber === frameNumber);
                    const actualGroundY = metric?.bounds ? metric.bounds.y + metric.bounds.height - 1 : null;
                    return {
                        frameNumber,
                        expectedGroundY: groundContact.groundY,
                        actualGroundY,
                        passed: actualGroundY === groundContact.groundY,
                    };
                }));
                const runContactComparison = plan.action !== "run"
                    ? null
                    : args.walkContactFrameCount === undefined
                        ? { status: "not_evaluated", reason: "walkContactFrameCount is required to compare grounded contact duration." }
                        : {
                            status: groundChecks.filter((check) => check.passed).length < args.walkContactFrameCount ? "pass" : "fail",
                            runContactFrameCount: groundChecks.filter((check) => check.passed).length,
                            walkContactFrameCount: args.walkContactFrameCount,
                            reason: groundChecks.filter((check) => check.passed).length < args.walkContactFrameCount
                                ? "The supplied run contact frames are fewer than the walk reference."
                                : "A run must have fewer supplied grounded contact frames than the walk reference.",
                        };
                const armSwingChecks = armSwingForTag(args.armSwings, tag.name).map(evaluateArmSwing);
                const centers = temporal.metrics.perFrameMetrics.map((metric) => metric.visualCenter?.y).filter((center) => center !== null);
                const verticalBobPx = centers.length ? Number((Math.max(...centers) - Math.min(...centers)).toFixed(2)) : null;
                perDirection.push({
                    direction: tag.direction,
                    tagName: tag.name,
                    contactsEvaluated: contacts.map((contact) => contact.id),
                    contactQa: contacts.length ? "evaluated" : "not_evaluated_without_exact_contact_coordinates",
                    groundContactQa: groundChecks.length ? groundChecks : "not_evaluated_without_ground_contact_frames",
                    runContactComparison,
                    armSwingQa: armSwingChecks.length ? armSwingChecks : "not_evaluated_without_explicit_left_and_right_hand_tracks",
                    verticalBob: {
                        pixels: verticalBobPx,
                        maximumAllowedPixels: args.maxVerticalBobPx ?? null,
                        passed: verticalBobPx === null || args.maxVerticalBobPx === undefined ? null : verticalBobPx <= args.maxVerticalBobPx,
                    },
                    temporal,
                });
            }
            const runComparison = plan.action !== "run"
                ? null
                : !args.walkReference
                    ? { status: "not_evaluated", reason: "walkReference is required to compare running against walking." }
                    : {
                        status: args.fps > args.walkReference.fps && args.stridePx > args.walkReference.stridePx ? "pass" : "fail",
                        runFps: args.fps,
                        walkFps: args.walkReference.fps,
                        runStridePx: args.stridePx,
                        walkStridePx: args.walkReference.stridePx,
                        reason: args.fps > args.walkReference.fps && args.stridePx > args.walkReference.stridePx
                            ? "Configured run timing and stride exceed the supplied walk reference."
                            : "A run must use both faster timing and a larger stride than the supplied walk reference.",
                    };
            return { content: [{ type: "text", text: JSON.stringify({
                            success: true,
                            action: plan.action,
                            perDirection,
                            runComparison,
                            visualChecksStillRequired: plan.manualChecks,
                            qaChecks: plan.qaChecks,
                        }, null, 2) }] };
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
    server.tool("assess_directional_mirroring", "Makes the mirrorability decision explicit. It blocks automatic East/West mirroring when the reviewer declares a handed weapon, text, scars, lighting, equipment, or another non-mirrorable trait. A visual review remains mandatory because these semantic traits cannot be identified reliably from raw RGBA pixels alone.", {
        hasHandedWeapon: z.boolean().optional(),
        hasReadableText: z.boolean().optional(),
        hasAsymmetricScars: z.boolean().optional(),
        hasAsymmetricLighting: z.boolean().optional(),
        hasAsymmetricEquipment: z.boolean().optional(),
        declaredNonMirrorable: z.boolean().optional(),
    }, async (args) => ({ content: [{ type: "text", text: JSON.stringify({ success: true, decision: evaluateMirrorability(args) }, null, 2) }] }));
    server.tool("mirror_directional_animation", "Creates independent frames after a source tag, mirrors all uniquely named image layers horizontally at native resolution, and creates a target tag. It requires an explicit safe mirrorability assessment and confirmation; it never mirrors a declared asymmetric character blindly.", {
        sourceTagName: z.string().min(1).max(128),
        targetTagName: z.string().min(1).max(128),
        confirm: z.literal(true),
        hasHandedWeapon: z.boolean().optional(),
        hasReadableText: z.boolean().optional(),
        hasAsymmetricScars: z.boolean().optional(),
        hasAsymmetricLighting: z.boolean().optional(),
        hasAsymmetricEquipment: z.boolean().optional(),
        declaredNonMirrorable: z.boolean().optional(),
    }, async (args) => {
        const targetFrames = [];
        let sourceTagForRollback = null;
        let targetTagCreated = false;
        try {
            const decision = evaluateMirrorability(args);
            if (!decision.mirrorable)
                throw new Error(`Mirroring blocked: ${decision.blockingReasons.join(" ")}`);
            const before = await inspect(dispatcher, state);
            if (before.tags.some((tag) => tag.name === args.targetTagName))
                throw new Error(`Refusing to overwrite existing tag '${args.targetTagName}'.`);
            const sourceTag = before.tags.find((tag) => tag.name === args.sourceTagName);
            if (!sourceTag)
                throw new Error(`Source tag '${args.sourceTagName}' was not found.`);
            sourceTagForRollback = sourceTag;
            if (before.width * before.height > MAX_MIRROR_PIXELS_PER_LAYER) {
                throw new Error(`Mirroring is limited to ${MAX_MIRROR_PIXELS_PER_LAYER.toLocaleString()} pixels per image layer.`);
            }
            const layerNames = imageLayerNames(before.layers);
            if (!layerNames.length)
                throw new Error("No image layers are available to mirror.");
            const sourceFrames = before.frames.filter((frame) => frame.frameNumber >= sourceTag.from && frame.frameNumber <= sourceTag.to);
            const sourcePixels = await Promise.all(sourceFrames.map(async (sourceFrame) => ({
                frameNumber: sourceFrame.frameNumber,
                layers: await Promise.all(layerNames.map(async (layerName) => {
                    const gridResult = await dispatcher.send("get_pixel_grid", { frameIndex: sourceFrame.frameNumber, layerName, format: "hex" }, 10_000);
                    if (gridResult.width !== before.width || gridResult.height !== before.height || !Array.isArray(gridResult.grid)) {
                        throw new Error(`Aseprite returned an invalid canvas-sized pixel grid for layer '${layerName}'.`);
                    }
                    const pixels = gridResult.grid.flatMap((row, y) => {
                        if (!Array.isArray(row) || row.length !== before.width)
                            throw new Error(`Aseprite returned an invalid pixel row for layer '${layerName}'.`);
                        return row.map((color, x) => {
                            if (typeof color !== "string")
                                throw new Error(`Aseprite returned an invalid pixel color for layer '${layerName}'.`);
                            return { x: before.width - 1 - x, y, color };
                        });
                    });
                    return { layerName, pixels };
                })),
            })));
            let insertAfterFrame = sourceTag.to;
            for (const sourceFrame of sourceFrames) {
                const created = await dispatcher.send("create_frame", {
                    afterFrame: insertAfterFrame,
                    duration: sourceFrame.durationMs,
                }, 10_000);
                const targetFrame = created.createdFrameNumber ?? created.frameNumber;
                if (typeof targetFrame !== "number" || !Number.isInteger(targetFrame) || targetFrame < 1)
                    throw new Error("Aseprite did not return a newly created mirror frame number.");
                targetFrames.push(targetFrame);
                insertAfterFrame = targetFrame;
            }
            for (const [index, targetFrame] of targetFrames.entries()) {
                for (const layer of sourcePixels[index].layers) {
                    await dispatcher.send("set_pixels", { frameNumber: targetFrame, layerName: layer.layerName, pixels: layer.pixels }, 30_000);
                }
            }
            await dispatcher.send("create_tag", {
                name: args.targetTagName,
                fromFrame: targetFrames[0],
                toFrame: targetFrames.at(-1),
                direction: sourceTag.direction,
                repeats: sourceTag.repeats,
            }, 10_000);
            targetTagCreated = true;
            // Aseprite expands a tag that ends immediately before inserted frames. Restore
            // the source range so the two directional tags remain disjoint.
            await dispatcher.send("update_tag", {
                name: args.sourceTagName,
                fromFrame: sourceTag.from,
                toFrame: sourceTag.to,
            }, 10_000);
            const after = await inspect(dispatcher, state);
            if (!after.tags.some((tag) => tag.name === args.targetTagName))
                throw new Error(`Aseprite did not retain mirror tag '${args.targetTagName}'.`);
            const sourceTagAfter = after.tags.find((tag) => tag.name === args.sourceTagName);
            if (!sourceTagAfter)
                throw new Error(`Aseprite did not retain source tag '${args.sourceTagName}' while mirroring.`);
            return { content: [{ type: "text", text: JSON.stringify({
                            success: true,
                            sourceTagName: args.sourceTagName,
                            targetTagName: args.targetTagName,
                            sourceFrames: sourceFrames.map((frame) => frame.frameNumber),
                            sourceTagAfter: { fromFrame: sourceTagAfter.from, toFrame: sourceTagAfter.to },
                            targetFrames,
                            mirroredLayers: layerNames,
                            mirrorability: decision,
                            revision: after.revision ?? state.getRevision(),
                        }, null, 2) }] };
        }
        catch (error) {
            const cleanupFailures = [];
            if (targetTagCreated) {
                try {
                    await dispatcher.send("delete_tag", { name: args.targetTagName, confirm: true }, 10_000);
                }
                catch (cleanupError) {
                    cleanupFailures.push(`tag '${args.targetTagName}': ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
                }
            }
            for (const frameNumber of [...targetFrames].reverse()) {
                try {
                    await dispatcher.send("delete_frame", { frameNumber, confirm: true }, 10_000);
                }
                catch (cleanupError) {
                    cleanupFailures.push(`frame ${frameNumber}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
                }
            }
            if (sourceTagForRollback) {
                try {
                    await dispatcher.send("update_tag", {
                        name: sourceTagForRollback.name,
                        fromFrame: sourceTagForRollback.from,
                        toFrame: sourceTagForRollback.to,
                    }, 10_000);
                }
                catch (cleanupError) {
                    cleanupFailures.push(`source tag '${sourceTagForRollback.name}': ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
                }
            }
            const originalMessage = error instanceof Error ? error.message : String(error);
            const cleanupMessage = cleanupFailures.length
                ? `Cleanup could not remove ${cleanupFailures.join("; ")}.`
                : targetFrames.length || targetTagCreated
                    ? "All frames and tags created by this failed mirror request were removed."
                    : "No mirror changes were made.";
            return bridgeToolError(new Error(`Directional mirroring failed: ${originalMessage} ${cleanupMessage}`));
        }
    });
}
//# sourceMappingURL=directionalActions.js.map