import type { BridgeState } from "../bridge/state.js";
import type { ImageBuffer } from "../image/png.js";
export declare const LIVE_PAINTING_STAGES: readonly ["sketch", "blocks", "silhouette", "line", "base_colors", "shadows", "details", "polish"];
export type LivePaintingStageName = (typeof LIVE_PAINTING_STAGES)[number];
export type LivePaintingSpeed = "slow" | "normal" | "fast";
export type LivePaintingStatus = "active" | "paused" | "cancelled" | "completed";
export declare const LIVE_PAINTING_DELAY_MS: Record<LivePaintingSpeed, number>;
export interface LivePaintingSnapshot {
    id: string;
    kind: "initial" | "stage";
    stage?: LivePaintingStageName;
    description?: string;
    comment?: string;
    frameNumber: number;
    layerName?: string;
    revision: number;
    capturedAt: string;
    image: ImageBuffer;
}
export interface LivePaintingStage {
    id: string;
    name: LivePaintingStageName;
    description: string;
    comment?: string;
    startedAt: string;
    completedAt?: string;
    mutationTool?: string;
    snapshotId?: string;
}
export interface LivePaintingRun {
    id: string;
    title: string;
    sessionId: string;
    spriteIdentifier: string;
    createdRevision: number;
    status: LivePaintingStatus;
    speed: LivePaintingSpeed;
    commentaryMode: boolean;
    stageOrder: LivePaintingStageName[];
    stages: LivePaintingStage[];
    activeStage: LivePaintingStage | null;
    createdAt: string;
    cancelledAt?: string;
    completedAt?: string;
}
export interface LivePaintingSummary {
    id: string;
    title: string;
    status: LivePaintingStatus;
    speed: LivePaintingSpeed;
    recommendedDelayMs: number;
    commentaryMode: boolean;
    stageOrder: LivePaintingStageName[];
    completedStages: Array<Omit<LivePaintingStage, "id"> & {
        id: string;
    }>;
    activeStage: LivePaintingStage | null;
    nextStage: LivePaintingStageName | null;
    snapshotCount: number;
    sessionId: string;
    spriteIdentifier: string;
}
export declare class LivePaintingState {
    private run;
    private snapshots;
    constructor(state: BridgeState);
    clear(): void;
    start(input: {
        title: string;
        sessionId: string;
        spriteIdentifier: string;
        revision: number;
        speed: LivePaintingSpeed;
        commentaryMode: boolean;
        stageOrder: LivePaintingStageName[];
        initialSnapshot: Omit<LivePaintingSnapshot, "id" | "kind" | "capturedAt">;
    }): LivePaintingRun;
    getSummary(): LivePaintingSummary | null;
    getRunOrThrow(): LivePaintingRun;
    beginStage(input: {
        name: LivePaintingStageName;
        description: string;
        comment?: string;
    }): LivePaintingStage;
    beforeSpriteMutation(toolName: string): void;
    recordSpriteMutation(toolName: string): void;
    completeStage(snapshot: Omit<LivePaintingSnapshot, "id" | "kind" | "stage" | "description" | "comment" | "capturedAt">): LivePaintingStage;
    pause(): LivePaintingSummary;
    continue(): LivePaintingSummary;
    setSpeed(speed: LivePaintingSpeed): LivePaintingSummary;
    cancel(): LivePaintingSummary;
    complete(): LivePaintingSummary;
    getLastUndoableStage(): LivePaintingStage;
    confirmUndoLastStage(): LivePaintingStage;
    getSnapshot(id: string): LivePaintingSnapshot | undefined;
    listSnapshots(): Array<Omit<LivePaintingSnapshot, "image"> & {
        width: number;
        height: number;
    }>;
    getReplayImages(): LivePaintingSnapshot[];
    private addSnapshot;
}
//# sourceMappingURL=livePaintingState.d.ts.map