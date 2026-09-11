// src/image/png.ts
import { PNG } from "pngjs";

export class ImagePipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImagePipelineError";
  }
}

export class InvalidDimensionError extends ImagePipelineError {
  constructor(width: number, height: number) {
    super(`Invalid dimensions: ${width}x${height}. Width and height must be positive integers.`);
    this.name = "InvalidDimensionError";
  }
}

export class BufferSizeMismatchError extends ImagePipelineError {
  constructor(expected: number, actual: number) {
    super(`Buffer size mismatch: expected ${expected} bytes (width * height * 4), but received ${actual} bytes.`);
    this.name = "BufferSizeMismatchError";
  }
}

export class PngDecodeError extends ImagePipelineError {
  constructor(cause: unknown) {
    super(`Failed to decode PNG: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "PngDecodeError";
  }
}

export interface ImageBuffer {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface PngEncodeOptions {
  deflateLevel?: number; // 0 to 9. Default 1 for fast preview, 6 for standard
  filterType?: number | number[]; // 0=None, 1=Sub, 2=Up, 3=Average, 4=Paeth
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
 * Validates dimensions and buffer byte length.
 */
function validateRgbaBuffer(rgbaData: Uint8Array | Buffer, width: number, height: number): void {
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
export function encodeRgbaToPngBuffer(
  rgbaData: Uint8Array | Buffer,
  width: number,
  height: number,
  options: PngEncodeOptions = {}
): Buffer {
  validateRgbaBuffer(rgbaData, width, height);

  const pngOpts: { width: number; height: number; deflateLevel: number; filterType?: number | number[] } = {
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

  const writeOpts: { deflateLevel: number; filterType?: number | number[] } = {
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
export function encodeRgbaToPngBase64(
  rgbaData: Uint8Array | Buffer,
  width: number,
  height: number,
  options: PngEncodeOptions = {}
): PngEncodeResult {
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
export function decodePngBufferSync(
  buffer: Buffer | Uint8Array,
  options: PngDecodeOptions = {}
): ImageBuffer {
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
  } catch (err) {
    throw new PngDecodeError(err);
  }
}

/**
 * Decodes a Base64-encoded PNG string synchronously.
 * Automatically cleans data URI headers and whitespace.
 */
export function decodePngBase64Sync(
  base64: string,
  options: PngDecodeOptions = {}
): ImageBuffer {
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
export async function encodeRgbaToPngAsync(
  rgbaData: Uint8Array | Buffer,
  width: number,
  height: number,
  options: PngEncodeOptions = {}
): Promise<PngEncodeResult> {
  validateRgbaBuffer(rgbaData, width, height);

  return new Promise((resolve, reject) => {
    const pngOpts: { width: number; height: number; deflateLevel: number; filterType?: number | number[] } = {
      width,
      height,
      deflateLevel: options.deflateLevel ?? 1,
    };
    if (options.filterType !== undefined) {
      pngOpts.filterType = options.filterType;
    }
    const png = new PNG(pngOpts);
    png.data.set(rgbaData.subarray(0, width * height * 4));

    const chunks: Buffer[] = [];
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
export async function decodePngAsync(
  input: Buffer | Uint8Array | string,
  options: PngDecodeOptions = {}
): Promise<ImageBuffer> {
  let buf: Buffer;
  if (typeof input === "string") {
    const clean = input.replace(/^data:image\/png;base64,/, "").trim();
    buf = Buffer.from(clean, "base64");
  } else if (Buffer.isBuffer(input)) {
    buf = input;
  } else {
    buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  }

  return new Promise((resolve, reject) => {
    new PNG(options).parse(buf, (err, parsed) => {
      if (err) {
        reject(new PngDecodeError(err));
      } else {
        resolve({
          width: parsed.width,
          height: parsed.height,
          data: new Uint8Array(parsed.data.buffer, parsed.data.byteOffset, parsed.data.byteLength),
        });
      }
    });
  });
}
