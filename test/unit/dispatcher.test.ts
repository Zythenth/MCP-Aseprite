import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WebSocket } from "ws";
import { CommandDispatcher } from "../../src/bridge/dispatcher.js";
import { BridgeErrorCode, BridgeError } from "../../src/bridge/protocol.js";

describe("CommandDispatcher Unit Tests", () => {
  let dispatcher: CommandDispatcher;

  beforeEach(() => {
    dispatcher = new CommandDispatcher();
  });

  afterEach(() => {
    dispatcher.clearActiveSocket("Test teardown");
  });

  it("should generate unique sequential request IDs", () => {
    const id1 = dispatcher.generateId();
    const id2 = dispatcher.generateId();
    expect(id1).toMatch(/^req_\d+_\d+_[a-z0-9]+$/);
    expect(id2).toMatch(/^req_\d+_\d+_[a-z0-9]+$/);
    expect(id1).not.toBe(id2);
  });

  it("should reject send() when not connected", async () => {
    expect(dispatcher.isConnected()).toBe(false);
    await expect(dispatcher.send("test_cmd", {})).rejects.toThrow(
      "Aseprite is not connected via WebSocket bridge"
    );
  });

  it("should correlate response by ID and resolve payload", async () => {
    const mockSocket = {
      readyState: WebSocket.OPEN,
      send: vi.fn(),
    } as unknown as WebSocket;

    dispatcher.setActiveSocket(mockSocket);
    expect(dispatcher.isConnected()).toBe(true);

    const promise = dispatcher.send<{ val: string }>("echo", { foo: "bar" });
    expect(dispatcher.getPendingCount()).toBe(1);

    const sentPayload = JSON.parse((mockSocket.send as any).mock.calls[0][0]);
    expect(sentPayload.command).toBe("echo");
    expect(sentPayload.params).toEqual({ foo: "bar" });

    dispatcher.handleIncomingMessage(
      JSON.stringify({
        id: sentPayload.id,
        success: true,
        result: { val: "success_result" },
      })
    );

    const result = await promise;
    expect(result).toEqual({ val: "success_result" });
    expect(dispatcher.getPendingCount()).toBe(0);
  });

  it("should reject send() when bridge returns error envelope", async () => {
    const mockSocket = {
      readyState: WebSocket.OPEN,
      send: vi.fn(),
    } as unknown as WebSocket;

    dispatcher.setActiveSocket(mockSocket);
    const promise = dispatcher.send("fail_cmd", {});

    const sentPayload = JSON.parse((mockSocket.send as any).mock.calls[0][0]);
    dispatcher.handleIncomingMessage(
      JSON.stringify({
        id: sentPayload.id,
        success: false,
        error: {
          code: BridgeErrorCode.OUT_OF_BOUNDS,
          message: "Coordinates out of bounds",
        },
      })
    );

    await expect(promise).rejects.toThrow("Coordinates out of bounds");
    expect(dispatcher.getPendingCount()).toBe(0);
  });

  it("should abort pending commands immediately upon clearActiveSocket", async () => {
    const mockSocket = {
      readyState: WebSocket.OPEN,
      send: vi.fn(),
    } as unknown as WebSocket;

    dispatcher.setActiveSocket(mockSocket);
    const p1 = dispatcher.send("cmd1", {}, 10000);
    const p2 = dispatcher.send("cmd2", {}, 10000);
    expect(dispatcher.getPendingCount()).toBe(2);

    dispatcher.clearActiveSocket("Client replaced by new incoming connection");
    expect(dispatcher.getPendingCount()).toBe(0);
    expect(dispatcher.isConnected()).toBe(false);

    await expect(p1).rejects.toThrow(/Client replaced/);
    await expect(p2).rejects.toThrow(/Client replaced/);
  });

  it("should safely handle unsolicited event 'error' without throwing when no error listener is attached", () => {
    expect(dispatcher.listenerCount("error")).toBe(0);

    let bridgeEventFired = false;
    let receivedPayload: any = null;

    dispatcher.on("bridge_event", (payload) => {
      bridgeEventFired = true;
      receivedPayload = payload;
    });

    expect(() => {
      dispatcher.handleIncomingMessage(
        JSON.stringify({
          event: "error",
          data: { reason: "test error", code: "LUA_ERR" },
        })
      );
    }).not.toThrow();

    expect(bridgeEventFired).toBe(true);
    expect(receivedPayload).toEqual({
      event: "error",
      data: { reason: "test error", code: "LUA_ERR" },
    });
  });

  it("should forward unsolicited event 'error' to listener when attached", () => {
    let handledError: any = null;
    const errorHandler = (err: any) => {
      handledError = err;
    };

    dispatcher.on("error", errorHandler);
    dispatcher.handleIncomingMessage(
      JSON.stringify({
        event: "error",
        data: { reason: "handled error payload" },
      })
    );

    expect(handledError).toEqual({ reason: "handled error payload" });
    dispatcher.off("error", errorHandler);
  });

  it("should safely ignore malformed non-JSON messages", () => {
    expect(() => {
      dispatcher.handleIncomingMessage("NOT_VALID_JSON{{{");
      dispatcher.handleIncomingMessage("");
    }).not.toThrow();
  });

  it("should accept up to 128 pending commands and reject the 129th with INVALID_PARAMS without dangling timers or entries", async () => {
    const mockSocket = {
      readyState: WebSocket.OPEN,
      send: vi.fn(),
    } as unknown as WebSocket;
    dispatcher.setActiveSocket(mockSocket);

    const promises: Promise<any>[] = [];
    const errors: any[] = [];
    try {
      for (let i = 0; i < 128; i++) {
        const p = dispatcher.send("hang_cmd", { i });
        p.catch((err) => errors.push(err));
        promises.push(p);
      }
      expect(dispatcher.getPendingCount()).toBe(128);

      await expect(dispatcher.send("overflow_cmd", {})).rejects.toMatchObject({
        code: BridgeErrorCode.INVALID_PARAMS,
        message: expect.stringContaining("Maximum pending bridge requests reached (128)"),
      });

      expect(dispatcher.getPendingCount()).toBe(128);
    } finally {
      dispatcher.clearActiveSocket("Test completion cleanup");
      await Promise.allSettled(promises);
      expect(errors).toHaveLength(128);
      for (const err of errors) {
        expect(err).toBeInstanceOf(BridgeError);
        expect(err.code).toBe(BridgeErrorCode.DISCONNECTED);
      }
      expect(dispatcher.getPendingCount()).toBe(0);
    }
  });

  it("should reject oversized outgoing request exceeding maxPayloadBytes immediately with INVALID_PARAMS", async () => {
    const customDispatcher = new CommandDispatcher({ maxPayloadBytes: 256 });
    const mockSocket = {
      readyState: WebSocket.OPEN,
      send: vi.fn(),
    } as unknown as WebSocket;
    customDispatcher.setActiveSocket(mockSocket);

    const oversizedData = "X".repeat(300);
    await expect(customDispatcher.send("large_cmd", { data: oversizedData })).rejects.toMatchObject({
      code: BridgeErrorCode.INVALID_PARAMS,
      message: expect.stringContaining("Request payload exceeds maximum allowed size"),
    });

    expect(customDispatcher.getPendingCount()).toBe(0);
  });
});
