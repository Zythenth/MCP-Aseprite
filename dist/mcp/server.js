// src/mcp/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CommandDispatcher } from "../bridge/dispatcher.js";
import { BridgeState } from "../bridge/state.js";
import { registerStatusTool } from "./tools/status.js";
import { registerVisualTools } from "./tools/visual.js";
import { registerEditingTools } from "./tools/editing.js";
import { registerFileTools } from "./tools/files.js";
import { registerShapeTools } from "./tools/shapes.js";
import { registerLayerTools } from "./tools/layers.js";
import { registerFrameTools } from "./tools/frames.js";
import { registerPaletteTools } from "./tools/palette.js";
import { registerMcpResources } from "./resources/index.js";
import { PIXEL_ART_WORKFLOW_INSTRUCTIONS } from "./instructions.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
export function createMcpServer(dispatcher, stateTracker) {
    const activeDispatcher = dispatcher || new CommandDispatcher();
    const activeStateTracker = stateTracker || new BridgeState();
    const server = new McpServer({
        name: config.serverName,
        version: config.serverVersion,
    }, {
        capabilities: {
            tools: {},
            resources: {},
        },
        instructions: PIXEL_ART_WORKFLOW_INSTRUCTIONS,
    });
    // Register Core and Specialized Tools
    registerStatusTool(server, activeDispatcher, activeStateTracker);
    registerVisualTools(server, activeDispatcher, activeStateTracker);
    registerEditingTools(server, activeDispatcher, activeStateTracker);
    registerFileTools(server, activeDispatcher, activeStateTracker);
    registerShapeTools(server, activeDispatcher, activeStateTracker);
    registerLayerTools(server, activeDispatcher, activeStateTracker);
    registerFrameTools(server, activeDispatcher, activeStateTracker);
    registerPaletteTools(server, activeDispatcher, activeStateTracker);
    // Register MCP Resources
    registerMcpResources(server, activeDispatcher, activeStateTracker);
    return server;
}
export async function startMcpServer(server, transport) {
    const activeTransport = transport ?? new StdioServerTransport();
    logger.info("Connecting McpServer to stdio transport...");
    await server.connect(activeTransport);
    logger.info(`${config.serverName} connected and listening on stdio.`);
}
export async function stopMcpServer(server) {
    try {
        await server.close();
        logger.info(`${config.serverName} stopped successfully.`);
    }
    catch (err) {
        logger.error(`Error stopping McpServer: ${err.message}`);
    }
}
//# sourceMappingURL=server.js.map