/**
 * src/mcp/animationWorkflowState.ts
 * In-memory typed and bounded animation workflow state tied to BridgeState
 * session, active sprite, and revision tracking.
 */

import { randomUUID } from "node:crypto";
import type { BridgeState } from "../bridge/state.js";

export const ANIMATION_WORKFLOW_22_CATEGORIES = [
  "silhouette",
  "proportions",
  "volume",
  "palette",
  "lighting",
  "structural_stability",
  "arcs",
  "timing",
  "spacing",
  "anticipation",
  "impact",
  "recovery",
  "loop_continuity",
  "jitter",
  "flicker",
  "foot_sliding",
  "accessories",
  "outlines",
  "clusters",
  "banding",
  "pillow_shading",
  "first_last_frame_consistency",
] as const;

export type AnimationWorkflowCategory = (typeof ANIMATION_WORKFLOW_22_CATEGORIES)[number];

export type FindingSeverity = "critical" | "high" | "medium" | "low";
export type FindingStatus = "open" | "resolved" | "accepted";

export interface AnimationFinding {
  id: string;
  category: string;
  severity: FindingSeverity;
  frameOrRange: string | number | { from: number; to: number };
  bounds?: { x: number; y: number; width: number; height: number };
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
  frameOrRange: string | number | { from: number; to: number };
  bounds?: { x: number; y: number; width: number; height: number };
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
  dimensions: { width: number; height: number };
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

export type AnimationPlanTarget =
  | { type: "tag"; tagName: string }
  | { type: "range"; frameRange: { from: number; to: number } };

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
  selection?: { x: number; y: number; width: number; height: number };
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
  frameRange?: { from: number; to: number };
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
  dimensions: { width: number; height: number };
  sourceDimensions?: { width: number; height: number };
  transparency: TransparencySummary;
  observedPalette: string[];
  palette?: Record<string, unknown>;
  sessionId: string;
  recordedAt: string;
}

export function matchesTargetSelection(
  targetSelection: TargetSelection,
  playback: { frameNumbers: number[]; tagName?: string }
): { matches: boolean; reason?: string } {
  if (targetSelection.tagName) {
    if (playback.tagName !== targetSelection.tagName) {
      return {
        matches: false,
        reason: `Preview was rendered for tag '${playback.tagName || "none"}', but workflow targetSelection requires tag '${targetSelection.tagName}'.`,
      };
    }
  }

  if (targetSelection.frameRange) {
    const { from, to } = targetSelection.frameRange;
    const previewFrames = new Set(playback.frameNumbers);
    const missing: number[] = [];
    for (let f = from; f <= to; f++) {
      if (!previewFrames.has(f)) missing.push(f);
    }
    const extra: number[] = [];
    for (const f of previewFrames) {
      if (f < from || f > to) extra.push(f);
    }
    if (missing.length > 0 || extra.length > 0) {
      return {
        matches: false,
        reason: `Preview frame numbers do not match workflow targetSelection frameRange (${from}..${to}).${missing.length > 0 ? ` Missing frames: ${missing.join(", ")}.` : ""}${extra.length > 0 ? ` Extra frames: ${extra.join(", ")}.` : ""}`,
      };
    }
  }

  if (targetSelection.frameNumbers && targetSelection.frameNumbers.length > 0) {
    const previewFrames = new Set(playback.frameNumbers);
    const expectedFrames = new Set(targetSelection.frameNumbers);
    const missing: number[] = [];
    for (const f of expectedFrames) {
      if (!previewFrames.has(f)) missing.push(f);
    }
    const extra: number[] = [];
    for (const f of previewFrames) {
      if (!expectedFrames.has(f)) extra.push(f);
    }
    if (missing.length > 0 || extra.length > 0) {
      return {
        matches: false,
        reason: `Preview frame numbers do not match workflow targetSelection frameNumbers.${missing.length > 0 ? ` Missing frames: ${missing.join(", ")}.` : ""}${extra.length > 0 ? ` Extra frames: ${extra.join(", ")}.` : ""}`,
      };
    }
  }

  return { matches: true };
}

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
  keyPoses: Map<string, KeyPoseMark>; // poseId -> mark
  keyPoseReview?: KeyPoseReview;
  selfReview?: SelfReviewRecord;
  qaSubmissions: AnimationQaRecord[];
  findings: Map<string, AnimationFinding>; // findingId -> finding
}

export const MAX_FINDINGS = 256;
export const MAX_KEY_POSES = 128;
export const MAX_QA_SUBMISSIONS = 32;
export const MAX_REGISTERED_PREVIEWS = 32;
export const MAX_LOADED_REFERENCES = 32;
export const MAX_REGISTERED_TEMPORAL_ANALYSES = 32;

export class AnimationWorkflowState {
  private activeWorkflow: AnimationWorkflowData | null = null;
  private currentSessionId: string | null = null;
  private currentSpriteIdentifier: string | null = null;
  private currentRevision: number = 1;
  private registeredPreviews = new Map<string, PreviewEvidence>();
  private loadedReferences = new Map<string, LoadedReferenceEvidence>();
  private registeredTemporalAnalyses = new Map<string, TemporalAnalysisEvidence>();

  constructor(stateTracker?: BridgeState) {
    if (stateTracker) {
      this.attachToStateTracker(stateTracker);
    }
  }

  public attachToStateTracker(stateTracker: BridgeState): void {
    this.currentSessionId = stateTracker.getSessionId();
    const activeSprite = stateTracker.getActiveSprite();
    this.currentSpriteIdentifier = activeSprite?.filename || null;
    this.currentRevision = stateTracker.getRevision();

    stateTracker.on("connection_change", (data: { connected: boolean }) => {
      if (!data.connected) {
        this.clearWorkflow("Bridge disconnected");
      }
    });

    stateTracker.on("hello", (data: { sessionId: string; revision: number }) => {
      if (this.currentSessionId && this.currentSessionId !== data.sessionId) {
        this.clearWorkflow("Session changed");
      }
      this.currentSessionId = data.sessionId;
      this.currentRevision = data.revision;
    });

    stateTracker.on("sprite_change", () => {
      // Invalidate even if filename matches
      this.clearWorkflow("Sprite changed");
      const activeSprite = stateTracker.getActiveSprite();
      this.currentSpriteIdentifier = activeSprite?.filename || null;
    });

    stateTracker.on("revision_change", (data: { revision: number }) => {
      this.currentRevision = data.revision;
    });

    stateTracker.on("sync_change", (data: { sessionId: string; revision: number }) => {
      this.currentRevision = data.revision;
    });
  }

  public setContext(sessionId: string | null, spriteIdentifier: string | null, revision: number): void {
    if (this.currentSessionId && sessionId && this.currentSessionId !== sessionId) {
      this.clearWorkflow("Session changed");
    }
    if (this.currentSpriteIdentifier && spriteIdentifier && this.currentSpriteIdentifier !== spriteIdentifier) {
      this.clearWorkflow("Sprite changed");
    }
    this.currentSessionId = sessionId;
    this.currentSpriteIdentifier = spriteIdentifier;
    this.currentRevision = revision;
  }

  public getRevision(): number {
    return this.currentRevision;
  }

  public getSessionId(): string | null {
    return this.currentSessionId;
  }

  public getSpriteIdentifier(): string | null {
    return this.currentSpriteIdentifier;
  }

  public clearWorkflow(_reason?: string): void {
    this.activeWorkflow = null;
    this.registeredPreviews.clear();
    this.registeredTemporalAnalyses.clear();
    this.loadedReferences.clear();
  }

  public registerLoadedReference(ref: LoadedReferenceEvidence): void {
    if (!this.loadedReferences.has(ref.hash)) {
      if (this.loadedReferences.size >= MAX_LOADED_REFERENCES) {
        const oldestKey = this.loadedReferences.keys().next().value;
        if (oldestKey) this.loadedReferences.delete(oldestKey);
      }
    }
    this.loadedReferences.set(ref.hash, ref);
  }

  public getLoadedReference(identifierOrHash: string): LoadedReferenceEvidence | undefined {
    if (this.loadedReferences.has(identifierOrHash)) {
      return this.loadedReferences.get(identifierOrHash);
    }
    for (const ref of this.loadedReferences.values()) {
      if (
        ref.referenceId === identifierOrHash ||
        ref.hash === identifierOrHash ||
        ref.filePath === identifierOrHash ||
        ref.fileName === identifierOrHash ||
        (ref.projectRelativePath && ref.projectRelativePath === identifierOrHash)
      ) {
        return ref;
      }
    }
    return undefined;
  }

  public getLoadedReferences(): LoadedReferenceEvidence[] {
    return [...this.loadedReferences.values()];
  }

  public clearLoadedReferences(): void {
    this.loadedReferences.clear();
  }

  public registerPreview(preview: PreviewEvidence): void {
    if (this.registeredPreviews.size >= MAX_REGISTERED_PREVIEWS) {
      const oldestKey = this.registeredPreviews.keys().next().value;
      if (oldestKey) this.registeredPreviews.delete(oldestKey);
    }
    this.registeredPreviews.set(preview.previewId, preview);
  }

  public getRegisteredPreview(previewId: string): PreviewEvidence | undefined {
    return this.registeredPreviews.get(previewId);
  }

  public registerTemporalAnalysis(analysis: TemporalAnalysisEvidence): void {
    if (this.registeredTemporalAnalyses.size >= MAX_REGISTERED_TEMPORAL_ANALYSES) {
      const oldestKey = this.registeredTemporalAnalyses.keys().next().value;
      if (oldestKey) this.registeredTemporalAnalyses.delete(oldestKey);
    }
    this.registeredTemporalAnalyses.set(analysis.analysisId, analysis);
  }


  public getRegisteredTemporalAnalyses(): TemporalAnalysisEvidence[] {
    return [...this.registeredTemporalAnalyses.values()];
  }

  public clearTemporalAnalyses(): void {
    this.registeredTemporalAnalyses.clear();
  }

  public checkActiveWorkflowMatch(
    playback: { frameNumbers: number[]; tagName?: string },
    revision: number
  ): {
    hasActiveWorkflow: boolean;
    workflowId?: string;
    workflowName?: string;
    matches: boolean;
    reason?: string;
  } {
    if (!this.activeWorkflow) {
      return { hasActiveWorkflow: false, matches: false, reason: "No active animation workflow." };
    }
    if (this.currentRevision !== revision) {
      return {
        hasActiveWorkflow: true,
        workflowId: this.activeWorkflow.workflowId,
        workflowName: this.activeWorkflow.name,
        matches: false,
        reason: `Analysis revision (${revision}) does not match active workflow revision (${this.currentRevision}).`,
      };
    }
    const coverage = matchesTargetSelection(this.activeWorkflow.targetSelection, playback);
    return {
      hasActiveWorkflow: true,
      workflowId: this.activeWorkflow.workflowId,
      workflowName: this.activeWorkflow.name,
      matches: coverage.matches,
      reason: coverage.reason,
    };
  }

  public createWorkflow(params: {
    name: string;
    authorId: string;
    targetSelection: TargetSelection;
    strictCompletionRequired: boolean;
    sessionId: string;
    spriteIdentifier: string;
    framesCount: number;
  }): AnimationWorkflowData {
    if (!params.sessionId || params.sessionId === "default") {
      throw new Error("Cannot create animation workflow: valid active bridge session is required.");
    }
    if (!params.spriteIdentifier || params.spriteIdentifier === "active") {
      throw new Error("Cannot create animation workflow: active sprite is required.");
    }

    const workflowId = randomUUID();
    this.activeWorkflow = {
      workflowId,
      name: params.name,
      sessionId: params.sessionId,
      spriteIdentifier: params.spriteIdentifier,
      createdRevision: this.currentRevision,
      createdAt: new Date().toISOString(),
      authorId: params.authorId,
      targetSelection: params.targetSelection,
      strictCompletionRequired: params.strictCompletionRequired,
      initialFramesCount: params.framesCount,
      keyPoses: new Map(),
      qaSubmissions: [],
      findings: new Map(),
    };
    return this.activeWorkflow;
  }

  public getWorkflow(): AnimationWorkflowData | null {
    return this.activeWorkflow;
  }

  public recordReferenceAnalysis(analysis: Omit<ReferenceAnalysis, "recordedAt">): ReferenceAnalysis {
    if (!this.activeWorkflow) {
      throw new Error("No active animation workflow. Call create_animation_workflow first.");
    }

    const ref = this.getLoadedReference(analysis.hash) || this.getLoadedReference(analysis.referenceIdOuPath);
    if (!ref) {
      throw new Error(
        `Cannot record reference analysis: no loaded reference matches hash '${analysis.hash}' or identifier '${analysis.referenceIdOuPath}' in the current session. Use load_reference_image first.`
      );
    }

    if (ref.sessionId !== this.currentSessionId) {
      throw new Error("Loaded reference does not belong to the current session.");
    }

    if (analysis.hash !== ref.hash) {
      throw new Error(
        `Reference analysis hash '${analysis.hash}' does not match loaded reference hash '${ref.hash}'.`
      );
    }

    if (
      analysis.dimensions.width !== ref.dimensions.width ||
      analysis.dimensions.height !== ref.dimensions.height
    ) {
      throw new Error(
        `Reference analysis dimensions ${analysis.dimensions.width}x${analysis.dimensions.height} do not match loaded reference dimensions ${ref.dimensions.width}x${ref.dimensions.height}.`
      );
    }

    if (
      analysis.transparency.hasTransparency !== ref.transparency.hasTransparency ||
      analysis.transparency.transparentPixels !== ref.transparency.transparentPixels ||
      analysis.transparency.translucentPixels !== ref.transparency.translucentPixels
    ) {
      throw new Error(
        `Reference analysis transparency does not match loaded reference transparency.`
      );
    }

    const normalizeColors = (colors: string[]) => colors.map((c) => c.toUpperCase()).sort();
    const analysisColors = normalizeColors(analysis.observedPalette);
    const refColors = normalizeColors(ref.observedPalette);
    if (
      analysisColors.length !== refColors.length ||
      analysisColors.some((color, idx) => color !== refColors[idx])
    ) {
      throw new Error(
        `Reference analysis observedPalette does not match loaded reference observed palette.`
      );
    }

    const fullAnalysis: ReferenceAnalysis = {
      ...analysis,
      recordedAt: new Date().toISOString(),
    };
    this.activeWorkflow.referenceAnalysis = fullAnalysis;
    return fullAnalysis;
  }

  public recordPlan(plan: Omit<AnimationPlan, "recordedAt">): AnimationPlan {
    if (!this.activeWorkflow) {
      throw new Error("No active animation workflow. Call create_animation_workflow first.");
    }

    // Coherence validations
    if (plan.keyPoses.length === 0) {
      throw new Error("Animation plan must include at least one planned key pose in keyPoses.");
    }
    const seenIds = new Set<string>();
    for (const pose of plan.keyPoses) {
      if (seenIds.has(pose.id)) {
        throw new Error(`Duplicate pose ID '${pose.id}' in planned keyPoses.`);
      }
      seenIds.add(pose.id);
    }
    if (plan.frameCount <= 0) {
      throw new Error("Animation plan frameCount must be a positive integer.");
    }
    if (plan.totalDurationMs <= 0) {
      throw new Error("Animation plan totalDurationMs must be positive.");
    }
    if (plan.plannedFps <= 0) {
      throw new Error("Animation plan plannedFps must be positive.");
    }
    if (plan.target.type === "range") {
      if (plan.target.frameRange.from > plan.target.frameRange.to) {
        throw new Error("Animation plan target frameRange: from must be <= to.");
      }
    }

    // Coherence with workflow targetSelection
    const wfTarget = this.activeWorkflow.targetSelection;
    if (wfTarget.tagName) {
      if (plan.target.type !== "tag" || plan.target.tagName !== wfTarget.tagName) {
        throw new Error(
          `Animation plan target (${plan.target.type === "tag" ? `tag '${plan.target.tagName}'` : "range"}) is not coherent with workflow targetSelection tag '${wfTarget.tagName}'.`
        );
      }
    }
    if (wfTarget.frameRange) {
      if (
        plan.target.type !== "range" ||
        plan.target.frameRange.from !== wfTarget.frameRange.from ||
        plan.target.frameRange.to !== wfTarget.frameRange.to
      ) {
        throw new Error(
          `Animation plan target (${plan.target.type === "range" ? `range ${plan.target.frameRange.from}..${plan.target.frameRange.to}` : "tag"}) is not coherent with workflow targetSelection frameRange (${wfTarget.frameRange.from}..${wfTarget.frameRange.to}).`
        );
      }
    }
    if (wfTarget.frameNumbers && wfTarget.frameNumbers.length > 0) {
      if (plan.target.type === "range") {
        const minFrame = Math.min(...wfTarget.frameNumbers);
        const maxFrame = Math.max(...wfTarget.frameNumbers);
        if (plan.target.frameRange.from !== minFrame || plan.target.frameRange.to !== maxFrame) {
          throw new Error(
            `Animation plan target range (${plan.target.frameRange.from}..${plan.target.frameRange.to}) is not coherent with workflow targetSelection frameNumbers (${minFrame}..${maxFrame}).`
          );
        }
      }
    }

    // frameCount coherent with selection
    if (plan.target.type === "range") {
      const expectedFrameCount = plan.target.frameRange.to - plan.target.frameRange.from + 1;
      if (plan.frameCount !== expectedFrameCount) {
        throw new Error(
          `Animation plan frameCount (${plan.frameCount}) is not coherent with target frameRange count (${expectedFrameCount}).`
        );
      }
    } else if (wfTarget.frameNumbers && wfTarget.frameNumbers.length > 0) {
      if (plan.frameCount !== wfTarget.frameNumbers.length) {
        throw new Error(
          `Animation plan frameCount (${plan.frameCount}) is not coherent with targetSelection frameNumbers count (${wfTarget.frameNumbers.length}).`
        );
      }
    }

    // targetFrame of planned poses inside target
    for (const pose of plan.keyPoses) {
      if (pose.targetFrame !== undefined) {
        if (plan.target.type === "range") {
          const { from, to } = plan.target.frameRange;
          if (pose.targetFrame < from || pose.targetFrame > to) {
            throw new Error(
              `Planned key pose '${pose.id}' targetFrame (${pose.targetFrame}) is outside plan target range (${from}..${to}).`
            );
          }
        } else if (plan.target.type === "tag") {
          if (pose.targetFrame < 1 || pose.targetFrame > plan.frameCount) {
            throw new Error(
              `Planned key pose '${pose.id}' targetFrame (${pose.targetFrame}) is outside planned frameCount (1..${plan.frameCount}).`
            );
          }
        }
      }
    }

    const fullPlan: AnimationPlan = {
      ...plan,
      authorId: plan.authorId || this.activeWorkflow.authorId,
      recordedAt: new Date().toISOString(),
    };
    this.activeWorkflow.plan = fullPlan;
    return fullPlan;
  }

  public markKeyPose(params: {
    poseId: string;
    frameNumber: number;
    currentFramesCount: number;
    description?: string;
  }): KeyPoseMark {
    if (!this.activeWorkflow) {
      throw new Error("No active animation workflow. Call create_animation_workflow first.");
    }
    if (!this.activeWorkflow.plan) {
      throw new Error("Cannot mark key pose without a recorded animation plan.");
    }

    const plannedPose = this.activeWorkflow.plan.keyPoses.find((p) => p.id === params.poseId);
    if (!plannedPose) {
      throw new Error(
        `Pose ID '${params.poseId}' does not exist in the recorded animation plan. Available poses: ${this.activeWorkflow.plan.keyPoses
          .map((p) => p.id)
          .join(", ")}`
      );
    }

    if (params.frameNumber < 1 || params.frameNumber > params.currentFramesCount) {
      throw new Error(
        `frameNumber ${params.frameNumber} is outside the active sprite's current frames (1..${params.currentFramesCount}).`
      );
    }

    // Check target boundaries if target is a range
    if (this.activeWorkflow.plan.target.type === "range") {
      const { from, to } = this.activeWorkflow.plan.target.frameRange;
      if (params.frameNumber < from || params.frameNumber > to) {
        throw new Error(
          `frameNumber ${params.frameNumber} is outside the planned target range (${from}..${to}).`
        );
      }
    }

    if (this.activeWorkflow.keyPoses.size >= MAX_KEY_POSES && !this.activeWorkflow.keyPoses.has(params.poseId)) {
      throw new Error(`Maximum key poses limit (${MAX_KEY_POSES}) reached.`);
    }

    const mark: KeyPoseMark = {
      poseId: plannedPose.id,
      name: plannedPose.name,
      role: plannedPose.role,
      frameNumber: params.frameNumber,
      description: params.description || plannedPose.description,
      markedAt: new Date().toISOString(),
    };
    this.activeWorkflow.keyPoses.set(params.poseId, mark);
    return mark;
  }

  public reviewKeyPoses(params: {
    previewId: string;
    revision: number;
    notes?: string;
    findings?: FindingInput[];
  }): KeyPoseReview {
    if (!this.activeWorkflow) {
      throw new Error("No active animation workflow. Call create_animation_workflow first.");
    }
    if (!this.activeWorkflow.plan || this.activeWorkflow.plan.keyPoses.length === 0) {
      throw new Error("Cannot review key poses without a recorded animation plan containing planned poses.");
    }

    if (params.revision !== this.currentRevision) {
      throw new Error(
        `Provided revision (${params.revision}) does not match current sprite revision (${this.currentRevision}).`
      );
    }

    const preview = this.getRegisteredPreview(params.previewId);
    if (!preview || preview.revision !== this.currentRevision) {
      throw new Error(
        `Preview ID '${params.previewId}' is not registered or was not rendered at current revision (${this.currentRevision}). Render animation preview first.`
      );
    }

    const coverage = matchesTargetSelection(this.activeWorkflow.targetSelection, preview.playback);
    if (!coverage.matches) {
      throw new Error(
        `Preview ID '${params.previewId}' does not cover workflow targetSelection: ${coverage.reason}`
      );
    }

    // Register any passed findings atomically
    if (params.findings && params.findings.length > 0) {
      this.validateAndAddFindingsBatch(params.findings);
    }

    // Verify all planned poses are mapped
    const unmappedPoses = this.activeWorkflow.plan.keyPoses.filter(
      (p) => !this.activeWorkflow!.keyPoses.has(p.id)
    );
    if (unmappedPoses.length > 0) {
      throw new Error(
        `Cannot complete key pose review: ${unmappedPoses.length} planned pose(s) not mapped (${unmappedPoses
          .map((p) => p.name || p.id)
          .join(", ")}).`
      );
    }

    // Open critical findings block review
    const openCritical = [...this.activeWorkflow.findings.values()].filter(
      (f) => f.severity === "critical" && f.status === "open"
    );
    if (openCritical.length > 0) {
      throw new Error(
        `Cannot pass key pose review: ${openCritical.length} open critical finding(s) exist.`
      );
    }

    const review: KeyPoseReview = {
      revision: this.currentRevision,
      previewId: params.previewId,
      reviewedAt: new Date().toISOString(),
      passed: true,
      notes: params.notes,
    };
    this.activeWorkflow.keyPoseReview = review;
    return review;
  }

  public recordSelfReview(params: {
    previewId: string;
    revision: number;
    selection?: { x: number; y: number; width: number; height: number };
    categories: Record<string, { status: "pass" | "attention_needed" | "waived"; notes: string }>;
    reviewerId: string;
    findings?: FindingInput[];
  }): SelfReviewRecord {
    if (!this.activeWorkflow) {
      throw new Error("No active animation workflow. Call create_animation_workflow first.");
    }

    if (params.revision !== this.currentRevision) {
      throw new Error(
        `Provided revision (${params.revision}) does not match current sprite revision (${this.currentRevision}).`
      );
    }

    const preview = this.getRegisteredPreview(params.previewId);
    if (!preview || preview.revision !== this.currentRevision) {
      throw new Error(
        `Preview ID '${params.previewId}' is not registered or was not rendered at current revision (${this.currentRevision}). Render animation preview first.`
      );
    }

    const coverage = matchesTargetSelection(this.activeWorkflow.targetSelection, preview.playback);
    if (!coverage.matches) {
      throw new Error(
        `Preview ID '${params.previewId}' does not cover workflow targetSelection: ${coverage.reason}`
      );
    }

    // Register any passed findings atomically
    if (params.findings && params.findings.length > 0) {
      this.validateAndAddFindingsBatch(params.findings);
    }

    // Must cover explicitly all 22 categories
    const missingCategories: string[] = [];
    for (const cat of ANIMATION_WORKFLOW_22_CATEGORIES) {
      if (!params.categories[cat]) {
        missingCategories.push(cat);
      }
    }
    if (missingCategories.length > 0) {
      throw new Error(
        `Self-review must cover all 22 categories. Missing: ${missingCategories.join(", ")}`
      );
    }

    const typedCategories = {} as Record<AnimationWorkflowCategory, SelfReviewCategoryItem>;
    for (const cat of ANIMATION_WORKFLOW_22_CATEGORIES) {
      const item = params.categories[cat];
      typedCategories[cat] = {
        category: cat,
        status: item.status,
        notes: item.notes,
      };
    }

    const record: SelfReviewRecord = {
      revision: this.currentRevision,
      previewId: params.previewId,
      selection: params.selection,
      temporalHash: preview.temporalHash, // Taken from registered preview, NOT caller
      categories: typedCategories,
      reviewedAt: new Date().toISOString(),
      reviewerId: params.reviewerId,
    };

    this.activeWorkflow.selfReview = record;
    return record;
  }

  public validateAndAddFindingsBatch(findings?: FindingInput[]): AnimationFinding[] {
    if (!findings || findings.length === 0) return [];
    if (!this.activeWorkflow) {
      throw new Error("No active animation workflow. Call create_animation_workflow first.");
    }

    const totalAfter = this.activeWorkflow.findings.size + findings.length;
    if (totalAfter > MAX_FINDINGS) {
      throw new Error(
        `Cannot add batch of ${findings.length} findings: total findings (${totalAfter}) would exceed maximum limit of ${MAX_FINDINGS} (currently ${this.activeWorkflow.findings.size}).`
      );
    }

    const batchIds = new Set<string>();
    for (const f of findings) {
      if (batchIds.has(f.id)) {
        throw new Error(
          `Cannot add batch of findings: duplicate finding ID '${f.id}' within the incoming batch.`
        );
      }
      batchIds.add(f.id);
    }

    for (const f of findings) {
      if (this.activeWorkflow.findings.has(f.id)) {
        throw new Error(
          `Cannot add batch of findings: finding with ID '${f.id}' already exists in workflow.`
        );
      }
    }

    const now = new Date().toISOString();
    const added: AnimationFinding[] = [];
    for (const f of findings) {
      const finding: AnimationFinding = {
        ...f,
        status: "open",
        createdAt: now,
        updatedAt: now,
      };
      this.activeWorkflow.findings.set(finding.id, finding);
      added.push(finding);
    }
    return added;
  }

  public addFinding(findingInput: FindingInput): AnimationFinding {
    if (!this.activeWorkflow) {
      throw new Error("No active animation workflow. Call create_animation_workflow first.");
    }
    if (this.activeWorkflow.findings.has(findingInput.id)) {
      throw new Error(`Finding with ID '${findingInput.id}' already exists.`);
    }
    if (this.activeWorkflow.findings.size >= MAX_FINDINGS) {
      throw new Error(`Maximum findings limit (${MAX_FINDINGS}) reached.`);
    }

    const now = new Date().toISOString();
    const finding: AnimationFinding = {
      ...findingInput,
      status: "open",
      createdAt: now,
      updatedAt: now,
    };
    this.activeWorkflow.findings.set(finding.id, finding);
    return finding;
  }

  public resolveFinding(findingId: string, resolution: { status: "resolved" | "accepted"; reason: string }): AnimationFinding {
    if (!this.activeWorkflow) {
      throw new Error("No active animation workflow. Call create_animation_workflow first.");
    }
    const finding = this.activeWorkflow.findings.get(findingId);
    if (!finding) {
      throw new Error(`Finding '${findingId}' not found.`);
    }
    if (!resolution.reason || resolution.reason.trim().length === 0) {
      throw new Error("Resolution/acceptance requires a non-empty justification reason.");
    }
    if (resolution.status === "accepted" && finding.severity === "critical") {
      throw new Error("Cannot accept findings with 'critical' severity; critical findings must be resolved.");
    }

    finding.status = resolution.status;
    if (resolution.status === "resolved") {
      finding.resolutionReason = resolution.reason.trim();
    } else {
      finding.acceptedReason = resolution.reason.trim();
    }
    finding.updatedAt = new Date().toISOString();
    return finding;
  }

  public submitQa(params: {
    reviewerId: string;
    authorId: string;
    independenceConfirmed: true;
    previewId: string;
    revision: number;
    result: QaResultPtBr;
    feedback: string;
    findings?: FindingInput[];
  }): AnimationQaRecord {
    if (!this.activeWorkflow) {
      throw new Error("No active animation workflow. Call create_animation_workflow first.");
    }

    if (params.revision !== this.currentRevision) {
      throw new Error(
        `Provided revision (${params.revision}) does not match current sprite revision (${this.currentRevision}).`
      );
    }

    if (params.authorId !== this.activeWorkflow.authorId) {
      throw new Error(
        `authorId '${params.authorId}' does not match workflow authorId '${this.activeWorkflow.authorId}'.`
      );
    }

    // Reviewer independence check
    if (params.reviewerId === params.authorId) {
      throw new Error("Independent QA requires reviewerId to be different from authorId.");
    }
    if (!params.independenceConfirmed) {
      throw new Error("Independent QA requires independenceConfirmed to be true.");
    }

    const preview = this.getRegisteredPreview(params.previewId);
    if (!preview || preview.revision !== this.currentRevision) {
      throw new Error(
        `Preview ID '${params.previewId}' is not registered or was not rendered at current revision (${this.currentRevision}). Render animation preview first.`
      );
    }

    const coverage = matchesTargetSelection(this.activeWorkflow.targetSelection, preview.playback);
    if (!coverage.matches) {
      throw new Error(
        `Preview ID '${params.previewId}' does not cover workflow targetSelection: ${coverage.reason}`
      );
    }

    // Register any findings first atomically
    if (params.findings && params.findings.length > 0) {
      this.validateAndAddFindingsBatch(params.findings);
    }

    // Critical findings block QA approval
    const openCritical = [...this.activeWorkflow.findings.values()].filter(
      (f) => f.severity === "critical" && f.status === "open"
    );
    const isApproved = params.result === "aprovado" || params.result === "aprovado_com_ressalvas";
    if (isApproved && openCritical.length > 0) {
      throw new Error(`Cannot approve QA with open critical findings (${openCritical.length} critical finding(s) open).`);
    }

    // High findings require resolution or explicit acceptance
    const unresolvedHigh = [...this.activeWorkflow.findings.values()].filter(
      (f) => f.severity === "high" && f.status === "open"
    );
    if (isApproved && unresolvedHigh.length > 0) {
      throw new Error(`Cannot approve QA with unaddressed high findings (${unresolvedHigh.length} high finding(s) open).`);
    }

    if (this.activeWorkflow.qaSubmissions.length >= MAX_QA_SUBMISSIONS) {
      throw new Error(`Maximum QA submissions limit (${MAX_QA_SUBMISSIONS}) reached.`);
    }

    const record: AnimationQaRecord = {
      reviewerId: params.reviewerId,
      authorId: params.authorId,
      independenceConfirmed: true,
      revision: this.currentRevision,
      previewId: params.previewId,
      result: params.result,
      feedback: params.feedback,
      submittedAt: new Date().toISOString(),
    };

    this.activeWorkflow.qaSubmissions.push(record);
    return record;
  }

  public validateCompletion(): {
    isComplete: boolean;
    currentRevision: number;
    gates: {
      workflowExists: { passed: boolean; message: string };
      referenceAnalyzed: { passed: boolean; message: string };
      planRecorded: { passed: boolean; message: string };
      keyPosesMapped: { passed: boolean; message: string };
      currentPreview: { passed: boolean; message: string };
      keyPosesReviewed: { passed: boolean; message: string };
      selfReviewCompleted: { passed: boolean; message: string };
      qaApproved: { passed: boolean; message: string };
      noOpenCriticalFindings: { passed: boolean; message: string };
      noUnaddressedHighFindings: { passed: boolean; message: string };
      revisionNotStale: { passed: boolean; message: string };
    };
    unresolvedFindings: {
      critical: number;
      high: number;
      medium: number;
      low: number;
    };
  } {
    const wf = this.activeWorkflow;
    const currentRev = this.currentRevision;

    const hasCurrentPreview = [...this.registeredPreviews.values()].some(
      (p) => p.revision === currentRev && (wf ? matchesTargetSelection(wf.targetSelection, p.playback).matches : false)
    );

    const kpPrev = wf?.keyPoseReview ? this.getRegisteredPreview(wf.keyPoseReview.previewId) : undefined;
    const kpCoverage = Boolean(wf && kpPrev && matchesTargetSelection(wf.targetSelection, kpPrev.playback).matches);

    const srPrev = wf?.selfReview ? this.getRegisteredPreview(wf.selfReview.previewId) : undefined;
    const srCoverage = Boolean(wf && srPrev && matchesTargetSelection(wf.targetSelection, srPrev.playback).matches);

    const gates = {
      workflowExists: {
        passed: Boolean(wf),
        message: wf ? `Workflow '${wf.name}' active.` : "No active animation workflow.",
      },
      referenceAnalyzed: {
        passed: Boolean(wf?.referenceAnalysis),
        message: wf?.referenceAnalysis
          ? `Reference analysis recorded (${wf.referenceAnalysis.referenceIdOuPath}).`
          : "Reference analysis not recorded.",
      },
      planRecorded: {
        passed: Boolean(wf?.plan && wf.plan.keyPoses.length > 0),
        message:
          wf?.plan && wf.plan.keyPoses.length > 0
            ? `Plan recorded with ${wf.plan.keyPoses.length} key poses.`
            : "Animation plan missing or has 0 key poses.",
      },
      keyPosesMapped: {
        passed: Boolean(
          wf?.plan &&
            wf.plan.keyPoses.length > 0 &&
            wf.plan.keyPoses.every((p) => wf.keyPoses.has(p.id))
        ),
        message:
          wf?.plan && wf.plan.keyPoses.every((p) => wf.keyPoses.has(p.id))
            ? "All planned poses mapped to timeline frames."
            : "One or more planned key poses are not mapped.",
      },
      currentPreview: {
        passed: hasCurrentPreview,
        message: hasCurrentPreview
          ? "Preview rendered and registered at current revision matching targetSelection."
          : "No animation preview rendered for the current revision matching targetSelection.",
      },
      keyPosesReviewed: {
        passed: Boolean(
          wf?.keyPoseReview &&
            wf.keyPoseReview.passed &&
            wf.keyPoseReview.revision === currentRev &&
            kpPrev?.revision === currentRev &&
            kpCoverage
        ),
        message: !wf?.keyPoseReview
          ? "Key pose review not recorded."
          : wf.keyPoseReview.revision !== currentRev
          ? `Key pose review is stale (reviewed at rev ${wf.keyPoseReview.revision}, current is rev ${currentRev}).`
          : !kpCoverage
          ? "Key pose review preview does not cover targetSelection."
          : "Key pose review verified for current revision.",
      },
      selfReviewCompleted: {
        passed: Boolean(
          wf?.selfReview &&
            wf.selfReview.revision === currentRev &&
            srPrev?.revision === currentRev &&
            srCoverage
        ),
        message: !wf?.selfReview
          ? "Self-review across 22 categories not recorded."
          : wf.selfReview.revision !== currentRev
          ? `Self-review is stale (reviewed at rev ${wf.selfReview.revision}, current is rev ${currentRev}).`
          : !srCoverage
          ? "Self-review preview does not cover targetSelection."
          : "Self-review verified for current revision.",
      },
      qaApproved: {
        passed: false,
        message: "No QA submission found.",
      },
      noOpenCriticalFindings: {
        passed: true,
        message: "No open critical findings.",
      },
      noUnaddressedHighFindings: {
        passed: true,
        message: "All high findings resolved or accepted.",
      },
      revisionNotStale: {
        passed: false,
        message: "Reviews do not match current revision.",
      },
    };

    const findings = wf ? [...wf.findings.values()] : [];
    const openCritical = findings.filter((f) => f.severity === "critical" && f.status === "open");
    const openHigh = findings.filter((f) => f.severity === "high" && f.status === "open");
    const openMed = findings.filter((f) => f.severity === "medium" && f.status === "open");
    const openLow = findings.filter((f) => f.severity === "low" && f.status === "open");

    if (openCritical.length > 0) {
      gates.noOpenCriticalFindings = {
        passed: false,
        message: `${openCritical.length} critical finding(s) remain open.`,
      };
    }

    if (openHigh.length > 0) {
      gates.noUnaddressedHighFindings = {
        passed: false,
        message: `${openHigh.length} high finding(s) remain open without resolution or acceptance.`,
      };
    }

    const latestQa = wf?.qaSubmissions.length ? wf.qaSubmissions[wf.qaSubmissions.length - 1] : null;
    if (latestQa) {
      const qaPrev = this.getRegisteredPreview(latestQa.previewId);
      const qaCoverage = Boolean(wf && qaPrev && matchesTargetSelection(wf.targetSelection, qaPrev.playback).matches);
      const isApproved = latestQa.result === "aprovado" || latestQa.result === "aprovado_com_ressalvas";
      const isCurrent =
        latestQa.revision === currentRev &&
        qaPrev?.revision === currentRev &&
        qaCoverage;

      if (!isApproved) {
        gates.qaApproved = {
          passed: false,
          message: `Latest QA result is rejected (${latestQa.result}).`,
        };
      } else if (!isCurrent) {
        gates.qaApproved = {
          passed: false,
          message: `QA is stale or does not cover targetSelection (submitted at rev ${latestQa.revision}, current is rev ${currentRev}).`,
        };
      } else {
        gates.qaApproved = {
          passed: true,
          message: `QA approved by ${latestQa.reviewerId} for current revision.`,
        };
      }
    }

    gates.revisionNotStale = {
      passed:
        gates.currentPreview.passed &&
        gates.keyPosesReviewed.passed &&
        gates.selfReviewCompleted.passed &&
        gates.qaApproved.passed,
      message:
        gates.currentPreview.passed &&
        gates.keyPosesReviewed.passed &&
        gates.selfReviewCompleted.passed &&
        gates.qaApproved.passed
          ? "All reviews, QA, and preview are up-to-date with current revision."
          : "One or more reviews/QA/preview submissions are stale or missing for the current revision.",
    };

    const isComplete =
      gates.workflowExists.passed &&
      gates.referenceAnalyzed.passed &&
      gates.planRecorded.passed &&
      gates.keyPosesMapped.passed &&
      gates.currentPreview.passed &&
      gates.keyPosesReviewed.passed &&
      gates.selfReviewCompleted.passed &&
      gates.qaApproved.passed &&
      gates.noOpenCriticalFindings.passed &&
      gates.noUnaddressedHighFindings.passed &&
      gates.revisionNotStale.passed;

    return {
      isComplete,
      currentRevision: currentRev,
      gates,
      unresolvedFindings: {
        critical: openCritical.length,
        high: openHigh.length,
        medium: openMed.length,
        low: openLow.length,
      },
    };
  }

  public getCompletionEvidence(): CompactCompletionEvidence | null {
    const validation = this.validateCompletion();
    if (!validation.isComplete || !this.activeWorkflow) {
      return null;
    }
    const wf = this.activeWorkflow;
    const currentRev = this.currentRevision;

    if (!wf.keyPoseReview || !wf.selfReview || wf.qaSubmissions.length === 0) {
      return null;
    }

    const latestQa = wf.qaSubmissions[wf.qaSubmissions.length - 1];
    const currentPreview = this.getRegisteredPreview(latestQa.previewId);
    if (!currentPreview || currentPreview.revision !== currentRev) {
      return null;
    }

    return {
      workflowId: wf.workflowId,
      workflowName: wf.name,
      authorId: wf.authorId,
      currentRevision: currentRev,
      isComplete: true,
      unresolvedCounts: validation.unresolvedFindings,
      preview: {
        previewId: currentPreview.previewId,
        revision: currentPreview.revision,
        temporalHash: currentPreview.temporalHash,
      },
      keyPoseReview: {
        previewId: wf.keyPoseReview.previewId,
        revision: wf.keyPoseReview.revision,
        passed: wf.keyPoseReview.passed,
        reviewedAt: wf.keyPoseReview.reviewedAt,
      },
      selfReview: {
        previewId: wf.selfReview.previewId,
        revision: wf.selfReview.revision,
        reviewerId: wf.selfReview.reviewerId,
        temporalHash: wf.selfReview.temporalHash,
        reviewedAt: wf.selfReview.reviewedAt,
      },
      qa: {
        reviewerId: latestQa.reviewerId,
        authorId: latestQa.authorId,
        previewId: latestQa.previewId,
        revision: latestQa.revision,
        result: latestQa.result,
        submittedAt: latestQa.submittedAt,
      },
    };
  }
}
