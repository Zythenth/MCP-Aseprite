/**
 * src/mcp/tools/workflow.ts
 * MCP tools for the animation workflow lifecycle.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CommandDispatcher } from "../../bridge/dispatcher.js";
import type { BridgeState } from "../../bridge/state.js";
import { AnimationWorkflowState } from "../animationWorkflowState.js";
export declare const transparencySummarySchema: z.ZodObject<{
    hasTransparency: z.ZodBoolean;
    transparentPixels: z.ZodNumber;
    translucentPixels: z.ZodNumber;
}, "strict", z.ZodTypeAny, {
    transparentPixels: number;
    hasTransparency: boolean;
    translucentPixels: number;
}, {
    transparentPixels: number;
    hasTransparency: boolean;
    translucentPixels: number;
}>;
export declare const findingInputSchema: z.ZodObject<{
    id: z.ZodString;
    category: z.ZodString;
    severity: z.ZodEnum<["critical", "high", "medium", "low"]>;
    frameOrRange: z.ZodUnion<[z.ZodNumber, z.ZodString, z.ZodObject<{
        from: z.ZodNumber;
        to: z.ZodNumber;
    }, "strict", z.ZodTypeAny, {
        from: number;
        to: number;
    }, {
        from: number;
        to: number;
    }>]>;
    bounds: z.ZodOptional<z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        width: z.ZodNumber;
        height: z.ZodNumber;
    }, "strict", z.ZodTypeAny, {
        width: number;
        height: number;
        x: number;
        y: number;
    }, {
        width: number;
        height: number;
        x: number;
        y: number;
    }>>;
    description: z.ZodString;
    evidence: z.ZodString;
    suggestion: z.ZodString;
}, "strict", z.ZodTypeAny, {
    id: string;
    description: string;
    severity: "low" | "medium" | "high" | "critical";
    category: string;
    frameOrRange: string | number | {
        from: number;
        to: number;
    };
    evidence: string;
    suggestion: string;
    bounds?: {
        width: number;
        height: number;
        x: number;
        y: number;
    } | undefined;
}, {
    id: string;
    description: string;
    severity: "low" | "medium" | "high" | "critical";
    category: string;
    frameOrRange: string | number | {
        from: number;
        to: number;
    };
    evidence: string;
    suggestion: string;
    bounds?: {
        width: number;
        height: number;
        x: number;
        y: number;
    } | undefined;
}>;
export declare function registerWorkflowTools(server: McpServer, _dispatcher: CommandDispatcher, stateTracker: BridgeState, workflowState: AnimationWorkflowState): void;
//# sourceMappingURL=workflow.d.ts.map