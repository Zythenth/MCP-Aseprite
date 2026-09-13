import { BufferSizeMismatchError, InvalidDimensionError } from "./png.js";
function validateImage(image) {
    if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width <= 0 || image.height <= 0) {
        throw new InvalidDimensionError(image.width, image.height);
    }
    const expected = image.width * image.height * 4;
    if (image.data.length < expected)
        throw new BufferSizeMismatchError(expected, image.data.length);
}
function requireMatchingFrames(frames) {
    if (frames.length === 0)
        throw new Error("At least one frame is required.");
    for (const frame of frames)
        validateImage(frame);
    const { width, height } = frames[0];
    if (frames.some((frame) => frame.width !== width || frame.height !== height)) {
        throw new Error("All frames must have identical dimensions.");
    }
    return { width, height };
}
export function composeFilmstrip(frames, columns, gap = 1) {
    const { width, height } = requireMatchingFrames(frames);
    const safeColumns = Math.max(1, Math.min(frames.length, Math.floor(columns)));
    const safeGap = Math.max(0, Math.floor(gap));
    const rows = Math.ceil(frames.length / safeColumns);
    const outputWidth = safeColumns * width + (safeColumns - 1) * safeGap;
    const outputHeight = rows * height + (rows - 1) * safeGap;
    const data = new Uint8Array(outputWidth * outputHeight * 4);
    frames.forEach((frame, index) => {
        const originX = (index % safeColumns) * (width + safeGap);
        const originY = Math.floor(index / safeColumns) * (height + safeGap);
        for (let y = 0; y < height; y++) {
            const srcStart = y * width * 4;
            const dstStart = ((originY + y) * outputWidth + originX) * 4;
            data.set(frame.data.subarray(srcStart, srcStart + width * 4), dstStart);
        }
    });
    return { width: outputWidth, height: outputHeight, data };
}
function blendPixel(output, offset, red, green, blue, alpha) {
    const sourceAlpha = Math.max(0, Math.min(1, alpha));
    if (sourceAlpha <= 0)
        return;
    const targetAlpha = output[offset + 3] / 255;
    const finalAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
    if (finalAlpha <= 0)
        return;
    output[offset] = Math.round((red * sourceAlpha + output[offset] * targetAlpha * (1 - sourceAlpha)) / finalAlpha);
    output[offset + 1] = Math.round((green * sourceAlpha + output[offset + 1] * targetAlpha * (1 - sourceAlpha)) / finalAlpha);
    output[offset + 2] = Math.round((blue * sourceAlpha + output[offset + 2] * targetAlpha * (1 - sourceAlpha)) / finalAlpha);
    output[offset + 3] = Math.round(finalAlpha * 255);
}
export function composeOnionSkin(previousFrames, currentFrame, nextFrames, opacity = 0.35) {
    const allFrames = [...previousFrames, currentFrame, ...nextFrames];
    const { width, height } = requireMatchingFrames(allFrames);
    const output = new Uint8Array(width * height * 4);
    const safeOpacity = Math.max(0, Math.min(1, opacity));
    const applyGhost = (frame, color, distance) => {
        const distanceOpacity = safeOpacity / Math.max(1, distance);
        for (let offset = 0; offset < output.length; offset += 4) {
            const alpha = (frame.data[offset + 3] / 255) * distanceOpacity;
            blendPixel(output, offset, color[0], color[1], color[2], alpha);
        }
    };
    previousFrames.forEach((frame, index) => applyGhost(frame, [255, 72, 96], previousFrames.length - index));
    [...nextFrames].reverse().forEach((frame, index) => applyGhost(frame, [72, 208, 128], nextFrames.length - index));
    for (let offset = 0; offset < output.length; offset += 4) {
        blendPixel(output, offset, currentFrame.data[offset], currentFrame.data[offset + 1], currentFrame.data[offset + 2], currentFrame.data[offset + 3] / 255);
    }
    return { width, height, data: output };
}
export function compareFrames(before, after, threshold = 0) {
    const { width, height } = requireMatchingFrames([before, after]);
    const safeThreshold = Math.max(0, Math.min(255, Math.floor(threshold)));
    const data = new Uint8Array(width * height * 4);
    let changedPixels = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let pixel = 0; pixel < width * height; pixel++) {
        const offset = pixel * 4;
        let difference = 0;
        for (let channel = 0; channel < 4; channel++) {
            difference = Math.max(difference, Math.abs(before.data[offset + channel] - after.data[offset + channel]));
        }
        const changed = difference > safeThreshold;
        if (changed) {
            const x = pixel % width;
            const y = Math.floor(pixel / width);
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
            changedPixels++;
            data[offset] = 255;
            data[offset + 1] = Math.round(after.data[offset + 1] * 0.25);
            data[offset + 2] = 192;
            data[offset + 3] = 255;
        }
        else {
            const luminance = Math.round(after.data[offset] * 0.2126 + after.data[offset + 1] * 0.7152 + after.data[offset + 2] * 0.0722);
            data[offset] = luminance;
            data[offset + 1] = luminance;
            data[offset + 2] = luminance;
            data[offset + 3] = Math.round(after.data[offset + 3] * 0.35);
        }
    }
    return {
        width,
        height,
        data,
        changedPixels,
        changeRatio: changedPixels / (width * height),
        bounds: changedPixels === 0 ? null : {
            x: minX,
            y: minY,
            width: maxX - minX + 1,
            height: maxY - minY + 1,
        },
    };
}
//# sourceMappingURL=animation.js.map