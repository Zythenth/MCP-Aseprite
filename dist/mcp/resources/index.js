export function registerMcpResources(server, dispatcher, _stateTracker) {
    // 1. aseprite://active-sprite/info
    server.resource("active-sprite-info", "aseprite://active-sprite/info", { mimeType: "application/json" }, async () => {
        try {
            const info = await dispatcher.send("get_sprite_info", {}, 5000);
            return {
                contents: [
                    {
                        uri: "aseprite://active-sprite/info",
                        mimeType: "application/json",
                        text: JSON.stringify(info, null, 2),
                    },
                ],
            };
        }
        catch (err) {
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
    });
    // 2. aseprite://active-sprite/palette
    server.resource("active-sprite-palette", "aseprite://active-sprite/palette", { mimeType: "application/json" }, async () => {
        try {
            const pal = await dispatcher.send("get_palette", {}, 5000);
            return {
                contents: [
                    {
                        uri: "aseprite://active-sprite/palette",
                        mimeType: "application/json",
                        text: JSON.stringify(pal, null, 2),
                    },
                ],
            };
        }
        catch (err) {
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
    });
    // 3. aseprite://active-sprite/preview
    server.resource("active-sprite-preview", "aseprite://active-sprite/preview", { mimeType: "image/png" }, async () => {
        try {
            const canvas = await dispatcher.send("get_canvas", {}, 10000);
            return {
                contents: [
                    {
                        uri: "aseprite://active-sprite/preview",
                        mimeType: "image/png",
                        blob: canvas.pngBase64,
                    },
                ],
            };
        }
        catch (err) {
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
    });
}
//# sourceMappingURL=index.js.map