// src/image/preview.ts
import { generatePixelGridPreview as generatePreview } from "./index.js";
/**
 * Generates an enhanced pixel-art preview with nearest-neighbor scaling,
 * pixel grid separators, coordinate rulers, and region highlights.
 * Delegates to the unified image pipeline in src/image/index.ts.
 */
export function generatePixelGridPreview(rawRgba, spriteWidth, spriteHeight, options = {}) {
    return generatePreview(rawRgba, spriteWidth, spriteHeight, options);
}
//# sourceMappingURL=preview.js.map