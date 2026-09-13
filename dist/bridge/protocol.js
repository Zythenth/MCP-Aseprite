/**
 * src/bridge/protocol.ts
 * Wire protocol interfaces, envelopes, error codes, and payload contracts
 * for communication between Node.js MCP Server and Aseprite Bridge (Lua / Mock).
 */
export const DEFAULT_BRIDGE_PORT = 32123;
export const DEFAULT_BRIDGE_HOST = "127.0.0.1";
export const DEFAULT_COMMAND_TIMEOUT_MS = 8000;
export const BRIDGE_PROTOCOL_VERSION = "1.2.0";
export function isBridgeProtocolCompatible(version) {
    if (typeof version !== "string")
        return false;
    const candidate = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
    const current = /^(\d+)\.(\d+)\.(\d+)$/.exec(BRIDGE_PROTOCOL_VERSION);
    return candidate !== null && current !== null && candidate[1] === current[1];
}
export var BridgeErrorCode;
(function (BridgeErrorCode) {
    BridgeErrorCode["NO_ACTIVE_SPRITE"] = "NO_ACTIVE_SPRITE";
    BridgeErrorCode["INVALID_PARAMS"] = "INVALID_PARAMS";
    BridgeErrorCode["OUT_OF_BOUNDS"] = "OUT_OF_BOUNDS";
    BridgeErrorCode["LOCKED_LAYER"] = "LOCKED_LAYER";
    BridgeErrorCode["INVALID_LAYER"] = "INVALID_LAYER";
    BridgeErrorCode["INVALID_FRAME"] = "INVALID_FRAME";
    BridgeErrorCode["EXECUTION_ERROR"] = "EXECUTION_ERROR";
    BridgeErrorCode["TIMEOUT"] = "TIMEOUT";
    BridgeErrorCode["DISCONNECTED"] = "DISCONNECTED";
    BridgeErrorCode["UNKNOWN_COMMAND"] = "UNKNOWN_COMMAND";
    BridgeErrorCode["CONFIRMATION_REQUIRED"] = "CONFIRMATION_REQUIRED";
    BridgeErrorCode["CANNOT_DELETE_LAST_LAYER"] = "CANNOT_DELETE_LAST_LAYER";
    BridgeErrorCode["CANNOT_DELETE_LAST_FRAME"] = "CANNOT_DELETE_LAST_FRAME";
})(BridgeErrorCode || (BridgeErrorCode = {}));
export function isBridgeResponseMessage(msg) {
    return (typeof msg === "object" &&
        msg !== null &&
        "id" in msg &&
        typeof msg.id === "string" &&
        "success" in msg &&
        typeof msg.success === "boolean");
}
export function isBridgeEventMessage(msg) {
    return (typeof msg === "object" &&
        msg !== null &&
        "event" in msg &&
        typeof msg.event === "string");
}
export class BridgeError extends Error {
    code;
    details;
    constructor(message, code = BridgeErrorCode.EXECUTION_ERROR, details) {
        super(message);
        this.name = "BridgeError";
        this.code = code;
        this.details = details;
        Object.setPrototypeOf(this, BridgeError.prototype);
    }
}
//# sourceMappingURL=protocol.js.map