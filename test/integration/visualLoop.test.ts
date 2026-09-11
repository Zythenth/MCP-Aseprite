// test/integration/visualLoop.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { CommandDispatcher } from "../../src/bridge/dispatcher.js";
import { BridgeState } from "../../src/bridge/state.js";
import { BridgeWebSocketServer } from "../../src/bridge/wsServer.js";
import { startMockBridge, stopMockBridge, MockBridgeInstance } from "../../src/mock/index.js";
import { decodePngBase64Sync } from "../../src/image/png.js";

describe("Visual Loop End-to-End MCP Integration Tests", () => {
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

    mockBridge = await startMockBridge({
      port: wsServer.getPort(),
      host: "127.0.0.1",
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    server = createMcpServer(dispatcher, state);
    await server.connect(serverTransport);

    client = new Client({ name: "gemini-visual-client", version: "1.0.0" }, { capabilities: {} });
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

  it("completes full visual creation loop: inspect -> paint batch -> preview -> undo -> verify", async () => {
    // 1. inspect_sprite
    const inspectRes: any = await client.callTool({
      name: "inspect_sprite",
      arguments: { scale: 4, format: "compact" },
    });
    expect(inspectRes.isError).toBeUndefined();
    expect(inspectRes.content).toHaveLength(2);
    expect(inspectRes.content[0].type).toBe("image");
    expect(inspectRes.content[0].mimeType).toBe("image/png");
    expect(typeof inspectRes.content[0].data).toBe("string");

    const inspectMeta = JSON.parse(inspectRes.content[1].text);
    expect(inspectMeta.width).toBe(32);
    expect(inspectMeta.height).toBe(32);
    expect(inspectMeta.revision).toBe(1);

    // 2. get_pixel_grid
    const gridRes: any = await client.callTool({
      name: "get_pixel_grid",
      arguments: { format: "hex" },
    });
    const gridData = JSON.parse(gridRes.content[0].text);
    expect(gridData.width).toBe(32);
    expect(gridData.grid[0][0]).toBe("#00000000");

    // 3. get_canvas with nearest-neighbor 8x scaling
    const canvasRes: any = await client.callTool({
      name: "get_canvas",
      arguments: { scale: 8 },
    });
    expect(canvasRes.content[0].type).toBe("image");
    const decodedCanvas = decodePngBase64Sync(canvasRes.content[0].data);
    expect(decodedCanvas.width).toBe(256);
    expect(decodedCanvas.height).toBe(256);

    // 4. get_pixel_grid_preview with grid lines and rulers
    const previewRes: any = await client.callTool({
      name: "get_pixel_grid_preview",
      arguments: { scale: 16, showGrid: true, showCoordinates: true },
    });
    expect(previewRes.content[0].type).toBe("image");
    expect(previewRes.content[0].mimeType).toBe("image/png");

    // 5. Batch paint 64 red pixels with set_pixels and returnPreview = true
    const redBlock: Array<{ x: number; y: number; color: string }> = [];
    for (let y = 8; y < 16; y++) {
      for (let x = 8; x < 16; x++) {
        redBlock.push({ x, y, color: "#FF0000FF" });
      }
    }

    const paintRes: any = await client.callTool({
      name: "set_pixels",
      arguments: {
        pixels: redBlock,
        returnPreview: true,
        previewScale: 2,
      },
    });
    expect(paintRes.content).toHaveLength(2); // Image + Text
    expect(paintRes.content[0].type).toBe("image");
    const paintMeta = JSON.parse(paintRes.content[1].text);
    expect(paintMeta.success).toBe(true);
    expect(paintMeta.pixelsModified).toBe(64);
    expect(paintMeta.bounds).toEqual({ x: 8, y: 8, width: 8, height: 8 });
    expect(paintMeta.revision).toBe(2);

    // 6. Inspect to confirm pixels are red
    const checkGridRes: any = await client.callTool({
      name: "get_pixel_grid",
      arguments: {
        region: { x: 8, y: 8, width: 8, height: 8 },
        format: "hex",
      },
    });
    const subGrid = JSON.parse(checkGridRes.content[0].text);
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        expect(subGrid.grid[r][c]).toBe("#FF0000FF");
      }
    }

    // 7. Atomic Undo
    const undoRes: any = await client.callTool({
      name: "undo",
      arguments: {},
    });
    const undoData = JSON.parse(undoRes.content[0].text);
    expect(undoData.success).toBe(true);

    // 8. Confirm restoration
    const restoredGridRes: any = await client.callTool({
      name: "get_pixel_grid",
      arguments: {
        region: { x: 8, y: 8, width: 8, height: 8 },
        format: "hex",
      },
    });
    const restoredGrid = JSON.parse(restoredGridRes.content[0].text);
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        expect(restoredGrid.grid[r][c]).toBe("#00000000");
      }
    }
  });
});
