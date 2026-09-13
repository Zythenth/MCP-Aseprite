// src/mcp/tools/palette.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CommandDispatcher } from "../../bridge/dispatcher.js";
import { BridgeState } from "../../bridge/state.js";
import { bridgeToolError, bridgeToolResult } from "./common.js";

export function registerPaletteTools(
  server: McpServer,
  dispatcher: CommandDispatcher,
  stateTracker: BridgeState
): void {
  // get_palette
  server.tool(
    "get_palette",
    "Retrieves all colors in the active sprite's color palette with index, RGBA, and HEX values.",
    {},
    async () => {
      try {
        const res = await dispatcher.send<any>("get_palette", {}, 5000);
        return { content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
      }
    }
  );

  // set_palette_color
  server.tool(
    "set_palette_color",
    "Updates the color at a specific palette index.",
    {
      index: z.number().int().min(0).max(255).describe("Palette color index (0-255)"),
      color: z.string().describe("New hex color e.g. #FF0000FF"),
      returnPreview: z.boolean().optional().default(false),
    },
    async (params) => {
      try {
        const res = await dispatcher.send<any>("set_palette_color", params, 5000);
        return bridgeToolResult(res, stateTracker, params.returnPreview);
      } catch (error) { return bridgeToolError(error); }
    }
  );

  // find_palette_color
  server.tool(
    "find_palette_color",
    "Finds exact or nearest color match in the active palette using Euclidean distance.",
    {
      color: z.string().describe("Hex color string e.g. #FF1E14FF"),
      findNearest: z.boolean().optional().default(true).describe("Whether to find nearest color if exact match not found"),
    },
    async (params) => {
      try {
        const res = await dispatcher.send<any>("find_palette_color", params, 5000);
        return { content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
      }
    }
  );
}
