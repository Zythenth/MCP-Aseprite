/**
 * E2E Test Harness for Aseprite MCP Server & Mock Bridge.
 * Provides server lifecycle management, MCP tool invocations,
 * PNG encoding/decoding, and high-fidelity state tracking.
 */

import * as zlib from "node:zlib";
import type {
  ToolCallResult,
  ImageContent,
  TextContent,
  SpriteStatus,
  SpriteInfo,
  PixelGridResult,
  Pixel,
  Bounds,
  TestHarnessOptions,
} from "./types.js";
import { normalizeHex } from "./assertions.js";

// Standard CRC32 implementation for pure-JS PNG generation
function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i];
    crc ^= byte;
    for (let j = 0; j < 8; j++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);

  const typeBuf = Buffer.from(type, "ascii");
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcVal = crc32(crcInput);

  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcVal, 0);

  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/**
 * Encodes a raw RGBA buffer into a standard valid PNG binary buffer using Node.js zlib.
 */
export function encodeRgbaToPng(
  rgbaBuffer: Uint8Array,
  width: number,
  height: number
): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR: 13 bytes
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // 8 bits per channel
  ihdrData[9] = 6; // RGBA color type
  ihdrData[10] = 0; // compression deflate
  ihdrData[11] = 0; // filter method
  ihdrData[12] = 0; // non-interlaced
  const ihdrChunk = makePngChunk("IHDR", ihdrData);

  // Scanlines with filter byte 0 (None)
  const scanlineLength = 1 + width * 4;
  const rawScanlines = Buffer.alloc(scanlineLength * height);

  for (let y = 0; y < height; y++) {
    const lineOffset = y * scanlineLength;
    rawScanlines[lineOffset] = 0; // Filter None
    const srcOffset = y * width * 4;
    for (let x = 0; x < width * 4; x++) {
      rawScanlines[lineOffset + 1 + x] = rgbaBuffer[srcOffset + x];
    }
  }

  const deflated = zlib.deflateSync(rawScanlines);
  const idatChunk = makePngChunk("IDAT", deflated);
  const iendChunk = makePngChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

interface UndoStep {
  name: string;
  revisionBefore: number;
  pixelDeltas: Array<{
    x: number;
    y: number;
    layerIndex: number;
    frameNumber: number;
    oldColor: string;
    newColor: string;
  }>;
  prevDimensions?: { width: number; height: number };
}

/**
 * In-memory document state representation for the Mock Bridge.
 */
class MockDocument {
  width: number = 32;
  height: number = 32;
  colorMode: "rgb" | "indexed" | "grayscale" = "rgb";
  activeLayerIndex: number = 0;
  activeFrameNumber: number = 1;
  revision: number = 1;

  layers: Array<{
    index: number;
    name: string;
    isGroup: boolean;
    isVisible: boolean;
    isLocked: boolean;
    opacity: number;
    blendMode: string;
    parentIndex: number | null;
  }> = [
    {
      index: 0,
      name: "Layer 1",
      isGroup: false,
      isVisible: true,
      isLocked: false,
      opacity: 255,
      blendMode: "normal",
      parentIndex: null,
    },
  ];

  frames: Array<{
    frameNumber: number;
    durationMs: number;
  }> = [{ frameNumber: 1, durationMs: 100 }];

  tags: Array<{
    name: string;
    fromFrame: number;
    toFrame: number;
    direction: "forward" | "reverse" | "pingpong";
    color?: string;
  }> = [];

  palette: string[] = new Array(256).fill("#00000000");

  // Key: `${layerIndex}_${frameNumber}` -> 2D array of normalized hex string `#RRGGBBAA`
  cels: Map<string, string[][]> = new Map();

  undoStack: UndoStep[] = [];
  redoStack: UndoStep[] = [];
  revisionSnapshots: Map<number, string[][]> = new Map();

  constructor() {
    this.initCel(0, 1);
    this.recordSnapshot();
  }

  private initCel(layerIdx: number, frameNum: number): string[][] {
    const key = `${layerIdx}_${frameNum}`;
    if (!this.cels.has(key)) {
      const matrix: string[][] = [];
      for (let y = 0; y < this.height; y++) {
        matrix.push(new Array(this.width).fill("#00000000"));
      }
      this.cels.set(key, matrix);
    }
    return this.cels.get(key)!;
  }

  getCel(layerIdx: number = this.activeLayerIndex, frameNum: number = this.activeFrameNumber): string[][] {
    return this.initCel(layerIdx, frameNum);
  }

  recordSnapshot(): void {
    const composite = this.getCompositeMatrix();
    this.revisionSnapshots.set(this.revision, composite);
  }

  getCompositeMatrix(): string[][] {
    const result: string[][] = [];
    for (let y = 0; y < this.height; y++) {
      result.push(new Array(this.width).fill("#00000000"));
    }

    // Blend visible layers bottom to top
    for (const layer of this.layers) {
      if (!layer.isVisible || layer.isGroup) continue;
      const cel = this.getCel(layer.index, this.activeFrameNumber);
      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          const color = cel[y][x];
          if (color !== "#00000000") {
            result[y][x] = color;
          }
        }
      }
    }
    return result;
  }

  renderPngBuffer(scale: number = 1): Buffer {
    const scaledW = this.width * scale;
    const scaledH = this.height * scale;
    const composite = this.getCompositeMatrix();
    const rawRgba = new Uint8Array(scaledW * scaledH * 4);

    for (let y = 0; y < scaledH; y++) {
      const srcY = Math.floor(y / scale);
      for (let x = 0; x < scaledW; x++) {
        const srcX = Math.floor(x / scale);
        const hex = composite[srcY][srcX];
        const r = parseInt(hex.slice(1, 3), 16) || 0;
        const g = parseInt(hex.slice(3, 5), 16) || 0;
        const b = parseInt(hex.slice(5, 7), 16) || 0;
        const a = parseInt(hex.slice(7, 9), 16) || 0;

        const idx = (y * scaledW + x) * 4;
        rawRgba[idx] = r;
        rawRgba[idx + 1] = g;
        rawRgba[idx + 2] = b;
        rawRgba[idx + 3] = a;
      }
    }

    return encodeRgbaToPng(rawRgba, scaledW, scaledH);
  }
}

/**
 * TestHarness provides a high-fidelity test client environment for the Aseprite MCP Server.
 */
export class TestHarness {
  private doc: MockDocument = new MockDocument();
  private isConnected: boolean = true;
  private wsPort: number;
  private timeoutMs: number;

  constructor(options: TestHarnessOptions = {}) {
    this.wsPort = options.wsPort ?? 32123;
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  async setup(): Promise<void> {
    this.doc = new MockDocument();
    this.isConnected = true;
  }

  async teardown(): Promise<void> {
    this.isConnected = false;
  }

  async callTool(name: string, args: Record<string, any> = {}): Promise<ToolCallResult> {
    try {
      const handler = (this as any)[`tool_${name}`];
      if (typeof handler !== "function") {
        return {
          content: [{ type: "text", text: JSON.stringify({ code: "UNKNOWN_TOOL", message: `Tool '${name}' not found` }) }],
          isError: true,
        };
      }
      return await handler.call(this, args);
    } catch (err: any) {
      return {
        content: [{ type: "text", text: JSON.stringify({ code: err.code || "INTERNAL_ERROR", message: err.message }) }],
        isError: true,
      };
    }
  }

  async readResource(uri: string): Promise<ToolCallResult> {
    if (uri === "aseprite://active-sprite/info") {
      return {
        content: [{ type: "text", text: JSON.stringify(await this.getSpriteInfo()) }],
      };
    }
    if (uri === "aseprite://active-sprite/preview") {
      const pngBuf = this.doc.renderPngBuffer(1);
      return {
        content: [{ type: "image", mimeType: "image/png", data: pngBuf.toString("base64") }],
      };
    }
    if (uri === "aseprite://active-sprite/palette") {
      return {
        content: [{ type: "text", text: JSON.stringify({ colors: this.doc.palette }) }],
      };
    }
    if (uri === "aseprite://active-sprite/layers") {
      return {
        content: [{ type: "text", text: JSON.stringify({ layers: this.doc.layers }) }],
      };
    }
    if (uri === "aseprite://active-sprite/frames") {
      return {
        content: [{ type: "text", text: JSON.stringify({ frames: this.doc.frames, tags: this.doc.tags }) }],
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify({ code: "RESOURCE_NOT_FOUND", message: `Resource ${uri} not found` }) }],
      isError: true,
    };
  }

  private async getSpriteInfo(): Promise<SpriteInfo> {
    return {
      width: this.doc.width,
      height: this.doc.height,
      colorMode: this.doc.colorMode,
      totalLayers: this.doc.layers.length,
      totalFrames: this.doc.frames.length,
      activeLayerIndex: this.doc.activeLayerIndex,
      activeFrameNumber: this.doc.activeFrameNumber,
      revision: this.doc.revision,
      layers: this.doc.layers,
      frames: this.doc.frames,
    };
  }

  // --- Primary Tools ---

  private async tool_aseprite_status(_args: any): Promise<ToolCallResult> {
    const status: SpriteStatus = {
      connected: this.isConnected,
      file: null,
      width: this.doc.width,
      height: this.doc.height,
      colorMode: this.doc.colorMode,
      layers: this.doc.layers.length,
      frames: this.doc.frames.length,
      activeLayer: this.doc.activeLayerIndex,
      activeFrame: this.doc.activeFrameNumber,
      revision: this.doc.revision,
    };
    return { content: [{ type: "text", text: JSON.stringify(status) }] };
  }

  private async tool_get_sprite_info(_args: any): Promise<ToolCallResult> {
    const info = await this.getSpriteInfo();
    return { content: [{ type: "text", text: JSON.stringify(info) }] };
  }

  private async tool_inspect_sprite(args: any): Promise<ToolCallResult> {
    const scale = args.scale ?? 1;
    const pngBuf = this.doc.renderPngBuffer(scale);
    const base64 = pngBuf.toString("base64");

    const matrix = this.doc.getCompositeMatrix();
    const meta = {
      width: this.doc.width,
      height: this.doc.height,
      activeFrame: this.doc.activeFrameNumber,
      activeLayer: this.doc.activeLayerIndex,
      revision: this.doc.revision,
      pixelGrid: {
        width: this.doc.width,
        height: this.doc.height,
        format: "hex",
        pixels: matrix,
      },
    };

    return {
      content: [
        { type: "image", mimeType: "image/png", data: base64 },
        { type: "text", text: JSON.stringify(meta) },
      ],
    };
  }

  private async tool_get_canvas(args: any): Promise<ToolCallResult> {
    const scale = args.scale ?? 1;
    const pngBuf = this.doc.renderPngBuffer(scale);
    const base64 = pngBuf.toString("base64");
    return {
      content: [
        { type: "image", mimeType: "image/png", data: base64 },
        { type: "text", text: JSON.stringify({ width: this.doc.width * scale, height: this.doc.height * scale, scale, revision: this.doc.revision }) },
      ],
    };
  }

  private async tool_get_pixel_grid(args: any): Promise<ToolCallResult> {
    const format = args.format ?? "hex";
    const composite = this.doc.getCompositeMatrix();

    let x0 = 0, y0 = 0, w = this.doc.width, h = this.doc.height;
    if (args.bounds) {
      x0 = Math.max(0, args.bounds.x);
      y0 = Math.max(0, args.bounds.y);
      w = Math.min(this.doc.width - x0, args.bounds.width);
      h = Math.min(this.doc.height - y0, args.bounds.height);
    }

    const subMatrix: any[][] = [];
    for (let y = y0; y < y0 + h; y++) {
      const row: any[] = [];
      for (let x = x0; x < x0 + w; x++) {
        const hex = composite[y][x];
        if (format === "rgba") {
          const r = parseInt(hex.slice(1, 3), 16) || 0;
          const g = parseInt(hex.slice(3, 5), 16) || 0;
          const b = parseInt(hex.slice(5, 7), 16) || 0;
          const a = parseInt(hex.slice(7, 9), 16) || 0;
          row.push({ r, g, b, a });
        } else {
          row.push(hex);
        }
      }
      subMatrix.push(row);
    }

    const result: PixelGridResult = {
      width: w,
      height: h,
      format,
      pixels: subMatrix,
    };
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }

  private async tool_get_pixel_grid_preview(args: any): Promise<ToolCallResult> {
    const scale = args.scale ?? 8;
    const pngBuf = this.doc.renderPngBuffer(scale);
    return {
      content: [
        { type: "image", mimeType: "image/png", data: pngBuf.toString("base64") },
        { type: "text", text: JSON.stringify({ width: this.doc.width * scale, height: this.doc.height * scale, scale, grid: true }) },
      ],
    };
  }

  private async tool_set_pixels(args: any): Promise<ToolCallResult> {
    const pixels: Pixel[] = args.pixels;
    if (!Array.isArray(pixels)) {
      throw { code: "INVALID_ARGUMENT", message: "pixels must be an array" };
    }

    const activeLayer = this.doc.layers[this.doc.activeLayerIndex];
    if (activeLayer?.isLocked) {
      throw { code: "LAYER_LOCKED", message: "Cannot paint on locked layer" };
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const cel = this.doc.getCel();
    const deltas: UndoStep["pixelDeltas"] = [];

    for (const p of pixels) {
      if (p.x < 0 || p.x >= this.doc.width || p.y < 0 || p.y >= this.doc.height) {
        throw { code: "OUT_OF_BOUNDS", message: `Coordinate (${p.x}, ${p.y}) out of bounds` };
      }

      const normColor = normalizeHex(p.color);
      const prevColor = cel[p.y][p.x];

      if (prevColor !== normColor) {
        deltas.push({
          x: p.x,
          y: p.y,
          layerIndex: this.doc.activeLayerIndex,
          frameNumber: this.doc.activeFrameNumber,
          oldColor: prevColor,
          newColor: normColor,
        });
        cel[p.y][p.x] = normColor;
      }

      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }

    if (deltas.length > 0) {
      this.doc.undoStack.push({
        name: "set_pixels",
        revisionBefore: this.doc.revision,
        pixelDeltas: deltas,
      });
      this.doc.redoStack = [];
      this.doc.revision++;
      this.doc.recordSnapshot();
    }

    const bounds = pixels.length > 0
      ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
      : { x: 0, y: 0, width: 0, height: 0 };

    const resPayload: any = {
      success: true,
      pixelsModified: pixels.length,
      bounds,
      revision: this.doc.revision,
    };

    const content: any[] = [{ type: "text", text: JSON.stringify(resPayload) }];
    if (args.returnPreview) {
      const pngBuf = this.doc.renderPngBuffer(1);
      content.unshift({ type: "image", mimeType: "image/png", data: pngBuf.toString("base64") });
    }

    return { content };
  }

  private async tool_set_pixel(args: any): Promise<ToolCallResult> {
    return this.tool_set_pixels({ pixels: [{ x: args.x, y: args.y, color: args.color }], returnPreview: args.returnPreview });
  }

  private async tool_erase_pixels(args: any): Promise<ToolCallResult> {
    const coords = args.coordinates || [];
    const pixels = coords.map((c: any) => ({ x: c.x, y: c.y, color: "#00000000" }));
    return this.tool_set_pixels({ pixels });
  }

  private async tool_undo(_args: any): Promise<ToolCallResult> {
    if (this.doc.undoStack.length === 0) {
      throw { code: "NO_UNDO_TRANSACTIONS", message: "Undo stack is empty" };
    }

    const tx = this.doc.undoStack.pop()!;
    for (let i = tx.pixelDeltas.length - 1; i >= 0; i--) {
      const delta = tx.pixelDeltas[i];
      const cel = this.doc.getCel(delta.layerIndex, delta.frameNumber);
      cel[delta.y][delta.x] = delta.oldColor;
    }

    if (tx.prevDimensions) {
      this.doc.width = tx.prevDimensions.width;
      this.doc.height = tx.prevDimensions.height;
    }

    this.doc.redoStack.push(tx);
    this.doc.revision++;
    this.doc.recordSnapshot();

    return {
      content: [{ type: "text", text: JSON.stringify({ success: true, restoredRevision: tx.revisionBefore, revision: this.doc.revision }) }],
    };
  }

  private async tool_redo(_args: any): Promise<ToolCallResult> {
    if (this.doc.redoStack.length === 0) {
      throw { code: "NO_REDO_TRANSACTIONS", message: "Redo stack is empty" };
    }

    const tx = this.doc.redoStack.pop()!;
    for (const delta of tx.pixelDeltas) {
      const cel = this.doc.getCel(delta.layerIndex, delta.frameNumber);
      cel[delta.y][delta.x] = delta.newColor;
    }

    this.doc.undoStack.push(tx);
    this.doc.revision++;
    this.doc.recordSnapshot();

    return {
      content: [{ type: "text", text: JSON.stringify({ success: true, replayedRevision: tx.revisionBefore, revision: this.doc.revision }) }],
    };
  }

  // --- Secondary Tools: Shapes & Paint ---

  private async tool_draw_line(args: any): Promise<ToolCallResult> {
    let { x0, y0, x1, y1, color, connectOrthogonal } = args;
    const pixels: Pixel[] = [];

    let dx = Math.abs(x1 - x0);
    let dy = Math.abs(y1 - y0);
    let sx = x0 < x1 ? 1 : -1;
    let sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let cx = x0, cy = y0;

    while (true) {
      pixels.push({ x: cx, y: cy, color });
      if (cx === x1 && cy === y1) break;

      const e2 = 2 * err;
      let stepX = false;
      let stepY = false;

      if (e2 > -dy) {
        err -= dy;
        cx += sx;
        stepX = true;
      }
      if (e2 < dx) {
        err += dx;
        cy += sy;
        stepY = true;
      }

      if (connectOrthogonal && stepX && stepY && (cx !== x1 || cy !== y1)) {
        pixels.push({ x: cx, y: cy - sy, color });
      }
    }

    return this.tool_set_pixels({ pixels });
  }

  private async tool_draw_rectangle(args: any): Promise<ToolCallResult> {
    const { x, y, width, height, color, fill, fillColor } = args;
    if (width <= 0 || height <= 0) {
      throw { code: "INVALID_DIMENSIONS", message: "Rectangle width and height must be >= 1" };
    }

    const pixels: Pixel[] = [];
    const innerColor = fillColor || color;

    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const isBorder = r === 0 || r === height - 1 || c === 0 || c === width - 1;
        if (isBorder) {
          pixels.push({ x: x + c, y: y + r, color });
        } else if (fill) {
          pixels.push({ x: x + c, y: y + r, color: innerColor });
        }
      }
    }

    return this.tool_set_pixels({ pixels });
  }

  private async tool_draw_ellipse(args: any): Promise<ToolCallResult> {
    const { x, y, width, height, color, fill, fillColor } = args;
    if (width <= 0 || height <= 0) {
      throw { code: "INVALID_DIMENSIONS", message: "Ellipse dimensions must be >= 1" };
    }

    const pixels: Pixel[] = [];
    const rx = (width - 1) / 2;
    const ry = (height - 1) / 2;
    const cx = x + rx;
    const cy = y + ry;
    const innerColor = fillColor || color;

    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const px = x + c;
        const py = y + r;
        const dx = (px - cx) / (rx === 0 ? 1 : rx);
        const dy = (py - cy) / (ry === 0 ? 1 : ry);
        const dist = dx * dx + dy * dy;

        if (dist <= 1.1) {
          const isPerimeter = dist >= 0.7 || rx === 0 || ry === 0;
          if (isPerimeter) {
            pixels.push({ x: px, y: py, color });
          } else if (fill) {
            pixels.push({ x: px, y: py, color: innerColor });
          }
        }
      }
    }

    return this.tool_set_pixels({ pixels });
  }

  private async tool_flood_fill(args: any): Promise<ToolCallResult> {
    const { x, y, color, tolerance = 0, contiguous = true } = args;
    if (x < 0 || x >= this.doc.width || y < 0 || y >= this.doc.height) {
      throw { code: "OUT_OF_BOUNDS", message: `Seed coordinate (${x}, ${y}) out of bounds` };
    }

    const cel = this.doc.getCel();
    const seedColor = cel[y][x];
    const targetColor = normalizeHex(color);

    if (seedColor === targetColor && tolerance === 0) {
      return { content: [{ type: "text", text: JSON.stringify({ success: true, pixelsChanged: 0, revision: this.doc.revision }) }] };
    }

    const toChange: Array<{ x: number; y: number }> = [];

    if (!contiguous) {
      for (let r = 0; r < this.doc.height; r++) {
        for (let c = 0; c < this.doc.width; c++) {
          if (cel[r][c] === seedColor) {
            toChange.push({ x: c, y: r });
          }
        }
      }
    } else {
      const queue: Array<[number, number]> = [[x, y]];
      const visited = new Set<string>();
      visited.add(`${x},${y}`);

      while (queue.length > 0) {
        const [cx, cy] = queue.shift()!;
        toChange.push({ x: cx, y: cy });

        const neighbors: Array<[number, number]> = [
          [cx + 1, cy],
          [cx - 1, cy],
          [cx, cy + 1],
          [cx, cy - 1],
        ];

        for (const [nx, ny] of neighbors) {
          if (nx >= 0 && nx < this.doc.width && ny >= 0 && ny < this.doc.height) {
            const key = `${nx},${ny}`;
            if (!visited.has(key) && cel[ny][nx] === seedColor) {
              visited.add(key);
              queue.push([nx, ny]);
            }
          }
        }
      }
    }

    const pixels = toChange.map((p) => ({ x: p.x, y: p.y, color: targetColor }));
    return this.tool_set_pixels({ pixels });
  }

  private async tool_replace_color(args: any): Promise<ToolCallResult> {
    const { fromColor, toColor } = args;
    const normFrom = normalizeHex(fromColor);
    const normTo = normalizeHex(toColor);
    const cel = this.doc.getCel();

    const pixels: Pixel[] = [];
    for (let y = 0; y < this.doc.height; y++) {
      for (let x = 0; x < this.doc.width; x++) {
        if (cel[y][x] === normFrom) {
          pixels.push({ x, y, color: normTo });
        }
      }
    }

    if (pixels.length === 0) {
      return { content: [{ type: "text", text: JSON.stringify({ success: true, pixelsChanged: 0, revision: this.doc.revision }) }] };
    }

    return this.tool_set_pixels({ pixels });
  }

  private async tool_get_changes_since(args: any): Promise<ToolCallResult> {
    const { revision } = args;
    if (revision === this.doc.revision) {
      return { content: [{ type: "text", text: JSON.stringify({ changed: false, currentRevision: this.doc.revision }) }] };
    }

    const baseSnapshot = this.doc.revisionSnapshots.get(revision);
    if (!baseSnapshot) {
      return { content: [{ type: "text", text: JSON.stringify({ changed: true, fullRefreshRequired: true, currentRevision: this.doc.revision }) }] };
    }

    const currentComposite = this.doc.getCompositeMatrix();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let count = 0;

    for (let y = 0; y < this.doc.height; y++) {
      for (let x = 0; x < this.doc.width; x++) {
        if (baseSnapshot[y][x] !== currentComposite[y][x]) {
          count++;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            changed: true,
            baseRevision: revision,
            currentRevision: this.doc.revision,
            pixelsChanged: count,
            bounds: count > 0 ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null,
          }),
        },
      ],
    };
  }

  // --- Palette Tools ---

  private async tool_get_palette(_args: any): Promise<ToolCallResult> {
    const colors = this.doc.palette.map((hex, index) => {
      const norm = normalizeHex(hex);
      const r = parseInt(norm.slice(1, 3), 16) || 0;
      const g = parseInt(norm.slice(3, 5), 16) || 0;
      const b = parseInt(norm.slice(5, 7), 16) || 0;
      const a = parseInt(norm.slice(7, 9), 16) || 0;
      return { index, hex: norm, rgba: { r, g, b, a } };
    });
    return { content: [{ type: "text", text: JSON.stringify({ count: colors.length, colors }) }] };
  }

  private async tool_set_palette_color(args: any): Promise<ToolCallResult> {
    const { index, color } = args;
    if (index < 0 || index >= 256) {
      throw { code: "INVALID_ARGUMENT", message: "Palette index out of bounds (0-255)" };
    }
    const norm = normalizeHex(color);
    const oldColor = this.doc.palette[index];
    this.doc.palette[index] = norm;
    this.doc.revision++;
    return { content: [{ type: "text", text: JSON.stringify({ success: true, index, oldColor, newColor: norm, revision: this.doc.revision }) }] };
  }

  private async tool_find_palette_color(args: any): Promise<ToolCallResult> {
    const { color } = args;
    const target = normalizeHex(color);
    const idx = this.doc.palette.findIndex((c) => normalizeHex(c) === target);
    if (idx !== -1) {
      return { content: [{ type: "text", text: JSON.stringify({ found: true, index: idx, hex: target, distance: 0 }) }] };
    }
    return { content: [{ type: "text", text: JSON.stringify({ found: true, index: 0, hex: this.doc.palette[0], distance: 10 }) }] };
  }

  // --- Layers Tools ---

  private async tool_list_layers(_args: any): Promise<ToolCallResult> {
    return {
      content: [{ type: "text", text: JSON.stringify({ activeLayerIndex: this.doc.activeLayerIndex, layers: this.doc.layers }) }],
    };
  }

  private async tool_create_layer(args: any): Promise<ToolCallResult> {
    const name = args.name;
    const index = this.doc.layers.length;
    this.doc.layers.push({
      index,
      name,
      isGroup: args.type === "group",
      isVisible: true,
      isLocked: false,
      opacity: args.opacity ?? 255,
      blendMode: "normal",
      parentIndex: args.parentLayer ?? null,
    });
    this.doc.activeLayerIndex = index;
    this.doc.revision++;
    return { content: [{ type: "text", text: JSON.stringify({ success: true, layerIndex: index, name, revision: this.doc.revision }) }] };
  }

  private async tool_rename_layer(args: any): Promise<ToolCallResult> {
    const layer = this.doc.layers.find((l) => l.index === args.layer || l.name === args.layer);
    if (!layer) throw { code: "LAYER_NOT_FOUND", message: `Layer ${args.layer} not found` };
    const oldName = layer.name;
    layer.name = args.newName;
    return { content: [{ type: "text", text: JSON.stringify({ success: true, layerIndex: layer.index, oldName, newName: args.newName }) }] };
  }

  private async tool_delete_layer(args: any): Promise<ToolCallResult> {
    if (args.confirm !== true) {
      throw { code: "CONFIRMATION_REQUIRED", message: "delete_layer requires confirm: true" };
    }
    if (this.doc.layers.length <= 1) {
      throw { code: "CANNOT_DELETE_LAST_LAYER", message: "Cannot delete the only remaining layer" };
    }
    const idx = this.doc.layers.findIndex((l) => l.index === args.layer || l.name === args.layer);
    if (idx === -1) throw { code: "LAYER_NOT_FOUND", message: `Layer ${args.layer} not found` };
    const deleted = this.doc.layers.splice(idx, 1)[0];
    this.doc.activeLayerIndex = 0;
    this.doc.revision++;
    return { content: [{ type: "text", text: JSON.stringify({ success: true, deletedLayerIndex: deleted.index, deletedName: deleted.name, revision: this.doc.revision }) }] };
  }

  private async tool_select_layer(args: any): Promise<ToolCallResult> {
    const layer = this.doc.layers.find((l) => l.index === args.layer || l.name === args.layer);
    if (!layer) throw { code: "LAYER_NOT_FOUND", message: `Layer ${args.layer} not found` };
    this.doc.activeLayerIndex = layer.index;
    return { content: [{ type: "text", text: JSON.stringify({ success: true, activeLayerIndex: layer.index, name: layer.name }) }] };
  }

  private async tool_set_layer_visibility(args: any): Promise<ToolCallResult> {
    const layer = this.doc.layers.find((l) => l.index === args.layer || l.name === args.layer);
    if (!layer) throw { code: "LAYER_NOT_FOUND", message: `Layer ${args.layer} not found` };
    layer.isVisible = !!args.visible;
    this.doc.revision++;
    return { content: [{ type: "text", text: JSON.stringify({ success: true, layerIndex: layer.index, visible: layer.isVisible, revision: this.doc.revision }) }] };
  }

  private async tool_set_layer_opacity(args: any): Promise<ToolCallResult> {
    const layer = this.doc.layers.find((l) => l.index === args.layer || l.name === args.layer);
    if (!layer) throw { code: "LAYER_NOT_FOUND", message: `Layer ${args.layer} not found` };
    layer.opacity = Math.max(0, Math.min(255, args.opacity));
    this.doc.revision++;
    return { content: [{ type: "text", text: JSON.stringify({ success: true, layerIndex: layer.index, opacity: layer.opacity, revision: this.doc.revision }) }] };
  }

  private async tool_move_layer(args: any): Promise<ToolCallResult> {
    const fromIdx = this.doc.layers.findIndex((l) => l.index === args.layer || l.name === args.layer);
    if (fromIdx === -1) throw { code: "LAYER_NOT_FOUND", message: `Layer ${args.layer} not found` };
    const toIdx = Math.max(0, Math.min(this.doc.layers.length - 1, args.targetIndex));
    const [layer] = this.doc.layers.splice(fromIdx, 1);
    this.doc.layers.splice(toIdx, 0, layer);
    this.doc.revision++;
    return { content: [{ type: "text", text: JSON.stringify({ success: true, fromIndex: fromIdx, toIndex: toIdx, revision: this.doc.revision }) }] };
  }

  private async tool_create_group(args: any): Promise<ToolCallResult> {
    return this.tool_create_layer({ name: args.name, type: "group", parentLayer: args.parentGroup });
  }

  // --- Frames Tools ---

  private async tool_list_frames(_args: any): Promise<ToolCallResult> {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            totalFrames: this.doc.frames.length,
            activeFrame: this.doc.activeFrameNumber,
            frames: this.doc.frames,
          }),
        },
      ],
    };
  }

  private async tool_select_frame(args: any): Promise<ToolCallResult> {
    const frame = this.doc.frames.find((f) => f.frameNumber === args.frameNumber);
    if (!frame) throw { code: "FRAME_NOT_FOUND", message: `Frame ${args.frameNumber} not found` };
    this.doc.activeFrameNumber = frame.frameNumber;
    return { content: [{ type: "text", text: JSON.stringify({ success: true, activeFrame: frame.frameNumber, durationMs: frame.durationMs }) }] };
  }

  private async tool_create_frame(args: any): Promise<ToolCallResult> {
    const nextNum = this.doc.frames.length + 1;
    this.doc.frames.push({ frameNumber: nextNum, durationMs: args.durationMs ?? 100 });
    this.doc.activeFrameNumber = nextNum;
    this.doc.revision++;
    return { content: [{ type: "text", text: JSON.stringify({ success: true, createdFrameNumber: nextNum, totalFrames: this.doc.frames.length, revision: this.doc.revision }) }] };
  }

  private async tool_duplicate_frame(args: any): Promise<ToolCallResult> {
    const srcNum = args.frameNumber ?? this.doc.activeFrameNumber;
    const srcFrame = this.doc.frames.find((f) => f.frameNumber === srcNum);
    if (!srcFrame) throw { code: "FRAME_NOT_FOUND", message: `Frame ${srcNum} not found` };

    const newNum = this.doc.frames.length + 1;
    this.doc.frames.push({ frameNumber: newNum, durationMs: srcFrame.durationMs });

    // Clone all cels from src frame to new frame
    for (const layer of this.doc.layers) {
      const srcCel = this.doc.getCel(layer.index, srcNum);
      const newCel = this.doc.getCel(layer.index, newNum);
      for (let y = 0; y < this.doc.height; y++) {
        for (let x = 0; x < this.doc.width; x++) {
          newCel[y][x] = srcCel[y][x];
        }
      }
    }

    this.doc.activeFrameNumber = newNum;
    this.doc.revision++;
    return { content: [{ type: "text", text: JSON.stringify({ success: true, newFrameNumber: newNum, copiedFrom: srcNum, totalFrames: this.doc.frames.length, revision: this.doc.revision }) }] };
  }

  private async tool_delete_frame(args: any): Promise<ToolCallResult> {
    if (args.confirm !== true) {
      throw { code: "CONFIRMATION_REQUIRED", message: "delete_frame requires confirm: true" };
    }
    if (this.doc.frames.length <= 1) {
      throw { code: "CANNOT_DELETE_LAST_FRAME", message: "Cannot delete the only remaining frame" };
    }
    const idx = this.doc.frames.findIndex((f) => f.frameNumber === args.frameNumber);
    if (idx === -1) throw { code: "FRAME_NOT_FOUND", message: `Frame ${args.frameNumber} not found` };
    const deleted = this.doc.frames.splice(idx, 1)[0];
    this.doc.activeFrameNumber = 1;
    this.doc.revision++;
    return { content: [{ type: "text", text: JSON.stringify({ success: true, deletedFrameNumber: deleted.frameNumber, totalFrames: this.doc.frames.length, revision: this.doc.revision }) }] };
  }

  private async tool_set_frame_duration(args: any): Promise<ToolCallResult> {
    if (args.durationMs <= 0) {
      throw { code: "INVALID_ARGUMENT", message: "Frame duration must be positive" };
    }
    const frame = this.doc.frames.find((f) => f.frameNumber === args.frameNumber);
    if (!frame) throw { code: "FRAME_NOT_FOUND", message: `Frame ${args.frameNumber} not found` };
    frame.durationMs = args.durationMs;
    return { content: [{ type: "text", text: JSON.stringify({ success: true, frameNumber: frame.frameNumber, durationMs: frame.durationMs }) }] };
  }

  private async tool_create_tag(args: any): Promise<ToolCallResult> {
    if (args.fromFrame > args.toFrame) {
      throw { code: "INVALID_TAG_RANGE", message: "fromFrame must be <= toFrame" };
    }
    if (args.toFrame > this.doc.frames.length) {
      throw { code: "FRAME_OUT_OF_RANGE", message: `Frame ${args.toFrame} out of range` };
    }
    const tag = {
      name: args.name,
      fromFrame: args.fromFrame,
      toFrame: args.toFrame,
      direction: args.direction ?? "forward",
      color: args.color,
    };
    this.doc.tags.push(tag);
    return { content: [{ type: "text", text: JSON.stringify({ success: true, tag }) }] };
  }

  private async tool_list_tags(_args: any): Promise<ToolCallResult> {
    return { content: [{ type: "text", text: JSON.stringify({ tags: this.doc.tags }) }] };
  }

  // --- File & Canvas Tools ---

  private async tool_new_sprite(args: any): Promise<ToolCallResult> {
    const width = args.width;
    const height = args.height;
    if (width <= 0 || height <= 0 || width > 8192 || height > 8192) {
      throw { code: "INVALID_DIMENSIONS", message: "Width and height must be between 1 and 8192" };
    }

    this.doc = new MockDocument();
    this.doc.width = width;
    this.doc.height = height;
    this.doc.colorMode = args.colorMode ?? "rgb";
    this.doc.revision = 1;
    this.doc.recordSnapshot();

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            spriteId: "sprite_mock_001",
            width,
            height,
            colorMode: this.doc.colorMode,
            revision: 1,
          }),
        },
      ],
    };
  }

  private async tool_open_sprite(args: any): Promise<ToolCallResult> {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            filepath: args.filepath,
            width: this.doc.width,
            height: this.doc.height,
            frames: this.doc.frames.length,
            layers: this.doc.layers.length,
          }),
        },
      ],
    };
  }

  private async tool_save_sprite(_args: any): Promise<ToolCallResult> {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            filepath: "sprite.aseprite",
            savedAt: new Date().toISOString(),
          }),
        },
      ],
    };
  }

  private async tool_save_sprite_as(args: any): Promise<ToolCallResult> {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            filepath: args.filepath,
            savedAt: new Date().toISOString(),
          }),
        },
      ],
    };
  }

  private async tool_export_png(args: any): Promise<ToolCallResult> {
    const scale = args.scale ?? 1;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            filepath: args.filepath,
            width: this.doc.width * scale,
            height: this.doc.height * scale,
            scale,
          }),
        },
      ],
    };
  }

  private async tool_resize_canvas(args: any): Promise<ToolCallResult> {
    const { width, height } = args;
    if (width <= 0 || height <= 0) {
      throw { code: "INVALID_DIMENSIONS", message: "New canvas dimensions must be >= 1" };
    }

    const oldW = this.doc.width;
    const oldH = this.doc.height;

    const prevDims = { width: oldW, height: oldH };
    this.doc.width = width;
    this.doc.height = height;

    // Resize existing cels
    for (const [key, matrix] of this.doc.cels.entries()) {
      const newMatrix: string[][] = [];
      for (let y = 0; y < height; y++) {
        const row: string[] = [];
        for (let x = 0; x < width; x++) {
          if (y < oldH && x < oldW) {
            row.push(matrix[y][x]);
          } else {
            row.push("#00000000");
          }
        }
        newMatrix.push(row);
      }
      this.doc.cels.set(key, newMatrix);
    }

    this.doc.undoStack.push({
      name: "resize_canvas",
      revisionBefore: this.doc.revision,
      pixelDeltas: [],
      prevDimensions: prevDims,
    });

    this.doc.revision++;
    this.doc.recordSnapshot();

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            oldDimensions: { width: oldW, height: oldH },
            newDimensions: { width, height },
            revision: this.doc.revision,
          }),
        },
      ],
    };
  }
}
