export function buildPlaybackFrameNumbers(fromFrame, toFrame, direction) {
    if (!Number.isInteger(fromFrame) || !Number.isInteger(toFrame) || fromFrame < 1 || fromFrame > toFrame) {
        throw new Error("Animation range must use positive integers with fromFrame <= toFrame.");
    }
    const forward = Array.from({ length: toFrame - fromFrame + 1 }, (_, index) => fromFrame + index);
    if (direction === "forward")
        return forward;
    if (direction === "reverse")
        return [...forward].reverse();
    const interior = forward.slice(1, -1);
    if (direction === "pingpong")
        return [...forward, ...interior.reverse()];
    if (direction === "pingpong_reverse")
        return [...forward].reverse().concat(interior);
    throw new Error(`Unsupported animation direction: ${direction}`);
}
function buildFiniteTagPlaybackFrameNumbers(fromFrame, toFrame, direction, repeats) {
    const forward = buildPlaybackFrameNumbers(fromFrame, toFrame, "forward");
    const reverse = [...forward].reverse();
    if (direction === "forward" || direction === "reverse") {
        const pass = direction === "forward" ? forward : reverse;
        return Array.from({ length: repeats }, () => pass).flat();
    }
    const startsForward = direction === "pingpong";
    const result = [];
    for (let passIndex = 0; passIndex < repeats; passIndex++) {
        const forwardPass = passIndex % 2 === 0 ? startsForward : !startsForward;
        const pass = forwardPass ? forward : reverse;
        result.push(...(result.at(-1) === pass[0] ? pass.slice(1) : pass));
    }
    return result;
}
export function resolveAnimationPlayback(inspection, input) {
    if (!Array.isArray(inspection.frames) || inspection.frames.length < 1) {
        throw new Error("The active sprite has no animation frames.");
    }
    if (input.tagName && (input.fromFrame !== undefined || input.toFrame !== undefined)) {
        throw new Error("tagName is mutually exclusive with fromFrame/toFrame.");
    }
    if ((input.fromFrame === undefined) !== (input.toFrame === undefined)) {
        throw new Error("fromFrame and toFrame must be provided together.");
    }
    const byNumber = new Map();
    for (const frame of inspection.frames) {
        if (!Number.isInteger(frame.frameNumber) || !Number.isFinite(frame.durationMs) || frame.durationMs <= 0) {
            throw new Error("Aseprite returned invalid animation frame metadata.");
        }
        byNumber.set(frame.frameNumber, frame);
    }
    const lastFrame = Math.max(...byNumber.keys());
    let tag;
    if (input.tagName) {
        tag = inspection.tags.find((candidate) => candidate.name === input.tagName);
        if (!tag)
            throw new Error(`Animation tag not found: '${input.tagName}'.`);
    }
    const fromFrame = tag?.from ?? input.fromFrame ?? 1;
    const toFrame = tag?.to ?? input.toFrame ?? lastFrame;
    if (fromFrame < 1 || toFrame > lastFrame || fromFrame > toFrame) {
        throw new Error(`Frame range must satisfy 1 <= fromFrame <= toFrame <= ${lastFrame}.`);
    }
    const direction = input.direction ?? tag?.direction ?? "forward";
    const repeats = tag ? Math.max(0, Math.floor(tag.repeats ?? 0)) : null;
    if (repeats !== null && !Number.isFinite(repeats)) {
        throw new Error("Aseprite returned invalid animation tag repeat metadata.");
    }
    const frameNumbers = tag && repeats > 0
        ? buildFiniteTagPlaybackFrameNumbers(fromFrame, toFrame, direction, repeats)
        : buildPlaybackFrameNumbers(fromFrame, toFrame, direction);
    const frames = frameNumbers.map((frameNumber, index) => {
        const frame = byNumber.get(frameNumber);
        if (!frame)
            throw new Error(`Aseprite did not return metadata for frame ${frameNumber}.`);
        return { ...frame, sequenceIndex: index + 1 };
    });
    const totalDurationMs = frames.reduce((sum, frame) => sum + frame.durationMs, 0);
    const distinctDurations = new Set(frames.map((frame) => frame.durationMs));
    return {
        tagName: tag?.name ?? null,
        fromFrame,
        toFrame,
        direction,
        repeats,
        loopsContinuously: repeats === 0 && tag !== undefined,
        frameNumbers,
        frames,
        totalDurationMs,
        averageFps: totalDurationMs > 0 ? 1000 * frames.length / totalDurationMs : 0,
        variableTiming: distinctDurations.size > 1,
    };
}
//# sourceMappingURL=animationSelection.js.map