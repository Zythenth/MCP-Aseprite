import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeWebSocketServer } from "../../src/bridge/wsServer.js";
import { SharedBridgeClient } from "../../src/bridge/sharedClient.js";
import { CommandDispatcher } from "../../src/bridge/dispatcher.js";
import { BridgeState } from "../../src/bridge/state.js";
import type { AsepriteStatusResult } from "../../src/bridge/protocol.js";
import {
  startMockBridge,
  stopMockBridge,
  type MockBridgeInstance,
} from "../../src/mock/index.js";

function trackBridgeEvents(dispatcher: CommandDispatcher, state: BridgeState): void {
  dispatcher.on("bridge_event", ({ event, data }) => state.handleBridgeEvent(event, data));
}

function waitForConnection(state: BridgeState, connected: boolean): Promise<void> {
  if (state.isConnected() === connected) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      state.off("connection_change", onConnectionChange);
      reject(new Error(`Timed out waiting for shared bridge connected=${connected}`));
    }, 2_000);
    const onConnectionChange = (event: { connected: boolean }) => {
      if (event.connected !== connected) return;
      clearTimeout(timeout);
      state.off("connection_change", onConnectionChange);
      resolve();
    };
    state.on("connection_change", onConnectionChange);
  });
}

describe("shared Aseprite bridge", () => {
  let ownerDispatcher: CommandDispatcher;
  let ownerState: BridgeState;
  let ownerServer: BridgeWebSocketServer;
  let mockBridge: MockBridgeInstance | null;
  let peers: SharedBridgeClient[];

  beforeEach(async () => {
    peers = [];
    mockBridge = null;
    ownerDispatcher = new CommandDispatcher();
    ownerState = new BridgeState();
    trackBridgeEvents(ownerDispatcher, ownerState);
    ownerServer = new BridgeWebSocketServer(ownerDispatcher, ownerState, {
      host: "127.0.0.1",
      port: 0,
      pingIntervalMs: 1_000,
    });
    await ownerServer.start();
    mockBridge = await startMockBridge({
      host: "127.0.0.1",
      port: ownerServer.getPort(),
    });
  });

  afterEach(async () => {
    await Promise.all(peers.map((peer) => peer.close()));
    if (mockBridge) {
      await mockBridge.stop();
      mockBridge = null;
    }
    await stopMockBridge();
    await ownerServer.close();
  });

  it("shares one Aseprite socket with nineteen MCP peer processes", async () => {
    const peerDispatchers = Array.from({ length: 19 }, () => new CommandDispatcher());
    const peerStates = peerDispatchers.map(() => new BridgeState());

    peers = peerDispatchers.map((dispatcher, index) => {
      const state = peerStates[index];
      trackBridgeEvents(dispatcher, state);
      return new SharedBridgeClient(dispatcher, state, {
        host: "127.0.0.1",
        port: ownerServer.getPort(),
      });
    });

    await Promise.all(peers.map((peer) => peer.connect()));
    const statuses = await Promise.all(
      peerDispatchers.map((dispatcher) =>
        dispatcher.send<AsepriteStatusResult>("aseprite_status", {}, 5_000)
      )
    );

    expect(ownerServer.isConnected()).toBe(true);
    expect(statuses).toHaveLength(19);
    expect(statuses.every((status) => status.connected)).toBe(true);
    expect(statuses.every((status) => status.width === 32 && status.height === 32)).toBe(true);
    expect(peerStates.every((state) => state.isConnected())).toBe(true);
  });

  it("keeps peers attached while the Aseprite bridge disconnects and reconnects", async () => {
    const peerDispatcher = new CommandDispatcher();
    const peerState = new BridgeState();
    trackBridgeEvents(peerDispatcher, peerState);
    const peer = new SharedBridgeClient(peerDispatcher, peerState, {
      host: "127.0.0.1",
      port: ownerServer.getPort(),
    });
    peers.push(peer);

    await peer.connect();
    expect(peerState.isConnected()).toBe(true);

    const disconnected = waitForConnection(peerState, false);
    await mockBridge!.stop();
    mockBridge = null;
    await disconnected;
    expect(peerDispatcher.isConnected()).toBe(false);

    const reconnected = waitForConnection(peerState, true);
    mockBridge = await startMockBridge({
      host: "127.0.0.1",
      port: ownerServer.getPort(),
    });
    await reconnected;

    const status = await peerDispatcher.send<AsepriteStatusResult>("aseprite_status", {}, 5_000);
    expect(status.connected).toBe(true);
    expect(status.hasActiveSprite).toBe(true);
  });

  it("requires the configured bridge token for shared peers", async () => {
    const token = "SharedBridgeToken_123456789.valid";
    const securedServer = new BridgeWebSocketServer(
      new CommandDispatcher(),
      new BridgeState(),
      { host: "127.0.0.1", port: 0, token }
    );
    await securedServer.start();

    const unauthorized = new SharedBridgeClient(new CommandDispatcher(), new BridgeState(), {
      host: "127.0.0.1",
      port: securedServer.getPort(),
      token: "WrongBridgeToken_123456789.invalid",
    });
    const authorized = new SharedBridgeClient(new CommandDispatcher(), new BridgeState(), {
      host: "127.0.0.1",
      port: securedServer.getPort(),
      token,
    });

    try {
      await expect(unauthorized.connect()).rejects.toThrow(/Invalid bridge authentication/);
      await authorized.connect();
      expect(authorized.isConnected()).toBe(true);
    } finally {
      await unauthorized.close();
      await authorized.close();
      await securedServer.close();
    }
  });
});
