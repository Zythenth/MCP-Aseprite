import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { BridgeWebSocketServer } from "../../src/bridge/wsServer.js";
import { CommandDispatcher } from "../../src/bridge/dispatcher.js";
import { BridgeState } from "../../src/bridge/state.js";
import { BridgeErrorCode, BridgeError } from "../../src/bridge/protocol.js";

describe("Milestone 1 Empirical Stress & Adversarial Test Suite", () => {
  let dispatcher: CommandDispatcher;
  let state: BridgeState;
  let wsServer: BridgeWebSocketServer;
  let clientSockets: WebSocket[] = [];

  const createClient = (port?: number): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
      const targetPort = port ?? wsServer.getPort();
      const ws = new WebSocket(`ws://127.0.0.1:${targetPort}`);
      clientSockets.push(ws);
      ws.on("open", () => resolve(ws));
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

  it("ADV-1: In-flight requests are immediately aborted with DISCONNECTED when client is replaced", async () => {
    // 1. Client 1 connects
    const ws1 = await createClient();
    expect(wsServer.isConnected()).toBe(true);

    // 2. Dispatcher sends command to client 1 (client 1 does not answer)
    const p1 = dispatcher.send("slow_cmd_on_ws1", {}, 5000);
    // Attach noop catch handler to prevent Node.js unhandledRejection tick while awaiting createClient()
    p1.catch(() => {});
    expect(dispatcher.getPendingCount()).toBe(1);

    // 3. Client 2 connects immediately, superseding client 1
    const ws2 = await createClient();
    expect(wsServer.isConnected()).toBe(true);

    // In-flight command dispatched to client 1 must be rejected immediately upon replacement
    const start = Date.now();
    await expect(p1).rejects.toThrow(/Client replaced/);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(300);

    // Client 2 responds to its own commands
    ws2.on("message", (data) => {
      const req = JSON.parse(data.toString());
      ws2.send(JSON.stringify({ id: req.id, success: true, result: "from_ws2" }));
    });

    // Send command to client 2 - succeeds
    const res2 = await dispatcher.send("cmd_on_ws2", {});
    expect(res2).toBe("from_ws2");
    expect(dispatcher.getPendingCount()).toBe(0);
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
