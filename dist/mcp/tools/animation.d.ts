import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CommandDispatcher } from "../../bridge/dispatcher.js";
import { BridgeState } from "../../bridge/state.js";
import type { AnimationWorkflowState } from "../animationWorkflowState.js";
export declare function assertAnimationPixelBudget(width: number, height: number, frameCount: number, scale: number): void;
export declare function registerAnimationInspectionTools(server: McpServer, dispatcher: CommandDispatcher, state: BridgeState, workflowState?: AnimationWorkflowState): void;
//# sourceMappingURL=animation.d.ts.map