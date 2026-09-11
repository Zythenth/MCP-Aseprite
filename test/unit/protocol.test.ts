import { describe, it, expect } from "vitest";
import {
  BridgeErrorCode,
  BridgeError,
  isBridgeResponseMessage,
  isBridgeEventMessage,
  DEFAULT_BRIDGE_PORT,
  DEFAULT_BRIDGE_HOST,
} from "../../src/bridge/protocol.js";

describe("Protocol Unit Tests", () => {
  it("should define valid constants and error codes", () => {
    expect(DEFAULT_BRIDGE_PORT).toBe(32123);
    expect(DEFAULT_BRIDGE_HOST).toBe("127.0.0.1");
    expect(BridgeErrorCode.DISCONNECTED).toBe("DISCONNECTED");
    expect(BridgeErrorCode.TIMEOUT).toBe("TIMEOUT");
    expect(BridgeErrorCode.NO_ACTIVE_SPRITE).toBe("NO_ACTIVE_SPRITE");
  });

  it("should correctly identify BridgeResponseMessage", () => {
    const validResponse = {
      id: "req_123",
      success: true,
      result: { data: "ok" },
    };
    expect(isBridgeResponseMessage(validResponse)).toBe(true);

    const errorResponse = {
      id: "req_124",
      success: false,
      error: { code: "ERROR", message: "Failed" },
    };
    expect(isBridgeResponseMessage(errorResponse)).toBe(true);

    expect(isBridgeResponseMessage(null)).toBe(false);
    expect(isBridgeResponseMessage({ id: "req_125" })).toBe(false);
    expect(isBridgeResponseMessage({ success: true })).toBe(false);
  });

  it("should correctly identify BridgeEventMessage", () => {
    const validEvent = {
      event: "revision_changed",
      data: { revision: 2 },
    };
    expect(isBridgeEventMessage(validEvent)).toBe(true);
    expect(isBridgeEventMessage(null)).toBe(false);
    expect(isBridgeEventMessage({})).toBe(false);
  });

  it("should create BridgeError with proper code and inheritance", () => {
    const err = new BridgeError("Custom error", BridgeErrorCode.TIMEOUT, { timeoutMs: 5000 });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(BridgeError);
    expect(err.name).toBe("BridgeError");
    expect(err.message).toBe("Custom error");
    expect(err.code).toBe("TIMEOUT");
    expect(err.details).toEqual({ timeoutMs: 5000 });
  });
});