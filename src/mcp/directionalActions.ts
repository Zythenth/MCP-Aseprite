export const CARDINAL_DIRECTIONS = ["N", "E", "S", "W"] as const;
export const OCTANT_DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

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
  tags: Array<{ direction: FacingDirection; name: string; frameCount: number }>;
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

function clampFrameOffset(frame: number, frames: number): number {
  return Math.max(0, Math.min(frames - 1, frame));
}

function phaseAt(index: number, frames: number, phases: string[]): string {
  const phaseIndex = Math.min(phases.length - 1, Math.floor(index * phases.length / frames));
  return phases[phaseIndex];
}

function requiredMinimumFrames(action: DirectionalAction): number {
  switch (action) {
    case "walk": return 4;
    case "run": return 3;
    case "idle": return 2;
    case "attack": return 4;
    case "hit": return 3;
    case "death": return 3;
    case "dash": return 4;
    case "cast": return 4;
    case "interaction": return 3;
  }
}

function posesFor(input: DirectionalActionInput): string[] {
  const phases = input.action === "walk"
    ? ["left contact", "down", "passing", "up", "right contact", "down", "passing", "up"]
    : input.action === "run"
      ? ["rear contact", "compression", "flight", "front contact", "flight"]
      : input.action === "idle"
        ? ["neutral", "inhale / lift", "settle", "exhale / return"]
        : input.action === "attack"
          ? ["anticipation", "attack", input.attackKind === "ranged" ? "release / shot" : "impact", "recovery"]
          : input.action === "hit"
            ? ["neutral", `impact${input.damageType ? ` (${input.damageType})` : ""}`, `recoil${input.hitForcePx !== undefined ? ` up to ${input.hitForcePx}px` : ""}`, "recovery"]
            : input.action === "death"
              ? ["impact / loss of balance", "fall or breakup", "final persistent pose"]
              : input.action === "dash"
                ? ["minimum preparation", "acceleration", "fast travel / smear", "recovery"]
                : input.action === "cast"
                  ? ["cast start", "channel", "effect release", "cast end / recovery"]
                  : ["approach", `interaction contact at (${input.targetOffsetX}, ${input.targetOffsetY}), height ${input.targetHeightPx}`, "return"];
  return Array.from({ length: input.frames }, (_, index) => phaseAt(index, input.frames, phases));
}

function eventsFor(input: DirectionalActionInput): DirectionalEvent[] {
  const last = input.frames - 1;
  switch (input.action) {
    case "attack":
      return [{ name: input.attackKind === "ranged" ? "shot" : "impact", frameOffset: clampFrameOffset(Math.floor(input.frames / 2), input.frames) }];
    case "death":
      return [{ name: "final_pose", frameOffset: last, payload: "persistent" }];
    case "dash":
      return [
        { name: "dash_start", frameOffset: 1 },
        { name: "dash_peak", frameOffset: clampFrameOffset(Math.floor(input.frames / 2), input.frames) },
        { name: "dash_end", frameOffset: last },
      ];
    case "cast":
      return [
        { name: "cast_start", frameOffset: 0 },
        { name: "effect_spawn", frameOffset: clampFrameOffset(Math.floor(input.frames / 2), input.frames) },
        { name: "cast_end", frameOffset: last },
      ];
    case "interaction":
      return [{
        name: "interaction_contact",
        frameOffset: clampFrameOffset(Math.floor(input.frames / 2), input.frames),
        payload: `${input.interactionKind}:x=${input.targetOffsetX},y=${input.targetOffsetY},height=${input.targetHeightPx}`,
      }];
    default:
      return [];
  }
}

function qaChecksFor(input: DirectionalActionInput): string[] {
  const common = ["consistent silhouette, volume, palette, lighting, origin, and frame timing across directions"];
  switch (input.action) {
    case "walk": return [...common, "grounded foot contact", "alternating arms and legs", "vertical bob", "foot sliding", "loop seam"];
    case "run": return [...common, "grounded foot contact", "shorter contact phase than walk", "greater stride and faster timing than walk", "forward lean", "flight spacing"];
    case "idle": return [...common, "breathing or secondary-motion amplitude", "no unintended hopping", "loop seam"];
    case "attack": return [...common, "anticipation → attack → impact/release → recovery", "event frame", "weapon or projectile consistency"];
    case "hit": return [...common, "brief displacement", "silhouette preservation", "recovery to neutral", input.hitForcePx === undefined ? "declare a maximum recoil distance before visual QA" : `recoil must not exceed configured ${input.hitForcePx}px force`];
    case "death": return [...common, "clear fall/destruction arc", "persistent final pose", "no post-death jitter"];
    case "dash": return [...common, "minimal preparation", "acceleration and recovery", "speed readability", "no permanent deformation"];
    case "cast": return [...common, "preparation, channel, release, recovery", "cast event timing", "effect separation"];
    case "interaction": return [...common, "target reach relative to configured target height and offset", "contact frame", "return or hold"];
  }
}

export function directionsFor(count: DirectionCount): FacingDirection[] {
  return [...(count === 4 ? CARDINAL_DIRECTIONS : OCTANT_DIRECTIONS)];
}

export function buildDirectionalActionPlan(input: DirectionalActionInput): DirectionalActionPlan {
  if (!Number.isInteger(input.frames) || input.frames < requiredMinimumFrames(input.action) || input.frames > 24) {
    throw new Error(`${input.action} requires ${requiredMinimumFrames(input.action)} to 24 frames per direction.`);
  }
  if (!Number.isInteger(input.fps) || input.fps < 1 || input.fps > 60) throw new Error("fps must be an integer from 1 through 60.");
  if (!Number.isInteger(input.stridePx) || input.stridePx < 0 || input.stridePx > 64) throw new Error("stridePx must be an integer from 0 through 64.");
  if (!input.style.trim()) throw new Error("style must be non-empty.");
  if (input.action === "attack" && !input.attackKind) throw new Error("attackKind is required for attack actions.");
  if (input.hitForcePx !== undefined && (!Number.isInteger(input.hitForcePx) || input.hitForcePx < 0 || input.hitForcePx > 64)) {
    throw new Error("hitForcePx must be an integer from 0 through 64 when supplied.");
  }
  if (input.damageType !== undefined && !input.damageType.trim()) throw new Error("damageType must be non-empty when supplied.");
  if (input.action === "death" && !input.deathStyle) throw new Error("deathStyle is required for death actions.");
  if (input.action === "interaction" && !input.interactionKind) throw new Error("interactionKind is required for interaction actions.");
  if (input.action === "interaction" && (!Number.isInteger(input.targetHeightPx) || !Number.isInteger(input.targetOffsetX) || !Number.isInteger(input.targetOffsetY))) {
    throw new Error("interaction requires integer targetHeightPx, targetOffsetX, and targetOffsetY.");
  }

  const prefix = input.tagPrefix?.trim() || input.action;
  const dirs = directionsFor(input.directions);
  const frameDurationMs = Math.max(1, Math.round(1000 / input.fps));
  return {
    action: input.action,
    directions: dirs,
    framesPerDirection: input.frames,
    fps: input.fps,
    frameDurationMs,
    stridePx: input.stridePx,
    style: input.style.trim(),
    tags: dirs.map((direction) => ({ direction, name: `${prefix}_${direction.toLowerCase()}`, frameCount: input.frames })),
    poseSequence: posesFor(input),
    events: eventsFor(input),
    qaChecks: qaChecksFor(input),
    manualChecks: [
      "Inspect every frame at native resolution and in playback before accepting the action.",
      "Record exact foot-contact coordinates before relying on automated foot-sliding analysis.",
      "Review directional anatomy, weapon handedness, readable text, scars, and asymmetric lighting visually; pixels alone cannot assign their semantic meaning.",
    ],
  };
}

export function evaluateMirrorability(input: MirrorRiskAssessment): MirrorDecision {
  const blockingReasons: string[] = [];
  if (input.declaredNonMirrorable) blockingReasons.push("The asset was explicitly declared non-mirrorable.");
  if (input.hasHandedWeapon) blockingReasons.push("A handed weapon or attack stance would swap sides.");
  if (input.hasReadableText) blockingReasons.push("Readable text would become reversed.");
  if (input.hasAsymmetricScars) blockingReasons.push("Asymmetric scars or markings would move to the wrong side.");
  if (input.hasAsymmetricLighting) blockingReasons.push("Asymmetric lighting would reverse its intended direction.");
  if (input.hasAsymmetricEquipment) blockingReasons.push("Asymmetric equipment would move to the wrong side.");
  return { mirrorable: blockingReasons.length === 0, blockingReasons, requiredVisualReview: true };
}
