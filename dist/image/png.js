// src/image/png.ts
import { PNG } from "pngjs";
export class ImagePipelineError extends Error {
    constructor(message) {
        super(message);
        this.name = "ImagePipelineError";
    }
}
export class InvalidDimensionError extends ImagePipelineError {
    constructor(width, height) {
        super(`Invalid dimensions: ${width}x${height}. Width and height must be positive integers.`);
        this.name = "InvalidDimensionError";
    }
}
export class BufferSizeMismatchError extends ImagePipelineError {
    constructor(expected, actual) {
        super(`Buffer size mismatch: expected ${expected} bytes (width * height * 4), but received ${actual} bytes.`);
        this.name = "BufferSizeMismatchError";
    }
}
export class PngDecodeError extends ImagePipelineError {
    constructor(cause) {
        super(`Failed to decode PNG: ${cause instanceof Error ? cause.message : String(cause)}`);
        this.name = "PngDecodeError";
    }
}
/**
 * Validates dimensions and buffer byte length.
 */
function validateRgbaBuffer(rgbaData, width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
        throw new InvalidDimensionError(width, height);
    }
    const expectedBytes = width * height * 4;
    if (rgbaData.length < expectedBytes) {
        throw new BufferSizeMismatchError(expectedBytes, rgbaData.length);
    }
}
/**
 * Encodes an RGBA byte buffer to a PNG Buffer synchronously.
 */
export function encodeRgbaToPngBuffer(rgbaData, width, height, options = {}) {
    validateRgbaBuffer(rgbaData, width, height);
    const pngOpts = {
        width,
        height,
        deflateLevel: options.deflateLevel ?? 1,
    };
    if (options.filterType !== undefined) {
        pngOpts.filterType = options.filterType;
    }
    const png = new PNG(pngOpts);
    // Fast memory copy without byte-by-byte JavaScript loop
    png.data.set(rgbaData.subarray(0, width * height * 4));
    const writeOpts = {
        deflateLevel: options.deflateLevel ?? 1,
    };
    if (options.filterType !== undefined) {
        writeOpts.filterType = options.filterType;
    }
    return PNG.sync.write(png, writeOpts);
}
/**
 * Encodes an RGBA byte buffer to a PNG Buffer and Base64 string synchronously.
 */
export function encodeRgbaToPngBase64(rgbaData, width, height, options = {}) {
    const buffer = encodeRgbaToPngBuffer(rgbaData, width, height, options);
    return {
        buffer,
        base64: buffer.toString("base64"),
        width,
        height,
    };
}
/**
 * Decodes a PNG Buffer synchronously into RGBA ImageBuffer.
 */
export function decodePngBufferSync(buffer, options = {}) {
    try {
        const nodeBuf = Buffer.isBuffer(buffer)
            ? buffer
            : Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        const png = PNG.sync.read(nodeBuf, options);
        return {
            width: png.width,
            height: png.height,
            data: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength),
        };
    }
    catch (err) {
        throw new PngDecodeError(err);
    }
}
/**
 * Decodes a Base64-encoded PNG string synchronously.
 * Automatically cleans data URI headers and whitespace.
 */
export function decodePngBase64Sync(base64, options = {}) {
    if (!base64 || typeof base64 !== "string") {
        throw new PngDecodeError("Invalid or empty base64 string provided.");
    }
    const cleanBase64 = base64.replace(/^data:image\/png;base64,/, "").trim();
    const buffer = Buffer.from(cleanBase64, "base64");
    if (buffer.length === 0) {
        throw new PngDecodeError("Base64 string resolved to empty buffer.");
    }
    return decodePngBufferSync(buffer, options);
}
/**
 * Asynchronously encodes an RGBA buffer to PNG Base64 and Buffer.
 */
export async function encodeRgbaToPngAsync(rgbaData, width, height, options = {}) {
    validateRgbaBuffer(rgbaData, width, height);
    return new Promise((resolve, reject) => {
        const pngOpts = {
            width,
            height,
            deflateLevel: options.deflateLevel ?? 1,
        };
        if (options.filterType !== undefined) {
            pngOpts.filterType = options.filterType;
        }
        const png = new PNG(pngOpts);
        png.data.set(rgbaData.subarray(0, width * height * 4));
        const chunks = [];
        const stream = png.pack();
        stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        stream.on("end", () => {
            const buffer = Buffer.concat(chunks);
            resolve({
                buffer,
                base64: buffer.toString("base64"),
                width,
                height,
            });
        });
        stream.on("error", (err) => reject(new ImagePipelineError(err.message)));
    });
}
/**
 * Asynchronously decodes a PNG Buffer or Base64 string.
 */
export async function decodePngAsync(input, options = {}) {
    let buf;
    if (typeof input === "string") {
        const clean = input.replace(/^data:image\/png;base64,/, "").trim();
        buf = Buffer.from(clean, "base64");
    }
    else if (Buffer.isBuffer(input)) {
        buf = input;
    }
    else {
        buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
    }
    return new Promise((resolve, reject) => {
        new PNG(options).parse(buf, (err, parsed) => {
            if (err) {
                reject(new PngDecodeError(err));
            }
            else {
                resolve({
                    width: parsed.width,
                    height: parsed.height,
                    data: new Uint8Array(parsed.data.buffer, parsed.data.byteOffset, parsed.data.byteLength),
                });
            }
        });
    });
}
//# sourceMappingURL=png.js.map