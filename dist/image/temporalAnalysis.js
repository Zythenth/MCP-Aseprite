import { createHash } from "node:crypto";
export const MAX_ANALYSIS_FRAMES = 64;
export const MAX_AGGREGATE_INPUT_PIXELS = 67_108_864;
export const MAX_RIGID_REGIONS = 16;
export const MAX_CONTACT_POINTS = 16;
export const MAX_CONTACT_POSITIONS_PER_POINT = 64;
export const MAX_FINDINGS_LIMIT = 128;
export const ALL_TEMPORAL_RULES = [
    "unexpected_duplicate_frame",
    "adjacent_pixel_diff_spike",
    "bounds_change_spike",
    "visual_center_jump",
    "occupied_area_spike",
    "isolated_pixel_flicker",
    "palette_variation",
    "rigid_region_instability",
    "contact_point_displacement",
    "loop_continuity_mismatch",
    "duration_inconsistency",
    "anomalous_cel_position_jump",
];
export function computeCanonicalTemporalHash(width, height, frameNumbers, durationsMs, frames) {
    if (!Number.isInteger(width) || !Number.isFinite(width) || width <= 0) {
        throw new Error(`Invalid width for canonical temporal hash: ${width}. Expected positive finite integer.`);
    }
    if (!Number.isInteger(height) || !Number.isFinite(height) || height <= 0) {
        throw new Error(`Invalid height for canonical temporal hash: ${height}. Expected positive finite integer.`);
    }
    if (!Array.isArray(frameNumbers) || !Array.isArray(durationsMs) || !Array.isArray(frames)) {
        throw new Error("frameNumbers, durationsMs, and frames must be arrays.");
    }
    if (frames.length === 0) {
        throw new Error("At least one frame is required for temporal hash calculation.");
    }
    if (frameNumbers.length !== frames.length || durationsMs.length !== frames.length) {
        throw new Error(`Array length mismatch in temporal hash: frameNumbers (${frameNumbers.length}), durationsMs (${durationsMs.length}), frames (${frames.length}).`);
    }
    for (let i = 0; i < frameNumbers.length; i++) {
        const fn = frameNumbers[i];
        if (!Number.isInteger(fn) || !Number.isFinite(fn) || fn < 1) {
            throw new Error(`frameNumbers[${i}] must be a positive finite integer.`);
        }
        const dur = durationsMs[i];
        if (!Number.isInteger(dur) || !Number.isFinite(dur) || dur < 0) {
            throw new Error(`durationsMs[${i}] must be a non-negative finite integer.`);
        }
    }
    const expectedBytes = width * height * 4;
    for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        if (f.width !== width || f.height !== height) {
            throw new Error(`Frame at index ${i} has mismatched dimensions (${f.width}x${f.height}), expected ${width}x${height}.`);
        }
        if (f.data.byteLength !== expectedBytes) {
            throw new Error(`Frame at index ${i} has byteLength ${f.data.byteLength}, expected exactly ${expectedBytes} (${width}x${height}*4).`);
        }
    }
    const hash = createHash("sha256");
    // Domain version header
    hash.update(Buffer.from("aseprite-temporal-v1\0", "utf8"));
    // Length-prefixed binary metadata: width (uint32BE), height (uint32BE), frameCount (uint32BE)
    const metaBuf = Buffer.alloc(12);
    metaBuf.writeUInt32BE(width, 0);
    metaBuf.writeUInt32BE(height, 4);
    metaBuf.writeUInt32BE(frames.length, 8);
    hash.update(metaBuf);
    // Length-prefixed binary frameNumbers: count (uint32BE) + each uint32BE
    const fnBuf = Buffer.alloc(4 + frameNumbers.length * 4);
    fnBuf.writeUInt32BE(frameNumbers.length, 0);
    for (let i = 0; i < frameNumbers.length; i++) {
        fnBuf.writeUInt32BE(frameNumbers[i], 4 + i * 4);
    }
    hash.update(fnBuf);
    // Length-prefixed binary durationsMs: count (uint32BE) + each uint32BE
    const durBuf = Buffer.alloc(4 + durationsMs.length * 4);
    durBuf.writeUInt32BE(durationsMs.length, 0);
    for (let i = 0; i < durationsMs.length; i++) {
        durBuf.writeUInt32BE(durationsMs[i], 4 + i * 4);
    }
    hash.update(durBuf);
    // Length-prefixed binary frames: each frame has width (uint32BE), height (uint32BE), byteLength (uint32BE), then raw RGBA bytes
    for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        const frameMeta = Buffer.alloc(12);
        frameMeta.writeUInt32BE(f.width, 0);
        frameMeta.writeUInt32BE(f.height, 4);
        frameMeta.writeUInt32BE(f.data.byteLength, 8);
        hash.update(frameMeta);
        hash.update(Buffer.from(f.data.buffer, f.data.byteOffset, f.data.byteLength));
    }
    return hash.digest("hex");
}
function hexColorFromRgba(r, g, b, a) {
    const hex = (v) => v.toString(16).padStart(2, "0").toUpperCase();
    return `#${hex(r)}${hex(g)}${hex(b)}${hex(a)}`;
}
function computeFrameStats(image) {
    const { width, height, data } = image;
    let occupiedArea = 0;
    let sumWeight = 0;
    let sumX = 0;
    let sumY = 0;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    const colors = new Set();
    const data32 = new Uint32Array(data.buffer, data.byteOffset, width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const a = data[idx + 3];
            if (a > 0) {
                occupiedArea++;
                const weight = a / 255;
                sumWeight += weight;
                sumX += x * weight;
                sumY += y * weight;
                if (x < minX)
                    minX = x;
                if (x > maxX)
                    maxX = x;
                if (y < minY)
                    minY = y;
                if (y > maxY)
                    maxY = y;
                colors.add(hexColorFromRgba(data[idx], data[idx + 1], data[idx + 2], a));
            }
        }
    }
    const visualCenter = sumWeight > 0
        ? { x: Number((sumX / sumWeight).toFixed(2)), y: Number((sumY / sumWeight).toFixed(2)) }
        : null;
    const bounds = maxX >= minX && maxY >= minY
        ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
        : null;
    return { occupiedArea, visualCenter, bounds, colors, data32 };
}
function computeFrameDiff(imgA, imgB, pixelThreshold) {
    const { width, height } = imgA;
    const dataA = imgA.data;
    const dataB = imgB.data;
    let changed = 0;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const dr = Math.abs(dataA[idx] - dataB[idx]);
            const dg = Math.abs(dataA[idx + 1] - dataB[idx + 1]);
            const db = Math.abs(dataA[idx + 2] - dataB[idx + 2]);
            const da = Math.abs(dataA[idx + 3] - dataB[idx + 3]);
            if (dr > pixelThreshold || dg > pixelThreshold || db > pixelThreshold || da > pixelThreshold) {
                changed++;
                if (x < minX)
                    minX = x;
                if (x > maxX)
                    maxX = x;
                if (y < minY)
                    minY = y;
                if (y > maxY)
                    maxY = y;
            }
        }
    }
    const changedBounds = maxX >= minX && maxY >= minY
        ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
        : null;
    return { changedPixels: changed, changedBounds };
}
function collectImageLayers(layers) {
    if (!layers)
        return [];
    const result = [];
    function recurse(list) {
        for (const l of list) {
            if (l.isGroup && l.children) {
                recurse(l.children);
            }
            else if (!l.isGroup) {
                result.push(l);
            }
        }
    }
    recurse(layers);
    return result;
}
export function analyzeAnimationTemporalPure(input) {
    const { width, height, playback, frameBuffers, inspectionLayers, rigidRegions, contactPoints } = input;
    const totalFrames = playback.frameNumbers.length;
    if (!Number.isInteger(width) || !Number.isFinite(width) || width <= 0) {
        throw new Error(`Invalid canvas width: ${width}. Expected positive finite integer.`);
    }
    if (!Number.isInteger(height) || !Number.isFinite(height) || height <= 0) {
        throw new Error(`Invalid canvas height: ${height}. Expected positive finite integer.`);
    }
    if (totalFrames === 0) {
        throw new Error("No playback frames available for temporal analysis.");
    }
    if (totalFrames > MAX_ANALYSIS_FRAMES) {
        throw new Error(`Temporal analysis is limited to ${MAX_ANALYSIS_FRAMES} playback frames (received ${totalFrames}).`);
    }
    if (frameBuffers.length !== totalFrames) {
        throw new Error(`Mismatch between playback frame count (${totalFrames}) and frame buffers count (${frameBuffers.length}).`);
    }
    const totalInputPixels = width * height * totalFrames;
    if (!Number.isSafeInteger(totalInputPixels) || totalInputPixels > MAX_AGGREGATE_INPUT_PIXELS) {
        throw new Error(`Animation inputs exceed safety budget of ${MAX_AGGREGATE_INPUT_PIXELS.toLocaleString()} aggregate pixels.`);
    }
    const expectedByteLength = width * height * 4;
    for (let i = 0; i < frameBuffers.length; i++) {
        const f = frameBuffers[i];
        if (f.width !== width || f.height !== height) {
            throw new Error(`Frame buffer at sequence index ${i + 1} has mismatched dimensions (${f.width}x${f.height}), expected ${width}x${height}.`);
        }
        if (f.data.byteLength !== expectedByteLength) {
            throw new Error(`Frame buffer at sequence index ${i + 1} has insufficient byte length (${f.data.byteLength}), expected exactly ${expectedByteLength}.`);
        }
    }
    // Validate rigid regions
    if (rigidRegions) {
        if (rigidRegions.length > MAX_RIGID_REGIONS) {
            throw new Error(`rigidRegions is limited to a maximum of ${MAX_RIGID_REGIONS} regions.`);
        }
        const seenRegionIds = new Set();
        for (const r of rigidRegions) {
            if (!r.id || typeof r.id !== "string" || r.id.trim().length === 0) {
                throw new Error("Each rigid region must have a non-empty string 'id'.");
            }
            if (seenRegionIds.has(r.id)) {
                throw new Error(`Duplicate rigid region id: '${r.id}'.`);
            }
            seenRegionIds.add(r.id);
            if (!Number.isInteger(r.x) || !Number.isFinite(r.x) || !Number.isInteger(r.y) || !Number.isFinite(r.y) ||
                !Number.isInteger(r.width) || !Number.isFinite(r.width) || !Number.isInteger(r.height) || !Number.isFinite(r.height)) {
                throw new Error(`Rigid region '${r.id}' coordinates and dimensions must be finite integers.`);
            }
            if (r.width <= 0 || r.height <= 0) {
                throw new Error(`Rigid region '${r.id}' must have positive width and height.`);
            }
            if (r.x < 0 || r.y < 0 || r.x + r.width > width || r.y + r.height > height) {
                throw new Error(`Rigid region '${r.id}' (${r.x},${r.y},${r.width}x${r.height}) extends outside canvas boundaries (${width}x${height}).`);
            }
        }
    }
    // Validate contact points
    if (contactPoints) {
        if (contactPoints.length > MAX_CONTACT_POINTS) {
            throw new Error(`contactPoints is limited to a maximum of ${MAX_CONTACT_POINTS} points.`);
        }
        const seenPointIds = new Set();
        const validPlaybackFrameSet = new Set(playback.frameNumbers);
        for (const p of contactPoints) {
            if (!p.id || typeof p.id !== "string" || p.id.trim().length === 0) {
                throw new Error("Each contact point must have a non-empty string 'id'.");
            }
            if (seenPointIds.has(p.id)) {
                throw new Error(`Duplicate contact point id: '${p.id}'.`);
            }
            seenPointIds.add(p.id);
            if (!Array.isArray(p.positions) || p.positions.length < 2) {
                throw new Error(`Contact point '${p.id}' must provide 'positions' with at least 2 entries.`);
            }
            if (p.positions.length > MAX_CONTACT_POSITIONS_PER_POINT) {
                throw new Error(`Contact point '${p.id}' positions array exceeds maximum limit of ${MAX_CONTACT_POSITIONS_PER_POINT}.`);
            }
            if (p.maxDisplacement !== undefined) {
                if (typeof p.maxDisplacement !== "number" || !Number.isFinite(p.maxDisplacement) || p.maxDisplacement < 0) {
                    throw new Error(`Contact point '${p.id}' maxDisplacement must be a finite non-negative number.`);
                }
            }
            const seenFramesInPoint = new Set();
            for (const pos of p.positions) {
                if (!Number.isInteger(pos.frameNumber) || !Number.isFinite(pos.frameNumber) || pos.frameNumber < 1) {
                    throw new Error(`Contact point '${p.id}' position frameNumber must be a positive finite integer.`);
                }
                if (seenFramesInPoint.has(pos.frameNumber)) {
                    throw new Error(`Contact point '${p.id}' has duplicate position for frameNumber ${pos.frameNumber}.`);
                }
                seenFramesInPoint.add(pos.frameNumber);
                if (!validPlaybackFrameSet.has(pos.frameNumber)) {
                    throw new Error(`Contact point '${p.id}' references frameNumber ${pos.frameNumber} which is not present in playback sequence.`);
                }
                if (!Number.isInteger(pos.x) || !Number.isFinite(pos.x) || !Number.isInteger(pos.y) || !Number.isFinite(pos.y)) {
                    throw new Error(`Contact point '${p.id}' coordinates must be finite integers.`);
                }
                if (pos.x < 0 || pos.y < 0 || pos.x >= width || pos.y >= height) {
                    throw new Error(`Contact point '${p.id}' position (${pos.x},${pos.y}) is outside canvas boundaries (${width}x${height}).`);
                }
            }
        }
    }
    // Resolve and strictly validate safe thresholds
    const th = input.thresholds ?? {};
    if (th.pixelDiffThreshold !== undefined) {
        if (typeof th.pixelDiffThreshold !== "number" || !Number.isFinite(th.pixelDiffThreshold) || !Number.isInteger(th.pixelDiffThreshold) || th.pixelDiffThreshold < 0 || th.pixelDiffThreshold > 255) {
            throw new Error(`pixelDiffThreshold must be a finite integer between 0 and 255 (received ${th.pixelDiffThreshold}).`);
        }
    }
    if (th.maxAdjacentChangeRatio !== undefined) {
        if (typeof th.maxAdjacentChangeRatio !== "number" || !Number.isFinite(th.maxAdjacentChangeRatio) || th.maxAdjacentChangeRatio < 0 || th.maxAdjacentChangeRatio > 1) {
            throw new Error(`maxAdjacentChangeRatio must be a finite number between 0 and 1 (received ${th.maxAdjacentChangeRatio}).`);
        }
    }
    if (th.maxCenterShift !== undefined) {
        if (typeof th.maxCenterShift !== "number" || !Number.isFinite(th.maxCenterShift) || th.maxCenterShift < 0) {
            throw new Error(`maxCenterShift must be a finite non-negative number (received ${th.maxCenterShift}).`);
        }
    }
    if (th.maxAreaChangeRatio !== undefined) {
        if (typeof th.maxAreaChangeRatio !== "number" || !Number.isFinite(th.maxAreaChangeRatio) || th.maxAreaChangeRatio < 0 || th.maxAreaChangeRatio > 1) {
            throw new Error(`maxAreaChangeRatio must be a finite number between 0 and 1 (received ${th.maxAreaChangeRatio}).`);
        }
    }
    if (th.maxCelPositionJump !== undefined) {
        if (typeof th.maxCelPositionJump !== "number" || !Number.isFinite(th.maxCelPositionJump) || th.maxCelPositionJump < 0) {
            throw new Error(`maxCelPositionJump must be a finite non-negative number (received ${th.maxCelPositionJump}).`);
        }
    }
    if (th.rigidTolerance !== undefined) {
        if (typeof th.rigidTolerance !== "number" || !Number.isFinite(th.rigidTolerance) || th.rigidTolerance < 0 || th.rigidTolerance > 1) {
            throw new Error(`rigidTolerance must be a finite number between 0 and 1 (received ${th.rigidTolerance}).`);
        }
    }
    if (th.maxContactPointDisplacement !== undefined) {
        if (typeof th.maxContactPointDisplacement !== "number" || !Number.isFinite(th.maxContactPointDisplacement) || th.maxContactPointDisplacement < 0) {
            throw new Error(`maxContactPointDisplacement must be a finite non-negative number (received ${th.maxContactPointDisplacement}).`);
        }
    }
    const pixelDiffThreshold = Math.max(0, Math.min(255, Math.floor(th.pixelDiffThreshold ?? 0)));
    const maxAdjacentChangeRatio = Math.max(0, Math.min(1, th.maxAdjacentChangeRatio ?? 0.85));
    const maxCenterShift = Math.max(0, th.maxCenterShift ?? Math.max(width, height) * 0.40);
    const maxAreaChangeRatio = Math.max(0, Math.min(1, th.maxAreaChangeRatio ?? 0.60));
    const maxCelPositionJump = Math.max(0, th.maxCelPositionJump ?? Math.max(width, height) * 0.50);
    const rigidTolerance = Math.max(0, Math.min(1, th.rigidTolerance ?? 0.0));
    const defaultContactThreshold = Math.max(0, th.maxContactPointDisplacement ?? 0);
    const checkLoopContinuity = th.checkLoopContinuity ?? playback.loopsContinuously;
    // Compute per-frame statistics
    const frameStats = frameBuffers.map((buf) => computeFrameStats(buf));
    const canvasArea = width * height;
    const perFrameMetrics = frameStats.map((stats, idx) => ({
        sequenceIndex: idx + 1,
        frameNumber: playback.frameNumbers[idx],
        durationMs: playback.frames[idx]?.durationMs ?? 0,
        occupiedArea: stats.occupiedArea,
        visualCenter: stats.visualCenter,
        bounds: stats.bounds,
        uniqueColors: stats.colors.size,
    }));
    const allColors = new Set();
    const colorFrameCounts = new Map();
    for (const stats of frameStats) {
        for (const c of stats.colors) {
            allColors.add(c);
            colorFrameCounts.set(c, (colorFrameCounts.get(c) ?? 0) + 1);
        }
    }
    // Safe bounded findings accumulator
    let totalFindings = 0;
    let warningCount = 0;
    let infoCount = 0;
    const flaggedRuleSet = new Set();
    const findings = [];
    function recordFinding(finding) {
        totalFindings++;
        flaggedRuleSet.add(finding.ruleId);
        if (finding.severity === "warning") {
            warningCount++;
        }
        else if (finding.severity === "info") {
            infoCount++;
        }
        if (findings.length < MAX_FINDINGS_LIMIT) {
            findings.push(finding);
        }
    }
    const pairwiseDifferences = [];
    // Pairwise differences and transitions
    for (let k = 0; k < totalFrames - 1; k++) {
        const frameA = playback.frameNumbers[k];
        const frameB = playback.frameNumbers[k + 1];
        const bufA = frameBuffers[k];
        const bufB = frameBuffers[k + 1];
        const statsA = frameStats[k];
        const statsB = frameStats[k + 1];
        const diff = computeFrameDiff(bufA, bufB, pixelDiffThreshold);
        const changeRatio = Number((diff.changedPixels / canvasArea).toFixed(4));
        let visualCenterShift = 0;
        if (statsA.visualCenter && statsB.visualCenter) {
            const dx = statsB.visualCenter.x - statsA.visualCenter.x;
            const dy = statsB.visualCenter.y - statsA.visualCenter.y;
            visualCenterShift = Number(Math.hypot(dx, dy).toFixed(2));
        }
        const areaDelta = Math.abs(statsB.occupiedArea - statsA.occupiedArea);
        const maxArea = Math.max(statsA.occupiedArea, statsB.occupiedArea, 1);
        const relAreaChange = Number((areaDelta / maxArea).toFixed(4));
        pairwiseDifferences.push({
            stepIndex: k + 1,
            frameA,
            frameB,
            changedPixels: diff.changedPixels,
            changeRatio,
            visualCenterShift,
            areaDelta,
            relAreaChange,
            boundsA: statsA.bounds,
            boundsB: statsB.bounds,
            changedBounds: diff.changedBounds,
        });
        // Rule 1: Unexpected duplicate frames
        if (diff.changedPixels === 0) {
            recordFinding({
                id: `temporal-duplicate-step-${k + 1}-f${frameA}-f${frameB}`,
                ruleId: "unexpected_duplicate_frame",
                severity: "warning",
                confidence: "high",
                method: "Exact adjacent frame RGBA buffer comparison",
                limitation: "Flags 100% identical consecutive playback frames; does not evaluate whether an intentional hold was intended without extending frame duration.",
                affectedFrames: [frameA, frameB],
                observedMetrics: { stepIndex: k + 1, frameA, frameB, changedPixels: 0, changeRatio: 0 },
                description: `Adjacent frames ${frameA} and ${frameB} (step ${k + 1}) have 100% identical pixel content.`,
                suggestion: `Consider removing redundant frame ${frameB} and extending the duration of frame ${frameA} instead.`,
            });
        }
        // Rule 2: Adjacent pixel diff spike
        if (changeRatio > maxAdjacentChangeRatio) {
            recordFinding({
                id: `temporal-diff-spike-step-${k + 1}-f${frameA}-f${frameB}`,
                ruleId: "adjacent_pixel_diff_spike",
                severity: "info",
                confidence: "medium",
                method: "Adjacent frame pixel difference ratio against configured threshold",
                limitation: "High contrast visual cuts, camera transitions, or screen-clearing effects naturally exhibit high pixel change ratios.",
                affectedFrames: [frameA, frameB],
                observedMetrics: { stepIndex: k + 1, frameA, frameB, changedPixels: diff.changedPixels, changeRatio, threshold: maxAdjacentChangeRatio },
                description: `Pixel difference between frame ${frameA} and frame ${frameB} is ${(changeRatio * 100).toFixed(1)}%, exceeding threshold of ${(maxAdjacentChangeRatio * 100).toFixed(1)}%.`,
                suggestion: `Verify whether this large visual change is intentional or indicates missing transition/in-between frames.`,
            });
        }
        // Rule 3: Visual center jump
        if (statsA.visualCenter && statsB.visualCenter && visualCenterShift > maxCenterShift) {
            recordFinding({
                id: `temporal-center-jump-step-${k + 1}-f${frameA}-f${frameB}`,
                ruleId: "visual_center_jump",
                severity: "warning",
                confidence: "medium",
                method: "Alpha-weighted visual center Euclidean displacement calculation",
                limitation: "High-velocity actions, teleports, dashes, or camera tracking shifts cause abrupt center displacements.",
                affectedFrames: [frameA, frameB],
                observedMetrics: {
                    stepIndex: k + 1,
                    frameA,
                    frameB,
                    shiftDistance: visualCenterShift,
                    fromCenter: statsA.visualCenter,
                    toCenter: statsB.visualCenter,
                    threshold: maxCenterShift,
                },
                description: `Visual center shifted by ${visualCenterShift}px between frames ${frameA} and ${frameB}, exceeding threshold of ${maxCenterShift}px.`,
                suggestion: `Inspect visual center continuity between frames ${frameA} and ${frameB}.`,
            });
        }
        // Rule 4: Sudden occupied area change
        if (Math.max(statsA.occupiedArea, statsB.occupiedArea) > 8 && relAreaChange > maxAreaChangeRatio) {
            recordFinding({
                id: `temporal-area-spike-step-${k + 1}-f${frameA}-f${frameB}`,
                ruleId: "occupied_area_spike",
                severity: "warning",
                confidence: "medium",
                method: "Non-transparent pixel coverage delta ratio calculation",
                limitation: "Sudden reveals, dissolves, or visual impact bursts cause legitimate rapid coverage expansion or collapse.",
                affectedFrames: [frameA, frameB],
                observedMetrics: {
                    stepIndex: k + 1,
                    frameA,
                    frameB,
                    areaA: statsA.occupiedArea,
                    areaB: statsB.occupiedArea,
                    relAreaChange,
                    threshold: maxAreaChangeRatio,
                },
                description: `Occupied pixel area changed by ${(relAreaChange * 100).toFixed(1)}% between frames ${frameA} (${statsA.occupiedArea}px) and ${frameB} (${statsB.occupiedArea}px).`,
                suggestion: `Check whether the occupied pixel area change between frames ${frameA} and ${frameB} is intentional.`,
            });
        }
        // Rule 5: Bounds change spike
        if (statsA.bounds && statsB.bounds) {
            const dw = Math.abs(statsB.bounds.width - statsA.bounds.width);
            const dh = Math.abs(statsB.bounds.height - statsA.bounds.height);
            const maxDimDelta = Math.max(dw, dh);
            const maxCanvasDim = Math.max(width, height);
            if (maxDimDelta > maxCanvasDim * 0.5) {
                recordFinding({
                    id: `temporal-bounds-spike-step-${k + 1}-f${frameA}-f${frameB}`,
                    ruleId: "bounds_change_spike",
                    severity: "info",
                    confidence: "medium",
                    method: "Bounding box dimension delta check against canvas proportion threshold",
                    limitation: "Large weapon swings, squash-and-stretch, or visual effects legitimately alter bounding box dimensions.",
                    affectedFrames: [frameA, frameB],
                    observedMetrics: {
                        stepIndex: k + 1,
                        frameA,
                        frameB,
                        boundsA: statsA.bounds,
                        boundsB: statsB.bounds,
                        deltaWidth: dw,
                        deltaHeight: dh,
                        threshold: maxCanvasDim * 0.5,
                    },
                    description: `Content bounding box changed dimension by ${maxDimDelta}px (W: ${statsA.bounds.width}->${statsB.bounds.width}, H: ${statsA.bounds.height}->${statsB.bounds.height}) between frames ${frameA} and ${frameB}.`,
                    suggestion: `Check whether the bounding box dimension change between frames ${frameA} and ${frameB} reflects intended content expansion.`,
                });
            }
        }
        // Rule 7: Rigid regions stability
        if (rigidRegions && rigidRegions.length > 0) {
            for (const reg of rigidRegions) {
                let regDiffCount = 0;
                const regArea = reg.width * reg.height;
                for (let ry = reg.y; ry < reg.y + reg.height; ry++) {
                    for (let rx = reg.x; rx < reg.x + reg.width; rx++) {
                        const idx = (ry * width + rx) * 4;
                        const dr = Math.abs(bufA.data[idx] - bufB.data[idx]);
                        const dg = Math.abs(bufA.data[idx + 1] - bufB.data[idx + 1]);
                        const db = Math.abs(bufA.data[idx + 2] - bufB.data[idx + 2]);
                        const da = Math.abs(bufA.data[idx + 3] - bufB.data[idx + 3]);
                        if (dr > pixelDiffThreshold || dg > pixelDiffThreshold || db > pixelDiffThreshold || da > pixelDiffThreshold) {
                            regDiffCount++;
                        }
                    }
                }
                const diffRatio = regDiffCount / regArea;
                if (diffRatio > rigidTolerance) {
                    recordFinding({
                        id: `temporal-rigid-${reg.id}-step-${k + 1}-f${frameA}-f${frameB}`,
                        ruleId: "rigid_region_instability",
                        severity: "warning",
                        confidence: "high",
                        method: "Sub-region pixel delta check against zero-mutation tolerance",
                        limitation: "Assumes designated sub-region represents a rigid body or static UI element that must not deform or mutate.",
                        affectedFrames: [frameA, frameB],
                        observedMetrics: {
                            regionId: reg.id,
                            bounds: { x: reg.x, y: reg.y, width: reg.width, height: reg.height },
                            diffPixels: regDiffCount,
                            totalRegionPixels: regArea,
                            diffRatio: Number(diffRatio.toFixed(3)),
                            tolerance: rigidTolerance,
                        },
                        description: `Marked rigid region '${reg.id}' mutated by ${regDiffCount}px (${(diffRatio * 100).toFixed(1)}%) between frames ${frameA} and ${frameB}.`,
                        suggestion: `Verify whether pixel changes inside rigid region '${reg.id}' were intentional.`,
                    });
                }
            }
        }
    }
    // Rule 6: Single-pixel isolated flicker (3-frame temporal reversal)
    for (let k = 1; k < totalFrames - 1; k++) {
        const prevBuf = frameBuffers[k - 1];
        const currBuf = frameBuffers[k];
        const nextBuf = frameBuffers[k + 1];
        const framePrev = playback.frameNumbers[k - 1];
        const frameCurr = playback.frameNumbers[k];
        const frameNext = playback.frameNumbers[k + 1];
        const prev32 = frameStats[k - 1].data32;
        const curr32 = frameStats[k].data32;
        const next32 = frameStats[k + 1].data32;
        let flickerCountOnFrame = 0;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const pIdx = y * width + x;
                const cPrev = prev32[pIdx];
                const cCurr = curr32[pIdx];
                const cNext = next32[pIdx];
                // Pixel changed on curr and reverted on next
                if (cCurr !== cPrev && cPrev === cNext) {
                    // Check 8-connectivity spatial isolation on current frame vs prev
                    let neighborChanged = false;
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            if (dx === 0 && dy === 0)
                                continue;
                            const nx = x + dx;
                            const ny = y + dy;
                            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                                const nIdx = ny * width + nx;
                                if (curr32[nIdx] !== prev32[nIdx]) {
                                    neighborChanged = true;
                                    break;
                                }
                            }
                        }
                        if (neighborChanged)
                            break;
                    }
                    if (!neighborChanged) {
                        flickerCountOnFrame++;
                        const byteIdx = pIdx * 4;
                        recordFinding({
                            id: `temporal-flicker-f${frameCurr}-x${x}-y${y}`,
                            ruleId: "isolated_pixel_flicker",
                            severity: "warning",
                            confidence: "high",
                            method: "3-frame temporal reversal detection with 8-connectivity spatial isolation check",
                            limitation: "Single-pixel twinkles, eye glints, or intentional star sparkles will trigger this heuristic.",
                            affectedFrames: [framePrev, frameCurr, frameNext],
                            observedMetrics: {
                                frameNumber: frameCurr,
                                x,
                                y,
                                colorPrev: hexColorFromRgba(prevBuf.data[byteIdx], prevBuf.data[byteIdx + 1], prevBuf.data[byteIdx + 2], prevBuf.data[byteIdx + 3]),
                                colorCurr: hexColorFromRgba(currBuf.data[byteIdx], currBuf.data[byteIdx + 1], currBuf.data[byteIdx + 2], currBuf.data[byteIdx + 3]),
                                colorNext: hexColorFromRgba(nextBuf.data[byteIdx], nextBuf.data[byteIdx + 1], nextBuf.data[byteIdx + 2], nextBuf.data[byteIdx + 3]),
                            },
                            description: `Isolated 1-pixel color flicker detected at (${x}, ${y}) on frame ${frameCurr} reverting on frame ${frameNext}.`,
                            suggestion: `Check whether pixel (${x}, ${y}) on frame ${frameCurr} is an accidental stray pixel or intentional glint.`,
                        });
                    }
                }
            }
        }
    }
    // Rule 7: Palette variation
    for (let k = 0; k < totalFrames; k++) {
        const fn = playback.frameNumbers[k];
        const stats = frameStats[k];
        const isolatedColors = [];
        for (const c of stats.colors) {
            if (colorFrameCounts.get(c) === 1) {
                isolatedColors.push(c);
            }
        }
        if (isolatedColors.length > 4) {
            recordFinding({
                id: `temporal-palette-variation-f${fn}`,
                ruleId: "palette_variation",
                severity: "info",
                confidence: "low",
                method: "Per-frame RGBA unique color histogram and cross-frame isolation check",
                limitation: "Intentional single-frame visual effects or unique lighting flashes use exclusive color entries.",
                affectedFrames: [fn],
                observedMetrics: {
                    frameNumber: fn,
                    uniqueColorsInFrame: stats.colors.size,
                    exclusiveColorCount: isolatedColors.length,
                    sampleColors: isolatedColors.slice(0, 5),
                },
                description: `Frame ${fn} introduces ${isolatedColors.length} unique color(s) that appear in no other frame of this animation.`,
                suggestion: `Verify whether the colors introduced exclusively in frame ${fn} are intentional palette variations.`,
            });
        }
    }
    // Rule 8: Contact points displacement evaluation
    if (contactPoints && contactPoints.length > 0) {
        for (const pt of contactPoints) {
            const effectiveThreshold = pt.maxDisplacement ?? defaultContactThreshold;
            const posByFrame = new Map();
            for (const p of pt.positions) {
                posByFrame.set(p.frameNumber, p);
            }
            // Collect positions in order of appearance in playback sequence
            const contactSteps = [];
            for (let k = 0; k < totalFrames; k++) {
                const fn = playback.frameNumbers[k];
                const pos = posByFrame.get(fn);
                if (pos) {
                    contactSteps.push({ stepIndex: k + 1, frameNumber: fn, pos });
                }
            }
            for (let i = 0; i < contactSteps.length - 1; i++) {
                const stepA = contactSteps[i];
                const stepB = contactSteps[i + 1];
                const dx = stepB.pos.x - stepA.pos.x;
                const dy = stepB.pos.y - stepA.pos.y;
                const distance = Math.hypot(dx, dy);
                if (distance > effectiveThreshold) {
                    recordFinding({
                        id: `temporal-contact-displacement-${pt.id}-step-${stepA.stepIndex}-to-${stepB.stepIndex}-f${stepA.frameNumber}-f${stepB.frameNumber}`,
                        ruleId: "contact_point_displacement",
                        severity: "warning",
                        confidence: "high",
                        method: "Euclidean displacement between consecutive marked contact point positions",
                        limitation: "Evaluates Euclidean displacement between specified expected contact coordinates across consecutive playback frames against threshold.",
                        affectedFrames: [stepA.frameNumber, stepB.frameNumber],
                        observedMetrics: {
                            pointId: pt.id,
                            fromFrame: stepA.frameNumber,
                            toFrame: stepB.frameNumber,
                            fromStep: stepA.stepIndex,
                            toStep: stepB.stepIndex,
                            fromPos: { x: stepA.pos.x, y: stepA.pos.y },
                            toPos: { x: stepB.pos.x, y: stepB.pos.y },
                            dx,
                            dy,
                            distance: Number(distance.toFixed(2)),
                            threshold: effectiveThreshold,
                        },
                        description: `Contact point '${pt.id}' displacement of ${distance.toFixed(2)}px (dx: ${dx}, dy: ${dy}) from frame ${stepA.frameNumber} to ${stepB.frameNumber} exceeds threshold of ${effectiveThreshold}px.`,
                        suggestion: `Adjust contact point '${pt.id}' position from frame ${stepA.frameNumber} to ${stepB.frameNumber} to maintain contact stability within ${effectiveThreshold}px.`,
                    });
                }
            }
        }
    }
    // Rule 9: Loop start/end matching
    let loopSeamDiff;
    if (checkLoopContinuity && totalFrames > 1) {
        const firstBuf = frameBuffers[0];
        const lastBuf = frameBuffers[totalFrames - 1];
        const firstFrame = playback.frameNumbers[0];
        const lastFrame = playback.frameNumbers[totalFrames - 1];
        const firstStats = frameStats[0];
        const lastStats = frameStats[totalFrames - 1];
        const seamDiff = computeFrameDiff(lastBuf, firstBuf, pixelDiffThreshold);
        const seamChangeRatio = Number((seamDiff.changedPixels / canvasArea).toFixed(4));
        let seamCenterShift = 0;
        if (firstStats.visualCenter && lastStats.visualCenter) {
            const dx = firstStats.visualCenter.x - lastStats.visualCenter.x;
            const dy = firstStats.visualCenter.y - lastStats.visualCenter.y;
            seamCenterShift = Number(Math.hypot(dx, dy).toFixed(2));
        }
        loopSeamDiff = {
            changedPixels: seamDiff.changedPixels,
            changeRatio: seamChangeRatio,
            centerShift: seamCenterShift,
        };
        if (seamDiff.changedPixels === 0) {
            recordFinding({
                id: `temporal-loop-duplicate-seam-f${firstFrame}-f${lastFrame}`,
                ruleId: "unexpected_duplicate_frame",
                severity: "warning",
                confidence: "high",
                method: "Loop boundary seam pixel exact comparison",
                limitation: "In continuous forward playback, identical first and last frames create a duplicate-duration hold at the loop seam.",
                affectedFrames: [firstFrame, lastFrame],
                observedMetrics: { firstFrame, lastFrame, changedPixels: 0, changeRatio: 0 },
                description: `Loop seam terminal frame ${lastFrame} and initial frame ${firstFrame} have identical pixel contents, causing a double-duration pause when looping.`,
                suggestion: `Adjust loop boundaries so the terminal frame does not duplicate the initial frame.`,
            });
        }
        else if (seamChangeRatio > maxAdjacentChangeRatio || seamCenterShift > maxCenterShift) {
            recordFinding({
                id: `temporal-loop-continuity-mismatch-f${firstFrame}-f${lastFrame}`,
                ruleId: "loop_continuity_mismatch",
                severity: "warning",
                confidence: "medium",
                method: "Loop seam pixel difference and visual center discontinuity check",
                limitation: "Non-cyclical animations or intentional dramatic loop resets naturally exhibit large boundary differences.",
                affectedFrames: [firstFrame, lastFrame],
                observedMetrics: {
                    firstFrame,
                    lastFrame,
                    changedPixels: seamDiff.changedPixels,
                    changeRatio: seamChangeRatio,
                    centerShift: seamCenterShift,
                },
                description: `Loop seam between last frame ${lastFrame} and first frame ${firstFrame} has ${(seamChangeRatio * 100).toFixed(1)}% changed pixels and ${seamCenterShift}px center shift.`,
                suggestion: `Check loop continuity so the transition from final frame ${lastFrame} back to frame ${firstFrame} connects smoothly.`,
            });
        }
    }
    // Rule 10: Duration consistency
    const durations = playback.frames.map((f) => f.durationMs);
    const sortedDurations = [...durations].sort((a, b) => a - b);
    const medianDuration = sortedDurations[Math.floor(sortedDurations.length / 2)] ?? 100;
    for (let k = 0; k < totalFrames; k++) {
        const f = playback.frames[k];
        if (f.durationMs <= 0) {
            recordFinding({
                id: `temporal-duration-zero-f${f.frameNumber}`,
                ruleId: "duration_inconsistency",
                severity: "warning",
                confidence: "high",
                method: "Zero or negative duration validation",
                limitation: "Frames with non-positive duration violate standard animation playback specifications.",
                affectedFrames: [f.frameNumber],
                observedMetrics: { frameNumber: f.frameNumber, durationMs: f.durationMs },
                description: `Frame ${f.frameNumber} has non-positive duration (${f.durationMs}ms).`,
                suggestion: `Set frame ${f.frameNumber} duration to a positive value (standard default is 100ms).`,
            });
        }
        else if (medianDuration > 0 && (f.durationMs > medianDuration * 3.5 || f.durationMs < medianDuration / 3.5)) {
            recordFinding({
                id: `temporal-duration-outlier-f${f.frameNumber}`,
                ruleId: "duration_inconsistency",
                severity: "info",
                confidence: "medium",
                method: "Timeline duration variance against playback median duration",
                limitation: "Intentional anticipation holds, hit-stops, or lingering recovery frames deliberately use variable timing.",
                affectedFrames: [f.frameNumber],
                observedMetrics: { frameNumber: f.frameNumber, durationMs: f.durationMs, medianDurationMs: medianDuration, averageFps: playback.averageFps },
                description: `Frame ${f.frameNumber} duration (${f.durationMs}ms) deviates significantly from the median frame duration of ${medianDuration}ms.`,
                suggestion: `Verify whether duration variation on frame ${f.frameNumber} is intentional timing choreography.`,
            });
        }
    }
    // Rule 11: Anomalous cel position jumps
    const imageLayers = collectImageLayers(inspectionLayers);
    for (const layer of imageLayers) {
        if (!layer.cels || layer.cels.length === 0)
            continue;
        const celByFrame = new Map();
        for (const cel of layer.cels) {
            celByFrame.set(cel.frameNumber, cel);
        }
        for (let k = 0; k < totalFrames - 1; k++) {
            const frameA = playback.frameNumbers[k];
            const frameB = playback.frameNumbers[k + 1];
            const celA = celByFrame.get(frameA);
            const celB = celByFrame.get(frameB);
            if (celA && celB) {
                const dx = celB.x - celA.x;
                const dy = celB.y - celA.y;
                const jumpDist = Number(Math.hypot(dx, dy).toFixed(2));
                if (jumpDist > maxCelPositionJump) {
                    recordFinding({
                        id: `temporal-cel-jump-${layer.name}-step-${k + 1}-f${frameA}-f${frameB}`,
                        ruleId: "anomalous_cel_position_jump",
                        severity: "warning",
                        confidence: "medium",
                        method: "Layer cel coordinate delta tracking across playback sequence",
                        limitation: "Deliberate cel teleports, shake effects, or parallax layer offsets legitimately produce large position jumps.",
                        affectedFrames: [frameA, frameB],
                        observedMetrics: {
                            layerName: layer.name,
                            frameA,
                            frameB,
                            posA: { x: celA.x, y: celA.y },
                            posB: { x: celB.x, y: celB.y },
                            jumpDistance: jumpDist,
                            threshold: maxCelPositionJump,
                        },
                        description: `Cel on layer '${layer.name}' shifted by ${jumpDist}px between frames ${frameA} and ${frameB} (from [${celA.x}, ${celA.y}] to [${celB.x}, ${celB.y}]).`,
                        suggestion: `Verify whether the cel displacement on layer '${layer.name}' is an intentional offset or accidental drag.`,
                    });
                }
            }
        }
    }
    // Stable deterministic sorting of findings
    findings.sort((a, b) => {
        const fA = a.affectedFrames[0] ?? 0;
        const fB = b.affectedFrames[0] ?? 0;
        if (fA !== fB)
            return fA - fB;
        if (a.ruleId !== b.ruleId)
            return a.ruleId.localeCompare(b.ruleId);
        return a.id.localeCompare(b.id);
    });
    const passedRules = ALL_TEMPORAL_RULES.filter((r) => !flaggedRuleSet.has(r));
    const flaggedRules = ALL_TEMPORAL_RULES.filter((r) => flaggedRuleSet.has(r));
    const temporalHash = computeCanonicalTemporalHash(width, height, playback.frameNumbers, playback.frames.map((f) => f.durationMs), frameBuffers);
    return {
        temporalHash,
        frameCount: totalFrames,
        totalDurationMs: playback.totalDurationMs,
        averageFps: playback.averageFps,
        summary: {
            totalFrames,
            totalDurationMs: playback.totalDurationMs,
            totalFindings,
            findingsCount: findings.length,
            truncated: totalFindings > MAX_FINDINGS_LIMIT,
            warningCount,
            infoCount,
            passedRules,
            flaggedRules,
        },
        findings,
        metrics: {
            canvas: { width, height },
            pairwiseDifferences,
            perFrameMetrics,
            paletteSummary: {
                totalUniqueColors: allColors.size,
                perFrameUniqueColors: perFrameMetrics.map((m) => m.uniqueColors),
            },
            loopSummary: {
                loopsContinuously: playback.loopsContinuously,
                seamDiff: loopSeamDiff,
            },
        },
    };
}
//# sourceMappingURL=temporalAnalysis.js.map