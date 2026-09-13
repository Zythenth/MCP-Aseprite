import { z } from "zod";
import { MAX_PIXELS_BATCH } from "../../config.js";
import { decodePngBase64Sync } from "../../image/png.js";
import { analyzeImagePalette, deltaE2000, generateDitherPixels, generatePaletteRamp, lintPixelArt, parseHexColor, rgbToLab, } from "../../image/pixelArt.js";
import { bridgeToolError, bridgeToolResult } from "./common.js";
async function fetchCanvas(dispatcher, state, params) {
    const result = await dispatcher.send("get_canvas", {
        frameIndex: params.frameNumber,
        layerName: params.layerName,
    }, 10_000);
    if (typeof result.revision === "number")
        state.setRevision(result.revision);
    if (typeof result.pngBase64 !== "string")
        throw new Error("Aseprite bridge did not return canvas PNG data.");
    return { image: decodePngBase64Sync(result.pngBase64), revision: result.revision, frameNumber: result.frameNumber };
}
export function registerPixelArtTools(server, dispatcher, state, reviews) {
    server.tool("lint_pixel_art", "Runs deterministic pixel-art checks for orphan pixels, one-pixel gaps, banding, possible pillow shading, symmetry drift, and tile seams. Heuristic findings include confidence and are never applied automatically.", {
        frameNumber: z.number().int().positive().optional(),
        layerName: z.string().optional(),
        maxFindings: z.number().int().min(1).max(1000).optional().default(200),
    }, async (params) => {
        try {
            const canvas = await fetchCanvas(dispatcher, state, params);
            const report = lintPixelArt(canvas.image, params.maxFindings ?? 200);
            const sessionId = state.getSessionId();
            const waiverResult = reviews && sessionId
                ? reviews.applyWaivers(report.findings, {
                    sessionId,
                    frameNumber: canvas.frameNumber,
                    layerName: params.layerName,
                })
                : { findings: report.findings, suppressed: [] };
            const visibleSummary = {};
            for (const finding of waiverResult.findings) {
                visibleSummary[finding.rule] = (visibleSummary[finding.rule] ?? 0) + 1;
            }
            return {
                content: [{ type: "text", text: JSON.stringify({
                            width: canvas.image.width,
                            height: canvas.image.height,
                            frameNumber: canvas.frameNumber,
                            revision: canvas.revision,
                            truncated: report.truncated,
                            droppedFindings: report.droppedFindings,
                            findings: waiverResult.findings,
                            summary: visibleSummary,
                            suppressedCount: waiverResult.suppressed.length,
                            suppressed: waiverResult.suppressed,
                            disclaimer: "Low- and medium-confidence findings require visual review; intentional style choices are not errors.",
                        }, null, 2) }],
            };
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
    server.tool("analyze_palette", "Analyzes colors actually used in a rendered frame, including frequency, inferred harmony, and perceptually near-duplicate colors using CIEDE2000.", {
        frameNumber: z.number().int().positive().optional(),
        layerName: z.string().optional(),
        nearDuplicateThreshold: z.number().min(0.1).max(20).optional().default(3),
    }, async (params) => {
        try {
            const canvas = await fetchCanvas(dispatcher, state, params);
            const analysis = analyzeImagePalette(canvas.image, params.nearDuplicateThreshold ?? 3);
            return {
                content: [{ type: "text", text: JSON.stringify({
                            frameNumber: canvas.frameNumber,
                            revision: canvas.revision,
                            ...analysis,
                        }, null, 2) }],
            };
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
    server.tool("find_perceptual_palette_color", "Finds the nearest active-palette entry using CIEDE2000 rather than raw RGB distance.", {
        color: z.string().describe("Target color in #RGB, #RGBA, #RRGGBB, or #RRGGBBAA format"),
        includeTransparent: z.boolean().optional().default(false),
    }, async (params) => {
        try {
            const target = parseHexColor(params.color);
            const targetLab = rgbToLab(target);
            const response = await dispatcher.send("get_palette", {}, 5_000);
            const colors = Array.isArray(response.colors) ? response.colors : [];
            const candidates = colors
                .map((entry) => ({ ...entry, parsed: parseHexColor(String(entry.hex)) }))
                .filter((entry) => params.includeTransparent || entry.parsed.a > 0);
            if (candidates.length === 0)
                throw new Error("The active palette has no eligible colors.");
            const ranked = candidates.map((entry) => ({
                index: entry.index,
                hex: entry.hex,
                deltaE: deltaE2000(targetLab, rgbToLab(entry.parsed)) + Math.abs(target.a - entry.parsed.a) / 255 * 100,
            })).sort((left, right) => left.deltaE - right.deltaE);
            return {
                content: [{ type: "text", text: JSON.stringify({
                            target: params.color,
                            match: ranked[0],
                            alternatives: ranked.slice(1, 5),
                            metric: "CIEDE2000 plus alpha-distance penalty",
                        }, null, 2) }],
            };
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
    server.tool("generate_palette_ramp", "Generates a deterministic lightness ramp around a base color with optional opposing shadow/highlight hue shifts. It does not modify the sprite.", {
        baseColor: z.string(),
        steps: z.number().int().min(2).max(16).optional().default(5),
        shadowLightness: z.number().min(0).max(1).optional().default(0.18),
        highlightLightness: z.number().min(0).max(1).optional().default(0.82),
        hueShift: z.number().min(-90).max(90).optional().default(12).describe("Degrees applied in opposite directions toward shadow and highlight"),
    }, async (params) => {
        try {
            if ((params.shadowLightness ?? 0.18) >= (params.highlightLightness ?? 0.82)) {
                throw new Error("shadowLightness must be lower than highlightLightness.");
            }
            const colors = generatePaletteRamp(params.baseColor, params.steps ?? 5, params.shadowLightness ?? 0.18, params.highlightLightness ?? 0.82, params.hueShift ?? 12);
            return { content: [{ type: "text", text: JSON.stringify({ colors }, null, 2) }] };
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
    server.tool("apply_ordered_dither", "Applies a bounded 2x2, 4x4, or 8x8 Bayer dither as one atomic set_pixels operation. Returns exact bounds and an optional updated preview.", {
        region: z.object({
            x: z.number().int().min(0),
            y: z.number().int().min(0),
            width: z.number().int().positive(),
            height: z.number().int().positive(),
        }).refine((region) => region.width * region.height <= MAX_PIXELS_BATCH, {
            message: `Dither region cannot exceed ${MAX_PIXELS_BATCH} pixels.`,
        }),
        colorA: z.string(),
        colorB: z.string(),
        amount: z.number().min(0).max(1).optional().default(0.5).describe("Approximate share of colorB"),
        matrixSize: z.union([z.literal(2), z.literal(4), z.literal(8)]).optional().default(4),
        layerName: z.string().optional(),
        layerIndex: z.number().int().min(0).optional(),
        frameNumber: z.number().int().positive().optional(),
        returnPreview: z.boolean().optional().default(true),
    }, async (params) => {
        try {
            parseHexColor(params.colorA);
            parseHexColor(params.colorB);
            const pixels = generateDitherPixels(params.region, params.colorA, params.colorB, params.amount ?? 0.5, params.matrixSize ?? 4);
            const result = await dispatcher.send("set_pixels", {
                pixels,
                layerName: params.layerName,
                layerIndex: params.layerIndex,
                frameNumber: params.frameNumber,
                returnPreview: params.returnPreview,
            }, 15_000);
            return bridgeToolResult({
                ...result,
                dither: { matrixSize: params.matrixSize ?? 4, amount: params.amount ?? 0.5, region: params.region },
            }, state, params.returnPreview ?? true);
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
}
//# sourceMappingURL=pixelArt.js.map