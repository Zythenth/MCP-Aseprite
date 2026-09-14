export type AnimationDirection = "forward" | "reverse" | "pingpong" | "pingpong_reverse";
export interface AnimationFrameSummary {
    frameNumber: number;
    durationMs: number;
    celCount?: number;
}
export interface AnimationTagSummary {
    name: string;
    from: number;
    to: number;
    direction: AnimationDirection;
    repeats: number;
}
export interface AnimationCelSummary {
    frameNumber: number;
    x: number;
    y: number;
    bounds?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    position?: {
        x: number;
        y: number;
    };
}
export interface AnimationLayerInspection {
    uuid?: string;
    name: string;
    path: string;
    isVisible: boolean;
    opacity: number;
    isGroup: boolean;
    isImage: boolean;
    isTilemap: boolean;
    celCount: number;
    celFrames: number[];
    cels?: AnimationCelSummary[];
    children?: AnimationLayerInspection[];
}
export interface AnimationInspection {
    success?: boolean;
    width: number;
    height: number;
    colorMode: string;
    frames: AnimationFrameSummary[];
    tags: AnimationTagSummary[];
    layers: AnimationLayerInspection[];
    totalLayers?: number;
    totalCels?: number;
    totalDurationMs?: number;
    revision?: number;
}
export interface AnimationSelectionInput {
    tagName?: string;
    fromFrame?: number;
    toFrame?: number;
    direction?: AnimationDirection;
}
export interface AnimationPlayback {
    tagName: string | null;
    fromFrame: number;
    toFrame: number;
    direction: AnimationDirection;
    repeats: number | null;
    loopsContinuously: boolean;
    frameNumbers: number[];
    frames: Array<AnimationFrameSummary & {
        sequenceIndex: number;
    }>;
    totalDurationMs: number;
    averageFps: number;
    variableTiming: boolean;
}
export declare function buildPlaybackFrameNumbers(fromFrame: number, toFrame: number, direction: AnimationDirection): number[];
export declare function resolveAnimationPlayback(inspection: AnimationInspection, input: AnimationSelectionInput): AnimationPlayback;
//# sourceMappingURL=animationSelection.d.ts.map