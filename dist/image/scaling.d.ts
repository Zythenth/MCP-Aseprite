export interface ScaledImageResult {
    data: Uint8Array;
    width: number;
    height: number;
    scale: number;
}
/**
 * Scales an RGBA image buffer using strict nearest-neighbor integer scaling.
 * Guarantees zero bilinear blurring or anti-aliasing interpolation for pixel art.
 */
export declare function scaleNearestNeighbor(srcData: Uint8Array, srcWidth: number, srcHeight: number, scale: number): ScaledImageResult;
/**
 * Resizes an RGBA buffer to arbitrary target dimensions using nearest-neighbor point sampling.
 */
export declare function resizeNearestNeighbor(srcData: Uint8Array, srcWidth: number, srcHeight: number, targetWidth: number, targetHeight: number): {
    data: Uint8Array;
    width: number;
    height: number;
};
//# sourceMappingURL=scaling.d.ts.map