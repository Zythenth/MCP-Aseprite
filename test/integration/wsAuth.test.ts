// test/integration/wsAuth.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { BridgeWebSocketServer } from "../../src/bridge/wsServer.js";
import { CommandDispatcher } from "../../src/bridge/dispatcher.js";
import { BridgeState } from "../../src/bridge/state.js";
import { MockAsepriteEngine } from "../../src/mock/mockEngine.js";
import { MockClient } from "../../src/mock/mockClient.js";
import { startMockBridge, stopMockBridge } from "../../src/mock/index.js";

describe("WebSocket Bridge Authentication (token-based)", () => {
  const VALID_TOKEN = "SecretToken_123456789.valid";
  let dispatcher: CommandDispatcher;
  let state: BridgeState;
  let wsServer: BridgeWebSocketServer;
  let clientSockets: WebSocket[];

  beforeEach(async () => {
    clientSockets = [];
    dispatcher = new CommandDispatcher();
    state = new BridgeState();
    wsServer = new BridgeWebSocketServer(dispatcher, state, {
      host: "127.0.0.1",
      port: 0,
      token: VALID_TOKEN,
    });
    await wsServer.start();
  });

  afterEach(async () => {
    for (const ws of clientSockets) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
      }
    }
    clientSockets = [];
    await stopMockBridge();
    await wsServer.close();
  });

  it("server with token rejects unauthenticated connection (missing token) with code 1008 and remains disconnected", async () => {
    expect(wsServer.isConnected()).toBe(false);

    const port = wsServer.getPort();
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    clientSockets.push(ws);

    const closeEvent = await new Promise<{ code: number; reason: string }>((resolve) => {
      ws.on("close", (code, reason) => {
        resolve({ code, reason: reason.toString("utf-8") });
      });
    });

    expect(closeEvent.code).toBe(1008);
    expect(closeEvent.reason).toBe("Invalid bridge authentication");
    expect(wsServer.isConnected()).toBe(false);
    expect(dispatcher.isConnected()).toBe(false);
    expect(state.isConnected()).toBe(false);
  });

  it("server with token rejects incorrect tokens with code 1008 and remains disconnected", async () => {
    const port = wsServer.getPort();

    // 1. Token with different length
    const wsWrongLen = new WebSocket(`ws://127.0.0.1:${port}/?token=ShortSecret123`);
    clientSockets.push(wsWrongLen);
    const close1 = await new Promise<{ code: number; reason: string }>((resolve) => {
      wsWrongLen.on("close", (code, reason) => {
        resolve({ code, reason: reason.toString("utf-8") });
      });
    });
    expect(close1.code).toBe(1008);
    expect(close1.reason).toBe("Invalid bridge authentication");
    expect(wsServer.isConnected()).toBe(false);

    // 2. Token with exact same length but different characters
    const sameLenWrong = "X".repeat(VALID_TOKEN.length);
    const wsWrongChars = new WebSocket(`ws://127.0.0.1:${port}/?token=${sameLenWrong}`);
    clientSockets.push(wsWrongChars);
    const close2 = await new Promise<{ code: number; reason: string }>((resolve) => {
      wsWrongChars.on("close", (code, reason) => {
        resolve({ code, reason: reason.toString("utf-8") });
      });
    });
    expect(close2.code).toBe(1008);
    expect(close2.reason).toBe("Invalid bridge authentication");
    expect(wsServer.isConnected()).toBe(false);
  });

  it("server with token accepts connection with valid token query parameter", async () => {
    const port = wsServer.getPort();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${VALID_TOKEN}`);
    clientSockets.push(ws);

    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", (err) => reject(err));
    });

    expect(wsServer.isConnected()).toBe(true);
    expect(dispatcher.isConnected()).toBe(true);
    expect(state.isConnected()).toBe(true);
  });

  it("invalid authentication attempt during active client does not interrupt established client or inflight commands", async () => {
    const port = wsServer.getPort();

    // 1. Establish valid client
    const validWs = new WebSocket(`ws://127.0.0.1:${port}/?token=${VALID_TOKEN}`);
    clientSockets.push(validWs);
    await new Promise<void>((resolve, reject) => {
      validWs.on("open", () => resolve());
      validWs.on("error", (err) => reject(err));
    });
    expect(wsServer.isConnected()).toBe(true);

    // 2. Set up barrier on valid client: receive inflight request, hold response until barrier is released
    let releaseBarrier!: () => void;
    const barrierPromise = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });

    validWs.on("message", (raw) => {
      const msg = JSON.parse(raw.toString("utf-8"));
      if (msg.command === "inflight_cmd") {
        barrierPromise.then(() => {
          validWs.send(JSON.stringify({ id: msg.id, success: true, result: { inflightVerified: true } }));
        });
      } else if (msg.command === "subsequent_cmd") {
        validWs.send(JSON.stringify({ id: msg.id, success: true, result: { subsequentVerified: true } }));
      }
    });

    // 3. Dispatch command BEFORE the intruder connects and confirm pending = 1
    const inflightPromise = dispatcher.send<{ inflightVerified: boolean }>("inflight_cmd", {});
    expect(dispatcher.getPendingCount()).toBe(1);

    // 4. Intruder attempts unauthorized connection
    const intruderWs = new WebSocket(`ws://127.0.0.1:${port}/?token=BadToken_1234567890`);
    clientSockets.push(intruderWs);
    const closeIntruder = await new Promise<{ code: number; reason: string }>((resolve) => {
      intruderWs.on("close", (code, reason) => {
        resolve({ code, reason: reason.toString("utf-8") });
      });
    });
    expect(closeIntruder.code).toBe(1008);
    expect(closeIntruder.reason).toBe("Invalid bridge authentication");

    // 5. Confirm pending is STILL 1 and established connection remains fully active
    expect(dispatcher.getPendingCount()).toBe(1);
    expect(wsServer.isConnected()).toBe(true);
    expect(dispatcher.isConnected()).toBe(true);
    expect(state.isConnected()).toBe(true);

    // 6. Release response barrier, await promise, confirm pending = 0 and valid result
    releaseBarrier();
    const inflightResult = await inflightPromise;
    expect(inflightResult.inflightVerified).toBe(true);
    expect(dispatcher.getPendingCount()).toBe(0);

    // 7. Dispatch subsequent command to prove continued bridge health
    const subsequentResult = await dispatcher.send<{ subsequentVerified: boolean }>("subsequent_cmd", {});
    expect(subsequentResult.subsequentVerified).toBe(true);
    expect(dispatcher.getPendingCount()).toBe(0);
    expect(wsServer.isConnected()).toBe(true);
  });

  it("server without token configured continues accepting unauthenticated connections", async () => {
    const unauthDispatcher = new CommandDispatcher();
    const unauthState = new BridgeState();
    const unauthServer = new BridgeWebSocketServer(unauthDispatcher, unauthState, {
      host: "127.0.0.1",
      port: 0,
    });
    await unauthServer.start();
    const port = unauthServer.getPort();

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    clientSockets.push(ws);
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", (err) => reject(err));
    });

    expect(unauthServer.isConnected()).toBe(true);
    expect(unauthDispatcher.isConnected()).toBe(true);
    expect(unauthState.isConnected()).toBe(true);

    await unauthServer.close();
  });

  it("MockClient connects and authenticates when token is provided", async () => {
    const port = wsServer.getPort();
    const engine = new MockAsepriteEngine(32, 32);

    const client = new MockClient(engine, {
      host: "127.0.0.1",
      port,
      token: VALID_TOKEN,
    });

    await client.connect();
    expect(client.isConnected()).toBe(true);
    expect(wsServer.isConnected()).toBe(true);

    await client.disconnect();
    expect(client.isConnected()).toBe(false);

    // Also test startMockBridge helper passing token
    const bridgeInstance = await startMockBridge({
      host: "127.0.0.1",
      port,
      token: VALID_TOKEN,
    });

    expect(bridgeInstance.client.isConnected()).toBe(true);
    expect(wsServer.isConnected()).toBe(true);

    await bridgeInstance.stop();
  });
});
