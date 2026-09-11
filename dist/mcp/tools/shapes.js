import { z } from "zod";
export function registerShapeTools(server, dispatcher, stateTracker) {
    // 1. draw_line
    server.tool("draw_line", "Draws a pixel art line from (x1, y1) to (x2, y2) using Bresenham's algorithm in a single undo transaction.", {
        x1: z.number().int().describe("Start X coordinate"),
        y1: z.number().int().describe("Start Y coordinate"),
        x2: z.number().int().describe("End X coordinate"),
        y2: z.number().int().describe("End Y coordinate"),
        color: z.string().describe("Hex color string e.g. #FF0000FF"),
        thickness: z.number().int().min(1).max(32).optional().default(1).describe("Line thickness in pixels"),
        layerName: z.string().optional(),
        layerIndex: z.number().int().min(0).optional(),
        frameNumber: z.number().int().positive().optional(),
        returnPreview: z.boolean().optional().default(false),
    }, async (params) => {
        try {
            const res = await dispatcher.send("draw_line", params, 10000);
            if (typeof res.revision === "number")
                stateTracker.setRevision(res.revision);
            const content = [];
            if (params.returnPreview && res.pngBase64) {
                content.push({ type: "image", data: res.pngBase64, mimeType: "image/png" });
            }
            content.push({ type: "text", text: JSON.stringify(res, null, 2) });
            return { content };
        }
        catch (err) {
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
        }
    });
    // 2. draw_rectangle
    server.tool("draw_rectangle", "Draws a rectangle (outline or filled) on the canvas in a single undo transaction.", {
        x: z.number().int().describe("Top-left X"),
        y: z.number().int().describe("Top-left Y"),
        width: z.number().int().positive().describe("Width in pixels"),
        height: z.number().int().positive().describe("Height in pixels"),
        color: z.string().describe("Hex color"),
        filled: z.boolean().optional().default(false).describe("Whether to fill interior"),
        layerName: z.string().optional(),
        layerIndex: z.number().int().min(0).optional(),
        frameNumber: z.number().int().positive().optional(),
        returnPreview: z.boolean().optional().default(false),
    }, async (params) => {
        try {
            const res = await dispatcher.send("draw_rectangle", params, 10000);
            if (typeof res.revision === "number")
                stateTracker.setRevision(res.revision);
            const content = [];
            if (params.returnPreview && res.pngBase64) {
                content.push({ type: "image", data: res.pngBase64, mimeType: "image/png" });
            }
            content.push({ type: "text", text: JSON.stringify(res, null, 2) });
            return { content };
        }
        catch (err) {
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
        }
    });
    // 3. draw_ellipse
    server.tool("draw_ellipse", "Draws an ellipse (outline or filled) within a bounding box in a single undo transaction.", {
        x: z.number().int().describe("Bounding box top-left X"),
        y: z.number().int().describe("Bounding box top-left Y"),
        width: z.number().int().positive().describe("Bounding box width"),
        height: z.number().int().positive().describe("Bounding box height"),
        color: z.string().describe("Hex color"),
        filled: z.boolean().optional().default(false).describe("Whether to fill interior"),
        layerName: z.string().optional(),
        layerIndex: z.number().int().min(0).optional(),
        frameNumber: z.number().int().positive().optional(),
        returnPreview: z.boolean().optional().default(false),
    }, async (params) => {
        try {
            const res = await dispatcher.send("draw_ellipse", params, 10000);
            if (typeof res.revision === "number")
                stateTracker.setRevision(res.revision);
            const content = [];
            if (params.returnPreview && res.pngBase64) {
                content.push({ type: "image", data: res.pngBase64, mimeType: "image/png" });
            }
            content.push({ type: "text", text: JSON.stringify(res, null, 2) });
            return { content };
        }
        catch (err) {
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
        }
    });
    // 4. flood_fill
    server.tool("flood_fill", "Fills a contiguous area of matching pixels starting from (x, y) with color in a single undo transaction.", {
        x: z.number().int().describe("Seed point X"),
        y: z.number().int().describe("Seed point Y"),
        color: z.string().describe("New fill color (hex)"),
        tolerance: z.number().int().min(0).max(255).optional().default(0).describe("Color tolerance (0-255)"),
        layerName: z.string().optional(),
        layerIndex: z.number().int().min(0).optional(),
        frameNumber: z.number().int().positive().optional(),
        returnPreview: z.boolean().optional().default(false),
    }, async (params) => {
        try {
            const res = await dispatcher.send("flood_fill", params, 15000);
            if (typeof res.revision === "number")
                stateTracker.setRevision(res.revision);
            const content = [];
            if (params.returnPreview && res.pngBase64) {
                content.push({ type: "image", data: res.pngBase64, mimeType: "image/png" });
            }
            content.push({ type: "text", text: JSON.stringify(res, null, 2) });
            return { content };
        }
        catch (err) {
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
        }
    });
    // 5. replace_color
    server.tool("replace_color", "Replaces all occurrences of fromColor with toColor across the cel or sprite in a single undo transaction.", {
        fromColor: z.string().describe("Source color to replace (hex)"),
        toColor: z.string().describe("Replacement color (hex)"),
        tolerance: z.number().int().min(0).max(255).optional().default(0),
        layerName: z.string().optional(),
        frameNumber: z.number().int().positive().optional(),
        returnPreview: z.boolean().optional().default(false),
    }, async (params) => {
        try {
            const res = await dispatcher.send("replace_color", params, 15000);
            if (typeof res.revision === "number")
                stateTracker.setRevision(res.revision);
            const content = [];
            if (params.returnPreview && res.pngBase64) {
                content.push({ type: "image", data: res.pngBase64, mimeType: "image/png" });
            }
            content.push({ type: "text", text: JSON.stringify(res, null, 2) });
            return { content };
        }
        catch (err) {
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
        }
    });
    // 6. get_changes_since
    server.tool("get_changes_since", "Differential inspection: returns modified regions and pixel deltas since a specified revision number, avoiding re-reading the entire canvas.", {
        sinceRevision: z.number().int().nonnegative().describe("Base revision to diff against"),
    }, async (params) => {
        try {
            const res = await dispatcher.send("get_changes_since", params, 10000);
            return {
                content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
            };
        }
        catch (err) {
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
        }
    });
}
//# sourceMappingURL=shapes.js.map