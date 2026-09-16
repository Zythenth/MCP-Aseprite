export const MUTATING_TOOLS = new Set([
    "set_pixels", "set_pixel", "erase_pixels", "undo", "redo",
    "draw_line", "draw_rectangle", "draw_ellipse", "flood_fill", "replace_color",
    "new_sprite", "save_sprite", "save_sprite_as", "save_project", "export_png", "export_sprite_sheet", "export_animation", "resize_canvas",
    "create_layer", "rename_layer", "delete_layer", "set_layer_visibility", "set_layer_opacity", "move_layer",
    "create_group", "move_layer_to_group", "ungroup_layer", "set_layer_blend_mode", "merge_down_layer", "flatten_layers",
    "create_frame", "duplicate_frame", "delete_frame", "set_frame_duration", "create_tag",
    "move_frame", "set_frame_durations", "update_tag", "delete_tag",
    "set_palette_color",
    "create_cel", "delete_cel", "set_cel_position", "set_cel_opacity", "link_cel", "unlink_cel",
    "copy_cel", "move_cel",
    "create_slice", "update_slice", "delete_slice",
    "set_selection", "clear_selection", "invert_selection",
    "create_tileset", "delete_tileset", "set_tile_pixels", "create_tilemap_layer", "set_tiles",
    "apply_ordered_dither",
    "batch_animation_edits",
    "reset_animation_workflow",
    "start_live_painting", "begin_live_painting_stage", "complete_live_painting_stage",
    "pause_live_painting", "continue_live_painting", "set_live_painting_speed",
    "cancel_live_painting", "undo_live_painting_stage", "finish_live_painting",
]);
const LIVE_PAINTING_CONTROL_TOOLS = new Set([
    "start_live_painting", "begin_live_painting_stage", "complete_live_painting_stage",
    "pause_live_painting", "continue_live_painting", "set_live_painting_speed",
    "cancel_live_painting", "undo_live_painting_stage", "finish_live_painting",
]);
export function createPolicyToolRegistrar(server, readOnly, livePainting) {
    if (!readOnly && !livePainting)
        return server;
    return new Proxy(server, {
        get(target, property) {
            if (property === "tool") {
                const register = target.tool.bind(target);
                return (...args) => {
                    const name = args[0];
                    if (readOnly && typeof name === "string" && MUTATING_TOOLS.has(name))
                        return undefined;
                    if (typeof name !== "string" || !livePainting || LIVE_PAINTING_CONTROL_TOOLS.has(name) || !MUTATING_TOOLS.has(name)) {
                        return register(...args);
                    }
                    const handlerIndex = args.length - 1;
                    const handler = args[handlerIndex];
                    if (typeof handler !== "function")
                        return register(...args);
                    args[handlerIndex] = async (...handlerArgs) => {
                        try {
                            livePainting.beforeSpriteMutation(name);
                        }
                        catch (error) {
                            return {
                                content: [{ type: "text", text: JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }, null, 2) }],
                                isError: true,
                            };
                        }
                        const result = await handler(...handlerArgs);
                        if (!result?.isError)
                            livePainting.recordSpriteMutation(name);
                        return result;
                    };
                    return register(...args);
                };
            }
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
}
//# sourceMappingURL=toolPolicy.js.map