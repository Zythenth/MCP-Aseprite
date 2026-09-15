import { z } from "zod";
import { decodePngBase64Sync, encodeRgbaToPngBase64 } from "../../image/png.js";
import { bridgePreviewPngBase64 } from "../../image/bridgeCanvas.js";
import { scaleNearestNeighbor } from "../../image/scaling.js";
import { MAX_PIXELS_BATCH } from "../../config.js";
import { bridgeToolError, bridgeToolResult } from "./common.js";
export function registerEditingTools(server, dispatcher, stateTracker) {
    // 1. set_pixels (PRIMARY DRAWING TOOL)
    server.tool("set_pixels", "PRIMARY DRAWING TOOL: Paints tens to thousands of pixels in a single batch operation and single atomic undo step. Returns modified count, affected bounding box, and optional updated preview.", {
        pixels: z.array(z.object({
            x: z.number().int().describe("X coordinate in canvas space (0-indexed)"),
            y: z.number().int().describe("Y coordinate in canvas space (0-indexed)"),
            color: z.string().describe("Hex color e.g. #FF0000FF, #363636FF, or #00000000 for transparent"),
        })).min(1).max(MAX_PIXELS_BATCH).describe("Batch of pixel coordinates and hex colors to paint"),
        layerName: z.string().optional().describe("Optional target layer name (defaults to active layer)"),
        layerIndex: z.number().int().min(0).optional().describe("Optional target layer index"),
        frameNumber: z.number().int().positive().optional().describe("Target frame number (1-indexed, defaults to active frame)"),
        returnPreview: z.boolean().optional().default(false).describe("When true, returns updated PNG image content in the same response"),
        previewScale: z.number().int().min(1).max(16).optional().default(1).describe("Scale factor for returnPreview (default 1x)"),
    }, async (params) => {
        try {
            const res = await dispatcher.send("set_pixels", params, 15000);
            if (typeof res.revision === "number") {
                stateTracker.setRevision(res.revision);
            }
            const content = [];
            // If preview was requested and returned
            const returnedPreview = params.returnPreview ? bridgePreviewPngBase64(res) : undefined;
            if (returnedPreview) {
                let previewData = returnedPreview;
                const scale = params.previewScale ?? 1;
                if (scale > 1) {
                    const img = decodePngBase64Sync(previewData);
                    const scaled = scaleNearestNeighbor(img.data, img.width, img.height, scale);
                    previewData = encodeRgbaToPngBase64(scaled.data, scaled.width, scaled.height).base64;
                }
                content.push({
                    type: "image",
                    data: previewData,
                    mimeType: "image/png",
                });
            }
            content.push({
                type: "text",
                text: JSON.stringify({
                    success: true,
                    pixelsModified: res.pixelsModified ?? res.modifiedPixels ?? params.pixels.length,
                    bounds: res.bounds ?? { x: 0, y: 0, width: 0, height: 0 },
                    revision: res.revision,
                }, null, 2),
            });
            return { content };
        }
        catch (err) {
            return {
                content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }],
                isError: true,
            };
        }
    });
    // 2. set_pixel
    server.tool("set_pixel", "Paints a single pixel at (x, y) with the specified color within an atomic undo transaction.", {
        x: z.number().int().describe("X coordinate in canvas space"),
        y: z.number().int().describe("Y coordinate in canvas space"),
        color: z.string().describe("Hex color (#RRGGBBAA or #RRGGBB)"),
        layerName: z.string().optional().describe("Optional target layer name"),
        layerIndex: z.number().int().min(0).optional().describe("Optional target layer index"),
        frameNumber: z.number().int().positive().optional().describe("Target frame number (1-indexed)"),
        returnPreview: z.boolean().optional().default(false).describe("When true, returns updated preview image"),
    }, async (params) => {
        try {
            const res = await dispatcher.send("set_pixel", params, 10000);
            if (typeof res.revision === "number") {
                stateTracker.setRevision(res.revision);
            }
            const content = [];
            const returnedPreview = params.returnPreview ? bridgePreviewPngBase64(res) : undefined;
            if (returnedPreview) {
                content.push({
                    type: "image",
                    data: returnedPreview,
                    mimeType: "image/png",
                });
            }
            content.push({
                type: "text",
                text: JSON.stringify({
                    success: true,
                    pixelsModified: res.pixelsModified ?? 1,
                    bounds: res.bounds ?? { x: params.x, y: params.y, width: 1, height: 1 },
                    revision: res.revision,
                }, null, 2),
            });
            return { content };
        }
        catch (err) {
            return {
                content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }],
                isError: true,
            };
        }
    });
    // 3. erase_pixels
    server.tool("erase_pixels", "Erases a list of pixel coordinates by turning them transparent (#00000000) within a single undo transaction.", {
        points: z.array(z.object({
            x: z.number().int(),
            y: z.number().int(),
        })).min(1).max(MAX_PIXELS_BATCH).describe("List of (x, y) pixel coordinates to erase"),
        layerName: z.string().optional().describe("Optional target layer name"),
        layerIndex: z.number().int().min(0).optional().describe("Optional target layer index"),
        frameNumber: z.number().int().positive().optional().describe("Target frame number (1-indexed)"),
        returnPreview: z.boolean().optional().default(false).describe("When true, returns updated preview image"),
    }, async (params) => {
        try {
            const res = await dispatcher.send("erase_pixels", params, 10000);
            if (typeof res.revision === "number") {
                stateTracker.setRevision(res.revision);
            }
            const content = [];
            const returnedPreview = params.returnPreview ? bridgePreviewPngBase64(res) : undefined;
            if (returnedPreview) {
                content.push({
                    type: "image",
                    data: returnedPreview,
                    mimeType: "image/png",
                });
            }
            content.push({
                type: "text",
                text: JSON.stringify({
                    success: true,
                    pixelsErased: res.pixelsModified ?? params.points.length,
                    bounds: res.bounds ?? { x: 0, y: 0, width: 0, height: 0 },
                    revision: res.revision,
                }, null, 2),
            });
            return { content };
        }
        catch (err) {
            return {
                content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }],
                isError: true,
            };
        }
    });
    // 4. undo
    server.tool("undo", "Undoes the most recent editing tool call or transaction on the active sprite.", { returnPreview: z.boolean().optional().default(false) }, async (params) => {
        try {
            return bridgeToolResult(await dispatcher.send("undo", params, 5000), stateTracker, params.returnPreview);
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
    // 5. redo
    server.tool("redo", "Redoes the most recently undone editing operation on the active sprite.", { returnPreview: z.boolean().optional().default(false) }, async (params) => {
        try {
            return bridgeToolResult(await dispatcher.send("redo", params, 5000), stateTracker, params.returnPreview);
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
}
//# sourceMappingURL=editing.js.map