/**
 * src/bridge/dispatcher.ts
 * Correlated JSON-RPC command envelope dispatcher with request IDs and timeouts.
 */
import { WebSocket } from "ws";
import { EventEmitter } from "node:events";
export declare class CommandDispatcher extends EventEmitter {
    private activeSocket;
    private pending;
    private counter;
    setActiveSocket(socket: WebSocket | null): void;
    isConnected(): boolean;
    generateId(): string;
    send<T = unknown>(command: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
    handleIncomingMessage(raw: string): void;
    private handleResponse;
    private handleEvent;
    clearActiveSocket(reason: string): void;
    getPendingCount(): number;
}
//# sourceMappingURL=dispatcher.d.ts.map