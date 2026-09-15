import { type ImageBuffer } from "./png.js";
export interface BridgeCanvasPayload {
    width: number;
    height: number;
    pngBase64?: string;
    rgbaBase64?: string;
}
export interface BridgePreviewPayload {
    preview?: BridgeCanvasPayload;
    width?: number;
    height?: number;
    pngBase64?: string;
    rgbaBase64?: string;
}
export declare function decodeBridgeCanvas(payload: BridgeCanvasPayload): ImageBuffer;
export declare function bridgeCanvasPngBase64(payload: BridgeCanvasPayload): string;
export declare function bridgePreviewPngBase64(payload: BridgePreviewPayload): string | undefined;
//# sourceMappingURL=bridgeCanvas.d.ts.map