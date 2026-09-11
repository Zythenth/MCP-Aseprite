// src/mcp/tools/layers.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CommandDispatcher } from "../../bridge/dispatcher.js";
import { BridgeState } from "../../bridge/state.js";

export function registerLayerTools(
  server: McpServer,
  dispatcher: CommandDispatcher,
  stateTracker: BridgeState
): void {
  // list_layers
  server.tool(
    "list_layers",
    "Lists all layers in the active sprite with visibility, opacity, blend mode, and hierarchy position.",
    {},
    async () => {
      try {
        const res = await dispatcher.send<any>("list_layers", {}, 5000);
        return { content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
      }
    }
  );

  // create_layer
  server.tool(
    "create_layer",
    "Creates a new image layer in the active sprite.",
    {
      name: z.string().describe("New layer name"),
      parentGroup: z.string().optional().describe("Optional parent group folder name"),
    },
    async (params) => {
      try {
        const res = await dispatcher.send<any>("create_layer", params, 10000);
        if (typeof res.revision === "number") stateTracker.setRevision(res.revision);
        return { content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
      }
    }
  );

  // rename_layer
  server.tool(
    "rename_layer",
    "Renames an existing layer.",
    {
      oldName: z.string().describe("Current layer name"),
      newName: z.string().describe("New layer name"),
    },
    async (params) => {
      try {
        const res = await dispatcher.send<any>("rename_layer", params, 5000);
        if (typeof res.revision === "number") stateTracker.setRevision(res.revision);
        return { content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
      }
    }
  );

  // delete_layer
  server.tool(
    "delete_layer",
    "Deletes a layer from the active sprite. Requires confirm: true for safety.",
    {
      name: z.string().describe("Layer name to delete"),
      confirm: z.boolean().describe("Explicit confirmation to delete (must be true)"),
    },
    async (params) => {
      if (!params.confirm) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: "Destructive operation aborted: confirm parameter must be true." }, null, 2) }],
          isError: true,
        };
      }
      try {
        const res = await dispatcher.send<any>("delete_layer", params, 10000);
        if (typeof res.revision === "number") stateTracker.setRevision(res.revision);
        return { content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
      }
    }
  );

  // select_layer
  server.tool(
    "select_layer",
    "Sets the active working layer in Aseprite.",
    {
      name: z.string().describe("Layer name to select as active"),
    },
    async (params) => {
      try {
        const res = await dispatcher.send<any>("select_layer", params, 5000);
        return { content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
      }
    }
  );

  // set_layer_visibility
  server.tool(
    "set_layer_visibility",
    "Shows or hides a layer.",
    {
      name: z.string().describe("Layer name"),
      visible: z.boolean().describe("true to show, false to hide"),
    },
    async (params) => {
      try {
        const res = await dispatcher.send<any>("set_layer_visibility", params, 5000);
        if (typeof res.revision === "number") stateTracker.setRevision(res.revision);
        return { content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
      }
    }
  );

  // set_layer_opacity
  server.tool(
    "set_layer_opacity",
    "Adjusts opacity for a layer (0 to 255).",
    {
      name: z.string().describe("Layer name"),
      opacity: z.number().int().min(0).max(255).describe("Opacity value (0 = transparent, 255 = fully opaque)"),
    },
    async (params) => {
      try {
        const res = await dispatcher.send<any>("set_layer_opacity", params, 5000);
        if (typeof res.revision === "number") stateTracker.setRevision(res.revision);
        return { content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
      }
    }
  );

  // move_layer
  server.tool(
    "move_layer",
    "Reorders a layer position in the layer stack.",
    {
      name: z.string().describe("Layer name to move"),
      targetIndex: z.number().int().min(0).describe("Destination stack index"),
    },
    async (params) => {
      try {
        const res = await dispatcher.send<any>("move_layer", params, 5000);
        if (typeof res.revision === "number") stateTracker.setRevision(res.revision);
        return { content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
      }
    }
  );

  // create_group
  server.tool(
    "create_group",
    "Creates a folder layer group for organizing layers.",
    {
      name: z.string().describe("Group folder name"),
    },
    async (params) => {
      try {
        const res = await dispatcher.send<any>("create_group", params, 5000);
        if (typeof res.revision === "number") stateTracker.setRevision(res.revision);
        return { content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
      }
    }
  );
}
