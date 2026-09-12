// src/mcp/tools/files.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CommandDispatcher } from "../../bridge/dispatcher.js";
import { BridgeState } from "../../bridge/state.js";
import {
  validateOpenPath,
  validateSaveAsPath,
  validateExportPngPath,
} from "../../security/fileAccess.js";

export function registerFileTools(
  server: McpServer,
  dispatcher: CommandDispatcher,
  stateTracker: BridgeState
): void {
  // 1. new_sprite
  server.tool(
    "new_sprite",
    "Creates a new blank sprite document in Aseprite with specified dimensions and color mode.",
    {
      width: z.number().int().positive().max(4096).default(32).describe("Canvas width in pixels"),
      height: z.number().int().positive().max(4096).default(32).describe("Canvas height in pixels"),
      colorMode: z.enum(["rgb", "grayscale", "indexed"]).optional().default("rgb").describe("Color mode"),
    },
    async (params) => {
      try {
        const res = await dispatcher.send<any>("new_sprite", params, 10000);
        if (typeof res.revision === "number") {
          stateTracker.setRevision(res.revision);
        }
        return {
          content: [
            {
              type: "text" as const,
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
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: err.message }, null, 2) }],
          isError: true,
        };
      }
    }
  );

  // 2. open_sprite
  server.tool(
    "open_sprite",
    "Opens an existing sprite file (.ase, .aseprite, .png) from disk.",
    {
      filePath: z.string().describe("Absolute file path to open in Aseprite"),
    },
    async (params) => {
      try {
        const canonicalPath = validateOpenPath(params.filePath);
        const res = await dispatcher.send<any>("open_sprite", { filePath: canonicalPath }, 15000);
        if (typeof res.revision === "number") {
          stateTracker.setRevision(res.revision);
        }
        return {
          content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: err.message }, null, 2) }],
          isError: true,
        };
      }
    }
  );

  // 3. save_sprite
  server.tool(
    "save_sprite",
    "Explicitly saves the active sprite to disk. (Saves only when explicitly requested).",
    {},
    async () => {
      try {
        const status = await dispatcher.send<any>("aseprite_status", {}, 5000);
        if (!status || !status.filename || typeof status.filename !== "string" || status.filename.trim() === "") {
          throw new Error("Cannot save sprite: active sprite has no filename (use save_sprite_as first).");
        }
        const canonicalPath = validateOpenPath(status.filename);
        const res = await dispatcher.send<any>("save_sprite", { expectedFilePath: canonicalPath }, 15000);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: err.message }, null, 2) }],
          isError: true,
        };
      }
    }
  );

  // 4. save_sprite_as
  server.tool(
    "save_sprite_as",
    "Saves the active sprite to a specific target file path on disk.",
    {
      filePath: z.string().describe("Target file path (.aseprite, .ase, or .png)"),
      overwrite: z.boolean().optional().default(false).describe("Whether to overwrite existing target file"),
    },
    async (params) => {
      try {
        const canonicalPath = validateSaveAsPath(params.filePath, params.overwrite ?? false);
        const res = await dispatcher.send<any>(
          "save_sprite_as",
          { filePath: canonicalPath, overwrite: params.overwrite ?? false },
          15000
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: err.message }, null, 2) }],
          isError: true,
        };
      }
    }
  );

  // 5. export_png
  server.tool(
    "export_png",
    "Exports the active sprite or frame to a PNG image file on disk.",
    {
      outputPath: z.string().describe("Target .png file path"),
      frameNumber: z.number().int().positive().optional().describe("Specific frame number to export"),
      scale: z.number().int().min(1).max(32).optional().default(1).describe("Nearest-neighbor export scale factor"),
      overwrite: z.boolean().optional().default(false).describe("Whether to overwrite existing target file"),
    },
    async (params) => {
      try {
        const canonicalPath = validateExportPngPath(params.outputPath, params.overwrite ?? false);
        const res = await dispatcher.send<any>(
          "export_png",
          {
            ...params,
            outputPath: canonicalPath,
            overwrite: params.overwrite ?? false,
          },
          15000
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: err.message }, null, 2) }],
          isError: true,
        };
      }
    }
  );

  // 6. resize_canvas
  server.tool(
    "resize_canvas",
    "Resizes the active sprite canvas dimensions without interpolation or blurring.",
    {
      width: z.number().int().positive().max(4096).describe("New canvas width"),
      height: z.number().int().positive().max(4096).describe("New canvas height"),
      anchor: z.enum(["top_left", "center", "top_right", "bottom_left", "bottom_right"]).optional().default("top_left").describe("Anchor point for resizing"),
    },
    async (params) => {
      try {
        const res = await dispatcher.send<any>("resize_canvas", params, 10000);
        if (typeof res.revision === "number") {
          stateTracker.setRevision(res.revision);
        }
        return {
          content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: err.message }, null, 2) }],
          isError: true,
        };
      }
    }
  );
}
