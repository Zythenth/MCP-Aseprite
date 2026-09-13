import { beforeEach, describe, expect, it } from "vitest";
import { MockAsepriteEngine } from "../../src/mock/mockEngine.js";

describe("Extended structural sprite tools", () => {
  let engine: MockAsepriteEngine;

  beforeEach(() => {
    engine = new MockAsepriteEngine(8, 8);
  });

  it("creates, moves, changes opacity, links, unlinks, and deletes cels", () => {
    engine.executeCommand("create_frame", { duration: 100 });
    const initialRevision = engine.revision;
    const created = engine.executeCommand("create_cel", {
      frameNumber: 2, x: 2, y: 1, width: 3, height: 2, color: "#FF0000FF", returnPreview: true,
    });
    expect(created.revision).toBe(initialRevision + 1);
    expect(created.bounds).toEqual({ x: 2, y: 1, width: 3, height: 2 });
    expect(created.pngBase64).toBeTypeOf("string");

    const moved = engine.executeCommand("set_cel_position", { frameNumber: 2, dx: -1, dy: 2 });
    expect(moved.position).toEqual({ x: 1, y: 3 });
    expect(engine.executeCommand("set_cel_opacity", { frameNumber: 2, opacity: 128 }).opacity).toBe(128);

    engine.executeCommand("link_cel", { sourceFrame: 2, targetFrame: 1, replaceExisting: true });
    expect(engine.executeCommand("get_cel", { frameNumber: 2 }).cel.isLinked).toBe(true);
    expect(engine.executeCommand("unlink_cel", { frameNumber: 1 }).linked).toBe(false);
    expect(engine.executeCommand("delete_cel", { frameNumber: 2, confirm: true }).success).toBe(true);
    expect(engine.executeCommand("get_cel", { frameNumber: 2 }).hasCel).toBe(false);
  });

  it("links cels across layers and rejects linking a cel to itself", () => {
    engine.executeCommand("create_frame", { duration: 100 });
    engine.executeCommand("create_cel", { layerName: "Layer 1", frameNumber: 2, color: "#00FF00FF" });
    expect(() => engine.executeCommand("link_cel", {
      sourceLayerName: "Layer 1", sourceFrame: 2,
      targetLayerName: "Layer 1", targetFrame: 2,
      replaceExisting: true,
    })).toThrow(/must be different/);

    engine.executeCommand("create_layer", { name: "Other" });
    engine.executeCommand("link_cel", {
      sourceLayerName: "Layer 1", sourceFrame: 2,
      targetLayerName: "Other", targetFrame: 1,
    });
    const source = engine.executeCommand("get_cel", { layerName: "Layer 1", frameNumber: 2 });
    expect(source.cel.linkedCels).toContainEqual({ layer: "Other", frameNumber: 1 });
    expect(source.cel.linkedFrames).toEqual([]);
    expect(engine.executeCommand("unlink_cel", { layerName: "Other", frameNumber: 1 }).linked).toBe(false);
  });

  it("maintains recursive groups and prevents hierarchy cycles", () => {
    engine.executeCommand("create_group", { name: "Characters" });
    engine.executeCommand("create_group", { name: "Body" });
    engine.executeCommand("move_layer_to_group", { name: "Body", parentGroup: "Characters" });
    engine.executeCommand("move_layer_to_group", { name: "Layer 1", parentGroup: "Body" });
    const tree = engine.executeCommand("list_layer_tree", {});
    expect(tree.layers.find((node: any) => node.name === "Characters").children[0].name).toBe("Body");
    expect(() => engine.executeCommand("move_layer_to_group", { name: "Characters", parentGroup: "Body" })).toThrow(/descendants/);
    const ungrouped = engine.executeCommand("ungroup_layer", { name: "Body" });
    expect(ungrouped.children).toContain("Layer 1");
  });

  it("creates and updates slices with local pivot and nine-patch geometry", () => {
    const created = engine.executeCommand("create_slice", {
      name: "button", bounds: { x: 1, y: 1, width: 6, height: 6 },
      center: { x: 2, y: 2, width: 2, height: 2 }, pivot: { x: 3, y: 5 }, color: "#123456",
    });
    expect(created.slice.center).toEqual({ x: 2, y: 2, width: 2, height: 2 });
    const updated = engine.executeCommand("update_slice", { name: "button", newName: "button-9", pivot: null });
    expect(updated.slice.name).toBe("button-9");
    expect(updated.slice.pivot).toBeNull();
    expect(engine.executeCommand("list_slices", {}).slices).toHaveLength(1);
    expect(engine.executeCommand("delete_slice", { name: "button-9", confirm: true }).deleted).toBe("button-9");
  });

  it("persists boolean rectangular selections", () => {
    engine.executeCommand("set_selection", { operation: "replace", x: 1, y: 1, width: 4, height: 4 });
    engine.executeCommand("set_selection", { operation: "subtract", x: 2, y: 2, width: 2, height: 2 });
    expect(engine.selectionPixels.size).toBe(12);
    const current = engine.executeCommand("get_selection", {});
    expect(current.bounds).toEqual({ x: 1, y: 1, width: 4, height: 4 });
    engine.executeCommand("invert_selection", {});
    expect(engine.selectionPixels.size).toBe(52);
    expect(engine.executeCommand("clear_selection", {}).isEmpty).toBe(true);
  });

  it("edits blend modes and performs merge-down and flatten with one revision each", () => {
    engine.executeCommand("create_layer", { name: "Top" });
    const blendRevision = engine.revision;
    const blend = engine.executeCommand("set_layer_blend_mode", { layerName: "Top", blendMode: "multiply" });
    expect(blend.revision).toBe(blendRevision + 1);

    const mergeRevision = engine.revision;
    const merged = engine.executeCommand("merge_down_layer", { layerName: "Top", confirm: true, returnPreview: true });
    expect(merged.revision).toBe(mergeRevision + 1);
    expect(merged.pngBase64).toBeTypeOf("string");

    engine.executeCommand("create_layer", { name: "Again" });
    const flattenRevision = engine.revision;
    const flattened = engine.executeCommand("flatten_layers", { confirm: true });
    expect(flattened.revision).toBe(flattenRevision + 1);
    expect(engine.layers).toHaveLength(1);
  });

  it("returns structured incremental changes without a false journal gap", () => {
    const base = engine.revision;
    engine.executeCommand("create_slice", { name: "slice", bounds: { x: 0, y: 0, width: 2, height: 2 } });
    const diff = engine.executeCommand("get_changes_since", { sinceRevision: base, sessionId: engine.sessionId });
    expect(diff.gap).toBe(false);
    expect(diff.resyncRequired).toBe(false);
    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0].scope).toBe("slices");
  });

  it("creates reusable tiles and writes flagged tilemap references", () => {
    engine.executeCommand("create_tileset", { name: "terrain", tileWidth: 2, tileHeight: 2, tileCount: 2 });
    engine.executeCommand("set_tile_pixels", {
      tilesetIndex: 0, tileIndex: 1,
      pixels: [{ x: 0, y: 0, color: "#FF0000FF" }], returnPreview: true,
    });
    engine.executeCommand("create_tilemap_layer", { name: "Map", tilesetIndex: 0 });
    const placed = engine.executeCommand("set_tiles", {
      layerName: "Map", tiles: [{ x: 0, y: 0, tileIndex: 1, xFlip: true }], returnPreview: true,
    });
    expect(placed.tilesChanged).toBe(1);
    expect(placed.pngBase64).toBeTypeOf("string");
    const map = engine.executeCommand("get_tilemap", { layerName: "Map" });
    expect(map.tiles[0][0]).toEqual({ tileIndex: 1, xFlip: true, yFlip: false, diagonalFlip: false });
    expect(engine.getCompositeBuffer()[1] >>> 0).toBe(0xff0000ff);
    expect(() => engine.executeCommand("delete_tileset", { tilesetIndex: 0, confirm: true })).toThrow(/references/);
  });

  it("bounds tileset allocation and leaves no partial tilemap after invalid writes", () => {
    expect(() => engine.executeCommand("create_tileset", {
      name: "too-large", tileWidth: 1024, tileHeight: 1024, tileCount: 17,
    })).toThrow(/pixel safety limit/);

    engine.executeCommand("create_tileset", { name: "safe", tileWidth: 2, tileHeight: 2, tileCount: 2 });
    const tileBefore = engine.executeCommand("get_tile", { tilesetIndex: 0, tileIndex: 1 }).pngBase64;
    expect(() => engine.executeCommand("set_tile_pixels", {
      tilesetIndex: 0, tileIndex: 1,
      pixels: [{ x: 0, y: 0, color: "#FF0000FF" }, { x: 99, y: 99, color: "#00FF00FF" }],
    })).toThrow(/outside tile bounds/);
    expect(engine.executeCommand("get_tile", { tilesetIndex: 0, tileIndex: 1 }).pngBase64).toBe(tileBefore);

    engine.executeCommand("create_tilemap_layer", { name: "Map", tilesetIndex: 0 });
    engine.executeCommand("create_frame", { duration: 100 });
    expect(() => engine.executeCommand("set_tiles", {
      layerName: "Map", frameNumber: 2,
      tiles: [
        { x: 0, y: 0, tileIndex: 1 },
        { x: 999, y: 999, tileIndex: 1 },
      ],
    })).toThrow(/outside tilemap bounds/);
    expect(engine.executeCommand("get_tilemap", { layerName: "Map", frameNumber: 2 })).toMatchObject({ hasCel: false });
  });

  it("exports tag playback order and explicit frame ranges as bounded sheets", () => {
    engine.executeCommand("create_frame", { duration: 100 });
    engine.executeCommand("create_frame", { duration: 100 });
    engine.executeCommand("create_tag", {
      name: "bounce", fromFrame: 1, toFrame: 3, direction: "pingpong_reverse",
    });
    const tagged = engine.executeCommand("export_sprite_sheet", {
      outputPath: "bounce.png", tagName: "bounce", layout: "grid", columns: 2, spacing: 1, scale: 2,
    });
    expect(tagged.frameNumbers).toEqual([3, 2, 1, 2]);
    expect(tagged).toMatchObject({ columns: 2, rows: 2, width: 33, height: 33 });

    const ranged = engine.executeCommand("export_sprite_sheet", {
      outputPath: "range.png", fromFrame: 2, toFrame: 3, layout: "vertical", layerNames: ["Layer 1"],
    });
    expect(ranged.frameNumbers).toEqual([2, 3]);
    expect(ranged).toMatchObject({ columns: 1, rows: 2, width: 8, height: 16 });
    expect(() => engine.executeCommand("export_sprite_sheet", {
      outputPath: "bad.png", tagName: "bounce", fromFrame: 1, toFrame: 2,
    })).toThrow(/mutually exclusive/);
  });
});
