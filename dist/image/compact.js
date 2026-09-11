// src/image/compact.ts
const DEFAULT_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function normalizeHexColor(hex, normalizeZeroAlpha = true) {
    let clean = hex.trim().toUpperCase();
    if (clean.startsWith("#"))
        clean = clean.slice(1);
    if (clean.length === 3) {
        clean = `${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}FF`;
    }
    else if (clean.length === 4) {
        clean = `${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}${clean[3]}${clean[3]}`;
    }
    else if (clean.length === 6) {
        clean = `${clean}FF`;
    }
    if (normalizeZeroAlpha && clean.endsWith("00")) {
        return "#00000000";
    }
    return `#${clean}`;
}
/**
 * Builds a token-efficient compact mini-palette representation of a 2D hex grid.
 * Sorts palette symbols by frequency (Rank 1 = 'A', Rank 2 = 'B'...),
 * and strictly assigns '.' to transparent (#00000000).
 */
export function buildCompactGrid(pixelHexArray, width, height, options) {
    const h = height ?? pixelHexArray.length;
    const w = width ?? (pixelHexArray[0]?.length ?? 0);
    const transSymbol = options?.transparentSymbol ?? ".";
    const alphabet = options?.customAlphabet ?? DEFAULT_ALPHABET;
    const normalizeZeroAlpha = options?.normalizeTransparency ?? true;
    // 1. Calculate color frequencies
    const freqMap = new Map();
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const rawHex = pixelHexArray[y]?.[x] ?? "#00000000";
            const normalized = normalizeHexColor(rawHex, normalizeZeroAlpha);
            freqMap.set(normalized, (freqMap.get(normalized) ?? 0) + 1);
        }
    }
    // 2. Separate transparent vs non-transparent colors
    const palette = {};
    const symbolMap = new Map();
    let hasTransparent = false;
    const nonTransColors = [];
    for (const [color, count] of freqMap.entries()) {
        if (color === "#00000000") {
            hasTransparent = true;
        }
        else {
            nonTransColors.push({ color, count });
        }
    }
    // Frequency-sort non-transparent colors descending (break ties alphabetically)
    nonTransColors.sort((a, b) => {
        if (b.count !== a.count)
            return b.count - a.count;
        return a.color.localeCompare(b.color);
    });
    // Assign '.' to transparent if present
    if (hasTransparent) {
        palette[transSymbol] = "#00000000";
        symbolMap.set("#00000000", transSymbol);
    }
    // 3. Assign symbols from alphabet
    const isSingleChar = nonTransColors.length <= alphabet.length;
    for (let i = 0; i < nonTransColors.length; i++) {
        const { color } = nonTransColors[i];
        let symbol;
        if (isSingleChar) {
            symbol = alphabet[i];
        }
        else {
            symbol = `[${i.toString(16).padStart(2, "0").toUpperCase()}]`;
        }
        palette[symbol] = color;
        symbolMap.set(color, symbol);
    }
    // 4. Generate matrix rows
    const rows = [];
    for (let y = 0; y < h; y++) {
        if (isSingleChar) {
            let rowStr = "";
            for (let x = 0; x < w; x++) {
                const rawHex = pixelHexArray[y]?.[x] ?? "#00000000";
                const normalized = normalizeHexColor(rawHex, normalizeZeroAlpha);
                rowStr += symbolMap.get(normalized) ?? transSymbol;
            }
            rows.push(rowStr);
        }
        else {
            const rowTokens = [];
            for (let x = 0; x < w; x++) {
                const rawHex = pixelHexArray[y]?.[x] ?? "#00000000";
                const normalized = normalizeHexColor(rawHex, normalizeZeroAlpha);
                rowTokens.push(symbolMap.get(normalized) ?? transSymbol);
            }
            rows.push(rowTokens.join(","));
        }
    }
    const result = {
        palette,
        rows,
        width: w,
        height: h,
        colorCount: Object.keys(palette).length,
        isSingleChar,
        colors: palette,
        grid: rows,
    };
    if (options?.includeFrequencies) {
        result.frequencies = Object.fromEntries(freqMap.entries());
    }
    return result;
}
/**
 * Directly compresses an RGBA Uint8Array into a compact grid without intermediate arrays.
 */
export function buildCompactGridFromRgba(rgba, width, height, options) {
    const pixelGrid = [];
    for (let y = 0; y < height; y++) {
        const row = [];
        const rowOffset = y * width * 4;
        for (let x = 0; x < width; x++) {
            const idx = rowOffset + x * 4;
            const r = rgba[idx].toString(16).padStart(2, "0");
            const g = rgba[idx + 1].toString(16).padStart(2, "0");
            const b = rgba[idx + 2].toString(16).padStart(2, "0");
            const a = rgba[idx + 3].toString(16).padStart(2, "0");
            row.push(`#${r}${g}${b}${a}`.toUpperCase());
        }
        pixelGrid.push(row);
    }
    return buildCompactGrid(pixelGrid, width, height, options);
}
/**
 * Reconstructs the original 2D hex grid from a compact representation with 100% loss-free fidelity.
 */
export function decompressCompactGrid(compact) {
    const { palette, rows, width, height, isSingleChar } = compact;
    const grid = [];
    for (let y = 0; y < height; y++) {
        const rowStr = rows[y] ?? "";
        const row = [];
        if (isSingleChar) {
            for (let x = 0; x < width; x++) {
                const char = rowStr[x] ?? ".";
                row.push(palette[char] ?? "#00000000");
            }
        }
        else {
            const tokens = rowStr.split(",");
            for (let x = 0; x < width; x++) {
                const token = tokens[x] ?? ".";
                row.push(palette[token] ?? "#00000000");
            }
        }
        grid.push(row);
    }
    return grid;
}
/**
 * Calculates characters and token savings of compact format vs standard JSON arrays.
 */
export function calculateTokenSavings(compact, width, height) {
    const rawHexChars = width * height * 12 + 100;
    const compactChars = JSON.stringify(compact.palette).length + compact.rows.join("").length + 100;
    const savingsRatio = Math.max(0, 1 - compactChars / rawHexChars);
    const estimatedTokensSaved = Math.round((rawHexChars - compactChars) / 3.8);
    return {
        rawHexChars,
        compactChars,
        savingsRatio,
        estimatedTokensSaved,
    };
}
//# sourceMappingURL=compact.js.map