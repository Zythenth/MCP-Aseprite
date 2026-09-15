import type { BridgeState } from "../../bridge/state.js";
import { bridgePreviewPngBase64 } from "../../image/bridgeCanvas.js";

export function bridgeToolResult(
  result: any,
  stateTracker: BridgeState,
  returnPreview = false
): any {
  if (typeof result?.revision === "number") stateTracker.setRevision(result.revision);
  const content: any[] = [];
  const previewPng = returnPreview ? bridgePreviewPngBase64(result ?? {}) : undefined;
  if (previewPng) {
    content.push({ type: "image" as const, data: previewPng, mimeType: "image/png" });
  }
  const textResult = result && typeof result === "object"
    ? { ...result, pngBase64: undefined, rgbaBase64: undefined, preview: undefined }
    : result;
  content.push({ type: "text" as const, text: JSON.stringify(textResult, null, 2) });
  return { content };
}

export function bridgeToolError(error: unknown): any {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: message }, null, 2) }],
    isError: true,
  };
}

export function confirmationError(operation: string): any {
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({ success: false, error: `${operation} requires confirm: true` }, null, 2),
    }],
    isError: true,
  };
}

export function requireBridgeCapability(state: BridgeState, capability: string): void {
  if (!state.getCapabilities()[capability]) {
    throw new Error(
      `The connected Aseprite bridge does not advertise '${capability}'. Reinstall the bundled Lua bridge.`
    );
  }
}
