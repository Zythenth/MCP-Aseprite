import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CommandDispatcher } from "../bridge/dispatcher.js";
import { BridgeState } from "../bridge/state.js";
import type { Toolset } from "../config.js";
export declare function createMcpServer(dispatcher?: CommandDispatcher, stateTracker?: BridgeState, options?: {
    readOnly?: boolean;
    toolsets?: Toolset[];
}): McpServer;
export declare function startMcpServer(server: McpServer, transport?: Transport): Promise<void>;
export declare function stopMcpServer(server: McpServer): Promise<void>;
//# sourceMappingURL=server.d.ts.map