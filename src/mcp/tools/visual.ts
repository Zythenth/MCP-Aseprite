// src/mcp/tools/visual.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CommandDispatcher } from "../../bridge/dispatcher.js";
import { BridgeState } from "../../bridge/state.js";
import { decodePngBase64Sync, encodeRgbaToPngBase64 } from "../../image/png.js";
import { scaleNearestNeighbor } from "../../image/scaling.js";
import { applyCheckerboardBackdrop } from "../../image/checkerboard.js";
import { generatePixelGridPreview } from "../../image/preview.js";

export function registerVisualTools(
  server: McpServer,
  dispatcher: CommandDispatcher,
  stateTracker: BridgeState
): void {
  // 1. get_sprite_info
  server.tool(
    "get_sprite_info",
    "Returns complete structural information about the active sprite, including dimensions, color mode, layers hierarchy, animation frames, active layer/frame, and revision.",
    {},
    async () => {
      try {
        const result = await dispatcher.send<any>("get_sprite_info", {}, 5000);
        if (typeof result.revision === "number") {
          stateTracker.setRevision(result.revision);
        }
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
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

  // 2. get_canvas
  server.tool(
    "get_canvas",
    "Renders the active sprite canvas/frame as a crisp PNG image using nearest-neighbor scaling. Returns official MCP image content.",
    {
      frameIndex: z.number().int().positive().optional().describe("Frame number to render (1-indexed, defaults to active frame)"),
      scale: z.number().int().min(1).max(32).optional().default(1).describe("Nearest-neighbor integer scale multiplier (e.g. 8 for 8x zoom)"),
      checkerboard: z.boolean().optional().default(false).describe("Overlay checkerboard backdrop behind transparent pixels"),
      layerName: z.string().optional().describe("Optional specific layer name to render instead of composite"),
    },
    async (params) => {
      try {
        const res = await dispatcher.send<any>("get_canvas", params, 10000);
        if (typeof res.revision === "number") {
          stateTracker.setRevision(res.revision);
        }

        let pngBase64 = res.pngBase64;
        const scale = params.scale ?? 1;
        const useCheckerboard = params.checkerboard ?? false;

        if ((scale > 1 || useCheckerboard) && pngBase64) {
          const img = decodePngBase64Sync(pngBase64);
          let rawData = img.data;
          if (useCheckerboard) {
            rawData = applyCheckerboardBackdrop(rawData, img.width, img.height);
          }
          if (scale > 1) {
            const scaled = scaleNearestNeighbor(rawData, img.width, img.height, scale);
            pngBase64 = encodeRgbaToPngBase64(scaled.data, scaled.width, scaled.height).base64;
          } else {
            pngBase64 = encodeRgbaToPngBase64(rawData, img.width, img.height).base64;
          }
        }

        return {
          content: [
            {
              type: "image" as const,
              data: pngBase64,
              mimeType: "image/png",
            },
            {
              type: "text" as const,
              text: JSON.stringify({
                width: res.width * scale,
                height: res.height * scale,
                originalWidth: res.width,
                originalHeight: res.height,
                scale,
                frameNumber: res.frameNumber,
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

  // 3. get_pixel_grid
  server.tool(
    "get_pixel_grid",
    "Returns exact pixel values from the canvas or cel in absolute canvas coordinates (0,0 is top-left). Supports hex, rgba, indexed, or token-saving compact format.",
    {
      frameIndex: z.number().int().positive().optional().describe("Frame number (1-indexed)"),
      layerName: z.string().optional().describe("Layer name to inspect (defaults to active layer)"),
      layerIndex: z.number().int().min(0).optional().describe("Layer index to inspect"),
      format: z.enum(["hex", "rgba", "indexed", "compact"]).optional().default("hex").describe("Pixel output format"),
      region: z.object({
        x: z.number().int().min(0),
        y: z.number().int().min(0),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      }).optional().describe("Optional sub-region of pixels to inspect"),
    },
    async (params) => {
      try {
        const res = await dispatcher.send<any>("get_pixel_grid", params, 10000);
        if (typeof res.revision === "number") {
          stateTracker.setRevision(res.revision);
        }

        // Apply region filter if specified
        if (params.region && Array.isArray(res.grid)) {
          const { x: rx, y: ry, width: rw, height: rh } = params.region;
          const subGrid: any[] = [];
          for (let y = ry; y < Math.min(res.height, ry + rh); y++) {
            const row: any[] = [];
            for (let x = rx; x < Math.min(res.width, rx + rw); x++) {
              row.push(res.grid[y]?.[x] ?? "#00000000");
            }
            subGrid.push(row);
          }
          res.grid = subGrid;
          res.region = params.region;
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(res, null, 2),
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

  // 4. inspect_sprite (Primary Vision Tool)
  server.tool(
    "inspect_sprite",
    "PRIMARY VISION TOOL: Inspects the active sprite. In a single call returns: crisp PNG image content, sprite dimensions, active layer and frame, revision, and compact pixel matrix.",
    {
      frameIndex: z.number().int().positive().optional().describe("Frame number (1-indexed)"),
      scale: z.number().int().min(1).max(32).optional().default(4).describe("Nearest-neighbor scale multiplier for PNG preview (default 4x)"),
      format: z.enum(["compact", "hex", "rgba"]).optional().default("compact").describe("Pixel grid format (defaults to compact for token efficiency)"),
      includePixels: z.boolean().optional().default(true).describe("Whether to include the structured pixel grid in text response"),
    },
    async (params) => {
      try {
        const res = await dispatcher.send<any>("inspect_sprite", params, 10000);
        if (typeof res.revision === "number") {
          stateTracker.setRevision(res.revision);
        }

        let pngBase64 = res.pngBase64;
        const scale = params.scale ?? 4;
        if (scale > 1 && pngBase64) {
          const img = decodePngBase64Sync(pngBase64);
          const scaled = scaleNearestNeighbor(img.data, img.width, img.height, scale);
          pngBase64 = encodeRgbaToPngBase64(scaled.data, scaled.width, scaled.height).base64;
        }

        const metadata: any = {
          width: res.width,
          height: res.height,
          activeLayer: res.activeLayer,
          activeFrame: res.activeFrame,
          revision: res.revision,
          scale,
        };
        if (params.includePixels) {
          metadata.pixels = res.pixelGrid;
        }

        return {
          content: [
            {
              type: "image" as const,
              data: pngBase64,
              mimeType: "image/png",
            },
            {
              type: "text" as const,
              text: JSON.stringify(metadata, null, 2),
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

  // 5. get_pixel_grid_preview
  server.tool(
    "get_pixel_grid_preview",
    "Generates an enlarged visual inspection PNG with nearest-neighbor scaling, 1px pixel grid separators, X/Y coordinate rulers, and optional highlights.",
    {
      frameIndex: z.number().int().positive().optional().describe("Frame number (1-indexed)"),
      scale: z.number().int().min(4).max(48).optional().default(16).describe("Pixel zoom scale (default 16x)"),
      showGrid: z.boolean().optional().default(true).describe("Draw grid lines between pixel boundaries"),
      showCoordinates: z.boolean().optional().default(true).describe("Display coordinate numbers along top and left rulers"),
      checkerboard: z.boolean().optional().default(true).describe("Show checkerboard backdrop for transparent pixels"),
      highlightRegion: z.object({
        x: z.number().int().min(0),
        y: z.number().int().min(0),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      }).optional().describe("Highlight bounding box area with gold outline"),
      highlightPixels: z.array(z.object({
        x: z.number().int().min(0),
        y: z.number().int().min(0),
      })).optional().describe("List of specific pixel coordinates to highlight with cyan outline"),
    },
    async (params) => {
      try {
        const canvasRes = await dispatcher.send<any>("get_canvas", { frameIndex: params.frameIndex }, 10000);
        if (typeof canvasRes.revision === "number") {
          stateTracker.setRevision(canvasRes.revision);
        }

        const img = decodePngBase64Sync(canvasRes.pngBase64);
        const preview = generatePixelGridPreview(img.data, img.width, img.height, {
          scale: params.scale,
          showGrid: params.showGrid,
          showCoordinates: params.showCoordinates,
          checkerboard: params.checkerboard,
          highlightRegion: params.highlightRegion,
          highlightPixels: params.highlightPixels,
        });

        return {
          content: [
            {
              type: "image" as const,
              data: preview.base64,
              mimeType: "image/png",
            },
            {
              type: "text" as const,
              text: JSON.stringify({
                spriteWidth: img.width,
                spriteHeight: img.height,
                renderedWidth: preview.width,
                renderedHeight: preview.height,
                scale: params.scale ?? 16,
                revision: canvasRes.revision,
                grid: params.showGrid ?? true,
                coordinates: params.showCoordinates ?? true,
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
}
