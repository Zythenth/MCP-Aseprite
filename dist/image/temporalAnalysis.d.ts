import type { ImageBuffer } from "./png.js";
import type { AnimationLayerInspection, AnimationPlayback } from "../mcp/animationSelection.js";
export type TemporalFindingSeverity = "warning" | "info";
export type TemporalFindingConfidence = "high" | "medium" | "low";
export interface RigidRegionInput {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface ContactPointPosition {
    frameNumber: number;
    x: number;
    y: number;
}
export interface ContactPointInput {
    id: string;
    positions: ContactPointPosition[];
    maxDisplacement?: number;
}
export interface TemporalAnalysisThresholds {
    pixelDiffThreshold?: number;
    maxAdjacentChangeRatio?: number;
    maxCenterShift?: number;
    maxAreaChangeRatio?: number;
    maxCelPositionJump?: number;
    rigidTolerance?: number;
    maxContactPointDisplacement?: number;
    checkLoopContinuity?: boolean;
}
export interface TemporalAnalysisFinding {
    id: string;
    ruleId: string;
    severity: TemporalFindingSeverity;
    confidence: TemporalFindingConfidence;
    method: string;
    limitation: string;
    affectedFrames: number[];
    observedMetrics: Record<string, unknown>;
    description: string;
    suggestion: string;
}
export interface PairwiseStepMetric {
    stepIndex: number;
    frameA: number;
    frameB: number;
    changedPixels: number;
    changeRatio: number;
    visualCenterShift: number;
    areaDelta: number;
    relAreaChange: number;
    boundsA: {
        x: number;
        y: number;
        width: number;
        height: number;
    } | null;
    boundsB: {
        x: number;
        y: number;
        width: number;
        height: number;
    } | null;
    changedBounds: {
        x: number;
        y: number;
        width: number;
        height: number;
    } | null;
}
export interface PerFrameMetric {
    sequenceIndex: number;
    frameNumber: number;
    durationMs: number;
    occupiedArea: number;
    visualCenter: {
        x: number;
        y: number;
    } | null;
    bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
    } | null;
    uniqueColors: number;
}
export interface PureTemporalAnalysisInput {
    width: number;
    height: number;
    playback: Pick<AnimationPlayback, "frameNumbers" | "frames" | "loopsContinuously" | "tagName" | "direction" | "totalDurationMs" | "averageFps">;
    frameBuffers: ImageBuffer[];
    inspectionLayers?: AnimationLayerInspection[];
    rigidRegions?: RigidRegionInput[];
    contactPoints?: ContactPointInput[];
    thresholds?: TemporalAnalysisThresholds;
}
export interface TemporalAnalysisResult {
    temporalHash: string;
    frameCount: number;
    totalDurationMs: number;
    averageFps: number;
    summary: {
        totalFrames: number;
        totalDurationMs: number;
        totalFindings: number;
        findingsCount: number;
        truncated: boolean;
        warningCount: number;
        infoCount: number;
        passedRules: string[];
        flaggedRules: string[];
    };
    findings: TemporalAnalysisFinding[];
    metrics: {
        canvas: {
            width: number;
            height: number;
        };
        pairwiseDifferences: PairwiseStepMetric[];
        perFrameMetrics: PerFrameMetric[];
        paletteSummary: {
            totalUniqueColors: number;
            perFrameUniqueColors: number[];
        };
        loopSummary: {
            loopsContinuously: boolean;
            seamDiff?: {
                changedPixels: number;
                changeRatio: number;
                centerShift: number;
            };
        };
    };
}
export declare const MAX_ANALYSIS_FRAMES = 64;
export declare const MAX_AGGREGATE_INPUT_PIXELS = 67108864;
export declare const MAX_RIGID_REGIONS = 16;
export declare const MAX_CONTACT_POINTS = 16;
export declare const MAX_CONTACT_POSITIONS_PER_POINT = 64;
export declare const MAX_FINDINGS_LIMIT = 128;
export declare const ALL_TEMPORAL_RULES: readonly ["unexpected_duplicate_frame", "adjacent_pixel_diff_spike", "bounds_change_spike", "visual_center_jump", "occupied_area_spike", "isolated_pixel_flicker", "palette_variation", "rigid_region_instability", "contact_point_displacement", "loop_continuity_mismatch", "duration_inconsistency", "anomalous_cel_position_jump"];
export declare function computeCanonicalTemporalHash(width: number, height: number, frameNumbers: number[], durationsMs: number[], frames: ImageBuffer[]): string;
export declare function analyzeAnimationTemporalPure(input: PureTemporalAnalysisInput): TemporalAnalysisResult;
//# sourceMappingURL=temporalAnalysis.d.ts.map