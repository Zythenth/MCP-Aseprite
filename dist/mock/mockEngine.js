// src/mock/mockEngine.ts
import { PNG } from "pngjs";
import { randomUUID } from "node:crypto";
import { MAX_PIXELS_BATCH, MAX_TILESET_PIXELS, MAX_ANIMATION_BATCH_OPERATIONS, MAX_ANIMATION_BATCH_FRAMES, MAX_ANIMATION_BATCH_PAYLOAD_BYTES, } from "../config.js";
export const MAX_CHANGE_JOURNAL_ENTRIES = 128;
export function packRgba(r, g, b, a) {
    return (((a & 0xff) << 24) | ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff)) >>> 0;
}
export function unpackRgba(color) {
    return {
        r: color & 0xff,
        g: (color >> 8) & 0xff,
        b: (color >> 16) & 0xff,
        a: (color >>> 24) & 0xff,
    };
}
function alphaComposite(dstColor, srcColor, opacity = 255) {
    const src = unpackRgba(srcColor);
    const dst = unpackRgba(dstColor);
    const sa = (src.a / 255) * (opacity / 255);
    const da = dst.a / 255;
    const outA = sa + da * (1 - sa);
    if (outA <= 0)
        return 0;
    return packRgba(Math.round((src.r * sa + dst.r * da * (1 - sa)) / outA), Math.round((src.g * sa + dst.g * da * (1 - sa)) / outA), Math.round((src.b * sa + dst.b * da * (1 - sa)) / outA), Math.round(outA * 255));
}
const TILE_INDEX_MASK = 0x1fffffff;
const TILE_X_FLIP = 0x80000000;
const TILE_Y_FLIP = 0x40000000;
const TILE_DIAGONAL_FLIP = 0x20000000;
function packTileReference(index, xFlip = false, yFlip = false, diagonalFlip = false) {
    return ((index & TILE_INDEX_MASK) |
        (xFlip ? TILE_X_FLIP : 0) |
        (yFlip ? TILE_Y_FLIP : 0) |
        (diagonalFlip ? TILE_DIAGONAL_FLIP : 0)) >>> 0;
}
function unpackTileReference(value) {
    return {
        tileIndex: value & TILE_INDEX_MASK,
        xFlip: (value & TILE_X_FLIP) !== 0,
        yFlip: (value & TILE_Y_FLIP) !== 0,
        diagonalFlip: (value & TILE_DIAGONAL_FLIP) !== 0,
    };
}
function encodePixelBufferPng(width, height, pixels) {
    const png = new PNG({ width, height });
    const bytes = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
    png.data.set(bytes);
    return PNG.sync.write(png).toString("base64");
}
export function hexToRgba(hex) {
    const clean = hex.trim().replace(/^#/, "");
    let r = 0, g = 0, b = 0, a = 255;
    if (clean.length === 3) {
        r = parseInt(clean[0] + clean[0], 16);
        g = parseInt(clean[1] + clean[1], 16);
        b = parseInt(clean[2] + clean[2], 16);
    }
    else if (clean.length === 4) {
        r = parseInt(clean[0] + clean[0], 16);
        g = parseInt(clean[1] + clean[1], 16);
        b = parseInt(clean[2] + clean[2], 16);
        a = parseInt(clean[3] + clean[3], 16);
    }
    else if (clean.length === 6) {
        r = parseInt(clean.substring(0, 2), 16);
        g = parseInt(clean.substring(2, 4), 16);
        b = parseInt(clean.substring(4, 6), 16);
    }
    else if (clean.length === 8) {
        r = parseInt(clean.substring(0, 2), 16);
        g = parseInt(clean.substring(2, 4), 16);
        b = parseInt(clean.substring(4, 6), 16);
        a = parseInt(clean.substring(6, 8), 16);
    }
    else {
        throw new Error(`Invalid hex color string: "${hex}"`);
    }
    if (isNaN(r) || isNaN(g) || isNaN(b) || isNaN(a)) {
        throw new Error(`Failed to parse hex color: "${hex}"`);
    }
    return packRgba(r, g, b, a);
}
export function rgbaToHex(color) {
    const { r, g, b, a } = unpackRgba(color);
    const toHex = (n) => n.toString(16).padStart(2, "0").toUpperCase();
    return `#${toHex(r)}${toHex(g)}${toHex(b)}${toHex(a)}`;
}
export class MockAsepriteEngine {
    sessionId = randomUUID();
    hasActiveSprite = true;
    filename = "untitled.aseprite";
    width = 32;
    height = 32;
    colorMode = "rgb";
    layers = [];
    frames = [];
    cels = new Map(); // key: `${layerIndex}:${frameNumber}`
    activeLayerIndex = 0;
    activeFrameNumber = 1;
    revision = 1;
    undoStack = [];
    redoStack = [];
    changeJournal = [];
    palette = new Uint32Array(256);
    tags = [];
    slices = [];
    selectionPixels = new Set();
    tilesets = [];
    tilemaps = new Map();
    mockExistingFiles = new Set();
    constructor(width = 32, height = 32) {
        this.reset(width, height);
    }
    reset(width = 32, height = 32) {
        this.mockExistingFiles = new Set();
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
        this.slices = [];
        this.selectionPixels = new Set();
        this.tilesets = [];
        this.tilemaps = new Map();
        this.cels = new Map();
        const initialCel = {
            layerIndex: 0,
            frameNumber: 1,
            bounds: { x: 0, y: 0, width, height },
            pixels: new Uint32Array(width * height), // all transparent 0x00000000
            opacity: 255,
            imageId: randomUUID(),
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
    getOrCreateCel(layerIndex, frameNumber) {
        const key = `${layerIndex}:${frameNumber}`;
        let cel = this.cels.get(key);
        if (!cel) {
            cel = {
                layerIndex,
                frameNumber,
                bounds: { x: 0, y: 0, width: this.width, height: this.height },
                pixels: new Uint32Array(this.width * this.height),
                opacity: 255,
                imageId: randomUUID(),
            };
            this.cels.set(key, cel);
        }
        return cel;
    }
    getCelPixel(cel, canvasX, canvasY) {
        const relX = canvasX - cel.bounds.x;
        const relY = canvasY - cel.bounds.y;
        if (relX < 0 || relX >= cel.bounds.width || relY < 0 || relY >= cel.bounds.height) {
            return 0; // outside cel is transparent
        }
        return cel.pixels[relY * cel.bounds.width + relX];
    }
    setCelPixel(cel, canvasX, canvasY, color) {
        const relX = canvasX - cel.bounds.x;
        const relY = canvasY - cel.bounds.y;
        if (relX >= 0 && relX < cel.bounds.width && relY >= 0 && relY < cel.bounds.height) {
            cel.pixels[relY * cel.bounds.width + relX] = color;
        }
    }
    getLayerPixel(layer, frameNumber, canvasX, canvasY) {
        if (layer.isTilemap) {
            const map = this.tilemaps.get(`${layer.index}:${frameNumber}`);
            const tileset = layer.tilesetIndex === undefined ? undefined : this.tilesets[layer.tilesetIndex];
            if (!map || !tileset)
                return { color: 0, celOpacity: 255 };
            const relativeX = canvasX - map.origin.x;
            const relativeY = canvasY - map.origin.y;
            if (relativeX < 0 || relativeY < 0)
                return { color: 0, celOpacity: 255 };
            const cellX = Math.floor(relativeX / tileset.tileWidth);
            const cellY = Math.floor(relativeY / tileset.tileHeight);
            if (cellX >= map.width || cellY >= map.height)
                return { color: 0, celOpacity: 255 };
            const reference = unpackTileReference(map.values[cellY * map.width + cellX]);
            const tile = tileset.tiles[reference.tileIndex];
            if (!tile)
                return { color: 0, celOpacity: 255 };
            let x = relativeX % tileset.tileWidth;
            let y = relativeY % tileset.tileHeight;
            if (reference.diagonalFlip)
                [x, y] = [y, x];
            if (reference.xFlip)
                x = tileset.tileWidth - 1 - x;
            if (reference.yFlip)
                y = tileset.tileHeight - 1 - y;
            if (x < 0 || y < 0 || x >= tileset.tileWidth || y >= tileset.tileHeight)
                return { color: 0, celOpacity: 255 };
            return { color: tile.pixels[y * tileset.tileWidth + x] ?? 0, celOpacity: 255 };
        }
        const cel = this.cels.get(`${layer.index}:${frameNumber}`);
        return { color: cel ? this.getCelPixel(cel, canvasX, canvasY) : 0, celOpacity: cel?.opacity ?? 255 };
    }
    getCompositeBuffer(frameNumber = this.activeFrameNumber) {
        const composite = new Uint32Array(this.width * this.height);
        for (const layer of this.layers) {
            if (!layer.isVisible || layer.isGroup)
                continue;
            for (let y = 0; y < this.height; y++) {
                for (let x = 0; x < this.width; x++) {
                    const layerPixel = this.getLayerPixel(layer, frameNumber, x, y);
                    const srcColor = layerPixel.color;
                    if (srcColor === 0)
                        continue;
                    const src = unpackRgba(srcColor);
                    const effectiveSrcAlpha = src.a * (layer.opacity / 255) * (layerPixel.celOpacity / 255);
                    if (effectiveSrcAlpha === 0)
                        continue;
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
    exportFramePngBase64(frameNumber = this.activeFrameNumber, targetLayer) {
        let buffer;
        if (targetLayer) {
            buffer = new Uint32Array(this.width * this.height);
            for (let y = 0; y < this.height; y++) {
                for (let x = 0; x < this.width; x++) {
                    const layerPixel = this.getLayerPixel(targetLayer, frameNumber, x, y);
                    if (layerPixel.color === 0)
                        continue;
                    const src = unpackRgba(layerPixel.color);
                    const effectiveSrcAlpha = Math.round(src.a * (targetLayer.opacity / 255) * (layerPixel.celOpacity / 255));
                    buffer[y * this.width + x] = packRgba(src.r, src.g, src.b, effectiveSrcAlpha);
                }
            }
        }
        else {
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
    resolveTargetLayer(params, forWriting = false) {
        let byIndex;
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
        let byName;
        if (params.layerName !== undefined) {
            const matched = this.layers.filter((l) => l.name === params.layerName);
            if (matched.length === 0) {
                throw new Error(`Layer '${params.layerName}' not found.`);
            }
            else if (matched.length > 1) {
                throw new Error(`Ambiguous layerName '${params.layerName}': found multiple matching layers.`);
            }
            byName = matched[0];
        }
        let targetLayer;
        if (byIndex !== undefined && byName !== undefined) {
            if (byIndex !== byName) {
                throw new Error("Conflicting layer selectors: layerIndex and layerName refer to different layers.");
            }
            targetLayer = byIndex;
        }
        else if (byIndex !== undefined) {
            targetLayer = byIndex;
        }
        else if (byName !== undefined) {
            targetLayer = byName;
        }
        else {
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
    resolveTargetFrame(rawFrame) {
        if (rawFrame !== undefined) {
            if (typeof rawFrame !== "number" || !Number.isInteger(rawFrame) || rawFrame < 1 || rawFrame > this.frames.length) {
                throw new Error(`Invalid frame: ${rawFrame}`);
            }
            const f = this.frames.find((fr) => fr.frameNumber === rawFrame);
            if (!f)
                throw new Error(`Invalid frame: ${rawFrame}`);
            return f;
        }
        const current = this.frames.find((fr) => fr.frameNumber === this.activeFrameNumber);
        return current ?? this.frames[0];
    }
    resolveAnyLayer(params, nameKey = "layerName", indexKey = "layerIndex") {
        const byName = params[nameKey] === undefined
            ? undefined
            : this.layers.filter((layer) => layer.name === params[nameKey]);
        if (byName && byName.length === 0)
            throw new Error(`Layer '${params[nameKey]}' not found.`);
        if (byName && byName.length > 1)
            throw new Error(`Ambiguous layer name '${params[nameKey]}'.`);
        const index = params[indexKey];
        const byIndex = index === undefined ? undefined : this.layers[index];
        if (index !== undefined && (!Number.isInteger(index) || index < 0 || !byIndex)) {
            throw new Error(`Invalid ${indexKey}: ${index}`);
        }
        if (byName?.[0] && byIndex && byName[0] !== byIndex)
            throw new Error("Conflicting layer selectors.");
        const layer = byName?.[0] ?? byIndex ?? this.layers.find((item) => item.index === this.activeLayerIndex) ?? this.layers[0];
        if (!layer)
            throw new Error("No target layer available.");
        return layer;
    }
    recordChange(entry) {
        this.changeJournal.push(entry);
        if (this.changeJournal.length > MAX_CHANGE_JOURNAL_ENTRIES)
            this.changeJournal.shift();
    }
    finishMutation(params, result, bounds, scope, frameNumber = this.activeFrameNumber, fullRefreshRequired = false) {
        this.revision++;
        this.recordChange({
            revision: this.revision,
            pixelsChanged: 0,
            bounds: { ...bounds },
            scope,
            fullRefreshRequired,
            reason: "mcp_mutation",
        });
        return {
            success: true,
            ...result,
            bounds: { ...bounds },
            revision: this.revision,
            ...(params.returnPreview ? { pngBase64: this.exportFramePngBase64(frameNumber) } : {}),
        };
    }
    selectionBounds() {
        if (this.selectionPixels.size === 0)
            return null;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const index of this.selectionPixels) {
            const x = index % this.width;
            const y = Math.floor(index / this.width);
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
        return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
    }
    getStatus() {
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
    executeCommand(command, params) {
        switch (command) {
            case "aseprite_status":
                return this.getStatus();
            case "get_sprite_info":
                if (!this.hasActiveSprite)
                    throw new Error("No active sprite open in Aseprite.");
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
                if (!this.hasActiveSprite)
                    throw new Error("No active sprite open in Aseprite.");
                const targetFrame = this.resolveTargetFrame(params.frameIndex ?? params.frameNumber);
                const frameNum = targetFrame.frameNumber;
                let targetLayer;
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
                if (!this.hasActiveSprite)
                    throw new Error("No active sprite open in Aseprite.");
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
                const grid = [];
                const paletteList = [];
                const paletteMap = new Map();
                for (let y = ry; y < ry + rh; y++) {
                    const row = [];
                    for (let x = rx; x < rx + rw; x++) {
                        const colorInt = cel ? this.getCelPixel(cel, x, y) : 0;
                        if (format === "hex") {
                            row.push(rgbaToHex(colorInt));
                        }
                        else if (format === "rgba") {
                            row.push(unpackRgba(colorInt));
                        }
                        else if (format === "indexed") {
                            row.push(colorInt);
                        }
                        else if (format === "compact") {
                            const hex = rgbaToHex(colorInt);
                            if (!paletteMap.has(hex)) {
                                paletteList.push(hex);
                                paletteMap.set(hex, paletteList.length - 1);
                            }
                            row.push(paletteMap.get(hex));
                        }
                    }
                    grid.push(row);
                }
                const res = {
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
                if (format === "compact")
                    res.palette = paletteList;
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
                if (!this.hasActiveSprite)
                    throw new Error("No active sprite open in Aseprite.");
                const pixels = params.pixels;
                if (!pixels || pixels.length === 0)
                    throw new Error("No pixels provided.");
                if (pixels.length > MAX_PIXELS_BATCH) {
                    throw new Error(`Pixel batch size exceeds maximum allowed (${MAX_PIXELS_BATCH})`);
                }
                const targetLayer = this.resolveTargetLayer(params, true);
                const targetFrame = this.resolveTargetFrame(params.frameNumber);
                const layerIdx = targetLayer.index;
                const frameNum = targetFrame.frameNumber;
                const cel = this.getOrCreateCel(layerIdx, frameNum);
                const deltas = [];
                let minX = this.width, minY = this.height, maxX = 0, maxY = 0;
                let modifiedCount = 0;
                for (const p of pixels) {
                    if (p.x < 0 || p.x >= this.width || p.y < 0 || p.y >= this.height)
                        continue;
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
                        if (p.x < minX)
                            minX = p.x;
                        if (p.y < minY)
                            minY = p.y;
                        if (p.x > maxX)
                            maxX = p.x;
                        if (p.y > maxY)
                            maxY = p.y;
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
                const out = {
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
                const points = params.points ?? [];
                if (points.length > MAX_PIXELS_BATCH) {
                    throw new Error(`Points batch size exceeds maximum allowed (${MAX_PIXELS_BATCH})`);
                }
                return this.executeCommand("set_pixels", {
                    ...params,
                    pixels: points.map((pt) => ({ x: pt.x, y: pt.y, color: "#00000000" })),
                });
            }
            case "batch_animation_edits": {
                if (!this.hasActiveSprite)
                    throw new Error("No active sprite open in Aseprite.");
                if (!params || typeof params !== "object")
                    throw new Error("params must be an object.");
                const payloadBytes = Buffer.byteLength(JSON.stringify(params), "utf8");
                if (payloadBytes > MAX_ANIMATION_BATCH_PAYLOAD_BYTES) {
                    throw new Error("Payload exceeds maximum size of 4 MiB.");
                }
                const isDenseArray = (t) => {
                    if (!Array.isArray(t))
                        return false;
                    const keys = Object.keys(t);
                    if (keys.length !== t.length)
                        return false;
                    for (let i = 0; i < t.length; i++) {
                        if (t[i] === undefined)
                            return false;
                    }
                    return true;
                };
                const operations = params.operations;
                if (!isDenseArray(operations)) {
                    throw new Error("operations must be a dense array.");
                }
                if (operations.length < 1 || operations.length > MAX_ANIMATION_BATCH_OPERATIONS) {
                    throw new Error(`Operations count must be between 1 and ${MAX_ANIMATION_BATCH_OPERATIONS}.`);
                }
                const ALLOWED_OPS = new Set(["set_pixels", "erase_pixels", "set_cel_position", "set_cel_opacity", "set_frame_duration"]);
                let totalPixelsAndPoints = 0;
                const resolvedFramesSet = new Set();
                const resolvedFramesList = [];
                const plans = [];
                const layerOpFlags = new Map();
                for (let idx = 0; idx < operations.length; idx++) {
                    const op = operations[idx];
                    if (!op || typeof op !== "object") {
                        throw new Error(`Operation at index ${idx} must be an object.`);
                    }
                    const opName = op.op;
                    if (typeof opName !== "string" || !ALLOWED_OPS.has(opName)) {
                        throw new Error(`Disallowed or unsupported operation '${opName}' at index ${idx}.`);
                    }
                    if (opName === "set_pixels" || opName === "erase_pixels") {
                        const layer = this.resolveTargetLayer(op, true);
                        const frame = this.resolveTargetFrame(op.frameNumber);
                        const fn = frame.frameNumber;
                        if (!resolvedFramesSet.has(fn)) {
                            resolvedFramesSet.add(fn);
                            resolvedFramesList.push(fn);
                        }
                        let layerFlags = layerOpFlags.get(layer.index);
                        if (!layerFlags) {
                            layerFlags = new Map();
                            layerOpFlags.set(layer.index, layerFlags);
                        }
                        let flags = layerFlags.get(fn);
                        if (!flags) {
                            flags = { hasPixel: false, hasPosition: false };
                            layerFlags.set(fn, flags);
                        }
                        if (flags.hasPosition) {
                            throw new Error(`Cannot combine pixel edits and set_cel_position on the same cel at layer '${layer.name}', frame ${fn} (ambiguous semantics).`);
                        }
                        flags.hasPixel = true;
                        if (opName === "set_pixels") {
                            const pxList = op.pixels;
                            if (!isDenseArray(pxList) || pxList.length < 1 || pxList.length > MAX_PIXELS_BATCH) {
                                throw new Error(`set_pixels at index ${idx} requires dense pixels array between 1 and ${MAX_PIXELS_BATCH}.`);
                            }
                            totalPixelsAndPoints += pxList.length;
                            const validatedPixels = [];
                            for (let pIdx = 0; pIdx < pxList.length; pIdx++) {
                                const p = pxList[pIdx];
                                if (!p || typeof p.x !== "number" || typeof p.y !== "number" || !Number.isInteger(p.x) || !Number.isInteger(p.y)) {
                                    throw new Error(`Invalid pixel coordinates at op ${idx}, pixel ${pIdx}.`);
                                }
                                if (p.x < 0 || p.x >= this.width || p.y < 0 || p.y >= this.height) {
                                    throw new Error(`Pixel coordinate (${p.x}, ${p.y}) out of canvas bounds at op ${idx}.`);
                                }
                                if (typeof p.color !== "string") {
                                    throw new Error(`Pixel color must be a hex string at op ${idx}, pixel ${pIdx}.`);
                                }
                                const nativeColor = hexToRgba(p.color);
                                validatedPixels.push({ x: p.x, y: p.y, color: nativeColor });
                            }
                            plans.push({ op: "set_pixels", layer, frame, pixels: validatedPixels });
                        }
                        else {
                            const ptList = op.points;
                            if (!isDenseArray(ptList) || ptList.length < 1 || ptList.length > MAX_PIXELS_BATCH) {
                                throw new Error(`erase_pixels at index ${idx} requires dense points array between 1 and ${MAX_PIXELS_BATCH}.`);
                            }
                            totalPixelsAndPoints += ptList.length;
                            const validatedPoints = [];
                            for (let ptIdx = 0; ptIdx < ptList.length; ptIdx++) {
                                const pt = ptList[ptIdx];
                                if (!pt || typeof pt.x !== "number" || typeof pt.y !== "number" || !Number.isInteger(pt.x) || !Number.isInteger(pt.y)) {
                                    throw new Error(`Invalid point coordinates at op ${idx}, point ${ptIdx}.`);
                                }
                                if (pt.x < 0 || pt.x >= this.width || pt.y < 0 || pt.y >= this.height) {
                                    throw new Error(`Point coordinate (${pt.x}, ${pt.y}) out of canvas bounds at op ${idx}.`);
                                }
                                validatedPoints.push({ x: pt.x, y: pt.y, color: 0 });
                            }
                            plans.push({ op: "erase_pixels", layer, frame, points: validatedPoints });
                        }
                    }
                    else if (opName === "set_cel_position") {
                        const layer = this.resolveTargetLayer(op, true);
                        const frame = this.resolveTargetFrame(op.frameNumber);
                        const fn = frame.frameNumber;
                        if (!resolvedFramesSet.has(fn)) {
                            resolvedFramesSet.add(fn);
                            resolvedFramesList.push(fn);
                        }
                        let layerFlags = layerOpFlags.get(layer.index);
                        if (!layerFlags) {
                            layerFlags = new Map();
                            layerOpFlags.set(layer.index, layerFlags);
                        }
                        let flags = layerFlags.get(fn);
                        if (!flags) {
                            flags = { hasPixel: false, hasPosition: false };
                            layerFlags.set(fn, flags);
                        }
                        if (flags.hasPixel) {
                            throw new Error(`Cannot combine pixel edits and set_cel_position on the same cel at layer '${layer.name}', frame ${fn} (ambiguous semantics).`);
                        }
                        flags.hasPosition = true;
                        const celKey = `${layer.index}:${fn}`;
                        const cel = this.cels.get(celKey);
                        if (!cel) {
                            throw new Error("set_cel_position requires an existing cel at target layer and frame.");
                        }
                        if (typeof op.x !== "number" || typeof op.y !== "number" || !Number.isInteger(op.x) || !Number.isInteger(op.y)) {
                            throw new Error(`set_cel_position requires integer x and y at op ${idx}.`);
                        }
                        plans.push({ op: "set_cel_position", layer, frame, celKey, x: op.x, y: op.y });
                    }
                    else if (opName === "set_cel_opacity") {
                        const layer = this.resolveTargetLayer(op, true);
                        const frame = this.resolveTargetFrame(op.frameNumber);
                        const fn = frame.frameNumber;
                        if (!resolvedFramesSet.has(fn)) {
                            resolvedFramesSet.add(fn);
                            resolvedFramesList.push(fn);
                        }
                        const celKey = `${layer.index}:${fn}`;
                        const cel = this.cels.get(celKey);
                        if (!cel) {
                            throw new Error("set_cel_opacity requires an existing cel at target layer and frame.");
                        }
                        if (typeof op.opacity !== "number" || !Number.isInteger(op.opacity) || op.opacity < 0 || op.opacity > 255) {
                            throw new Error(`set_cel_opacity requires integer opacity 0..255 at op ${idx}.`);
                        }
                        plans.push({ op: "set_cel_opacity", layer, frame, celKey, opacity: op.opacity });
                    }
                    else if (opName === "set_frame_duration") {
                        if (typeof op.frameNumber !== "number" || !Number.isInteger(op.frameNumber) || op.frameNumber < 1 || op.frameNumber > this.frames.length) {
                            throw new Error(`Invalid frameNumber at op ${idx}.`);
                        }
                        if (typeof op.durationMs !== "number" || !Number.isInteger(op.durationMs) || op.durationMs < 1 || op.durationMs > 60000) {
                            throw new Error(`durationMs must be an integer between 1 and 60000 at op ${idx}.`);
                        }
                        const frame = this.frames.find((f) => f.frameNumber === op.frameNumber);
                        const fn = frame.frameNumber;
                        if (!resolvedFramesSet.has(fn)) {
                            resolvedFramesSet.add(fn);
                            resolvedFramesList.push(fn);
                        }
                        plans.push({ op: "set_frame_duration", frame, durationMs: op.durationMs });
                    }
                }
                if (totalPixelsAndPoints > MAX_PIXELS_BATCH) {
                    throw new Error(`Total pixels and points across batch operations exceeds ${MAX_PIXELS_BATCH} limit.`);
                }
                if (resolvedFramesList.length > MAX_ANIMATION_BATCH_FRAMES) {
                    throw new Error(`Total resolved frames exceeds limit of ${MAX_ANIMATION_BATCH_FRAMES} frames.`);
                }
                // Planning on clones (never recursive execution)
                const celsBefore = new Map();
                const workingCels = new Map();
                const workingPositionWasSet = new Map();
                const originalPixelMaps = new Map();
                const finalPixelMaps = new Map();
                const celOrder = [];
                const getWorkingCel = (layerIndex, frameNumber) => {
                    const key = `${layerIndex}:${frameNumber}`;
                    if (!workingCels.has(key)) {
                        celOrder.push(key);
                        workingPositionWasSet.set(key, false);
                        const existing = this.cels.get(key);
                        if (existing) {
                            celsBefore.set(key, {
                                ...existing,
                                bounds: { ...existing.bounds },
                                pixels: new Uint32Array(existing.pixels),
                            });
                            const working = {
                                ...existing,
                                layerIndex,
                                frameNumber,
                                bounds: { x: 0, y: 0, width: this.width, height: this.height },
                                pixels: new Uint32Array(this.width * this.height),
                                opacity: existing.opacity ?? 255,
                            };
                            for (let cy = 0; cy < existing.bounds.height; cy++) {
                                for (let cx = 0; cx < existing.bounds.width; cx++) {
                                    const gx = existing.bounds.x + cx;
                                    const gy = existing.bounds.y + cy;
                                    if (gx >= 0 && gx < this.width && gy >= 0 && gy < this.height) {
                                        working.pixels[gy * this.width + gx] = existing.pixels[cy * existing.bounds.width + cx];
                                    }
                                }
                            }
                            workingCels.set(key, working);
                        }
                        else {
                            celsBefore.set(key, null);
                            workingCels.set(key, {
                                layerIndex,
                                frameNumber,
                                bounds: { x: 0, y: 0, width: this.width, height: this.height },
                                pixels: new Uint32Array(this.width * this.height),
                                opacity: 255,
                                imageId: randomUUID(),
                            });
                        }
                        originalPixelMaps.set(key, new Map());
                        finalPixelMaps.set(key, new Map());
                    }
                    return { cel: workingCels.get(key), key };
                };
                const frameDurationsBefore = new Map();
                const workingDurations = new Map();
                const durationOrder = [];
                // Apply operations onto clones
                for (const plan of plans) {
                    if (plan.op === "set_pixels" || plan.op === "erase_pixels") {
                        const { cel, key } = getWorkingCel(plan.layer.index, plan.frame.frameNumber);
                        const origMap = originalPixelMaps.get(key);
                        const finalMap = finalPixelMaps.get(key);
                        const items = plan.op === "set_pixels" ? plan.pixels : plan.points;
                        for (const item of items) {
                            const pIdx = item.y * this.width + item.x;
                            if (!origMap.has(pIdx)) {
                                origMap.set(pIdx, cel.pixels[pIdx]);
                            }
                            cel.pixels[pIdx] = item.color;
                            finalMap.set(pIdx, item.color);
                        }
                    }
                    else if (plan.op === "set_cel_position") {
                        const { cel, key } = getWorkingCel(plan.layer.index, plan.frame.frameNumber);
                        cel.bounds.x = plan.x;
                        cel.bounds.y = plan.y;
                        workingPositionWasSet.set(key, true);
                    }
                    else if (plan.op === "set_cel_opacity") {
                        const { cel } = getWorkingCel(plan.layer.index, plan.frame.frameNumber);
                        cel.opacity = plan.opacity;
                    }
                    else if (plan.op === "set_frame_duration") {
                        const fn = plan.frame.frameNumber;
                        if (!frameDurationsBefore.has(fn)) {
                            frameDurationsBefore.set(fn, plan.frame.duration);
                            durationOrder.push(fn);
                        }
                        workingDurations.set(fn, plan.durationMs / 1000);
                    }
                }
                // Evaluate diff against initial state
                let minX = this.width, minY = this.height, maxX = -1, maxY = -1;
                const updateBounds = (x, y, w, h) => {
                    if (w !== undefined && h !== undefined) {
                        if (x < minX)
                            minX = x;
                        if (y < minY)
                            minY = y;
                        if (x + w - 1 > maxX)
                            maxX = x + w - 1;
                        if (y + h - 1 > maxY)
                            maxY = y + h - 1;
                    }
                    else {
                        if (x < minX)
                            minX = x;
                        if (y < minY)
                            minY = y;
                        if (x > maxX)
                            maxX = x;
                        if (y > maxY)
                            maxY = y;
                    }
                };
                let totalPixelsChanged = 0;
                const framesTouchedSet = new Set();
                let hasRealChange = false;
                const changedCels = new Map();
                for (const key of celOrder) {
                    const working = workingCels.get(key);
                    const before = celsBefore.get(key);
                    const origMap = originalPixelMaps.get(key);
                    const finalMap = finalPixelMaps.get(key);
                    const positionWasSet = workingPositionWasSet.get(key) === true;
                    let celPixelsChanged = 0;
                    for (const [pIdx, origColor] of origMap.entries()) {
                        const finalColor = finalMap.get(pIdx);
                        if (finalColor !== origColor) {
                            celPixelsChanged++;
                            const px = pIdx % this.width;
                            const py = Math.floor(pIdx / this.width);
                            updateBounds(px, py);
                        }
                    }
                    let celPositionChanged = false;
                    let celOpacityChanged = false;
                    if (before) {
                        if (positionWasSet && (working.bounds.x !== before.bounds.x || working.bounds.y !== before.bounds.y)) {
                            celPositionChanged = true;
                            updateBounds(before.bounds.x, before.bounds.y, before.bounds.width, before.bounds.height);
                            updateBounds(working.bounds.x, working.bounds.y, before.bounds.width, before.bounds.height);
                        }
                        if ((working.opacity ?? 255) !== (before.opacity ?? 255)) {
                            celOpacityChanged = true;
                            updateBounds(before.bounds.x, before.bounds.y, before.bounds.width, before.bounds.height);
                        }
                    }
                    if (celPixelsChanged > 0 || celPositionChanged || celOpacityChanged) {
                        hasRealChange = true;
                        totalPixelsChanged += celPixelsChanged;
                        framesTouchedSet.add(working.frameNumber);
                        if (celPixelsChanged > 0) {
                            changedCels.set(key, {
                                ...working,
                                bounds: { x: working.bounds.x, y: working.bounds.y, width: this.width, height: this.height },
                                pixels: new Uint32Array(working.pixels),
                            });
                        }
                        else if (before) {
                            const targetX = positionWasSet ? working.bounds.x : before.bounds.x;
                            const targetY = positionWasSet ? working.bounds.y : before.bounds.y;
                            changedCels.set(key, {
                                ...before,
                                bounds: { ...before.bounds, x: targetX, y: targetY },
                                opacity: working.opacity,
                                pixels: new Uint32Array(before.pixels),
                            });
                        }
                    }
                }
                const changedDurations = new Map();
                for (const fn of durationOrder) {
                    const beforeSec = frameDurationsBefore.get(fn);
                    const finalSec = workingDurations.get(fn);
                    if (Math.abs(beforeSec - finalSec) > 0.0001) {
                        hasRealChange = true;
                        framesTouchedSet.add(fn);
                        changedDurations.set(fn, finalSec);
                    }
                }
                const finalBounds = minX <= maxX && minY <= maxY
                    ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
                    : { x: 0, y: 0, width: 0, height: 0 };
                if (!hasRealChange) {
                    const noChangeRes = {
                        success: true,
                        changed: false,
                        operationsApplied: 0,
                        framesTouched: 0,
                        pixelsChanged: 0,
                        bounds: { x: 0, y: 0, width: 0, height: 0 },
                        revision: this.revision,
                    };
                    if (params.returnPreview) {
                        noChangeRes.pngBase64 = this.exportFramePngBase64(this.activeFrameNumber);
                    }
                    return noChangeRes;
                }
                // Apply mutations deterministically
                for (const [key, changedCel] of changedCels.entries()) {
                    this.cels.set(key, changedCel);
                }
                for (const [fn, finalSec] of changedDurations.entries()) {
                    const f = this.frames.find((fr) => fr.frameNumber === fn);
                    if (f)
                        f.duration = finalSec;
                }
                // Record single undo item
                const tx = {
                    id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                    name: "batch_animation_edits",
                    revisionBefore: this.revision,
                    revisionAfter: this.revision + 1,
                    pixelDeltas: [],
                    batchData: {
                        celsBefore: Array.from(celsBefore.entries()).map(([key, cel]) => ({
                            key,
                            cel: cel ? { ...cel, bounds: { ...cel.bounds }, pixels: new Uint32Array(cel.pixels) } : null,
                        })),
                        celsAfter: Array.from(celsBefore.keys()).map((key) => {
                            const after = this.cels.get(key);
                            return {
                                key,
                                cel: after ? { ...after, bounds: { ...after.bounds }, pixels: new Uint32Array(after.pixels) } : null,
                            };
                        }),
                        frameDurationsBefore: Array.from(frameDurationsBefore.entries()).map(([frameNumber, duration]) => ({ frameNumber, duration })),
                        frameDurationsAfter: Array.from(frameDurationsBefore.keys()).map((frameNumber) => {
                            const fr = this.frames.find((f) => f.frameNumber === frameNumber);
                            return { frameNumber, duration: fr?.duration ?? 0.1 };
                        }),
                    },
                };
                this.undoStack.push(tx);
                this.redoStack = [];
                const primaryFrameNumber = resolvedFramesList[0] ?? this.activeFrameNumber;
                const result = this.finishMutation(params, {
                    changed: true,
                    operationsApplied: operations.length,
                    framesTouched: framesTouchedSet.size,
                    pixelsChanged: totalPixelsChanged,
                }, finalBounds, "animation", primaryFrameNumber);
                // Adjust changeJournal entry for this revision to reflect totalPixelsChanged
                const journalEntry = this.changeJournal.find((e) => e.revision === this.revision);
                if (journalEntry) {
                    journalEntry.pixelsChanged = totalPixelsChanged;
                }
                return result;
            }
            case "undo": {
                if (!this.hasActiveSprite)
                    throw new Error("No active sprite.");
                if (this.undoStack.length === 0)
                    throw new Error("No undo transactions available.");
                const tx = this.undoStack.pop();
                if (tx.batchData) {
                    for (const item of tx.batchData.celsBefore) {
                        if (item.cel === null) {
                            this.cels.delete(item.key);
                        }
                        else {
                            this.cels.set(item.key, {
                                ...item.cel,
                                bounds: { ...item.cel.bounds },
                                pixels: new Uint32Array(item.cel.pixels),
                            });
                        }
                    }
                    for (const fd of tx.batchData.frameDurationsBefore) {
                        const f = this.frames.find((fr) => fr.frameNumber === fd.frameNumber);
                        if (f)
                            f.duration = fd.duration;
                    }
                }
                else {
                    for (let i = tx.pixelDeltas.length - 1; i >= 0; i--) {
                        const delta = tx.pixelDeltas[i];
                        const cel = this.getOrCreateCel(delta.layerIndex, delta.frameNumber);
                        this.setCelPixel(cel, delta.x, delta.y, delta.prevColor);
                    }
                }
                this.redoStack.push(tx);
                return this.finishMutation(params, {
                    restoredRevision: tx.revisionBefore,
                }, { x: 0, y: 0, width: this.width, height: this.height }, "undo", this.activeFrameNumber, true);
            }
            case "redo": {
                if (!this.hasActiveSprite)
                    throw new Error("No active sprite.");
                if (this.redoStack.length === 0)
                    throw new Error("No redo transactions available.");
                const tx = this.redoStack.pop();
                if (tx.batchData) {
                    for (const item of tx.batchData.celsAfter) {
                        if (item.cel === null) {
                            this.cels.delete(item.key);
                        }
                        else {
                            this.cels.set(item.key, {
                                ...item.cel,
                                bounds: { ...item.cel.bounds },
                                pixels: new Uint32Array(item.cel.pixels),
                            });
                        }
                    }
                    for (const fd of tx.batchData.frameDurationsAfter) {
                        const f = this.frames.find((fr) => fr.frameNumber === fd.frameNumber);
                        if (f)
                            f.duration = fd.duration;
                    }
                }
                else {
                    for (let i = 0; i < tx.pixelDeltas.length; i++) {
                        const delta = tx.pixelDeltas[i];
                        const cel = this.getOrCreateCel(delta.layerIndex, delta.frameNumber);
                        this.setCelPixel(cel, delta.x, delta.y, delta.newColor);
                    }
                }
                this.undoStack.push(tx);
                return this.finishMutation(params, {
                    replayedRevision: tx.revisionAfter,
                }, { x: 0, y: 0, width: this.width, height: this.height }, "redo", this.activeFrameNumber, true);
            }
            case "new_sprite": {
                const w = params.width ?? 32;
                const h = params.height ?? 32;
                this.reset(w, h);
                if (params.colorMode)
                    this.colorMode = params.colorMode;
                this.recordChange({ revision: this.revision, pixelsChanged: 0, bounds: { x: 0, y: 0, width: this.width, height: this.height }, scope: "sprite", fullRefreshRequired: true, reason: "new_sprite" });
                return {
                    success: true,
                    width: this.width,
                    height: this.height,
                    colorMode: this.colorMode,
                    revision: this.revision,
                    ...(params.returnPreview ? { pngBase64: this.exportFramePngBase64(1) } : {}),
                };
            }
            case "draw_line": {
                const { x1, y1, x2, y2, color, thickness = 1 } = params;
                const pixels = [];
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
                    if (x === x2 && y === y2)
                        break;
                    const e2 = 2 * err;
                    if (e2 > -dy) {
                        err -= dy;
                        x += sx;
                    }
                    if (e2 < dx) {
                        err += dx;
                        y += sy;
                    }
                }
                return this.executeCommand("set_pixels", { ...params, pixels });
            }
            case "draw_rectangle": {
                const { x, y, width, height, color, filled = false } = params;
                const pixels = [];
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
                const pixels = [];
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
                            if (dist <= 1.0)
                                pixels.push({ x: px, y: py, color });
                        }
                        else {
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
                const pixelsToPaint = [];
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
                }
                else {
                    const visited = new Uint8Array(this.width * this.height);
                    const queue = [[x, y]];
                    let head = 0;
                    visited[y * this.width + x] = 1;
                    while (head < queue.length) {
                        const [cx, cy] = queue[head++];
                        pixelsToPaint.push({ x: cx, y: cy, color });
                        if (pixelsToPaint.length > MAX_PIXELS_BATCH) {
                            throw new Error(`Flood fill candidate count exceeds MAX_PIXELS_BATCH (${MAX_PIXELS_BATCH})`);
                        }
                        const neighbors = [
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
                const pixelsToPaint = [];
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
                const refreshRequired = (reason) => ({
                    changed: true,
                    sinceRevision: since,
                    currentRevision: this.revision,
                    sessionId: this.sessionId,
                    resyncRequired: true,
                    gap: true,
                    fullRefreshRequired: true,
                    reason,
                });
                if (params.sessionId !== undefined && params.sessionId !== this.sessionId) {
                    return refreshRequired("session_changed");
                }
                if (typeof since !== "number" || !Number.isInteger(since) || since < 0) {
                    return refreshRequired("invalid_revision");
                }
                if (since === this.revision) {
                    return {
                        changed: false,
                        sinceRevision: since,
                        currentRevision: this.revision,
                        sessionId: this.sessionId,
                        resyncRequired: false,
                        gap: false,
                        pixelsChanged: 0,
                        bounds: null,
                        changes: [],
                    };
                }
                if (since > this.revision || (this.revision - since) > MAX_CHANGE_JOURNAL_ENTRIES) {
                    return refreshRequired("revision_out_of_range");
                }
                const journalMap = new Map();
                for (const entry of this.changeJournal) {
                    journalMap.set(entry.revision, entry);
                }
                let totalPixels = 0;
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                let fullRefreshRequired = false;
                const changes = [];
                for (let r = since + 1; r <= this.revision; r++) {
                    const entry = journalMap.get(r);
                    if (!entry) {
                        return refreshRequired("journal_gap");
                    }
                    changes.push(entry);
                    totalPixels += entry.pixelsChanged;
                    fullRefreshRequired ||= entry.fullRefreshRequired === true;
                    if (entry.bounds && entry.bounds.width > 0 && entry.bounds.height > 0) {
                        minX = Math.min(minX, entry.bounds.x);
                        minY = Math.min(minY, entry.bounds.y);
                        maxX = Math.max(maxX, entry.bounds.x + entry.bounds.width - 1);
                        maxY = Math.max(maxY, entry.bounds.y + entry.bounds.height - 1);
                    }
                }
                return {
                    changed: true,
                    sinceRevision: since,
                    currentRevision: this.revision,
                    sessionId: this.sessionId,
                    resyncRequired: false,
                    gap: false,
                    fullRefreshRequired,
                    pixelsChanged: totalPixels,
                    bounds: Number.isFinite(minX) ? {
                        x: minX,
                        y: minY,
                        width: maxX - minX + 1,
                        height: maxY - minY + 1,
                    } : null,
                    changes,
                };
            }
            // Palette tools
            case "get_palette": {
                const colors = [];
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
                if (idx < 0 || idx >= this.palette.length)
                    throw new Error("Index out of palette bounds.");
                this.palette[idx] = hexToRgba(params.color);
                return this.finishMutation(params, { index: idx, color: params.color }, { x: 0, y: 0, width: this.width, height: this.height }, "palette", this.activeFrameNumber, true);
            }
            case "find_palette_color": {
                const target = unpackRgba(hexToRgba(params.color));
                const findNearest = params.findNearest !== false;
                let bestIdx = 0;
                let minDiff = Infinity;
                for (let i = 0; i < this.palette.length; i++) {
                    const c = unpackRgba(this.palette[i]);
                    const diff = Math.sqrt(Math.pow(c.r - target.r, 2) +
                        Math.pow(c.g - target.g, 2) +
                        Math.pow(c.b - target.b, 2) +
                        Math.pow(c.a - target.a, 2));
                    if (diff < minDiff) {
                        minDiff = diff;
                        bestIdx = i;
                    }
                    if (diff === 0)
                        break;
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
                let parentIndex = null;
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
                const newLayer = {
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
                return this.finishMutation(params, { name: newLayer.name, layer: newLayer }, { x: 0, y: 0, width: this.width, height: this.height }, "layers", this.activeFrameNumber, true);
            }
            case "load_reference_image":
                return {
                    success: true,
                    width: this.width,
                    height: this.height,
                    colorMode: this.colorMode,
                    pngBase64: this.exportFramePngBase64(),
                };
            case "rename_layer": {
                const layer = this.layers.find((l) => l.name === params.oldName);
                if (!layer)
                    throw new Error(`Layer '${params.oldName}' not found.`);
                layer.name = params.newName;
                return this.finishMutation(params, { oldName: params.oldName, newName: params.newName }, { x: 0, y: 0, width: this.width, height: this.height }, "layers", this.activeFrameNumber, true);
            }
            case "delete_layer": {
                const idx = this.layers.findIndex((l) => l.name === params.name);
                if (idx === -1)
                    throw new Error(`Layer '${params.name}' not found.`);
                this.layers.splice(idx, 1);
                return this.finishMutation(params, { deletedLayer: params.name }, { x: 0, y: 0, width: this.width, height: this.height }, "layers", this.activeFrameNumber, true);
            }
            case "select_layer": {
                const layer = this.layers.find((l) => l.name === params.name);
                if (!layer)
                    throw new Error(`Layer '${params.name}' not found.`);
                this.activeLayerIndex = layer.index;
                return { success: true, activeLayer: layer.name };
            }
            case "set_layer_visibility": {
                const layer = this.layers.find((l) => l.name === params.name);
                if (!layer)
                    throw new Error(`Layer '${params.name}' not found.`);
                layer.isVisible = params.visible;
                return this.finishMutation(params, { name: layer.name, visible: layer.isVisible }, { x: 0, y: 0, width: this.width, height: this.height }, "layers", this.activeFrameNumber, true);
            }
            case "set_layer_opacity": {
                const layer = this.layers.find((l) => l.name === params.name);
                if (!layer)
                    throw new Error(`Layer '${params.name}' not found.`);
                layer.opacity = params.opacity;
                return this.finishMutation(params, { name: layer.name, opacity: layer.opacity }, { x: 0, y: 0, width: this.width, height: this.height }, "layers", this.activeFrameNumber, true);
            }
            case "move_layer": {
                const idx = this.layers.findIndex((l) => l.name === params.name);
                if (idx === -1)
                    throw new Error(`Layer '${params.name}' not found.`);
                const [layer] = this.layers.splice(idx, 1);
                this.layers.splice(params.targetIndex, 0, layer);
                return this.finishMutation(params, { moved: layer.name, targetIndex: params.targetIndex }, { x: 0, y: 0, width: this.width, height: this.height }, "layers", this.activeFrameNumber, true);
            }
            case "create_group": {
                let parentIndex = null;
                if (params.parentGroup) {
                    const parent = this.resolveAnyLayer({ layerName: params.parentGroup });
                    if (!parent.isGroup)
                        throw new Error("parentGroup must name a group layer.");
                    parentIndex = parent.index;
                }
                const group = {
                    index: this.layers.length,
                    name: params.name,
                    isVisible: true,
                    isEditable: true,
                    isLocked: false,
                    opacity: 255,
                    blendMode: "normal",
                    isGroup: true,
                    isBackground: false,
                    parentIndex,
                };
                this.layers.push(group);
                return this.finishMutation(params, { group, parentGroup: params.parentGroup ?? null }, { x: 0, y: 0, width: this.width, height: this.height }, "layers", this.activeFrameNumber, true);
            }
            // Explicit cel tools
            case "get_cel": {
                const layer = this.resolveTargetLayer(params, false);
                const frame = this.resolveTargetFrame(params.frameNumber);
                const cel = this.cels.get(`${layer.index}:${frame.frameNumber}`);
                if (!cel)
                    return { success: true, hasCel: false, layer: layer.name, frameNumber: frame.frameNumber, revision: this.revision };
                const linkedFrames = [...this.cels.values()]
                    .filter((other) => other !== cel && other.layerIndex === cel.layerIndex && other.imageId === cel.imageId)
                    .map((other) => other.frameNumber)
                    .sort((a, b) => a - b);
                const linkedCels = [...this.cels.values()]
                    .filter((other) => other !== cel && other.imageId === cel.imageId)
                    .map((other) => ({
                    layer: this.layers.find((candidate) => candidate.index === other.layerIndex)?.name ?? "",
                    frameNumber: other.frameNumber,
                }))
                    .sort((left, right) => left.layer.localeCompare(right.layer) || left.frameNumber - right.frameNumber);
                return {
                    success: true,
                    hasCel: true,
                    layer: layer.name,
                    frameNumber: frame.frameNumber,
                    cel: {
                        bounds: { ...cel.bounds },
                        position: { x: cel.bounds.x, y: cel.bounds.y },
                        opacity: cel.opacity ?? 255,
                        zIndex: 0,
                        isLinked: linkedCels.length > 0,
                        linkedFrames,
                        linkedCels,
                    },
                    revision: this.revision,
                };
            }
            case "create_cel": {
                const layer = this.resolveTargetLayer(params, true);
                const frame = this.resolveTargetFrame(params.frameNumber);
                const key = `${layer.index}:${frame.frameNumber}`;
                if (this.cels.has(key))
                    throw new Error("Cel already exists at target layer and frame.");
                const width = params.width ?? this.width;
                const height = params.height ?? this.height;
                const color = hexToRgba(params.color ?? "#00000000");
                const pixels = new Uint32Array(width * height);
                pixels.fill(color);
                const cel = {
                    layerIndex: layer.index,
                    frameNumber: frame.frameNumber,
                    bounds: { x: params.x ?? 0, y: params.y ?? 0, width, height },
                    pixels,
                    opacity: 255,
                    imageId: randomUUID(),
                };
                this.cels.set(key, cel);
                return this.finishMutation(params, {
                    layer: layer.name,
                    frameNumber: frame.frameNumber,
                    position: { x: cel.bounds.x, y: cel.bounds.y },
                }, cel.bounds, "cel", frame.frameNumber);
            }
            case "delete_cel": {
                if (params.confirm !== true)
                    throw new Error("delete_cel requires confirm: true");
                const layer = this.resolveTargetLayer(params, true);
                const frame = this.resolveTargetFrame(params.frameNumber);
                const key = `${layer.index}:${frame.frameNumber}`;
                const cel = this.cels.get(key);
                if (!cel)
                    throw new Error("Cel not found at target layer and frame.");
                this.cels.delete(key);
                return this.finishMutation(params, { layer: layer.name, frameNumber: frame.frameNumber }, cel.bounds, "cel", frame.frameNumber);
            }
            case "set_cel_position": {
                const layer = this.resolveTargetLayer(params, true);
                const frame = this.resolveTargetFrame(params.frameNumber);
                const cel = this.cels.get(`${layer.index}:${frame.frameNumber}`);
                if (!cel)
                    throw new Error("Cel not found at target layer and frame.");
                const hasAbsolute = params.x !== undefined || params.y !== undefined;
                const hasRelative = params.dx !== undefined || params.dy !== undefined;
                if (hasAbsolute === hasRelative)
                    throw new Error("Provide either x/y or dx/dy, but not both.");
                const old = { ...cel.bounds };
                const x = hasAbsolute ? (params.x ?? cel.bounds.x) : cel.bounds.x + (params.dx ?? 0);
                const y = hasAbsolute ? (params.y ?? cel.bounds.y) : cel.bounds.y + (params.dy ?? 0);
                if (x === old.x && y === old.y) {
                    return { success: true, changed: false, position: { x, y }, bounds: old, revision: this.revision };
                }
                cel.bounds.x = x;
                cel.bounds.y = y;
                const minX = Math.min(old.x, x), minY = Math.min(old.y, y);
                const maxX = Math.max(old.x + old.width, x + cel.bounds.width);
                const maxY = Math.max(old.y + old.height, y + cel.bounds.height);
                return this.finishMutation(params, {
                    changed: true, layer: layer.name, frameNumber: frame.frameNumber, position: { x, y },
                }, { x: minX, y: minY, width: maxX - minX, height: maxY - minY }, "cel", frame.frameNumber);
            }
            case "set_cel_opacity": {
                const layer = this.resolveTargetLayer(params, true);
                const frame = this.resolveTargetFrame(params.frameNumber);
                const cel = this.cels.get(`${layer.index}:${frame.frameNumber}`);
                if (!cel)
                    throw new Error("Cel not found at target layer and frame.");
                if ((cel.opacity ?? 255) === params.opacity) {
                    return { success: true, changed: false, opacity: params.opacity, bounds: { ...cel.bounds }, revision: this.revision };
                }
                cel.opacity = params.opacity;
                return this.finishMutation(params, {
                    changed: true, layer: layer.name, frameNumber: frame.frameNumber, opacity: params.opacity,
                }, cel.bounds, "cel", frame.frameNumber);
            }
            case "link_cel": {
                const sourceLayer = this.resolveAnyLayer(params, "sourceLayerName", "sourceLayerIndex");
                const targetLayer = this.resolveAnyLayer(params, "targetLayerName", "targetLayerIndex");
                if (sourceLayer.isGroup || targetLayer.isGroup)
                    throw new Error("Source and target must be image layers.");
                const sourceFrame = this.resolveTargetFrame(params.sourceFrame);
                const targetFrame = this.resolveTargetFrame(params.targetFrame);
                if (sourceLayer.index === targetLayer.index && sourceFrame.frameNumber === targetFrame.frameNumber) {
                    throw new Error("Source and target cel must be different.");
                }
                if (sourceLayer.index !== targetLayer.index) {
                    throw new Error("Linked cels must belong to the same image layer.");
                }
                const source = this.cels.get(`${sourceLayer.index}:${sourceFrame.frameNumber}`);
                if (!source)
                    throw new Error("Source cel not found.");
                const targetKey = `${targetLayer.index}:${targetFrame.frameNumber}`;
                if (this.cels.has(targetKey) && params.replaceExisting !== true) {
                    throw new Error("Target cel already exists; set replaceExisting: true to replace it.");
                }
                const linked = {
                    layerIndex: targetLayer.index,
                    frameNumber: targetFrame.frameNumber,
                    bounds: { ...source.bounds },
                    pixels: source.pixels,
                    opacity: source.opacity ?? 255,
                    imageId: source.imageId,
                };
                this.cels.set(targetKey, linked);
                return this.finishMutation(params, {
                    sourceLayer: sourceLayer.name, sourceFrame: sourceFrame.frameNumber,
                    targetLayer: targetLayer.name, targetFrame: targetFrame.frameNumber, linked: true,
                }, linked.bounds, "cel", targetFrame.frameNumber);
            }
            case "unlink_cel": {
                const layer = this.resolveTargetLayer(params, true);
                const frame = this.resolveTargetFrame(params.frameNumber);
                const cel = this.cels.get(`${layer.index}:${frame.frameNumber}`);
                if (!cel)
                    throw new Error("Cel not found at target layer and frame.");
                const isLinked = [...this.cels.values()].some((other) => other !== cel && other.imageId === cel.imageId);
                if (!isLinked)
                    return { success: true, changed: false, linked: false, bounds: { ...cel.bounds }, revision: this.revision };
                cel.pixels = new Uint32Array(cel.pixels);
                cel.imageId = randomUUID();
                return this.finishMutation(params, {
                    changed: true, layer: layer.name, frameNumber: frame.frameNumber, linked: false,
                }, cel.bounds, "cel", frame.frameNumber);
            }
            case "copy_cel": {
                const sourceLayer = this.resolveAnyLayer(params, "sourceLayerName", "sourceLayerIndex");
                const targetLayer = this.resolveAnyLayer(params, "targetLayerName", "targetLayerIndex");
                if (sourceLayer.isGroup || targetLayer.isGroup)
                    throw new Error("Source and target must be image layers.");
                const sourceFrame = this.resolveTargetFrame(params.sourceFrame);
                const targetFrame = this.resolveTargetFrame(params.targetFrame);
                if (sourceLayer.index === targetLayer.index && sourceFrame.frameNumber === targetFrame.frameNumber) {
                    throw new Error("Source and target cel must be different.");
                }
                const source = this.cels.get(`${sourceLayer.index}:${sourceFrame.frameNumber}`);
                if (!source)
                    throw new Error("Source cel not found.");
                const targetKey = `${targetLayer.index}:${targetFrame.frameNumber}`;
                if (this.cels.has(targetKey) && params.replaceExisting !== true) {
                    throw new Error("Target cel already exists; set replaceExisting: true to replace it.");
                }
                const copied = {
                    layerIndex: targetLayer.index,
                    frameNumber: targetFrame.frameNumber,
                    bounds: { ...source.bounds },
                    pixels: new Uint32Array(source.pixels),
                    opacity: source.opacity ?? 255,
                    imageId: randomUUID(),
                    zIndex: source.zIndex,
                    color: source.color,
                    data: source.data,
                };
                this.cels.set(targetKey, copied);
                return this.finishMutation(params, {
                    sourceLayer: sourceLayer.name,
                    sourceFrame: sourceFrame.frameNumber,
                    targetLayer: targetLayer.name,
                    targetFrame: targetFrame.frameNumber,
                    copied: true,
                }, copied.bounds, "cel", targetFrame.frameNumber);
            }
            case "move_cel": {
                const sourceLayer = this.resolveAnyLayer(params, "sourceLayerName", "sourceLayerIndex");
                const targetLayer = this.resolveAnyLayer(params, "targetLayerName", "targetLayerIndex");
                if (sourceLayer.isGroup || targetLayer.isGroup)
                    throw new Error("Source and target must be image layers.");
                if (sourceLayer.index !== targetLayer.index) {
                    throw new Error("Cross-layer move is not supported.");
                }
                const sourceFrame = this.resolveTargetFrame(params.sourceFrame);
                const targetFrame = this.resolveTargetFrame(params.targetFrame);
                if (sourceLayer.index === targetLayer.index && sourceFrame.frameNumber === targetFrame.frameNumber) {
                    throw new Error("Source and target cel must be different.");
                }
                const sourceKey = `${sourceLayer.index}:${sourceFrame.frameNumber}`;
                const source = this.cels.get(sourceKey);
                if (!source)
                    throw new Error("Source cel not found.");
                const targetKey = `${targetLayer.index}:${targetFrame.frameNumber}`;
                if (this.cels.has(targetKey) && params.replaceExisting !== true) {
                    throw new Error("Target cel already exists; set replaceExisting: true to replace it.");
                }
                if (this.cels.has(targetKey)) {
                    this.cels.delete(targetKey);
                }
                this.cels.delete(sourceKey);
                source.layerIndex = targetLayer.index;
                source.frameNumber = targetFrame.frameNumber;
                this.cels.set(targetKey, source);
                return this.finishMutation(params, {
                    sourceLayer: sourceLayer.name,
                    sourceFrame: sourceFrame.frameNumber,
                    targetLayer: targetLayer.name,
                    targetFrame: targetFrame.frameNumber,
                    moved: true,
                }, source.bounds, "cel", targetFrame.frameNumber);
            }
            case "list_layer_tree": {
                const visit = (parentIndex) => this.layers
                    .filter((layer) => layer.parentIndex === parentIndex)
                    .map((layer) => ({
                    ...layer,
                    uuid: `mock-layer-${layer.index}`,
                    stackIndex: this.layers.filter((item) => item.parentIndex === parentIndex).indexOf(layer) + 1,
                    ...(layer.isGroup ? { children: visit(layer.index) } : {}),
                }));
                return { success: true, layers: visit(null), revision: this.revision };
            }
            case "move_layer_to_group": {
                const layer = this.resolveAnyLayer({ layerName: params.name });
                let parentIndex = null;
                if (params.parentGroup !== undefined) {
                    const parent = this.resolveAnyLayer({ layerName: params.parentGroup });
                    if (!parent.isGroup)
                        throw new Error("Target parent is not a group.");
                    let cursor = parent;
                    while (cursor) {
                        if (cursor === layer)
                            throw new Error("Cannot move a group into itself or one of its descendants.");
                        cursor = cursor.parentIndex === null ? undefined : this.layers.find((item) => item.index === cursor.parentIndex);
                    }
                    parentIndex = parent.index;
                }
                if (layer.parentIndex === parentIndex && params.targetIndex === undefined) {
                    return { success: true, changed: false, name: layer.name, parentGroup: params.parentGroup ?? null, bounds: { x: 0, y: 0, width: this.width, height: this.height }, revision: this.revision };
                }
                layer.parentIndex = parentIndex;
                if (params.targetIndex !== undefined) {
                    const currentIndex = this.layers.indexOf(layer);
                    this.layers.splice(currentIndex, 1);
                    const siblings = this.layers.filter((item) => item.parentIndex === parentIndex);
                    const before = siblings[Math.min(params.targetIndex - 1, siblings.length)];
                    const insertAt = before ? this.layers.indexOf(before) : this.layers.length;
                    this.layers.splice(insertAt, 0, layer);
                }
                return this.finishMutation(params, {
                    changed: true, name: layer.name, parentGroup: params.parentGroup ?? null,
                }, { x: 0, y: 0, width: this.width, height: this.height }, "layers", this.activeFrameNumber, true);
            }
            case "ungroup_layer": {
                const group = this.resolveAnyLayer({ layerName: params.name });
                if (!group.isGroup)
                    throw new Error(`Layer is not a group: ${params.name}`);
                const children = this.layers.filter((layer) => layer.parentIndex === group.index);
                for (const child of children)
                    child.parentIndex = group.parentIndex;
                this.layers.splice(this.layers.indexOf(group), 1);
                if (this.activeLayerIndex === group.index)
                    this.activeLayerIndex = children[0]?.index ?? this.layers[0]?.index ?? 0;
                return this.finishMutation(params, {
                    group: group.name, children: children.map((child) => child.name),
                }, { x: 0, y: 0, width: this.width, height: this.height }, "layers", this.activeFrameNumber, true);
            }
            case "set_layer_blend_mode": {
                const layer = this.resolveTargetLayer(params, true);
                if (layer.blendMode === params.blendMode) {
                    return { success: true, changed: false, name: layer.name, blendMode: layer.blendMode, bounds: { x: 0, y: 0, width: this.width, height: this.height }, revision: this.revision };
                }
                layer.blendMode = params.blendMode;
                return this.finishMutation(params, {
                    changed: true, name: layer.name, blendMode: layer.blendMode,
                }, { x: 0, y: 0, width: this.width, height: this.height }, "layers");
            }
            case "merge_down_layer": {
                if (params.confirm !== true)
                    throw new Error("merge_down_layer requires confirm: true");
                const top = this.resolveTargetLayer(params, true);
                const siblings = this.layers.filter((layer) => layer.parentIndex === top.parentIndex);
                const siblingIndex = siblings.indexOf(top);
                if (siblingIndex <= 0)
                    throw new Error("Cannot merge the bottom layer down.");
                const bottom = siblings[siblingIndex - 1];
                if (bottom.isGroup)
                    throw new Error("Cannot merge an image layer into a group layer.");
                for (const frame of this.frames) {
                    const bottomCel = this.cels.get(`${bottom.index}:${frame.frameNumber}`);
                    const topCel = this.cels.get(`${top.index}:${frame.frameNumber}`);
                    if (!bottomCel && !topCel)
                        continue;
                    const pixels = new Uint32Array(this.width * this.height);
                    for (let y = 0; y < this.height; y++) {
                        for (let x = 0; x < this.width; x++) {
                            const dst = bottomCel ? this.getCelPixel(bottomCel, x, y) : 0;
                            const src = topCel ? this.getCelPixel(topCel, x, y) : 0;
                            const bottomOpacity = Math.round(bottom.opacity * ((bottomCel?.opacity ?? 255) / 255));
                            const topOpacity = Math.round(top.opacity * ((topCel?.opacity ?? 255) / 255));
                            const bakedBottom = alphaComposite(0, dst, bottomOpacity);
                            pixels[y * this.width + x] = alphaComposite(bakedBottom, src, topOpacity);
                        }
                    }
                    this.cels.set(`${bottom.index}:${frame.frameNumber}`, {
                        layerIndex: bottom.index, frameNumber: frame.frameNumber,
                        bounds: { x: 0, y: 0, width: this.width, height: this.height },
                        pixels, opacity: 255, imageId: randomUUID(),
                    });
                    this.cels.delete(`${top.index}:${frame.frameNumber}`);
                }
                bottom.opacity = 255;
                bottom.blendMode = "normal";
                this.layers.splice(this.layers.indexOf(top), 1);
                this.activeLayerIndex = bottom.index;
                return this.finishMutation(params, {
                    mergedLayer: top.name, resultLayer: bottom.name,
                }, { x: 0, y: 0, width: this.width, height: this.height }, "layers", this.activeFrameNumber, true);
            }
            case "flatten_layers": {
                if (params.confirm !== true)
                    throw new Error("flatten_layers requires confirm: true");
                if (this.layers.length <= 1) {
                    return { success: true, changed: false, layerCount: this.layers.length, bounds: { x: 0, y: 0, width: this.width, height: this.height }, revision: this.revision };
                }
                const composites = new Map();
                for (const frame of this.frames)
                    composites.set(frame.frameNumber, this.getCompositeBuffer(frame.frameNumber));
                this.layers = [{
                        index: 0, name: "Flattened", isVisible: true, isEditable: true, isLocked: false,
                        opacity: 255, blendMode: "normal", isGroup: false, isBackground: false, parentIndex: null,
                    }];
                this.cels = new Map();
                for (const [frameNumber, pixels] of composites) {
                    this.cels.set(`0:${frameNumber}`, {
                        layerIndex: 0, frameNumber, bounds: { x: 0, y: 0, width: this.width, height: this.height },
                        pixels, opacity: 255, imageId: randomUUID(),
                    });
                }
                this.activeLayerIndex = 0;
                return this.finishMutation(params, {
                    changed: true, layerCount: 1, layer: "Flattened",
                }, { x: 0, y: 0, width: this.width, height: this.height }, "layers", this.activeFrameNumber, true);
            }
            // Slice tools
            case "list_slices":
                return { success: true, slices: this.slices.map((slice) => structuredClone(slice)), revision: this.revision };
            case "get_slice": {
                const matches = this.slices.filter((slice) => slice.name === params.name);
                if (matches.length === 0)
                    throw new Error(`Slice not found: ${params.name}`);
                if (matches.length > 1)
                    throw new Error(`Ambiguous slice name: ${params.name}`);
                return { success: true, slice: structuredClone(matches[0]), revision: this.revision };
            }
            case "create_slice": {
                if (this.slices.some((slice) => slice.name === params.name))
                    throw new Error(`Slice already exists: ${params.name}`);
                const bounds = { ...params.bounds };
                const center = params.center ? { ...params.center } : null;
                const pivot = params.pivot ? { ...params.pivot } : null;
                if (center && (center.x < 0 || center.y < 0 || center.width < 1 || center.height < 1 || center.x + center.width > bounds.width || center.y + center.height > bounds.height)) {
                    throw new Error("Slice center must be a non-empty rectangle inside the slice in local coordinates.");
                }
                if (pivot && (pivot.x < 0 || pivot.y < 0 || pivot.x >= bounds.width || pivot.y >= bounds.height)) {
                    throw new Error("Slice pivot must be inside the slice in local coordinates.");
                }
                const slice = {
                    name: params.name,
                    bounds,
                    center,
                    pivot,
                    color: params.color ? rgbaToHex(hexToRgba(params.color)) : null,
                    data: params.data ?? "",
                };
                this.slices.push(slice);
                return this.finishMutation(params, { slice: structuredClone(slice) }, bounds, "slices");
            }
            case "update_slice": {
                const slice = this.slices.find((item) => item.name === params.name);
                if (!slice)
                    throw new Error(`Slice not found: ${params.name}`);
                if (params.newName && params.newName !== params.name && this.slices.some((item) => item.name === params.newName)) {
                    throw new Error(`Slice already exists: ${params.newName}`);
                }
                const oldBounds = { ...slice.bounds };
                const nextBounds = params.bounds ? { ...params.bounds } : { ...slice.bounds };
                const nextCenter = params.center === undefined ? slice.center : params.center;
                const nextPivot = params.pivot === undefined ? slice.pivot : params.pivot;
                if (nextCenter && (nextCenter.x < 0 || nextCenter.y < 0 || nextCenter.width < 1 || nextCenter.height < 1 || nextCenter.x + nextCenter.width > nextBounds.width || nextCenter.y + nextCenter.height > nextBounds.height)) {
                    throw new Error("Slice center must be a non-empty rectangle inside the slice in local coordinates.");
                }
                if (nextPivot && (nextPivot.x < 0 || nextPivot.y < 0 || nextPivot.x >= nextBounds.width || nextPivot.y >= nextBounds.height)) {
                    throw new Error("Slice pivot must be inside the slice in local coordinates.");
                }
                slice.name = params.newName ?? slice.name;
                slice.bounds = nextBounds;
                slice.center = nextCenter ? { ...nextCenter } : null;
                slice.pivot = nextPivot ? { ...nextPivot } : null;
                if (params.color !== undefined)
                    slice.color = rgbaToHex(hexToRgba(params.color));
                if (params.data !== undefined)
                    slice.data = params.data;
                const minX = Math.min(oldBounds.x, slice.bounds.x), minY = Math.min(oldBounds.y, slice.bounds.y);
                const maxX = Math.max(oldBounds.x + oldBounds.width, slice.bounds.x + slice.bounds.width);
                const maxY = Math.max(oldBounds.y + oldBounds.height, slice.bounds.y + slice.bounds.height);
                return this.finishMutation(params, { slice: structuredClone(slice) }, {
                    x: minX, y: minY, width: maxX - minX, height: maxY - minY,
                }, "slices");
            }
            case "delete_slice": {
                if (params.confirm !== true)
                    throw new Error("delete_slice requires confirm: true");
                const index = this.slices.findIndex((slice) => slice.name === params.name);
                if (index < 0)
                    throw new Error(`Slice not found: ${params.name}`);
                const [slice] = this.slices.splice(index, 1);
                return this.finishMutation(params, { deleted: slice.name }, slice.bounds, "slices");
            }
            // Persistent selection tools
            case "get_selection": {
                const bounds = this.selectionBounds();
                return { success: true, isEmpty: bounds === null, bounds, origin: bounds ? { x: bounds.x, y: bounds.y } : { x: 0, y: 0 }, revision: this.revision };
            }
            case "set_selection": {
                const left = Math.max(0, params.x);
                const top = Math.max(0, params.y);
                const right = Math.min(this.width, params.x + params.width);
                const bottom = Math.min(this.height, params.y + params.height);
                if (left >= right || top >= bottom)
                    throw new Error("Selection rectangle does not intersect the sprite canvas.");
                const rectangle = new Set();
                for (let y = top; y < bottom; y++)
                    for (let x = left; x < right; x++)
                        rectangle.add(y * this.width + x);
                const operation = params.operation ?? "replace";
                if (operation === "replace")
                    this.selectionPixels = rectangle;
                else if (operation === "add")
                    for (const pixel of rectangle)
                        this.selectionPixels.add(pixel);
                else if (operation === "subtract")
                    for (const pixel of rectangle)
                        this.selectionPixels.delete(pixel);
                else if (operation === "intersect")
                    this.selectionPixels = new Set([...this.selectionPixels].filter((pixel) => rectangle.has(pixel)));
                else
                    throw new Error(`Unsupported selection operation: ${operation}`);
                const bounds = this.selectionBounds();
                return this.finishMutation(params, {
                    isEmpty: bounds === null, selectionBounds: bounds, origin: bounds ? { x: bounds.x, y: bounds.y } : { x: 0, y: 0 },
                }, { x: left, y: top, width: right - left, height: bottom - top }, "selection");
            }
            case "clear_selection": {
                const oldBounds = this.selectionBounds();
                if (!oldBounds)
                    return { success: true, changed: false, isEmpty: true, bounds: null, origin: { x: 0, y: 0 }, revision: this.revision };
                this.selectionPixels.clear();
                return this.finishMutation(params, { changed: true, isEmpty: true, selectionBounds: null, origin: { x: 0, y: 0 } }, oldBounds, "selection");
            }
            case "invert_selection": {
                const inverted = new Set();
                for (let index = 0; index < this.width * this.height; index++)
                    if (!this.selectionPixels.has(index))
                        inverted.add(index);
                this.selectionPixels = inverted;
                const bounds = this.selectionBounds();
                return this.finishMutation(params, {
                    changed: true, isEmpty: bounds === null, selectionBounds: bounds, origin: bounds ? { x: bounds.x, y: bounds.y } : { x: 0, y: 0 },
                }, { x: 0, y: 0, width: this.width, height: this.height }, "selection");
            }
            // Tileset and tilemap tools
            case "list_tilesets":
                return {
                    success: true,
                    tilesets: this.tilesets.map((tileset, index) => ({
                        index, name: tileset.name, baseIndex: tileset.baseIndex, tileCount: tileset.tiles.length,
                        grid: { x: 0, y: 0, tileWidth: tileset.tileWidth, tileHeight: tileset.tileHeight }, data: "",
                    })),
                    revision: this.revision,
                };
            case "create_tileset": {
                const tileCount = params.tileCount ?? 1;
                if (!Number.isInteger(params.tileWidth) || params.tileWidth < 1 || params.tileWidth > 1024
                    || !Number.isInteger(params.tileHeight) || params.tileHeight < 1 || params.tileHeight > 1024
                    || !Number.isInteger(tileCount) || tileCount < 1 || tileCount > 4096)
                    throw new Error("Invalid tileset dimensions or tile count.");
                if (params.tileWidth * params.tileHeight * tileCount > MAX_TILESET_PIXELS) {
                    throw new Error(`Tileset exceeds the ${MAX_TILESET_PIXELS.toLocaleString()} pixel safety limit.`);
                }
                const tiles = [];
                for (let i = 0; i < tileCount; i++) {
                    tiles.push({ pixels: new Uint32Array(params.tileWidth * params.tileHeight), color: null, data: "" });
                }
                const tileset = {
                    name: params.name, tileWidth: params.tileWidth, tileHeight: params.tileHeight,
                    baseIndex: params.baseIndex ?? 1, tiles,
                };
                this.tilesets.push(tileset);
                return this.finishMutation(params, {
                    tileset: {
                        index: this.tilesets.length - 1, name: tileset.name, baseIndex: tileset.baseIndex,
                        tileCount: tiles.length, grid: { x: 0, y: 0, tileWidth: tileset.tileWidth, tileHeight: tileset.tileHeight }, data: "",
                    },
                }, { x: 0, y: 0, width: this.width, height: this.height }, "tilesets", this.activeFrameNumber, true);
            }
            case "delete_tileset": {
                if (params.confirm !== true)
                    throw new Error("delete_tileset requires confirm: true");
                const tileset = this.tilesets[params.tilesetIndex];
                if (!tileset)
                    throw new Error(`Tileset not found at index ${params.tilesetIndex}`);
                if (this.layers.some((layer) => layer.isTilemap && layer.tilesetIndex === params.tilesetIndex)) {
                    throw new Error("Cannot delete a tileset while a tilemap layer references it.");
                }
                this.tilesets.splice(params.tilesetIndex, 1);
                for (const layer of this.layers) {
                    if (layer.tilesetIndex !== undefined && layer.tilesetIndex > params.tilesetIndex)
                        layer.tilesetIndex--;
                }
                return this.finishMutation(params, { deletedTilesetIndex: params.tilesetIndex }, { x: 0, y: 0, width: this.width, height: this.height }, "tilesets", this.activeFrameNumber, true);
            }
            case "get_tile": {
                const tileset = this.tilesets[params.tilesetIndex];
                if (!tileset)
                    throw new Error(`Tileset not found at index ${params.tilesetIndex}`);
                const tile = tileset.tiles[params.tileIndex];
                if (!tile)
                    throw new Error(`Tile not found at index ${params.tileIndex}`);
                return {
                    success: true, tilesetIndex: params.tilesetIndex, tileIndex: params.tileIndex,
                    width: tileset.tileWidth, height: tileset.tileHeight, color: tile.color, data: tile.data,
                    pngBase64: encodePixelBufferPng(tileset.tileWidth, tileset.tileHeight, tile.pixels), revision: this.revision,
                };
            }
            case "set_tile_pixels": {
                const tileset = this.tilesets[params.tilesetIndex];
                if (!tileset)
                    throw new Error(`Tileset not found at index ${params.tilesetIndex}`);
                if (params.tileIndex === 0)
                    throw new Error("Tile 0 is reserved as the empty tile.");
                const tile = tileset.tiles[params.tileIndex];
                if (!tile)
                    throw new Error(`Tile not found at index ${params.tileIndex}`);
                const nextPixels = new Uint32Array(tile.pixels);
                let minX = tileset.tileWidth, minY = tileset.tileHeight, maxX = -1, maxY = -1, changed = 0;
                for (const pixel of params.pixels) {
                    if (pixel.x < 0 || pixel.y < 0 || pixel.x >= tileset.tileWidth || pixel.y >= tileset.tileHeight) {
                        throw new Error("Tile pixel outside tile bounds.");
                    }
                    const index = pixel.y * tileset.tileWidth + pixel.x;
                    const color = hexToRgba(pixel.color);
                    if (nextPixels[index] !== color) {
                        nextPixels[index] = color;
                        changed++;
                        minX = Math.min(minX, pixel.x);
                        minY = Math.min(minY, pixel.y);
                        maxX = Math.max(maxX, pixel.x);
                        maxY = Math.max(maxY, pixel.y);
                    }
                }
                if (changed === 0)
                    return { success: true, changed: false, pixelsChanged: 0, bounds: { x: 0, y: 0, width: 0, height: 0 }, revision: this.revision };
                tile.pixels = nextPixels;
                const result = this.finishMutation({}, {
                    changed: true, pixelsChanged: changed, tilesetIndex: params.tilesetIndex, tileIndex: params.tileIndex,
                }, { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }, "tilesets", this.activeFrameNumber, true);
                if (params.returnPreview)
                    result.pngBase64 = encodePixelBufferPng(tileset.tileWidth, tileset.tileHeight, tile.pixels);
                return result;
            }
            case "create_tilemap_layer": {
                const tileset = this.tilesets[params.tilesetIndex];
                if (!tileset)
                    throw new Error(`Tileset not found at index ${params.tilesetIndex}`);
                const frame = this.resolveTargetFrame(params.frameNumber);
                let parentIndex = null;
                if (params.parentGroup) {
                    const parent = this.resolveAnyLayer({ layerName: params.parentGroup });
                    if (!parent.isGroup)
                        throw new Error("parentGroup is not a group.");
                    parentIndex = parent.index;
                }
                const nextIndex = this.layers.reduce((max, layer) => Math.max(max, layer.index), -1) + 1;
                const layer = {
                    index: nextIndex, name: params.name, isVisible: true, isEditable: true, isLocked: false,
                    opacity: 255, blendMode: "normal", isGroup: false, isBackground: false, parentIndex,
                    isTilemap: true, tilesetIndex: params.tilesetIndex,
                };
                this.layers.push(layer);
                this.tilemaps.set(`${layer.index}:${frame.frameNumber}`, {
                    layerIndex: layer.index, frameNumber: frame.frameNumber,
                    width: Math.ceil(this.width / tileset.tileWidth), height: Math.ceil(this.height / tileset.tileHeight),
                    origin: { x: 0, y: 0 },
                    values: new Uint32Array(Math.ceil(this.width / tileset.tileWidth) * Math.ceil(this.height / tileset.tileHeight)),
                });
                return this.finishMutation(params, {
                    name: layer.name, tilesetIndex: params.tilesetIndex, frameNumber: frame.frameNumber,
                }, { x: 0, y: 0, width: this.width, height: this.height }, "tilemaps", frame.frameNumber, true);
            }
            case "get_tilemap": {
                const layer = this.resolveAnyLayer(params);
                if (!layer.isTilemap || layer.tilesetIndex === undefined)
                    throw new Error("Target layer is not a tilemap.");
                const frame = this.resolveTargetFrame(params.frameNumber);
                const map = this.tilemaps.get(`${layer.index}:${frame.frameNumber}`);
                if (!map)
                    return { success: true, hasCel: false, layer: layer.name, frameNumber: frame.frameNumber, revision: this.revision };
                const tiles = Array.from({ length: map.height }, (_, y) => Array.from({ length: map.width }, (_, x) => unpackTileReference(map.values[y * map.width + x])));
                const tileset = this.tilesets[layer.tilesetIndex];
                return {
                    success: true, hasCel: true, layer: layer.name, frameNumber: frame.frameNumber,
                    width: map.width, height: map.height, tileWidth: tileset.tileWidth, tileHeight: tileset.tileHeight,
                    origin: { ...map.origin }, tiles, revision: this.revision,
                };
            }
            case "set_tiles": {
                const layer = this.resolveAnyLayer(params);
                if (!layer.isTilemap || layer.tilesetIndex === undefined)
                    throw new Error("Target layer is not a tilemap.");
                const frame = this.resolveTargetFrame(params.frameNumber);
                const tileset = this.tilesets[layer.tilesetIndex];
                const mapKey = `${layer.index}:${frame.frameNumber}`;
                const existingMap = this.tilemaps.get(mapKey);
                const map = existingMap ?? {
                    layerIndex: layer.index, frameNumber: frame.frameNumber,
                    width: Math.ceil(this.width / tileset.tileWidth), height: Math.ceil(this.height / tileset.tileHeight),
                    origin: { x: 0, y: 0 },
                    values: new Uint32Array(Math.ceil(this.width / tileset.tileWidth) * Math.ceil(this.height / tileset.tileHeight)),
                };
                const nextValues = new Uint32Array(map.values);
                let minX = map.width, minY = map.height, maxX = -1, maxY = -1, changed = 0;
                for (const item of params.tiles) {
                    if (item.x < 0 || item.y < 0 || item.x >= map.width || item.y >= map.height)
                        throw new Error("Tile cell outside tilemap bounds.");
                    if (item.tileIndex < 0 || item.tileIndex >= tileset.tiles.length)
                        throw new Error("tileIndex outside tileset bounds.");
                    const index = item.y * map.width + item.x;
                    const value = packTileReference(item.tileIndex, item.xFlip, item.yFlip, item.diagonalFlip);
                    if (nextValues[index] !== value) {
                        nextValues[index] = value;
                        changed++;
                        minX = Math.min(minX, item.x);
                        minY = Math.min(minY, item.y);
                        maxX = Math.max(maxX, item.x);
                        maxY = Math.max(maxY, item.y);
                    }
                }
                if (changed === 0)
                    return { success: true, changed: false, tilesChanged: 0, bounds: { x: 0, y: 0, width: 0, height: 0 }, revision: this.revision };
                map.values = nextValues;
                if (!existingMap)
                    this.tilemaps.set(mapKey, map);
                return this.finishMutation(params, {
                    changed: true, tilesChanged: changed, layer: layer.name, frameNumber: frame.frameNumber,
                }, {
                    x: map.origin.x + minX * tileset.tileWidth, y: map.origin.y + minY * tileset.tileHeight,
                    width: (maxX - minX + 1) * tileset.tileWidth, height: (maxY - minY + 1) * tileset.tileHeight,
                }, "tilemaps", frame.frameNumber);
            }
            // Frame tools
            case "inspect_animation": {
                const frames = this.frames.map((frame) => ({
                    frameNumber: frame.frameNumber,
                    durationMs: Math.round(frame.duration * 1000),
                    celCount: [...this.cels.values()].filter((cel) => cel.frameNumber === frame.frameNumber).length,
                }));
                const layers = this.layers.map((layer) => {
                    const layerCels = [...this.cels.values()]
                        .filter((cel) => cel.layerIndex === layer.index)
                        .sort((left, right) => left.frameNumber - right.frameNumber);
                    const celFrames = layerCels.map((cel) => cel.frameNumber);
                    const cels = layer.isGroup ? undefined : layerCels.map((cel) => ({
                        frameNumber: cel.frameNumber,
                        x: cel.bounds.x,
                        y: cel.bounds.y,
                        bounds: { ...cel.bounds },
                        position: { x: cel.bounds.x, y: cel.bounds.y },
                    }));
                    return {
                        uuid: `mock-layer-${layer.index}`,
                        name: layer.name,
                        path: layer.name,
                        isVisible: layer.isVisible,
                        opacity: layer.opacity,
                        isGroup: layer.isGroup,
                        isImage: !layer.isGroup && !layer.isTilemap,
                        isTilemap: layer.isTilemap ?? false,
                        celCount: celFrames.length,
                        celFrames,
                        cels,
                    };
                });
                return {
                    success: true,
                    width: this.width,
                    height: this.height,
                    colorMode: this.colorMode,
                    frames,
                    tags: this.tags.map((tag) => ({ ...tag })),
                    layers,
                    totalLayers: layers.length,
                    totalCels: this.cels.size,
                    totalDurationMs: frames.reduce((sum, frame) => sum + frame.durationMs, 0),
                    revision: this.revision,
                };
            }
            case "list_frames":
                return { frames: this.frames.map((f) => ({ ...f, durationMs: Math.round(f.duration * 1000) })) };
            case "select_frame": {
                const f = this.frames.find((fr) => fr.frameNumber === params.frameNumber);
                if (!f)
                    throw new Error(`Frame ${params.frameNumber} does not exist.`);
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
                const newFrame = { frameNumber: targetPos, duration: dur };
                if (targetPos <= this.frames.length) {
                    this.frames.splice(targetPos - 1, 0, newFrame);
                    for (let i = targetPos; i < this.frames.length; i++) {
                        this.frames[i].frameNumber = i + 1;
                    }
                    const updatedCels = new Map();
                    for (const cel of this.cels.values()) {
                        if (cel.frameNumber >= targetPos) {
                            cel.frameNumber += 1;
                        }
                        updatedCels.set(`${cel.layerIndex}:${cel.frameNumber}`, cel);
                    }
                    this.cels = updatedCels;
                }
                else {
                    this.frames.push(newFrame);
                }
                if (targetPos <= this.activeFrameNumber) {
                    this.activeFrameNumber += 1;
                }
                return this.finishMutation(params, {
                    frameNumber: targetPos,
                    createdFrameNumber: targetPos,
                    totalFrames: this.frames.length,
                    durationMs: durMs,
                }, { x: 0, y: 0, width: this.width, height: this.height }, "frames", targetPos, true);
            }
            case "duplicate_frame": {
                const srcFrame = this.frames.find((fr) => fr.frameNumber === params.frameNumber);
                if (!srcFrame)
                    throw new Error(`Frame ${params.frameNumber} not found.`);
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
                            opacity: oldCel.opacity ?? 255,
                            imageId: randomUUID(),
                        });
                    }
                }
                return this.finishMutation(params, { originalFrame: srcFrame.frameNumber, newFrame: nextNum }, { x: 0, y: 0, width: this.width, height: this.height }, "frames", nextNum, true);
            }
            case "delete_frame": {
                const idx = this.frames.findIndex((fr) => fr.frameNumber === params.frameNumber);
                if (idx === -1)
                    throw new Error(`Frame ${params.frameNumber} not found.`);
                this.frames.splice(idx, 1);
                return this.finishMutation(params, { deletedFrame: params.frameNumber }, { x: 0, y: 0, width: this.width, height: this.height }, "frames", this.activeFrameNumber, true);
            }
            case "set_frame_duration": {
                const f = this.frames.find((fr) => fr.frameNumber === params.frameNumber);
                if (!f)
                    throw new Error(`Frame ${params.frameNumber} not found.`);
                f.duration = params.durationMs / 1000;
                return this.finishMutation(params, { frameNumber: f.frameNumber, durationMs: params.durationMs }, { x: 0, y: 0, width: this.width, height: this.height }, "frames", f.frameNumber);
            }
            case "move_frame": {
                const fromFrame = params.fromFrame;
                const toFrame = params.toFrame;
                if (typeof fromFrame !== "number" || !Number.isInteger(fromFrame) || fromFrame < 1 || fromFrame > this.frames.length) {
                    throw new Error(`Invalid fromFrame: ${fromFrame}`);
                }
                if (typeof toFrame !== "number" || !Number.isInteger(toFrame) || toFrame < 1 || toFrame > this.frames.length) {
                    throw new Error(`Invalid toFrame: ${toFrame}`);
                }
                if (fromFrame === toFrame) {
                    return { success: true, fromFrame, toFrame, moved: false, revision: this.revision };
                }
                const srcFrameIdx = fromFrame - 1;
                const [movedFrame] = this.frames.splice(srcFrameIdx, 1);
                this.frames.splice(toFrame - 1, 0, movedFrame);
                for (let i = 0; i < this.frames.length; i++) {
                    this.frames[i].frameNumber = i + 1;
                }
                const remap = (f) => {
                    if (fromFrame < toFrame) {
                        if (f === fromFrame)
                            return toFrame;
                        if (f > fromFrame && f <= toFrame)
                            return f - 1;
                        return f;
                    }
                    else {
                        if (f === fromFrame)
                            return toFrame;
                        if (f >= toFrame && f < fromFrame)
                            return f + 1;
                        return f;
                    }
                };
                const newCels = new Map();
                for (const [key, cel] of this.cels.entries()) {
                    const [lStr, fStr] = key.split(":");
                    const l = Number(lStr);
                    const oldF = Number(fStr);
                    const newF = remap(oldF);
                    cel.frameNumber = newF;
                    newCels.set(`${l}:${newF}`, cel);
                }
                this.cels = newCels;
                this.activeFrameNumber = toFrame;
                return this.finishMutation(params, {
                    fromFrame,
                    toFrame,
                    moved: true,
                    totalFrames: this.frames.length,
                }, { x: 0, y: 0, width: this.width, height: this.height }, "frames", toFrame, true);
            }
            case "set_frame_durations": {
                const hasDurations = params.durations !== undefined;
                const hasRangePart = params.fromFrame !== undefined || params.toFrame !== undefined || params.durationMs !== undefined;
                if (hasDurations && hasRangePart) {
                    throw new Error("Cannot mix 'durations' and range parameters ('fromFrame', 'toFrame', 'durationMs').");
                }
                if (!hasDurations && !hasRangePart) {
                    throw new Error("Must provide either 'durations' or range parameters ('fromFrame', 'toFrame', 'durationMs').");
                }
                let normalizedDurations;
                if (hasRangePart) {
                    const { fromFrame, toFrame, durationMs } = params;
                    if (fromFrame === undefined || toFrame === undefined || durationMs === undefined) {
                        throw new Error("Range mode requires all of 'fromFrame', 'toFrame', and 'durationMs'.");
                    }
                    if (typeof fromFrame !== "number" || !Number.isInteger(fromFrame) || fromFrame < 1 || fromFrame > this.frames.length) {
                        throw new Error(`Invalid fromFrame: ${fromFrame}`);
                    }
                    if (typeof toFrame !== "number" || !Number.isInteger(toFrame) || toFrame < 1 || toFrame > this.frames.length) {
                        throw new Error(`Invalid toFrame: ${toFrame}`);
                    }
                    if (fromFrame > toFrame) {
                        throw new Error("fromFrame must be <= toFrame");
                    }
                    if ((toFrame - fromFrame + 1) > 256) {
                        throw new Error("Range exceeds maximum of 256 frames.");
                    }
                    if (typeof durationMs !== "number" || !Number.isInteger(durationMs) || durationMs < 1 || durationMs > 60000) {
                        throw new Error("durationMs must be an integer between 1 and 60000.");
                    }
                    normalizedDurations = [];
                    for (let fn = fromFrame; fn <= toFrame; fn++) {
                        normalizedDurations.push({ frameNumber: fn, durationMs });
                    }
                }
                else {
                    if (!Array.isArray(params.durations) || params.durations.length < 1 || params.durations.length > 256) {
                        throw new Error("durations must be an array between 1 and 256 entries.");
                    }
                    normalizedDurations = params.durations;
                }
                const seenFrames = new Set();
                for (const item of normalizedDurations) {
                    const fn = item.frameNumber;
                    const dur = item.durationMs;
                    if (typeof fn !== "number" || !Number.isInteger(fn) || fn < 1 || fn > this.frames.length) {
                        throw new Error(`Invalid frameNumber: ${fn}`);
                    }
                    if (seenFrames.has(fn)) {
                        throw new Error(`Duplicate frameNumber: ${fn}`);
                    }
                    seenFrames.add(fn);
                    if (typeof dur !== "number" || !Number.isInteger(dur) || dur < 1 || dur > 60000) {
                        throw new Error("durationMs must be an integer between 1 and 60000.");
                    }
                }
                for (const item of normalizedDurations) {
                    const f = this.frames.find((fr) => fr.frameNumber === item.frameNumber);
                    if (f)
                        f.duration = item.durationMs / 1000;
                }
                return this.finishMutation(params, {
                    updatedFrames: normalizedDurations.length,
                    durations: normalizedDurations,
                }, { x: 0, y: 0, width: this.width, height: this.height }, "frames");
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
                const direction = params.direction ?? "forward";
                if (!["forward", "reverse", "pingpong", "pingpong_reverse"].includes(direction)) {
                    throw new Error(`Invalid tag direction: ${direction}`);
                }
                const repeats = params.repeats ?? 0;
                if (!Number.isInteger(repeats) || repeats < 0 || repeats > 65535) {
                    throw new Error("repeats must be an integer between 0 and 65535.");
                }
                this.tags.push({
                    name: params.name,
                    from,
                    to,
                    color: normalizedColor,
                    direction,
                    repeats,
                });
                return this.finishMutation(params, { tag: params.name, repeats }, { x: 0, y: 0, width: this.width, height: this.height }, "tags");
            }
            case "list_tags":
                return {
                    tags: this.tags.map((t) => ({
                        ...t,
                        fromFrame: t.from,
                        toFrame: t.to,
                    })),
                };
            case "update_tag": {
                const tag = this.tags.find((t) => t.name === params.name);
                if (!tag)
                    throw new Error(`Tag not found: ${params.name}`);
                if (params.newName && params.newName !== tag.name && this.tags.some((t) => t !== tag && t.name === params.newName)) {
                    throw new Error(`Tag already exists: ${params.newName}`);
                }
                const from = params.fromFrame ?? tag.from;
                const to = params.toFrame ?? tag.to;
                if (typeof from !== "number" || !Number.isInteger(from) || from < 1 || from > this.frames.length) {
                    throw new Error(`Frame ${from} out of range`);
                }
                if (typeof to !== "number" || !Number.isInteger(to) || to < 1 || to > this.frames.length) {
                    throw new Error(`Frame ${to} out of range`);
                }
                if (from > to)
                    throw new Error("fromFrame must be <= toFrame");
                if (params.direction && !["forward", "reverse", "pingpong", "pingpong_reverse"].includes(params.direction)) {
                    throw new Error(`Invalid tag direction: ${params.direction}`);
                }
                if (params.repeats !== undefined && (!Number.isInteger(params.repeats) || params.repeats < 0 || params.repeats > 65535)) {
                    throw new Error("repeats must be an integer between 0 and 65535.");
                }
                const finalName = params.newName ?? tag.name;
                const finalFrom = from;
                const finalTo = to;
                const finalDirection = params.direction ?? tag.direction;
                const finalRepeats = params.repeats !== undefined ? params.repeats : (tag.repeats ?? 0);
                let colorChanged = false;
                let finalColor = tag.color;
                if (params.color !== undefined) {
                    const normalizedNewColor = rgbaToHex(hexToRgba(params.color));
                    const currentColor = tag.color ? rgbaToHex(hexToRgba(tag.color)) : undefined;
                    if (normalizedNewColor !== currentColor) {
                        colorChanged = true;
                    }
                    finalColor = normalizedNewColor;
                }
                const nameChanged = finalName !== tag.name;
                const rangeChanged = finalFrom !== tag.from || finalTo !== tag.to;
                const directionChanged = finalDirection !== tag.direction;
                const repeatsChanged = finalRepeats !== (tag.repeats ?? 0);
                if (!nameChanged && !rangeChanged && !directionChanged && !repeatsChanged && !colorChanged) {
                    return {
                        success: true,
                        changed: false,
                        tag: tag.name,
                        fromFrame: tag.from,
                        toFrame: tag.to,
                        repeats: tag.repeats ?? 0,
                        revision: this.revision,
                    };
                }
                tag.name = finalName;
                tag.from = finalFrom;
                tag.to = finalTo;
                tag.direction = finalDirection;
                tag.repeats = finalRepeats;
                if (params.color !== undefined) {
                    tag.color = finalColor;
                }
                return this.finishMutation(params, {
                    changed: true,
                    tag: tag.name,
                    fromFrame: tag.from,
                    toFrame: tag.to,
                    repeats: tag.repeats ?? 0,
                }, { x: 0, y: 0, width: this.width, height: this.height }, "tags");
            }
            case "delete_tag": {
                if (params.confirm !== true)
                    throw new Error("delete_tag requires confirm: true");
                const idx = this.tags.findIndex((t) => t.name === params.name);
                if (idx === -1)
                    throw new Error(`Tag not found: ${params.name}`);
                const [removed] = this.tags.splice(idx, 1);
                const metadata = {
                    name: removed.name,
                    fromFrame: removed.from,
                    toFrame: removed.to,
                    repeats: removed.repeats ?? 0,
                };
                return this.finishMutation(params, { tag: removed.name, deleted: true, metadata }, { x: 0, y: 0, width: this.width, height: this.height }, "tags");
            }
            case "render_animation_gif": {
                const frameNumbers = params.frameNumbers;
                if (!Array.isArray(frameNumbers) || frameNumbers.length < 1 || frameNumbers.length > 64) {
                    throw new Error("frameNumbers must contain between 1 and 64 entries.");
                }
                for (const frameNumber of frameNumbers)
                    this.resolveTargetFrame(frameNumber);
                const scale = params.scale ?? 1;
                if (!Number.isInteger(scale) || scale < 1 || scale > 8) {
                    throw new Error("scale must be an integer between 1 and 8.");
                }
                if (params.outputPath) {
                    if (params.overwrite !== true && this.mockExistingFiles.has(params.outputPath)) {
                        throw new Error(`File already exists and overwrite is false: ${params.outputPath}`);
                    }
                    this.mockExistingFiles.add(params.outputPath);
                }
                const durationsMs = frameNumbers.map((frameNumber) => Math.round(this.resolveTargetFrame(frameNumber).duration * 1000));
                return {
                    success: true,
                    outputPath: params.outputPath,
                    frameNumbers,
                    durationsMs,
                    totalDurationMs: durationsMs.reduce((sum, duration) => sum + duration, 0),
                    width: this.width * scale,
                    height: this.height * scale,
                    scale,
                    loop: params.loop === true,
                    ...(params.outputPath ? {} : {
                        gifBase64: "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
                        sizeBytes: 34,
                    }),
                };
            }
            // File / Canvas tools
            case "open_sprite":
                this.filename = params.filePath;
                this.mockExistingFiles.add(params.filePath);
                this.revision = 1;
                this.changeJournal = [{ revision: 1, pixelsChanged: 0, bounds: { x: 0, y: 0, width: this.width, height: this.height }, scope: "sprite", fullRefreshRequired: true, reason: "open_sprite" }];
                return { success: true, filename: this.filename, revision: this.revision };
            case "save_sprite":
                if (!params || !params.expectedFilePath || typeof params.expectedFilePath !== "string") {
                    throw new Error("expectedFilePath is required.");
                }
                const normExpected = params.expectedFilePath.replace(/\\/g, "/");
                const normActual = this.filename.replace(/\\/g, "/");
                if (normExpected !== normActual) {
                    throw new Error(`Sprite filename mismatch: expected '${params.expectedFilePath}', but active sprite is '${this.filename}'.`);
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
            case "export_sprite_sheet": {
                if (!params.outputPath || typeof params.outputPath !== "string")
                    throw new Error("outputPath is required.");
                if (params.overwrite !== true && this.mockExistingFiles.has(params.outputPath)) {
                    throw new Error(`File already exists and overwrite is false: ${params.outputPath}`);
                }
                if (params.frameNumbers && (params.tagName || params.fromFrame !== undefined || params.toFrame !== undefined)) {
                    throw new Error("frameNumbers is mutually exclusive with tagName/fromFrame/toFrame.");
                }
                if (params.tagName && (params.fromFrame !== undefined || params.toFrame !== undefined)) {
                    throw new Error("tagName is mutually exclusive with fromFrame/toFrame.");
                }
                if ((params.fromFrame === undefined) !== (params.toFrame === undefined)) {
                    throw new Error("fromFrame and toFrame must be provided together.");
                }
                let frameNumbers = [];
                let tag;
                if (params.frameNumbers) {
                    if (!Array.isArray(params.frameNumbers))
                        throw new Error("frameNumbers must be an array.");
                    frameNumbers = params.frameNumbers.map((frameNumber) => this.resolveTargetFrame(frameNumber).frameNumber);
                }
                else if (params.tagName) {
                    tag = this.tags.find((item) => item.name === params.tagName);
                    if (!tag)
                        throw new Error(`Tag not found: ${params.tagName}`);
                    const forward = Array.from({ length: tag.to - tag.from + 1 }, (_, index) => tag.from + index);
                    if (tag.direction === "reverse")
                        frameNumbers = [...forward].reverse();
                    else if (tag.direction === "pingpong")
                        frameNumbers = [...forward, ...forward.slice(1, -1).reverse()];
                    else if (tag.direction === "pingpong_reverse")
                        frameNumbers = [...forward].reverse().concat(forward.slice(1, -1));
                    else
                        frameNumbers = forward;
                }
                else {
                    const from = params.fromFrame ?? this.activeFrameNumber;
                    const to = params.toFrame ?? from;
                    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > this.frames.length || from > to) {
                        throw new Error("Invalid frame range.");
                    }
                    frameNumbers = Array.from({ length: to - from + 1 }, (_, index) => from + index);
                }
                if (frameNumbers.length < 1 || frameNumbers.length > 256)
                    throw new Error("Export range must contain between 1 and 256 frames.");
                if (params.layerNames) {
                    for (const name of params.layerNames) {
                        const layer = this.resolveAnyLayer({ layerName: name });
                        if (layer.isGroup)
                            throw new Error(`Group layers cannot be exported directly: ${name}`);
                    }
                }
                const scale = params.scale ?? 1;
                const spacing = params.spacing ?? 0;
                if (!Number.isInteger(scale) || scale < 1 || scale > 32)
                    throw new Error("scale must be an integer between 1 and 32.");
                if (!Number.isInteger(spacing) || spacing < 0 || spacing > 64)
                    throw new Error("spacing must be an integer between 0 and 64.");
                const layout = params.layout ?? "horizontal";
                let columns = layout === "vertical" ? 1 : layout === "horizontal" ? frameNumbers.length : (params.columns ?? Math.ceil(Math.sqrt(frameNumbers.length)));
                if (!["horizontal", "vertical", "grid"].includes(layout))
                    throw new Error(`Invalid layout: ${layout}`);
                if (!Number.isInteger(columns) || columns < 1 || columns > 64)
                    throw new Error("columns must be an integer between 1 and 64.");
                columns = Math.min(columns, frameNumbers.length);
                const rows = Math.ceil(frameNumbers.length / columns);
                const frameWidth = this.width * scale;
                const frameHeight = this.height * scale;
                const width = columns * frameWidth + (columns - 1) * spacing;
                const height = rows * frameHeight + (rows - 1) * spacing;
                if (width * height > 67_108_864)
                    throw new Error("Sprite sheet exceeds the 67,108,864 pixel safety limit.");
                this.mockExistingFiles.add(params.outputPath);
                return {
                    success: true,
                    outputPath: params.outputPath,
                    frameNumbers,
                    tagName: tag?.name,
                    layerNames: params.layerNames,
                    layout,
                    columns,
                    rows,
                    scale,
                    spacing,
                    width,
                    height,
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
                }
                else if (anchor === "center") {
                    x = Math.floor((oldW - width) / 2);
                    y = Math.floor((oldH - height) / 2);
                }
                else if (anchor === "top_right") {
                    x = oldW - width;
                    y = 0;
                }
                else if (anchor === "bottom_left") {
                    x = 0;
                    y = oldH - height;
                }
                else if (anchor === "bottom_right") {
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
                        if (oldY < 0 || oldY >= oldH)
                            continue;
                        for (let nx = 0; nx < this.width; nx++) {
                            const oldX = nx - dx;
                            if (oldX < 0 || oldX >= oldW)
                                continue;
                            newPixels[ny * this.width + nx] = cel.pixels[oldY * oldW + oldX];
                        }
                    }
                    cel.bounds = { x: 0, y: 0, width: this.width, height: this.height };
                    cel.pixels = newPixels;
                }
                const ox = -x === 0 ? 0 : -x;
                const oy = -y === 0 ? 0 : -y;
                return this.finishMutation(params, {
                    previousWidth: oldW,
                    previousHeight: oldH,
                    width: this.width,
                    height: this.height,
                    oldDimensions: { width: oldW, height: oldH },
                    newDimensions: { width: this.width, height: this.height },
                    anchor,
                    contentOffset: { x: ox, y: oy },
                }, { x: 0, y: 0, width: this.width, height: this.height }, "canvas", this.activeFrameNumber, true);
            }
            default:
                throw new Error(`Command '${command}' not implemented in MockEngine.`);
        }
    }
}
//# sourceMappingURL=mockEngine.js.map