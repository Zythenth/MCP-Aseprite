export declare class ImagePipelineError extends Error {
    constructor(message: string);
}
export declare class InvalidDimensionError extends ImagePipelineError {
    constructor(width: number, height: number);
}
export declare class BufferSizeMismatchError extends ImagePipelineError {
    constructor(expected: number, actual: number);
}
export declare class PngDecodeError extends ImagePipelineError {
    constructor(cause: unknown);
}
export interface ImageBuffer {
    width: number;
    height: number;
    data: Uint8Array;
}
export interface PngEncodeOptions {
    deflateLevel?: number;
    filterType?: number | number[];
}
export interface PngDecodeOptions {
    checkCRC?: boolean;
}
export interface PngEncodeResult {
    buffer: Buffer;
    base64: string;
    width: number;
    height: number;
}
/**
 * Encodes an RGBA byte buffer to a PNG Buffer synchronously.
 */
export declare function encodeRgbaToPngBuffer(rgbaData: Uint8Array | Buffer, width: number, height: number, options?: PngEncodeOptions): Buffer;
/**
 * Encodes an RGBA byte buffer to a PNG Buffer and Base64 string synchronously.
 */
export declare function encodeRgbaToPngBase64(rgbaData: Uint8Array | Buffer, width: number, height: number, options?: PngEncodeOptions): PngEncodeResult;
/**
 * Decodes a PNG Buffer synchronously into RGBA ImageBuffer.
 */
export declare function decodePngBufferSync(buffer: Buffer | Uint8Array, options?: PngDecodeOptions): ImageBuffer;
/**
 * Decodes a Base64-encoded PNG string synchronously.
 * Automatically cleans data URI headers and whitespace.
 */
export declare function decodePngBase64Sync(base64: string, options?: PngDecodeOptions): ImageBuffer;
/**
 * Asynchronously encodes an RGBA buffer to PNG Base64 and Buffer.
 */
export declare function encodeRgbaToPngAsync(rgbaData: Uint8Array | Buffer, width: number, height: number, options?: PngEncodeOptions): Promise<PngEncodeResult>;
/**
 * Asynchronously decodes a PNG Buffer or Base64 string.
 */
export declare function decodePngAsync(input: Buffer | Uint8Array | string, options?: PngDecodeOptions): Promise<ImageBuffer>;
//# sourceMappingURL=png.d.ts.map