import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CommandDispatcher } from "../../bridge/dispatcher.js";
import type { BridgeState } from "../../bridge/state.js";
export declare const batchOperationSchema: z.ZodDiscriminatedUnion<"op", [z.ZodObject<{
    frameNumber: z.ZodOptional<z.ZodNumber>;
    layerName: z.ZodOptional<z.ZodString>;
    layerIndex: z.ZodOptional<z.ZodNumber>;
    op: z.ZodLiteral<"set_pixels">;
    pixels: z.ZodArray<z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        color: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        x: number;
        y: number;
        color: string;
    }, {
        x: number;
        y: number;
        color: string;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    pixels: {
        x: number;
        y: number;
        color: string;
    }[];
    op: "set_pixels";
    layerName?: string | undefined;
    layerIndex?: number | undefined;
    frameNumber?: number | undefined;
}, {
    pixels: {
        x: number;
        y: number;
        color: string;
    }[];
    op: "set_pixels";
    layerName?: string | undefined;
    layerIndex?: number | undefined;
    frameNumber?: number | undefined;
}>, z.ZodObject<{
    frameNumber: z.ZodOptional<z.ZodNumber>;
    layerName: z.ZodOptional<z.ZodString>;
    layerIndex: z.ZodOptional<z.ZodNumber>;
    op: z.ZodLiteral<"erase_pixels">;
    points: z.ZodArray<z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        x: number;
        y: number;
    }, {
        x: number;
        y: number;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    points: {
        x: number;
        y: number;
    }[];
    op: "erase_pixels";
    layerName?: string | undefined;
    layerIndex?: number | undefined;
    frameNumber?: number | undefined;
}, {
    points: {
        x: number;
        y: number;
    }[];
    op: "erase_pixels";
    layerName?: string | undefined;
    layerIndex?: number | undefined;
    frameNumber?: number | undefined;
}>, z.ZodObject<{
    frameNumber: z.ZodOptional<z.ZodNumber>;
    layerName: z.ZodOptional<z.ZodString>;
    layerIndex: z.ZodOptional<z.ZodNumber>;
    op: z.ZodLiteral<"set_cel_position">;
    x: z.ZodNumber;
    y: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    x: number;
    y: number;
    op: "set_cel_position";
    layerName?: string | undefined;
    layerIndex?: number | undefined;
    frameNumber?: number | undefined;
}, {
    x: number;
    y: number;
    op: "set_cel_position";
    layerName?: string | undefined;
    layerIndex?: number | undefined;
    frameNumber?: number | undefined;
}>, z.ZodObject<{
    frameNumber: z.ZodOptional<z.ZodNumber>;
    layerName: z.ZodOptional<z.ZodString>;
    layerIndex: z.ZodOptional<z.ZodNumber>;
    op: z.ZodLiteral<"set_cel_opacity">;
    opacity: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    opacity: number;
    op: "set_cel_opacity";
    layerName?: string | undefined;
    layerIndex?: number | undefined;
    frameNumber?: number | undefined;
}, {
    opacity: number;
    op: "set_cel_opacity";
    layerName?: string | undefined;
    layerIndex?: number | undefined;
    frameNumber?: number | undefined;
}>, z.ZodObject<{
    op: z.ZodLiteral<"set_frame_duration">;
    frameNumber: z.ZodNumber;
    durationMs: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    frameNumber: number;
    durationMs: number;
    op: "set_frame_duration";
}, {
    frameNumber: number;
    durationMs: number;
    op: "set_frame_duration";
}>]>;
export type BatchOperation = z.infer<typeof batchOperationSchema>;
export declare const batchOperationsArraySchema: z.ZodArray<z.ZodDiscriminatedUnion<"op", [z.ZodObject<{
    frameNumber: z.ZodOptional<z.ZodNumber>;
    layerName: z.ZodOptional<z.ZodString>;
    layerIndex: z.ZodOptional<z.ZodNumber>;
    op: z.ZodLiteral<"set_pixels">;
    pixels: z.ZodArray<z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        color: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        x: number;
        y: number;
        color: string;
    }, {
        x: number;
        y: number;
        color: string;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    pixels: {
        x: number;
        y: number;
        color: string;
    }[];
    op: "set_pixels";
    layerName?: string | undefined;
    layerIndex?: number | undefined;
    frameNumber?: number | undefined;
}, {
    pixels: {
        x: number;
        y: number;
        color: string;
    }[];
    op: "set_pixels";
    layerName?: string | undefined;
    layerIndex?: number | undefined;
    frameNumber?: number | undefined;
}>, z.ZodObject<{
    frameNumber: z.ZodOptional<z.ZodNumber>;
    layerName: z.ZodOptional<z.ZodString>;
    layerIndex: z.ZodOptional<z.ZodNumber>;
    op: z.ZodLiteral<"erase_pixels">;
    points: z.ZodArray<z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        x: number;
        y: number;
    }, {
        x: number;
        y: number;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    points: {
        x: number;
        y: number;
    }[];
    op: "erase_pixels";
    layerName?: string | undefined;
    layerIndex?: number | undefined;
    frameNumber?: number | undefined;
}, {
    points: {
        x: number;
        y: number;
    }[];
    op: "erase_pixels";
    layerName?: string | undefined;
    layerIndex?: number | undefined;
    frameNumber?: number | undefined;
}>, z.ZodObject<{
    frameNumber: z.ZodOptional<z.ZodNumber>;
    layerName: z.ZodOptional<z.ZodString>;
    layerIndex: z.ZodOptional<z.ZodNumber>;
    op: z.ZodLiteral<"set_cel_position">;
    x: z.ZodNumber;
    y: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    x: number;
    y: number;
    op: "set_cel_position";
    layerName?: string | undefined;
    layerIndex?: number | undefined;
    frameNumber?: number | undefined;
}, {
    x: number;
    y: number;
    op: "set_cel_position";
    layerName?: string | undefined;
    layerIndex?: number | undefined;
    frameNumber?: number | undefined;
}>, z.ZodObject<{
    frameNumber: z.ZodOptional<z.ZodNumber>;
    layerName: z.ZodOptional<z.ZodString>;
    layerIndex: z.ZodOptional<z.ZodNumber>;
    op: z.ZodLiteral<"set_cel_opacity">;
    opacity: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    opacity: number;
    op: "set_cel_opacity";
    layerName?: string | undefined;
    layerIndex?: number | undefined;
    frameNumber?: number | undefined;
}, {
    opacity: number;
    op: "set_cel_opacity";
    layerName?: string | undefined;
    layerIndex?: number | undefined;
    frameNumber?: number | undefined;
}>, z.ZodObject<{
    op: z.ZodLiteral<"set_frame_duration">;
    frameNumber: z.ZodNumber;
    durationMs: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    frameNumber: number;
    durationMs: number;
    op: "set_frame_duration";
}, {
    frameNumber: number;
    durationMs: number;
    op: "set_frame_duration";
}>]>, "many">;
export declare function registerBatchTools(server: McpServer, dispatcher: CommandDispatcher, stateTracker: BridgeState): void;
//# sourceMappingURL=batch.d.ts.map