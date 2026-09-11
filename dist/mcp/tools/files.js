import { z } from "zod";
export function registerFileTools(server, dispatcher, stateTracker) {
    // 1. new_sprite
    server.tool("new_sprite", "Creates a new blank sprite document in Aseprite with specified dimensions and color mode.", {
        width: z.number().int().positive().max(4096).default(32).describe("Canvas width in pixels"),
        height: z.number().int().positive().max(4096).default(32).describe("Canvas height in pixels"),
        colorMode: z.enum(["rgb", "grayscale", "indexed"]).optional().default("rgb").describe("Color mode"),
    }, async (params) => {
        try {
            const res = await dispatcher.send("new_sprite", params, 10000);
            if (typeof res.revision === "number") {
                stateTracker.setRevision(res.revision);
            }
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            success: true,
                            message: `Created new ${res.width}x${res.height} ${res.colorMode ?? "rgb"} sprite`,
                            width: res.width,
                            height: res.height,
                            colorMode: res.colorMode,
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
    // 2. open_sprite
    server.tool("open_sprite", "Opens an existing sprite file (.ase, .aseprite, .png) from disk.", {
        filePath: z.string().describe("Absolute file path to open in Aseprite"),
    }, async (params) => {
        try {
            const res = await dispatcher.send("open_sprite", params, 15000);
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
            const res = await dispatcher.send("save_sprite", {}, 15000);
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
    }, async (params) => {
        try {
            const res = await dispatcher.send("save_sprite_as", params, 15000);
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
    }, async (params) => {
        try {
            const res = await dispatcher.send("export_png", params, 15000);
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
    }, async (params) => {
        try {
            const res = await dispatcher.send("resize_canvas", params, 10000);
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
}
//# sourceMappingURL=files.js.map