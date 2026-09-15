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
});
