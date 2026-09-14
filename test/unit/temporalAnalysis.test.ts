import { describe, expect, it } from "vitest";
import type { ImageBuffer } from "../../src/image/png.js";
import {
  ALL_TEMPORAL_RULES,
  analyzeAnimationTemporalPure,
  computeCanonicalTemporalHash,
  MAX_ANALYSIS_FRAMES,
  MAX_FINDINGS_LIMIT,
} from "../../src/image/temporalAnalysis.js";

function createSolidFrame(width: number, height: number, color: [number, number, number, number]): ImageBuffer {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = color[0];
    data[i * 4 + 1] = color[1];
    data[i * 4 + 2] = color[2];
    data[i * 4 + 3] = color[3];
  }
  return { width, height, data };
}

function setPixel(frame: ImageBuffer, x: number, y: number, color: [number, number, number, number]): void {
  const idx = (y * frame.width + x) * 4;
  frame.data[idx] = color[0];
  frame.data[idx + 1] = color[1];
  frame.data[idx + 2] = color[2];
  frame.data[idx + 3] = color[3];
}

describe("Pure Temporal Analysis Module", () => {
  describe("computeCanonicalTemporalHash", () => {
    it("is strictly deterministic across identical frames and durations", () => {
      const f1 = createSolidFrame(4, 4, [255, 0, 0, 255]);
      const f2 = createSolidFrame(4, 4, [0, 255, 0, 255]);

      const hash1 = computeCanonicalTemporalHash(4, 4, [1, 2], [100, 100], [f1, f2]);
      const hash2 = computeCanonicalTemporalHash(4, 4, [1, 2], [100, 100], [f1, f2]);
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    });

    it("changes when frame sequence, durations, or single pixel values change", () => {
      const f1 = createSolidFrame(4, 4, [255, 0, 0, 255]);
      const f2 = createSolidFrame(4, 4, [0, 255, 0, 255]);
      const baseHash = computeCanonicalTemporalHash(4, 4, [1, 2], [100, 100], [f1, f2]);

      // Sequence changed
      const seqHash = computeCanonicalTemporalHash(4, 4, [2, 1], [100, 100], [f2, f1]);
      expect(seqHash).not.toBe(baseHash);

      // Duration changed
      const durHash = computeCanonicalTemporalHash(4, 4, [1, 2], [100, 200], [f1, f2]);
      expect(durHash).not.toBe(baseHash);

      // Pixel modified
      const f2Modified = createSolidFrame(4, 4, [0, 255, 0, 255]);
      setPixel(f2Modified, 0, 0, [0, 254, 0, 255]);
      const pixelHash = computeCanonicalTemporalHash(4, 4, [1, 2], [100, 100], [f1, f2Modified]);
      expect(pixelHash).not.toBe(baseHash);
    });

    it("distinguishes different dimensions with identical raw byte buffers without collision", () => {
      // 2x8 has 16 pixels = 64 bytes
      const frame2x8 = createSolidFrame(2, 8, [100, 150, 200, 255]);
      // 4x4 has 16 pixels = 64 bytes with exact same byte contents
      const frame4x4 = {
        width: 4,
        height: 4,
        data: new Uint8Array(frame2x8.data),
      };

      const hash2x8 = computeCanonicalTemporalHash(2, 8, [1], [100], [frame2x8]);
      const hash4x4 = computeCanonicalTemporalHash(4, 4, [1], [100], [frame4x4]);

      expect(hash2x8).not.toBe(hash4x4);
    });

    it("strictly requires byteLength === width * height * 4 in computeCanonicalTemporalHash", () => {
      const invalidFrame = {
        width: 4,
        height: 4,
        data: new Uint8Array(4 * 4 * 4 - 1),
      };
      expect(() => computeCanonicalTemporalHash(4, 4, [1], [100], [invalidFrame])).toThrow(/byteLength/i);
    });
  });

  describe("Metrics & Findings Rules", () => {
    it("detects unexpected duplicate frames between adjacent steps", () => {
      const f1 = createSolidFrame(8, 8, [20, 20, 20, 255]);
      const f2 = createSolidFrame(8, 8, [20, 20, 20, 255]); // exact duplicate
      const f3 = createSolidFrame(8, 8, [40, 40, 40, 255]);

      const result = analyzeAnimationTemporalPure({
        width: 8,
        height: 8,
        playback: {
          frameNumbers: [1, 2, 3],
          frames: [
            { frameNumber: 1, durationMs: 100, sequenceIndex: 1 },
            { frameNumber: 2, durationMs: 100, sequenceIndex: 2 },
            { frameNumber: 3, durationMs: 100, sequenceIndex: 3 },
          ],
          loopsContinuously: false,
          totalDurationMs: 300,
          averageFps: 10,
        },
        frameBuffers: [f1, f2, f3],
      });

      const dupFinding = result.findings.find((f) => f.ruleId === "unexpected_duplicate_frame");
      expect(dupFinding).toBeDefined();
      expect(dupFinding!.affectedFrames).toEqual([1, 2]);
      expect(dupFinding!.severity).toBe("warning");
      expect(dupFinding!.confidence).toBe("high");
      expect(dupFinding!.method).toContain("RGBA buffer");
      expect(dupFinding!.limitation).toBeDefined();
    });

    it("measures adjacent pixel diffs and changed bounds", () => {
      const f1 = createSolidFrame(10, 10, [0, 0, 0, 0]);
      const f2 = createSolidFrame(10, 10, [0, 0, 0, 0]);
      // draw a 4x4 box in f2 at (2, 3)
      for (let y = 3; y < 7; y++) {
        for (let x = 2; x < 6; x++) {
          setPixel(f2, x, y, [255, 0, 0, 255]);
        }
      }

      const result = analyzeAnimationTemporalPure({
        width: 10,
        height: 10,
        playback: {
          frameNumbers: [1, 2],
          frames: [
            { frameNumber: 1, durationMs: 100, sequenceIndex: 1 },
            { frameNumber: 2, durationMs: 100, sequenceIndex: 2 },
          ],
          loopsContinuously: false,
          totalDurationMs: 200,
          averageFps: 10,
        },
        frameBuffers: [f1, f2],
      });

      expect(result.metrics.pairwiseDifferences).toHaveLength(1);
      const pair = result.metrics.pairwiseDifferences[0];
      expect(pair.changedPixels).toBe(16);
      expect(pair.changeRatio).toBe(0.16);
      expect(pair.changedBounds).toEqual({ x: 2, y: 3, width: 4, height: 4 });
    });

    it("detects visual center jumps", () => {
      const f1 = createSolidFrame(32, 32, [0, 0, 0, 0]);
      const f2 = createSolidFrame(32, 32, [0, 0, 0, 0]);
      // mass at top-left
      setPixel(f1, 2, 2, [255, 255, 255, 255]);
      setPixel(f1, 3, 2, [255, 255, 255, 255]);
      // mass teleports to bottom-right
      setPixel(f2, 28, 28, [255, 255, 255, 255]);
      setPixel(f2, 29, 28, [255, 255, 255, 255]);

      const result = analyzeAnimationTemporalPure({
        width: 32,
        height: 32,
        playback: {
          frameNumbers: [1, 2],
          frames: [
            { frameNumber: 1, durationMs: 100, sequenceIndex: 1 },
            { frameNumber: 2, durationMs: 100, sequenceIndex: 2 },
          ],
          loopsContinuously: false,
          totalDurationMs: 200,
          averageFps: 10,
        },
        frameBuffers: [f1, f2],
        thresholds: { maxCenterShift: 10 },
      });

      const jumpFinding = result.findings.find((f) => f.ruleId === "visual_center_jump");
      expect(jumpFinding).toBeDefined();
      expect(jumpFinding!.affectedFrames).toEqual([1, 2]);
      expect(jumpFinding!.severity).toBe("warning");
    });

    it("detects sudden occupied area spikes and collapses", () => {
      const f1 = createSolidFrame(20, 20, [0, 0, 0, 0]);
      const f2 = createSolidFrame(20, 20, [0, 0, 0, 0]);
      // f1 has 10 pixels
      for (let i = 0; i < 10; i++) setPixel(f1, i, 0, [255, 0, 0, 255]);
      // f2 explodes to 100 pixels
      for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) setPixel(f2, x, y, [255, 0, 0, 255]);
      }

      const result = analyzeAnimationTemporalPure({
        width: 20,
        height: 20,
        playback: {
          frameNumbers: [1, 2],
          frames: [
            { frameNumber: 1, durationMs: 100, sequenceIndex: 1 },
            { frameNumber: 2, durationMs: 100, sequenceIndex: 2 },
          ],
          loopsContinuously: false,
          totalDurationMs: 200,
          averageFps: 10,
        },
        frameBuffers: [f1, f2],
        thresholds: { maxAreaChangeRatio: 0.50 },
      });

      const areaFinding = result.findings.find((f) => f.ruleId === "occupied_area_spike");
      expect(areaFinding).toBeDefined();
      expect(areaFinding!.affectedFrames).toEqual([1, 2]);
    });

    it("detects isolated 1-pixel flicker with spatial isolation", () => {
      const f1 = createSolidFrame(16, 16, [0, 0, 0, 255]);
      const f2 = createSolidFrame(16, 16, [0, 0, 0, 255]);
      const f3 = createSolidFrame(16, 16, [0, 0, 0, 255]);

      // Single pixel flickers only on frame 2 at (7, 7)
      setPixel(f2, 7, 7, [255, 255, 255, 255]);

      const result = analyzeAnimationTemporalPure({
        width: 16,
        height: 16,
        playback: {
          frameNumbers: [1, 2, 3],
          frames: [
            { frameNumber: 1, durationMs: 100, sequenceIndex: 1 },
            { frameNumber: 2, durationMs: 100, sequenceIndex: 2 },
            { frameNumber: 3, durationMs: 100, sequenceIndex: 3 },
          ],
          loopsContinuously: false,
          totalDurationMs: 300,
          averageFps: 10,
        },
        frameBuffers: [f1, f2, f3],
      });

      const flickerFinding = result.findings.find((f) => f.ruleId === "isolated_pixel_flicker");
      expect(flickerFinding).toBeDefined();
      expect(flickerFinding!.affectedFrames).toEqual([1, 2, 3]);
      expect(flickerFinding!.observedMetrics).toMatchObject({
        frameNumber: 2,
        x: 7,
        y: 7,
      });
    });

    it("evaluates marked rigid regions stability", () => {
      const f1 = createSolidFrame(16, 16, [0, 0, 0, 0]);
      const f2 = createSolidFrame(16, 16, [0, 0, 0, 0]);

      // Rigid region at [2, 2, 4, 4]
      for (let y = 2; y < 6; y++) {
        for (let x = 2; x < 6; x++) {
          setPixel(f1, x, y, [100, 100, 100, 255]);
          setPixel(f2, x, y, [100, 100, 100, 255]);
        }
      }
      // Mutate 1 pixel inside the rigid region on f2
      setPixel(f2, 3, 3, [200, 50, 50, 255]);

      const result = analyzeAnimationTemporalPure({
        width: 16,
        height: 16,
        playback: {
          frameNumbers: [1, 2],
          frames: [
            { frameNumber: 1, durationMs: 100, sequenceIndex: 1 },
            { frameNumber: 2, durationMs: 100, sequenceIndex: 2 },
          ],
          loopsContinuously: false,
          totalDurationMs: 200,
          averageFps: 10,
        },
        frameBuffers: [f1, f2],
        rigidRegions: [{ id: "shield", x: 2, y: 2, width: 4, height: 4 }],
        thresholds: { rigidTolerance: 0.0 },
      });

      const rigidFinding = result.findings.find((f) => f.ruleId === "rigid_region_instability");
      expect(rigidFinding).toBeDefined();
      expect(rigidFinding!.affectedFrames).toEqual([1, 2]);
      expect(rigidFinding!.observedMetrics).toMatchObject({
        regionId: "shield",
        diffPixels: 1,
      });
    });

    it("detects contact point displacement when distance exceeds threshold", () => {
      const f1 = createSolidFrame(16, 16, [0, 0, 0, 0]);
      const f2 = createSolidFrame(16, 16, [0, 0, 0, 0]);

      const result = analyzeAnimationTemporalPure({
        width: 16,
        height: 16,
        playback: {
          frameNumbers: [1, 2],
          frames: [
            { frameNumber: 1, durationMs: 100, sequenceIndex: 1 },
            { frameNumber: 2, durationMs: 100, sequenceIndex: 2 },
          ],
          loopsContinuously: false,
          totalDurationMs: 200,
          averageFps: 10,
        },
        frameBuffers: [f1, f2],
        contactPoints: [
          {
            id: "left_heel",
            positions: [
              { frameNumber: 1, x: 8, y: 15 },
              { frameNumber: 2, x: 8, y: 12 },
            ],
          },
        ],
      });

      const contactFinding = result.findings.find((f) => f.ruleId === "contact_point_displacement");
      expect(contactFinding).toBeDefined();
      expect(contactFinding!.affectedFrames).toEqual([1, 2]);
      expect(contactFinding!.observedMetrics).toMatchObject({
        pointId: "left_heel",
        fromFrame: 1,
        toFrame: 2,
        dx: 0,
        dy: -3,
        distance: 3,
        threshold: 0,
      });
    });

    it("detects loop seam duplicates and loop discontinuity", () => {
      const f1 = createSolidFrame(8, 8, [50, 50, 50, 255]);
      const f2 = createSolidFrame(8, 8, [100, 100, 100, 255]);
      const f3 = createSolidFrame(8, 8, [50, 50, 50, 255]); // exact duplicate of f1 at seam

      const result = analyzeAnimationTemporalPure({
        width: 8,
        height: 8,
        playback: {
          frameNumbers: [1, 2, 3],
          frames: [
            { frameNumber: 1, durationMs: 100, sequenceIndex: 1 },
            { frameNumber: 2, durationMs: 100, sequenceIndex: 2 },
            { frameNumber: 3, durationMs: 100, sequenceIndex: 3 },
          ],
          loopsContinuously: true,
          totalDurationMs: 300,
          averageFps: 10,
        },
        frameBuffers: [f1, f2, f3],
      });

      const loopSeamDup = result.findings.find((f) => f.id.includes("temporal-loop-duplicate-seam"));
      expect(loopSeamDup).toBeDefined();
      expect(loopSeamDup!.affectedFrames).toEqual([1, 3]);
    });

    it("detects duration anomalies (zero duration or extreme outliers)", () => {
      const f1 = createSolidFrame(4, 4, [10, 10, 10, 255]);
      const f2 = createSolidFrame(4, 4, [20, 20, 20, 255]);
      const f3 = createSolidFrame(4, 4, [30, 30, 30, 255]);

      const result = analyzeAnimationTemporalPure({
        width: 4,
        height: 4,
        playback: {
          frameNumbers: [1, 2, 3],
          frames: [
            { frameNumber: 1, durationMs: 100, sequenceIndex: 1 },
            { frameNumber: 2, durationMs: 0, sequenceIndex: 2 }, // 0ms duration!
            { frameNumber: 3, durationMs: 800, sequenceIndex: 3 }, // outlier!
          ],
          loopsContinuously: false,
          totalDurationMs: 900,
          averageFps: 3.3,
        },
        frameBuffers: [f1, f2, f3],
      });

      const zeroDur = result.findings.find((f) => f.id.includes("temporal-duration-zero"));
      expect(zeroDur).toBeDefined();
      expect(zeroDur!.affectedFrames).toEqual([2]);

      const outlierDur = result.findings.find((f) => f.id.includes("temporal-duration-outlier"));
      expect(outlierDur).toBeDefined();
      expect(outlierDur!.affectedFrames).toEqual([3]);
    });

    it("detects anomalous cel position jumps from inspection layers", () => {
      const f1 = createSolidFrame(32, 32, [0, 0, 0, 0]);
      const f2 = createSolidFrame(32, 32, [0, 0, 0, 0]);

      const inspectionLayers = [
        {
          name: "Weapon",
          path: "Weapon",
          isVisible: true,
          opacity: 255,
          isGroup: false,
          isImage: true,
          isTilemap: false,
          celCount: 2,
          celFrames: [1, 2],
          cels: [
            { frameNumber: 1, x: 2, y: 4, bounds: { x: 2, y: 4, width: 8, height: 8 }, position: { x: 2, y: 4 } },
            { frameNumber: 2, x: 28, y: 26, bounds: { x: 28, y: 26, width: 8, height: 8 }, position: { x: 28, y: 26 } },
          ],
        },
      ];

      const result = analyzeAnimationTemporalPure({
        width: 32,
        height: 32,
        playback: {
          frameNumbers: [1, 2],
          frames: [
            { frameNumber: 1, durationMs: 100, sequenceIndex: 1 },
            { frameNumber: 2, durationMs: 100, sequenceIndex: 2 },
          ],
          loopsContinuously: false,
          totalDurationMs: 200,
          averageFps: 10,
        },
        frameBuffers: [f1, f2],
        inspectionLayers,
        thresholds: { maxCelPositionJump: 10 },
      });

      const celJumpFinding = result.findings.find((f) => f.ruleId === "anomalous_cel_position_jump");
      expect(celJumpFinding).toBeDefined();
      expect(celJumpFinding!.affectedFrames).toEqual([1, 2]);
      expect(celJumpFinding!.observedMetrics).toMatchObject({
        layerName: "Weapon",
        posA: { x: 2, y: 4 },
        posB: { x: 28, y: 26 },
      });
    });

    it("detects palette variation when a single frame introduces exclusive colors", () => {
      const f1 = createSolidFrame(10, 10, [0, 0, 0, 255]);
      const f2 = createSolidFrame(10, 10, [0, 0, 0, 255]);
      const f3 = createSolidFrame(10, 10, [0, 0, 0, 255]);

      // Frame 2 has 6 exclusive colors
      for (let i = 0; i < 6; i++) {
        setPixel(f2, i, 0, [i * 30 + 10, 100, 200, 255]);
      }

      const result = analyzeAnimationTemporalPure({
        width: 10,
        height: 10,
        playback: {
          frameNumbers: [1, 2, 3],
          frames: [
            { frameNumber: 1, durationMs: 100, sequenceIndex: 1 },
            { frameNumber: 2, durationMs: 100, sequenceIndex: 2 },
            { frameNumber: 3, durationMs: 100, sequenceIndex: 3 },
          ],
          loopsContinuously: false,
          totalDurationMs: 300,
          averageFps: 10,
        },
        frameBuffers: [f1, f2, f3],
      });

      const palFinding = result.findings.find((f) => f.ruleId === "palette_variation");
      expect(palFinding).toBeDefined();
      expect(palFinding!.affectedFrames).toEqual([2]);
      expect(palFinding!.severity).toBe("info");
    });

    it("detects bounds change spike when content bounding box expands drastically", () => {
      const f1 = createSolidFrame(32, 32, [0, 0, 0, 0]);
      const f2 = createSolidFrame(32, 32, [0, 0, 0, 0]);

      // f1 has 2x2 box at (15, 15)
      setPixel(f1, 15, 15, [255, 0, 0, 255]);
      setPixel(f1, 16, 16, [255, 0, 0, 255]);

      // f2 expands to span across the 32x32 canvas (w: 30, h: 30)
      setPixel(f2, 1, 1, [255, 0, 0, 255]);
      setPixel(f2, 30, 30, [255, 0, 0, 255]);

      const result = analyzeAnimationTemporalPure({
        width: 32,
        height: 32,
        playback: {
          frameNumbers: [1, 2],
          frames: [
            { frameNumber: 1, durationMs: 100, sequenceIndex: 1 },
            { frameNumber: 2, durationMs: 100, sequenceIndex: 2 },
          ],
          loopsContinuously: false,
          totalDurationMs: 200,
          averageFps: 10,
        },
        frameBuffers: [f1, f2],
      });

      const boundsFinding = result.findings.find((f) => f.ruleId === "bounds_change_spike");
      expect(boundsFinding).toBeDefined();
      expect(boundsFinding!.affectedFrames).toEqual([1, 2]);
      expect(boundsFinding!.severity).toBe("info");
      expect(boundsFinding!.observedMetrics).toMatchObject({
        stepIndex: 1,
        frameA: 1,
        frameB: 2,
      });
    });

    it("detects contact point displacement (sliding) between consecutive contact frames", () => {
      const f1 = createSolidFrame(16, 16, [0, 0, 0, 0]);
      const f2 = createSolidFrame(16, 16, [0, 0, 0, 0]);

      // Contact point moves from (5, 12) on frame 1 to (7, 12) on frame 2
      setPixel(f1, 5, 12, [200, 40, 40, 255]);
      setPixel(f2, 7, 12, [200, 40, 40, 255]);

      const result = analyzeAnimationTemporalPure({
        width: 16,
        height: 16,
        playback: {
          frameNumbers: [1, 2],
          frames: [
            { frameNumber: 1, durationMs: 100, sequenceIndex: 1 },
            { frameNumber: 2, durationMs: 100, sequenceIndex: 2 },
          ],
          loopsContinuously: false,
          totalDurationMs: 200,
          averageFps: 10,
        },
        frameBuffers: [f1, f2],
        contactPoints: [
          {
            id: "stance_foot",
            positions: [
              { frameNumber: 1, x: 5, y: 12 },
              { frameNumber: 2, x: 7, y: 12 },
            ],
          },
        ],
      });

      const slipFinding = result.findings.find((f) => f.ruleId === "contact_point_displacement");
      expect(slipFinding).toBeDefined();
      expect(slipFinding!.affectedFrames).toEqual([1, 2]);
      expect(slipFinding!.observedMetrics).toMatchObject({
        pointId: "stance_foot",
        fromFrame: 1,
        toFrame: 2,
        fromPos: { x: 5, y: 12 },
        toPos: { x: 7, y: 12 },
        dx: 2,
        dy: 0,
        distance: 2,
        threshold: 0,
      });
    });

    it("calculates Euclidean displacement with 2D directions and respects threshold", () => {
      const f1 = createSolidFrame(20, 20, [0, 0, 0, 0]);
      const f2 = createSolidFrame(20, 20, [0, 0, 0, 0]);
      setPixel(f1, 10, 10, [255, 255, 255, 255]);
      setPixel(f2, 7, 6, [255, 255, 255, 255]); // dx = -3, dy = -4 -> dist = 5

      const resultExceeded = analyzeAnimationTemporalPure({
        width: 20,
        height: 20,
        playback: {
          frameNumbers: [1, 2],
          frames: [
            { frameNumber: 1, durationMs: 100, sequenceIndex: 1 },
            { frameNumber: 2, durationMs: 100, sequenceIndex: 2 },
          ],
          loopsContinuously: false,
          totalDurationMs: 200,
          averageFps: 10,
        },
        frameBuffers: [f1, f2],
        contactPoints: [
          {
            id: "hand",
            positions: [
              { frameNumber: 1, x: 10, y: 10 },
              { frameNumber: 2, x: 7, y: 6 },
            ],
          },
        ],
        thresholds: { maxContactPointDisplacement: 4 },
      });

      const finding = resultExceeded.findings.find((f) => f.ruleId === "contact_point_displacement");
      expect(finding).toBeDefined();
      expect(finding!.observedMetrics).toMatchObject({
        pointId: "hand",
        fromFrame: 1,
        toFrame: 2,
        fromPos: { x: 10, y: 10 },
        toPos: { x: 7, y: 6 },
        dx: -3,
        dy: -4,
        distance: 5,
        threshold: 4,
      });

      // Allowed when threshold is 6
      const resultAllowed = analyzeAnimationTemporalPure({
        width: 20,
        height: 20,
        playback: {
          frameNumbers: [1, 2],
          frames: [
            { frameNumber: 1, durationMs: 100, sequenceIndex: 1 },
            { frameNumber: 2, durationMs: 100, sequenceIndex: 2 },
          ],
          loopsContinuously: false,
          totalDurationMs: 200,
          averageFps: 10,
        },
        frameBuffers: [f1, f2],
        contactPoints: [
          {
            id: "hand",
            positions: [
              { frameNumber: 1, x: 10, y: 10 },
              { frameNumber: 2, x: 7, y: 6 },
            ],
          },
        ],
        thresholds: { maxContactPointDisplacement: 6 },
      });
      expect(resultAllowed.findings.find((f) => f.ruleId === "contact_point_displacement")).toBeUndefined();
    });

    it("properly catalogs all 12 rules in summary passedRules and flaggedRules", () => {
      const f1 = createSolidFrame(8, 8, [50, 50, 50, 255]);
      const f2 = createSolidFrame(8, 8, [50, 50, 50, 255]); // duplicate

      const result = analyzeAnimationTemporalPure({
        width: 8,
        height: 8,
        playback: {
          frameNumbers: [1, 2],
          frames: [
            { frameNumber: 1, durationMs: 100, sequenceIndex: 1 },
            { frameNumber: 2, durationMs: 100, sequenceIndex: 2 },
          ],
          loopsContinuously: false,
          totalDurationMs: 200,
          averageFps: 10,
        },
        frameBuffers: [f1, f2],
      });

      expect(result.summary.flaggedRules).toContain("unexpected_duplicate_frame");
      expect(result.summary.passedRules).toContain("visual_center_jump");
      expect(result.summary.passedRules).toContain("anomalous_cel_position_jump");
      expect(result.summary.passedRules).toContain("bounds_change_spike");
      expect(result.summary.passedRules).toContain("contact_point_displacement");
      expect(result.summary.passedRules.length + result.summary.flaggedRules.length).toBe(ALL_TEMPORAL_RULES.length);
      expect(ALL_TEMPORAL_RULES).toHaveLength(12);
    });

    it("caps findings to MAX_FINDINGS_LIMIT (128) while tracking totalFindings and preserving flaggedRules", () => {
      // 32x32 canvas, 3 frames. Generate > 128 isolated flickering pixels
      const f1 = createSolidFrame(32, 32, [0, 0, 0, 255]);
      const f2 = createSolidFrame(32, 32, [0, 0, 0, 255]);
      const f3 = createSolidFrame(32, 32, [0, 0, 0, 255]);

      // Place 140 isolated flickering pixels on f2 that revert on f3
      let placed = 0;
      for (let y = 1; y < 30; y += 2) {
        for (let x = 1; x < 30; x += 2) {
          if (placed < 140) {
            setPixel(f2, x, y, [255, 255, 255, 255]);
            placed++;
          }
        }
      }

      const result = analyzeAnimationTemporalPure({
        width: 32,
        height: 32,
        playback: {
          frameNumbers: [1, 2, 3],
          frames: [
            { frameNumber: 1, durationMs: 100, sequenceIndex: 1 },
            { frameNumber: 2, durationMs: 0, sequenceIndex: 2 }, // triggers duration_inconsistency as well
            { frameNumber: 3, durationMs: 100, sequenceIndex: 3 },
          ],
          loopsContinuously: false,
          totalDurationMs: 200,
          averageFps: 15,
        },
        frameBuffers: [f1, f2, f3],
      });

      expect(result.summary.totalFindings).toBeGreaterThan(MAX_FINDINGS_LIMIT);
      expect(result.summary.truncated).toBe(true);
      expect(result.summary.findingsCount).toBe(MAX_FINDINGS_LIMIT);
      expect(result.findings.length).toBe(MAX_FINDINGS_LIMIT);
      // Both isolated_pixel_flicker and duration_inconsistency must be present in flaggedRules even if truncated
      expect(result.summary.flaggedRules).toContain("isolated_pixel_flicker");
      expect(result.summary.flaggedRules).toContain("duration_inconsistency");
    });
  });

  describe("Limits & Input Rejections", () => {
    it("rejects frame count exceeding MAX_ANALYSIS_FRAMES", () => {
      const frames = Array.from({ length: MAX_ANALYSIS_FRAMES + 1 }, () => createSolidFrame(2, 2, [0, 0, 0, 0]));
      const frameNumbers = frames.map((_, idx) => idx + 1);
      expect(() =>
        analyzeAnimationTemporalPure({
          width: 2,
          height: 2,
          playback: {
            frameNumbers,
            frames: frameNumbers.map((fn, idx) => ({ frameNumber: fn, durationMs: 100, sequenceIndex: idx + 1 })),
            loopsContinuously: false,
            totalDurationMs: frameNumbers.length * 100,
            averageFps: 10,
          },
          frameBuffers: frames,
        })
      ).toThrow(/limited to 64 playback frames/i);
    });

    it("rejects rigid regions extending outside canvas boundaries", () => {
      const f1 = createSolidFrame(10, 10, [0, 0, 0, 0]);
      expect(() =>
        analyzeAnimationTemporalPure({
          width: 10,
          height: 10,
          playback: {
            frameNumbers: [1],
            frames: [{ frameNumber: 1, durationMs: 100, sequenceIndex: 1 }],
            loopsContinuously: false,
            totalDurationMs: 100,
            averageFps: 10,
          },
          frameBuffers: [f1],
          rigidRegions: [{ id: "out_of_bounds", x: 8, y: 8, width: 4, height: 4 }],
        })
      ).toThrow(/extends outside canvas boundaries/i);
    });

    it("rejects duplicate rigid region IDs", () => {
      const f1 = createSolidFrame(10, 10, [0, 0, 0, 0]);
      expect(() =>
        analyzeAnimationTemporalPure({
          width: 10,
          height: 10,
          playback: {
            frameNumbers: [1],
            frames: [{ frameNumber: 1, durationMs: 100, sequenceIndex: 1 }],
            loopsContinuously: false,
            totalDurationMs: 100,
            averageFps: 10,
          },
          frameBuffers: [f1],
          rigidRegions: [
            { id: "box", x: 0, y: 0, width: 2, height: 2 },
            { id: "box", x: 2, y: 2, width: 2, height: 2 },
          ],
        })
      ).toThrow(/duplicate rigid region id/i);
    });

    it("rejects contact points outside canvas boundaries", () => {
      const f1 = createSolidFrame(10, 10, [0, 0, 0, 0]);
      expect(() =>
        analyzeAnimationTemporalPure({
          width: 10,
          height: 10,
          playback: {
            frameNumbers: [1, 2],
            frames: [
              { frameNumber: 1, durationMs: 100, sequenceIndex: 1 },
              { frameNumber: 2, durationMs: 100, sequenceIndex: 2 },
            ],
            loopsContinuously: false,
            totalDurationMs: 200,
            averageFps: 10,
          },
          frameBuffers: [f1, f1],
          contactPoints: [{
            id: "pt",
            positions: [
              { frameNumber: 1, x: 0, y: 0 },
              { frameNumber: 2, x: 10, y: 5 },
            ],
          }],
        })
      ).toThrow(/outside canvas boundaries/i);
    });

    it("rejects duplicate contact point IDs", () => {
      const f1 = createSolidFrame(10, 10, [0, 0, 0, 0]);
      expect(() =>
        analyzeAnimationTemporalPure({
          width: 10,
          height: 10,
          playback: {
            frameNumbers: [1, 2],
            frames: [
              { frameNumber: 1, durationMs: 100, sequenceIndex: 1 },
              { frameNumber: 2, durationMs: 100, sequenceIndex: 2 },
            ],
            loopsContinuously: false,
            totalDurationMs: 200,
            averageFps: 10,
          },
          frameBuffers: [f1, f1],
          contactPoints: [
            { id: "toe", positions: [{ frameNumber: 1, x: 1, y: 1 }, { frameNumber: 2, x: 1, y: 1 }] },
            { id: "toe", positions: [{ frameNumber: 1, x: 2, y: 2 }, { frameNumber: 2, x: 2, y: 2 }] },
          ],
        })
      ).toThrow(/duplicate contact point id/i);
    });

    it("rejects mismatched frame buffer dimensions", () => {
      const f1 = createSolidFrame(10, 10, [0, 0, 0, 0]);
      const f2 = createSolidFrame(8, 8, [0, 0, 0, 0]);
      expect(() =>
        analyzeAnimationTemporalPure({
          width: 10,
          height: 10,
          playback: {
            frameNumbers: [1, 2],
            frames: [
              { frameNumber: 1, durationMs: 100, sequenceIndex: 1 },
              { frameNumber: 2, durationMs: 100, sequenceIndex: 2 },
            ],
            loopsContinuously: false,
            totalDurationMs: 200,
            averageFps: 10,
          },
          frameBuffers: [f1, f2],
        })
      ).toThrow(/mismatched dimensions/i);
    });

    it("rejects non-finite numbers (NaN, Infinity) in thresholds and coordinates", () => {
      const f1 = createSolidFrame(4, 4, [0, 0, 0, 0]);
      const baseInput = {
        width: 4,
        height: 4,
        playback: {
          frameNumbers: [1],
          frames: [{ frameNumber: 1, durationMs: 100, sequenceIndex: 1 }],
          loopsContinuously: false,
          totalDurationMs: 100,
          averageFps: 10,
        },
        frameBuffers: [f1],
      };

      expect(() => analyzeAnimationTemporalPure({ ...baseInput, thresholds: { pixelDiffThreshold: NaN } })).toThrow(/finite integer/i);
      expect(() => analyzeAnimationTemporalPure({ ...baseInput, thresholds: { maxAdjacentChangeRatio: Infinity } })).toThrow(/finite number/i);
      expect(() => analyzeAnimationTemporalPure({ ...baseInput, thresholds: { maxCenterShift: NaN } })).toThrow(/finite non-negative/i);
      expect(() => analyzeAnimationTemporalPure({ ...baseInput, thresholds: { maxAreaChangeRatio: NaN } })).toThrow(/finite number/i);
      expect(() => analyzeAnimationTemporalPure({ ...baseInput, thresholds: { maxCelPositionJump: Infinity } })).toThrow(/finite non-negative/i);
      expect(() => analyzeAnimationTemporalPure({ ...baseInput, thresholds: { rigidTolerance: NaN } })).toThrow(/finite number/i);
      expect(() => analyzeAnimationTemporalPure({ ...baseInput, thresholds: { maxContactPointDisplacement: NaN } })).toThrow(/finite non-negative/i);

      // Contact point coordinate NaN
      expect(() => analyzeAnimationTemporalPure({
        ...baseInput,
        playback: {
          frameNumbers: [1, 2],
          frames: [
            { frameNumber: 1, durationMs: 100, sequenceIndex: 1 },
            { frameNumber: 2, durationMs: 100, sequenceIndex: 2 },
          ],
          loopsContinuously: false,
          totalDurationMs: 200,
          averageFps: 10,
        },
        frameBuffers: [f1, f1],
        contactPoints: [{ id: "pt", positions: [{ frameNumber: 1, x: 0, y: 0 }, { frameNumber: 2, x: NaN, y: 2 }] }],
      })).toThrow(/finite integers/i);

      // Rigid region coordinate Infinity
      expect(() => analyzeAnimationTemporalPure({
        ...baseInput,
        rigidRegions: [{ id: "reg", x: 0, y: 0, width: Infinity as any, height: 2 }],
      })).toThrow(/finite integers/i);
    });

    it("rejects contact points with frame numbers not in playback or duplicate frame numbers", () => {
      const f1 = createSolidFrame(4, 4, [0, 0, 0, 0]);
      const baseInput = {
        width: 4,
        height: 4,
        playback: {
          frameNumbers: [1, 2],
          frames: [
            { frameNumber: 1, durationMs: 100, sequenceIndex: 1 },
            { frameNumber: 2, durationMs: 100, sequenceIndex: 2 },
          ],
          loopsContinuously: false,
          totalDurationMs: 200,
          averageFps: 10,
        },
        frameBuffers: [f1, f1],
      };

      // Frame 99 not in playback
      expect(() => analyzeAnimationTemporalPure({
        ...baseInput,
        contactPoints: [{ id: "pt", positions: [{ frameNumber: 1, x: 1, y: 1 }, { frameNumber: 99, x: 1, y: 1 }] }],
      })).toThrow(/not present in playback/i);

      // Duplicate frameNumber 1 in same point
      expect(() => analyzeAnimationTemporalPure({
        ...baseInput,
        contactPoints: [{
          id: "pt",
          positions: [
            { frameNumber: 1, x: 1, y: 1 },
            { frameNumber: 1, x: 2, y: 2 },
          ],
        }],
      })).toThrow(/duplicate position for frameNumber 1/i);

      // Less than 2 positions
      expect(() => analyzeAnimationTemporalPure({
        ...baseInput,
        contactPoints: [{ id: "pt", positions: [{ frameNumber: 1, x: 1, y: 1 }] }],
      })).toThrow(/at least 2 entries/i);

      // More than 64 positions
      const tooManyPositions = Array.from({ length: 65 }, () => ({
        frameNumber: 1,
        x: 1,
        y: 1,
      }));
      expect(() => analyzeAnimationTemporalPure({
        ...baseInput,
        contactPoints: [{ id: "pt", positions: tooManyPositions }],
      })).toThrow(/exceeds maximum limit of 64/i);
    });
  });
});
