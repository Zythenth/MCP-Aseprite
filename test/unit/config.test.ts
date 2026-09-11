import { describe, it, expect } from "vitest";
import {
  config,
  DEFAULT_PORT,
  DEFAULT_HOST,
  MIN_SCALE,
  MAX_SCALE,
  GRID_MIN_SCALE,
} from "../../src/config.js";

describe("Config Constants & Sanitization Tests", () => {
  it("should define valid network loopback defaults", () => {
    expect(config.port).toBe(DEFAULT_PORT);
    expect(config.host).toBe(DEFAULT_HOST);
    expect(config.host).toBe("127.0.0.1");
  });

  it("should enforce valid scale boundaries", () => {
    expect(config.defaultScale).toBe(8);
    expect(config.minScale).toBe(MIN_SCALE);
    expect(config.maxScale).toBe(MAX_SCALE);
    expect(config.gridMinScale).toBe(GRID_MIN_SCALE);
    expect(config.minScale).toBeLessThanOrEqual(config.defaultScale);
    expect(config.defaultScale).toBeLessThanOrEqual(config.maxScale);
  });

  it("should define valid MCP server identity metadata", () => {
    expect(config.serverName).toBe("aseprite-mcp");
    expect(config.serverVersion).toBe("0.1.0");
    expect(config.protocolVersion).toBe("2024-11-05");
  });
});