// src/image/scaling.ts
import { InvalidDimensionError, BufferSizeMismatchError } from "./png.js";
/**
 * Scales an RGBA image buffer using strict nearest-neighbor integer scaling.
 * Guarantees zero bilinear blurring or anti-aliasing interpolation for pixel art.
 */
export function scaleNearestNeighbor(srcData, srcWidth, srcHeight, scale) {
    if (!Number.isInteger(srcWidth) || !Number.isInteger(srcHeight) || srcWidth <= 0 || srcHeight <= 0) {
        throw new InvalidDimensionError(srcWidth, srcHeight);
    }
    const expectedBytes = srcWidth * srcHeight * 4;
    if (srcData.length < expectedBytes) {
        throw new BufferSizeMismatchError(expectedBytes, srcData.length);
    }
    const s = Math.max(1, Math.floor(scale));
    if (s === 1) {
        return {
            data: new Uint8Array(srcData.subarray(0, expectedBytes)),
            width: srcWidth,
            height: srcHeight,
            scale: 1,
        };
    }
    const dstWidth = srcWidth * s;
    const dstHeight = srcHeight * s;
    const dstBuffer = new ArrayBuffer(dstWidth * dstHeight * 4);
    const dst32 = new Uint32Array(dstBuffer);
    // Safe typed array alignment check
    const alignedSrc = srcData.byteOffset % 4 === 0
        ? srcData
        : new Uint8Array(srcData.subarray(0, expectedBytes));
    const src32 = new Uint32Array(alignedSrc.buffer, alignedSrc.byteOffset, srcWidth * srcHeight);
    for (let y = 0; y < srcHeight; y++) {
        const srcRowOffset = y * srcWidth;
        const dstFirstRowOffset = (y * s) * dstWidth;
        // 1. Construct the first scaled row by repeating each pixel s times
        let dstX = 0;
        for (let x = 0; x < srcWidth; x++) {
            const pixel = src32[srcRowOffset + x];
            for (let dx = 0; dx < s; dx++) {
                dst32[dstFirstRowOffset + dstX++] = pixel;
            }
        }
        // 2. Replicate the first row into the remaining s - 1 sub-rows using copyWithin
        const rowLength = dstWidth;
        for (let dy = 1; dy < s; dy++) {
            const targetRowOffset = (y * s + dy) * dstWidth;
            dst32.copyWithin(targetRowOffset, dstFirstRowOffset, dstFirstRowOffset + rowLength);
        }
    }
    return {
        data: new Uint8Array(dstBuffer),
        width: dstWidth,
        height: dstHeight,
        scale: s,
    };
}
/**
 * Resizes an RGBA buffer to arbitrary target dimensions using nearest-neighbor point sampling.
 */
export function resizeNearestNeighbor(srcData, srcWidth, srcHeight, targetWidth, targetHeight) {
    if (!Number.isInteger(srcWidth) || !Number.isInteger(srcHeight) || srcWidth <= 0 || srcHeight <= 0) {
        throw new InvalidDimensionError(srcWidth, srcHeight);
    }
    if (!Number.isInteger(targetWidth) || !Number.isInteger(targetHeight) || targetWidth <= 0 || targetHeight <= 0) {
        throw new InvalidDimensionError(targetWidth, targetHeight);
    }
    const expectedBytes = srcWidth * srcHeight * 4;
    if (srcData.length < expectedBytes) {
        throw new BufferSizeMismatchError(expectedBytes, srcData.length);
    }
    const dstBuffer = new ArrayBuffer(targetWidth * targetHeight * 4);
    const dst32 = new Uint32Array(dstBuffer);
    const alignedSrc = srcData.byteOffset % 4 === 0
        ? srcData
        : new Uint8Array(srcData.subarray(0, expectedBytes));
    const src32 = new Uint32Array(alignedSrc.buffer, alignedSrc.byteOffset, srcWidth * srcHeight);
    // Precompute X mapping table
    const xMap = new Int32Array(targetWidth);
    for (let dstX = 0; dstX < targetWidth; dstX++) {
        xMap[dstX] = Math.min(srcWidth - 1, Math.floor((dstX * srcWidth) / targetWidth));
    }
    for (let dstY = 0; dstY < targetHeight; dstY++) {
        const srcY = Math.min(srcHeight - 1, Math.floor((dstY * srcHeight) / targetHeight));
        const srcRowOffset = srcY * srcWidth;
        const dstRowOffset = dstY * targetWidth;
        for (let dstX = 0; dstX < targetWidth; dstX++) {
            dst32[dstRowOffset + dstX] = src32[srcRowOffset + xMap[dstX]];
        }
    }
    return {
        data: new Uint8Array(dstBuffer),
        width: targetWidth,
        height: targetHeight,
    };
}
//# sourceMappingURL=scaling.js.map