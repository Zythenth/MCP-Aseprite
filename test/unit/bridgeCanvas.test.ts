import { describe, expect, it } from "vitest";
import { bridgeCanvasPngBase64, bridgePreviewPngBase64, decodeBridgeCanvas } from "../../src/image/bridgeCanvas.js";
import { decodePngBase64Sync, encodeRgbaToPngBase64 } from "../../src/image/png.js";

describe("bridge canvas image conversion", () => {
  it("converts an in-memory RGBA bridge response into an exact PNG", () => {
    const rgba = Uint8Array.from([
      255, 0, 0, 255,
      0, 128, 255, 64,
    ]);
    const payload = {
      width: 2,
      height: 1,
      pngBase64: "",
      rgbaBase64: Buffer.from(rgba).toString("base64"),
    };

    expect(Array.from(decodeBridgeCanvas(payload).data)).toEqual(Array.from(rgba));
    const png = decodePngBase64Sync(bridgeCanvasPngBase64(payload));
    expect({ width: png.width, height: png.height, data: Array.from(png.data) }).toEqual({
      width: 2,
      height: 1,
      data: Array.from(rgba),
    });
  });

  it("rejects malformed or incorrectly sized RGBA responses", () => {
    expect(() => decodeBridgeCanvas({ width: 1, height: 1, rgbaBase64: "%%%=" })).toThrow(/Invalid RGBA base64/i);
    expect(() => decodeBridgeCanvas({
      width: 2,
      height: 1,
      rgbaBase64: Buffer.from([1, 2, 3, 4]).toString("base64"),
    })).toThrow(/expected 8 bytes.*received 4/i);
  });

  it("keeps compatibility with a valid legacy PNG response", () => {
    const pngBase64 = encodeRgbaToPngBase64(Uint8Array.from([1, 2, 3, 255]), 1, 1).base64;
    expect(Array.from(decodeBridgeCanvas({ width: 1, height: 1, pngBase64 }).data)).toEqual([1, 2, 3, 255]);
  });

  it("encodes nested in-memory mutation previews without a temporary PNG", () => {
    const result = bridgePreviewPngBase64({
      preview: {
        width: 1,
        height: 1,
        rgbaBase64: Buffer.from([12, 34, 56, 255]).toString("base64"),
      },
    });
    expect(result).toBeTypeOf("string");
    expect(Array.from(decodePngBase64Sync(result!).data)).toEqual([12, 34, 56, 255]);
  });
});
