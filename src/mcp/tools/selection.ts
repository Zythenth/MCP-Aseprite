import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CommandDispatcher } from "../../bridge/dispatcher.js";
import type { BridgeState } from "../../bridge/state.js";
import { bridgeToolError, bridgeToolResult } from "./common.js";

export function registerSelectionTools(server: McpServer, dispatcher: CommandDispatcher, state: BridgeState): void {
  server.tool("get_selection", "Gets the persistent sprite selection bounds and origin.", {}, async () => {
    try { return bridgeToolResult(await dispatcher.send("get_selection", {}, 5000), state); }
    catch (error) { return bridgeToolError(error); }
  });

  server.tool("set_selection", "Replaces, adds, subtracts, or intersects a persistent rectangular selection.", {
    operation: z.enum(["replace", "add", "subtract", "intersect"]).optional().default("replace"),
    x: z.number().int(), y: z.number().int(),
    width: z.number().int().min(1).max(4096), height: z.number().int().min(1).max(4096),
    returnPreview: z.boolean().optional().default(false),
  }, async (params) => {
    try { return bridgeToolResult(await dispatcher.send("set_selection", params, 5000), state, params.returnPreview); }
    catch (error) { return bridgeToolError(error); }
  });

  server.tool("clear_selection", "Clears the persistent sprite selection.", {
    returnPreview: z.boolean().optional().default(false),
  }, async (params) => {
    try { return bridgeToolResult(await dispatcher.send("clear_selection", params, 5000), state, params.returnPreview); }
    catch (error) { return bridgeToolError(error); }
  });

  server.tool("invert_selection", "Inverts the persistent selection inside the sprite canvas.", {
    returnPreview: z.boolean().optional().default(false),
  }, async (params) => {
    try { return bridgeToolResult(await dispatcher.send("invert_selection", params, 5000), state, params.returnPreview); }
    catch (error) { return bridgeToolError(error); }
  });
}
