import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CommandDispatcher } from "../../bridge/dispatcher.js";
import type { BridgeState } from "../../bridge/state.js";
import { bridgeToolError, bridgeToolResult, confirmationError } from "./common.js";

const layerSelector = {
  layerName: z.string().min(1).max(128).optional().describe("Target layer name; mutually exclusive with layerIndex"),
  layerIndex: z.number().int().min(0).optional().describe("Target flattened layer index; mutually exclusive with layerName"),
};

const frameSelector = {
  frameNumber: z.number().int().positive().optional().describe("Target frame (1-indexed; defaults to active frame)"),
};

export function registerCelTools(server: McpServer, dispatcher: CommandDispatcher, state: BridgeState): void {
  server.tool("get_cel", "Gets cel metadata, including canvas bounds, position, opacity, and linked frames.", {
    ...layerSelector,
    ...frameSelector,
  }, async (params) => {
    try { return bridgeToolResult(await dispatcher.send("get_cel", params, 5000), state); }
    catch (error) { return bridgeToolError(error); }
  });

  server.tool("create_cel", "Creates an explicit image cel without changing the active layer or frame.", {
    ...layerSelector,
    ...frameSelector,
    x: z.number().int().optional().default(0),
    y: z.number().int().optional().default(0),
    width: z.number().int().min(1).max(4096).optional(),
    height: z.number().int().min(1).max(4096).optional(),
    color: z.string().regex(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i).optional().default("#00000000"),
    returnPreview: z.boolean().optional().default(false),
  }, async (params) => {
    try { return bridgeToolResult(await dispatcher.send("create_cel", params, 10000), state, params.returnPreview); }
    catch (error) { return bridgeToolError(error); }
  });

  server.tool("delete_cel", "Deletes a cel while preserving its layer and frame. Requires confirmation.", {
    ...layerSelector,
    ...frameSelector,
    confirm: z.boolean(),
    returnPreview: z.boolean().optional().default(false),
  }, async (params) => {
    if (!params.confirm) return confirmationError("delete_cel");
    try { return bridgeToolResult(await dispatcher.send("delete_cel", params, 10000), state, params.returnPreview); }
    catch (error) { return bridgeToolError(error); }
  });

  server.tool("set_cel_position", "Moves a cel using either absolute x/y coordinates or relative dx/dy offsets.", {
    ...layerSelector,
    ...frameSelector,
    x: z.number().int().optional(),
    y: z.number().int().optional(),
    dx: z.number().int().optional(),
    dy: z.number().int().optional(),
    returnPreview: z.boolean().optional().default(false),
  }, async (params) => {
    try { return bridgeToolResult(await dispatcher.send("set_cel_position", params, 10000), state, params.returnPreview); }
    catch (error) { return bridgeToolError(error); }
  });

  server.tool("set_cel_opacity", "Sets a cel's opacity from 0 through 255.", {
    ...layerSelector,
    ...frameSelector,
    opacity: z.number().int().min(0).max(255),
    returnPreview: z.boolean().optional().default(false),
  }, async (params) => {
    try { return bridgeToolResult(await dispatcher.send("set_cel_opacity", params, 10000), state, params.returnPreview); }
    catch (error) { return bridgeToolError(error); }
  });

  server.tool("link_cel", "Creates a target cel in the same image layer that shares image data with a source cel.", {
    sourceLayerName: z.string().min(1).max(128).optional(),
    sourceLayerIndex: z.number().int().min(0).optional(),
    sourceFrame: z.number().int().positive(),
    targetLayerName: z.string().min(1).max(128).optional(),
    targetLayerIndex: z.number().int().min(0).optional(),
    targetFrame: z.number().int().positive(),
    replaceExisting: z.boolean().optional().default(false),
    returnPreview: z.boolean().optional().default(false),
  }, async (params) => {
    try { return bridgeToolResult(await dispatcher.send("link_cel", params, 10000), state, params.returnPreview); }
    catch (error) { return bridgeToolError(error); }
  });

  server.tool("unlink_cel", "Breaks a cel link by cloning its image into an independent image.", {
    ...layerSelector,
    ...frameSelector,
    returnPreview: z.boolean().optional().default(false),
  }, async (params) => {
    try { return bridgeToolResult(await dispatcher.send("unlink_cel", params, 10000), state, params.returnPreview); }
    catch (error) { return bridgeToolError(error); }
  });
}
