import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CommandDispatcher } from "../../bridge/dispatcher.js";
import type { BridgeState } from "../../bridge/state.js";
import { bridgeToolError, bridgeToolResult, confirmationError } from "./common.js";

const boundsSchema = z.object({
  x: z.number().int(), y: z.number().int(),
  width: z.number().int().min(1).max(4096), height: z.number().int().min(1).max(4096),
});
const pointSchema = z.object({ x: z.number().int(), y: z.number().int() });
const colorSchema = z.string().regex(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i);

export function registerSliceTools(server: McpServer, dispatcher: CommandDispatcher, state: BridgeState): void {
  server.tool("list_slices", "Lists slices with canvas bounds, local nine-patch center, local pivot, color, and data.", {}, async () => {
    try { return bridgeToolResult(await dispatcher.send("list_slices", {}, 5000), state); }
    catch (error) { return bridgeToolError(error); }
  });

  server.tool("get_slice", "Gets one slice by its exact name.", { name: z.string().min(1).max(128) }, async (params) => {
    try { return bridgeToolResult(await dispatcher.send("get_slice", params, 5000), state); }
    catch (error) { return bridgeToolError(error); }
  });

  server.tool("create_slice", "Creates a slice with optional local pivot and local nine-patch center.", {
    name: z.string().min(1).max(128), bounds: boundsSchema,
    center: boundsSchema.optional(), pivot: pointSchema.optional(), color: colorSchema.optional(),
    data: z.string().max(4096).optional(), returnPreview: z.boolean().optional().default(false),
  }, async (params) => {
    try { return bridgeToolResult(await dispatcher.send("create_slice", params, 10000), state, params.returnPreview); }
    catch (error) { return bridgeToolError(error); }
  });

  server.tool("update_slice", "Updates or clears slice bounds, pivot, nine-patch center, color, data, or name.", {
    name: z.string().min(1).max(128), newName: z.string().min(1).max(128).optional(),
    bounds: boundsSchema.optional(), center: boundsSchema.nullable().optional(),
    pivot: pointSchema.nullable().optional(), color: colorSchema.optional(), data: z.string().max(4096).optional(),
    returnPreview: z.boolean().optional().default(false),
  }, async (params) => {
    try { return bridgeToolResult(await dispatcher.send("update_slice", params, 10000), state, params.returnPreview); }
    catch (error) { return bridgeToolError(error); }
  });

  server.tool("delete_slice", "Deletes a named slice. Requires confirmation.", {
    name: z.string().min(1).max(128), confirm: z.boolean(), returnPreview: z.boolean().optional().default(false),
  }, async (params) => {
    if (!params.confirm) return confirmationError("delete_slice");
    try { return bridgeToolResult(await dispatcher.send("delete_slice", params, 10000), state, params.returnPreview); }
    catch (error) { return bridgeToolError(error); }
  });
}
