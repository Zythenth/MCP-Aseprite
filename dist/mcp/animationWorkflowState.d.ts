/**
 * src/mcp/animationWorkflowState.ts
 * In-memory typed and bounded animation workflow state tied to BridgeState
 * session, active sprite, and revision tracking.
 */
import type { BridgeState } from "../bridge/state.js";
export declare const ANIMATION_WORKFLOW_22_CATEGORIES: readonly ["silhouette", "proportions", "volume", "palette", "lighting", "structural_stability", "arcs", "timing", "spacing", "anticipation", "impact", "recovery", "loop_continuity", "jitter", "flicker", "foot_sliding", "accessories", "outlines", "clusters", "banding", "pillow_shading", "first_last_frame_consistency"];
export type AnimationWorkflowCategory = (typeof ANIMATION_WORKFLOW_22_CATEGORIES)[number];
export type FindingSeverity = "critical" | "high" | "medium" | "low";
export type FindingStatus = "open" | "resolved" | "accepted";
export interface AnimationFinding {
    id: string;
    category: string;
    severity: FindingSeverity;
    frameOrRange: string | number | {
        from: number;
        to: number;
    };
    bounds?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    description: string;
    evidence: string;
    suggestion: string;
    status: FindingStatus;
    resolutionReason?: string;
    acceptedReason?: string;
    createdAt: string;
    updatedAt: string;
}
export interface FindingInput {
    id: string;
    category: string;
    severity: FindingSeverity;
    frameOrRange: string | number | {
        from: number;
        to: number;
    };
    bounds?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    description: string;
    evidence: string;
    suggestion: string;
}
export interface TransparencySummary {
    hasTransparency: boolean;
    transparentPixels: number;
    translucentPixels: number;
}
export interface ReferenceAnalysis {
    referenceIdOuPath: string;
    hash: string;
    dimensions: {
        width: number;
        height: number;
    };
    transparency: TransparencySummary;
    observedPalette: string[];
    silhouette: string;
    proportions: string;
    anatomy: string;
    accessories: string;
    rigidParts: string;
    flexibleParts: string;
    joints: string;
    materials: string;
    emissiveRegions: string;
    lightDirection: string;
    outline: string;
    deformableRegions: string;
    stableRegions: string;
    allowedColors: string[];
    newColorsJustification?: string;
    recordedAt: string;
}
export interface PlannedKeyPose {
    id: string;
    name: string;
    role: "key" | "breakdown" | "anticipation" | "hold" | "inbetween";
    description: string;
    targetFrame?: number;
}
export type AnimationPlanTarget = {
    type: "tag";
    tagName: string;
} | {
    type: "range";
    frameRange: {
        from: number;
        to: number;
    };
};
export interface AnimationPlan {
    requestedAction: string;
    target: AnimationPlanTarget;
    totalDurationMs: number;
    plannedFps: number;
    frameCount: number;
    loopType: "forward" | "reverse" | "pingpong" | "pingpong_reverse" | "none" | "loop";
    anticipation: string;
    contacts: string;
    extremes: string;
    passing: string;
    recovery: string;
    keyPoses: PlannedKeyPose[];
    inBetweenFrames: string;
    motionArcs: string;
    rigidRegions: string;
    flexibleRegions: string;
    lightingRules: string;
    paletteRules: string;
    completionCriteria: string[];
    recordedAt: string;
    authorId?: string;
}
export interface KeyPoseMark {
    poseId: string;
    name: string;
    frameNumber: number;
    role: "key" | "breakdown" | "anticipation" | "hold" | "inbetween";
    description?: string;
    markedAt: string;
}
export interface PreviewEvidence {
    previewId: string;
    revision: number;
    temporalHash: string;
    playback: {
        frameNumbers: number[];
        tagName?: string;
        loop?: boolean;
    };
    recordedAt: string;
}
export interface TemporalAnalysisEvidence {
    analysisId: string;
    revision: number;
    temporalHash: string;
    targetSelection?: TargetSelection;
    playback: {
        frameNumbers: number[];
        tagName?: string;
        direction?: string;
        loop?: boolean;
    };
    summary: {
        totalFrames: number;
        totalDurationMs: number;
        totalFindings?: number;
        findingsCount: number;
        truncated?: boolean;
        warningCount: number;
        infoCount: number;
    };
    recordedAt: string;
}
export interface KeyPoseReview {
    revision: number;
    previewId: string;
    reviewedAt: string;
    passed: boolean;
    notes?: string;
}
export interface SelfReviewCategoryItem {
    category: AnimationWorkflowCategory;
    status: "pass" | "attention_needed" | "waived";
    notes: string;
}
export interface SelfReviewRecord {
    revision: number;
    previewId: string;
    selection?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    temporalHash: string;
    categories: Record<AnimationWorkflowCategory, SelfReviewCategoryItem>;
    reviewedAt: string;
    reviewerId: string;
}
export type QaResultPtBr = "aprovado" | "aprovado_com_ressalvas" | "reprovado";
export interface AnimationQaRecord {
    reviewerId: string;
    authorId: string;
    independenceConfirmed: true;
    revision: number;
    previewId: string;
    result: QaResultPtBr;
    feedback: string;
    submittedAt: string;
}
export interface TargetSelection {
    tagName?: string;
    frameRange?: {
        from: number;
        to: number;
    };
    frameNumbers?: number[];
}
export interface CompactCompletionEvidence {
    workflowId: string;
    workflowName: string;
    authorId: string;
    currentRevision: number;
    isComplete: boolean;
    unresolvedCounts: {
        critical: number;
        high: number;
        medium: number;
        low: number;
    };
    preview: {
        previewId: string;
        revision: number;
        temporalHash: string;
    };
    keyPoseReview: {
        previewId: string;
        revision: number;
        passed: boolean;
        reviewedAt: string;
    };
    selfReview: {
        previewId: string;
        revision: number;
        reviewerId: string;
        temporalHash: string;
        reviewedAt: string;
    };
    qa: {
        reviewerId: string;
        authorId: string;
        previewId: string;
        revision: number;
        result: QaResultPtBr;
        submittedAt: string;
    };
}
export interface LoadedReferenceEvidence {
    referenceId: string;
    hash: string;
    filePath: string;
    fileName?: string;
    projectRelativePath?: string | null;
    sourceFormat?: string;
    dimensions: {
        width: number;
        height: number;
    };
    sourceDimensions?: {
        width: number;
        height: number;
    };
    transparency: TransparencySummary;
    observedPalette: string[];
    palette?: Record<string, unknown>;
    sessionId: string;
    recordedAt: string;
}
export declare function matchesTargetSelection(targetSelection: TargetSelection, playback: {
    frameNumbers: number[];
    tagName?: string;
}): {
    matches: boolean;
    reason?: string;
};
export interface AnimationWorkflowData {
    workflowId: string;
    name: string;
    sessionId: string;
    spriteIdentifier: string;
    createdRevision: number;
    createdAt: string;
    authorId: string;
    targetSelection: TargetSelection;
    strictCompletionRequired: boolean;
    initialFramesCount: number;
    referenceAnalysis?: ReferenceAnalysis;
    plan?: AnimationPlan;
    keyPoses: Map<string, KeyPoseMark>;
    keyPoseReview?: KeyPoseReview;
    selfReview?: SelfReviewRecord;
    qaSubmissions: AnimationQaRecord[];
    findings: Map<string, AnimationFinding>;
}
export declare const MAX_FINDINGS = 256;
export declare const MAX_KEY_POSES = 128;
export declare const MAX_QA_SUBMISSIONS = 32;
export declare const MAX_REGISTERED_PREVIEWS = 32;
export declare const MAX_LOADED_REFERENCES = 32;
export declare const MAX_REGISTERED_TEMPORAL_ANALYSES = 32;
export declare class AnimationWorkflowState {
    private activeWorkflow;
    private currentSessionId;
    private currentSpriteIdentifier;
    private currentRevision;
    private registeredPreviews;
    private loadedReferences;
    private registeredTemporalAnalyses;
    constructor(stateTracker?: BridgeState);
    attachToStateTracker(stateTracker: BridgeState): void;
    setContext(sessionId: string | null, spriteIdentifier: string | null, revision: number): void;
    getRevision(): number;
    getSessionId(): string | null;
    getSpriteIdentifier(): string | null;
    clearWorkflow(_reason?: string): void;
    registerLoadedReference(ref: LoadedReferenceEvidence): void;
    getLoadedReference(identifierOrHash: string): LoadedReferenceEvidence | undefined;
    getLoadedReferences(): LoadedReferenceEvidence[];
    clearLoadedReferences(): void;
    registerPreview(preview: PreviewEvidence): void;
    getRegisteredPreview(previewId: string): PreviewEvidence | undefined;
    registerTemporalAnalysis(analysis: TemporalAnalysisEvidence): void;
    getRegisteredTemporalAnalyses(): TemporalAnalysisEvidence[];
    clearTemporalAnalyses(): void;
    checkActiveWorkflowMatch(playback: {
        frameNumbers: number[];
        tagName?: string;
    }, revision: number): {
        hasActiveWorkflow: boolean;
        workflowId?: string;
        workflowName?: string;
        matches: boolean;
        reason?: string;
    };
    createWorkflow(params: {
        name: string;
        authorId: string;
        targetSelection: TargetSelection;
        strictCompletionRequired: boolean;
        sessionId: string;
        spriteIdentifier: string;
        framesCount: number;
    }): AnimationWorkflowData;
    getWorkflow(): AnimationWorkflowData | null;
    recordReferenceAnalysis(analysis: Omit<ReferenceAnalysis, "recordedAt">): ReferenceAnalysis;
    recordPlan(plan: Omit<AnimationPlan, "recordedAt">): AnimationPlan;
    markKeyPose(params: {
        poseId: string;
        frameNumber: number;
        currentFramesCount: number;
        description?: string;
    }): KeyPoseMark;
    reviewKeyPoses(params: {
        previewId: string;
        revision: number;
        notes?: string;
        findings?: FindingInput[];
    }): KeyPoseReview;
    recordSelfReview(params: {
        previewId: string;
        revision: number;
        selection?: {
            x: number;
            y: number;
            width: number;
            height: number;
        };
        categories: Record<string, {
            status: "pass" | "attention_needed" | "waived";
            notes: string;
        }>;
        reviewerId: string;
        findings?: FindingInput[];
    }): SelfReviewRecord;
    validateAndAddFindingsBatch(findings?: FindingInput[]): AnimationFinding[];
    addFinding(findingInput: FindingInput): AnimationFinding;
    resolveFinding(findingId: string, resolution: {
        status: "resolved" | "accepted";
        reason: string;
    }): AnimationFinding;
    submitQa(params: {
        reviewerId: string;
        authorId: string;
        independenceConfirmed: true;
        previewId: string;
        revision: number;
        result: QaResultPtBr;
        feedback: string;
        findings?: FindingInput[];
    }): AnimationQaRecord;
    validateCompletion(): {
        isComplete: boolean;
        currentRevision: number;
        gates: {
            workflowExists: {
                passed: boolean;
                message: string;
            };
            referenceAnalyzed: {
                passed: boolean;
                message: string;
            };
            planRecorded: {
                passed: boolean;
                message: string;
            };
            keyPosesMapped: {
                passed: boolean;
                message: string;
            };
            currentPreview: {
                passed: boolean;
                message: string;
            };
            keyPosesReviewed: {
                passed: boolean;
                message: string;
            };
            selfReviewCompleted: {
                passed: boolean;
                message: string;
            };
            qaApproved: {
                passed: boolean;
                message: string;
            };
            noOpenCriticalFindings: {
                passed: boolean;
                message: string;
            };
            noUnaddressedHighFindings: {
                passed: boolean;
                message: string;
            };
            revisionNotStale: {
                passed: boolean;
                message: string;
            };
        };
        unresolvedFindings: {
            critical: number;
            high: number;
            medium: number;
            low: number;
        };
    };
    getCompletionEvidence(): CompactCompletionEvidence | null;
}
//# sourceMappingURL=animationWorkflowState.d.ts.map