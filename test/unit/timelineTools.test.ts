import { beforeEach, describe, expect, it } from "vitest";
import { MockAsepriteEngine } from "../../src/mock/mockEngine.js";

describe("Timeline Advanced Tools (copy_cel, move_cel, move_frame, set_frame_durations, update_tag, delete_tag)", () => {
  let engine: MockAsepriteEngine;

  beforeEach(() => {
    engine = new MockAsepriteEngine(16, 16);
  });

  describe("copy_cel", () => {
    it("copies a cel independently to another frame and clones its pixel buffer", () => {
      engine.executeCommand("create_frame", { duration: 100 });
      engine.executeCommand("set_pixel", { x: 2, y: 2, color: "#FF0000FF" });

      const initialRev = engine.revision;
      const copyResult = engine.executeCommand("copy_cel", {
        sourceFrame: 1,
        targetFrame: 2,
        replaceExisting: true,
      });

      expect(copyResult.success).toBe(true);
      expect(copyResult.copied).toBe(true);
      expect(copyResult.sourceFrame).toBe(1);
      expect(copyResult.targetFrame).toBe(2);
      expect(copyResult.revision).toBe(initialRev + 1);

      // Verify the copy is an independent clone (modifying cel at frame 2 doesn't affect frame 1)
      engine.executeCommand("set_pixel", { frameNumber: 2, x: 2, y: 2, color: "#00FF00FF" });
      const grid1 = engine.executeCommand("get_pixel_grid", { frameNumber: 1, format: "hex" });
      const grid2 = engine.executeCommand("get_pixel_grid", { frameNumber: 2, format: "hex" });
      expect(grid1.grid[2][2]).toBe("#FF0000FF");
      expect(grid2.grid[2][2]).toBe("#00FF00FF");
    });

    it("copies a cel across different image layers", () => {
      engine.executeCommand("create_layer", { name: "Overlay" });
      engine.executeCommand("set_pixel", { layerName: "Layer 1", x: 4, y: 4, color: "#AABBCCFF" });

      const res = engine.executeCommand("copy_cel", {
        sourceLayerName: "Layer 1",
        sourceFrame: 1,
        targetLayerName: "Overlay",
        targetFrame: 1,
        replaceExisting: true,
      });

      expect(res.copied).toBe(true);
      expect(res.sourceLayer).toBe("Layer 1");
      expect(res.targetLayer).toBe("Overlay");
      const celOverlay = engine.executeCommand("get_cel", { layerName: "Overlay", frameNumber: 1 });
      expect(celOverlay.hasCel).toBe(true);
    });

    it("refuses to overwrite existing target cel without replaceExisting: true", () => {
      engine.executeCommand("create_frame", { duration: 100 });
      engine.executeCommand("create_cel", { frameNumber: 2 });

      expect(() => engine.executeCommand("copy_cel", {
        sourceFrame: 1,
        targetFrame: 2,
        replaceExisting: false,
      })).toThrow(/already exists/i);
    });

    it("rejects copying when source and target are the exact same cel", () => {
      expect(() => engine.executeCommand("copy_cel", {
        sourceFrame: 1,
        targetFrame: 1,
      })).toThrow(/must be different/i);
    });

    it("copies cel metadata (zIndex, color, data) to the independent clone", () => {
      engine.executeCommand("create_frame", { duration: 100 });
      const srcCel = engine.cels.get("0:1")!;
      srcCel.zIndex = 3;
      srcCel.color = "#112233";
      srcCel.data = "custom user data";

      const res = engine.executeCommand("copy_cel", {
        sourceFrame: 1,
        targetFrame: 2,
        replaceExisting: true,
      });
      expect(res.copied).toBe(true);

      const dstCel = engine.cels.get("0:2");
      expect(dstCel).toBeDefined();
      expect(dstCel).not.toBe(srcCel);
      expect(dstCel?.zIndex).toBe(3);
      expect(dstCel?.color).toBe("#112233");
      expect(dstCel?.data).toBe("custom user data");
    });
  });

  describe("move_cel", () => {
    it("moves a cel to another frame, preserves identity and metadata, and removes it from the source frame", () => {
      engine.executeCommand("create_frame", { duration: 100 });
      engine.executeCommand("set_pixel", { x: 3, y: 3, color: "#112233FF" });

      const initialCel = engine.cels.get("0:1")!;
      initialCel.zIndex = 7;
      initialCel.color = "#AABBCC";
      initialCel.data = "cel-metadata";
      const initialImageId = initialCel.imageId;

      const moveRes = engine.executeCommand("move_cel", {
        sourceFrame: 1,
        targetFrame: 2,
        replaceExisting: true,
      });

      expect(moveRes.success).toBe(true);
      expect(moveRes.moved).toBe(true);
      expect(moveRes.sourceFrame).toBe(1);
      expect(moveRes.targetFrame).toBe(2);

      // Verify same MockCel object identity and metadata preservation
      expect(engine.cels.get("0:1")).toBeUndefined();
      const movedCel = engine.cels.get("0:2");
      expect(movedCel).toBe(initialCel);
      expect(movedCel?.zIndex).toBe(7);
      expect(movedCel?.color).toBe("#AABBCC");
      expect(movedCel?.data).toBe("cel-metadata");
      expect(movedCel?.imageId).toBe(initialImageId);

      // Source cel is gone, target cel has the data
      const srcCel = engine.executeCommand("get_cel", { frameNumber: 1 });
      expect(srcCel.hasCel).toBe(false);
      const dstCel = engine.executeCommand("get_cel", { frameNumber: 2 });
      expect(dstCel.hasCel).toBe(true);
      const grid = engine.executeCommand("get_pixel_grid", { frameNumber: 2, format: "hex" });
      expect(grid.grid[3][3]).toBe("#112233FF");
    });

    it("rejects move across different image layers without mutation", () => {
      engine.executeCommand("create_layer", { name: "Foreground" });
      engine.executeCommand("set_pixel", { layerName: "Layer 1", x: 1, y: 1, color: "#FF8800FF" });

      expect(() => engine.executeCommand("move_cel", {
        sourceLayerName: "Layer 1",
        sourceFrame: 1,
        targetLayerName: "Foreground",
        targetFrame: 1,
        replaceExisting: true,
      })).toThrow(/Cross-layer move is not supported/i);

      // Verify no mutation occurred
      expect(engine.executeCommand("get_cel", { layerName: "Layer 1", frameNumber: 1 }).hasCel).toBe(true);
      const grid = engine.executeCommand("get_pixel_grid", { layerName: "Layer 1", frameNumber: 1, format: "hex" });
      expect(grid.grid[1][1]).toBe("#FF8800FF");
      expect(engine.executeCommand("get_cel", { layerName: "Foreground", frameNumber: 1 }).hasCel).toBe(false);
    });

    it("refuses to overwrite existing target cel without replaceExisting: true", () => {
      engine.executeCommand("create_frame", { duration: 100 });
      engine.executeCommand("create_cel", { frameNumber: 2 });

      expect(() => engine.executeCommand("move_cel", {
        sourceFrame: 1,
        targetFrame: 2,
        replaceExisting: false,
      })).toThrow(/already exists/i);
    });

    it("rejects move when source cel does not exist", () => {
      engine.executeCommand("create_frame", { duration: 100 });
      engine.executeCommand("delete_cel", { frameNumber: 1, confirm: true });

      expect(() => engine.executeCommand("move_cel", {
        sourceFrame: 1,
        targetFrame: 2,
      })).toThrow(/Source cel not found/i);
    });
  });

  describe("move_frame", () => {
    it("reorders frames forward and shifts intervening frames and cels", () => {
      engine.executeCommand("create_frame", { duration: 200 }); // frame 2
      engine.executeCommand("create_frame", { duration: 300 }); // frame 3
      engine.executeCommand("set_frame_duration", { frameNumber: 1, durationMs: 100 });

      engine.executeCommand("set_pixel", { frameNumber: 1, x: 0, y: 0, color: "#FF0000FF" }); // F1: red
      engine.executeCommand("set_pixel", { frameNumber: 2, x: 0, y: 0, color: "#00FF00FF" }); // F2: green
      engine.executeCommand("set_pixel", { frameNumber: 3, x: 0, y: 0, color: "#0000FFFF" }); // F3: blue

      // Move frame 1 to position 3: new sequence should be [F2(green), F3(blue), F1(red)]
      const moveRes = engine.executeCommand("move_frame", { fromFrame: 1, toFrame: 3 });
      expect(moveRes.success).toBe(true);
      expect(moveRes.moved).toBe(true);
      expect(moveRes.fromFrame).toBe(1);
      expect(moveRes.toFrame).toBe(3);

      const info = engine.executeCommand("get_sprite_info", {});
      expect(info.frames.length).toBe(3);
      expect(info.frames[0].duration).toBe(0.2); // was frame 2
      expect(info.frames[1].duration).toBe(0.3); // was frame 3
      expect(info.frames[2].duration).toBe(0.1); // was frame 1

      expect(engine.executeCommand("get_pixel_grid", { frameNumber: 1, format: "hex" }).grid[0][0]).toBe("#00FF00FF");
      expect(engine.executeCommand("get_pixel_grid", { frameNumber: 2, format: "hex" }).grid[0][0]).toBe("#0000FFFF");
      expect(engine.executeCommand("get_pixel_grid", { frameNumber: 3, format: "hex" }).grid[0][0]).toBe("#FF0000FF");
    });

    it("reorders frames backward and shifts intervening frames and cels", () => {
      engine.executeCommand("create_frame", { duration: 200 });
      engine.executeCommand("create_frame", { duration: 300 });
      engine.executeCommand("set_frame_duration", { frameNumber: 1, durationMs: 100 });

      engine.executeCommand("set_pixel", { frameNumber: 1, x: 1, y: 1, color: "#111111FF" });
      engine.executeCommand("set_pixel", { frameNumber: 2, x: 1, y: 1, color: "#222222FF" });
      engine.executeCommand("set_pixel", { frameNumber: 3, x: 1, y: 1, color: "#333333FF" });

      // Move frame 3 to position 1: new sequence should be [F3, F1, F2]
      const moveRes = engine.executeCommand("move_frame", { fromFrame: 3, toFrame: 1 });
      expect(moveRes.moved).toBe(true);

      const info = engine.executeCommand("get_sprite_info", {});
      expect(info.frames[0].duration).toBe(0.3);
      expect(info.frames[1].duration).toBe(0.1);
      expect(info.frames[2].duration).toBe(0.2);

      expect(engine.executeCommand("get_pixel_grid", { frameNumber: 1, format: "hex" }).grid[1][1]).toBe("#333333FF");
      expect(engine.executeCommand("get_pixel_grid", { frameNumber: 2, format: "hex" }).grid[1][1]).toBe("#111111FF");
      expect(engine.executeCommand("get_pixel_grid", { frameNumber: 3, format: "hex" }).grid[1][1]).toBe("#222222FF");
    });

    it("keeps tag intervals anchored to the same numbers when a frame is reordered", () => {
      engine.executeCommand("create_frame", { duration: 100 });
      engine.executeCommand("create_frame", { duration: 100 });
      engine.executeCommand("create_frame", { duration: 100 });
      // 4 frames total
      engine.executeCommand("create_tag", { name: "intro", fromFrame: 1, toFrame: 2 });
      engine.executeCommand("create_tag", { name: "action", fromFrame: 3, toFrame: 4 });

      // Move frame 1 to position 3
      engine.executeCommand("move_frame", { fromFrame: 1, toFrame: 3 });

      const tags = engine.executeCommand("list_tags", {}).tags;
      const introTag = tags.find((t: any) => t.name === "intro");
      const actionTag = tags.find((t: any) => t.name === "action");
      expect(introTag).toBeDefined();
      expect(introTag.fromFrame).toBe(1);
      expect(introTag.toFrame).toBe(2);
      expect(actionTag).toBeDefined();
      expect(actionTag.fromFrame).toBe(3);
      expect(actionTag.toFrame).toBe(4);
    });

    it("preserves MockCel identity and metadata when moving frame", () => {
      engine.executeCommand("create_frame", { duration: 200 });
      const initialCel = engine.cels.get("0:1")!;
      initialCel.zIndex = 5;
      initialCel.color = "#123456";
      initialCel.data = "custom-meta";
      const initialImageId = initialCel.imageId;

      engine.executeCommand("move_frame", { fromFrame: 1, toFrame: 2 });

      expect(engine.cels.get("0:1")).toBeUndefined();
      const movedCel = engine.cels.get("0:2");
      expect(movedCel).toBe(initialCel);
      expect(movedCel?.zIndex).toBe(5);
      expect(movedCel?.color).toBe("#123456");
      expect(movedCel?.data).toBe("custom-meta");
      expect(movedCel?.imageId).toBe(initialImageId);
    });

    it("returns moved: false and leaves revision unchanged when fromFrame equals toFrame", () => {
      const initialRev = engine.revision;
      const res = engine.executeCommand("move_frame", { fromFrame: 1, toFrame: 1 });
      expect(res.success).toBe(true);
      expect(res.moved).toBe(false);
      expect(res.revision).toBe(initialRev);
      expect(engine.revision).toBe(initialRev);
    });

    it("rejects out-of-bounds frame numbers", () => {
      expect(() => engine.executeCommand("move_frame", { fromFrame: 0, toFrame: 1 })).toThrow(/Invalid fromFrame/);
      expect(() => engine.executeCommand("move_frame", { fromFrame: 1, toFrame: 99 })).toThrow(/Invalid toFrame/);
    });
  });

  describe("set_frame_durations", () => {
    it("updates multiple frame durations in a single atomic call", () => {
      engine.executeCommand("create_frame", { duration: 100 });
      engine.executeCommand("create_frame", { duration: 100 });

      const res = engine.executeCommand("set_frame_durations", {
        durations: [
          { frameNumber: 1, durationMs: 150 },
          { frameNumber: 2, durationMs: 250 },
          { frameNumber: 3, durationMs: 350 },
        ],
      });

      expect(res.success).toBe(true);
      expect(res.updatedFrames).toBe(3);

      const info = engine.executeCommand("get_sprite_info", {});
      expect(info.frames[0].duration).toBe(0.15);
      expect(info.frames[1].duration).toBe(0.25);
      expect(info.frames[2].duration).toBe(0.35);
    });

    it("rejects invalid duration values or non-existent frame numbers without partial modifications", () => {
      engine.executeCommand("create_frame", { duration: 100 });
      const initialDur = engine.executeCommand("get_sprite_info", {}).frames[0].duration;

      expect(() => engine.executeCommand("set_frame_durations", {
        durations: [
          { frameNumber: 1, durationMs: 200 },
          { frameNumber: 99, durationMs: 300 },
        ],
      })).toThrow(/Invalid frameNumber/);

      // Frame 1 should not have been updated
      expect(engine.executeCommand("get_sprite_info", {}).frames[0].duration).toBe(initialDur);

      expect(() => engine.executeCommand("set_frame_durations", {
        durations: [{ frameNumber: 1, durationMs: 0 }],
      })).toThrow(/durationMs/);
    });

    it("rejects duplicate frame numbers and preserves duration and revision", () => {
      const initialDur = engine.executeCommand("get_sprite_info", {}).frames[0].duration;
      const initialRev = engine.revision;

      expect(() => engine.executeCommand("set_frame_durations", {
        durations: [
          { frameNumber: 1, durationMs: 200 },
          { frameNumber: 1, durationMs: 300 },
        ],
      })).toThrow(/Duplicate frameNumber/);

      expect(engine.executeCommand("get_sprite_info", {}).frames[0].duration).toBe(initialDur);
      expect(engine.revision).toBe(initialRev);
    });

    it("updates frame durations using inclusive range mode with normalized durations list", () => {
      engine.executeCommand("create_frame", { duration: 100 });
      engine.executeCommand("create_frame", { duration: 100 });

      const res = engine.executeCommand("set_frame_durations", {
        fromFrame: 1,
        toFrame: 3,
        durationMs: 220,
      });

      expect(res.success).toBe(true);
      expect(res.updatedFrames).toBe(3);
      expect(res.durations).toEqual([
        { frameNumber: 1, durationMs: 220 },
        { frameNumber: 2, durationMs: 220 },
        { frameNumber: 3, durationMs: 220 },
      ]);

      const info = engine.executeCommand("get_sprite_info", {});
      expect(info.frames[0].duration).toBe(0.22);
      expect(info.frames[1].duration).toBe(0.22);
      expect(info.frames[2].duration).toBe(0.22);
    });

    it("rejects mixing durations list with range parameters without altering durations or revision", () => {
      const initialInfo = engine.executeCommand("get_sprite_info", {});
      const initialDur = initialInfo.frames[0].duration;
      const initialRev = engine.revision;

      expect(() => engine.executeCommand("set_frame_durations", {
        durations: [{ frameNumber: 1, durationMs: 150 }],
        fromFrame: 1,
        toFrame: 1,
        durationMs: 150,
      })).toThrow(/Cannot mix 'durations' and range parameters/);

      expect(engine.executeCommand("get_sprite_info", {}).frames[0].duration).toBe(initialDur);
      expect(engine.revision).toBe(initialRev);
    });

    it("rejects partial range parameters without altering durations or revision", () => {
      const initialInfo = engine.executeCommand("get_sprite_info", {});
      const initialDur = initialInfo.frames[0].duration;
      const initialRev = engine.revision;

      expect(() => engine.executeCommand("set_frame_durations", {
        fromFrame: 1,
        toFrame: 1,
      })).toThrow(/Range mode requires all of 'fromFrame', 'toFrame', and 'durationMs'/);

      expect(() => engine.executeCommand("set_frame_durations", {
        fromFrame: 1,
        durationMs: 150,
      })).toThrow(/Range mode requires all of 'fromFrame', 'toFrame', and 'durationMs'/);

      expect(() => engine.executeCommand("set_frame_durations", {
        toFrame: 1,
        durationMs: 150,
      })).toThrow(/Range mode requires all of 'fromFrame', 'toFrame', and 'durationMs'/);

      expect(engine.executeCommand("get_sprite_info", {}).frames[0].duration).toBe(initialDur);
      expect(engine.revision).toBe(initialRev);
    });

    it("rejects range where fromFrame > toFrame without altering durations or revision", () => {
      engine.executeCommand("create_frame", { duration: 100 });
      const initialInfo = engine.executeCommand("get_sprite_info", {});
      const initialDur = initialInfo.frames[0].duration;
      const initialRev = engine.revision;

      expect(() => engine.executeCommand("set_frame_durations", {
        fromFrame: 2,
        toFrame: 1,
        durationMs: 250,
      })).toThrow(/fromFrame must be <= toFrame/);

      expect(engine.executeCommand("get_sprite_info", {}).frames[0].duration).toBe(initialDur);
      expect(engine.revision).toBe(initialRev);
    });

    it("rejects invalid range bounds without altering durations or revision", () => {
      const initialInfo = engine.executeCommand("get_sprite_info", {});
      const initialDur = initialInfo.frames[0].duration;
      const initialRev = engine.revision;

      expect(() => engine.executeCommand("set_frame_durations", {
        fromFrame: 0,
        toFrame: 1,
        durationMs: 200,
      })).toThrow(/Invalid fromFrame/);

      expect(() => engine.executeCommand("set_frame_durations", {
        fromFrame: 1,
        toFrame: 999,
        durationMs: 200,
      })).toThrow(/Invalid toFrame/);

      expect(engine.executeCommand("get_sprite_info", {}).frames[0].duration).toBe(initialDur);
      expect(engine.revision).toBe(initialRev);
    });
  });

  describe("update_tag", () => {
    it("updates tag name, range, direction, repeats, and color", () => {
      engine.executeCommand("create_frame", { duration: 100 });
      engine.executeCommand("create_frame", { duration: 100 });
      engine.executeCommand("create_tag", {
        name: "walk",
        fromFrame: 1,
        toFrame: 2,
        direction: "forward",
        repeats: 1,
      });

      const updateRes = engine.executeCommand("update_tag", {
        name: "walk",
        newName: "run",
        fromFrame: 2,
        toFrame: 3,
        direction: "pingpong",
        repeats: 0,
        color: "#FFAA00FF",
      });

      expect(updateRes.success).toBe(true);
      expect(updateRes.tag).toBe("run");
      expect(updateRes.fromFrame).toBe(2);
      expect(updateRes.toFrame).toBe(3);
      expect(updateRes.repeats).toBe(0);

      const tags = engine.executeCommand("list_tags", {}).tags;
      expect(tags.find((t: any) => t.name === "walk")).toBeUndefined();
      const runTag = tags.find((t: any) => t.name === "run");
      expect(runTag).toBeDefined();
      expect(runTag.fromFrame).toBe(2);
      expect(runTag.toFrame).toBe(3);
      expect(runTag.direction).toBe("pingpong");
      expect(runTag.repeats).toBe(0);
    });

    it("rejects invalid range where fromFrame > toFrame", () => {
      engine.executeCommand("create_frame", { duration: 100 });
      engine.executeCommand("create_tag", { name: "test", fromFrame: 1, toFrame: 2 });

      expect(() => engine.executeCommand("update_tag", {
        name: "test",
        fromFrame: 2,
        toFrame: 1,
      })).toThrow(/fromFrame must be <= toFrame/);
    });

    it("rejects updating a non-existent tag", () => {
      expect(() => engine.executeCommand("update_tag", {
        name: "ghost",
        newName: "real",
      })).toThrow(/Tag not found/);
    });

    it("rejects renaming to an existing tag name, keeping tags and revision intact", () => {
      engine.executeCommand("create_frame", { duration: 100 });
      engine.executeCommand("create_tag", { name: "tag1", fromFrame: 1, toFrame: 1 });
      engine.executeCommand("create_tag", { name: "tag2", fromFrame: 1, toFrame: 1 });

      const revBefore = engine.revision;
      const tagsBefore = JSON.parse(JSON.stringify(engine.tags));

      expect(() =>
        engine.executeCommand("update_tag", {
          name: "tag1",
          newName: "tag2",
        })
      ).toThrow(/Tag already exists/);

      expect(engine.tags).toEqual(tagsBefore);
      expect(engine.revision).toBe(revBefore);
    });

    it("returns changed=false and keeps revision intact when called with only name or with all current values", () => {
      engine.executeCommand("create_frame", { duration: 100 });
      engine.executeCommand("create_frame", { duration: 100 });
      engine.executeCommand("create_tag", {
        name: "idle",
        fromFrame: 1,
        toFrame: 2,
        direction: "forward",
        repeats: 0,
        color: "#FFAA00FF",
      });

      const revBefore = engine.revision;

      const resOnlyName = engine.executeCommand("update_tag", { name: "idle" });
      expect(resOnlyName.success).toBe(true);
      expect(resOnlyName.changed).toBe(false);
      expect(engine.revision).toBe(revBefore);

      const resAllCurrent = engine.executeCommand("update_tag", {
        name: "idle",
        newName: "idle",
        fromFrame: 1,
        toFrame: 2,
        direction: "forward",
        repeats: 0,
        color: "#FFAA00FF",
      });
      expect(resAllCurrent.success).toBe(true);
      expect(resAllCurrent.changed).toBe(false);
      expect(engine.revision).toBe(revBefore);
    });

    it("preserves custom tag data when updating range", () => {
      engine.executeCommand("create_frame", { duration: 100 });
      engine.executeCommand("create_frame", { duration: 100 });
      engine.executeCommand("create_tag", { name: "anim", fromFrame: 1, toFrame: 1 });

      engine.tags[0].data = "payload";

      const res = engine.executeCommand("update_tag", {
        name: "anim",
        fromFrame: 1,
        toFrame: 2,
      });

      expect(res.success).toBe(true);
      expect(res.changed).toBe(true);
      expect(engine.tags[0].data).toBe("payload");
    });
  });

  describe("delete_tag", () => {
    it("deletes a tag with confirm: true and returns its metadata without removing frames or cels", () => {
      engine.executeCommand("create_frame", { duration: 100 });
      engine.executeCommand("set_pixel", { frameNumber: 1, x: 0, y: 0, color: "#AABBCCFF" });
      engine.executeCommand("create_tag", { name: "attack", fromFrame: 1, toFrame: 2, repeats: 3 });

      const delRes = engine.executeCommand("delete_tag", { name: "attack", confirm: true });
      expect(delRes.success).toBe(true);
      expect(delRes.deleted).toBe(true);
      expect(delRes.metadata).toEqual({
        name: "attack",
        fromFrame: 1,
        toFrame: 2,
        repeats: 3,
      });

      // Tag is gone
      const tags = engine.executeCommand("list_tags", {}).tags;
      expect(tags.find((t: any) => t.name === "attack")).toBeUndefined();

      // Frames and cels remain intact
      const info = engine.executeCommand("get_sprite_info", {});
      expect(info.frames.length).toBe(2);
      expect(engine.executeCommand("get_pixel_grid", { frameNumber: 1, format: "hex" }).grid[0][0]).toBe("#AABBCCFF");
    });

    it("rejects deleting without confirm: true", () => {
      engine.executeCommand("create_tag", { name: "idle", fromFrame: 1, toFrame: 1 });
      expect(() => engine.executeCommand("delete_tag", { name: "idle", confirm: false })).toThrow(/requires confirm: true/);
    });

    it("rejects deleting a non-existent tag", () => {
      expect(() => engine.executeCommand("delete_tag", { name: "nonexistent", confirm: true })).toThrow(/Tag not found/);
    });
  });

  describe("timelineEditing bridge capability enforcement", () => {
    it("throws a clear error when timelineEditing is not advertised", async () => {
      const { BridgeState } = await import("../../src/bridge/state.js");
      const { requireBridgeCapability } = await import("../../src/mcp/tools/common.js");
      const state = new BridgeState();

      expect(() => requireBridgeCapability(state, "timelineEditing")).toThrow(
        "The connected Aseprite bridge does not advertise 'timelineEditing'. Reinstall the bundled Lua bridge."
      );

      state.handleHello({
        bridgeProtocolVersion: "1.2.0",
        asepriteVersion: "1.3.15",
        apiVersion: 32,
        sessionId: "session-timeline-1",
        revision: 1,
        capabilities: { timelineEditing: true },
      });

      expect(() => requireBridgeCapability(state, "timelineEditing")).not.toThrow();
    });
  });
});
