// src/mock/mockEngine.ts
import { PNG } from "pngjs";
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
    palette = new Uint32Array(256);
    tags = [];
    constructor(width = 32, height = 32) {
        this.reset(width, height);
    }
    reset(width = 32, height = 32) {
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
        this.cels.clear();
        const initialCel = {
            layerIndex: 0,
            frameNumber: 1,
            bounds: { x: 0, y: 0, width, height },
            pixels: new Uint32Array(width * height), // all transparent 0x00000000
        };
        this.cels.set("0:1", initialCel);
        this.undoStack = [];
        this.redoStack = [];
        // Initialize basic palette
        this.palette.fill(0);
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
    getCompositeBuffer(frameNumber = this.activeFrameNumber) {
        const composite = new Uint32Array(this.width * this.height);
        for (const layer of this.layers) {
            if (!layer.isVisible)
                continue;
            const cel = this.cels.get(`${layer.index}:${frameNumber}`);
            if (!cel)
                continue;
            const layerAlphaRatio = layer.opacity / 255;
            for (let y = 0; y < this.height; y++) {
                for (let x = 0; x < this.width; x++) {
                    const srcColor = this.getCelPixel(cel, x, y);
                    if (srcColor === 0)
                        continue;
                    const src = unpackRgba(srcColor);
                    const effectiveSrcAlpha = src.a * layerAlphaRatio;
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
    exportFramePngBase64(frameNumber = this.activeFrameNumber) {
        const composite = this.getCompositeBuffer(frameNumber);
        const png = new PNG({ width: this.width, height: this.height });
        const byteView = new Uint8Array(composite.buffer, composite.byteOffset, composite.byteLength);
        for (let i = 0; i < byteView.length; i++) {
            png.data[i] = byteView[i];
        }
        const pngBuffer = PNG.sync.write(png);
        return pngBuffer.toString("base64");
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
                const frameNum = params.frameIndex ?? this.activeFrameNumber;
                return {
                    width: this.width,
                    height: this.height,
                    frameNumber: frameNum,
                    pngBase64: this.exportFramePngBase64(frameNum),
                    revision: this.revision,
                };
            }
            case "get_pixel_grid": {
                if (!this.hasActiveSprite)
                    throw new Error("No active sprite open in Aseprite.");
                const frameNum = params.frameIndex ?? this.activeFrameNumber;
                let layerIdx = params.layerIndex ?? this.activeLayerIndex;
                if (params.layerName) {
                    const l = this.layers.find((ly) => ly.name === params.layerName);
                    if (!l)
                        throw new Error(`Layer '${params.layerName}' not found.`);
                    layerIdx = l.index;
                }
                const cel = this.cels.get(`${layerIdx}:${frameNum}`);
                const format = params.format ?? "hex";
                const grid = [];
                const paletteList = [];
                const paletteMap = new Map();
                for (let y = 0; y < this.height; y++) {
                    const row = [];
                    for (let x = 0; x < this.width; x++) {
                        const colorInt = cel ? this.getCelPixel(cel, x, y) : 0;
                        if (format === "hex") {
                            row.push(rgbaToHex(colorInt));
                        }
                        else if (format === "rgba") {
                            row.push(unpackRgba(colorInt));
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
                    width: this.width,
                    height: this.height,
                    format,
                    grid,
                    revision: this.revision,
                };
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
                const layerIdx = params.layerIndex ?? this.activeLayerIndex;
                const frameNum = params.frameNumber ?? this.activeFrameNumber;
                const layer = this.layers.find((l) => l.index === layerIdx);
                if (!layer || layer.isGroup)
                    throw new Error("Cannot paint on invalid layer or group.");
                if (layer.isLocked)
                    throw new Error("Layer is locked.");
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
                }
                const out = {
                    pixelsModified: modifiedCount,
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
                return this.executeCommand("set_pixels", {
                    ...params,
                    pixels: points.map((pt) => ({ x: pt.x, y: pt.y, color: "#00000000" })),
                });
            }
            case "undo": {
                if (!this.hasActiveSprite)
                    throw new Error("No active sprite.");
                if (this.undoStack.length === 0)
                    throw new Error("No undo transactions available.");
                const tx = this.undoStack.pop();
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
                if (!this.hasActiveSprite)
                    throw new Error("No active sprite.");
                if (this.redoStack.length === 0)
                    throw new Error("No redo transactions available.");
                const tx = this.redoStack.pop();
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
                if (params.colorMode)
                    this.colorMode = params.colorMode;
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
                const cel = this.getOrCreateCel(params.layerIndex ?? this.activeLayerIndex, params.frameNumber ?? this.activeFrameNumber);
                const targetColor = this.getCelPixel(cel, x, y);
                const newColor = hexToRgba(color);
                if (targetColor === newColor)
                    return { pixelsModified: 0, revision: this.revision };
                const targetUnpacked = unpackRgba(targetColor);
                const visited = new Uint8Array(this.width * this.height);
                const queue = [[x, y]];
                visited[y * this.width + x] = 1;
                const pixelsToPaint = [];
                while (queue.length > 0) {
                    const [cx, cy] = queue.shift();
                    pixelsToPaint.push({ x: cx, y: cy, color });
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
                return this.executeCommand("set_pixels", { ...params, pixels: pixelsToPaint });
            }
            case "replace_color": {
                const { fromColor, toColor, tolerance = 0 } = params;
                const fromInt = hexToRgba(fromColor);
                const fromUnpacked = unpackRgba(fromInt);
                const cel = this.getOrCreateCel(params.layerIndex ?? this.activeLayerIndex, params.frameNumber ?? this.activeFrameNumber);
                const pixelsToPaint = [];
                for (let y = 0; y < this.height; y++) {
                    for (let x = 0; x < this.width; x++) {
                        const current = this.getCelPixel(cel, x, y);
                        const c = unpackRgba(current);
                        const diff = Math.abs(c.r - fromUnpacked.r) + Math.abs(c.g - fromUnpacked.g) + Math.abs(c.b - fromUnpacked.b) + Math.abs(c.a - fromUnpacked.a);
                        if (diff <= tolerance * 4) {
                            pixelsToPaint.push({ x, y, color: toColor });
                        }
                    }
                }
                return this.executeCommand("set_pixels", { ...params, pixels: pixelsToPaint });
            }
            case "get_changes_since": {
                const since = params.sinceRevision ?? 0;
                const matchingTxs = this.undoStack.filter((t) => t.revisionAfter > since);
                const deltas = [];
                let minX = this.width, minY = this.height, maxX = 0, maxY = 0;
                for (const tx of matchingTxs) {
                    for (const d of tx.pixelDeltas) {
                        deltas.push(d);
                        if (d.x < minX)
                            minX = d.x;
                        if (d.y < minY)
                            minY = d.y;
                        if (d.x > maxX)
                            maxX = d.x;
                        if (d.y > maxY)
                            maxY = d.y;
                    }
                }
                return {
                    sinceRevision: since,
                    currentRevision: this.revision,
                    modifiedPixels: deltas.length,
                    bounds: deltas.length > 0 ? {
                        x: minX,
                        y: minY,
                        width: maxX - minX + 1,
                        height: maxY - minY + 1,
                    } : { x: 0, y: 0, width: 0, height: 0 },
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
                this.revision++;
                return { success: true, index: idx, color: params.color, revision: this.revision };
            }
            case "find_palette_color": {
                const target = unpackRgba(hexToRgba(params.color));
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
                }
                return {
                    index: bestIdx,
                    hex: rgbaToHex(this.palette[bestIdx]),
                    exact: minDiff === 0,
                    distance: minDiff,
                };
            }
            // Layer tools
            case "list_layers":
                return { layers: this.layers.map((l) => ({ ...l })) };
            case "create_layer": {
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
                    parentIndex: null,
                };
                this.layers.push(newLayer);
                this.revision++;
                return { success: true, layer: newLayer, revision: this.revision };
            }
            case "rename_layer": {
                const layer = this.layers.find((l) => l.name === params.oldName);
                if (!layer)
                    throw new Error(`Layer '${params.oldName}' not found.`);
                layer.name = params.newName;
                this.revision++;
                return { success: true, oldName: params.oldName, newName: params.newName, revision: this.revision };
            }
            case "delete_layer": {
                const idx = this.layers.findIndex((l) => l.name === params.name);
                if (idx === -1)
                    throw new Error(`Layer '${params.name}' not found.`);
                this.layers.splice(idx, 1);
                this.revision++;
                return { success: true, deletedLayer: params.name, revision: this.revision };
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
                this.revision++;
                return { success: true, name: layer.name, visible: layer.isVisible, revision: this.revision };
            }
            case "set_layer_opacity": {
                const layer = this.layers.find((l) => l.name === params.name);
                if (!layer)
                    throw new Error(`Layer '${params.name}' not found.`);
                layer.opacity = params.opacity;
                this.revision++;
                return { success: true, name: layer.name, opacity: layer.opacity, revision: this.revision };
            }
            case "move_layer": {
                const idx = this.layers.findIndex((l) => l.name === params.name);
                if (idx === -1)
                    throw new Error(`Layer '${params.name}' not found.`);
                const [layer] = this.layers.splice(idx, 1);
                this.layers.splice(params.targetIndex, 0, layer);
                this.revision++;
                return { success: true, moved: layer.name, targetIndex: params.targetIndex, revision: this.revision };
            }
            case "create_group": {
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
                if (!f)
                    throw new Error(`Frame ${params.frameNumber} does not exist.`);
                this.activeFrameNumber = f.frameNumber;
                return { success: true, activeFrame: f.frameNumber };
            }
            case "create_frame": {
                const nextNum = this.frames.length + 1;
                const dur = (params.duration ?? 100) / 1000;
                this.frames.push({ frameNumber: nextNum, duration: dur });
                this.revision++;
                return { success: true, frameNumber: nextNum, durationMs: params.duration ?? 100, revision: this.revision };
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
                        });
                    }
                }
                this.revision++;
                return { success: true, originalFrame: srcFrame.frameNumber, newFrame: nextNum, revision: this.revision };
            }
            case "delete_frame": {
                const idx = this.frames.findIndex((fr) => fr.frameNumber === params.frameNumber);
                if (idx === -1)
                    throw new Error(`Frame ${params.frameNumber} not found.`);
                this.frames.splice(idx, 1);
                this.revision++;
                return { success: true, deletedFrame: params.frameNumber, revision: this.revision };
            }
            case "set_frame_duration": {
                const f = this.frames.find((fr) => fr.frameNumber === params.frameNumber);
                if (!f)
                    throw new Error(`Frame ${params.frameNumber} not found.`);
                f.duration = params.durationMs / 1000;
                this.revision++;
                return { success: true, frameNumber: f.frameNumber, durationMs: params.durationMs, revision: this.revision };
            }
            case "create_tag": {
                this.tags.push({
                    name: params.name,
                    from: params.fromFrame,
                    to: params.toFrame,
                    color: params.color,
                });
                this.revision++;
                return { success: true, tag: params.name, revision: this.revision };
            }
            case "list_tags":
                return { tags: [...this.tags] };
            // File / Canvas tools
            case "open_sprite":
                this.filename = params.filePath;
                this.revision++;
                return { success: true, filename: this.filename, revision: this.revision };
            case "save_sprite":
                return { success: true, filename: this.filename, message: "Saved sprite successfully" };
            case "save_sprite_as":
                this.filename = params.filePath;
                return { success: true, filename: this.filename, message: `Saved sprite as ${this.filename}` };
            case "export_png":
                return {
                    success: true,
                    outputPath: params.outputPath,
                    width: this.width * (params.scale ?? 1),
                    height: this.height * (params.scale ?? 1),
                };
            case "resize_canvas": {
                const oldW = this.width;
                const oldH = this.height;
                this.width = params.width;
                this.height = params.height;
                // Resize all cels
                for (const cel of this.cels.values()) {
                    const newPixels = new Uint32Array(this.width * this.height);
                    for (let y = 0; y < Math.min(oldH, this.height); y++) {
                        for (let x = 0; x < Math.min(oldW, this.width); x++) {
                            newPixels[y * this.width + x] = cel.pixels[y * oldW + x];
                        }
                    }
                    cel.bounds = { x: 0, y: 0, width: this.width, height: this.height };
                    cel.pixels = newPixels;
                }
                this.revision++;
                return {
                    success: true,
                    previousWidth: oldW,
                    previousHeight: oldH,
                    width: this.width,
                    height: this.height,
                    revision: this.revision,
                };
            }
            default:
                throw new Error(`Command '${command}' not implemented in MockEngine.`);
        }
    }
}
//# sourceMappingURL=mockEngine.js.map