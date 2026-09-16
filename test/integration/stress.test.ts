import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { BridgeWebSocketServer } from "../../src/bridge/wsServer.js";
import { CommandDispatcher } from "../../src/bridge/dispatcher.js";
import { BridgeState } from "../../src/bridge/state.js";
import { BRIDGE_PROTOCOL_VERSION, BridgeErrorCode, BridgeError } from "../../src/bridge/protocol.js";

describe("Milestone 1 Empirical Stress & Adversarial Test Suite", () => {
  let dispatcher: CommandDispatcher;
  let state: BridgeState;
  let wsServer: BridgeWebSocketServer;
  let clientSockets: WebSocket[] = [];

  const createClient = (port?: number, token?: string): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
      const targetPort = port ?? wsServer.getPort();
      const ws = new WebSocket(`ws://127.0.0.1:${targetPort}`);
      clientSockets.push(ws);
      const onMessage = (raw: WebSocket.RawData) => {
        const message = JSON.parse(raw.toString());
        if (message.event !== "hello_ack") return;
        ws.off("message", onMessage);
        resolve(ws);
      };
      ws.on("message", onMessage);
      ws.on("open", () => {
        ws.send(JSON.stringify({
          event: "hello",
          data: {
            bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION,
            asepriteVersion: "stress-test",
            apiVersion: 0,
            sessionId: randomUUID(),
            revision: 1,
            token,
            capabilities: { stressTest: true },
          },
        }));
      });
      ws.on("error", (err) => reject(err));
    });
  };

  beforeEach(async () => {
    clientSockets = [];
    dispatcher = new CommandDispatcher();
    state = new BridgeState();
    wsServer = new BridgeWebSocketServer(dispatcher, state, {
      host: "127.0.0.1",
      port: 0,
      pingIntervalMs: 200, // Short interval for heartbeat testing
    });
    await wsServer.start();
  });

  afterEach(async () => {
    for (const ws of clientSockets) {
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.terminate();
        }
      } catch {
        // ignore
      }
    }
    clientSockets = [];
    await wsServer.close();
  });

  it("STRESS-1: Rapid concurrent burst of 100 requests without loss or corruption", async () => {
    const ws = await createClient();

    ws.on("message", (data) => {
      const req = JSON.parse(data.toString());
      const res = {
        id: req.id,
        success: true,
        result: { echoedCommand: req.command, index: req.params?.i },
      };
      ws.send(JSON.stringify(res));
    });

    const COUNT = 100;
    const promises: Promise<any>[] = [];

    for (let i = 0; i < COUNT; i++) {
      promises.push(dispatcher.send("batch_test", { i }));
    }

    const results = await Promise.all(promises);
    expect(results.length).toBe(COUNT);
    for (let i = 0; i < COUNT; i++) {
      expect(results[i]).toEqual({ echoedCommand: "batch_test", index: i });
    }

    expect(dispatcher.getPendingCount()).toBe(0);
  });

  it("STRESS-2: Out-of-order responses with random jitter", async () => {
    const ws = await createClient();

    ws.on("message", (data) => {
      const req = JSON.parse(data.toString());
      const delay = Math.floor(Math.random() * 30) + 10;
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              id: req.id,
              success: true,
              result: { idx: req.params.idx },
            })
          );
        }
      }, delay);
    });

    const COUNT = 50;
    const tasks = Array.from({ length: COUNT }, (_, idx) =>
      dispatcher.send("jitter_test", { idx })
    );

    const responses = await Promise.all(tasks);
    expect(responses.length).toBe(COUNT);
    responses.forEach((res: any, idx) => {
      expect(res.idx).toBe(idx);
    });

    expect(dispatcher.getPendingCount()).toBe(0);
  });

  it("STRESS-3: Abrupt socket termination with 30 requests in-flight immediately aborts all", async () => {
    const ws = await createClient();

    const COUNT = 30;
    const promises: Promise<any>[] = [];
    for (let i = 0; i < COUNT; i++) {
      promises.push(dispatcher.send("hang_command", { i }, 8000));
    }

    expect(dispatcher.getPendingCount()).toBe(COUNT);

    ws.terminate();

    const results = await Promise.allSettled(promises);
    expect(results.length).toBe(COUNT);

    for (const res of results) {
      expect(res.status).toBe("rejected");
      if (res.status === "rejected") {
        expect(res.reason).toBeInstanceOf(BridgeError);
        expect(res.reason.code).toBe(BridgeErrorCode.DISCONNECTED);
        expect(res.reason.message).toContain("aborted");
      }
    }

    expect(dispatcher.getPendingCount()).toBe(0);
    expect(dispatcher.isConnected()).toBe(false);
    expect(wsServer.isConnected()).toBe(false);
  });

  it("STRESS-4: Timeout handling cleanly expires and leaves zero lingering state", async () => {
    const ws = await createClient();

    const start = Date.now();
    await expect(dispatcher.send("timeout_test", {}, 100)).rejects.toThrow(
      "timed out after 100ms"
    );
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(90);
    expect(dispatcher.getPendingCount()).toBe(0);

    ws.send(JSON.stringify({ id: "req_already_timed_out", success: true }));
    await new Promise((r) => setTimeout(r, 50));
    expect(dispatcher.getPendingCount()).toBe(0);
  });

  it("STRESS-5: Malformed JSON, non-object frames, and binary frames do not crash the server", async () => {
    const ws = await createClient();

    // Malformed JSON strings
    ws.send("{ incomplete json string");
    ws.send("");
    ws.send("<<<NOT JSON>>>");
    ws.send("{ id: without_quotes }");

    // Primitive JSON values
    ws.send("null");
    ws.send("12345");
    ws.send('"just a string"');
    ws.send("true");
    ws.send("[]");
    ws.send("{}");

    // Binary frame
    ws.send(Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]));

    // Corrupted envelopes
    ws.send(JSON.stringify({ id: 12345, success: true }));
    ws.send(JSON.stringify({ id: "valid_id", success: "not_a_boolean" }));
    ws.send(JSON.stringify({ success: true }));

    await new Promise((r) => setTimeout(r, 100));

    expect(wsServer.isConnected()).toBe(true);
    expect(dispatcher.isConnected()).toBe(true);

    ws.on("message", (data) => {
      try {
        const req = JSON.parse(data.toString());
        ws.send(JSON.stringify({ id: req.id, success: true, result: "still_alive" }));
      } catch {
        // ignore
      }
    });

    const res = await dispatcher.send("ping", {});
    expect(res).toBe("still_alive");
  });

  it("STRESS-6: Rapid connect/disconnect churn of 20 sequential clients", async () => {
    for (let i = 0; i < 20; i++) {
      const ws = await createClient();
      expect(wsServer.isConnected()).toBe(true);
      ws.close();
      await new Promise((r) => setTimeout(r, 20));
    }

    const finalClient = await createClient();
    expect(wsServer.isConnected()).toBe(true);
    finalClient.on("message", (data) => {
      const req = JSON.parse(data.toString());
      finalClient.send(JSON.stringify({ id: req.id, success: true, result: "churn_ok" }));
    });

    const res = await dispatcher.send("test_after_churn", {});
    expect(res).toBe("churn_ok");
  });

  it("STRESS-7: Closing wsServer cleanly aborts in-flight commands and resets state", async () => {
    await createClient();

    const p = dispatcher.send("in_flight_during_close", {}, 8000);
    expect(dispatcher.getPendingCount()).toBe(1);

    await wsServer.close();

    await expect(p).rejects.toThrow(/aborted|Server stopping/);
    expect(dispatcher.getPendingCount()).toBe(0);
    expect(dispatcher.isConnected()).toBe(false);
    expect(wsServer.isConnected()).toBe(false);
  });

  it("STRESS-8: Calling send when disconnected throws immediate BridgeError without dangling timer", async () => {
    expect(dispatcher.isConnected()).toBe(false);
    const sendPromise = dispatcher.send("cannot_send", {});

    await expect(sendPromise).rejects.toThrow("Aseprite is not connected via WebSocket bridge");
    expect(dispatcher.getPendingCount()).toBe(0);
  });

  it("STRESS-9: Staggered timeouts fire accurately and independently", async () => {
    await createClient();

    const p1 = dispatcher.send("t1", {}, 50);
    const p2 = dispatcher.send("t2", {}, 100);
    const p3 = dispatcher.send("t3", {}, 150);

    expect(dispatcher.getPendingCount()).toBe(3);

    const start = Date.now();
    await expect(p1).rejects.toThrow("timed out after 50ms");
    const d1 = Date.now() - start;
    expect(d1).toBeGreaterThanOrEqual(40);
    expect(dispatcher.getPendingCount()).toBe(2);

    await expect(p2).rejects.toThrow("timed out after 100ms");
    const d2 = Date.now() - start;
    expect(d2).toBeGreaterThanOrEqual(90);
    expect(dispatcher.getPendingCount()).toBe(1);

    await expect(p3).rejects.toThrow("timed out after 150ms");
    const d3 = Date.now() - start;
    expect(d3).toBeGreaterThanOrEqual(140);
    expect(dispatcher.getPendingCount()).toBe(0);
  });

  it("STRESS-10: Large payload transmission (2MB JSON frame)", async () => {
    const ws = await createClient();

    // 2MB dummy payload simulating a massive uncompressed canvas/preview
    const largeData = "X".repeat(2 * 1024 * 1024);

    ws.on("message", (data) => {
      const req = JSON.parse(data.toString());
      ws.send(
        JSON.stringify({
          id: req.id,
          success: true,
          result: { payloadLength: req.params.blob.length, echo: "ok" },
        })
      );
    });

    const res: any = await dispatcher.send("large_blob_test", { blob: largeData });
    expect(res.payloadLength).toBe(2 * 1024 * 1024);
    expect(res.echo).toBe("ok");
    expect(dispatcher.getPendingCount()).toBe(0);
  });

  it("STRESS-11: Heartbeat timeout terminates unresponsive client", async () => {
    const ws = await createClient();

    // Prevent client from answering ping frames
    (ws as any).pong = () => {};

    // Wait for 2 heartbeat intervals (2 * 200ms = 400ms)
    await new Promise((r) => setTimeout(r, 600));

    expect(wsServer.isConnected()).toBe(false);
    expect(dispatcher.isConnected()).toBe(false);
  });

  it("ADV-1: First-client pinning rejects incoming second client with 1008 while established client and in-flight request remain usable", async () => {
    // 1. Client 1 connects
    const ws1 = await createClient();
    expect(wsServer.isConnected()).toBe(true);

    // Setup Client 1 handler for in-flight command
    let respondToInFlight: () => void;
    const inFlightBarrier = new Promise<void>((resolve) => {
      respondToInFlight = resolve;
    });

    ws1.on("message", (data) => {
      const req = JSON.parse(data.toString());
      if (req.command === "slow_cmd_on_ws1") {
        inFlightBarrier.then(() => {
          if (ws1.readyState === WebSocket.OPEN) {
            ws1.send(JSON.stringify({ id: req.id, success: true, result: "from_ws1" }));
          }
        });
      } else if (req.command === "second_cmd_on_ws1") {
        ws1.send(JSON.stringify({ id: req.id, success: true, result: "second_ok" }));
      }
    });

    // 2. Dispatcher sends command to Client 1 (held in-flight)
    const p1 = dispatcher.send("slow_cmd_on_ws1", {}, 5000);
    expect(dispatcher.getPendingCount()).toBe(1);

    // 3. A second Aseprite client identifies itself, but must be rejected with
    // code 1008. Shared MCP peers use a different peer_hello handshake.
    const client2ClosePromise = new Promise<{ code: number; reason: string; rejection?: unknown }>((resolve) => {
      let rejection: unknown;
      const ws2 = new WebSocket(`ws://127.0.0.1:${wsServer.getPort()}`);
      clientSockets.push(ws2);
      ws2.on("open", () => {
        ws2.send(JSON.stringify({
          event: "hello",
          data: {
            bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION,
            asepriteVersion: "stress-test-duplicate",
            apiVersion: 0,
            sessionId: randomUUID(),
            revision: 1,
            capabilities: { stressTest: true },
          },
        }));
      });
      ws2.on("message", (raw) => {
        rejection = JSON.parse(raw.toString("utf-8"));
      });
      ws2.on("close", (code, reason) => {
        resolve({ code, reason: reason.toString("utf-8"), rejection });
      });
      ws2.on("error", () => {});
    });

    const closeResult = await client2ClosePromise;
    expect(closeResult.code).toBe(1008);
    expect(closeResult.reason).toContain("Another Aseprite bridge is already connected");
    expect(closeResult.rejection).toEqual({
      event: "hello_rejected",
      data: { code: "BRIDGE_BUSY", retryAfterMs: 1000 },
    });

    // 4. Established Client 1 connection and its in-flight command remain completely usable
    expect(wsServer.isConnected()).toBe(true);
    expect(dispatcher.isConnected()).toBe(true);
    expect(dispatcher.getPendingCount()).toBe(1);

    // Release in-flight command response from Client 1
    respondToInFlight!();
    const res1 = await p1;
    expect(res1).toBe("from_ws1");
    expect(dispatcher.getPendingCount()).toBe(0);

    // Send another command to Client 1 to verify continued health
    const res2 = await dispatcher.send("second_cmd_on_ws1", {});
    expect(res2).toBe("second_ok");
    expect(dispatcher.getPendingCount()).toBe(0);

    // 5. Normal closure of Client 1 allows a subsequent client to connect normally
    await new Promise<void>((resolve) => {
      ws1.once("close", () => resolve());
      ws1.close();
    });

    if (wsServer.isConnected()) {
      await new Promise<void>((resolve, reject) => {
        if (!wsServer.isConnected()) {
          return resolve();
        }
        const timer = setTimeout(() => reject(new Error("Timeout waiting for wsServer to register disconnect")), 3000);
        const onConnChange = ({ connected }: { connected: boolean }) => {
          if (!connected) {
            clearTimeout(timer);
            state.off("connection_change", onConnChange);
            resolve();
          }
        };
        state.on("connection_change", onConnChange);
      });
    }

    const ws3 = await createClient();
    expect(wsServer.isConnected()).toBe(true);
    ws3.on("message", (data) => {
      const req = JSON.parse(data.toString());
      ws3.send(JSON.stringify({ id: req.id, success: true, result: "from_ws3" }));
    });

    const res3 = await dispatcher.send("cmd_on_ws3", {});
    expect(res3).toBe("from_ws3");
    expect(dispatcher.getPendingCount()).toBe(0);
  });

  it("STRESS-12: Enforces central MAX_PENDING_COMMANDS limit (128 accepted, 129th rejected)", async () => {
    const ws = await createClient();
    expect(wsServer.isConnected()).toBe(true);

    const promises: Promise<any>[] = [];
    try {
      for (let i = 0; i < 128; i++) {
        const p = dispatcher.send("hang_pending", { i }, 10000);
        p.catch(() => {});
        promises.push(p);
      }
      expect(dispatcher.getPendingCount()).toBe(128);

      await expect(dispatcher.send("hang_pending", { i: 128 })).rejects.toMatchObject({
        code: BridgeErrorCode.INVALID_PARAMS,
        message: expect.stringContaining("Maximum pending bridge requests reached (128)"),
      });

      expect(dispatcher.getPendingCount()).toBe(128);
    } finally {
      ws.close();
      await Promise.allSettled(promises);
      expect(dispatcher.getPendingCount()).toBe(0);
    }
  });

  it("STRESS-13: Rejects oversized outgoing request exceeding MAX_BRIDGE_PAYLOAD_BYTES with INVALID_PARAMS", async () => {
    await createClient();
    expect(wsServer.isConnected()).toBe(true);

    const smallDispatcher = new CommandDispatcher({ maxPayloadBytes: 1024 });
    const smallState = new BridgeState();
    const smallServer = new BridgeWebSocketServer(smallDispatcher, smallState, {
      host: "127.0.0.1",
      port: 0,
    });
    await smallServer.start();

    try {
      const clientWs = await createClient(smallServer.getPort());

      const oversizedPayload = "Z".repeat(2048);
      await expect(smallDispatcher.send("too_large", { blob: oversizedPayload })).rejects.toMatchObject({
        code: BridgeErrorCode.INVALID_PARAMS,
        message: expect.stringContaining("Request payload exceeds maximum allowed size"),
      });

      expect(smallDispatcher.getPendingCount()).toBe(0);
    } finally {
      await smallServer.close();
    }
  });

  it("STRESS-14: Disconnects client when incoming frame exceeds maxPayload", async () => {
    const smallPayloadLimit = 1024;
    const testDispatcher = new CommandDispatcher();
    const testState = new BridgeState();
    const testServer = new BridgeWebSocketServer(testDispatcher, testState, {
      host: "127.0.0.1",
      port: 0,
      maxPayload: smallPayloadLimit,
    });
    await testServer.start();

    try {
      const ws = await createClient(testServer.getPort());

      const closePromise = new Promise<{ code: number; reason: string }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timeout waiting for socket close on oversized frame")), 3000);
        ws.on("close", (code, reason) => {
          clearTimeout(timer);
          resolve({ code, reason: reason.toString("utf-8") });
        });
        ws.on("error", () => {});
      });

      ws.send("A".repeat(2048));

      const closeEvent = await closePromise;
      expect(closeEvent.code).toBe(1009);
    } finally {
      await testServer.close();
    }
  });

  it("ADV-2: Unsolicited 'error' event does not crash process without error listeners", async () => {
    const ws = await createClient();

    let bridgeEventPayload: any = null;
    dispatcher.on("bridge_event", (payload) => {
      bridgeEventPayload = payload;
    });

    // Client sends an unsolicited event with name "error" when NO error listener is attached
    expect(dispatcher.listenerCount("error")).toBe(0);
    ws.send(JSON.stringify({ event: "error", data: { reason: "corrupted_lua_state" } }));

    await new Promise((r) => setTimeout(r, 100));

    // Verify process did not crash, server is still alive, and bridge_event was broadcast
    expect(wsServer.isConnected()).toBe(true);
    expect(bridgeEventPayload).toEqual({
      event: "error",
      data: { reason: "corrupted_lua_state" },
    });

    // When an error listener IS attached, it receives the error event
    let interceptedError: any = null;
    const errorHandler = (err: any) => {
      interceptedError = err;
    };
    dispatcher.on("error", errorHandler);

    ws.send(JSON.stringify({ event: "error", data: { reason: "second_error" } }));
    await new Promise((r) => setTimeout(r, 100));

    expect(interceptedError).toEqual({ reason: "second_error" });
    dispatcher.off("error", errorHandler);
  });
});
