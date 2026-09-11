// src/mcp/resources/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CommandDispatcher } from "../../bridge/dispatcher.js";
import { BridgeState } from "../../bridge/state.js";

export function registerMcpResources(
  server: McpServer,
  dispatcher: CommandDispatcher,
  _stateTracker?: BridgeState
): void {
  // 1. aseprite://active-sprite/info
  server.resource(
    "active-sprite-info",
    "aseprite://active-sprite/info",
    { mimeType: "application/json" },
    async () => {
      try {
        const info = await dispatcher.send<any>("get_sprite_info", {}, 5000);
        return {
          contents: [
            {
              uri: "aseprite://active-sprite/info",
              mimeType: "application/json",
              text: JSON.stringify(info, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          contents: [
            {
              uri: "aseprite://active-sprite/info",
              mimeType: "application/json",
              text: JSON.stringify({ error: err.message }, null, 2),
            },
          ],
        };
      }
    }
  );

  // 2. aseprite://active-sprite/palette
  server.resource(
    "active-sprite-palette",
    "aseprite://active-sprite/palette",
    { mimeType: "application/json" },
    async () => {
      try {
        const pal = await dispatcher.send<any>("get_palette", {}, 5000);
        return {
          contents: [
            {
              uri: "aseprite://active-sprite/palette",
              mimeType: "application/json",
              text: JSON.stringify(pal, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          contents: [
            {
              uri: "aseprite://active-sprite/palette",
              mimeType: "application/json",
              text: JSON.stringify({ error: err.message }, null, 2),
            },
          ],
        };
      }
    }
  );

  // 3. aseprite://active-sprite/preview
  server.resource(
    "active-sprite-preview",
    "aseprite://active-sprite/preview",
    { mimeType: "image/png" },
    async () => {
      try {
        const canvas = await dispatcher.send<any>("get_canvas", {}, 10000);
        return {
          contents: [
            {
              uri: "aseprite://active-sprite/preview",
              mimeType: "image/png",
              blob: canvas.pngBase64,
            },
          ],
        };
      } catch (err: any) {
        return {
          contents: [
            {
              uri: "aseprite://active-sprite/preview",
              mimeType: "text/plain",
              text: `Error fetching preview: ${err.message}`,
            },
          ],
        };
      }
    }
  );
}
