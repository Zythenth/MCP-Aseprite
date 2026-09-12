/**
 * src/bridge/wsServer.ts
 * Local WebSocket server strictly bound to 127.0.0.1:32123
 * Manages socket lifecycle, loopback IP security checks, and keepalive heartbeat.
 */

import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { logger } from "../logger.js";
import { DEFAULT_BRIDGE_HOST, DEFAULT_BRIDGE_PORT } from "./protocol.js";
import { MAX_BRIDGE_PAYLOAD_BYTES } from "../config.js";
import type { CommandDispatcher } from "./dispatcher.js";
import type { BridgeState } from "./state.js";

export interface WsServerOptions {
  host?: string;
  port?: number;
  pingIntervalMs?: number;
  maxPayload?: number;
  token?: string;
}

interface AliveWebSocket extends WebSocket {
  isAlive: boolean;
}

export class BridgeWebSocketServer {
  private wss: WebSocketServer | null = null;
  private activeSocket: AliveWebSocket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private readonly host: string;
  private readonly port: number;
  private readonly pingIntervalMs: number;
  private readonly maxPayload: number;
  private readonly token?: string;
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
    // Validate token authentication if configured, before loopback, first-client pinning, state, or dispatcher
    if (this.token) {
      let authenticated = false;
      let providedToken: string | null = null;
      if (req.url) {
        try {
          const parsedUrl = new URL(req.url, `http://${this.host}`);
          providedToken = parsedUrl.searchParams.get("token");
        } catch {
          // Malformed URL, providedToken remains null
        }
      }

      if (providedToken) {
        const expectedBuf = Buffer.from(this.token, "utf-8");
        const providedBuf = Buffer.from(providedToken, "utf-8");
        if (expectedBuf.length === providedBuf.length) {
          authenticated = timingSafeEqual(expectedBuf, providedBuf);
        }
      }

      if (!authenticated) {
        logger.warn("Rejected unauthorized bridge connection: invalid authentication token");
        socket.close(1008, "Invalid bridge authentication");
        return;
      }
    }

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

    logger.info(`Bridge connection accepted from ${remoteIp}`);

    this.activeSocket = socket;
    socket.isAlive = true;

    socket.on("pong", () => {
      socket.isAlive = true;
    });

    this.state.setConnected(true, remoteIp);
    this.dispatcher.setActiveSocket(socket);

    socket.on("message", (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) {
        logger.warn("Received unexpected binary frame over bridge WebSocket; ignoring");
        return;
      }
      const raw = data.toString("utf-8");
      this.dispatcher.handleIncomingMessage(raw);
    });

    socket.on("close", (code: number, reason: Buffer) => {
      const reasonStr = reason ? reason.toString("utf-8") : "";
      logger.info(`Bridge connection closed (code: ${code}, reason: '${reasonStr || "normal"}')`);
      if (this.activeSocket === socket) {
        this.activeSocket = null;
        this.state.setConnected(false);
        this.dispatcher.clearActiveSocket("Bridge socket closed");
      }
    });

    socket.on("error", (err: Error) => {
      logger.error(`Bridge socket error: ${err.message}`);
      if (this.activeSocket === socket) {
        this.activeSocket = null;
        this.state.setConnected(false);
        this.dispatcher.clearActiveSocket(`Bridge socket error: ${err.message}`);
      }
    });
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
  optionsOrToken?: string | { token?: string; pingIntervalMs?: number; maxPayload?: number }
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
