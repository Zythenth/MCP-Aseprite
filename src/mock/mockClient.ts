// src/mock/mockClient.ts
import WebSocket from "ws";
import { MockAsepriteEngine } from "./mockEngine.js";
import {
  BRIDGE_PROTOCOL_VERSION,
  type BridgeHelloAckMessage,
  type BridgeHelloMessage,
  type BridgeRequestMessage,
  type BridgeResponseMessage,
} from "../bridge/protocol.js";
import { logger } from "../logger.js";

export interface MockClientOptions {
  host?: string;
  port?: number;
  autoReconnect?: boolean;
  token?: string;
}

export class MockClient {
  private engine: MockAsepriteEngine;
  private ws: WebSocket | null = null;
  private host: string;
  private port: number;
  private autoReconnect: boolean;
  private token?: string;
  private shouldRun = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isConnectedState = false;
  private readonly sessionId: string;

  constructor(engine: MockAsepriteEngine, options: MockClientOptions = {}) {
    this.engine = engine;
    this.host = options.host ?? "127.0.0.1";
    this.port = options.port ?? 32123;
    this.autoReconnect = options.autoReconnect ?? false;
    this.token = options.token;
    this.sessionId = engine.sessionId;
  }

  public isConnected(): boolean {
    return this.isConnectedState && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  public async connect(): Promise<void> {
    this.shouldRun = true;
    const url = `ws://${this.host}:${this.port}`;

    return new Promise((resolve, reject) => {
      let resolved = false;
      const handshakeTimer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.ws?.terminate();
          reject(new Error(`Timed out waiting for bridge hello acknowledgement from ${this.host}:${this.port}`));
        }
      }, 6000);

      const resolveOnce = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(handshakeTimer);
        resolve();
      };

      const rejectOnce = (error: Error) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(handshakeTimer);
        reject(error);
      };

      try {
        this.ws = new WebSocket(url);
      } catch (err) {
        rejectOnce(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      this.ws.on("open", () => {
        const hello: BridgeHelloMessage = {
          event: "hello",
          data: {
            bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION,
            asepriteVersion: "mock",
            apiVersion: 0,
            sessionId: this.sessionId,
            revision: this.engine.revision,
            token: this.token,
            capabilities: {
              mock: true,
              changeJournal: true,
              animationGif: true,
              animationInspection: true,
              referenceImageDecode: true,
            },
          },
        };
        this.ws?.send(JSON.stringify(hello));
      });

      this.ws.on("message", (raw: WebSocket.RawData) => {
        if (!this.isConnectedState) {
          try {
            const acknowledgement = JSON.parse(raw.toString()) as BridgeHelloAckMessage;
            if (
              acknowledgement.event === "hello_ack" &&
              acknowledgement.data?.bridgeProtocolVersion === BRIDGE_PROTOCOL_VERSION &&
              acknowledgement.data?.sessionId === this.sessionId
            ) {
              this.isConnectedState = true;
              logger.info(`[MockClient] Authenticated with ${this.host}:${this.port}`);
              resolveOnce();
              return;
            }
          } catch {
            // The server will close the connection if the handshake is invalid.
          }
          rejectOnce(new Error("Bridge returned an invalid hello acknowledgement"));
          this.ws?.close(1002, "Invalid hello acknowledgement");
          return;
        }
        this.handleRawMessage(raw);
      });

      this.ws.on("close", (code, reason) => {
        this.isConnectedState = false;
        this.ws = null;
        const reasonStr = reason ? reason.toString() : "";
        logger.debug(`[MockClient] Disconnected (code: ${code}, reason: ${reasonStr})`);

        if (!resolved) {
          rejectOnce(new Error(`Failed to connect to ${this.host}:${this.port}: connection closed with code ${code}`));
        }

        if (this.shouldRun && this.autoReconnect) {
          this.reconnectTimer = setTimeout(() => {
            if (this.shouldRun) {
              this.connect().catch((e) => logger.debug(`[MockClient] Reconnect attempt failed: ${e.message}`));
            }
          }, 500);
        }
      });

      this.ws.on("error", (err) => {
        logger.debug(`[MockClient] Socket error: ${err.message}`);
        rejectOnce(err);
      });
    });
  }

  public async disconnect(): Promise<void> {
    this.shouldRun = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      return new Promise((resolve) => {
        if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
          this.ws = null;
          this.isConnectedState = false;
          return resolve();
        }
        this.ws.once("close", () => {
          this.ws = null;
          this.isConnectedState = false;
          resolve();
        });
        this.ws.close();
      });
    }
  }

  private handleRawMessage(raw: WebSocket.RawData): void {
    let msg: BridgeRequestMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e: any) {
      logger.error(`[MockClient] Received invalid JSON message: ${e.message}`);
      return;
    }

    if (!msg.id || !msg.command) {
      logger.warn("[MockClient] Received envelope missing id or command", msg);
      return;
    }

    let response: BridgeResponseMessage;
    try {
      const result = this.engine.executeCommand(msg.command, msg.params ?? {});
      response = {
        id: msg.id,
        success: true,
        result,
      };
    } catch (err: any) {
      response = {
        id: msg.id,
        success: false,
        error: {
          code: err.code ?? "MOCK_EXECUTION_ERROR",
          message: err.message ?? String(err),
        },
      };
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(response));
    }
  }
}
