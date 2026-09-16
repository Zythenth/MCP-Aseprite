import { describe, it, expect, afterEach } from "vitest";
import {
  config,
  DEFAULT_PORT,
  DEFAULT_HOST,
  MIN_SCALE,
  MAX_SCALE,
  GRID_MIN_SCALE,
  parseBridgeToken,
  parsePort,
  parseCommandTimeout,
  MIN_PORT,
  MAX_PORT,
  MIN_COMMAND_TIMEOUT_MS,
  MAX_COMMAND_TIMEOUT_MS,
  DEFAULT_COMMAND_TIMEOUT_MS,
  resolvePortEnv,
  BRIDGE_PROTOCOL_VERSION,
  parseBooleanEnv,
  parseToolsets,
  TOOLSETS,
  isPrivateIpv4,
  parseBridgeHost,
  parseRemotePeers,
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

  it("should define valid bridge protocol version", () => {
    expect(BRIDGE_PROTOCOL_VERSION).toBe("1.2.0");
    expect(config.bridgeProtocolVersion).toBe(BRIDGE_PROTOCOL_VERSION);
    expect(config.bridgeProtocolVersion).not.toBe(config.protocolVersion);
  });

  describe("parseBridgeToken", () => {
    it("returns undefined when token is undefined, empty string, or whitespace", () => {
      expect(parseBridgeToken(undefined)).toBeUndefined();
      expect(parseBridgeToken("")).toBeUndefined();
      expect(parseBridgeToken("   ")).toBeUndefined();
      expect(parseBridgeToken("\t\n")).toBeUndefined();
    });

    it("accepts valid tokens at boundary lengths 16 and 128", () => {
      const token16 = "A".repeat(16);
      expect(parseBridgeToken(token16)).toBe(token16);

      const token128 = "B".repeat(128);
      expect(parseBridgeToken(token128)).toBe(token128);
    });

    it("trims whitespace and accepts valid URL-safe charset [A-Za-z0-9._~-]", () => {
      const validToken = "  Valid_Token.123-abc~xyz  ";
      expect(parseBridgeToken(validToken)).toBe("Valid_Token.123-abc~xyz");
    });

    it("rejects tokens shorter than 16 characters", () => {
      expect(() => parseBridgeToken("short-token")).toThrow(
        /length must be between 16 and 128/i
      );
      expect(() => parseBridgeToken("123456789012345")).toThrow(
        /length must be between 16 and 128/i
      );
    });

    it("rejects tokens longer than 128 characters", () => {
      const tooLong = "A".repeat(129);
      expect(() => parseBridgeToken(tooLong)).toThrow(
        /length must be between 16 and 128/i
      );
    });

    it("rejects tokens with non-URL-safe characters", () => {
      expect(() => parseBridgeToken("token_with real_space_12345")).toThrow(/URL-safe characters/i);
      expect(() => parseBridgeToken("token_with_@_character_12345")).toThrow(/URL-safe characters/i);
      expect(() => parseBridgeToken("token_with_/_slash_12345678")).toThrow(/URL-safe characters/i);
      expect(() => parseBridgeToken("token_with_#_hash_123456789")).toThrow(/URL-safe characters/i);
      expect(() => parseBridgeToken("token_with_!_excl_123456789")).toThrow(/URL-safe characters/i);
    });
  });

  describe("tool exposure configuration", () => {
    it("parses strict boolean environment values", () => {
      expect(parseBooleanEnv("TEST", undefined)).toBe(false);
      expect(parseBooleanEnv("TEST", " yes ")).toBe(true);
      expect(parseBooleanEnv("TEST", "OFF", true)).toBe(false);
      expect(() => parseBooleanEnv("TEST", "sometimes")).toThrow(/Invalid TEST/);
    });

    it("enables all toolsets by default and validates explicit lists", () => {
      expect(parseToolsets(undefined)).toEqual([...TOOLSETS]);
      expect(parseToolsets("all")).toEqual([...TOOLSETS]);
      expect(parseToolsets("visual,pixel-art")).toEqual(["core", "visual", "pixel-art"]);
      expect(parseToolsets("visual,visual")).toEqual(["core", "visual"]);
      expect(() => parseToolsets("visual,unknown")).toThrow(/unknown/);
    });
  });

  describe("private remote bridge configuration", () => {
    const token = "a".repeat(32);

    it("allows only explicit private hosts with a strong token", () => {
      expect(isPrivateIpv4("10.10.0.4")).toBe(true);
      expect(isPrivateIpv4("172.31.255.254")).toBe(true);
      expect(isPrivateIpv4("192.168.1.7")).toBe(true);
      expect(isPrivateIpv4("172.32.0.1")).toBe(false);
      expect(isPrivateIpv4("0.0.0.0")).toBe(false);
      expect(isPrivateIpv4("8.8.8.8")).toBe(false);
      expect(parseBridgeHost("192.168.1.7", true, token)).toBe("192.168.1.7");
      expect(() => parseBridgeHost("192.168.1.7", false, token)).toThrow(/REMOTE_MODE/);
      expect(() => parseBridgeHost("8.8.8.8", true, token)).toThrow(/private IPv4/);
      expect(() => parseBridgeHost("10.0.0.2", true, "a".repeat(31))).toThrow(/32 characters/);
    });

    it("requires an explicit private allowlist in remote mode", () => {
      expect(parseRemotePeers("10.0.0.5, 192.168.1.8", true)).toEqual(["10.0.0.5", "192.168.1.8"]);
      expect(() => parseRemotePeers(undefined, true)).toThrow(/REMOTE_PEERS/);
      expect(() => parseRemotePeers("8.8.8.8", true)).toThrow(/private IPv4/);
    });
  });

  describe("parsePort", () => {
    it("returns defaultVal when port is undefined, empty string, or whitespace", () => {
      expect(parsePort(undefined)).toBe(DEFAULT_PORT);
      expect(parsePort("")).toBe(DEFAULT_PORT);
      expect(parsePort("   ")).toBe(DEFAULT_PORT);
      expect(parsePort(undefined, 8080)).toBe(8080);
      expect(parsePort("", 9090)).toBe(9090);
      expect(parsePort("  \t\n  ", 9090)).toBe(9090);
    });

    it("parses valid base-10 integer ports within 1024..65535, including boundaries", () => {
      expect(parsePort("1024")).toBe(1024);
      expect(parsePort("65535")).toBe(65535);
      expect(parsePort("32123")).toBe(32123);
      expect(parsePort(" 40000 ")).toBe(40000);
      expect(parsePort(String(MIN_PORT))).toBe(MIN_PORT);
      expect(parsePort(String(MAX_PORT))).toBe(MAX_PORT);
    });

    it("rejects malformed strings with non-numeric suffixes or invalid format (fail-fast)", () => {
      expect(() => parsePort("32123junk")).toThrow(/base-10 integer/i);
      expect(() => parsePort("32123 junk")).toThrow(/base-10 integer/i);
      expect(() => parsePort("abc")).toThrow(/base-10 integer/i);
      expect(() => parsePort("32.12")).toThrow(/base-10 integer/i);
      expect(() => parsePort("0x10")).toThrow(/base-10 integer/i);
      expect(() => parsePort("-1024")).toThrow(/base-10 integer/i);
      expect(() => parsePort("+32123")).toThrow(/base-10 integer/i);
    });

    it("rejects ports below 1024 and above 65535 with actionable error", () => {
      expect(() => parsePort("0")).toThrow(/between 1024 and 65535/i);
      expect(() => parsePort("80")).toThrow(/between 1024 and 65535/i);
      expect(() => parsePort("1023")).toThrow(/between 1024 and 65535/i);
      expect(() => parsePort("65536")).toThrow(/between 1024 and 65535/i);
      expect(() => parsePort("70000")).toThrow(/between 1024 and 65535/i);
    });
  });

  describe("parseCommandTimeout", () => {
    it("returns defaultVal when timeout is undefined, empty string, or whitespace", () => {
      expect(parseCommandTimeout(undefined)).toBe(DEFAULT_COMMAND_TIMEOUT_MS);
      expect(parseCommandTimeout("")).toBe(DEFAULT_COMMAND_TIMEOUT_MS);
      expect(parseCommandTimeout("   ")).toBe(DEFAULT_COMMAND_TIMEOUT_MS);
      expect(parseCommandTimeout(undefined, 5000)).toBe(5000);
      expect(parseCommandTimeout("", 5000)).toBe(5000);
      expect(parseCommandTimeout("  \n  ", 5000)).toBe(5000);
    });

    it("parses valid durations in bounded range MIN_COMMAND_TIMEOUT_MS..MAX_COMMAND_TIMEOUT_MS", () => {
      expect(parseCommandTimeout("100")).toBe(100);
      expect(parseCommandTimeout("8000")).toBe(8000);
      expect(parseCommandTimeout("15000")).toBe(15000);
      expect(parseCommandTimeout("300000")).toBe(300000);
      expect(parseCommandTimeout(" 12000 ")).toBe(12000);
      expect(parseCommandTimeout(String(MIN_COMMAND_TIMEOUT_MS))).toBe(MIN_COMMAND_TIMEOUT_MS);
      expect(parseCommandTimeout(String(MAX_COMMAND_TIMEOUT_MS))).toBe(MAX_COMMAND_TIMEOUT_MS);
    });

    it("rejects malformed strings with non-numeric suffixes or invalid format (fail-fast)", () => {
      expect(() => parseCommandTimeout("8000junk")).toThrow(/positive base-10 integer duration/i);
      expect(() => parseCommandTimeout("8000ms")).toThrow(/positive base-10 integer duration/i);
      expect(() => parseCommandTimeout("abc")).toThrow(/positive base-10 integer duration/i);
      expect(() => parseCommandTimeout("3.14")).toThrow(/positive base-10 integer duration/i);
      expect(() => parseCommandTimeout("-100")).toThrow(/positive base-10 integer duration/i);
      expect(() => parseCommandTimeout("+8000")).toThrow(/positive base-10 integer duration/i);
    });

    it("rejects durations below MIN_COMMAND_TIMEOUT_MS and above MAX_COMMAND_TIMEOUT_MS", () => {
      expect(() => parseCommandTimeout("0")).toThrow(/between 100 and 300000 ms/i);
      expect(() => parseCommandTimeout("99")).toThrow(/between 100 and 300000 ms/i);
      expect(() => parseCommandTimeout("300001")).toThrow(/between 100 and 300000 ms/i);
      expect(() => parseCommandTimeout("1000000")).toThrow(/between 100 and 300000 ms/i);
    });
  });

  describe("resolvePortEnv", () => {
    const origPort = process.env.ASEPRITE_PORT;
    const origWsPort = process.env.ASEPRITE_WS_PORT;

    afterEach(() => {
      if (origPort !== undefined) {
        process.env.ASEPRITE_PORT = origPort;
      } else {
        delete process.env.ASEPRITE_PORT;
      }
      if (origWsPort !== undefined) {
        process.env.ASEPRITE_WS_PORT = origWsPort;
      } else {
        delete process.env.ASEPRITE_WS_PORT;
      }
    });

    it("prefers ASEPRITE_PORT when defined and non-empty", () => {
      process.env.ASEPRITE_PORT = "32123";
      process.env.ASEPRITE_WS_PORT = "40000";
      expect(resolvePortEnv()).toBe("32123");
    });

    it("falls back to ASEPRITE_WS_PORT when ASEPRITE_PORT is absent or blank", () => {
      delete process.env.ASEPRITE_PORT;
      process.env.ASEPRITE_WS_PORT = "40000";
      expect(resolvePortEnv()).toBe("40000");

      process.env.ASEPRITE_PORT = "   ";
      expect(resolvePortEnv()).toBe("40000");
    });

    it("returns undefined when both variables are unset", () => {
      delete process.env.ASEPRITE_PORT;
      delete process.env.ASEPRITE_WS_PORT;
      expect(resolvePortEnv()).toBeUndefined();
    });
  });
});
