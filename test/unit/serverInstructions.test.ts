import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { PIXEL_ART_WORKFLOW_INSTRUCTIONS } from "../../src/mcp/instructions.js";

describe("MCP server pixel-art instructions", () => {
  it("delivers the preflight workflow during MCP initialization", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer();
    const client = new Client(
      { name: "pixel-art-instructions-test", version: "1.0.0" },
      { capabilities: {} }
    );

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const instructions = client.getInstructions();
      expect(instructions).toBe(PIXEL_ART_WORKFLOW_INSTRUCTIONS);
      expect(instructions).toContain("Define a compact working palette before rendering details");
      expect(instructions).toContain("readable silhouette");
      expect(instructions).toContain("pillow shading");
      expect(instructions).toContain("transparent index");
      expect(instructions).toContain("external AA must account for the known background");
      expect(instructions).toContain("Test tiles repeated on both axes");
      expect(instructions).toContain("anticipation, clear action, arcs, timing and spacing");
      expect(instructions).toContain("padding, and edge extrusion requirements");
      expect(instructions).toContain("Inspect zoomed-in for cluster craft, at 1x for readability");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
