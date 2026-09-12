// src/mock/mockEngine.ts
import { PNG } from "pngjs";
import type { AsepriteStatusResult } from "../bridge/protocol.js";
import { MAX_PIXELS_BATCH } from "../config.js";

export const MAX_CHANGE_JOURNAL_ENTRIES = 128;

export interface PixelJournalEntry {
  revision: number;
  pixelsChanged: number;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface MockCelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MockCel {
  layerIndex: number;
  frameNumber: number;
  bounds: MockCelBounds;
  pixels: Uint32Array; // width * height little-endian RGBA
}

export interface MockLayer {
  index: number;
  name: string;
  isVisible: boolean;
  isEditable: boolean;
  isLocked: boolean;
  opacity: number; // 0-255
  blendMode: "normal" | "multiply" | "screen" | "overlay";
  isGroup: boolean;
  isBackground: boolean;
  parentIndex: number | null;
}

export interface MockFrame {
  frameNumber: number; // 1-indexed
  duration: number;    // seconds (e.g. 0.1 for 100ms)
}

export interface PixelDelta {
  layerIndex: number;
  frameNumber: number;
  x: number;
  y: number;
  prevColor: number;
  newColor: number;
}

export interface MockTransaction {
  id: string;
  name: string;
  revisionBefore: number;
  revisionAfter: number;
  pixelDeltas: PixelDelta[];
}

export function packRgba(r: number, g: number, b: number, a: number): number {
  return (((a & 0xff) << 24) | ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff)) >>> 0;
}

export function unpackRgba(color: number): { r: number; g: number; b: number; a: number } {
  return {
    r: color & 0xff,
    g: (color >> 8) & 0xff,
    b: (color >> 16) & 0xff,
    a: (color >>> 24) & 0xff,
  };
}

export function hexToRgba(hex: string): number {
  const clean = hex.trim().replace(/^#/, "");
  let r = 0, g = 0, b = 0, a = 255;

  if (clean.length === 3) {
    r = parseInt(clean[0] + clean[0], 16);
    g = parseInt(clean[1] + clean[1], 16);
    b = parseInt(clean[2] + clean[2], 16);
  } else if (clean.length === 4) {
    r = parseInt(clean[0] + clean[0], 16);
    g = parseInt(clean[1] + clean[1], 16);
    b = parseInt(clean[2] + clean[2], 16);
    a = parseInt(clean[3] + clean[3], 16);
  } else if (clean.length === 6) {
    r = parseInt(clean.substring(0, 2), 16);
    g = parseInt(clean.substring(2, 4), 16);
    b = parseInt(clean.substring(4, 6), 16);
  } else if (clean.length === 8) {
    r = parseInt(clean.substring(0, 2), 16);
    g = parseInt(clean.substring(2, 4), 16);
    b = parseInt(clean.substring(4, 6), 16);
    a = parseInt(clean.substring(6, 8), 16);
  } else {
    throw new Error(`Invalid hex color string: "${hex}"`);
  }

  if (isNaN(r) || isNaN(g) || isNaN(b) || isNaN(a)) {
    throw new Error(`Failed to parse hex color: "${hex}"`);
  }

  return packRgba(r, g, b, a);
}

export function rgbaToHex(color: number): string {
  const { r, g, b, a } = unpackRgba(color);
  const toHex = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}${toHex(a)}`;
}

export class MockAsepriteEngine {
  public hasActiveSprite = true;
  public filename = "untitled.aseprite";
  public width = 32;
  public height = 32;
  public colorMode: "rgb" | "indexed" | "grayscale" = "rgb";

  public layers: MockLayer[] = [];
  public frames: MockFrame[] = [];
  public cels: Map<string, MockCel> = new Map(); // key: `${layerIndex}:${frameNumber}`
  public activeLayerIndex = 0;
  public activeFrameNumber = 1;
  public revision = 1;

  public undoStack: MockTransaction[] = [];
  public redoStack: MockTransaction[] = [];
  public changeJournal: PixelJournalEntry[] = [];
  public palette: Uint32Array = new Uint32Array(256);
  public tags: Array<{ name: string; from: number; to: number; color?: string }> = [];
  public mockExistingFiles: Set<string> = new Set();

  constructor(width = 32, height = 32) {
    this.reset(width, height);
  }

  public reset(width = 32, height = 32): void {
    this.mockExistingFiles = new Set<string>();
    this.width = width;
    this.height = height;
    this.hasActiveSprite = true;
    this.filename = "untitled.aseprite";
    this.colorMode = "rgb";
    this.revision = 1;
    this.activeLayerIndex = 0;
    this.activeFrameNumber = 1;

    this.layers = [
      {
        index: 0,
        name: "Layer 1",
        isVisible: true,
        isEditable: true,
        isLocked: false,
        opacity: 255,
        blendMode: "normal",
        isGroup: false,
        isBackground: false,
        parentIndex: null,
      },
    ];

    this.frames = [
      {
        frameNumber: 1,
        duration: 0.1,
      },
    ];

    this.tags = [];
    this.cels = new Map<string, MockCel>();
    const initialCel: MockCel = {
      layerIndex: 0,
      frameNumber: 1,
      bounds: { x: 0, y: 0, width, height },
      pixels: new Uint32Array(width * height), // all transparent 0x00000000
    };
    this.cels.set("0:1", initialCel);

    this.undoStack = [];
    this.redoStack = [];
    this.changeJournal = [];

    // Initialize fresh basic palette
    this.palette = new Uint32Array(256);
    this.palette[0] = packRgba(0, 0, 0, 0); // transparent
    this.palette[1] = packRgba(0, 0, 0, 255); // black
    this.palette[2] = packRgba(255, 255, 255, 255); // white
    this.palette[3] = packRgba(255, 0, 0, 255); // red
    this.palette[4] = packRgba(0, 0, 255, 255); // blue
    this.palette[5] = packRgba(0, 255, 0, 255); // green
    this.palette[6] = packRgba(255, 255, 0, 255); // yellow
    this.palette[7] = packRgba(255, 0, 255, 255); // magenta
    this.palette[8] = packRgba(0, 255, 255, 255); // cyan
  }

  public getOrCreateCel(layerIndex: number, frameNumber: number): MockCel {
    const key = `${layerIndex}:${frameNumber}`;
    let cel = this.cels.get(key);
    if (!cel) {
      cel = {
        layerIndex,
        frameNumber,
        bounds: { x: 0, y: 0, width: this.width, height: this.height },
        pixels: new Uint32Array(this.width * this.height),
      };
      this.cels.set(key, cel);
    }
    return cel;
  }

  public getCelPixel(cel: MockCel, canvasX: number, canvasY: number): number {
    const relX = canvasX - cel.bounds.x;
    const relY = canvasY - cel.bounds.y;
    if (relX < 0 || relX >= cel.bounds.width || relY < 0 || relY >= cel.bounds.height) {
      return 0; // outside cel is transparent
    }
    return cel.pixels[relY * cel.bounds.width + relX];
  }

  public setCelPixel(cel: MockCel, canvasX: number, canvasY: number, color: number): void {
    const relX = canvasX - cel.bounds.x;
    const relY = canvasY - cel.bounds.y;
    if (relX >= 0 && relX < cel.bounds.width && relY >= 0 && relY < cel.bounds.height) {
      cel.pixels[relY * cel.bounds.width + relX] = color;
    }
  }

  public getCompositeBuffer(frameNumber = this.activeFrameNumber): Uint32Array {
    const composite = new Uint32Array(this.width * this.height);

    for (const layer of this.layers) {
      if (!layer.isVisible) continue;
      const cel = this.cels.get(`${layer.index}:${frameNumber}`);
      if (!cel) continue;

      const layerAlphaRatio = layer.opacity / 255;

      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          const srcColor = this.getCelPixel(cel, x, y);
          if (srcColor === 0) continue;

          const src = unpackRgba(srcColor);
          const effectiveSrcAlpha = src.a * layerAlphaRatio;
          if (effectiveSrcAlpha === 0) continue;

          const dstIdx = y * this.width + x;
          const dstColor = composite[dstIdx];

          if (dstColor === 0 || effectiveSrcAlpha === 255) {
            composite[dstIdx] = packRgba(src.r, src.g, src.b, Math.round(effectiveSrcAlpha));
            continue;
          }

          const dst = unpackRgba(dstColor);
          const da = dst.a / 255;
          const sa = effectiveSrcAlpha / 255;
          const outA = sa + da * (1 - sa);

          const outR = Math.round((src.r * sa + dst.r * da * (1 - sa)) / outA);
          const outG = Math.round((src.g * sa + dst.g * da * (1 - sa)) / outA);
          const outB = Math.round((src.b * sa + dst.b * da * (1 - sa)) / outA);

          composite[dstIdx] = packRgba(outR, outG, outB, Math.round(outA * 255));
        }
      }
    }
    return composite;
  }

  public exportFramePngBase64(frameNumber = this.activeFrameNumber, targetLayer?: MockLayer): string {
    let buffer: Uint32Array;
    if (targetLayer) {
      buffer = new Uint32Array(this.width * this.height);
      const cel = this.cels.get(`${targetLayer.index}:${frameNumber}`);
      if (cel) {
        const layerAlphaRatio = targetLayer.opacity / 255;
        for (let y = 0; y < this.height; y++) {
          for (let x = 0; x < this.width; x++) {
            const srcColor = this.getCelPixel(cel, x, y);
            if (srcColor === 0) continue;
            const src = unpackRgba(srcColor);
            const effectiveSrcAlpha = Math.round(src.a * layerAlphaRatio);
            buffer[y * this.width + x] = packRgba(src.r, src.g, src.b, effectiveSrcAlpha);
          }
        }
      }
    } else {
      buffer = this.getCompositeBuffer(frameNumber);
    }
    const png = new PNG({ width: this.width, height: this.height });
    const byteView = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

    for (let i = 0; i < byteView.length; i++) {
      png.data[i] = byteView[i];
    }

    const pngBuffer = PNG.sync.write(png);
    return pngBuffer.toString("base64");
  }

  public resolveTargetLayer(params: Record<string, any>, forWriting = false): MockLayer {
    let byIndex: MockLayer | undefined;
    if (params.layerIndex !== undefined) {
      const idx = params.layerIndex;
      if (typeof idx !== "number" || !Number.isInteger(idx) || idx < 0 || idx >= this.layers.length) {
        throw new Error(`Invalid layerIndex: ${idx}`);
      }
      byIndex = this.layers.find((l) => l.index === idx);
      if (!byIndex) {
        throw new Error(`Layer with index ${idx} not found.`);
      }
    }

    let byName: MockLayer | undefined;
    if (params.layerName !== undefined) {
      const matched = this.layers.filter((l) => l.name === params.layerName);
      if (matched.length === 0) {
        throw new Error(`Layer '${params.layerName}' not found.`);
      } else if (matched.length > 1) {
        throw new Error(`Ambiguous layerName '${params.layerName}': found multiple matching layers.`);
      }
      byName = matched[0];
    }

    let targetLayer: MockLayer | undefined;
    if (byIndex !== undefined && byName !== undefined) {
      if (byIndex !== byName) {
        throw new Error("Conflicting layer selectors: layerIndex and layerName refer to different layers.");
      }
      targetLayer = byIndex;
    } else if (byIndex !== undefined) {
      targetLayer = byIndex;
    } else if (byName !== undefined) {
      targetLayer = byName;
    } else {
      targetLayer = this.layers.find((l) => l.index === this.activeLayerIndex) ?? this.layers[0];
    }

    if (!targetLayer) {
      throw new Error("No target layer available.");
    }

    if (targetLayer.isGroup) {
      throw new Error("Cannot paint on or read from a group layer.");
    }

    if (forWriting) {
      if (targetLayer.isLocked || targetLayer.isEditable === false) {
        throw new Error("Cannot paint on locked or non-editable layer.");
      }
    }

    return targetLayer;
  }

  public resolveTargetFrame(rawFrame: any): MockFrame {
    if (rawFrame !== undefined) {
      if (typeof rawFrame !== "number" || !Number.isInteger(rawFrame) || rawFrame < 1 || rawFrame > this.frames.length) {
        throw new Error(`Invalid frame: ${rawFrame}`);
      }
      const f = this.frames.find((fr) => fr.frameNumber === rawFrame);
      if (!f) throw new Error(`Invalid frame: ${rawFrame}`);
      return f;
    }
    const current = this.frames.find((fr) => fr.frameNumber === this.activeFrameNumber);
    return current ?? this.frames[0];
  }

  public getStatus(): AsepriteStatusResult {
    const activeLayer = this.layers.find((l) => l.index === this.activeLayerIndex);
    return {
      connected: true,
      hasActiveSprite: this.hasActiveSprite,
      filename: this.hasActiveSprite ? this.filename : "",
      width: this.hasActiveSprite ? this.width : 0,
      height: this.hasActiveSprite ? this.height : 0,
      colorMode: this.hasActiveSprite ? this.colorMode : "",
      layersCount: this.hasActiveSprite ? this.layers.length : 0,
      framesCount: this.hasActiveSprite ? this.frames.length : 0,
      activeLayer: this.hasActiveSprite && activeLayer ? activeLayer.name : "",
      activeFrame: this.hasActiveSprite ? this.activeFrameNumber : 1,
      revision: this.hasActiveSprite ? this.revision : 0,
    };
  }

  public executeCommand(command: string, params: Record<string, any>): any {
    switch (command) {
      case "aseprite_status":
        return this.getStatus();

      case "get_sprite_info":
        if (!this.hasActiveSprite) throw new Error("No active sprite open in Aseprite.");
        return {
          width: this.width,
          height: this.height,
          colorMode: this.colorMode,
          layers: this.layers.map((l) => ({ ...l })),
          frames: this.frames.map((f) => ({ ...f })),
          activeLayer: this.layers.find((l) => l.index === this.activeLayerIndex)?.name ?? "",
          activeFrame: this.activeFrameNumber,
          revision: this.revision,
        };

      case "get_canvas": {
        if (!this.hasActiveSprite) throw new Error("No active sprite open in Aseprite.");
        const targetFrame = this.resolveTargetFrame(params.frameIndex ?? params.frameNumber);
        const frameNum = targetFrame.frameNumber;
        let targetLayer: MockLayer | undefined;
        if (params.layerName !== undefined) {
          const matched = this.layers.filter((l) => l.name === params.layerName);
          if (matched.length === 0) {
            throw new Error(`Layer '${params.layerName}' not found.`);
          }
          if (matched.length > 1) {
            throw new Error(`Ambiguous layerName '${params.layerName}': found multiple matching layers.`);
          }
          if (matched[0].isGroup) {
            throw new Error("Cannot render group layer.");
          }
          targetLayer = matched[0];
        }
        return {
          width: this.width,
          height: this.height,
          frameNumber: frameNum,
          pngBase64: this.exportFramePngBase64(frameNum, targetLayer),
          revision: this.revision,
        };
      }

      case "get_pixel_grid": {
        if (!this.hasActiveSprite) throw new Error("No active sprite open in Aseprite.");
        const targetLayer = this.resolveTargetLayer(params, false);
        const targetFrame = this.resolveTargetFrame(params.frameIndex ?? params.frameNumber);
        const layerIdx = targetLayer.index;
        const frameNum = targetFrame.frameNumber;

        let rx = 0;
        let ry = 0;
        let rw = this.width;
        let rh = this.height;

        if (params.region !== undefined) {
          const { x, y, width, height } = params.region;
          if (typeof x !== "number" || !Number.isInteger(x) || x < 0 ||
              typeof y !== "number" || !Number.isInteger(y) || y < 0) {
            throw new Error("Region coordinates (x, y) must be non-negative integers.");
          }
          if (typeof width !== "number" || !Number.isInteger(width) || width <= 0 ||
              typeof height !== "number" || !Number.isInteger(height) || height <= 0) {
            throw new Error("Region dimensions (width, height) must be positive integers.");
          }
          if (x >= this.width || y >= this.height) {
            throw new Error("Region origin outside canvas bounds.");
          }
          rx = x;
          ry = y;
          rw = Math.min(width, this.width - x);
          rh = Math.min(height, this.height - y);
        }

        const cel = this.cels.get(`${layerIdx}:${frameNum}`);
        const format = params.format ?? "hex";
        const isIndexed = this.colorMode === "indexed";
        const grid: any[] = [];
        const paletteList: string[] = [];
        const paletteMap = new Map<string, number>();

        for (let y = ry; y < ry + rh; y++) {
          const row: any[] = [];
          for (let x = rx; x < rx + rw; x++) {
            const colorInt = cel ? this.getCelPixel(cel, x, y) : 0;
            if (format === "hex") {
              row.push(rgbaToHex(colorInt));
            } else if (format === "rgba") {
              row.push(unpackRgba(colorInt));
            } else if (format === "indexed") {
              row.push(colorInt);
            } else if (format === "compact") {
              const hex = rgbaToHex(colorInt);
              if (!paletteMap.has(hex)) {
                paletteList.push(hex);
                paletteMap.set(hex, paletteList.length - 1);
              }
              row.push(paletteMap.get(hex)!);
            }
          }
          grid.push(row);
        }

        const res: any = {
          width: rw,
          height: rh,
          format,
          grid,
          indexedSource: isIndexed,
          revision: this.revision,
        };
        if (params.region !== undefined) {
          res.origin = { x: rx, y: ry };
          res.region = { x: rx, y: ry, width: rw, height: rh };
        }
        if (format === "compact") res.palette = paletteList;
        return res;
      }

      case "inspect_sprite": {
        const canvasRes = this.executeCommand("get_canvas", params);
        const gridRes = this.executeCommand("get_pixel_grid", { ...params, format: params.format ?? "compact" });
        return {
          width: canvasRes.width,
          height: canvasRes.height,
          pngBase64: canvasRes.pngBase64,
          activeLayer: this.layers.find((l) => l.index === this.activeLayerIndex)?.name ?? "",
          activeFrame: this.activeFrameNumber,
          pixelGrid: gridRes,
          revision: this.revision,
        };
      }

      case "set_pixels": {
        if (!this.hasActiveSprite) throw new Error("No active sprite open in Aseprite.");
        const pixels: Array<{ x: number; y: number; color: string }> = params.pixels;
        if (!pixels || pixels.length === 0) throw new Error("No pixels provided.");
        if (pixels.length > MAX_PIXELS_BATCH) {
          throw new Error(`Pixel batch size exceeds maximum allowed (${MAX_PIXELS_BATCH})`);
        }

        const targetLayer = this.resolveTargetLayer(params, true);
        const targetFrame = this.resolveTargetFrame(params.frameNumber);
        const layerIdx = targetLayer.index;
        const frameNum = targetFrame.frameNumber;

        const cel = this.getOrCreateCel(layerIdx, frameNum);
        const deltas: PixelDelta[] = [];
        let minX = this.width, minY = this.height, maxX = 0, maxY = 0;
        let modifiedCount = 0;

        for (const p of pixels) {
          if (p.x < 0 || p.x >= this.width || p.y < 0 || p.y >= this.height) continue;
          const newColor = hexToRgba(p.color);
          const prevColor = this.getCelPixel(cel, p.x, p.y);

          if (prevColor !== newColor) {
            this.setCelPixel(cel, p.x, p.y, newColor);
            deltas.push({
              layerIndex: layerIdx,
              frameNumber: frameNum,
              x: p.x,
              y: p.y,
              prevColor,
              newColor,
            });
            modifiedCount++;
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
          }
        }

        if (deltas.length > 0) {
          this.revision++;
          this.undoStack.push({
            id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            name: "set_pixels",
            revisionBefore: this.revision - 1,
            revisionAfter: this.revision,
            pixelDeltas: deltas,
          });
          this.redoStack = [];

          this.changeJournal.push({
            revision: this.revision,
            pixelsChanged: modifiedCount,
            bounds: {
              x: minX,
              y: minY,
              width: maxX - minX + 1,
              height: maxY - minY + 1,
            },
          });
          if (this.changeJournal.length > MAX_CHANGE_JOURNAL_ENTRIES) {
            this.changeJournal.shift();
          }
        }

        const out: any = {
          pixelsModified: modifiedCount,
          pixelsChanged: modifiedCount,
          bounds: modifiedCount > 0 ? {
            x: minX,
            y: minY,
            width: maxX - minX + 1,
            height: maxY - minY + 1,
          } : { x: 0, y: 0, width: 0, height: 0 },
          revision: this.revision,
        };
        if (params.returnPreview) {
          out.pngBase64 = this.exportFramePngBase64(frameNum);
        }
        return out;
      }

      case "set_pixel":
        return this.executeCommand("set_pixels", {
          ...params,
          pixels: [{ x: params.x, y: params.y, color: params.color }],
        });

      case "erase_pixels": {
        const points: Array<{ x: number; y: number }> = params.points ?? [];
        if (points.length > MAX_PIXELS_BATCH) {
          throw new Error(`Points batch size exceeds maximum allowed (${MAX_PIXELS_BATCH})`);
        }
        return this.executeCommand("set_pixels", {
          ...params,
          pixels: points.map((pt) => ({ x: pt.x, y: pt.y, color: "#00000000" })),
        });
      }

      case "undo": {
        if (!this.hasActiveSprite) throw new Error("No active sprite.");
        if (this.undoStack.length === 0) throw new Error("No undo transactions available.");

        const tx = this.undoStack.pop()!;
        for (let i = tx.pixelDeltas.length - 1; i >= 0; i--) {
          const delta = tx.pixelDeltas[i];
          const cel = this.getOrCreateCel(delta.layerIndex, delta.frameNumber);
          this.setCelPixel(cel, delta.x, delta.y, delta.prevColor);
        }
        this.redoStack.push(tx);
        this.revision++;
        return {
          success: true,
          restoredRevision: tx.revisionBefore,
          revision: this.revision,
        };
      }

      case "redo": {
        if (!this.hasActiveSprite) throw new Error("No active sprite.");
        if (this.redoStack.length === 0) throw new Error("No redo transactions available.");

        const tx = this.redoStack.pop()!;
        for (let i = 0; i < tx.pixelDeltas.length; i++) {
          const delta = tx.pixelDeltas[i];
          const cel = this.getOrCreateCel(delta.layerIndex, delta.frameNumber);
          this.setCelPixel(cel, delta.x, delta.y, delta.newColor);
        }
        this.undoStack.push(tx);
        this.revision++;
        return {
          success: true,
          replayedRevision: tx.revisionAfter,
          revision: this.revision,
        };
      }

      case "new_sprite": {
        const w = params.width ?? 32;
        const h = params.height ?? 32;
        this.reset(w, h);
        if (params.colorMode) this.colorMode = params.colorMode;
        return {
          success: true,
          width: this.width,
          height: this.height,
          colorMode: this.colorMode,
          revision: this.revision,
        };
      }

      case "draw_line": {
        const { x1, y1, x2, y2, color, thickness = 1 } = params;
        const pixels: Array<{ x: number; y: number; color: string }> = [];
        let x = x1, y = y1;
        const dx = Math.abs(x2 - x1);
        const dy = Math.abs(y2 - y1);
        const sx = x1 < x2 ? 1 : -1;
        const sy = y1 < y2 ? 1 : -1;
        let err = dx - dy;

        while (true) {
          for (let tx = 0; tx < thickness; tx++) {
            for (let ty = 0; ty < thickness; ty++) {
              pixels.push({ x: x + tx, y: y + ty, color });
            }
          }
          if (x === x2 && y === y2) break;
          const e2 = 2 * err;
          if (e2 > -dy) { err -= dy; x += sx; }
          if (e2 < dx) { err += dx; y += sy; }
        }
        return this.executeCommand("set_pixels", { ...params, pixels });
      }

      case "draw_rectangle": {
        const { x, y, width, height, color, filled = false } = params;
        const pixels: Array<{ x: number; y: number; color: string }> = [];
        for (let cy = y; cy < y + height; cy++) {
          for (let cx = x; cx < x + width; cx++) {
            if (filled || cy === y || cy === y + height - 1 || cx === x || cx === x + width - 1) {
              pixels.push({ x: cx, y: cy, color });
            }
          }
        }
        return this.executeCommand("set_pixels", { ...params, pixels });
      }

      case "draw_ellipse": {
        const { x, y, width, height, color, filled = false } = params;
        const pixels: Array<{ x: number; y: number; color: string }> = [];
        const rx = width / 2;
        const ry = height / 2;
        const cx = x + rx;
        const cy = y + ry;

        for (let py = y; py < y + height; py++) {
          for (let px = x; px < x + width; px++) {
            const dx = (px + 0.5 - cx) / rx;
            const dy = (py + 0.5 - cy) / ry;
            const dist = dx * dx + dy * dy;

            if (filled) {
              if (dist <= 1.0) pixels.push({ x: px, y: py, color });
            } else {
              if (dist <= 1.0 && dist >= 0.6) {
                pixels.push({ x: px, y: py, color });
              }
            }
          }
        }
        return this.executeCommand("set_pixels", { ...params, pixels });
      }

      case "flood_fill": {
        const { x, y, color, tolerance = 0 } = params;
        if (typeof x !== "number" || typeof y !== "number" || x < 0 || x >= this.width || y < 0 || y >= this.height) {
          throw new Error(`Seed coordinate (${x}, ${y}) out of bounds`);
        }

        const targetLayer = this.resolveTargetLayer(params, true);
        const targetFrame = this.resolveTargetFrame(params.frameNumber);
        const cel = this.getOrCreateCel(targetLayer.index, targetFrame.frameNumber);
        const targetColor = this.getCelPixel(cel, x, y);
        const newColor = hexToRgba(color);
        if (targetColor === newColor && tolerance === 0) {
          return {
            pixelsModified: 0,
            pixelsChanged: 0,
            bounds: { x: 0, y: 0, width: 0, height: 0 },
            revision: this.revision,
          };
        }

        const targetUnpacked = unpackRgba(targetColor);
        const pixelsToPaint: Array<{ x: number; y: number; color: string }> = [];

        if (params.contiguous === false) {
          for (let cy = 0; cy < this.height; cy++) {
            for (let cx = 0; cx < this.width; cx++) {
              const c = unpackRgba(this.getCelPixel(cel, cx, cy));
              const diff = Math.abs(c.r - targetUnpacked.r) + Math.abs(c.g - targetUnpacked.g) + Math.abs(c.b - targetUnpacked.b) + Math.abs(c.a - targetUnpacked.a);
              if (diff <= tolerance * 4) {
                pixelsToPaint.push({ x: cx, y: cy, color });
                if (pixelsToPaint.length > MAX_PIXELS_BATCH) {
                  throw new Error(`Flood fill candidate count exceeds MAX_PIXELS_BATCH (${MAX_PIXELS_BATCH})`);
                }
              }
            }
          }
        } else {
          const visited = new Uint8Array(this.width * this.height);
          const queue: Array<[number, number]> = [[x, y]];
          let head = 0;
          visited[y * this.width + x] = 1;

          while (head < queue.length) {
            const [cx, cy] = queue[head++];
            pixelsToPaint.push({ x: cx, y: cy, color });
            if (pixelsToPaint.length > MAX_PIXELS_BATCH) {
              throw new Error(`Flood fill candidate count exceeds MAX_PIXELS_BATCH (${MAX_PIXELS_BATCH})`);
            }

            const neighbors: Array<[number, number]> = [
              [cx + 1, cy],
              [cx - 1, cy],
              [cx, cy + 1],
              [cx, cy - 1],
            ];

            for (const [nx, ny] of neighbors) {
              if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
                const idx = ny * this.width + nx;
                if (!visited[idx]) {
                  visited[idx] = 1;
                  const c = unpackRgba(this.getCelPixel(cel, nx, ny));
                  const diff = Math.abs(c.r - targetUnpacked.r) + Math.abs(c.g - targetUnpacked.g) + Math.abs(c.b - targetUnpacked.b) + Math.abs(c.a - targetUnpacked.a);
                  if (diff <= tolerance * 4) {
                    queue.push([nx, ny]);
                  }
                }
              }
            }
          }
        }

        return this.executeCommand("set_pixels", {
          ...params,
          layerIndex: targetLayer.index,
          frameNumber: targetFrame.frameNumber,
          pixels: pixelsToPaint,
        });
      }

      case "replace_color": {
        const { fromColor, toColor, tolerance = 0 } = params;
        const targetLayer = this.resolveTargetLayer(params, true);
        const targetFrame = this.resolveTargetFrame(params.frameNumber);
        const cel = this.getOrCreateCel(targetLayer.index, targetFrame.frameNumber);

        const fromInt = hexToRgba(fromColor);
        const fromUnpacked = unpackRgba(fromInt);

        const pixelsToPaint: Array<{ x: number; y: number; color: string }> = [];
        for (let y = 0; y < this.height; y++) {
          for (let x = 0; x < this.width; x++) {
            const current = this.getCelPixel(cel, x, y);
            const c = unpackRgba(current);
            const diff = Math.abs(c.r - fromUnpacked.r) + Math.abs(c.g - fromUnpacked.g) + Math.abs(c.b - fromUnpacked.b) + Math.abs(c.a - fromUnpacked.a);
            if (diff <= tolerance * 4) {
              pixelsToPaint.push({ x, y, color: toColor });
              if (pixelsToPaint.length > MAX_PIXELS_BATCH) {
                throw new Error(`Replace color candidate count exceeds MAX_PIXELS_BATCH (${MAX_PIXELS_BATCH})`);
              }
            }
          }
        }

        if (pixelsToPaint.length === 0) {
          return {
            pixelsModified: 0,
            pixelsChanged: 0,
            bounds: { x: 0, y: 0, width: 0, height: 0 },
            revision: this.revision,
          };
        }

        return this.executeCommand("set_pixels", {
          ...params,
          layerIndex: targetLayer.index,
          frameNumber: targetFrame.frameNumber,
          pixels: pixelsToPaint,
        });
      }

      case "get_changes_since": {
        const since = params.sinceRevision;
        if (typeof since !== "number" || !Number.isInteger(since) || since < 0) {
          return {
            changed: true,
            sinceRevision: since,
            currentRevision: this.revision,
            fullRefreshRequired: true,
          };
        }

        if (since === this.revision) {
          return {
            changed: false,
            sinceRevision: since,
            currentRevision: this.revision,
            pixelsChanged: 0,
            bounds: null,
          };
        }

        if (since > this.revision || (this.revision - since) > MAX_CHANGE_JOURNAL_ENTRIES) {
          return {
            changed: true,
            sinceRevision: since,
            currentRevision: this.revision,
            fullRefreshRequired: true,
          };
        }

        const journalMap = new Map<number, PixelJournalEntry>();
        for (const entry of this.changeJournal) {
          journalMap.set(entry.revision, entry);
        }

        let totalPixels = 0;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        for (let r = since + 1; r <= this.revision; r++) {
          const entry = journalMap.get(r);
          if (!entry) {
            return {
              changed: true,
              sinceRevision: since,
              currentRevision: this.revision,
              fullRefreshRequired: true,
            };
          }
          totalPixels += entry.pixelsChanged;
          minX = Math.min(minX, entry.bounds.x);
          minY = Math.min(minY, entry.bounds.y);
          maxX = Math.max(maxX, entry.bounds.x + entry.bounds.width - 1);
          maxY = Math.max(maxY, entry.bounds.y + entry.bounds.height - 1);
        }

        return {
          changed: true,
          sinceRevision: since,
          currentRevision: this.revision,
          pixelsChanged: totalPixels,
          bounds: {
            x: minX,
            y: minY,
            width: maxX - minX + 1,
            height: maxY - minY + 1,
          },
        };
      }

      // Palette tools
      case "get_palette": {
        const colors: Array<{ index: number; hex: string; rgba: { r: number; g: number; b: number; a: number } }> = [];
        for (let i = 0; i < this.palette.length; i++) {
          const colorInt = this.palette[i];
          colors.push({
            index: i,
            hex: rgbaToHex(colorInt),
            rgba: unpackRgba(colorInt),
          });
        }
        return { count: colors.length, colors, revision: this.revision };
      }

      case "set_palette_color": {
        const idx = params.index;
        if (idx < 0 || idx >= this.palette.length) throw new Error("Index out of palette bounds.");
        this.palette[idx] = hexToRgba(params.color);
        this.revision++;
        return { success: true, index: idx, color: params.color, revision: this.revision };
      }

      case "find_palette_color": {
        const target = unpackRgba(hexToRgba(params.color));
        const findNearest = params.findNearest !== false;
        let bestIdx = 0;
        let minDiff = Infinity;

        for (let i = 0; i < this.palette.length; i++) {
          const c = unpackRgba(this.palette[i]);
          const diff = Math.sqrt(
            Math.pow(c.r - target.r, 2) +
            Math.pow(c.g - target.g, 2) +
            Math.pow(c.b - target.b, 2) +
            Math.pow(c.a - target.a, 2)
          );
          if (diff < minDiff) {
            minDiff = diff;
            bestIdx = i;
          }
          if (diff === 0) break;
        }

        const isExact = minDiff === 0;
        if (!isExact && !findNearest) {
          return {
            success: true,
            found: false,
            exact: false,
          };
        }

        return {
          success: true,
          found: true,
          index: bestIdx,
          hex: rgbaToHex(this.palette[bestIdx]),
          exact: isExact,
          distance: isExact ? 0 : minDiff,
        };
      }

      // Layer tools
      case "list_layers":
        return { layers: this.layers.map((l) => ({ ...l })) };

      case "create_layer": {
        let parentIndex: number | null = null;
        if (params.parentGroup !== undefined && params.parentGroup !== null) {
          const matched = this.layers.filter((l) => l.name === params.parentGroup);
          if (matched.length === 0) {
            throw new Error(`Parent group '${params.parentGroup}' not found.`);
          }
          if (matched.length > 1) {
            throw new Error(`Ambiguous parentGroup '${params.parentGroup}': found multiple matching layers.`);
          }
          if (!matched[0].isGroup) {
            throw new Error(`Layer '${params.parentGroup}' is not a group.`);
          }
          parentIndex = matched[0].index;
        }

        const newLayer: MockLayer = {
          index: this.layers.length,
          name: params.name ?? `Layer ${this.layers.length + 1}`,
          isVisible: true,
          isEditable: true,
          isLocked: false,
          opacity: 255,
          blendMode: "normal",
          isGroup: false,
          isBackground: false,
          parentIndex,
        };
        this.layers.push(newLayer);
        this.revision++;
        return { success: true, name: newLayer.name, layer: newLayer, revision: this.revision };
      }

      case "rename_layer": {
        const layer = this.layers.find((l) => l.name === params.oldName);
        if (!layer) throw new Error(`Layer '${params.oldName}' not found.`);
        layer.name = params.newName;
        this.revision++;
        return { success: true, oldName: params.oldName, newName: params.newName, revision: this.revision };
      }

      case "delete_layer": {
        const idx = this.layers.findIndex((l) => l.name === params.name);
        if (idx === -1) throw new Error(`Layer '${params.name}' not found.`);
        this.layers.splice(idx, 1);
        this.revision++;
        return { success: true, deletedLayer: params.name, revision: this.revision };
      }

      case "select_layer": {
        const layer = this.layers.find((l) => l.name === params.name);
        if (!layer) throw new Error(`Layer '${params.name}' not found.`);
        this.activeLayerIndex = layer.index;
        return { success: true, activeLayer: layer.name };
      }

      case "set_layer_visibility": {
        const layer = this.layers.find((l) => l.name === params.name);
        if (!layer) throw new Error(`Layer '${params.name}' not found.`);
        layer.isVisible = params.visible;
        this.revision++;
        return { success: true, name: layer.name, visible: layer.isVisible, revision: this.revision };
      }

      case "set_layer_opacity": {
        const layer = this.layers.find((l) => l.name === params.name);
        if (!layer) throw new Error(`Layer '${params.name}' not found.`);
        layer.opacity = params.opacity;
        this.revision++;
        return { success: true, name: layer.name, opacity: layer.opacity, revision: this.revision };
      }

      case "move_layer": {
        const idx = this.layers.findIndex((l) => l.name === params.name);
        if (idx === -1) throw new Error(`Layer '${params.name}' not found.`);
        const [layer] = this.layers.splice(idx, 1);
        this.layers.splice(params.targetIndex, 0, layer);
        this.revision++;
        return { success: true, moved: layer.name, targetIndex: params.targetIndex, revision: this.revision };
      }

      case "create_group": {
        const group: MockLayer = {
          index: this.layers.length,
          name: params.name,
          isVisible: true,
          isEditable: true,
          isLocked: false,
          opacity: 255,
          blendMode: "normal",
          isGroup: true,
          isBackground: false,
          parentIndex: null,
        };
        this.layers.push(group);
        this.revision++;
        return { success: true, group, revision: this.revision };
      }

      // Frame tools
      case "list_frames":
        return { frames: this.frames.map((f) => ({ ...f, durationMs: Math.round(f.duration * 1000) })) };

      case "select_frame": {
        const f = this.frames.find((fr) => fr.frameNumber === params.frameNumber);
        if (!f) throw new Error(`Frame ${params.frameNumber} does not exist.`);
        this.activeFrameNumber = f.frameNumber;
        return { success: true, activeFrame: f.frameNumber };
      }

      case "create_frame": {
        if (params.durationMs !== undefined) {
          throw new Error("create_frame accepts 'duration', not 'durationMs'");
        }
        if (params.afterFrame !== undefined && params.afterFrame !== null) {
          if (typeof params.afterFrame !== "number" || !Number.isInteger(params.afterFrame) || params.afterFrame < 1 || params.afterFrame > this.frames.length) {
            throw new Error(`Invalid afterFrame: ${params.afterFrame}`);
          }
        }
        const targetPos = params.afterFrame ? params.afterFrame + 1 : this.frames.length + 1;
        const durMs = params.duration ?? 100;
        const dur = durMs / 1000;
        const newFrame: MockFrame = { frameNumber: targetPos, duration: dur };

        if (targetPos <= this.frames.length) {
          this.frames.splice(targetPos - 1, 0, newFrame);
          for (let i = targetPos; i < this.frames.length; i++) {
            this.frames[i].frameNumber = i + 1;
          }
          const updatedCels = new Map<string, MockCel>();
          for (const cel of this.cels.values()) {
            if (cel.frameNumber >= targetPos) {
              cel.frameNumber += 1;
            }
            updatedCels.set(`${cel.layerIndex}:${cel.frameNumber}`, cel);
          }
          this.cels = updatedCels;
        } else {
          this.frames.push(newFrame);
        }

        if (targetPos <= this.activeFrameNumber) {
          this.activeFrameNumber += 1;
        }

        this.revision++;
        return {
          success: true,
          frameNumber: targetPos,
          createdFrameNumber: targetPos,
          totalFrames: this.frames.length,
          durationMs: durMs,
          revision: this.revision,
        };
      }

      case "duplicate_frame": {
        const srcFrame = this.frames.find((fr) => fr.frameNumber === params.frameNumber);
        if (!srcFrame) throw new Error(`Frame ${params.frameNumber} not found.`);
        const nextNum = this.frames.length + 1;
        this.frames.push({ frameNumber: nextNum, duration: srcFrame.duration });

        // Copy cels
        for (const layer of this.layers) {
          const oldCel = this.cels.get(`${layer.index}:${srcFrame.frameNumber}`);
          if (oldCel) {
            this.cels.set(`${layer.index}:${nextNum}`, {
              layerIndex: layer.index,
              frameNumber: nextNum,
              bounds: { ...oldCel.bounds },
              pixels: new Uint32Array(oldCel.pixels),
            });
          }
        }
        this.revision++;
        return { success: true, originalFrame: srcFrame.frameNumber, newFrame: nextNum, revision: this.revision };
      }

      case "delete_frame": {
        const idx = this.frames.findIndex((fr) => fr.frameNumber === params.frameNumber);
        if (idx === -1) throw new Error(`Frame ${params.frameNumber} not found.`);
        this.frames.splice(idx, 1);
        this.revision++;
        return { success: true, deletedFrame: params.frameNumber, revision: this.revision };
      }

      case "set_frame_duration": {
        const f = this.frames.find((fr) => fr.frameNumber === params.frameNumber);
        if (!f) throw new Error(`Frame ${params.frameNumber} not found.`);
        f.duration = params.durationMs / 1000;
        this.revision++;
        return { success: true, frameNumber: f.frameNumber, durationMs: params.durationMs, revision: this.revision };
      }

      case "create_tag": {
        const from = params.fromFrame;
        const to = params.toFrame;
        if (typeof from !== "number" || !Number.isInteger(from) || from < 1 || from > this.frames.length) {
          throw new Error(`Frame ${from} out of range`);
        }
        if (typeof to !== "number" || !Number.isInteger(to) || to < 1 || to > this.frames.length) {
          throw new Error(`Frame ${to} out of range`);
        }
        if (from > to) {
          throw new Error("fromFrame must be <= toFrame");
        }
        const normalizedColor = params.color ? rgbaToHex(hexToRgba(params.color)) : undefined;
        this.tags.push({
          name: params.name,
          from,
          to,
          color: normalizedColor,
        });
        this.revision++;
        return { success: true, tag: params.name, revision: this.revision };
      }

      case "list_tags":
        return {
          tags: this.tags.map((t) => ({
            ...t,
            fromFrame: t.from,
            toFrame: t.to,
          })),
        };

      // File / Canvas tools
      case "open_sprite":
        this.filename = params.filePath;
        this.mockExistingFiles.add(params.filePath);
        this.revision = 1;
        this.changeJournal = [];
        return { success: true, filename: this.filename, revision: this.revision };

      case "save_sprite":
        if (!params || !params.expectedFilePath || typeof params.expectedFilePath !== "string") {
          throw new Error("expectedFilePath is required.");
        }
        const normExpected = params.expectedFilePath.replace(/\\/g, "/");
        const normActual = this.filename.replace(/\\/g, "/");
        if (normExpected !== normActual) {
          throw new Error(
            `Sprite filename mismatch: expected '${params.expectedFilePath}', but active sprite is '${this.filename}'.`
          );
        }
        return { success: true, filename: this.filename, message: "Saved sprite successfully" };

      case "save_sprite_as":
        if (!params || !params.filePath || typeof params.filePath !== "string") {
          throw new Error("filePath is required.");
        }
        if (params.overwrite !== true && this.mockExistingFiles.has(params.filePath)) {
          throw new Error(`File already exists and overwrite is false: ${params.filePath}`);
        }
        this.filename = params.filePath;
        this.mockExistingFiles.add(params.filePath);
        return { success: true, filename: this.filename, message: `Saved sprite as ${this.filename}` };

      case "export_png": {
        if (!params.outputPath || typeof params.outputPath !== "string") {
          throw new Error("outputPath is required.");
        }
        let frameNumber = params.frameNumber ?? this.activeFrameNumber;
        if (typeof frameNumber !== "number" || !Number.isInteger(frameNumber) || frameNumber < 1 || frameNumber > this.frames.length) {
          throw new Error(`Invalid frame: ${frameNumber}`);
        }
        const scale = params.scale ?? 1;
        if (typeof scale !== "number" || !Number.isInteger(scale) || scale < 1 || scale > 32) {
          throw new Error(`Invalid scale: ${scale}. Must be an integer between 1 and 32.`);
        }
        if (params.overwrite !== true && this.mockExistingFiles.has(params.outputPath)) {
          throw new Error(`File already exists and overwrite is false: ${params.outputPath}`);
        }
        this.mockExistingFiles.add(params.outputPath);
        return {
          success: true,
          outputPath: params.outputPath,
          frameNumber,
          scale,
          width: this.width * scale,
          height: this.height * scale,
        };
      }

      case "resize_canvas": {
        const { width, height } = params;
        if (typeof width !== "number" || !Number.isInteger(width) || width < 1 || width > 4096 ||
            typeof height !== "number" || !Number.isInteger(height) || height < 1 || height > 4096) {
          throw new Error("Canvas dimensions must be integers between 1 and 4096");
        }
        const validAnchors = new Set(["top_left", "center", "top_right", "bottom_left", "bottom_right"]);
        const anchor = params.anchor ?? "top_left";
        if (!validAnchors.has(anchor)) {
          throw new Error(`Invalid anchor: ${anchor}`);
        }

        const oldW = this.width;
        const oldH = this.height;

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

        this.width = width;
        this.height = height;

        // Resize all cels with anchor shift and transparent blank exposed pixels
        for (const cel of this.cels.values()) {
          const newPixels = new Uint32Array(this.width * this.height);
          for (let ny = 0; ny < this.height; ny++) {
            const oldY = ny - dy;
            if (oldY < 0 || oldY >= oldH) continue;
            for (let nx = 0; nx < this.width; nx++) {
              const oldX = nx - dx;
              if (oldX < 0 || oldX >= oldW) continue;
              newPixels[ny * this.width + nx] = cel.pixels[oldY * oldW + oldX];
            }
          }
          cel.bounds = { x: 0, y: 0, width: this.width, height: this.height };
          cel.pixels = newPixels;
        }

        this.revision++;
        const ox = -x === 0 ? 0 : -x;
        const oy = -y === 0 ? 0 : -y;
        return {
          success: true,
          previousWidth: oldW,
          previousHeight: oldH,
          width: this.width,
          height: this.height,
          oldDimensions: { width: oldW, height: oldH },
          newDimensions: { width: this.width, height: this.height },
          anchor,
          contentOffset: { x: ox, y: oy },
          revision: this.revision,
        };
      }

      default:
        throw new Error(`Command '${command}' not implemented in MockEngine.`);
    }
  }
}
