const MAX_TRACKED_PALETTE_COLORS = 4096;
const MAX_REPORTED_PALETTE_COLORS = 512;
const MAX_NEAR_DUPLICATE_CANDIDATES = 256;
function byteHex(value) {
    return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0").toUpperCase();
}
export function rgbaToHex(color) {
    return `#${byteHex(color.r)}${byteHex(color.g)}${byteHex(color.b)}${byteHex(color.a)}`;
}
export function parseHexColor(input) {
    let value = input.trim().replace(/^#/, "");
    if (value.length === 3 || value.length === 4)
        value = [...value].map((part) => part + part).join("");
    if (value.length === 6)
        value += "FF";
    if (!/^[0-9a-fA-F]{8}$/.test(value))
        throw new Error(`Invalid hex color: ${input}`);
    return {
        r: Number.parseInt(value.slice(0, 2), 16),
        g: Number.parseInt(value.slice(2, 4), 16),
        b: Number.parseInt(value.slice(4, 6), 16),
        a: Number.parseInt(value.slice(6, 8), 16),
    };
}
function srgbChannelToLinear(channel) {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
export function rgbToLab(color) {
    const red = srgbChannelToLinear(color.r);
    const green = srgbChannelToLinear(color.g);
    const blue = srgbChannelToLinear(color.b);
    const x = (red * 0.4124564 + green * 0.3575761 + blue * 0.1804375) / 0.95047;
    const y = red * 0.2126729 + green * 0.7151522 + blue * 0.072175;
    const z = (red * 0.0193339 + green * 0.119192 + blue * 0.9503041) / 1.08883;
    const transform = (value) => value > 216 / 24389
        ? Math.cbrt(value)
        : (24389 / 27 * value + 16) / 116;
    const fx = transform(x);
    const fy = transform(y);
    const fz = transform(z);
    return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}
function degreesToRadians(value) { return value * Math.PI / 180; }
function radiansToDegrees(value) { return value * 180 / Math.PI; }
/** CIEDE2000 perceptual color difference. */
export function deltaE2000(left, right) {
    const avgLightness = (left.l + right.l) / 2;
    const chroma1 = Math.hypot(left.a, left.b);
    const chroma2 = Math.hypot(right.a, right.b);
    const avgChroma = (chroma1 + chroma2) / 2;
    const compensation = 0.5 * (1 - Math.sqrt(avgChroma ** 7 / (avgChroma ** 7 + 25 ** 7)));
    const adjustedA1 = (1 + compensation) * left.a;
    const adjustedA2 = (1 + compensation) * right.a;
    const adjustedChroma1 = Math.hypot(adjustedA1, left.b);
    const adjustedChroma2 = Math.hypot(adjustedA2, right.b);
    const avgAdjustedChroma = (adjustedChroma1 + adjustedChroma2) / 2;
    const hue = (a, b) => {
        const result = radiansToDegrees(Math.atan2(b, a));
        return result >= 0 ? result : result + 360;
    };
    const hue1 = hue(adjustedA1, left.b);
    const hue2 = hue(adjustedA2, right.b);
    const hueDifferenceRaw = hue2 - hue1;
    const hueDifference = adjustedChroma1 * adjustedChroma2 === 0 ? 0
        : Math.abs(hueDifferenceRaw) <= 180 ? hueDifferenceRaw
            : hueDifferenceRaw > 180 ? hueDifferenceRaw - 360 : hueDifferenceRaw + 360;
    const avgHue = adjustedChroma1 * adjustedChroma2 === 0 ? hue1 + hue2
        : Math.abs(hue1 - hue2) <= 180 ? (hue1 + hue2) / 2
            : (hue1 + hue2 + 360) / 2 % 360;
    const deltaLightness = right.l - left.l;
    const deltaChroma = adjustedChroma2 - adjustedChroma1;
    const deltaHue = 2 * Math.sqrt(adjustedChroma1 * adjustedChroma2) * Math.sin(degreesToRadians(hueDifference / 2));
    const weighting = 1
        - 0.17 * Math.cos(degreesToRadians(avgHue - 30))
        + 0.24 * Math.cos(degreesToRadians(2 * avgHue))
        + 0.32 * Math.cos(degreesToRadians(3 * avgHue + 6))
        - 0.20 * Math.cos(degreesToRadians(4 * avgHue - 63));
    const lightnessWeight = 1 + 0.015 * (avgLightness - 50) ** 2 / Math.sqrt(20 + (avgLightness - 50) ** 2);
    const chromaWeight = 1 + 0.045 * avgAdjustedChroma;
    const hueWeight = 1 + 0.015 * avgAdjustedChroma * weighting;
    const rotation = 30 * Math.exp(-(((avgHue - 275) / 25) ** 2));
    const chromaFactor = 2 * Math.sqrt(avgAdjustedChroma ** 7 / (avgAdjustedChroma ** 7 + 25 ** 7));
    const interaction = -Math.sin(degreesToRadians(2 * rotation)) * chromaFactor;
    const normalizedL = deltaLightness / lightnessWeight;
    const normalizedC = deltaChroma / chromaWeight;
    const normalizedH = deltaHue / hueWeight;
    return Math.sqrt(normalizedL ** 2 + normalizedC ** 2 + normalizedH ** 2 + interaction * normalizedC * normalizedH);
}
function rgbToHsl(color) {
    const red = color.r / 255;
    const green = color.g / 255;
    const blue = color.b / 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const lightness = (max + min) / 2;
    if (max === min)
        return { h: 0, s: 0, l: lightness };
    const delta = max - min;
    const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    let hue = max === red ? (green - blue) / delta + (green < blue ? 6 : 0)
        : max === green ? (blue - red) / delta + 2
            : (red - green) / delta + 4;
    hue *= 60;
    return { h: hue, s: saturation, l: lightness };
}
function hslToRgb(hue, saturation, lightness, alpha = 255) {
    const h = ((hue % 360) + 360) % 360 / 360;
    const s = Math.max(0, Math.min(1, saturation));
    const l = Math.max(0, Math.min(1, lightness));
    if (s === 0)
        return { r: l * 255, g: l * 255, b: l * 255, a: alpha };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const channel = (offset) => {
        let t = h + offset;
        if (t < 0)
            t += 1;
        if (t > 1)
            t -= 1;
        if (t < 1 / 6)
            return p + (q - p) * 6 * t;
        if (t < 1 / 2)
            return q;
        if (t < 2 / 3)
            return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    return { r: channel(1 / 3) * 255, g: channel(0) * 255, b: channel(-1 / 3) * 255, a: alpha };
}
export function generatePaletteRamp(baseColor, steps, shadowLightness, highlightLightness, hueShift) {
    const base = parseHexColor(baseColor);
    const hsl = rgbToHsl(base);
    return Array.from({ length: steps }, (_, index) => {
        const progress = steps === 1 ? 0.5 : index / (steps - 1);
        const lightness = shadowLightness + (highlightLightness - shadowLightness) * progress;
        const hue = hsl.h + hueShift * (progress * 2 - 1);
        return rgbaToHex(hslToRgb(hue, hsl.s, lightness, base.a));
    });
}
export function analyzeImagePalette(image, nearDuplicateThreshold = 3) {
    const counts = new Map();
    let transparentPixels = 0;
    for (let offset = 0; offset < image.data.length; offset += 4) {
        const color = rgbaToHex({
            r: image.data[offset], g: image.data[offset + 1], b: image.data[offset + 2], a: image.data[offset + 3],
        });
        if (image.data[offset + 3] === 0)
            transparentPixels++;
        else {
            if (!counts.has(color) && counts.size >= MAX_TRACKED_PALETTE_COLORS) {
                throw new Error(`Palette analysis supports at most ${MAX_TRACKED_PALETTE_COLORS} distinct opaque colors; `
                    + "quantize the sprite or inspect a smaller layer/frame.");
            }
            counts.set(color, (counts.get(color) ?? 0) + 1);
        }
    }
    const allColors = [...counts.entries()].sort((left, right) => right[1] - left[1]).map(([hex, count]) => {
        const parsed = parseHexColor(hex);
        const hsl = rgbToHsl(parsed);
        return { hex, count, share: count / (image.width * image.height - transparentPixels || 1), hue: hsl.h, saturation: hsl.s, lightness: hsl.l };
    });
    const colors = allColors.slice(0, MAX_REPORTED_PALETTE_COLORS);
    const duplicateCandidates = allColors.slice(0, MAX_NEAR_DUPLICATE_CANDIDATES);
    const nearDuplicates = [];
    for (let left = 0; left < duplicateCandidates.length; left++) {
        for (let right = left + 1; right < duplicateCandidates.length; right++) {
            const deltaE = deltaE2000(rgbToLab(parseHexColor(duplicateCandidates[left].hex)), rgbToLab(parseHexColor(duplicateCandidates[right].hex)));
            if (deltaE <= nearDuplicateThreshold) {
                nearDuplicates.push({
                    colorA: duplicateCandidates[left].hex,
                    colorB: duplicateCandidates[right].hex,
                    deltaE,
                });
            }
        }
    }
    const chromaticHues = allColors.filter((color) => color.saturation >= 0.15).slice(0, 8).map((color) => color.hue);
    let harmony = "achromatic";
    if (chromaticHues.length === 1)
        harmony = "monochromatic";
    else if (chromaticHues.length > 1) {
        const circularDistances = [];
        for (let i = 0; i < chromaticHues.length; i++) {
            for (let j = i + 1; j < chromaticHues.length; j++) {
                const raw = Math.abs(chromaticHues[i] - chromaticHues[j]);
                circularDistances.push(Math.min(raw, 360 - raw));
            }
        }
        if (circularDistances.every((distance) => distance <= 35))
            harmony = "analogous";
        else if (circularDistances.some((distance) => Math.abs(distance - 180) <= 25))
            harmony = "complementary";
        else if (circularDistances.filter((distance) => Math.abs(distance - 120) <= 25).length >= 2)
            harmony = "triadic";
        else
            harmony = "mixed";
    }
    return {
        colorCount: allColors.length,
        opaquePixels: image.width * image.height - transparentPixels,
        transparentPixels,
        colors,
        colorsTruncated: allColors.length > colors.length,
        reportedColorLimit: MAX_REPORTED_PALETTE_COLORS,
        nearDuplicates: nearDuplicates.sort((left, right) => left.deltaE - right.deltaE),
        nearDuplicateCandidateLimit: MAX_NEAR_DUPLICATE_CANDIDATES,
        inferredHarmony: harmony,
        notes: "Harmony and near-duplicate classifications are deterministic heuristics, not artistic verdicts.",
    };
}
function colorAt(image, x, y) {
    const offset = (y * image.width + x) * 4;
    return image.data[offset] | image.data[offset + 1] << 8 | image.data[offset + 2] << 16 | image.data[offset + 3] << 24;
}
function alphaAt(image, x, y) {
    return image.data[(y * image.width + x) * 4 + 3];
}
export function lintPixelArt(image, maxFindings = 200) {
    const findings = [];
    let droppedFindings = 0;
    const add = (finding) => {
        if (findings.length < maxFindings)
            findings.push(finding);
        else
            droppedFindings++;
    };
    const { width, height } = image;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const alpha = alphaAt(image, x, y);
            if (alpha > 0) {
                const ownColor = colorAt(image, x, y);
                let matchingNeighbors = 0;
                for (let dy = -1; dy <= 1; dy++)
                    for (let dx = -1; dx <= 1; dx++) {
                        if ((dx === 0 && dy === 0) || x + dx < 0 || y + dy < 0 || x + dx >= width || y + dy >= height)
                            continue;
                        if (colorAt(image, x + dx, y + dy) === ownColor)
                            matchingNeighbors++;
                    }
                if (matchingNeighbors === 0)
                    add({
                        rule: "orphan_pixel", severity: "info", confidence: "medium", x, y,
                        message: "Pixel has no same-color neighbor in its 8-neighborhood; verify that it is intentional.",
                    });
            }
            else if (x > 0 && y > 0 && x + 1 < width && y + 1 < height) {
                const left = colorAt(image, x - 1, y);
                const right = colorAt(image, x + 1, y);
                const up = colorAt(image, x, y - 1);
                const down = colorAt(image, x, y + 1);
                if ((left === right && alphaAt(image, x - 1, y) > 0) || (up === down && alphaAt(image, x, y - 1) > 0)) {
                    add({ rule: "broken_outline", severity: "warning", confidence: "medium", x, y, message: "Transparent one-pixel gap interrupts an identical opaque color." });
                }
            }
        }
    }
    for (let y = 0; y + 1 < height; y++) {
        let runStart = 0;
        while (runStart < width) {
            const color = colorAt(image, runStart, y);
            let runEnd = runStart + 1;
            while (runEnd < width && colorAt(image, runEnd, y) === color && colorAt(image, runEnd, y + 1) === color)
                runEnd++;
            if (runEnd - runStart >= 3 && alphaAt(image, runStart, y) > 0 && colorAt(image, runStart, y + 1) === color) {
                add({
                    rule: "banding", severity: "info", confidence: "low", x: runStart, y,
                    message: "Parallel identical runs span adjacent rows; inspect for unwanted banding.",
                    details: { length: runEnd - runStart },
                });
            }
            runStart = Math.max(runEnd, runStart + 1);
        }
    }
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
            if (alphaAt(image, x, y) > 0) {
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
            }
    if (maxX >= minX && maxY >= minY && maxX - minX >= 4 && maxY - minY >= 4) {
        let innerLight = 0, innerCount = 0, edgeLight = 0, edgeCount = 0;
        for (let y = minY; y <= maxY; y++)
            for (let x = minX; x <= maxX; x++) {
                const offset = (y * width + x) * 4;
                if (image.data[offset + 3] === 0)
                    continue;
                const light = image.data[offset] * 0.2126 + image.data[offset + 1] * 0.7152 + image.data[offset + 2] * 0.0722;
                const edge = x === minX || x === maxX || y === minY || y === maxY;
                if (edge) {
                    edgeLight += light;
                    edgeCount++;
                }
                else {
                    innerLight += light;
                    innerCount++;
                }
            }
        if (innerCount > 0 && edgeCount > 0 && innerLight / innerCount - edgeLight / edgeCount >= 24)
            add({
                rule: "pillow_shading", severity: "info", confidence: "low",
                message: "The occupied interior is substantially brighter than its outer bounds; verify the intended light direction.",
                details: { innerLuminance: innerLight / innerCount, edgeLuminance: edgeLight / edgeCount },
            });
    }
    let symmetryMismatches = 0;
    const symmetryPairs = Math.floor(width / 2) * height;
    for (let y = 0; y < height; y++)
        for (let x = 0; x < Math.floor(width / 2); x++) {
            if ((alphaAt(image, x, y) > 0) !== (alphaAt(image, width - 1 - x, y) > 0))
                symmetryMismatches++;
        }
    if (symmetryPairs > 0 && symmetryMismatches > 0)
        add({
            rule: "symmetry_drift", severity: "info", confidence: "low",
            message: "Left/right alpha silhouettes differ. Ignore this finding for intentionally asymmetric sprites.",
            details: { mismatchedPairs: symmetryMismatches, mismatchRatio: symmetryMismatches / symmetryPairs },
        });
    let horizontalSeams = 0, verticalSeams = 0;
    for (let y = 0; y < height; y++)
        if (colorAt(image, 0, y) !== colorAt(image, width - 1, y))
            horizontalSeams++;
    for (let x = 0; x < width; x++)
        if (colorAt(image, x, 0) !== colorAt(image, x, height - 1))
            verticalSeams++;
    if (horizontalSeams > 0 || verticalSeams > 0)
        add({
            rule: "tile_seam", severity: "info", confidence: "high",
            message: "Opposite canvas edges differ; this sprite will not tile seamlessly as-is.",
            details: { leftRightMismatches: horizontalSeams, topBottomMismatches: verticalSeams },
        });
    const summary = {};
    for (const finding of findings)
        summary[finding.rule] = (summary[finding.rule] ?? 0) + 1;
    return { findings, summary, truncated: droppedFindings > 0, droppedFindings };
}
const BAYER_MATRICES = {
    2: [[0, 2], [3, 1]],
    4: [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]],
    8: [
        [0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26],
        [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
        [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25],
        [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21],
    ],
};
export function generateDitherPixels(region, colorA, colorB, amount, matrixSize) {
    const matrix = BAYER_MATRICES[matrixSize];
    const threshold = Math.max(0, Math.min(1, amount)) * matrixSize * matrixSize;
    const pixels = [];
    for (let y = region.y; y < region.y + region.height; y++)
        for (let x = region.x; x < region.x + region.width; x++) {
            pixels.push({ x, y, color: matrix[y % matrixSize][x % matrixSize] < threshold ? colorB : colorA });
        }
    return pixels;
}
//# sourceMappingURL=pixelArt.js.map