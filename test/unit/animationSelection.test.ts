import { describe, expect, it } from "vitest";
import {
  buildPlaybackFrameNumbers,
  resolveAnimationPlayback,
  type AnimationInspection,
} from "../../src/mcp/animationSelection.js";

const inspection: AnimationInspection = {
  width: 16,
  height: 24,
  colorMode: "rgb",
  frames: [
    { frameNumber: 1, durationMs: 100, celCount: 1 },
    { frameNumber: 2, durationMs: 150, celCount: 1 },
    { frameNumber: 3, durationMs: 100, celCount: 1 },
    { frameNumber: 4, durationMs: 50, celCount: 1 },
  ],
  tags: [
    { name: "walk", from: 1, to: 4, direction: "pingpong", repeats: 0 },
    { name: "attack", from: 2, to: 4, direction: "forward", repeats: 1 },
    { name: "hop-once", from: 1, to: 4, direction: "pingpong", repeats: 1 },
    { name: "hop-twice", from: 1, to: 4, direction: "pingpong", repeats: 2 },
  ],
  layers: [],
};

describe("animation playback selection", () => {
  it("builds every Aseprite playback direction without duplicating endpoints in ping-pong tails", () => {
    expect(buildPlaybackFrameNumbers(1, 4, "forward")).toEqual([1, 2, 3, 4]);
    expect(buildPlaybackFrameNumbers(1, 4, "reverse")).toEqual([4, 3, 2, 1]);
    expect(buildPlaybackFrameNumbers(1, 4, "pingpong")).toEqual([1, 2, 3, 4, 3, 2]);
    expect(buildPlaybackFrameNumbers(1, 4, "pingpong_reverse")).toEqual([4, 3, 2, 1, 2, 3]);
  });

  it("resolves tag timing, continuous looping, repeated playback frames, and average FPS", () => {
    const playback = resolveAnimationPlayback(inspection, { tagName: "walk" });
    expect(playback.frameNumbers).toEqual([1, 2, 3, 4, 3, 2]);
    expect(playback.frames.map((frame) => frame.durationMs)).toEqual([100, 150, 100, 50, 100, 150]);
    expect(playback.totalDurationMs).toBe(650);
    expect(playback.averageFps).toBeCloseTo(6000 / 650);
    expect(playback.variableTiming).toBe(true);
    expect(playback.loopsContinuously).toBe(true);
  });

  it("allows a deliberate direction override without changing the stored tag", () => {
    const playback = resolveAnimationPlayback(inspection, { tagName: "attack", direction: "reverse" });
    expect(playback.frameNumbers).toEqual([4, 3, 2]);
    expect(playback.direction).toBe("reverse");
    expect(playback.repeats).toBe(1);
    expect(playback.loopsContinuously).toBe(false);
  });

  it("honors Aseprite finite ping-pong repeat semantics without duplicating turnaround frames", () => {
    expect(resolveAnimationPlayback(inspection, { tagName: "hop-once" }).frameNumbers).toEqual([1, 2, 3, 4]);
    expect(resolveAnimationPlayback(inspection, { tagName: "hop-twice" }).frameNumbers).toEqual([1, 2, 3, 4, 3, 2, 1]);
  });

  it("rejects ambiguous selectors, missing tags, and invalid ranges", () => {
    expect(() => resolveAnimationPlayback(inspection, { tagName: "walk", fromFrame: 1, toFrame: 2 })).toThrow(/mutually exclusive/i);
    expect(() => resolveAnimationPlayback(inspection, { fromFrame: 1 })).toThrow(/provided together/i);
    expect(() => resolveAnimationPlayback(inspection, { tagName: "missing" })).toThrow(/not found/i);
    expect(() => resolveAnimationPlayback(inspection, { fromFrame: 3, toFrame: 8 })).toThrow(/frame range/i);
  });
});
