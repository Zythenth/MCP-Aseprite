export type PixelGrid = string[][];
export declare function buildClusterTween(source: PixelGrid, target: PixelGrid, progress: number, easing?: "linear" | "ease_in_out"): {
    grid: PixelGrid;
    movedClusters: number;
    unmatchedClusters: number;
};
export declare function buildSmearFrame(source: PixelGrid, target: PixelGrid, stretch: number): {
    grid: PixelGrid;
    motion: {
        x: number;
        y: number;
    };
    pixelsStretched: number;
};
//# sourceMappingURL=pixelMotion.d.ts.map