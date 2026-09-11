export interface CompactGridResult {
    palette: Record<string, string>;
    rows: string[];
    width: number;
    height: number;
    colorCount: number;
    isSingleChar: boolean;
    frequencies?: Record<string, number>;
    colors: Record<string, string>;
    grid: string[];
}
export interface CompactGridOptions {
    transparentSymbol?: string;
    customAlphabet?: string;
    normalizeTransparency?: boolean;
    includeFrequencies?: boolean;
}
export interface TokenSavingsStats {
    rawHexChars: number;
    compactChars: number;
    savingsRatio: number;
    estimatedTokensSaved: number;
}
/**
 * Builds a token-efficient compact mini-palette representation of a 2D hex grid.
 * Sorts palette symbols by frequency (Rank 1 = 'A', Rank 2 = 'B'...),
 * and strictly assigns '.' to transparent (#00000000).
 */
export declare function buildCompactGrid(pixelHexArray: string[][], width?: number, height?: number, options?: CompactGridOptions): CompactGridResult;
/**
 * Directly compresses an RGBA Uint8Array into a compact grid without intermediate arrays.
 */
export declare function buildCompactGridFromRgba(rgba: Uint8Array, width: number, height: number, options?: CompactGridOptions): CompactGridResult;
/**
 * Reconstructs the original 2D hex grid from a compact representation with 100% loss-free fidelity.
 */
export declare function decompressCompactGrid(compact: CompactGridResult): string[][];
/**
 * Calculates characters and token savings of compact format vs standard JSON arrays.
 */
export declare function calculateTokenSavings(compact: CompactGridResult, width: number, height: number): TokenSavingsStats;
//# sourceMappingURL=compact.d.ts.map