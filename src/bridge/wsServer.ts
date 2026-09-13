/**
 * src/bridge/wsServer.ts
 * Local WebSocket server strictly bound to 127.0.0.1:32123
 * Manages socket lifecycle, loopback IP security checks, and keepalive heartbeat.
 */

import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { logger } from "../logger.js";
import {
  BRIDGE_PROTOCOL_VERSION,
  DEFAULT_BRIDGE_HOST,
  DEFAULT_BRIDGE_PORT,
  isBridgeProtocolCompatible,
  type BridgeHelloAckMessage,
  type BridgeHelloData,
} from "./protocol.js";
import { MAX_BRIDGE_PAYLOAD_BYTES } from "../config.js";
import type { CommandDispatcher } from "./dispatcher.js";
import type { BridgeState } from "./state.js";

export interface WsServerOptions {
  host?: string;
  port?: number;
  pingIntervalMs?: number;
  maxPayload?: number;
  token?: string;
  handshakeTimeoutMs?: number;
}

interface AliveWebSocket extends WebSocket {
  isAlive: boolean;
}

export class BridgeWebSocketServer {
  private static readonly MAX_PENDING_HANDSHAKES = 8;

  private wss: WebSocketServer | null = null;
  private activeSocket: AliveWebSocket | null = null;
  private readonly pendingHandshakes = new Set<AliveWebSocket>();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private readonly host: string;
  private readonly port: number;
  private readonly pingIntervalMs: number;
  private readonly maxPayload: number;
  private readonly token?: string;
  private readonly handshakeTimeoutMs: number;
  private readonly dispatcher: CommandDispatcher;
  private readonly state: BridgeState;

  constructor(dispatcher: CommandDispatcher, state: BridgeState, options: WsServerOptions = {}) {
    this.dispatcher = dispatcher;
    this.state = state;
    this.host = options.host || DEFAULT_BRIDGE_HOST;
    this.port = options.port !== undefined ? options.port : DEFAULT_BRIDGE_PORT;
    this.pingIntervalMs = options.pingIntervalMs || 15000;
    this.maxPayload = options.maxPayload !== undefined ? options.maxPayload : MAX_BRIDGE_PAYLOAD_BYTES;
    this.token = options.token;
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? 5000;
  }

  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({
          host: this.host,
          port: this.port,
          maxPayload: this.maxPayload,
        });

        this.wss.on("listening", () => {
          const addr = this.wss?.address();
          const actualPort = typeof addr === "object" && addr !== null ? addr.port : this.port;
          logger.info(`Bridge WebSocket server listening strictly on ${this.host}:${actualPort}`);
          if (!this.token) {
            logger.warn("Bridge WebSocket authentication is disabled on loopback");
          }
          this.startHeartbeat();
          resolve();
        });

        this.wss.on("error", (err: any) => {
          logger.error(`Bridge WebSocket server startup error: ${err.message}`, { code: err.code });
          if (err.code === "EADDRINUSE") {
            logger.error(`Port ${this.port} is already in use. Ensure no other instance is running.`);
          }
          reject(err);
        });

        this.wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
          this.handleConnection(socket as AliveWebSocket, req);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  private isLoopbackAddress(ip: string | undefined): boolean {
    if (!ip) return false;
    return (
      ip === "127.0.0.1" ||
      ip === "::ffff:127.0.0.1" ||
      ip === "::1" ||
      ip === "localhost"
    );
  }

  private handleConnection(socket: AliveWebSocket, req: IncomingMessage): void {
    const remoteIp = req.socket.remoteAddress;

    // Strict loopback security validation
    if (!this.isLoopbackAddress(remoteIp)) {
      logger.warn(`Security alert: Terminated unauthorized non-loopback connection from ${remoteIp}`);
      socket.terminate();
      return;
    }

    // First-client pinning:
    // while an active socket is OPEN or CONNECTING, reject/close the newcomer with policy code 1008
    // without clearing the dispatcher, state, or in-flight requests for the established client.
    if (
      this.activeSocket &&
      (this.activeSocket.readyState === WebSocket.OPEN || this.activeSocket.readyState === WebSocket.CONNECTING)
    ) {
      logger.warn(`Rejected incoming bridge connection from ${remoteIp}: active client already established`);
      socket.close(1008, "Another client is already connected");
      return;
    }

    if (this.pendingHandshakes.size >= BridgeWebSocketServer.MAX_PENDING_HANDSHAKES) {
      logger.warn(`Rejected bridge connection from ${remoteIp}: too many pending handshakes`);
      socket.close(1013, "Too many pending bridge handshakes");
      return;
    }

    logger.debug(`Bridge connection candidate accepted from ${remoteIp}; awaiting hello`);
    socket.isAlive = true;
    this.pendingHandshakes.add(socket);
    let promoted = false;
    let cleanedUp = false;

    const cleanupCandidate = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearTimeout(handshakeTimer);
      this.pendingHandshakes.delete(socket);
    };

    const rejectCandidate = (code: number, reason: string) => {
      cleanupCandidate();
      logger.warn(`Rejected bridge connection from ${remoteIp}: ${reason}`);
      socket.close(code, reason);
    };

    const handshakeTimer = setTimeout(() => {
      if (!promoted) rejectCandidate(1008, "Bridge hello timeout");
    }, this.handshakeTimeoutMs);

    socket.on("pong", () => {
      socket.isAlive = true;
    });

    socket.on("message", (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) {
        if (!promoted) {
          rejectCandidate(1003, "Bridge hello must be text JSON");
        } else {
          logger.warn("Received unexpected binary frame over bridge WebSocket; ignoring");
        }
        return;
      }
      const raw = data.toString("utf-8");

      if (!promoted) {
        const hello = this.parseHello(raw);
        if (!hello.ok) {
          rejectCandidate(hello.code, hello.reason);
          return;
        }

        if (this.activeSocket && this.activeSocket.readyState === WebSocket.OPEN) {
          rejectCandidate(1008, "Another client is already connected");
          return;
        }

        cleanupCandidate();
        promoted = true;
        this.activeSocket = socket;
        const sync = this.state.handleHello(hello.data);
        this.state.setConnected(true, remoteIp);
        this.dispatcher.setActiveSocket(socket);

        const acknowledgement: BridgeHelloAckMessage = {
          event: "hello_ack",
          data: {
            bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION,
            sessionId: hello.data.sessionId,
            resyncRequired: sync.resyncRequired,
          },
        };
        socket.send(JSON.stringify(acknowledgement));
        logger.info(
          `Bridge client authenticated from ${remoteIp} (Aseprite ${hello.data.asepriteVersion}, session ${hello.data.sessionId})`
        );
        return;
      }

      this.dispatcher.handleIncomingMessage(raw);
    });

    socket.on("close", (code: number, reason: Buffer) => {
      cleanupCandidate();
      const reasonStr = reason ? reason.toString("utf-8") : "";
      logger.info(`Bridge connection closed (code: ${code}, reason: '${reasonStr || "normal"}')`);
      if (this.activeSocket === socket) {
        this.activeSocket = null;
        this.state.setConnected(false);
        this.dispatcher.clearActiveSocket("Bridge socket closed");
      }
    });

    socket.on("error", (err: Error) => {
      cleanupCandidate();
      logger.error(`Bridge socket error: ${err.message}`);
      if (this.activeSocket === socket) {
        this.activeSocket = null;
        this.state.setConnected(false);
        this.dispatcher.clearActiveSocket(`Bridge socket error: ${err.message}`);
      }
    });
  }

  private parseHello(
    raw: string
  ): { ok: true; data: BridgeHelloData } | { ok: false; code: number; reason: string } {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return { ok: false, code: 1002, reason: "First message must be a valid bridge hello" };
    }

    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return { ok: false, code: 1002, reason: "First message must be a bridge hello object" };
    }

    const envelope = message as { event?: unknown; data?: unknown };
    if (envelope.event !== "hello" || !envelope.data || typeof envelope.data !== "object" || Array.isArray(envelope.data)) {
      return { ok: false, code: 1002, reason: "First message must be bridge hello" };
    }

    const data = envelope.data as Record<string, unknown>;
    if (!isBridgeProtocolCompatible(data.bridgeProtocolVersion)) {
      return {
        ok: false,
        code: 1002,
        reason: `Incompatible bridge protocol; server requires ${BRIDGE_PROTOCOL_VERSION}`,
      };
    }
    if (typeof data.asepriteVersion !== "string" || data.asepriteVersion.length < 1 || data.asepriteVersion.length > 64) {
      return { ok: false, code: 1002, reason: "Invalid Aseprite version in bridge hello" };
    }
    if (!Number.isSafeInteger(data.apiVersion) || (data.apiVersion as number) < 0) {
      return { ok: false, code: 1002, reason: "Invalid API version in bridge hello" };
    }
    if (typeof data.sessionId !== "string" || data.sessionId.length < 8 || data.sessionId.length > 128) {
      return { ok: false, code: 1002, reason: "Invalid session identifier in bridge hello" };
    }
    if (!Number.isSafeInteger(data.revision) || (data.revision as number) < 0) {
      return { ok: false, code: 1002, reason: "Invalid revision in bridge hello" };
    }
    if (!data.capabilities || typeof data.capabilities !== "object" || Array.isArray(data.capabilities)) {
      return { ok: false, code: 1002, reason: "Invalid capabilities in bridge hello" };
    }

    const capabilityEntries = Object.entries(data.capabilities);
    if (
      capabilityEntries.length > 64 ||
      capabilityEntries.some(([name, enabled]) => name.length < 1 || name.length > 64 || typeof enabled !== "boolean")
    ) {
      return { ok: false, code: 1002, reason: "Invalid capabilities in bridge hello" };
    }

    if (this.token && !this.tokensMatch(this.token, data.token)) {
      return { ok: false, code: 1008, reason: "Invalid bridge authentication" };
    }

    return {
      ok: true,
      data: {
        bridgeProtocolVersion: data.bridgeProtocolVersion,
        asepriteVersion: data.asepriteVersion,
        apiVersion: data.apiVersion as number,
        sessionId: data.sessionId,
        revision: data.revision as number,
        token: typeof data.token === "string" ? data.token : undefined,
        capabilities: Object.fromEntries(capabilityEntries) as Record<string, boolean>,
      },
    };
  }

  private tokensMatch(expected: string, provided: unknown): boolean {
    if (typeof provided !== "string") return false;
    const expectedBuffer = Buffer.from(expected, "utf-8");
    const providedBuffer = Buffer.from(provided, "utf-8");
    return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (!this.activeSocket) return;

      if (this.activeSocket.isAlive === false) {
        logger.warn("Bridge client heartbeat failed (no pong response); terminating socket");
        this.activeSocket.terminate();
        this.activeSocket = null;
        this.state.setConnected(false);
        this.dispatcher.clearActiveSocket("Heartbeat timeout");
        return;
      }

      this.activeSocket.isAlive = false;
      this.activeSocket.ping();
    }, this.pingIntervalMs);
  }

  public async close(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.activeSocket) {
      this.activeSocket.terminate();
      this.activeSocket = null;
    }

    for (const socket of this.pendingHandshakes) socket.terminate();
    this.pendingHandshakes.clear();

    this.state.setConnected(false);
    this.dispatcher.clearActiveSocket("Server stopping");

    if (this.wss) {
      return new Promise((resolve) => {
        this.wss!.close(() => {
          logger.info("Bridge WebSocket server closed");
          this.wss = null;
          resolve();
        });
      });
    }
  }

  public isConnected(): boolean {
    return this.activeSocket !== null && this.activeSocket.readyState === WebSocket.OPEN;
  }

  public getPort(): number {
    if (this.wss) {
      const addr = this.wss.address();
      if (typeof addr === "object" && addr !== null) {
        return addr.port;
      }
    }
    return this.port;
  }
}

export async function startWsServer(
  port?: number,
  host?: string,
  dispatcher?: CommandDispatcher,
  state?: BridgeState,
  optionsOrToken?: string | { token?: string; pingIntervalMs?: number; maxPayload?: number; handshakeTimeoutMs?: number }
): Promise<BridgeWebSocketServer> {
  const activeDispatcher = dispatcher || new (await import("./dispatcher.js")).CommandDispatcher();
  const activeState = state || new (await import("./state.js")).BridgeState();
  const extraOptions =
    typeof optionsOrToken === "string"
      ? { token: optionsOrToken }
      : optionsOrToken || {};
  const server = new BridgeWebSocketServer(activeDispatcher, activeState, { port, host, ...extraOptions });
  await server.start();
  return server;
}
