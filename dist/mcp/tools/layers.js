import { z } from "zod";
import { bridgeToolError, bridgeToolResult, confirmationError } from "./common.js";
export function registerLayerTools(server, dispatcher, stateTracker) {
    // list_layers
    server.tool("list_layers", "Lists all layers in the active sprite with visibility, opacity, blend mode, and hierarchy position.", {}, async () => {
        try {
            const res = await dispatcher.send("list_layers", {}, 5000);
            return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
        }
        catch (err) {
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
        }
    });
    // create_layer
    server.tool("create_layer", "Creates a new image layer in the active sprite.", {
        name: z.string().describe("New layer name"),
        parentGroup: z.string().optional().describe("Optional parent group folder name"),
        returnPreview: z.boolean().optional().default(false),
    }, async (params) => {
        try {
            const res = await dispatcher.send("create_layer", params, 10000);
            return bridgeToolResult(res, stateTracker, params.returnPreview);
        }
        catch (err) {
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
        }
    });
    // rename_layer
    server.tool("rename_layer", "Renames an existing layer.", {
        oldName: z.string().describe("Current layer name"),
        newName: z.string().describe("New layer name"),
        returnPreview: z.boolean().optional().default(false),
    }, async (params) => {
        try {
            const res = await dispatcher.send("rename_layer", params, 5000);
            return bridgeToolResult(res, stateTracker, params.returnPreview);
        }
        catch (err) {
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
        }
    });
    // delete_layer
    server.tool("delete_layer", "Deletes a layer from the active sprite. Requires confirm: true for safety.", {
        name: z.string().describe("Layer name to delete"),
        confirm: z.boolean().describe("Explicit confirmation to delete (must be true)"),
        returnPreview: z.boolean().optional().default(false),
    }, async (params) => {
        if (!params.confirm) {
            return {
                content: [{ type: "text", text: JSON.stringify({ success: false, error: "Destructive operation aborted: confirm parameter must be true." }, null, 2) }],
                isError: true,
            };
        }
        try {
            const res = await dispatcher.send("delete_layer", params, 10000);
            return bridgeToolResult(res, stateTracker, params.returnPreview);
        }
        catch (err) {
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
        }
    });
    // select_layer
    server.tool("select_layer", "Sets the active working layer in Aseprite.", {
        name: z.string().describe("Layer name to select as active"),
    }, async (params) => {
        try {
            const res = await dispatcher.send("select_layer", params, 5000);
            return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
        }
        catch (err) {
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
        }
    });
    // set_layer_visibility
    server.tool("set_layer_visibility", "Shows or hides a layer.", {
        name: z.string().describe("Layer name"),
        visible: z.boolean().describe("true to show, false to hide"),
        returnPreview: z.boolean().optional().default(false),
    }, async (params) => {
        try {
            const res = await dispatcher.send("set_layer_visibility", params, 5000);
            return bridgeToolResult(res, stateTracker, params.returnPreview);
        }
        catch (err) {
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
        }
    });
    // set_layer_opacity
    server.tool("set_layer_opacity", "Adjusts opacity for a layer (0 to 255).", {
        name: z.string().describe("Layer name"),
        opacity: z.number().int().min(0).max(255).describe("Opacity value (0 = transparent, 255 = fully opaque)"),
        returnPreview: z.boolean().optional().default(false),
    }, async (params) => {
        try {
            const res = await dispatcher.send("set_layer_opacity", params, 5000);
            return bridgeToolResult(res, stateTracker, params.returnPreview);
        }
        catch (err) {
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
        }
    });
    // move_layer
    server.tool("move_layer", "Reorders a layer position in the layer stack.", {
        name: z.string().describe("Layer name to move"),
        targetIndex: z.number().int().min(0).describe("Destination stack index"),
        returnPreview: z.boolean().optional().default(false),
    }, async (params) => {
        try {
            const res = await dispatcher.send("move_layer", params, 5000);
            return bridgeToolResult(res, stateTracker, params.returnPreview);
        }
        catch (err) {
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
        }
    });
    // create_group
    server.tool("create_group", "Creates a folder layer group for organizing layers.", {
        name: z.string().describe("Group folder name"),
        parentGroup: z.string().optional().describe("Optional parent group folder name"),
        returnPreview: z.boolean().optional().default(false),
    }, async (params) => {
        try {
            const res = await dispatcher.send("create_group", params, 5000);
            return bridgeToolResult(res, stateTracker, params.returnPreview);
        }
        catch (err) {
            return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }, null, 2) }], isError: true };
        }
    });
    server.tool("list_layer_tree", "Lists the complete recursive layer/group hierarchy with stable UUIDs and local stack indexes.", {}, async () => {
        try {
            return bridgeToolResult(await dispatcher.send("list_layer_tree", {}, 5000), stateTracker);
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
    server.tool("move_layer_to_group", "Moves a layer or group to a target group, or to the sprite root when parentGroup is omitted.", {
        name: z.string().min(1).max(128),
        parentGroup: z.string().min(1).max(128).optional(),
        targetIndex: z.number().int().positive().optional().describe("1-based index within the new parent"),
        returnPreview: z.boolean().optional().default(false),
    }, async (params) => {
        try {
            return bridgeToolResult(await dispatcher.send("move_layer_to_group", params, 10000), stateTracker, params.returnPreview);
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
    server.tool("ungroup_layer", "Dissolves a group while preserving and reparenting all of its children.", {
        name: z.string().min(1).max(128),
        returnPreview: z.boolean().optional().default(false),
    }, async (params) => {
        try {
            return bridgeToolResult(await dispatcher.send("ungroup_layer", params, 10000), stateTracker, params.returnPreview);
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
    server.tool("set_layer_blend_mode", "Sets the blend mode of a non-group image or tilemap layer.", {
        name: z.string().min(1).max(128).optional(),
        layerIndex: z.number().int().min(0).optional(),
        blendMode: z.enum([
            "normal", "src", "multiply", "screen", "overlay", "darken", "lighten",
            "color_dodge", "color_burn", "hard_light", "soft_light", "difference", "exclusion",
            "hsl_hue", "hsl_saturation", "hsl_color", "hsl_luminosity", "addition", "subtract", "divide",
        ]),
        returnPreview: z.boolean().optional().default(false),
    }, async (params) => {
        try {
            return bridgeToolResult(await dispatcher.send("set_layer_blend_mode", params, 10000), stateTracker, params.returnPreview);
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
    server.tool("merge_down_layer", "Merges an image layer with the layer directly below it. Requires confirmation.", {
        name: z.string().min(1).max(128).optional(),
        layerIndex: z.number().int().min(0).optional(),
        confirm: z.boolean(),
        returnPreview: z.boolean().optional().default(false),
    }, async (params) => {
        if (!params.confirm)
            return confirmationError("merge_down_layer");
        try {
            return bridgeToolResult(await dispatcher.send("merge_down_layer", params, 15000), stateTracker, params.returnPreview);
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
    server.tool("flatten_layers", "Flattens every layer into one composited image layer. Requires confirmation.", {
        confirm: z.boolean(),
        returnPreview: z.boolean().optional().default(false),
    }, async (params) => {
        if (!params.confirm)
            return confirmationError("flatten_layers");
        try {
            return bridgeToolResult(await dispatcher.send("flatten_layers", params, 15000), stateTracker, params.returnPreview);
        }
        catch (error) {
            return bridgeToolError(error);
        }
    });
}
//# sourceMappingURL=layers.js.map