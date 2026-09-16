import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { MAX_BRIDGE_PAYLOAD_BYTES } from "../config.js";
import { logger } from "../logger.js";
import {
  BRIDGE_PROTOCOL_VERSION,
  SHARED_BRIDGE_PROTOCOL_VERSION,
  isBridgeProtocolCompatible,
  type AsepriteStatusResult,
  type BridgePeerAckMessage,
  type BridgePeerHelloMessage,
  type BridgePeerStateMessage,
} from "./protocol.js";
import type { CommandDispatcher } from "./dispatcher.js";
import type { BridgeState } from "./state.js";

export interface SharedBridgeClientOptions {
  host: string;
  port: number;
  token?: string;
  handshakeTimeoutMs?: number;
}

function isStatusResult(value: unknown): value is AsepriteStatusResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const status = value as Record<string, unknown>;
  return (
    typeof status.connected === "boolean" &&
    typeof status.hasActiveSprite === "boolean" &&
    typeof status.filename === "string" &&
    typeof status.width === "number" &&
    typeof status.height === "number" &&
    typeof status.colorMode === "string" &&
    typeof status.layersCount === "number" &&
    typeof status.framesCount === "number" &&
    typeof status.activeLayer === "string" &&
    typeof status.activeFrame === "number" &&
    Number.isSafeInteger(status.revision) &&
    (status.revision as number) >= 0
  );
}

export class SharedBridgeClient extends EventEmitter {
  private socket: WebSocket | null = null;
  private closing = false;
  private readonly dispatcher: CommandDispatcher;
  private readonly state: BridgeState;
  private readonly host: string;
  private readonly port: number;
  private readonly token?: string;
  private readonly handshakeTimeoutMs: number;

  constructor(
    dispatcher: CommandDispatcher,
    state: BridgeState,
    options: SharedBridgeClientOptions
  ) {
    super();
    this.dispatcher = dispatcher;
    this.state = state;
    this.host = options.host;
    this.port = options.port;
    this.token = options.token;
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? 5_000;
  }

  public async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return;

    this.closing = false;
    const socket = new WebSocket(`ws://${this.host}:${this.port}`, {
      maxPayload: MAX_BRIDGE_PAYLOAD_BYTES,
    });
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      let acknowledged = false;
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(handshakeTimer);
        if (error) reject(error);
        else resolve();
      };
      const handshakeTimer = setTimeout(() => {
        socket.close(1008, "Shared bridge handshake timeout");
        finish(new Error("Timed out while connecting to the shared Aseprite bridge owner"));
      }, this.handshakeTimeoutMs);

      socket.on("open", () => {
        const hello: BridgePeerHelloMessage = {
          event: "peer_hello",
          data: {
            bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION,
            sharedBridgeProtocolVersion: SHARED_BRIDGE_PROTOCOL_VERSION,
            clientId: `mcp-${process.pid}-${randomUUID()}`,
            ...(this.token ? { token: this.token } : {}),
          },
        };
        socket.send(JSON.stringify(hello));
      });

      socket.on("message", (data: WebSocket.RawData, isBinary: boolean) => {
        if (isBinary) {
          socket.close(1003, "Shared bridge messages must be text JSON");
          return;
        }

        const raw = data.toString("utf-8");
        let message: unknown;
        try {
          message = JSON.parse(raw);
        } catch {
          socket.close(1002, "Invalid shared bridge JSON");
          return;
        }

        if (!acknowledged) {
          const ack = message as Partial<BridgePeerAckMessage>;
          if (
            ack.event !== "peer_ack" ||
            !ack.data ||
            !isBridgeProtocolCompatible(ack.data.bridgeProtocolVersion) ||
            ack.data.sharedBridgeProtocolVersion !== SHARED_BRIDGE_PROTOCOL_VERSION ||
            !isStatusResult(ack.data.status)
          ) {
            socket.close(1002, "Invalid shared bridge acknowledgement");
            finish(new Error("Port owner is not a compatible aseprite-mcp shared bridge"));
            return;
          }

          acknowledged = true;
          this.applyOwnerStatus(ack.data.status);
          finish();
          return;
        }

        const stateMessage = message as Partial<BridgePeerStateMessage>;
        if (stateMessage.event === "peer_state") {
          if (!stateMessage.data || !isStatusResult(stateMessage.data.status)) {
            socket.close(1002, "Invalid shared bridge state update");
            return;
          }
          this.applyOwnerStatus(stateMessage.data.status);
          return;
        }

        this.dispatcher.handleIncomingMessage(raw);
      });

      socket.on("close", (code, reason) => {
        const reasonText = reason.toString("utf-8") || "connection closed";
        this.deactivate(`Shared bridge owner disconnected (${code}: ${reasonText})`);
        if (!acknowledged) {
          finish(new Error(`Could not connect to shared bridge owner: ${reasonText}`));
        }
        if (!this.closing) this.emit("disconnect", { code, reason: reasonText });
      });

      socket.on("error", (error) => {
        logger.debug(`Shared bridge peer socket error: ${error.message}`);
        if (!acknowledged) finish(error);
      });
    });
  }

  private applyOwnerStatus(status: AsepriteStatusResult): void {
    const socket = this.socket;
    if (status.connected && socket?.readyState === WebSocket.OPEN) {
      this.dispatcher.setActiveSocket(socket);
      this.state.applyStatus(status, `shared:${this.host}:${this.port}`);
      return;
    }

    if (this.dispatcher.isConnected()) {
      this.dispatcher.clearActiveSocket("Shared bridge owner reports that Aseprite is disconnected");
    }
    this.state.applyStatus(status);
  }

  private deactivate(reason: string): void {
    if (this.dispatcher.isConnected()) this.dispatcher.clearActiveSocket(reason);
    this.state.setConnected(false);
    this.socket = null;
  }

  public isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  public async close(): Promise<void> {
    this.closing = true;
    const socket = this.socket;
    if (!socket || socket.readyState === WebSocket.CLOSED) {
      this.deactivate("Shared bridge peer stopped");
      return;
    }

    await new Promise<void>((resolve) => {
      socket.once("close", () => resolve());
      socket.close(1000, "Shared bridge peer stopped");
    });
  }
}
