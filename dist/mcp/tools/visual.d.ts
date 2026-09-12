import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CommandDispatcher } from "../../bridge/dispatcher.js";
import { BridgeState } from "../../bridge/state.js";
export declare function applyLegacyRegionFallback(res: any, region: {
    x: number;
    y: number;
    width: number;
    height: number;
}): any;
export declare function registerVisualTools(server: McpServer, dispatcher: CommandDispatcher, stateTracker: BridgeState): void;
//# sourceMappingURL=visual.d.ts.map