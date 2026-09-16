import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../../src/mcp/server.js";

async function listNames(options: Parameters<typeof createMcpServer>[2]): Promise<string[]> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(undefined, undefined, options);
  const client = new Client({ name: "tool-policy-test", version: "1.0.0" }, { capabilities: {} });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return (await client.listTools()).tools.map((tool) => tool.name);
  } finally {
    await client.close();
    await server.close();
  }
}

describe("MCP tool exposure policy", () => {
  it("keeps core status while limiting optional toolsets", async () => {
    const names = await listNames({ toolsets: ["core", "visual"] });
    expect(names).toContain("aseprite_status");
    expect(names).toContain("inspect_sprite");
    expect(names).not.toContain("set_pixels");
    expect(names).not.toContain("create_layer");
  });

  it("removes Aseprite mutations in read-only mode but preserves inspection", async () => {
    const names = await listNames({ readOnly: true, toolsets: ["core", "visual", "editing", "layers", "files", "animation", "pixel-art"] });
    expect(names).toContain("get_canvas");
    expect(names).toContain("list_layers");
    expect(names).toContain("lint_pixel_art");
    expect(names).toContain("open_sprite");
    expect(names).toContain("load_reference_image");
    expect(names).toContain("inspect_animation");
    expect(names).toContain("render_animation_preview");
    expect(names).not.toContain("set_pixel");
    expect(names).not.toContain("create_layer");
    expect(names).not.toContain("save_sprite");
    expect(names).not.toContain("export_animation");
    expect(names).not.toContain("apply_ordered_dither");
    expect(names).not.toContain("start_live_painting");
    expect(names).toContain("get_live_painting_status");
  });
});
