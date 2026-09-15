import {
  BufferSizeMismatchError,
  ImagePipelineError,
  InvalidDimensionError,
  decodePngBase64Sync,
  encodeRgbaToPngBase64,
  type ImageBuffer,
} from "./png.js";

export interface BridgeCanvasPayload {
  width: number;
  height: number;
  pngBase64?: string;
  rgbaBase64?: string;
}

export interface BridgePreviewPayload {
  preview?: BridgeCanvasPayload;
  width?: number;
  height?: number;
  pngBase64?: string;
  rgbaBase64?: string;
}

function decodeBase64Strict(value: string): Buffer {
  const clean = value.replace(/\s+/g, "");
  if (
    clean.length === 0 ||
    clean.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(clean)
  ) {
    throw new ImagePipelineError("Invalid RGBA base64 data returned from Aseprite bridge.");
  }
  return Buffer.from(clean, "base64");
}

export function decodeBridgeCanvas(payload: BridgeCanvasPayload): ImageBuffer {
  if (typeof payload.rgbaBase64 === "string" && payload.rgbaBase64.trim().length > 0) {
    const { width, height } = payload;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
      throw new InvalidDimensionError(width, height);
    }
    const rgba = decodeBase64Strict(payload.rgbaBase64);
    const expected = width * height * 4;
    if (!Number.isSafeInteger(expected) || rgba.length !== expected) {
      throw new BufferSizeMismatchError(expected, rgba.length);
    }
    return {
      width,
      height,
      data: new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength),
    };
  }

  if (typeof payload.pngBase64 === "string" && payload.pngBase64.trim().length > 0) {
    return decodePngBase64Sync(payload.pngBase64);
  }

  throw new ImagePipelineError("Aseprite bridge returned neither RGBA data nor PNG data for the canvas.");
}

export function bridgeCanvasPngBase64(payload: BridgeCanvasPayload): string {
  if (
    typeof payload.pngBase64 === "string" &&
    payload.pngBase64.trim().length > 0 &&
    !(typeof payload.rgbaBase64 === "string" && payload.rgbaBase64.trim().length > 0)
  ) {
    decodePngBase64Sync(payload.pngBase64);
    return payload.pngBase64;
  }
  const image = decodeBridgeCanvas(payload);
  return encodeRgbaToPngBase64(image.data, image.width, image.height).base64;
}

export function bridgePreviewPngBase64(payload: BridgePreviewPayload): string | undefined {
  const preview = payload.preview ?? payload;
  const hasImage =
    (typeof preview.pngBase64 === "string" && preview.pngBase64.trim().length > 0) ||
    (typeof preview.rgbaBase64 === "string" && preview.rgbaBase64.trim().length > 0);
  if (!hasImage) return undefined;
  return bridgeCanvasPngBase64(preview as BridgeCanvasPayload);
}
