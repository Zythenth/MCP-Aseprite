import { z } from "zod";
import { buildClusterTween, buildSmearFrame } from "../../image/pixelMotion.js";
import { bridgeToolError } from "./common.js";
const MAX_GENERATED_FRAMES = 16;
const MAX_GENERATED_PIXELS = 100_000;
function selectors(params) {
    if (params.layerName !== undefined && params.layerIndex !== undefined) {
        throw new Error("Provide either layerName or layerIndex, not both.");
    }
    return params.layerName !== undefined ? { layerName: params.layerName } : params.layerIndex !== undefined ? { layerIndex: params.layerIndex } : {};
}
function validateGrid(result) {
    if (!result || typeof result !== "object")
        throw new Error("Aseprite did not return a pixel grid.");
    const candidate = result;
    const width = candidate.width;
    const height = candidate.height;
    if (typeof width !== "number" || typeof height !== "number" || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
        throw new Error("Aseprite returned invalid pixel-grid dimensions.");
    }
    if (width * height > MAX_GENERATED_PIXELS) {
        throw new Error(`Pixel-motion generation is limited to ${MAX_GENERATED_PIXELS.toLocaleString()} pixels per frame.`);
    }
    if (!Array.isArray(candidate.grid) || candidate.grid.length !== height || candidate.grid.some((row) => !Array.isArray(row) || row.length !== width || row.some((color) => typeof color !== "string"))) {
        throw new Error("Aseprite returned an invalid hexadecimal pixel grid.");
    }
    return candidate.grid;
}
async function loadKeyGrid(dispatcher, frameNumber, layer) {
    const result = await dispatcher.send("get_pixel_grid", { frameIndex: frameNumber, format: "hex", ...selectors(layer) }, 10_000);
    return validateGrid(result);
}
function toPixels(grid) {
    return grid.flatMap((row, y) => row.map((color, x) => ({ x, y, color })));
}
async function insertDuplicatedFrame(dispatcher, sourceFrame, insertAt, durationMs) {
    const duplicate = await dispatcher.send("duplicate_frame", { frameNumber: sourceFrame }, 10_000);
    const duplicatedFrame = typeof duplicate.newFrameNumber === "number"
        ? duplicate.newFrameNumber
        : typeof duplicate.newFrame === "number"
            ? duplicate.newFrame
            : undefined;
    if (!duplicatedFrame || !Number.isInteger(duplicatedFrame) || duplicatedFrame < 1) {
        throw new Error("Aseprite did not return the position of the duplicated frame.");
    }
    if (duplicatedFrame !== insertAt) {
        await dispatcher.send("move_frame", { fromFrame: duplicatedFrame, toFrame: insertAt }, 15_000);
    }
    await dispatcher.send("set_frame_duration", { frameNumber: insertAt, durationMs }, 10_000);
}
async function writeGeneratedGrid(dispatcher, state, frameNumber, layer, grid) {
    const result = await dispatcher.send("set_pixels", {
        frameNumber,
        pixels: toPixels(grid),
        ...selectors(layer),
    }, 30_000);
    if (typeof result.revision === "number")
        state.setRevision(result.revision);
}
export function registerPixelMotionTools(server, dispatcher, state) {
    const layerSchema = {
        layerName: z.string().min(1).max(128).optional().describe("Image layer to interpolate; defaults to the active layer"),
        layerIndex: z.number().int().min(0).optional().describe("Flattened image-layer index; mutually exclusive with layerName"),
    };
    server.tool("create_pixel_art_tween", "Inserts crisp in-between frames between two key poses on one image layer. It moves same-color connected clusters as whole pixel groups; it never alpha-blends, rescales, or anti-aliases the artwork. Review the generated frames with the animation QA tools before final export.", {
        fromFrame: z.number().int().positive(),
        toFrame: z.number().int().positive(),
        inBetweenFrames: z.number().int().min(1).max(MAX_GENERATED_FRAMES),
        durationMs: z.number().int().min(1).max(60_000).optional().default(100),
        easing: z.enum(["linear", "ease_in_out"]).optional().default("ease_in_out"),
        ...layerSchema,
    }, async (params) => {
        try {
            if (params.fromFrame >= params.toFrame)
                throw new Error("fromFrame must precede toFrame.");
            const layer = selectors(params);
            const source = await loadKeyGrid(dispatcher, params.fromFrame, layer);
            const target = await loadKeyGrid(dispatcher, params.toFrame, layer);
            const generated = [];
            for (let index = 1; index <= params.inBetweenFrames; index += 1) {
                const frameNumber = params.fromFrame + index;
                const tween = buildClusterTween(source, target, index / (params.inBetweenFrames + 1), params.easing);
                await insertDuplicatedFrame(dispatcher, params.fromFrame, frameNumber, params.durationMs);
                await writeGeneratedGrid(dispatcher, state, frameNumber, layer, tween.grid);
                generated.push({ frameNumber, movedClusters: tween.movedClusters, unmatchedClusters: tween.unmatchedClusters });
            }
            return { content: [{ type: "text", text: JSON.stringify({
                            success: true,
                            generatedFrames: generated,
                            targetFrameAfterInsertion: params.toFrame + params.inBetweenFrames,
                            algorithm: "whole same-color 4-connected clusters with crisp half-way shape handoff",
                            reviewRequired: true,
                            nextSteps: ["get_canvas for every generated frame", "render_animation_preview", "analyze_animation_temporal"],
                            revision: state.getRevision(),
                        }, null, 2) }] };
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
    server.tool("create_smear_frame", "Inserts one deliberately stretched smear frame between two normal key poses. It derives movement from occupied bounds, draws crisp raster trails along that direction, and leaves both original key poses unchanged.", {
        fromFrame: z.number().int().positive(),
        toFrame: z.number().int().positive(),
        stretch: z.number().int().min(1).max(32).optional().default(6),
        durationMs: z.number().int().min(1).max(60_000).optional().default(50),
        ...layerSchema,
    }, async (params) => {
        try {
            if (params.fromFrame >= params.toFrame)
                throw new Error("fromFrame must precede toFrame.");
            const layer = selectors(params);
            const source = await loadKeyGrid(dispatcher, params.fromFrame, layer);
            const target = await loadKeyGrid(dispatcher, params.toFrame, layer);
            const smear = buildSmearFrame(source, target, params.stretch);
            const frameNumber = params.fromFrame + 1;
            await insertDuplicatedFrame(dispatcher, params.fromFrame, frameNumber, params.durationMs);
            await writeGeneratedGrid(dispatcher, state, frameNumber, layer, smear.grid);
            return { content: [{ type: "text", text: JSON.stringify({
                            success: true,
                            frameNumber,
                            targetFrameAfterInsertion: params.toFrame + 1,
                            motion: smear.motion,
                            stretch: params.stretch,
                            sourcePixelsStretched: smear.pixelsStretched,
                            keyframesPreserved: true,
                            reviewRequired: true,
                            revision: state.getRevision(),
                        }, null, 2) }] };
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
}
//# sourceMappingURL=pixelMotion.js.map