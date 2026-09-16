import { describe, expect, it } from "vitest";
import { BridgeState } from "../../src/bridge/state.js";
import { BRIDGE_PROTOCOL_VERSION } from "../../src/bridge/protocol.js";

function hello(sessionId: string, revision: number) {
  return {
    bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION,
    asepriteVersion: "1.3.15",
    apiVersion: 32,
    sessionId,
    revision,
    capabilities: { incrementalChanges: true },
  };
}

describe("BridgeState synchronization", () => {
  it("clears a startup issue when the bridge connects", () => {
    const state = new BridgeState();
    state.setConnectionIssue("Bridge port is occupied");

    expect(state.getConnectionIssue()).toBe("Bridge port is occupied");

    state.setConnected(true, "127.0.0.1");
    expect(state.getConnectionIssue()).toBeNull();
  });

  it("clears reconnect resync state only for the current session and exact revision", () => {
    const state = new BridgeState();
    state.handleHello(hello("session-123", 4));
    state.setConnected(true, "127.0.0.1");
    state.setConnected(false);
    state.handleHello(hello("session-123", 6));
    state.setConnected(true, "127.0.0.1");

    expect(state.getStatus().sync?.resyncRequired).toBe(true);
    expect(state.markSynchronized("wrong-session", 6)).toBe(false);
    expect(state.markSynchronized("session-123", 5)).toBe(false);
    expect(state.getStatus().sync?.resyncRequired).toBe(true);

    expect(state.markSynchronized("session-123", 6)).toBe(true);
    expect(state.getStatus().sync).toMatchObject({ resyncRequired: false, gap: false });
  });

  it("adopts shared status without regressing revisions inside the same Aseprite session", () => {
    const state = new BridgeState();
    const helloEvents: string[] = [];
    state.on("hello", (event: { sessionId: string }) => helloEvents.push(event.sessionId));

    const status = {
      connected: true,
      hasActiveSprite: true,
      filename: "shared.aseprite",
      width: 48,
      height: 48,
      colorMode: "rgb",
      layersCount: 1,
      framesCount: 1,
      activeLayer: "Layer 1",
      activeFrame: 1,
      revision: 5,
      bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION,
      asepriteVersion: "1.3.15",
      apiVersion: 32,
      sessionId: "shared-session-a",
      previousSessionId: null,
      compatible: true,
      capabilities: { incrementalChanges: true },
      sync: {
        revision: 5,
        sessionId: "shared-session-a",
        previousSessionId: null,
        resyncRequired: false,
        gap: false,
      },
    };

    state.applyStatus(status, "shared:127.0.0.1:32123");
    state.setRevision(7);
    state.applyStatus({ ...status, revision: 6, sync: { ...status.sync, revision: 6 } });

    expect(state.getRevision()).toBe(7);
    expect(helloEvents).toEqual(["shared-session-a"]);

    state.applyStatus({
      ...status,
      revision: 1,
      sessionId: "shared-session-b",
      previousSessionId: "shared-session-a",
      sync: {
        revision: 1,
        sessionId: "shared-session-b",
        previousSessionId: "shared-session-a",
        resyncRequired: true,
        gap: true,
      },
    });

    expect(state.getRevision()).toBe(1);
    expect(state.getStatus().previousSessionId).toBe("shared-session-a");
    expect(helloEvents).toEqual(["shared-session-a", "shared-session-b"]);
  });
});
