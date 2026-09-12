import { config } from "../../config.js";
import { logger } from "../../logger.js";
export function registerStatusTool(server, dispatcher, stateTracker) {
    server.tool("aseprite_status", "Returns connection status with Aseprite, open document details, dimensions, color mode, layers, frames, active layer/frame, and revision.", {}, async () => {
        // Graceful fallback when bridge is disconnected
        if (!dispatcher.isConnected() && !stateTracker.isConnected()) {
            logger.debug("[Tool:aseprite_status] Bridge disconnected - returning fallback status");
            const fallback = {
                connected: false,
                message: "Aseprite is not connected. Please ensure Aseprite is open and lua/aseprite-bridge.lua is running, or start the Mock Bridge for testing.",
                port: config.port,
                hasActiveSprite: false,
                revision: 0,
            };
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(fallback, null, 2),
                    },
                ],
                isError: false,
            };
        }
        try {
            logger.debug("[Tool:aseprite_status] Querying status from bridge dispatcher...");
            const result = await dispatcher.send("aseprite_status", {}, 5000);
            if (typeof result.revision === "number") {
                stateTracker.setRevision(result.revision);
            }
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        }
        catch (err) {
            logger.error(`[Tool:aseprite_status] Query failed: ${err.message}`);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            connected: false,
                            error: err.message ?? "Failed to query Aseprite bridge status",
                            code: "STATUS_QUERY_FAILED",
                        }, null, 2),
                    },
                ],
                isError: true,
            };
        }
    });
}
//# sourceMappingURL=status.js.map