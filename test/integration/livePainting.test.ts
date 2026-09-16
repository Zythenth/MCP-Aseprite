import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CommandDispatcher } from "../../src/bridge/dispatcher.js";
import { BridgeState } from "../../src/bridge/state.js";
import { BridgeWebSocketServer } from "../../src/bridge/wsServer.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { startMockBridge, stopMockBridge, type MockBridgeInstance } from "../../src/mock/index.js";

function text(result: any): any {
  return JSON.parse(result.content.find((item: any) => item.type === "text").text);
}

describe("Live painting MCP integration", () => {
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
    wsServer = new BridgeWebSocketServer(dispatcher, state, { host: "127.0.0.1", port: 0 });
    await wsServer.start();
    mockBridge = await startMockBridge({ host: "127.0.0.1", port: wsServer.getPort() });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    server = createMcpServer(dispatcher, state);
    await server.connect(serverTransport);
    client = new Client({ name: "live-painting-test", version: "1.0.0" }, { capabilities: {} });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    if (mockBridge) await mockBridge.stop();
    await stopMockBridge();
    await wsServer.close();
  });

  it("captures each atomic stage, blocks unobserved painting, supports pause and undoes the whole last stage", async () => {
    const started: any = await client.callTool({
      name: "start_live_painting",
      arguments: { title: "Tiny live sprite", speed: "slow", commentaryMode: true, stages: ["sketch", "blocks"] },
    });
    expect(text(started).error).toBeUndefined();
    expect(started.content[0].type).toBe("image");
    expect(text(started).livePainting.snapshotCount).toBe(1);

    const blocked: any = await client.callTool({
      name: "set_pixels",
      arguments: { pixels: [{ x: 0, y: 0, color: "#FF0000FF" }] },
    });
    expect(blocked.isError).toBe(true);
    expect(text(blocked).error).toMatch(/Begin the next/i);

    await client.callTool({
      name: "begin_live_painting_stage",
      arguments: { stage: "sketch", description: "Gesture block", comment: "Drawing the primary gesture." },
    });
    const firstPaint: any = await client.callTool({
      name: "set_pixels",
      arguments: { pixels: [{ x: 1, y: 1, color: "#FF0000FF" }], returnPreview: true },
    });
    expect(text(firstPaint).success).toBe(true);
    const finishedSketch: any = await client.callTool({ name: "complete_live_painting_stage", arguments: {} });
    expect(finishedSketch.content[0].type).toBe("image");
    expect(text(finishedSketch).livePainting.snapshotCount).toBe(2);

    const paused: any = await client.callTool({ name: "pause_live_painting", arguments: {} });
    expect(text(paused).livePainting.status).toBe("paused");
    const pausedPaint: any = await client.callTool({ name: "set_pixel", arguments: { x: 2, y: 2, color: "#00FF00FF" } });
    expect(pausedPaint.isError).toBe(true);
    await client.callTool({ name: "continue_live_painting", arguments: {} });

    await client.callTool({
      name: "begin_live_painting_stage",
      arguments: { stage: "blocks", description: "Body mass", comment: "Adding the main body cluster." },
    });
    await client.callTool({ name: "set_pixel", arguments: { x: 2, y: 2, color: "#00FF00FF" } });
    await client.callTool({ name: "complete_live_painting_stage", arguments: {} });

    const undo: any = await client.callTool({ name: "undo_live_painting_stage", arguments: { confirm: true } });
    expect(text(undo).undoneStage.name).toBe("blocks");
    const grid: any = await client.callTool({ name: "get_pixel_grid", arguments: { format: "hex" } });
    expect(text(grid).grid[1][1]).toBe("#FF0000FF");
    expect(text(grid).grid[2][2]).toBe("#00000000");

    const replay: any = await client.callTool({ name: "render_live_painting_replay", arguments: { columns: 2 } });
    expect(replay.content[0].type).toBe("image");
    expect(text(replay).snapshots).toHaveLength(2);
  });

  it("finishes a fully captured process and unlocks normal editing after cancellation", async () => {
    await client.callTool({ name: "start_live_painting", arguments: { title: "Finish flow", stages: ["sketch"] } });
    await client.callTool({ name: "begin_live_painting_stage", arguments: { stage: "sketch", description: "Single mark" } });
    await client.callTool({ name: "set_pixel", arguments: { x: 0, y: 0, color: "#112233FF" } });
    await client.callTool({ name: "complete_live_painting_stage", arguments: {} });
    const finished: any = await client.callTool({ name: "finish_live_painting", arguments: {} });
    expect(text(finished).livePainting.status).toBe("completed");

    await client.callTool({ name: "start_live_painting", arguments: { title: "Cancel flow", stages: ["sketch"] } });
    const cancelled: any = await client.callTool({ name: "cancel_live_painting", arguments: { confirm: true } });
    expect(text(cancelled).artworkRetained).toBe(true);
    const normalEdit: any = await client.callTool({ name: "set_pixel", arguments: { x: 3, y: 3, color: "#445566FF" } });
    expect(text(normalEdit).success).toBe(true);
  });
});
