import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { CommandDispatcher } from "../../src/bridge/dispatcher.js";
import { BridgeState } from "../../src/bridge/state.js";
import { BridgeWebSocketServer } from "../../src/bridge/wsServer.js";
import { startMockBridge, stopMockBridge, MockBridgeInstance } from "../../src/mock/index.js";

describe("aseprite_status MCP Tool Integration Tests", () => {
  let dispatcher: CommandDispatcher;
  let state: BridgeState;
  let wsServer: BridgeWebSocketServer;
  let mockBridge: MockBridgeInstance | null = null;
  let client: Client;
  let server: ReturnType<typeof createMcpServer>;

  beforeEach(async () => {
    dispatcher = new CommandDispatcher();
    state = new BridgeState();
    dispatcher.on("bridge_event", ({ event, data }) => state.handleBridgeEvent(event, data));

    wsServer = new BridgeWebSocketServer(dispatcher, state, {
      host: "127.0.0.1",
      port: 0,
      pingIntervalMs: 5000,
    });
    await wsServer.start();

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    server = createMcpServer(dispatcher, state);
    await server.connect(serverTransport);

    client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    if (mockBridge) {
      await mockBridge.stop();
      mockBridge = null;
    }
    await stopMockBridge();
    await wsServer.close();
    await client.close();
    await server.close();
  });

  it("should return friendly fallback status when bridge is disconnected", async () => {
    const result: any = await client.callTool({ name: "aseprite_status", arguments: {} });
    expect(result.isError).toBe(false);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.connected).toBe(false);
    expect(parsed.hasActiveSprite).toBe(false);
    expect(parsed.revision).toBe(0);
    expect(parsed.message).toContain("Aseprite is not connected");
  });

  it("should return active sprite details and revision when MockBridge is connected", async () => {
    mockBridge = await startMockBridge({
      port: wsServer.getPort(),
      host: "127.0.0.1",
    });

    const result: any = await client.callTool({ name: "aseprite_status", arguments: {} });
    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.connected).toBe(true);
    expect(parsed.hasActiveSprite).toBe(true);
    expect(parsed.width).toBe(32);
    expect(parsed.height).toBe(32);
    expect(parsed.colorMode).toBe("rgb");
    expect(parsed.activeLayer).toBe("Layer 1");
    expect(parsed.activeFrame).toBe(1);
    expect(parsed.revision).toBe(1);
  });

  it("should reflect updated revision when pixels are painted", async () => {
    mockBridge = await startMockBridge({
      port: wsServer.getPort(),
      host: "127.0.0.1",
    });

    // Paint a pixel via mock engine
    mockBridge.engine.executeCommand("set_pixel", { x: 0, y: 0, color: "#FF0000FF" });

    const result: any = await client.callTool({ name: "aseprite_status", arguments: {} });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.revision).toBe(2);
  });
});