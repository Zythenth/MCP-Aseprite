export declare const CARDINAL_DIRECTIONS: readonly ["N", "E", "S", "W"];
export declare const OCTANT_DIRECTIONS: readonly ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export type FacingDirection = (typeof OCTANT_DIRECTIONS)[number];
export type DirectionCount = 4 | 8;
export type DirectionalAction = "walk" | "run" | "idle" | "attack" | "hit" | "death" | "dash" | "cast" | "interaction";
export type AttackKind = "melee" | "ranged";
export interface DirectionalActionInput {
    action: DirectionalAction;
    directions: DirectionCount;
    frames: number;
    fps: number;
    stridePx: number;
    style: string;
    tagPrefix?: string;
    attackKind?: AttackKind;
    hitForcePx?: number;
    damageType?: string;
    deathStyle?: "forward" | "backward" | "disintegrate" | "mechanical_explosion";
    interactionKind?: "pickup" | "open" | "press" | "mine" | "cut" | "terminal" | "talk";
    targetHeightPx?: number;
    targetOffsetX?: number;
    targetOffsetY?: number;
}
export interface DirectionalEvent {
    name: string;
    frameOffset: number;
    payload?: string;
}
export interface DirectionalActionPlan {
    action: DirectionalAction;
    directions: FacingDirection[];
    framesPerDirection: number;
    fps: number;
    frameDurationMs: number;
    stridePx: number;
    style: string;
    tags: Array<{
        direction: FacingDirection;
        name: string;
        frameCount: number;
    }>;
    poseSequence: string[];
    events: DirectionalEvent[];
    qaChecks: string[];
    manualChecks: string[];
}
export interface MirrorRiskAssessment {
    hasHandedWeapon?: boolean;
    hasReadableText?: boolean;
    hasAsymmetricScars?: boolean;
    hasAsymmetricLighting?: boolean;
    hasAsymmetricEquipment?: boolean;
    declaredNonMirrorable?: boolean;
}
export interface MirrorDecision {
    mirrorable: boolean;
    blockingReasons: string[];
    requiredVisualReview: true;
}
export declare function directionsFor(count: DirectionCount): FacingDirection[];
export declare function buildDirectionalActionPlan(input: DirectionalActionInput): DirectionalActionPlan;
export declare function evaluateMirrorability(input: MirrorRiskAssessment): MirrorDecision;
//# sourceMappingURL=directionalActions.d.ts.map