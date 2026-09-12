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
import { MAX_CANVAS_DIMENSION, MAX_PIXELS_BATCH } from "../../src/config.js";

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
  filename: string = "sprite.aseprite";
  existingFiles: Set<string> = new Set();

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
  changeJournal: Array<{
    revision: number;
    pixelsChanged: number;
    bounds: { x: number; y: number; width: number; height: number };
  }> = [];

  constructor() {
    this.initCel(0, 1);
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

  getLayerMatrix(layerIndex: number, frameNumber: number): string[][] {
    const result: string[][] = [];
    for (let y = 0; y < this.height; y++) {
      result.push(new Array(this.width).fill("#00000000"));
    }
    const cel = this.getCel(layerIndex, frameNumber);
    const layer = this.layers.find((l) => l.index === layerIndex);
    const opacityRatio = (layer?.opacity ?? 255) / 255;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const color = cel[y][x];
        if (color !== "#00000000") {
          if (opacityRatio === 1) {
            result[y][x] = color;
          } else {
            const r = parseInt(color.slice(1, 3), 16) || 0;
            const g = parseInt(color.slice(3, 5), 16) || 0;
            const b = parseInt(color.slice(5, 7), 16) || 0;
            const a = parseInt(color.slice(7, 9), 16) || 0;
            const effA = Math.round(a * opacityRatio);
            result[y][x] = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}${effA.toString(16).padStart(2, "0")}`.toUpperCase();
          }
        }
      }
    }
    return result;
  }

  getCompositeMatrix(frameNumber: number = this.activeFrameNumber): string[][] {
    const result: string[][] = [];
    for (let y = 0; y < this.height; y++) {
      result.push(new Array(this.width).fill("#00000000"));
    }

    // Blend visible layers bottom to top
    for (const layer of this.layers) {
      if (!layer.isVisible || layer.isGroup) continue;
      const cel = this.getCel(layer.index, frameNumber);
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

  renderPngBuffer(scale: number = 1, frameNumber: number = this.activeFrameNumber, targetLayer?: any): Buffer {
    const scaledW = this.width * scale;
    const scaledH = this.height * scale;
    const composite = targetLayer ? this.getLayerMatrix(targetLayer.index, frameNumber) : this.getCompositeMatrix(frameNumber);
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
    this.doc.existingFiles.clear();
    this.isConnected = true;
  }

  reset(): void {
    this.doc = new MockDocument();
    this.doc.existingFiles.clear();
    this.isConnected = true;
  }

  async teardown(): Promise<void> {
    this.isConnected = false;
  }

  setLayerLocked(layer: number | string, locked: boolean = true): void {
    const target = this.doc.layers.find((l) => l.index === layer || l.name === layer);
    if (!target) {
      throw new Error(`Layer '${layer}' not found`);
    }
    target.isLocked = locked;
  }

  public resolveTargetLayer(args: Record<string, any>, forWriting = false): any {
    let byIndex: any;
    if (args.layerIndex !== undefined) {
      const idx = args.layerIndex;
      if (typeof idx !== "number" || !Number.isInteger(idx) || idx < 0 || idx >= this.doc.layers.length) {
        throw { code: "INVALID_LAYER_INDEX", message: `Invalid layerIndex: ${idx}` };
      }
      byIndex = this.doc.layers.find((l) => l.index === idx);
      if (!byIndex) {
        throw { code: "LAYER_NOT_FOUND", message: `Layer with index ${idx} not found` };
      }
    }

    let byName: any;
    if (args.layerName !== undefined) {
      const matched = this.doc.layers.filter((l) => l.name === args.layerName);
      if (matched.length === 0) {
        throw { code: "LAYER_NOT_FOUND", message: `Layer '${args.layerName}' not found` };
      } else if (matched.length > 1) {
        throw { code: "AMBIGUOUS_LAYER_NAME", message: `Ambiguous layerName '${args.layerName}': found multiple matching layers` };
      }
      byName = matched[0];
    }

    let targetLayer: any;
    if (byIndex !== undefined && byName !== undefined) {
      if (byIndex !== byName) {
        throw { code: "CONFLICTING_SELECTORS", message: "Conflicting layer selectors: layerIndex and layerName refer to different layers" };
      }
      targetLayer = byIndex;
    } else if (byIndex !== undefined) {
      targetLayer = byIndex;
    } else if (byName !== undefined) {
      targetLayer = byName;
    } else {
      targetLayer = this.doc.layers[this.doc.activeLayerIndex] ?? this.doc.layers[0];
    }

    if (!targetLayer) {
      throw { code: "LAYER_NOT_FOUND", message: "No target layer available" };
    }

    if (targetLayer.isGroup) {
      throw { code: "INVALID_LAYER", message: "Cannot paint on or read from a group layer" };
    }

    if (forWriting) {
      if (targetLayer.isLocked || targetLayer.isEditable === false) {
        throw { code: "LAYER_LOCKED", message: "Cannot paint on locked or non-editable layer" };
      }
    }

    return targetLayer;
  }

  public resolveTargetFrame(rawFrame: any): any {
    if (rawFrame !== undefined) {
      if (typeof rawFrame !== "number" || !Number.isInteger(rawFrame) || rawFrame < 1 || rawFrame > this.doc.frames.length) {
        throw { code: "INVALID_FRAME", message: `Invalid frame: ${rawFrame}` };
      }
      const f = this.doc.frames.find((fr) => fr.frameNumber === rawFrame);
      if (!f) throw { code: "INVALID_FRAME", message: `Invalid frame: ${rawFrame}` };
      return f;
    }
    const current = this.doc.frames.find((fr) => fr.frameNumber === this.doc.activeFrameNumber);
    return current ?? this.doc.frames[0];
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
    const status: any = {
      connected: this.isConnected,
      hasActiveSprite: true,
      file: this.doc.filename || null,
      filename: this.doc.filename || "",
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
    const targetFrame = this.resolveTargetFrame(args.frameIndex ?? args.frameNumber);
    const frameNum = targetFrame.frameNumber;
    let targetLayer: any = undefined;
    if (args.layerName !== undefined) {
      const matched = this.doc.layers.filter((l) => l.name === args.layerName);
      if (matched.length === 0) {
        throw { code: "LAYER_NOT_FOUND", message: `Layer '${args.layerName}' not found.` };
      }
      if (matched.length > 1) {
        throw { code: "AMBIGUOUS_LAYER", message: `Ambiguous layerName '${args.layerName}': found multiple matching layers.` };
      }
      if (matched[0].isGroup) {
        throw { code: "CANNOT_RENDER_GROUP", message: "Cannot render group layer." };
      }
      targetLayer = matched[0];
    }
    const scale = args.scale ?? 1;
    const pngBuf = this.doc.renderPngBuffer(scale, frameNum, targetLayer);
    const base64 = pngBuf.toString("base64");
    return {
      content: [
        { type: "image", mimeType: "image/png", data: base64 },
        { type: "text", text: JSON.stringify({ width: this.doc.width * scale, height: this.doc.height * scale, scale, frameNumber: frameNum, revision: this.doc.revision }) },
      ],
    };
  }

  private async tool_get_pixel_grid(args: any): Promise<ToolCallResult> {
    const format = args.format ?? "hex";
    const targetLayer = this.resolveTargetLayer(args, false);
    const targetFrame = this.resolveTargetFrame(args.frameIndex ?? args.frameNumber);
    const cel = this.doc.getCel(targetLayer.index, targetFrame.frameNumber);
    const isIndexed = this.doc.colorMode === "indexed";

    const regionInput = args.region ?? args.bounds;
    let rx = 0;
    let ry = 0;
    let rw = this.doc.width;
    let rh = this.doc.height;

    if (regionInput !== undefined) {
      const { x, y, width, height } = regionInput;
      if (typeof x !== "number" || !Number.isInteger(x) || x < 0 ||
          typeof y !== "number" || !Number.isInteger(y) || y < 0) {
        throw { code: "INVALID_ARGUMENT", message: "Region coordinates (x, y) must be non-negative integers." };
      }
      if (typeof width !== "number" || !Number.isInteger(width) || width <= 0 ||
          typeof height !== "number" || !Number.isInteger(height) || height <= 0) {
        throw { code: "INVALID_ARGUMENT", message: "Region dimensions (width, height) must be positive integers." };
      }
      if (x >= this.doc.width || y >= this.doc.height) {
        throw { code: "OUT_OF_BOUNDS", message: "Region origin outside canvas bounds." };
      }
      rx = x;
      ry = y;
      rw = Math.min(width, this.doc.width - x);
      rh = Math.min(height, this.doc.height - y);
    }

    const subMatrix: any[][] = [];
    const paletteList: string[] = [];
    const paletteMap = new Map<string, number>();

    for (let y = ry; y < ry + rh; y++) {
      const row: any[] = [];
      for (let x = rx; x < rx + rw; x++) {
        const hex = cel[y][x];
        if (format === "rgba") {
          const r = parseInt(hex.slice(1, 3), 16) || 0;
          const g = parseInt(hex.slice(3, 5), 16) || 0;
          const b = parseInt(hex.slice(5, 7), 16) || 0;
          const a = parseInt(hex.slice(7, 9), 16) || 0;
          row.push({ r, g, b, a });
        } else if (format === "indexed") {
          if (isIndexed) {
            const idx = this.doc.palette.indexOf(hex);
            row.push(idx >= 0 ? idx : 0);
          } else {
            const r = parseInt(hex.slice(1, 3), 16) || 0;
            const g = parseInt(hex.slice(3, 5), 16) || 0;
            const b = parseInt(hex.slice(5, 7), 16) || 0;
            const a = parseInt(hex.slice(7, 9), 16) || 0;
            const rawVal = (((a & 0xff) << 24) | ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff)) >>> 0;
            row.push(rawVal);
          }
        } else if (format === "compact") {
          if (!paletteMap.has(hex)) {
            paletteList.push(hex);
            paletteMap.set(hex, paletteList.length - 1);
          }
          row.push(paletteMap.get(hex)!);
        } else {
          row.push(hex);
        }
      }
      subMatrix.push(row);
    }

    const result: any = {
      width: rw,
      height: rh,
      format,
      pixels: subMatrix,
      grid: subMatrix,
      indexedSource: isIndexed,
    };
    if (regionInput !== undefined) {
      result.origin = { x: rx, y: ry };
      result.region = { x: rx, y: ry, width: rw, height: rh };
    }
    if (format === "compact") {
      result.palette = paletteList;
    }
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
    if (pixels.length > MAX_PIXELS_BATCH) {
      throw { code: "BATCH_TOO_LARGE", message: `Pixel batch size exceeds maximum allowed (${MAX_PIXELS_BATCH})` };
    }

    const targetLayer = this.resolveTargetLayer(args, true);
    const targetFrame = this.resolveTargetFrame(args.frameNumber);
    const cel = this.doc.getCel(targetLayer.index, targetFrame.frameNumber);
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
          layerIndex: targetLayer.index,
          frameNumber: targetFrame.frameNumber,
          oldColor: prevColor,
          newColor: normColor,
        });
        cel[p.y][p.x] = normColor;
      }
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const d of deltas) {
      minX = Math.min(minX, d.x);
      minY = Math.min(minY, d.y);
      maxX = Math.max(maxX, d.x);
      maxY = Math.max(maxY, d.y);
    }

    if (deltas.length > 0) {
      this.doc.undoStack.push({
        name: "set_pixels",
        revisionBefore: this.doc.revision,
        pixelDeltas: deltas,
      });
      this.doc.redoStack = [];
      this.doc.revision++;

      const bounds = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
      this.doc.changeJournal.push({
        revision: this.doc.revision,
        pixelsChanged: deltas.length,
        bounds,
      });
      if (this.doc.changeJournal.length > 128) {
        this.doc.changeJournal.shift();
      }
    }

    const bounds = deltas.length > 0
      ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
      : { x: 0, y: 0, width: 0, height: 0 };

    const resPayload: any = {
      success: true,
      pixelsModified: deltas.length,
      pixelsChanged: deltas.length,
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
    return this.tool_set_pixels({ ...args, pixels: [{ x: args.x, y: args.y, color: args.color }] });
  }

  private async tool_erase_pixels(args: any): Promise<ToolCallResult> {
    const coords = args.points || args.coordinates || [];
    if (coords.length > MAX_PIXELS_BATCH) {
      throw { code: "BATCH_TOO_LARGE", message: `Points batch size exceeds maximum allowed (${MAX_PIXELS_BATCH})` };
    }
    const pixels = coords.map((c: any) => ({ x: c.x, y: c.y, color: "#00000000" }));
    return this.tool_set_pixels({ ...args, pixels });
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

    return this.tool_set_pixels({ ...args, pixels });
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

    return this.tool_set_pixels({ ...args, pixels });
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

    return this.tool_set_pixels({ ...args, pixels });
  }

  private async tool_flood_fill(args: any): Promise<ToolCallResult> {
    const { x, y, color, tolerance = 0, contiguous = true } = args;
    if (typeof x !== "number" || typeof y !== "number" || x < 0 || x >= this.doc.width || y < 0 || y >= this.doc.height) {
      throw { code: "OUT_OF_BOUNDS", message: `Seed coordinate (${x}, ${y}) out of bounds` };
    }

    const targetLayer = this.resolveTargetLayer(args, true);
    const targetFrame = this.resolveTargetFrame(args.frameNumber);
    const cel = this.doc.getCel(targetLayer.index, targetFrame.frameNumber);
    const seedColor = cel[y][x];
    const targetColor = normalizeHex(color);

    if (seedColor === targetColor && tolerance === 0) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            pixelsModified: 0,
            pixelsChanged: 0,
            bounds: { x: 0, y: 0, width: 0, height: 0 },
            revision: this.doc.revision,
          }),
        }],
      };
    }

    const parseRgba = (hex: string) => {
      const h = normalizeHex(hex);
      return {
        r: parseInt(h.slice(1, 3), 16) || 0,
        g: parseInt(h.slice(3, 5), 16) || 0,
        b: parseInt(h.slice(5, 7), 16) || 0,
        a: parseInt(h.slice(7, 9), 16) || 0,
      };
    };

    const seedRgba = parseRgba(seedColor);
    const toChange: Array<{ x: number; y: number }> = [];

    if (contiguous === false) {
      for (let cy = 0; cy < this.doc.height; cy++) {
        for (let cx = 0; cx < this.doc.width; cx++) {
          const cRgba = parseRgba(cel[cy][cx]);
          const diff = Math.abs(cRgba.r - seedRgba.r) + Math.abs(cRgba.g - seedRgba.g) + Math.abs(cRgba.b - seedRgba.b) + Math.abs(cRgba.a - seedRgba.a);
          if (diff <= tolerance * 4) {
            toChange.push({ x: cx, y: cy });
            if (toChange.length > MAX_PIXELS_BATCH) {
              throw { code: "BATCH_TOO_LARGE", message: `Pixel batch size exceeds maximum allowed (${MAX_PIXELS_BATCH})` };
            }
          }
        }
      }
    } else {
      const queue: Array<[number, number]> = [[x, y]];
      let head = 0;
      const visited = new Uint8Array(this.doc.width * this.doc.height);
      visited[y * this.doc.width + x] = 1;

      while (head < queue.length) {
        const [cx, cy] = queue[head++];
        toChange.push({ x: cx, y: cy });
        if (toChange.length > MAX_PIXELS_BATCH) {
          throw { code: "BATCH_TOO_LARGE", message: `Pixel batch size exceeds maximum allowed (${MAX_PIXELS_BATCH})` };
        }

        const neighbors: Array<[number, number]> = [
          [cx + 1, cy],
          [cx - 1, cy],
          [cx, cy + 1],
          [cx, cy - 1],
        ];

        for (const [nx, ny] of neighbors) {
          if (nx >= 0 && nx < this.doc.width && ny >= 0 && ny < this.doc.height) {
            const idx = ny * this.doc.width + nx;
            if (!visited[idx]) {
              visited[idx] = 1;
              const cRgba = parseRgba(cel[ny][nx]);
              const diff = Math.abs(cRgba.r - seedRgba.r) + Math.abs(cRgba.g - seedRgba.g) + Math.abs(cRgba.b - seedRgba.b) + Math.abs(cRgba.a - seedRgba.a);
              if (diff <= tolerance * 4) {
                queue.push([nx, ny]);
              }
            }
          }
        }
      }
    }

    const pixels = toChange.map((p) => ({ x: p.x, y: p.y, color: targetColor }));
    return this.tool_set_pixels({
      ...args,
      layerIndex: targetLayer.index,
      frameNumber: targetFrame.frameNumber,
      pixels,
    });
  }

  private async tool_replace_color(args: any): Promise<ToolCallResult> {
    const { fromColor, toColor, tolerance = 0 } = args;
    const targetLayer = this.resolveTargetLayer(args, true);
    const targetFrame = this.resolveTargetFrame(args.frameNumber);
    const cel = this.doc.getCel(targetLayer.index, targetFrame.frameNumber);

    const parseRgba = (hex: string) => {
      const h = normalizeHex(hex);
      return {
        r: parseInt(h.slice(1, 3), 16) || 0,
        g: parseInt(h.slice(3, 5), 16) || 0,
        b: parseInt(h.slice(5, 7), 16) || 0,
        a: parseInt(h.slice(7, 9), 16) || 0,
      };
    };

    const fromRgba = parseRgba(fromColor);
    const normTo = normalizeHex(toColor);

    const pixels: Pixel[] = [];
    for (let y = 0; y < this.doc.height; y++) {
      for (let x = 0; x < this.doc.width; x++) {
        const cRgba = parseRgba(cel[y][x]);
        const diff = Math.abs(cRgba.r - fromRgba.r) + Math.abs(cRgba.g - fromRgba.g) + Math.abs(cRgba.b - fromRgba.b) + Math.abs(cRgba.a - fromRgba.a);
        if (diff <= tolerance * 4) {
          pixels.push({ x, y, color: normTo });
          if (pixels.length > MAX_PIXELS_BATCH) {
            throw { code: "BATCH_TOO_LARGE", message: `Pixel batch size exceeds maximum allowed (${MAX_PIXELS_BATCH})` };
          }
        }
      }
    }

    if (pixels.length === 0) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            pixelsModified: 0,
            pixelsChanged: 0,
            bounds: { x: 0, y: 0, width: 0, height: 0 },
            revision: this.doc.revision,
          }),
        }],
      };
    }

    return this.tool_set_pixels({
      ...args,
      layerIndex: targetLayer.index,
      frameNumber: targetFrame.frameNumber,
      pixels,
    });
  }

  private async tool_get_changes_since(args: any): Promise<ToolCallResult> {
    const since = args.sinceRevision;
    if (typeof since !== "number" || !Number.isInteger(since) || since < 0) {
      return {
        content: [{ type: "text", text: JSON.stringify({ changed: true, sinceRevision: since, currentRevision: this.doc.revision, fullRefreshRequired: true }) }],
      };
    }

    if (since === this.doc.revision) {
      return {
        content: [{ type: "text", text: JSON.stringify({ changed: false, sinceRevision: since, currentRevision: this.doc.revision, pixelsChanged: 0, bounds: null }) }],
      };
    }

    if (since > this.doc.revision || (this.doc.revision - since) > 128) {
      return {
        content: [{ type: "text", text: JSON.stringify({ changed: true, sinceRevision: since, currentRevision: this.doc.revision, fullRefreshRequired: true }) }],
      };
    }

    const journalMap = new Map<number, { revision: number; pixelsChanged: number; bounds: { x: number; y: number; width: number; height: number } }>();
    for (const entry of this.doc.changeJournal) {
      journalMap.set(entry.revision, entry);
    }

    let totalPixels = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (let r = since + 1; r <= this.doc.revision; r++) {
      const entry = journalMap.get(r);
      if (!entry) {
        return {
          content: [{ type: "text", text: JSON.stringify({ changed: true, sinceRevision: since, currentRevision: this.doc.revision, fullRefreshRequired: true }) }],
        };
      }
      totalPixels += entry.pixelsChanged;
      minX = Math.min(minX, entry.bounds.x);
      minY = Math.min(minY, entry.bounds.y);
      maxX = Math.max(maxX, entry.bounds.x + entry.bounds.width - 1);
      maxY = Math.max(maxY, entry.bounds.y + entry.bounds.height - 1);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            changed: true,
            sinceRevision: since,
            currentRevision: this.doc.revision,
            pixelsChanged: totalPixels,
            bounds: {
              x: minX,
              y: minY,
              width: maxX - minX + 1,
              height: maxY - minY + 1,
            },
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
    const { color, findNearest = true } = args;
    const target = normalizeHex(color);
    const targetR = parseInt(target.slice(1, 3), 16) || 0;
    const targetG = parseInt(target.slice(3, 5), 16) || 0;
    const targetB = parseInt(target.slice(5, 7), 16) || 0;
    const targetA = parseInt(target.slice(7, 9), 16) || 0;

    let bestIdx = 0;
    let minDiff = Infinity;

    for (let i = 0; i < this.doc.palette.length; i++) {
      const c = normalizeHex(this.doc.palette[i]);
      const cr = parseInt(c.slice(1, 3), 16) || 0;
      const cg = parseInt(c.slice(3, 5), 16) || 0;
      const cb = parseInt(c.slice(5, 7), 16) || 0;
      const ca = parseInt(c.slice(7, 9), 16) || 0;
      const diff = Math.sqrt(
        Math.pow(cr - targetR, 2) +
        Math.pow(cg - targetG, 2) +
        Math.pow(cb - targetB, 2) +
        Math.pow(ca - targetA, 2)
      );
      if (diff < minDiff) {
        minDiff = diff;
        bestIdx = i;
      }
      if (diff === 0) break;
    }

    const isExact = minDiff === 0;
    if (!isExact && findNearest === false) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              found: false,
              exact: false,
            }),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            found: true,
            exact: isExact,
            index: bestIdx,
            hex: normalizeHex(this.doc.palette[bestIdx]),
            distance: isExact ? 0 : minDiff,
          }),
        },
      ],
    };
  }

  // --- Layers Tools ---

  private async tool_list_layers(_args: any): Promise<ToolCallResult> {
    return {
      content: [{ type: "text", text: JSON.stringify({ activeLayerIndex: this.doc.activeLayerIndex, layers: this.doc.layers }) }],
    };
  }

  private async tool_create_layer(args: any): Promise<ToolCallResult> {
    let parentIndex: number | null = args.parentLayer ?? null;
    if (args.parentGroup !== undefined && args.parentGroup !== null) {
      const matched = this.doc.layers.filter((l) => l.name === args.parentGroup);
      if (matched.length === 0) {
        throw { code: "LAYER_NOT_FOUND", message: `Parent group '${args.parentGroup}' not found.` };
      }
      if (matched.length > 1) {
        throw { code: "AMBIGUOUS_LAYER", message: `Ambiguous parentGroup '${args.parentGroup}': found multiple matching layers.` };
      }
      if (!matched[0].isGroup) {
        throw { code: "NOT_A_GROUP", message: `Layer '${args.parentGroup}' is not a group.` };
      }
      parentIndex = matched[0].index;
    }

    const name = args.name;
    const index = this.doc.layers.length;
    this.doc.layers.push({
      index,
      name,
      isGroup: false,
      isVisible: true,
      isLocked: false,
      opacity: args.opacity ?? 255,
      blendMode: "normal",
      parentIndex,
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
    const name = args.name;
    const index = this.doc.layers.length;
    this.doc.layers.push({
      index,
      name,
      isGroup: true,
      isVisible: true,
      isLocked: false,
      opacity: 255,
      blendMode: "normal",
      parentIndex: null,
    });
    this.doc.activeLayerIndex = index;
    this.doc.revision++;
    return { content: [{ type: "text", text: JSON.stringify({ success: true, layerIndex: index, name, isGroup: true, revision: this.doc.revision }) }] };
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
    if (args.durationMs !== undefined) {
      throw { code: "INVALID_ARGUMENT", message: "create_frame accepts 'duration', not 'durationMs'" };
    }
    if (args.afterFrame !== undefined && args.afterFrame !== null) {
      if (typeof args.afterFrame !== "number" || !Number.isInteger(args.afterFrame) || args.afterFrame < 1 || args.afterFrame > this.doc.frames.length) {
        throw { code: "FRAME_OUT_OF_RANGE", message: `Invalid afterFrame: ${args.afterFrame}` };
      }
    }
    const targetPos = args.afterFrame ? args.afterFrame + 1 : this.doc.frames.length + 1;
    const durMs = args.duration ?? 100;
    const newFrame = { frameNumber: targetPos, durationMs: durMs };

    if (targetPos <= this.doc.frames.length) {
      this.doc.frames.splice(targetPos - 1, 0, newFrame);
      for (let i = targetPos; i < this.doc.frames.length; i++) {
        this.doc.frames[i].frameNumber = i + 1;
      }
      const updatedCels = new Map<string, string[][]>();
      for (const [key, matrix] of this.doc.cels.entries()) {
        const parts = key.split("_");
        const lIdx = parts[0];
        const fNum = parseInt(parts[1], 10);
        if (fNum >= targetPos) {
          updatedCels.set(`${lIdx}_${fNum + 1}`, matrix);
        } else {
          updatedCels.set(key, matrix);
        }
      }
      this.doc.cels = updatedCels;
    } else {
      this.doc.frames.push(newFrame);
    }

    this.doc.activeFrameNumber = targetPos;
    this.doc.revision++;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            frameNumber: targetPos,
            createdFrameNumber: targetPos,
            totalFrames: this.doc.frames.length,
            durationMs: durMs,
            revision: this.doc.revision,
          }),
        },
      ],
    };
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
    const from = args.fromFrame;
    const to = args.toFrame;
    if (typeof from !== "number" || !Number.isInteger(from) || from < 1 || from > this.doc.frames.length) {
      throw { code: "FRAME_OUT_OF_RANGE", message: `Frame ${from} out of range` };
    }
    if (typeof to !== "number" || !Number.isInteger(to) || to < 1 || to > this.doc.frames.length) {
      throw { code: "FRAME_OUT_OF_RANGE", message: `Frame ${to} out of range` };
    }
    if (from > to) {
      throw { code: "INVALID_TAG_RANGE", message: "fromFrame must be <= toFrame" };
    }
    const normalizedColor = args.color ? normalizeHex(args.color) : undefined;
    const tag = {
      name: args.name,
      fromFrame: from,
      toFrame: to,
      from,
      to,
      direction: args.direction ?? "forward",
      color: normalizedColor,
    };
    this.doc.tags.push(tag);
    return { content: [{ type: "text", text: JSON.stringify({ success: true, tag }) }] };
  }

  private async tool_list_tags(_args: any): Promise<ToolCallResult> {
    const tags = this.doc.tags.map((t) => ({
      name: t.name,
      from: t.fromFrame,
      to: t.toFrame,
      fromFrame: t.fromFrame,
      toFrame: t.toFrame,
      direction: t.direction,
      color: t.color ? normalizeHex(t.color) : undefined,
    }));
    return { content: [{ type: "text", text: JSON.stringify({ tags }) }] };
  }

  // --- File & Canvas Tools ---

  private async tool_new_sprite(args: any): Promise<ToolCallResult> {
    const width = args.width;
    const height = args.height;
    if (width <= 0 || height <= 0 || width > MAX_CANVAS_DIMENSION || height > MAX_CANVAS_DIMENSION) {
      throw { code: "INVALID_DIMENSIONS", message: `Width and height must be between 1 and ${MAX_CANVAS_DIMENSION}` };
    }

    this.doc = new MockDocument();
    this.doc.width = width;
    this.doc.height = height;
    this.doc.colorMode = args.colorMode ?? "rgb";
    this.doc.revision = 1;

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
    const filePath = args.filePath ?? args.filepath;
    if (!filePath || typeof filePath !== "string") {
      throw { code: "INVALID_ARGUMENT", message: "filePath is required." };
    }
    this.doc.filename = filePath;
    this.doc.existingFiles.add(filePath);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            filePath,
            filepath: filePath,
            width: this.doc.width,
            height: this.doc.height,
            frames: this.doc.frames.length,
            layers: this.doc.layers.length,
          }),
        },
      ],
    };
  }

  private async tool_save_sprite(args: any): Promise<ToolCallResult> {
    if (!args || !args.expectedFilePath || typeof args.expectedFilePath !== "string") {
      throw { code: "INVALID_ARGUMENT", message: "expectedFilePath is required." };
    }
    const normExpected = args.expectedFilePath.replace(/\\/g, "/");
    const normActual = (this.doc.filename || "").replace(/\\/g, "/");
    if (normExpected !== normActual) {
      throw {
        code: "FILENAME_MISMATCH",
        message: `Sprite filename mismatch: expected '${args.expectedFilePath}', but active sprite is '${this.doc.filename}'.`,
      };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            filepath: this.doc.filename,
            filePath: this.doc.filename,
            savedAt: new Date().toISOString(),
          }),
        },
      ],
    };
  }

  private async tool_save_sprite_as(args: any): Promise<ToolCallResult> {
    const filePath = args.filePath ?? args.filepath;
    if (!filePath || typeof filePath !== "string") {
      throw { code: "INVALID_ARGUMENT", message: "filePath is required." };
    }
    if (args.overwrite !== true && this.doc.existingFiles.has(filePath)) {
      throw {
        code: "FILE_EXISTS",
        message: `File already exists and overwrite is false: ${filePath}`,
      };
    }
    this.doc.filename = filePath;
    this.doc.existingFiles.add(filePath);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            filepath: filePath,
            filePath,
            savedAt: new Date().toISOString(),
          }),
        },
      ],
    };
  }

  private async tool_export_png(args: any): Promise<ToolCallResult> {
    const outputPath = args.outputPath ?? args.filepath;
    if (!outputPath || typeof outputPath !== "string") {
      throw { code: "INVALID_ARGUMENT", message: "outputPath is required." };
    }
    const frameNumber = args.frameNumber ?? this.doc.activeFrameNumber;
    if (typeof frameNumber !== "number" || !Number.isInteger(frameNumber) || frameNumber < 1 || frameNumber > this.doc.frames.length) {
      throw { code: "FRAME_OUT_OF_RANGE", message: `Invalid frame: ${frameNumber}` };
    }
    const scale = args.scale ?? 1;
    if (typeof scale !== "number" || !Number.isInteger(scale) || scale < 1 || scale > 32) {
      throw { code: "INVALID_ARGUMENT", message: `Invalid scale: ${scale}. Must be an integer between 1 and 32.` };
    }
    if (args.overwrite !== true && this.doc.existingFiles.has(outputPath)) {
      throw {
        code: "FILE_EXISTS",
        message: `File already exists and overwrite is false: ${outputPath}`,
      };
    }
    this.doc.existingFiles.add(outputPath);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            outputPath,
            filepath: outputPath,
            frameNumber,
            scale,
            width: this.doc.width * scale,
            height: this.doc.height * scale,
          }),
        },
      ],
    };
  }

  private async tool_resize_canvas(args: any): Promise<ToolCallResult> {
    const { width, height } = args;
    if (typeof width !== "number" || !Number.isInteger(width) || width < 1 || width > 4096 ||
        typeof height !== "number" || !Number.isInteger(height) || height < 1 || height > 4096) {
      throw { code: "INVALID_DIMENSIONS", message: "Canvas dimensions must be integers between 1 and 4096" };
    }
    const validAnchors = new Set(["top_left", "center", "top_right", "bottom_left", "bottom_right"]);
    const anchor = args.anchor ?? "top_left";
    if (!validAnchors.has(anchor)) {
      throw { code: "INVALID_ARGUMENT", message: `Invalid anchor: ${anchor}` };
    }

    const oldW = this.doc.width;
    const oldH = this.doc.height;

    let x = 0;
    let y = 0;
    if (anchor === "top_left") {
      x = 0;
      y = 0;
    } else if (anchor === "center") {
      x = Math.floor((oldW - width) / 2);
      y = Math.floor((oldH - height) / 2);
    } else if (anchor === "top_right") {
      x = oldW - width;
      y = 0;
    } else if (anchor === "bottom_left") {
      x = 0;
      y = oldH - height;
    } else if (anchor === "bottom_right") {
      x = oldW - width;
      y = oldH - height;
    }

    const dx = -x;
    const dy = -y;

    const prevDims = { width: oldW, height: oldH };
    this.doc.width = width;
    this.doc.height = height;

    // Resize existing cels with anchor shift and transparent blank exposed pixels
    for (const [key, matrix] of this.doc.cels.entries()) {
      const newMatrix: string[][] = [];
      for (let ny = 0; ny < height; ny++) {
        const row: string[] = [];
        for (let nx = 0; nx < width; nx++) {
          const oldX = nx - dx;
          const oldY = ny - dy;
          if (oldY >= 0 && oldY < oldH && oldX >= 0 && oldX < oldW && matrix[oldY] && matrix[oldY][oldX] !== undefined) {
            row.push(matrix[oldY][oldX]);
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

    const ox = -x === 0 ? 0 : -x;
    const oy = -y === 0 ? 0 : -y;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            previousWidth: oldW,
            previousHeight: oldH,
            width,
            height,
            oldDimensions: { width: oldW, height: oldH },
            newDimensions: { width, height },
            anchor,
            contentOffset: { x: ox, y: oy },
            revision: this.doc.revision,
          }),
        },
      ],
    };
  }
}
