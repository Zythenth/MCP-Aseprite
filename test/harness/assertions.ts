/**
 * Custom Assertion Helpers for MCP Tools and Visual Pixel Art Payloads.
 */

import { expect } from "vitest";
import type { ToolCallResult, ImageContent, TextContent, Bounds, PixelGridResult } from "./types.js";

/**
 * Standard 8-byte PNG header magic bytes:
 * 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A ("\x89PNG\r\n\x1a\n")
 */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Normalizes hex color string to uppercase 8-character "#RRGGBBAA" format.
 */
export function normalizeHex(color: string): string {
  let hex = color.trim().toUpperCase();
  if (hex.startsWith("#")) {
    hex = hex.slice(1);
  }

  // 3-char #RGB -> RRGGBBFF
  if (hex.length === 3) {
    hex = `${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}FF`;
  }
  // 4-char #RGBA -> RRGGBBAA
  else if (hex.length === 4) {
    hex = `${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  // 6-char #RRGGBB -> RRGGBBFF
  else if (hex.length === 6) {
    hex = `${hex}FF`;
  }
  // 8-char #RRGGBBAA
  else if (hex.length === 8) {
    // already 8 chars
  } else {
    throw new Error(`Invalid hex color string length: #${hex}`);
  }

  return `#${hex}`;
}

/**
 * Asserts that the tool call returned a successful response without error flags.
 */
export function assertToolSuccess(result: ToolCallResult): void {
  expect(result).toBeDefined();
  expect(result.isError).toBeFalsy();
  expect(Array.isArray(result.content)).toBe(true);
  expect(result.content.length).toBeGreaterThan(0);
}

/**
 * Asserts that the tool call resulted in an error, optionally checking code and message.
 */
export function assertToolError(
  result: ToolCallResult,
  expectedCode?: string,
  messageSubstring?: string
): { code?: string; message?: string } {
  expect(result).toBeDefined();
  expect(result.isError).toBe(true);
  expect(Array.isArray(result.content)).toBe(true);
  expect(result.content.length).toBeGreaterThan(0);

  const textItem = result.content.find((c): c is TextContent => c.type === "text");
  expect(textItem).toBeDefined();

  let parsed: { code?: string; message?: string } = {};
  try {
    parsed = JSON.parse(textItem!.text);
  } catch {
    parsed = { message: textItem!.text };
  }

  if (expectedCode) {
    expect(parsed.code).toBe(expectedCode);
  }

  if (messageSubstring) {
    const msg = parsed.message || textItem!.text;
    expect(msg.toLowerCase()).toContain(messageSubstring.toLowerCase());
  }

  return parsed;
}

/**
 * Extracts and parses JSON or raw text from the first text content item.
 */
export function extractTextContent<T = any>(result: ToolCallResult): T {
  const textItem = result.content.find((c): c is TextContent => c.type === "text");
  if (!textItem) {
    throw new Error("No text content found in ToolCallResult");
  }
  try {
    return JSON.parse(textItem.text) as T;
  } catch {
    return textItem.text as unknown as T;
  }
}

/**
 * Extracts the image content item, verifies PNG mimeType, and decodes the buffer.
 */
export function extractImageContent(result: ToolCallResult): {
  base64: string;
  mimeType: string;
  buffer: Buffer;
} {
  const imageItem = result.content.find((c): c is ImageContent => c.type === "image");
  if (!imageItem) {
    throw new Error("No image content found in ToolCallResult");
  }

  expect(imageItem.mimeType).toBe("image/png");
  expect(typeof imageItem.data).toBe("string");
  expect(imageItem.data.length).toBeGreaterThan(0);

  const buffer = Buffer.from(imageItem.data, "base64");
  expect(buffer.length).toBeGreaterThan(8);

  // Validate standard PNG 8-byte magic header
  const header = buffer.subarray(0, 8);
  expect(header.equals(PNG_MAGIC)).toBe(true);

  return {
    base64: imageItem.data,
    mimeType: imageItem.mimeType,
    buffer,
  };
}

/**
 * Parses image width and height directly from the PNG IHDR chunk without external dependencies.
 * In a valid PNG, the IHDR chunk starts immediately after the 8-byte header.
 * Offset 12..15: 'IHDR'
 * Offset 16..19: width (4 bytes big-endian)
 * Offset 20..23: height (4 bytes big-endian)
 */
export function parsePngDimensions(pngBuffer: Buffer): { width: number; height: number } {
  if (pngBuffer.length < 24) {
    throw new Error("Buffer too short to contain valid PNG IHDR chunk");
  }
  const chunkType = pngBuffer.subarray(12, 16).toString("ascii");
  if (chunkType !== "IHDR") {
    throw new Error(`Expected IHDR chunk at offset 12, found '${chunkType}'`);
  }
  const width = pngBuffer.readUInt32BE(16);
  const height = pngBuffer.readUInt32BE(20);
  return { width, height };
}

/**
 * Validates that a specific pixel in the pixel grid matches the expected hex color.
 */
export function assertPixelInGrid(
  grid: PixelGridResult,
  x: number,
  y: number,
  expectedHex: string
): void {
  expect(grid).toBeDefined();
  expect(grid.pixels || grid.matrix).toBeDefined();

  const matrix = (grid.pixels || grid.matrix) as any[][];
  expect(matrix.length).toBeGreaterThan(y);
  expect(matrix[y].length).toBeGreaterThan(x);

  const rawVal = matrix[y][x];
  let actualHex: string;

  if (typeof rawVal === "string") {
    actualHex = normalizeHex(rawVal);
  } else if (typeof rawVal === "object" && rawVal !== null && "r" in rawVal) {
    const r = (rawVal.r & 0xff).toString(16).padStart(2, "0");
    const g = (rawVal.g & 0xff).toString(16).padStart(2, "0");
    const b = (rawVal.b & 0xff).toString(16).padStart(2, "0");
    const a = (rawVal.a & 0xff).toString(16).padStart(2, "0");
    actualHex = normalizeHex(`#${r}${g}${b}${a}`);
  } else if (typeof rawVal === "number" && grid.palette) {
    actualHex = normalizeHex(grid.palette[rawVal] || "#00000000");
  } else {
    throw new Error(`Unexpected pixel representation at (${x}, ${y}): ${JSON.stringify(rawVal)}`);
  }

  const normalizedExpected = normalizeHex(expectedHex);
  expect(actualHex).toBe(normalizedExpected);
}

/**
 * Validates that every pixel in a rectangular region matches the expected hex color.
 */
export function assertRectInGrid(
  grid: PixelGridResult,
  rect: Bounds,
  expectedHex: string
): void {
  for (let dy = 0; dy < rect.height; dy++) {
    for (let dx = 0; dx < rect.width; dx++) {
      assertPixelInGrid(grid, rect.x + dx, rect.y + dy, expectedHex);
    }
  }
}
