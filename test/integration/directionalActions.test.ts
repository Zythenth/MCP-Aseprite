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

describe("directional action MCP tools", () => {
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
    client = new Client({ name: "directional-actions-test", version: "1.0.0" }, { capabilities: {} });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    if (mockBridge) await mockBridge.stop();
    await stopMockBridge();
    await wsServer.close();
  });

  it("creates editable directional timeline slots, analyzes each tag, and mirrors a safe east tag", async () => {
    const timeline: any = await client.callTool({
      name: "create_directional_animation_timeline",
      arguments: { action: "walk", directions: 4, frames: 4, fps: 10, stridePx: 3, style: "compact", tagPrefix: "hero_walk", sourceFrame: 1 },
    });
    const created = text(timeline);
    expect(created.success, JSON.stringify(created)).toBe(true);
    expect(created.createdTags).toHaveLength(4);
    expect(created.copiedPoseSlots).toBe(16);

    const analyzed: any = await client.callTool({
      name: "analyze_directional_animation",
      arguments: { action: "walk", directions: 4, frames: 4, fps: 10, stridePx: 3, style: "compact", tagPrefix: "hero_walk" },
    });
    const report = text(analyzed);
    expect(report.success).toBe(true);
    expect(report.perDirection).toHaveLength(4);
    expect(report.perDirection[0].contactQa).toBe("not_evaluated_without_exact_contact_coordinates");

    const firstTag = created.createdTags[0];
    const armChecked: any = await client.callTool({
      name: "analyze_directional_animation",
      arguments: {
        action: "walk", directions: 4, frames: 4, fps: 10, stridePx: 3, style: "compact", tagPrefix: "hero_walk",
        armSwings: [{ tagName: firstTag.name, axis: "x", leftHand: [{ frameNumber: firstTag.fromFrame, x: 1, y: 1 }, { frameNumber: firstTag.fromFrame + 1, x: 2, y: 1 }], rightHand: [{ frameNumber: firstTag.fromFrame, x: 3, y: 1 }, { frameNumber: firstTag.fromFrame + 1, x: 2, y: 1 }] }],
      },
    });
    expect(text(armChecked).perDirection[0].armSwingQa[0]).toMatchObject({ passed: true, oppositeSteps: 1 });

    await client.callTool({ name: "set_pixels", arguments: { frameNumber: 1, pixels: [{ x: 0, y: 0, color: "#FF0000FF" }] } });
    await client.callTool({ name: "create_tag", arguments: { name: "east", fromFrame: 1, toFrame: 1 } });
    const mirrored: any = await client.callTool({ name: "mirror_directional_animation", arguments: { sourceTagName: "east", targetTagName: "west", confirm: true } });
    expect(text(mirrored).success).toBe(true);
    const grid: any = await client.callTool({ name: "get_pixel_grid", arguments: { frameIndex: text(mirrored).targetFrames[0], format: "hex" } });
    expect(text(grid).grid[0][text(grid).width - 1]).toBe("#FF0000FF");
  });

  it("generates a complete directional cycle with crisp in-betweens from supplied key poses", async () => {
    await client.callTool({ name: "create_frame", arguments: {} });
    await client.callTool({ name: "set_pixels", arguments: { frameNumber: 1, pixels: [{ x: 1, y: 1, color: "#FF0000FF" }] } });
    await client.callTool({ name: "set_pixels", arguments: { frameNumber: 2, pixels: [{ x: 3, y: 1, color: "#FF0000FF" }] } });
    const generated: any = await client.callTool({
      name: "generate_directional_animation_from_key_poses",
      arguments: {
        action: "idle", directions: 4, frames: 3, fps: 10, stridePx: 0, style: "compact", tagPrefix: "hero_idle",
        keyPoses: [
          { direction: "N", frameNumbers: [1, 2] },
          { direction: "E", frameNumbers: [1, 2] },
          { direction: "S", frameNumbers: [1, 2] },
          { direction: "W", frameNumbers: [1, 2] },
        ],
      },
    });
    const result = text(generated);
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(result.generatedTags).toHaveLength(4);
    expect(result.generatedInBetweens).toHaveLength(4);
    const north = result.generatedTags[0];
    const first: any = await client.callTool({ name: "get_pixel_grid", arguments: { frameIndex: north.fromFrame, format: "hex" } });
    const middle: any = await client.callTool({ name: "get_pixel_grid", arguments: { frameIndex: north.fromFrame + 1, format: "hex" } });
    const last: any = await client.callTool({ name: "get_pixel_grid", arguments: { frameIndex: north.toFrame, format: "hex" } });
    expect(text(first).grid[1][1]).toBe("#FF0000FF");
    expect(text(middle).grid[1][2]).toBe("#FF0000FF");
    expect(text(last).grid[1][3]).toBe("#FF0000FF");
  });

  it("rolls back key-pose generation when a generated tag cannot be created", async () => {
    await client.callTool({ name: "create_frame", arguments: {} });
    const engine = mockBridge!.engine as any;
    const originalExecuteCommand = engine.executeCommand.bind(engine);
    engine.executeCommand = (command: string, params: unknown) => {
      if (command === "create_tag") throw new Error("simulated generated tag failure");
      return originalExecuteCommand(command, params);
    };

    const result: any = await client.callTool({
      name: "generate_directional_animation_from_key_poses",
      arguments: {
        action: "idle", directions: 4, frames: 3, fps: 10, stridePx: 0, style: "compact", tagPrefix: "rollback_idle",
        keyPoses: [
          { direction: "N", frameNumbers: [1, 2] },
          { direction: "E", frameNumbers: [1, 2] },
          { direction: "S", frameNumbers: [1, 2] },
          { direction: "W", frameNumbers: [1, 2] },
        ],
      },
    });
    expect(text(result).success).toBe(false);
    expect(text(result).error).toContain("All generated frames and tags from this failed key-pose request were removed.");
    const frames: any = await client.callTool({ name: "list_frames", arguments: {} });
    const tags: any = await client.callTool({ name: "list_tags", arguments: {} });
    expect(text(frames).frames).toHaveLength(2);
    expect(text(tags).tags).toHaveLength(0);
  });

  it("rejects an unsafe mirror assessment without mutating the timeline", async () => {
    const result: any = await client.callTool({ name: "assess_directional_mirroring", arguments: { hasHandedWeapon: true } });
    expect(text(result).decision.mirrorable).toBe(false);
  });

  it("mirrors every frame of a tagged sequence without losing the source tag", async () => {
    await client.callTool({ name: "create_frame", arguments: {} });
    await client.callTool({ name: "create_frame", arguments: {} });
    await client.callTool({ name: "create_frame", arguments: {} });
    const colors = ["#FF0000FF", "#00FF00FF", "#0000FFFF", "#FFFFFFFF"];
    for (const [index, color] of colors.entries()) {
      await client.callTool({ name: "set_pixels", arguments: { frameNumber: index + 1, pixels: [{ x: 0, y: 0, color }] } });
    }
    await client.callTool({ name: "create_tag", arguments: { name: "source_sequence", fromFrame: 1, toFrame: 4 } });
    const result: any = await client.callTool({ name: "mirror_directional_animation", arguments: { sourceTagName: "source_sequence", targetTagName: "mirrored_sequence", confirm: true } });
    const mirrored = text(result);
    expect(mirrored.success).toBe(true);
    expect(mirrored.targetFrames).toHaveLength(4);
    expect(mirrored.sourceTagAfter).toEqual({ fromFrame: 1, toFrame: 4 });
    for (const [index, frameNumber] of mirrored.sourceFrames.entries()) {
      const grid: any = await client.callTool({ name: "get_pixel_grid", arguments: { frameIndex: frameNumber, format: "hex" } });
      expect(text(grid).grid[0][0]).toBe(colors[index]);
    }
    for (const [index, frameNumber] of mirrored.targetFrames.entries()) {
      const grid: any = await client.callTool({ name: "get_pixel_grid", arguments: { frameIndex: frameNumber, format: "hex" } });
      expect(text(grid).grid[0][text(grid).width - 1]).toBe(colors[index]);
    }
  });

  it("removes created mirror frames if target-tag creation fails", async () => {
    await client.callTool({ name: "create_frame", arguments: {} });
    await client.callTool({ name: "create_tag", arguments: { name: "source_sequence", fromFrame: 1, toFrame: 2 } });
    const engine = mockBridge!.engine as any;
    const originalExecuteCommand = engine.executeCommand.bind(engine);
    engine.executeCommand = (command: string, params: any) => {
      if (command === "create_tag" && params.name === "mirrored_sequence") throw new Error("simulated mirror tag failure");
      return originalExecuteCommand(command, params);
    };

    const result: any = await client.callTool({ name: "mirror_directional_animation", arguments: { sourceTagName: "source_sequence", targetTagName: "mirrored_sequence", confirm: true } });
    expect(text(result).success).toBe(false);
    expect(text(result).error).toContain("All frames and tags created by this failed mirror request were removed.");

    const frames: any = await client.callTool({ name: "list_frames", arguments: {} });
    const tags: any = await client.callTool({ name: "list_tags", arguments: {} });
    expect(text(frames).frames).toHaveLength(2);
    expect(text(tags).tags).toEqual([expect.objectContaining({ name: "source_sequence", fromFrame: 1, toFrame: 2 })]);
  });

  it("compares grounded contact duration when reviewing a run", async () => {
    await client.callTool({ name: "set_pixels", arguments: { frameNumber: 1, pixels: [{ x: 0, y: 31, color: "#FFFFFFFF" }] } });
    const timeline: any = await client.callTool({
      name: "create_directional_animation_timeline",
      arguments: { action: "run", directions: 4, frames: 3, fps: 16, stridePx: 5, style: "compact", tagPrefix: "hero_run", sourceFrame: 1 },
    });
    const firstTag = text(timeline).createdTags[0];
    const analyzed: any = await client.callTool({
      name: "analyze_directional_animation",
      arguments: {
        action: "run", directions: 4, frames: 3, fps: 16, stridePx: 5, style: "compact", tagPrefix: "hero_run",
        walkReference: { fps: 12, stridePx: 3 }, walkContactFrameCount: 2,
        groundContacts: [{ tagName: firstTag.name, frameNumbers: [firstTag.fromFrame], groundY: 31 }],
      },
    });
    expect(text(analyzed).perDirection[0].runContactComparison).toMatchObject({ status: "pass", runContactFrameCount: 1, walkContactFrameCount: 2 });
  });

  it("removes frames already duplicated when tag creation fails", async () => {
    const engine = mockBridge!.engine as any;
    const originalExecuteCommand = engine.executeCommand.bind(engine);
    engine.executeCommand = (command: string, params: unknown) => {
      if (command === "create_tag") throw new Error("simulated tag creation failure");
      return originalExecuteCommand(command, params);
    };

    const result: any = await client.callTool({
      name: "create_directional_animation_timeline",
      arguments: { action: "walk", directions: 4, frames: 4, fps: 10, stridePx: 3, style: "compact", tagPrefix: "rollback", sourceFrame: 1 },
    });
    const response = text(result);
    expect(response.success).toBe(false);
    expect(response.error).toContain("All timeline frames and tags created by this failed request were removed.");

    const frames: any = await client.callTool({ name: "list_frames", arguments: {} });
    const tags: any = await client.callTool({ name: "list_tags", arguments: {} });
    expect(text(frames).frames).toHaveLength(1);
    expect(text(tags).tags).toHaveLength(0);
  });

  it("accepts the Lua empty-table representation before creating the first tag", async () => {
    const engine = mockBridge!.engine as any;
    const originalExecuteCommand = engine.executeCommand.bind(engine);
    engine.executeCommand = (command: string, params: unknown) => {
      const result = originalExecuteCommand(command, params);
      return command === "inspect_animation" && Array.isArray(result.tags) && result.tags.length === 0
        ? { ...result, tags: {} }
        : result;
    };

    const timeline: any = await client.callTool({
      name: "create_directional_animation_timeline",
      arguments: { action: "idle", directions: 4, frames: 2, fps: 6, stridePx: 0, style: "compact", tagPrefix: "first_tag", sourceFrame: 1 },
    });
    expect(text(timeline).success).toBe(true);
    expect(text(timeline).createdTags).toHaveLength(4);
  });
});
