import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Toolset } from "../config.js";

export interface ToolRegistrationPolicy {
  readOnly: boolean;
  toolsets: ReadonlySet<Toolset>;
}

export const MUTATING_TOOLS = new Set([
  "set_pixels", "set_pixel", "erase_pixels", "undo", "redo",
  "draw_line", "draw_rectangle", "draw_ellipse", "flood_fill", "replace_color",
  "new_sprite", "save_sprite", "save_sprite_as", "export_png", "export_sprite_sheet", "resize_canvas",
  "create_layer", "rename_layer", "delete_layer", "set_layer_visibility", "set_layer_opacity", "move_layer",
  "create_group", "move_layer_to_group", "ungroup_layer", "set_layer_blend_mode", "merge_down_layer", "flatten_layers",
  "create_frame", "duplicate_frame", "delete_frame", "set_frame_duration", "create_tag",
  "set_palette_color",
  "create_cel", "delete_cel", "set_cel_position", "set_cel_opacity", "link_cel", "unlink_cel",
  "create_slice", "update_slice", "delete_slice",
  "set_selection", "clear_selection", "invert_selection",
  "create_tileset", "delete_tileset", "set_tile_pixels", "create_tilemap_layer", "set_tiles",
  "apply_ordered_dither",
]);

export function createPolicyToolRegistrar(server: McpServer, readOnly: boolean): McpServer {
  if (!readOnly) return server;
  return new Proxy(server, {
    get(target, property) {
      if (property === "tool") {
        const register = target.tool.bind(target) as (...args: any[]) => unknown;
        return (...args: any[]) => {
          const name = args[0];
          if (typeof name === "string" && MUTATING_TOOLS.has(name)) return undefined;
          return register(...args);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
