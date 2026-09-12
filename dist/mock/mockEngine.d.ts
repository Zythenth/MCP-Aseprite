import type { AsepriteStatusResult } from "../bridge/protocol.js";
export declare const MAX_CHANGE_JOURNAL_ENTRIES = 128;
export interface PixelJournalEntry {
    revision: number;
    pixelsChanged: number;
    bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
}
export interface MockCelBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface MockCel {
    layerIndex: number;
    frameNumber: number;
    bounds: MockCelBounds;
    pixels: Uint32Array;
}
export interface MockLayer {
    index: number;
    name: string;
    isVisible: boolean;
    isEditable: boolean;
    isLocked: boolean;
    opacity: number;
    blendMode: "normal" | "multiply" | "screen" | "overlay";
    isGroup: boolean;
    isBackground: boolean;
    parentIndex: number | null;
}
export interface MockFrame {
    frameNumber: number;
    duration: number;
}
export interface PixelDelta {
    layerIndex: number;
    frameNumber: number;
    x: number;
    y: number;
    prevColor: number;
    newColor: number;
}
export interface MockTransaction {
    id: string;
    name: string;
    revisionBefore: number;
    revisionAfter: number;
    pixelDeltas: PixelDelta[];
}
export declare function packRgba(r: number, g: number, b: number, a: number): number;
export declare function unpackRgba(color: number): {
    r: number;
    g: number;
    b: number;
    a: number;
};
export declare function hexToRgba(hex: string): number;
export declare function rgbaToHex(color: number): string;
export declare class MockAsepriteEngine {
    hasActiveSprite: boolean;
    filename: string;
    width: number;
    height: number;
    colorMode: "rgb" | "indexed" | "grayscale";
    layers: MockLayer[];
    frames: MockFrame[];
    cels: Map<string, MockCel>;
    activeLayerIndex: number;
    activeFrameNumber: number;
    revision: number;
    undoStack: MockTransaction[];
    redoStack: MockTransaction[];
    changeJournal: PixelJournalEntry[];
    palette: Uint32Array;
    tags: Array<{
        name: string;
        from: number;
        to: number;
        color?: string;
    }>;
    mockExistingFiles: Set<string>;
    constructor(width?: number, height?: number);
    reset(width?: number, height?: number): void;
    getOrCreateCel(layerIndex: number, frameNumber: number): MockCel;
    getCelPixel(cel: MockCel, canvasX: number, canvasY: number): number;
    setCelPixel(cel: MockCel, canvasX: number, canvasY: number, color: number): void;
    getCompositeBuffer(frameNumber?: number): Uint32Array;
    exportFramePngBase64(frameNumber?: number, targetLayer?: MockLayer): string;
    resolveTargetLayer(params: Record<string, any>, forWriting?: boolean): MockLayer;
    resolveTargetFrame(rawFrame: any): MockFrame;
    getStatus(): AsepriteStatusResult;
    executeCommand(command: string, params: Record<string, any>): any;
}
//# sourceMappingURL=mockEngine.d.ts.map