import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Toolset } from "../config.js";
import type { LivePaintingState } from "./livePaintingState.js";
export interface ToolRegistrationPolicy {
    readOnly: boolean;
    toolsets: ReadonlySet<Toolset>;
}
export declare const MUTATING_TOOLS: Set<string>;
export declare function createPolicyToolRegistrar(server: McpServer, readOnly: boolean, livePainting?: LivePaintingState): McpServer;
//# sourceMappingURL=toolPolicy.d.ts.map