import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BridgeWebSocketServer } from "../../src/bridge/wsServer.js";
import { CommandDispatcher } from "../../src/bridge/dispatcher.js";
import { BridgeState } from "../../src/bridge/state.js";
import { startMockBridge, stopMockBridge, MockBridgeInstance } from "../../src/mock/index.js";
import type { BridgeStatusResult, BridgeSetPixelsResult } from "../../src/bridge/protocol.js";

describe("MockBridge WebSocket Integration Tests", () => {
  let dispatcher: CommandDispatcher;
  let state: BridgeState;
  let wsServer: BridgeWebSocketServer;
  let mockBridge: MockBridgeInstance | null = null;

  beforeEach(async () => {
    dispatcher = new CommandDispatcher();
    state = new BridgeState();
    wsServer = new BridgeWebSocketServer(dispatcher, state, {
      host: "127.0.0.1",
      port: 0,
      pingIntervalMs: 5000,
    });
    await wsServer.start();
  });

  afterEach(async () => {
    if (mockBridge) {
      await mockBridge.stop();
      mockBridge = null;
    }
    await stopMockBridge();
    await wsServer.close();
  });

  it("should establish WebSocket connection between MockClient and BridgeWebSocketServer", async () => {
    expect(wsServer.isConnected()).toBe(false);
    expect(dispatcher.isConnected()).toBe(false);

    mockBridge = await startMockBridge({
      port: wsServer.getPort(),
      host: "127.0.0.1",
    });

    expect(wsServer.isConnected()).toBe(true);
    expect(dispatcher.isConnected()).toBe(true);
    expect(state.isConnected()).toBe(true);
  });

  it("should exchange correlated commands and responses over WebSocket", async () => {
    mockBridge = await startMockBridge({
      port: wsServer.getPort(),
      host: "127.0.0.1",
    });

    // 1. Query status
    const status = await dispatcher.send<BridgeStatusResult>("aseprite_status", {});
    expect(status.connected).toBe(true);
    expect(status.width).toBe(32);
    expect(status.height).toBe(32);
    expect(status.revision).toBe(1);

    // 2. Set pixel
    const setRes = await dispatcher.send<BridgeSetPixelsResult>("set_pixels", {
      pixels: [{ x: 10, y: 10, color: "#FF00FFFF" }],
    });
    expect(setRes.pixelsModified).toBe(1);
    expect(setRes.revision).toBe(2);

    // 3. Undo
    const undoRes = await dispatcher.send<{ success: boolean; revision: number }>("undo", {});
    expect(undoRes.success).toBe(true);
    expect(undoRes.revision).toBe(3);
  });

  it("should abort pending commands when client disconnects", async () => {
    mockBridge = await startMockBridge({
      port: wsServer.getPort(),
      host: "127.0.0.1",
    });

    // Start a command that we will interrupt with disconnect
    const sendPromise = dispatcher.send("hang_test", {}, 5000);
    // Disconnect the mock bridge
    await mockBridge.stop();
    mockBridge = null;

    await expect(sendPromise).rejects.toThrow("aborted");
  });
});