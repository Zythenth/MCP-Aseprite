import { describe, expect, it } from "vitest";
import { buildDirectionalActionPlan, evaluateMirrorability } from "../../src/mcp/directionalActions.js";

describe("directional action planning", () => {
  it("produces all eight walk directions with contact choreography and QA", () => {
    const plan = buildDirectionalActionPlan({ action: "walk", directions: 8, frames: 8, fps: 12, stridePx: 4, style: "compact RPG" });
    expect(plan.tags.map((tag) => tag.name)).toEqual(["walk_n", "walk_ne", "walk_e", "walk_se", "walk_s", "walk_sw", "walk_w", "walk_nw"]);
    expect(plan.frameDurationMs).toBe(83);
    expect(plan.poseSequence).toContain("left contact");
    expect(plan.poseSequence).toContain("right contact");
    expect(plan.qaChecks).toContain("foot sliding");
  });

  it("requires action-specific phases and exposes engine events", () => {
    expect(() => buildDirectionalActionPlan({ action: "attack", directions: 4, frames: 4, fps: 12, stridePx: 0, style: "hero" })).toThrow(/attackKind/);
    const cast = buildDirectionalActionPlan({ action: "cast", directions: 4, frames: 4, fps: 12, stridePx: 0, style: "hero" });
    expect(cast.events.map((event) => event.name)).toEqual(["cast_start", "effect_spawn", "cast_end"]);
    const death = buildDirectionalActionPlan({ action: "death", directions: 4, frames: 3, fps: 8, stridePx: 0, style: "hero", deathStyle: "forward" });
    expect(death.events).toEqual([{ name: "final_pose", frameOffset: 2, payload: "persistent" }]);
    const hit = buildDirectionalActionPlan({ action: "hit", directions: 4, frames: 3, fps: 10, stridePx: 0, style: "hero", hitForcePx: 3, damageType: "fire" });
    expect(hit.poseSequence).toContain("impact (fire)");
    expect(hit.qaChecks).toContain("recoil must not exceed configured 3px force");
  });

  it("covers every supported requested action with a bounded plan", () => {
    const inputs = [
      { action: "run", directions: 4, frames: 3, fps: 16, stridePx: 5, style: "hero" },
      { action: "idle", directions: 4, frames: 2, fps: 6, stridePx: 0, style: "hero" },
      { action: "hit", directions: 4, frames: 3, fps: 10, stridePx: 1, style: "hero" },
      { action: "dash", directions: 4, frames: 4, fps: 20, stridePx: 8, style: "hero" },
      { action: "interaction", directions: 4, frames: 3, fps: 10, stridePx: 0, style: "hero", interactionKind: "pickup", targetHeightPx: 0, targetOffsetX: 2, targetOffsetY: 1 },
      { action: "attack", directions: 4, frames: 4, fps: 12, stridePx: 0, style: "hero", attackKind: "melee" },
      { action: "attack", directions: 4, frames: 4, fps: 12, stridePx: 0, style: "hero", attackKind: "ranged" },
    ] as const;
    for (const input of inputs) {
      const plan = buildDirectionalActionPlan(input);
      expect(plan.tags).toHaveLength(4);
      expect(plan.poseSequence).toHaveLength(input.frames);
      expect(plan.qaChecks.length).toBeGreaterThan(1);
    }
  });

  it("does not declare semantically asymmetric art safe to mirror", () => {
    expect(evaluateMirrorability({ hasHandedWeapon: true }).mirrorable).toBe(false);
    expect(evaluateMirrorability({ hasReadableText: true }).blockingReasons[0]).toMatch(/text/i);
    expect(evaluateMirrorability({}).mirrorable).toBe(true);
  });
});
