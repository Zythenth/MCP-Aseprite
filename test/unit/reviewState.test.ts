import { describe, expect, it } from "vitest";
import { ReviewState } from "../../src/mcp/reviewState.js";

describe("ReviewState", () => {
  it("stores immutable visual checkpoints without exposing image bytes in listings", () => {
    const state = new ReviewState();
    const source = new Uint8Array([1, 2, 3, 255]);
    const checkpoint = state.addCheckpoint({
      label: "silhouette accepted",
      sessionId: "session-a",
      revision: 7,
      frameNumber: 1,
      image: { width: 1, height: 1, data: source },
    });
    source[0] = 99;

    expect(state.getCheckpoint(checkpoint.id)?.image.data[0]).toBe(1);
    expect(state.listCheckpoints("session-a")).toEqual([expect.objectContaining({
      id: checkpoint.id,
      label: "silhouette accepted",
      width: 1,
      height: 1,
    })]);
    expect(state.listCheckpoints("session-b")).toEqual([]);
  });

  it("suppresses only findings that match the session and waiver scope", () => {
    const state = new ReviewState();
    const scoped = state.addWaiver({
      rule: "orphan_pixel",
      reason: "intentional sparkle",
      sessionId: "session-a",
      frameNumber: 2,
      x: 4,
      y: 5,
    });
    const findings = [
      { rule: "orphan_pixel" as const, severity: "info" as const, confidence: "medium" as const, message: "one", x: 4, y: 5 },
      { rule: "orphan_pixel" as const, severity: "info" as const, confidence: "medium" as const, message: "two", x: 8, y: 5 },
    ];

    const result = state.applyWaivers(findings, { sessionId: "session-a", frameNumber: 2 });
    expect(result.findings).toEqual([findings[1]]);
    expect(result.suppressed).toEqual([{ finding: findings[0], waiverId: scoped.id }]);
    expect(state.applyWaivers(findings, { sessionId: "session-b", frameNumber: 2 }).findings).toHaveLength(2);
  });

  it("deletes checkpoints and waivers by opaque id", () => {
    const state = new ReviewState();
    const checkpoint = state.addCheckpoint({
      label: "x", sessionId: "s", revision: 1, frameNumber: 1,
      image: { width: 1, height: 1, data: new Uint8Array(4) },
    });
    const waiver = state.addWaiver({ rule: "tile_seam", reason: "not a tile", sessionId: "s" });
    expect(state.deleteCheckpoint(checkpoint.id)).toBe(true);
    expect(state.deleteWaiver(waiver.id)).toBe(true);
    expect(state.listCheckpoints()).toEqual([]);
    expect(state.listWaivers()).toEqual([]);
  });
});
