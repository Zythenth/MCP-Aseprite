import type { ImageBuffer } from "../image/png.js";
import type { PixelArtFinding } from "../image/pixelArt.js";
export interface ReviewCheckpoint {
    id: string;
    label: string;
    createdAt: string;
    sessionId: string;
    revision: number;
    frameNumber: number;
    layerName?: string;
    image: ImageBuffer;
}
export interface LintWaiver {
    id: string;
    rule: PixelArtFinding["rule"];
    reason: string;
    createdAt: string;
    sessionId: string;
    frameNumber?: number;
    layerName?: string;
    x?: number;
    y?: number;
}
export declare class ReviewState {
    private readonly checkpoints;
    private readonly waivers;
    addCheckpoint(checkpoint: Omit<ReviewCheckpoint, "id" | "createdAt">): ReviewCheckpoint;
    getCheckpoint(id: string): ReviewCheckpoint | undefined;
    listCheckpoints(sessionId?: string): Array<Omit<ReviewCheckpoint, "image"> & {
        width: number;
        height: number;
    }>;
    deleteCheckpoint(id: string): boolean;
    addWaiver(waiver: Omit<LintWaiver, "id" | "createdAt">): LintWaiver;
    listWaivers(sessionId?: string): LintWaiver[];
    deleteWaiver(id: string): boolean;
    applyWaivers(findings: PixelArtFinding[], context: {
        sessionId: string;
        frameNumber?: number;
        layerName?: string;
    }): {
        findings: PixelArtFinding[];
        suppressed: Array<{
            finding: PixelArtFinding;
            waiverId: string;
        }>;
    };
}
//# sourceMappingURL=reviewState.d.ts.map