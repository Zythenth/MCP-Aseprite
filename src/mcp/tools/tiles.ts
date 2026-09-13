import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CommandDispatcher } from "../../bridge/dispatcher.js";
import type { BridgeState } from "../../bridge/state.js";
import { MAX_PIXELS_BATCH, MAX_TILESET_PIXELS } from "../../config.js";
import { bridgeToolError, bridgeToolResult, confirmationError } from "./common.js";

const tilemapSelector = {
  layerName: z.string().min(1).max(128).optional(),
  layerIndex: z.number().int().min(0).optional(),
  frameNumber: z.number().int().positive().optional(),
};

export function registerTileTools(server: McpServer, dispatcher: CommandDispatcher, state: BridgeState): void {
  server.tool("list_tilesets", "Lists tilesets, tile dimensions, base index, and tile count.", {}, async () => {
    try { return bridgeToolResult(await dispatcher.send("list_tilesets", {}, 5000), state); }
    catch (error) { return bridgeToolError(error); }
  });

  server.tool("create_tileset", "Creates a tileset. tileCount includes reserved empty tile 0.", {
    name: z.string().min(1).max(128),
    tileWidth: z.number().int().min(1).max(1024), tileHeight: z.number().int().min(1).max(1024),
    tileCount: z.number().int().min(1).max(4096).optional().default(1),
    baseIndex: z.number().int().min(0).optional().default(1),
    returnPreview: z.boolean().optional().default(false),
  }, async (params) => {
    try {
      if (params.tileWidth * params.tileHeight * (params.tileCount ?? 1) > MAX_TILESET_PIXELS) {
        throw new Error(`Tileset exceeds the ${MAX_TILESET_PIXELS.toLocaleString()} pixel safety limit.`);
      }
      return bridgeToolResult(await dispatcher.send("create_tileset", params, 10000), state, params.returnPreview);
    }
    catch (error) { return bridgeToolError(error); }
  });

  server.tool("delete_tileset", "Deletes a tileset by zero-based tilesetIndex. Requires confirmation.", {
    tilesetIndex: z.number().int().min(0), confirm: z.boolean(), returnPreview: z.boolean().optional().default(false),
  }, async (params) => {
    if (!params.confirm) return confirmationError("delete_tileset");
    try { return bridgeToolResult(await dispatcher.send("delete_tileset", params, 10000), state, params.returnPreview); }
    catch (error) { return bridgeToolError(error); }
  });

  server.tool("get_tile", "Gets one tile's metadata and PNG preview.", {
    tilesetIndex: z.number().int().min(0), tileIndex: z.number().int().min(0),
  }, async (params) => {
    try { return bridgeToolResult(await dispatcher.send("get_tile", params, 10000), state, true); }
    catch (error) { return bridgeToolError(error); }
  });

  server.tool("set_tile_pixels", "Atomically paints pixels in one reusable tile image.", {
    tilesetIndex: z.number().int().min(0), tileIndex: z.number().int().min(1),
    pixels: z.array(z.object({
      x: z.number().int().min(0), y: z.number().int().min(0),
      color: z.string().regex(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i),
    })).min(1).max(MAX_PIXELS_BATCH),
    returnPreview: z.boolean().optional().default(false),
  }, async (params) => {
    try { return bridgeToolResult(await dispatcher.send("set_tile_pixels", params, 15000), state, params.returnPreview); }
    catch (error) { return bridgeToolError(error); }
  });

  server.tool("create_tilemap_layer", "Creates a tilemap layer associated with an existing tileset.", {
    name: z.string().min(1).max(128), tilesetIndex: z.number().int().min(0),
    parentGroup: z.string().min(1).max(128).optional(), frameNumber: z.number().int().positive().optional(),
    returnPreview: z.boolean().optional().default(false),
  }, async (params) => {
    try { return bridgeToolResult(await dispatcher.send("create_tilemap_layer", params, 15000), state, params.returnPreview); }
    catch (error) { return bridgeToolError(error); }
  });

  server.tool("get_tilemap", "Reads a tilemap cel as tile indexes and flip flags without expanding it to pixels.", {
    ...tilemapSelector,
  }, async (params) => {
    try { return bridgeToolResult(await dispatcher.send("get_tilemap", params, 10000), state); }
    catch (error) { return bridgeToolError(error); }
  });

  server.tool("set_tiles", "Atomically writes tile references and X/Y/diagonal flip flags into a tilemap cel.", {
    ...tilemapSelector,
    tiles: z.array(z.object({
      x: z.number().int().min(0), y: z.number().int().min(0), tileIndex: z.number().int().min(0),
      xFlip: z.boolean().optional().default(false), yFlip: z.boolean().optional().default(false),
      diagonalFlip: z.boolean().optional().default(false),
    })).min(1).max(MAX_PIXELS_BATCH),
    returnPreview: z.boolean().optional().default(false),
  }, async (params) => {
    try { return bridgeToolResult(await dispatcher.send("set_tiles", params, 15000), state, params.returnPreview); }
    catch (error) { return bridgeToolError(error); }
  });
}
