import { z } from "zod";
import { decodePngBase64Sync, encodeRgbaToPngBase64 } from "../../image/png.js";
import { scaleNearestNeighbor } from "../../image/scaling.js";
export function registerEditingTools(server, dispatcher, stateTracker) {
    // 1. set_pixels (PRIMARY DRAWING TOOL)
    server.tool("set_pixels", "PRIMARY DRAWING TOOL: Paints tens to thousands of pixels in a single batch operation and single atomic undo step. Returns modified count, affected bounding box, and optional updated preview.", {
        pixels: z.array(z.object({
            x: z.number().int().describe("X coordinate in canvas space (0-indexed)"),
            y: z.number().int().describe("Y coordinate in canvas space (0-indexed)"),
            color: z.string().describe("Hex color e.g. #FF0000FF, #363636FF, or #00000000 for transparent"),
        })).min(1).describe("Batch of pixel coordinates and hex colors to paint"),
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
            if (params.returnPreview && res.pngBase64) {
                let previewData = res.pngBase64;
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
            if (params.returnPreview && res.pngBase64) {
                content.push({
                    type: "image",
                    data: res.pngBase64,
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
        })).min(1).describe("List of (x, y) pixel coordinates to erase"),
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
            if (params.returnPreview && res.pngBase64) {
                content.push({
                    type: "image",
                    data: res.pngBase64,
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
    server.tool("undo", "Undoes the most recent editing tool call or transaction on the active sprite.", {}, async () => {
        try {
            const res = await dispatcher.send("undo", {}, 5000);
            if (typeof res.revision === "number") {
                stateTracker.setRevision(res.revision);
            }
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            success: true,
                            message: "Undo executed successfully",
                            revision: res.revision,
                        }, null, 2),
                    },
                ],
            };
        }
        catch (err) {
            return {
                content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }],
                isError: true,
            };
        }
    });
    // 5. redo
    server.tool("redo", "Redoes the most recently undone editing operation on the active sprite.", {}, async () => {
        try {
            const res = await dispatcher.send("redo", {}, 5000);
            if (typeof res.revision === "number") {
                stateTracker.setRevision(res.revision);
            }
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            success: true,
                            message: "Redo executed successfully",
                            revision: res.revision,
                        }, null, 2),
                    },
                ],
            };
        }
        catch (err) {
            return {
                content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }],
                isError: true,
            };
        }
    });
}
//# sourceMappingURL=editing.js.map