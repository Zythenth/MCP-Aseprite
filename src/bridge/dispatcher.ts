/**
 * src/bridge/dispatcher.ts
 * Correlated JSON-RPC command envelope dispatcher with request IDs and timeouts.
 */

import { WebSocket } from "ws";
import { EventEmitter } from "node:events";
import { logger } from "../logger.js";
import {
  BridgeErrorCode,
  BridgeError,
  DEFAULT_COMMAND_TIMEOUT_MS,
  isBridgeResponseMessage,
  isBridgeEventMessage,
  type BridgeEventMessage,
  type BridgeRequestMessage,
  type BridgeResponseMessage,
} from "./protocol.js";
import { MAX_BRIDGE_PAYLOAD_BYTES, MAX_PENDING_COMMANDS } from "../config.js";

interface DeferredRequest<T> {
  id: string;
  command: string;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
  sentAt: number;
  timeoutMs: number;
}

export interface CommandDispatcherOptions {
  maxPendingCommands?: number;
  maxPayloadBytes?: number;
}

export class CommandDispatcher extends EventEmitter {
  private activeSocket: WebSocket | null = null;
  private pending = new Map<string, DeferredRequest<any>>();
  private counter: number = 0;
  private readonly maxPendingCommands: number;
  private readonly maxPayloadBytes: number;

  constructor(options: CommandDispatcherOptions = {}) {
    super();
    this.maxPendingCommands = options.maxPendingCommands ?? MAX_PENDING_COMMANDS;
    this.maxPayloadBytes = options.maxPayloadBytes ?? MAX_BRIDGE_PAYLOAD_BYTES;
  }

  public setActiveSocket(socket: WebSocket | null): void {
    this.activeSocket = socket;
  }

  public isConnected(): boolean {
    return this.activeSocket !== null && this.activeSocket.readyState === WebSocket.OPEN;
  }

  public generateId(): string {
    const ts = Date.now();
    const count = ++this.counter;
    const rnd = Math.random().toString(36).substring(2, 7);
    return `req_${ts}_${count}_${rnd}`;
  }

  public async send<T = unknown>(
    command: string,
    params: Record<string, unknown> = {},
    timeoutMs: number = DEFAULT_COMMAND_TIMEOUT_MS
  ): Promise<T> {
    if (!this.isConnected()) {
      throw new BridgeError(
        "Aseprite is not connected via WebSocket bridge. Please start the bridge script in Aseprite.",
        BridgeErrorCode.DISCONNECTED
      );
    }

    if (this.pending.size >= this.maxPendingCommands) {
      throw new BridgeError(
        `Maximum pending bridge requests reached (${this.maxPendingCommands})`,
        BridgeErrorCode.INVALID_PARAMS,
        { pendingCount: this.pending.size, maxPending: this.maxPendingCommands }
      );
    }

    const id = this.generateId();
    const requestMessage: BridgeRequestMessage = { id, command, params };
    const serialized = JSON.stringify(requestMessage);
    const payloadBytes = Buffer.byteLength(serialized, "utf-8");

    if (payloadBytes > this.maxPayloadBytes) {
      throw new BridgeError(
        `Request payload exceeds maximum allowed size (${payloadBytes} bytes > ${this.maxPayloadBytes} bytes)`,
        BridgeErrorCode.INVALID_PARAMS,
        { byteLength: payloadBytes, maxPayloadBytes: this.maxPayloadBytes }
      );
    }

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const timeoutError = new BridgeError(
          `Command '${command}' timed out after ${timeoutMs}ms`,
          BridgeErrorCode.TIMEOUT
        );
        logger.warn(`Command timeout`, { id, command, timeoutMs });
        reject(timeoutError);
      }, timeoutMs);

      const deferred: DeferredRequest<T> = {
        id,
        command,
        resolve,
        reject,
        timer,
        sentAt: Date.now(),
        timeoutMs,
      };

      this.pending.set(id, deferred);

      this.activeSocket!.send(serialized, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          logger.error(`Failed to send command '${command}' over WebSocket: ${err.message}`);
          reject(new BridgeError(`Socket transmission error: ${err.message}`, BridgeErrorCode.EXECUTION_ERROR));
        }
      });
    });
  }

  public handleIncomingMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      logger.warn(`Received non-JSON message over bridge WebSocket: ${raw.slice(0, 150)}`);
      return;
    }

    if (isBridgeResponseMessage(parsed)) {
      this.handleResponse(parsed);
      return;
    }

    if (isBridgeEventMessage(parsed)) {
      this.handleEvent(parsed);
      return;
    }

    logger.warn(`Unrecognized envelope received over bridge WebSocket`, { preview: raw.slice(0, 150) });
  }

  private handleResponse(msg: BridgeResponseMessage): void {
    const deferred = this.pending.get(msg.id);
    if (!deferred) {
      logger.warn(`Received response for unknown or already timed-out request ID: ${msg.id}`);
      return;
    }

    clearTimeout(deferred.timer);
    this.pending.delete(msg.id);

    const elapsed = Date.now() - deferred.sentAt;
    logger.debug(`Command '${deferred.command}' completed in ${elapsed}ms`, { id: msg.id, success: msg.success });

    if (msg.success) {
      deferred.resolve(msg.result);
    } else {
      const errCode = msg.error?.code || BridgeErrorCode.EXECUTION_ERROR;
      const errMsg = msg.error?.message || `Bridge command '${deferred.command}' failed`;
      deferred.reject(new BridgeError(errMsg, errCode, msg.error?.details));
    }
  }

  private handleEvent(msg: BridgeEventMessage): void {
    const eventName = msg.event;
    const eventData = msg.data || msg.params || {};
    logger.debug(`Bridge unsolicited event: ${eventName}`, eventData);
    if (eventName !== "error" || this.listenerCount("error") > 0) {
      this.emit(eventName, eventData);
    } else {
      logger.warn(`Bridge unsolicited error event received without error listener:`, eventData);
    }
    this.emit("bridge_event", { event: eventName, data: eventData });
  }

  public clearActiveSocket(reason: string): void {
    this.activeSocket = null;
    const count = this.pending.size;
    if (count > 0) {
      logger.warn(`Aborting ${count} pending bridge commands due to disconnect: ${reason}`);
      for (const req of this.pending.values()) {
        clearTimeout(req.timer);
        req.reject(
          new BridgeError(
            `Command '${req.command}' aborted: ${reason}`,
            BridgeErrorCode.DISCONNECTED
          )
        );
      }
      this.pending.clear();
    }
  }

  public getPendingCount(): number {
    return this.pending.size;
  }
}
