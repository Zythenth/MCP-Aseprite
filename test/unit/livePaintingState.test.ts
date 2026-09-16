import { describe, expect, it } from "vitest";
import { BridgeState } from "../../src/bridge/state.js";
import { BRIDGE_PROTOCOL_VERSION } from "../../src/config.js";
import { LivePaintingState } from "../../src/mcp/livePaintingState.js";

function connectedState(): BridgeState {
  const state = new BridgeState();
  state.handleHello({
    bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION,
    asepriteVersion: "mock",
    apiVersion: 0,
    sessionId: "live-session",
    revision: 1,
    capabilities: {},
  });
  state.setConnected(true, "127.0.0.1");
  state.updateActiveSprite({
    filename: "C:/sprites/live.aseprite",
    width: 4,
    height: 4,
    colorMode: "rgb",
    layersCount: 1,
    framesCount: 1,
    activeLayer: "Layer 1",
    activeFrame: 1,
  });
  return state;
}

function image(red = 0): { width: number; height: number; data: Uint8Array } {
  const data = new Uint8Array(4 * 4 * 4);
  data[0] = red;
  data[3] = 255;
  return { width: 4, height: 4, data };
}

describe("LivePaintingState", () => {
  it("requires the declared stage order and exactly one mutation per undoable stage", () => {
    const live = new LivePaintingState(connectedState());
    live.start({
      title: "Live hero",
      sessionId: "live-session",
      spriteIdentifier: "C:/sprites/live.aseprite",
      revision: 1,
      speed: "normal",
      commentaryMode: true,
      stageOrder: ["sketch", "blocks"],
      initialSnapshot: { frameNumber: 1, revision: 1, image: image() },
    });

    expect(() => live.beforeSpriteMutation("set_pixels")).toThrow(/Begin the next/i);
    expect(() => live.beginStage({ name: "blocks", description: "wrong order", comment: "explaining" })).toThrow(/Expected/i);
    expect(() => live.beginStage({ name: "sketch", description: "rough pose" })).toThrow(/comment is required/i);

    live.beginStage({ name: "sketch", description: "rough pose", comment: "Blocking the gesture." });
    live.beforeSpriteMutation("set_pixels");
    live.recordSpriteMutation("set_pixels");
    expect(() => live.beforeSpriteMutation("set_pixels")).toThrow(/one atomic/i);
    const completed = live.completeStage({ frameNumber: 1, revision: 2, image: image(255) });
    expect(completed.name).toBe("sketch");
    expect(live.getSummary()?.snapshotCount).toBe(2);
    expect(live.getReplayImages()).toHaveLength(2);

    expect(live.getLastUndoableStage().name).toBe("sketch");
    live.confirmUndoLastStage();
    expect(live.getSummary()?.nextStage).toBe("sketch");
    expect(live.listSnapshots()).toHaveLength(1);
  });

  it("blocks mutations while paused, unlocks them after cancellation, and clears its in-memory log when the bridge disconnects", () => {
    const state = connectedState();
    const live = new LivePaintingState(state);
    live.start({
      title: "Live icon",
      sessionId: "live-session",
      spriteIdentifier: "C:/sprites/live.aseprite",
      revision: 1,
      speed: "fast",
      commentaryMode: false,
      stageOrder: ["sketch"],
      initialSnapshot: { frameNumber: 1, revision: 1, image: image() },
    });
    live.pause();
    expect(() => live.beforeSpriteMutation("set_pixels")).toThrow(/paused/i);
    live.continue();
    expect(live.getSummary()?.recommendedDelayMs).toBe(100);
    live.cancel();
    expect(() => live.beforeSpriteMutation("set_pixels")).not.toThrow();
    state.setConnected(false);
    expect(live.getSummary()).toBeNull();
  });
});
