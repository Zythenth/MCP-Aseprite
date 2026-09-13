import { type ImageBuffer } from "./png.js";
export interface ChangedBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface FrameDiffResult extends ImageBuffer {
    changedPixels: number;
    changeRatio: number;
    bounds: ChangedBounds | null;
}
export declare function composeFilmstrip(frames: ImageBuffer[], columns: number, gap?: number): ImageBuffer;
export declare function composeOnionSkin(previousFrames: ImageBuffer[], currentFrame: ImageBuffer, nextFrames: ImageBuffer[], opacity?: number): ImageBuffer;
export declare function compareFrames(before: ImageBuffer, after: ImageBuffer, threshold?: number): FrameDiffResult;
//# sourceMappingURL=animation.d.ts.map