import { z } from "zod";
import { validateOpenPath, validateSaveAsPath, validateExportPngPath, } from "../../security/fileAccess.js";
import { bridgeToolResult } from "./common.js";
export function registerFileTools(server, dispatcher, stateTracker) {
    // 1. new_sprite
    server.tool("new_sprite", "Creates a new blank sprite document in Aseprite with specified dimensions and color mode.", {
        width: z.number().int().positive().max(4096).default(32).describe("Canvas width in pixels"),
        height: z.number().int().positive().max(4096).default(32).describe("Canvas height in pixels"),
        colorMode: z.enum(["rgb", "grayscale", "indexed"]).optional().default("rgb").describe("Color mode"),
        returnPreview: z.boolean().optional().default(false),
    }, async (params) => {
        try {
            const res = await dispatcher.send("new_sprite", params, 10000);
            if (typeof res.revision === "number") {
                stateTracker.setRevision(res.revision);
            }
            return bridgeToolResult({ ...res, message: `Created new ${res.width}x${res.height} ${res.colorMode ?? "rgb"} sprite` }, stateTracker, params.returnPreview);
        }
        catch (err) {
            return {
                content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }],
                isError: true,
            };
        }
    });
    // 2. open_sprite
    server.tool("open_sprite", "Opens an existing sprite file (.ase, .aseprite, .png) from disk.", {
        filePath: z.string().describe("Absolute file path to open in Aseprite"),
    }, async (params) => {
        try {
            const canonicalPath = validateOpenPath(params.filePath);
            const res = await dispatcher.send("open_sprite", { filePath: canonicalPath }, 15000);
            if (typeof res.revision === "number") {
                stateTracker.setRevision(res.revision);
            }
            return {
                content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
            };
        }
        catch (err) {
            return {
                content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }],
                isError: true,
            };
        }
    });
    // 3. save_sprite
    server.tool("save_sprite", "Explicitly saves the active sprite to disk. (Saves only when explicitly requested).", {}, async () => {
        try {
            const status = await dispatcher.send("aseprite_status", {}, 5000);
            if (!status || !status.filename || typeof status.filename !== "string" || status.filename.trim() === "") {
                throw new Error("Cannot save sprite: active sprite has no filename (use save_sprite_as first).");
            }
            const canonicalPath = validateOpenPath(status.filename);
            const res = await dispatcher.send("save_sprite", { expectedFilePath: canonicalPath }, 15000);
            return {
                content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
            };
        }
        catch (err) {
            return {
                content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }],
                isError: true,
            };
        }
    });
    // 4. save_sprite_as
    server.tool("save_sprite_as", "Saves the active sprite to a specific target file path on disk.", {
        filePath: z.string().describe("Target file path (.aseprite, .ase, or .png)"),
        overwrite: z.boolean().optional().default(false).describe("Whether to overwrite existing target file"),
    }, async (params) => {
        try {
            const canonicalPath = validateSaveAsPath(params.filePath, params.overwrite ?? false);
            const res = await dispatcher.send("save_sprite_as", { filePath: canonicalPath, overwrite: params.overwrite ?? false }, 15000);
            return {
                content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
            };
        }
        catch (err) {
            return {
                content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }],
                isError: true,
            };
        }
    });
    // 5. export_png
    server.tool("export_png", "Exports the active sprite or frame to a PNG image file on disk.", {
        outputPath: z.string().describe("Target .png file path"),
        frameNumber: z.number().int().positive().optional().describe("Specific frame number to export"),
        scale: z.number().int().min(1).max(32).optional().default(1).describe("Nearest-neighbor export scale factor"),
        overwrite: z.boolean().optional().default(false).describe("Whether to overwrite existing target file"),
    }, async (params) => {
        try {
            const canonicalPath = validateExportPngPath(params.outputPath, params.overwrite ?? false);
            const res = await dispatcher.send("export_png", {
                ...params,
                outputPath: canonicalPath,
                overwrite: params.overwrite ?? false,
            }, 15000);
            return {
                content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
            };
        }
        catch (err) {
            return {
                content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }],
                isError: true,
            };
        }
    });
    // 6. resize_canvas
    server.tool("resize_canvas", "Resizes the active sprite canvas dimensions without interpolation or blurring.", {
        width: z.number().int().positive().max(4096).describe("New canvas width"),
        height: z.number().int().positive().max(4096).describe("New canvas height"),
        anchor: z.enum(["top_left", "center", "top_right", "bottom_left", "bottom_right"]).optional().default("top_left").describe("Anchor point for resizing"),
        returnPreview: z.boolean().optional().default(false),
    }, async (params) => {
        try {
            const res = await dispatcher.send("resize_canvas", params, 10000);
            if (typeof res.revision === "number") {
                stateTracker.setRevision(res.revision);
            }
            return bridgeToolResult(res, stateTracker, params.returnPreview);
        }
        catch (err) {
            return {
                content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }],
                isError: true,
            };
        }
    });
    server.tool("export_sprite_sheet", "Exports a tag or explicit frame range as a horizontal, vertical, or grid PNG sheet, optionally compositing only selected non-group layers.", {
        outputPath: z.string().describe("Target .png file path"),
        fromFrame: z.number().int().positive().optional(),
        toFrame: z.number().int().positive().optional(),
        tagName: z.string().optional().describe("Animation tag to export; mutually exclusive with fromFrame/toFrame"),
        layerNames: z.array(z.string()).min(1).max(64).optional().describe("Optional non-group layers to composite"),
        layout: z.enum(["horizontal", "vertical", "grid"]).optional().default("horizontal"),
        columns: z.number().int().min(1).max(64).optional().describe("Grid columns; required only to override automatic grid layout"),
        spacing: z.number().int().min(0).max(64).optional().default(0).describe("Transparent pixels between frames"),
        scale: z.number().int().min(1).max(32).optional().default(1),
        overwrite: z.boolean().optional().default(false),
    }, async (params) => {
        try {
            if (params.tagName && (params.fromFrame !== undefined || params.toFrame !== undefined)) {
                throw new Error("tagName is mutually exclusive with fromFrame/toFrame.");
            }
            if ((params.fromFrame === undefined) !== (params.toFrame === undefined)) {
                throw new Error("fromFrame and toFrame must be provided together.");
            }
            if (params.fromFrame !== undefined && params.toFrame !== undefined && params.fromFrame > params.toFrame) {
                throw new Error("fromFrame must be less than or equal to toFrame.");
            }
            const canonicalPath = validateExportPngPath(params.outputPath, params.overwrite ?? false);
            const result = await dispatcher.send("export_sprite_sheet", {
                ...params,
                outputPath: canonicalPath,
                overwrite: params.overwrite ?? false,
            }, 30_000);
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }
        catch (error) {
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: error.message }, null, 2) }], isError: true };
        }
    });
}
//# sourceMappingURL=files.js.map