import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { CommandDispatcher } from "../../src/bridge/dispatcher.js";
import { BridgeState } from "../../src/bridge/state.js";
import { BridgeWebSocketServer } from "../../src/bridge/wsServer.js";
import { startMockBridge, stopMockBridge, type MockBridgeInstance } from "../../src/mock/index.js";
import fs from "node:fs/promises";
import path from "node:path";

function text(result: any): any {
  return JSON.parse(result.content.find((entry: any) => entry.type === "text").text);
}

describe("pixel-motion MCP tools", () => {
  let dispatcher: CommandDispatcher;
  let state: BridgeState;
  let wsServer: BridgeWebSocketServer;
  let mockBridge: MockBridgeInstance | null = null;
  let client: Client;
  let server: ReturnType<typeof createMcpServer>;
  const temporaryDirectories: string[] = [];

  beforeEach(async () => {
    dispatcher = new CommandDispatcher();
    state = new BridgeState();
    dispatcher.on("bridge_event", ({ event, data }) => state.handleBridgeEvent(event, data));
    wsServer = new BridgeWebSocketServer(dispatcher, state, { host: "127.0.0.1", port: 0, pingIntervalMs: 5_000 });
    await wsServer.start();
    mockBridge = await startMockBridge({ port: wsServer.getPort(), host: "127.0.0.1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    server = createMcpServer(dispatcher, state);
    await server.connect(serverTransport);
    client = new Client({ name: "pixel-motion-test", version: "1.0.0" }, { capabilities: {} });
    await client.connect(clientTransport);
    await client.callTool({ name: "new_sprite", arguments: { width: 8, height: 4 } });
  });

  afterEach(async () => {
    if (mockBridge) await mockBridge.stop();
    await stopMockBridge();
    await wsServer.close();
    await client.close();
    await server.close();
    await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
  });

  it("inserts crisp tween frames while retaining both source keyframes", async () => {
    const sourcePaint: any = await client.callTool({ name: "set_pixels", arguments: { frameNumber: 1, pixels: [{ x: 1, y: 1, color: "#FF0000FF" }, { x: 2, y: 1, color: "#FF0000FF" }] } });
    expect(sourcePaint.isError, JSON.stringify(sourcePaint.content)).toBeUndefined();
    const created: any = await client.callTool({ name: "create_frame", arguments: { afterFrame: 1 } });
    expect(created.isError, JSON.stringify(created.content)).toBeUndefined();
    const targetPaint: any = await client.callTool({ name: "set_pixels", arguments: { frameNumber: 2, pixels: [{ x: 5, y: 1, color: "#FF0000FF" }, { x: 6, y: 1, color: "#FF0000FF" }] } });
    expect(targetPaint.isError, JSON.stringify(targetPaint.content)).toBeUndefined();
    const initialTarget: any = await client.callTool({ name: "get_pixel_grid", arguments: { frameIndex: 2, format: "hex" } });
    expect(text(initialTarget).grid[1][5]).toBe("#FF0000FF");
    const tween: any = await client.callTool({ name: "create_pixel_art_tween", arguments: { fromFrame: 1, toFrame: 2, inBetweenFrames: 1, easing: "linear" } });
    expect(tween.isError).toBeUndefined();
    expect(text(tween)).toMatchObject({ targetFrameAfterInsertion: 3, reviewRequired: true, generatedFrames: [{ frameNumber: 2, movedClusters: 1 }] });
    const tweenGrid: any = await client.callTool({ name: "get_pixel_grid", arguments: { frameIndex: 2, format: "hex" } });
    expect(text(tweenGrid).grid[1][3]).toBe("#FF0000FF");
    expect(text(tweenGrid).grid[1][4]).toBe("#FF0000FF");
    const targetGrid: any = await client.callTool({ name: "get_pixel_grid", arguments: { frameIndex: 3, format: "hex" } });
    expect(text(targetGrid).grid[1][5]).toBe("#FF0000FF");
    expect(text(targetGrid).grid[1][6]).toBe("#FF0000FF");
  });

  it("inserts a directional smear between untouched keyframes", async () => {
    await client.callTool({ name: "set_pixel", arguments: { frameNumber: 1, x: 1, y: 2, color: "#00FFFFFF" } });
    await client.callTool({ name: "create_frame", arguments: { afterFrame: 1 } });
    await client.callTool({ name: "set_pixel", arguments: { frameNumber: 2, x: 6, y: 2, color: "#00FFFFFF" } });
    const smear: any = await client.callTool({ name: "create_smear_frame", arguments: { fromFrame: 1, toFrame: 2, stretch: 4 } });
    expect(smear.isError).toBeUndefined();
    expect(text(smear)).toMatchObject({ frameNumber: 2, targetFrameAfterInsertion: 3, motion: { x: 5, y: 0 }, keyframesPreserved: true });
    const smearGrid: any = await client.callTool({ name: "get_pixel_grid", arguments: { frameIndex: 2, format: "hex" } });
    expect(text(smearGrid).grid[2].filter((color: string) => color === "#00FFFFFF").length).toBeGreaterThan(1);
    const targetGrid: any = await client.callTool({ name: "get_pixel_grid", arguments: { frameIndex: 3, format: "hex" } });
    expect(text(targetGrid).grid[2][6]).toBe("#00FFFFFF");
  });

  it("requires a current native human approval receipt before a final export", async () => {
    const blocked: any = await client.callTool({
      name: "export_animation",
      arguments: { format: "gif", outputPath: "approval-gate.gif", final: true },
    });
    expect(blocked.isError).toBe(true);
    expect(text(blocked).error).toContain("humanApprovalId");

    const approval: any = await client.callTool({
      name: "request_human_approval",
      arguments: { summary: "Confirm the final animation export.", frameNumber: 1 },
    });
    expect(approval.isError).toBeUndefined();
    expect(text(approval).decision).toBe("approved");

    const exported: any = await client.callTool({
      name: "export_animation",
      arguments: {
        format: "gif",
        outputPath: "approval-gate.gif",
        final: true,
        humanApprovalId: text(approval).approvalId,
      },
    });
    expect(exported.isError, JSON.stringify(exported.content)).toBeUndefined();
    expect(text(exported).humanApproval.decision).toBe("approved");
  });

  it("exports Godot SpriteFrames and engine metadata with timing, pivot, and events", async () => {
    const outputDirectory = await fs.mkdtemp(path.join(process.cwd(), "test", ".tmp-engine-export-"));
    temporaryDirectories.push(outputDirectory);
    await client.callTool({ name: "create_slice", arguments: { name: "pivot", bounds: { x: 0, y: 0, width: 8, height: 4 }, pivot: { x: 3, y: 2 } } });
    await client.callTool({ name: "create_tag", arguments: { name: "idle", fromFrame: 1, toFrame: 1, repeats: 0 } });
    const result: any = await client.callTool({
      name: "export_engine_assets",
      arguments: {
        outputDirectory,
        baseName: "unit",
        godotTexturePath: "res://unit_spritesheet.png",
        events: [{ frameNumber: 1, name: "footstep", payload: "left" }],
      },
    });
    expect(result.isError, JSON.stringify(result.content)).toBeUndefined();
    const metadata = JSON.parse(await fs.readFile(path.join(outputDirectory, "unit.engine.json"), "utf8"));
    const tres = await fs.readFile(path.join(outputDirectory, "unit.tres"), "utf8");
    expect(metadata.pivot).toEqual({ x: 3, y: 2 });
    expect(metadata.events).toEqual([{ frameNumber: 1, name: "footstep", payload: "left" }]);
    expect(metadata.tags[0].playback.frames[0].durationMs).toBe(100);
    expect(tres).toContain('type="SpriteFrames"');
    expect(tres).toContain('res://unit_spritesheet.png');
  });

  it("batch-exports every nested Aseprite file at requested scales and restores the original document", async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), "test", ".tmp-batch-export-"));
    temporaryDirectories.push(root);
    const inputDirectory = path.join(root, "input", "units");
    const outputDirectory = path.join(root, "output");
    await fs.mkdir(inputDirectory, { recursive: true });
    await fs.mkdir(outputDirectory, { recursive: true });
    await fs.writeFile(path.join(inputDirectory, "soldier.aseprite"), "mock", "utf8");
    const before: any = await client.callTool({ name: "aseprite_status", arguments: {} });
    const result: any = await client.callTool({
      name: "batch_export_sprites",
      arguments: { inputDirectory: path.join(root, "input"), outputDirectory, format: "spritesheet", scales: [1, 2] },
    });
    expect(result.isError, JSON.stringify(result.content)).toBeUndefined();
    expect(text(result)).toMatchObject({ filesProcessed: 1, originalDocumentRestored: true });
    expect(text(result).outputs).toHaveLength(2);
    const after: any = await client.callTool({ name: "aseprite_status", arguments: {} });
    expect(text(after).filename).toBe(text(before).filename);
  });
});
