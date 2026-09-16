import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CommandDispatcher } from "../../bridge/dispatcher.js";
import { BridgeState } from "../../bridge/state.js";
import type { AnimationWorkflowState } from "../animationWorkflowState.js";
import type { ApprovalState } from "../approvalState.js";
export declare function registerFileTools(server: McpServer, dispatcher: CommandDispatcher, stateTracker: BridgeState, workflowState?: AnimationWorkflowState, approvalState?: ApprovalState): void;
//# sourceMappingURL=files.d.ts.map