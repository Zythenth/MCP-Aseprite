export function bridgeToolResult(result, stateTracker, returnPreview = false) {
    if (typeof result?.revision === "number")
        stateTracker.setRevision(result.revision);
    const content = [];
    if (returnPreview && typeof result?.pngBase64 === "string") {
        content.push({ type: "image", data: result.pngBase64, mimeType: "image/png" });
    }
    const textResult = result && typeof result === "object" && typeof result.pngBase64 === "string"
        ? { ...result, pngBase64: undefined }
        : result;
    content.push({ type: "text", text: JSON.stringify(textResult, null, 2) });
    return { content };
}
export function bridgeToolError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: message }, null, 2) }],
        isError: true,
    };
}
export function confirmationError(operation) {
    return {
        content: [{
                type: "text",
                text: JSON.stringify({ success: false, error: `${operation} requires confirm: true` }, null, 2),
            }],
        isError: true,
    };
}
//# sourceMappingURL=common.js.map