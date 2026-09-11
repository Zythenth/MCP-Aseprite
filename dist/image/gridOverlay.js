/**
 * Parses Hex (#RGB, #RGBA, #RRGGBB, #RRGGBBAA) or RgbColor into normalized RGBA components.
 */
export function parseColor(color, defaultAlpha = 1.0) {
    if (!color) {
        return { r: 255, g: 255, b: 255, a: defaultAlpha };
    }
    if (typeof color === "object") {
        const a = color.a !== undefined ? (color.a > 1 ? color.a / 255 : color.a) : defaultAlpha;
        return {
            r: Math.max(0, Math.min(255, Math.round(color.r))),
            g: Math.max(0, Math.min(255, Math.round(color.g))),
            b: Math.max(0, Math.min(255, Math.round(color.b))),
            a: Math.max(0, Math.min(1, a)),
        };
    }
    let hex = color.trim();
    if (hex.startsWith("#"))
        hex = hex.slice(1);
    if (hex.length === 3) {
        // #RGB
        const r = parseInt(hex[0] + hex[0], 16);
        const g = parseInt(hex[1] + hex[1], 16);
        const b = parseInt(hex[2] + hex[2], 16);
        return { r, g, b, a: defaultAlpha };
    }
    else if (hex.length === 4) {
        // #RGBA
        const r = parseInt(hex[0] + hex[0], 16);
        const g = parseInt(hex[1] + hex[1], 16);
        const b = parseInt(hex[2] + hex[2], 16);
        const a = parseInt(hex[3] + hex[3], 16) / 255;
        return { r, g, b, a };
    }
    else if (hex.length === 6) {
        // #RRGGBB
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return { r, g, b, a: defaultAlpha };
    }
    else if (hex.length === 8) {
        // #RRGGBBAA
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        const a = parseInt(hex.slice(6, 8), 16) / 255;
        return { r, g, b, a };
    }
    return { r: 255, g: 255, b: 255, a: defaultAlpha };
}
/**
 * Draws 1px grid lines at pixel boundaries on an integer-scaled RGBA canvas.
 */
export function applyGridOverlay(dstData, width, height, options) {
    const scale = Math.max(1, Math.floor(options.scale));
    const minScale = options.minScale ?? 4;
    const target = options.inPlace ? dstData : new Uint8Array(dstData);
    if (scale < minScale) {
        return target;
    }
    const offsetX = Math.max(0, options.offsetX ?? 0);
    const offsetY = Math.max(0, options.offsetY ?? 0);
    const sw = options.spriteWidth ?? Math.floor((width - offsetX) / scale);
    const sh = options.spriteHeight ?? Math.floor((height - offsetY) / scale);
    if (sw <= 0 || sh <= 0) {
        return target;
    }
    const endX = Math.min(width, offsetX + sw * scale);
    const endY = Math.min(height, offsetY + sh * scale);
    const defaultOpacity = scale >= 8 ? 0.35 : 0.20;
    const parsedColor = parseColor(options.color, defaultOpacity);
    const effectiveAlpha = options.opacity !== undefined ? Math.max(0, Math.min(1, options.opacity)) : parsedColor.a;
    if (effectiveAlpha <= 0) {
        return target;
    }
    const gridR = parsedColor.r;
    const gridG = parsedColor.g;
    const gridB = parsedColor.b;
    const invA = 1 - effectiveAlpha;
    const includeOuter = options.includeOuterBorders ?? true;
    const blendPixel = (idx) => {
        const dstA = target[idx + 3];
        if (dstA === 255) {
            target[idx] = Math.round(target[idx] * invA + gridR * effectiveAlpha);
            target[idx + 1] = Math.round(target[idx + 1] * invA + gridG * effectiveAlpha);
            target[idx + 2] = Math.round(target[idx + 2] * invA + gridB * effectiveAlpha);
        }
        else {
            const aSrc = effectiveAlpha;
            const aDst = dstA / 255;
            const aOut = aSrc + aDst * (1 - aSrc);
            if (aOut > 0) {
                target[idx] = Math.round((gridR * aSrc + target[idx] * aDst * (1 - aSrc)) / aOut);
                target[idx + 1] = Math.round((gridG * aSrc + target[idx + 1] * aDst * (1 - aSrc)) / aOut);
                target[idx + 2] = Math.round((gridB * aSrc + target[idx + 2] * aDst * (1 - aSrc)) / aOut);
                target[idx + 3] = Math.round(aOut * 255);
            }
        }
    };
    // 1. Vertical Grid Lines
    const startPx = includeOuter ? 0 : 1;
    const endPx = includeOuter ? sw : sw - 1;
    for (let px = startPx; px <= endPx; px++) {
        let x = offsetX + px * scale;
        if (x === endX && includeOuter) {
            x = endX - 1; // Clamp right edge inside canvas bounds
        }
        if (x < 0 || x >= width)
            continue;
        for (let y = offsetY; y < endY; y++) {
            blendPixel((y * width + x) * 4);
        }
    }
    // 2. Horizontal Grid Lines
    const startPy = includeOuter ? 0 : 1;
    const endPy = includeOuter ? sh : sh - 1;
    for (let py = startPy; py <= endPy; py++) {
        let y = offsetY + py * scale;
        if (y === endY && includeOuter) {
            y = endY - 1; // Clamp bottom edge inside canvas bounds
        }
        if (y < 0 || y >= height)
            continue;
        for (let x = offsetX; x < endX; x++) {
            blendPixel((y * width + x) * 4);
        }
    }
    return target;
}
//# sourceMappingURL=gridOverlay.js.map