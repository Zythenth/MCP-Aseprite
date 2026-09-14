import { describe, it, expect, beforeEach } from "vitest";
import { MockAsepriteEngine } from "../../src/mock/mockEngine.js";
import {
  MAX_PIXELS_BATCH,
  MAX_ANIMATION_BATCH_OPERATIONS,
  MAX_ANIMATION_BATCH_FRAMES,
  MAX_ANIMATION_BATCH_PAYLOAD_BYTES,
  BRIDGE_PROTOCOL_VERSION,
} from "../../src/config.js";
import {
  batchOperationSchema,
  batchOperationsArraySchema,
  registerBatchTools,
} from "../../src/mcp/tools/batch.js";
import { MUTATING_TOOLS } from "../../src/mcp/toolPolicy.js";
import { BridgeState } from "../../src/bridge/state.js";
import type { CommandDispatcher } from "../../src/bridge/dispatcher.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

describe("batch_animation_edits Unit & Mock Tests", () => {
  let engine: MockAsepriteEngine;

  beforeEach(() => {
    engine = new MockAsepriteEngine(16, 16);
    // Add a second frame for animation tests
    engine.executeCommand("create_frame", { duration: 100 });
  });

  describe("MockEngine batch_animation_edits parity", () => {
    it("applies mixed batch atomically with exactly +1 revision, +1 undo, +1 journal entry and correct final values", () => {
      const initialRev = engine.revision;
      const initialUndoLen = engine.undoStack.length;
      const initialJournalLen = engine.changeJournal.length;

      // Frame 1 exists with cel at layer 0. Frame 2 exists without cel at layer 0.
      // Op 1: set_pixels on layer 0, frame 1
      // Op 2: set_pixels on layer 0, frame 2 (creates cel on frame 2)
      // Op 3: set_cel_opacity on layer 0, frame 1
      // Op 4: set_frame_duration on frame 2
      const res = engine.executeCommand("batch_animation_edits", {
        operations: [
          {
            op: "set_pixels",
            layerIndex: 0,
            frameNumber: 1,
            pixels: [
              { x: 1, y: 1, color: "#FF0000FF" },
              { x: 2, y: 2, color: "#00FF00FF" },
            ],
          },
          {
            op: "set_pixels",
            layerIndex: 0,
            frameNumber: 2,
            pixels: [{ x: 5, y: 5, color: "#0000FFFF" }],
          },
          {
            op: "set_cel_opacity",
            layerIndex: 0,
            frameNumber: 1,
            opacity: 180,
          },
          {
            op: "set_frame_duration",
            frameNumber: 2,
            durationMs: 250,
          },
        ],
      });

      expect(res.success).toBe(true);
      expect(res.changed).toBe(true);
      expect(res.operationsApplied).toBe(4);
      expect(res.framesTouched).toBe(2);
      expect(res.pixelsChanged).toBe(3);
      expect(engine.revision).toBe(initialRev + 1);
      expect(engine.undoStack.length).toBe(initialUndoLen + 1);
      expect(engine.changeJournal.length).toBe(initialJournalLen + 1);

      // Verify journal entry has correct pixelsChanged
      const lastJournal = engine.changeJournal[engine.changeJournal.length - 1];
      expect(lastJournal.revision).toBe(engine.revision);
      expect(lastJournal.pixelsChanged).toBe(3);

      // Verify undoStack transaction name
      const lastUndo = engine.undoStack[engine.undoStack.length - 1];
      expect(lastUndo.name).toBe("batch_animation_edits");

      // Verify cel values
      const cel1 = engine.cels.get("0:1");
      expect(cel1).toBeDefined();
      expect(cel1!.opacity).toBe(180);
      expect(engine.getCelPixel(cel1!, 1, 1)).toBe(0xff0000ff);
      expect(engine.getCelPixel(cel1!, 2, 2)).toBe(0xff00ff00);

      const cel2 = engine.cels.get("0:2");
      expect(cel2).toBeDefined();
      expect(engine.getCelPixel(cel2!, 5, 5)).toBe(0xffff0000);

      // Verify duration
      const f2 = engine.frames.find((f) => f.frameNumber === 2);
      expect(f2?.duration).toBe(0.25);
    });

    it("undo completely restores pixels, created cel existence, position, opacity, and frame duration; redo reapplies them", () => {
      expect(engine.cels.has("0:2")).toBe(false);
      const f1 = engine.frames.find((f) => f.frameNumber === 1)!;
      const initialDuration = f1.duration;

      // Batch that creates cel on 0:2, alters opacity on 0:1, and alters duration on f1
      engine.executeCommand("batch_animation_edits", {
        operations: [
          {
            op: "set_pixels",
            layerIndex: 0,
            frameNumber: 2,
            pixels: [{ x: 3, y: 3, color: "#112233FF" }],
          },
          {
            op: "set_cel_opacity",
            layerIndex: 0,
            frameNumber: 1,
            opacity: 120,
          },
          {
            op: "set_frame_duration",
            frameNumber: 1,
            durationMs: 500,
          },
        ],
      });

      expect(engine.cels.has("0:2")).toBe(true);
      expect(engine.cels.get("0:1")?.opacity).toBe(120);
      expect(f1.duration).toBe(0.5);

      // Execute Undo
      const undoRes = engine.executeCommand("undo", {});
      expect(undoRes.success).toBe(true);
      expect(engine.cels.has("0:2")).toBe(false); // Cel was uncreated!
      expect(engine.cels.get("0:1")?.opacity).toBe(255);
      expect(f1.duration).toBe(initialDuration);

      // Execute Redo
      const redoRes = engine.executeCommand("redo", {});
      expect(redoRes.success).toBe(true);
      expect(engine.cels.has("0:2")).toBe(true); // Cel recreated!
      expect(engine.cels.get("0:1")?.opacity).toBe(120);
      expect(f1.duration).toBe(0.5);
    });

    it("rolls back completely on late error after valid operations (atomic pre-validation)", () => {
      const initialRev = engine.revision;
      const initialUndoLen = engine.undoStack.length;
      const initialJournalLen = engine.changeJournal.length;
      const f1 = engine.frames.find((f) => f.frameNumber === 1)!;
      const initialDuration = f1.duration;

      expect(() => {
        engine.executeCommand("batch_animation_edits", {
          operations: [
            {
              op: "set_pixels",
              layerIndex: 0,
              frameNumber: 1,
              pixels: [{ x: 2, y: 2, color: "#FFFFFFFF" }],
            },
            {
              op: "set_frame_duration",
              frameNumber: 1,
              durationMs: 400,
            },
            {
              op: "set_pixels",
              layerIndex: 0,
              frameNumber: 1,
              pixels: [{ x: 999, y: 999, color: "#FFFFFFFF" }], // Out of bounds!
            },
          ],
        });
      }).toThrow(/out of canvas bounds/i);

      // Verify zero changes occurred
      expect(engine.revision).toBe(initialRev);
      expect(engine.undoStack.length).toBe(initialUndoLen);
      expect(engine.changeJournal.length).toBe(initialJournalLen);
      expect(f1.duration).toBe(initialDuration);
      const cel = engine.cels.get("0:1")!;
      expect(engine.getCelPixel(cel, 2, 2)).toBe(0);
    });

    it("rejects disallowed operations (batch_animation_edits, run_lua, shell, dofile, eval)", () => {
      const disallowed = ["batch_animation_edits", "run_lua", "shell", "dofile", "eval", "unknown_op"];
      for (const op of disallowed) {
        expect(() => {
          engine.executeCommand("batch_animation_edits", {
            operations: [{ op, layerIndex: 0, frameNumber: 1 }],
          });
        }).toThrow(/disallowed or unsupported operation/i);
      }
    });

    it("rejects combining pixel edits and set_cel_position on the same target cel (ambiguity check)", () => {
      expect(() => {
        engine.executeCommand("batch_animation_edits", {
          operations: [
            {
              op: "set_pixels",
              layerIndex: 0,
              frameNumber: 1,
              pixels: [{ x: 0, y: 0, color: "#123456FF" }],
            },
            {
              op: "set_cel_position",
              layerIndex: 0,
              frameNumber: 1,
              x: 5,
              y: 5,
            },
          ],
        });
      }).toThrow(/cannot combine pixel edits and set_cel_position/i);

      // Also in reverse order
      expect(() => {
        engine.executeCommand("batch_animation_edits", {
          operations: [
            {
              op: "set_cel_position",
              layerIndex: 0,
              frameNumber: 1,
              x: 5,
              y: 5,
            },
            {
              op: "set_pixels",
              layerIndex: 0,
              frameNumber: 1,
              pixels: [{ x: 0, y: 0, color: "#123456FF" }],
            },
          ],
        });
      }).toThrow(/cannot combine pixel edits and set_cel_position/i);
    });

    it("returns no-op without revision or undo increment when operations round-trip (ida-e-volta)", () => {
      const initialRev = engine.revision;
      const initialUndoLen = engine.undoStack.length;

      // Set pixel (0,0) red then set it back to transparent (0)
      // Change duration to 300 then back to 100
      // Change opacity to 100 then back to 255
      const res = engine.executeCommand("batch_animation_edits", {
        operations: [
          {
            op: "set_pixels",
            layerIndex: 0,
            frameNumber: 1,
            pixels: [{ x: 0, y: 0, color: "#FF0000FF" }],
          },
          {
            op: "set_pixels",
            layerIndex: 0,
            frameNumber: 1,
            pixels: [{ x: 0, y: 0, color: "#00000000" }],
          },
          {
            op: "set_frame_duration",
            frameNumber: 1,
            durationMs: 300,
          },
          {
            op: "set_frame_duration",
            frameNumber: 1,
            durationMs: 100,
          },
          {
            op: "set_cel_opacity",
            layerIndex: 0,
            frameNumber: 1,
            opacity: 100,
          },
          {
            op: "set_cel_opacity",
            layerIndex: 0,
            frameNumber: 1,
            opacity: 255,
          },
        ],
      });

      expect(res.success).toBe(true);
      expect(res.changed).toBe(false);
      expect(res.operationsApplied).toBe(0);
      expect(res.pixelsChanged).toBe(0);
      expect(engine.revision).toBe(initialRev);
      expect(engine.undoStack.length).toBe(initialUndoLen);
    });

    it("preserves bounds and metadata on an offset cel when only opacity is changed", () => {
      const cel = engine.cels.get("0:1")!;
      cel.bounds = { x: 4, y: 4, width: 8, height: 8 };

      const res = engine.executeCommand("batch_animation_edits", {
        operations: [
          {
            op: "set_cel_opacity",
            layerIndex: 0,
            frameNumber: 1,
            opacity: 128,
          },
        ],
      });

      expect(res.success).toBe(true);
      expect(res.changed).toBe(true);
      const updatedCel = engine.cels.get("0:1")!;
      expect(updatedCel.bounds.x).toBe(4);
      expect(updatedCel.bounds.y).toBe(4);
      expect(updatedCel.bounds.width).toBe(8);
      expect(updatedCel.bounds.height).toBe(8);
      expect(updatedCel.opacity).toBe(128);
    });

    it("preserves imageId, zIndex, color, data on existing cel when pixels are modified", () => {
      const cel = engine.cels.get("0:1")!;
      cel.imageId = "test_image_id_123";
      cel.zIndex = 42;
      cel.color = "#ABCDEF";
      cel.data = "custom_metadata";

      const res = engine.executeCommand("batch_animation_edits", {
        operations: [
          {
            op: "set_pixels",
            layerIndex: 0,
            frameNumber: 1,
            pixels: [{ x: 1, y: 1, color: "#111111FF" }],
          },
        ],
      });

      expect(res.success).toBe(true);
      const updatedCel = engine.cels.get("0:1")!;
      expect(updatedCel.imageId).toBe("test_image_id_123");
      expect(updatedCel.zIndex).toBe(42);
      expect(updatedCel.color).toBe("#ABCDEF");
      expect(updatedCel.data).toBe("custom_metadata");
    });

    it("returns pngBase64 preview when returnPreview is requested", () => {
      const res = engine.executeCommand("batch_animation_edits", {
        operations: [
          {
            op: "set_pixels",
            layerIndex: 0,
            frameNumber: 1,
            pixels: [{ x: 0, y: 0, color: "#FF0000FF" }],
          },
        ],
        returnPreview: true,
      });

      expect(res.success).toBe(true);
      expect(typeof res.pngBase64).toBe("string");
      expect(res.pngBase64.length).toBeGreaterThan(0);
    });

    describe("Boundary and limit validation in MockEngine", () => {
      it("rejects 0 operations and >64 operations", () => {
        expect(() => {
          engine.executeCommand("batch_animation_edits", { operations: [] });
        }).toThrow(/between 1 and 64/i);

        const ops65 = Array.from({ length: 65 }, () => ({
          op: "set_frame_duration",
          frameNumber: 1,
          durationMs: 100,
        }));
        expect(() => {
          engine.executeCommand("batch_animation_edits", { operations: ops65 });
        }).toThrow(/between 1 and 64/i);
      });

      it("rejects total pixels exceeding MAX_PIXELS_BATCH (100000)", () => {
        const batch1 = Array.from({ length: 60000 }, (_, i) => ({
          x: i % 16,
          y: Math.floor(i / 16) % 16,
          color: "#FFFFFFFF",
        }));
        const batch2 = Array.from({ length: 40001 }, (_, i) => ({
          x: i % 16,
          y: Math.floor(i / 16) % 16,
          color: "#FFFFFFFF",
        }));

        expect(() => {
          engine.executeCommand("batch_animation_edits", {
            operations: [
              {
                op: "set_pixels",
                layerIndex: 0,
                frameNumber: 1,
                pixels: batch1,
              },
              {
                op: "set_pixels",
                layerIndex: 0,
                frameNumber: 1,
                pixels: batch2,
              },
            ],
          });
        }).toThrow(/exceeds maximum allowed|exceeds 100000 limit/i);
      });

      it("rejects invalid color string", () => {
        expect(() => {
          engine.executeCommand("batch_animation_edits", {
            operations: [
              {
                op: "set_pixels",
                layerIndex: 0,
                frameNumber: 1,
                pixels: [{ x: 0, y: 0, color: "not-a-color" }],
              },
            ],
          });
        }).toThrow();
      });

      it("rejects payload exceeding MAX_ANIMATION_BATCH_PAYLOAD_BYTES (4 MiB)", () => {
        const bigStr = "a".repeat(4 * 1024 * 1024 + 10);
        expect(() => {
          engine.executeCommand("batch_animation_edits", {
            operations: [
              {
                op: "set_frame_duration",
                frameNumber: 1,
                durationMs: 100,
                extra: bigStr,
              },
            ],
          });
        }).toThrow(/4 MiB/i);
      });
    });
  });

  describe("MCP Tool Layer and Schema Validation", () => {
    it("confirms MUTATING_TOOLS includes batch_animation_edits", () => {
      expect(MUTATING_TOOLS.has("batch_animation_edits")).toBe(true);
    });

    it("validates batchOperationSchema against valid and invalid ops", () => {
      // Valid set_pixels
      expect(
        batchOperationSchema.safeParse({
          op: "set_pixels",
          pixels: [{ x: 0, y: 0, color: "#FF0000FF" }],
        }).success
      ).toBe(true);

      // Valid erase_pixels
      expect(
        batchOperationSchema.safeParse({
          op: "erase_pixels",
          points: [{ x: 1, y: 1 }],
        }).success
      ).toBe(true);

      // Valid set_cel_position
      expect(
        batchOperationSchema.safeParse({
          op: "set_cel_position",
          x: 10,
          y: -5,
        }).success
      ).toBe(true);

      // Valid set_cel_opacity
      expect(
        batchOperationSchema.safeParse({
          op: "set_cel_opacity",
          opacity: 200,
        }).success
      ).toBe(true);

      // Valid set_frame_duration
      expect(
        batchOperationSchema.safeParse({
          op: "set_frame_duration",
          frameNumber: 2,
          durationMs: 500,
        }).success
      ).toBe(true);

      // Invalid op
      expect(
        batchOperationSchema.safeParse({
          op: "shell",
          command: "ls",
        }).success
      ).toBe(false);

      // set_cel_position missing x or y
      expect(
        batchOperationSchema.safeParse({
          op: "set_cel_position",
          x: 10,
        }).success
      ).toBe(false);

      // set_cel_opacity out of 0..255
      expect(
        batchOperationSchema.safeParse({
          op: "set_cel_opacity",
          opacity: 300,
        }).success
      ).toBe(false);

      // set_frame_duration out of 1..60000
      expect(
        batchOperationSchema.safeParse({
          op: "set_frame_duration",
          frameNumber: 1,
          durationMs: 70000,
        }).success
      ).toBe(false);
    });

    it("validates batchOperationsArraySchema enforcing 1..64 operations", () => {
      expect(batchOperationsArraySchema.safeParse([]).success).toBe(false);

      const validOps = [
        {
          op: "set_frame_duration" as const,
          frameNumber: 1,
          durationMs: 100,
        },
      ];
      expect(batchOperationsArraySchema.safeParse(validOps).success).toBe(true);

      const ops65 = Array.from({ length: 65 }, () => ({
        op: "set_frame_duration" as const,
        frameNumber: 1,
        durationMs: 100,
      }));
      expect(batchOperationsArraySchema.safeParse(ops65).success).toBe(false);
    });

    it("registerBatchTools enforces animationBatch capability and registers tool", async () => {
      let registeredToolName = "";
      let registeredToolHandler: any = null;

      const fakeServer = {
        tool: (name: string, description: string, schema: any, handler: any) => {
          registeredToolName = name;
          registeredToolHandler = handler;
        },
      } as unknown as McpServer;

      let sentCommand = "";
      let sentParams: any = null;
      let sentTimeout = 0;

      const fakeDispatcher = {
        send: async (command: string, params: any, timeout: number) => {
          sentCommand = command;
          sentParams = params;
          sentTimeout = timeout;
          return { success: true, changed: true, revision: 2 };
        },
      } as unknown as CommandDispatcher;

      const stateTracker = new BridgeState();
      // Initially, animationBatch capability is missing
      registerBatchTools(fakeServer, fakeDispatcher, stateTracker);
      expect(registeredToolName).toBe("batch_animation_edits");

      // Invoking tool without capability should fail
      const resultMissingCap = await registeredToolHandler({
        operations: [
          {
            op: "set_frame_duration",
            frameNumber: 1,
            durationMs: 150,
          },
        ],
      });
      expect(resultMissingCap.isError).toBe(true);
      expect(resultMissingCap.content[0].text).toContain("animationBatch");

      // Add capability to stateTracker
      stateTracker.handleHello({
        bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION,
        asepriteVersion: "mock",
        apiVersion: 0,
        sessionId: "test_session",
        revision: 1,
        capabilities: { animationBatch: true },
      });

      // Invoking tool with capability should succeed and dispatch with 30000 timeout
      const resultSuccess = await registeredToolHandler({
        operations: [
          {
            op: "set_frame_duration",
            frameNumber: 1,
            durationMs: 150,
          },
        ],
      });

      expect(resultSuccess.isError).toBeUndefined();
      expect(sentCommand).toBe("batch_animation_edits");
      expect(sentTimeout).toBe(30000);
      expect(sentParams.operations.length).toBe(1);
    });

    it("registerBatchTools pre-rejects total pixels > 100000 before dispatcher.send", async () => {
      let registeredToolHandler: any = null;
      const fakeServer = {
        tool: (name: string, description: string, schema: any, handler: any) => {
          registeredToolHandler = handler;
        },
      } as unknown as McpServer;

      let dispatched = false;
      const fakeDispatcher = {
        send: async () => {
          dispatched = true;
          return { success: true };
        },
      } as unknown as CommandDispatcher;

      const stateTracker = new BridgeState();
      stateTracker.handleHello({
        bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION,
        asepriteVersion: "mock",
        apiVersion: 0,
        sessionId: "test_session",
        revision: 1,
        capabilities: { animationBatch: true },
      });
      registerBatchTools(fakeServer, fakeDispatcher, stateTracker);

      const pixels1 = Array.from({ length: 60000 }, () => ({ x: 0, y: 0, color: "#FF0000FF" }));
      const pixels2 = Array.from({ length: 40001 }, () => ({ x: 0, y: 0, color: "#FF0000FF" }));
      const result = await registeredToolHandler({
        operations: [
          {
            op: "set_pixels",
            pixels: pixels1,
          },
          {
            op: "set_pixels",
            pixels: pixels2,
          },
        ],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("exceeds safety limit of 100000");
      expect(dispatched).toBe(false);
    });
  });
});
