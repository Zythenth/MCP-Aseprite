import { randomUUID } from "node:crypto";
const MAX_CHECKPOINTS = 32;
const MAX_CHECKPOINT_BYTES = 64 * 1024 * 1024;
const MAX_WAIVERS = 1000;
export class ReviewState {
    checkpoints = new Map();
    waivers = new Map();
    addCheckpoint(checkpoint) {
        if (this.checkpoints.size >= MAX_CHECKPOINTS) {
            throw new Error(`Review checkpoints are limited to ${MAX_CHECKPOINTS}; delete an old checkpoint first.`);
        }
        const usedBytes = [...this.checkpoints.values()].reduce((total, item) => total + item.image.data.byteLength, 0);
        if (usedBytes + checkpoint.image.data.byteLength > MAX_CHECKPOINT_BYTES) {
            throw new Error(`Review checkpoint images are limited to ${MAX_CHECKPOINT_BYTES} bytes per server process.`);
        }
        const stored = {
            ...checkpoint,
            id: randomUUID(),
            createdAt: new Date().toISOString(),
            image: { ...checkpoint.image, data: new Uint8Array(checkpoint.image.data) },
        };
        this.checkpoints.set(stored.id, stored);
        return stored;
    }
    getCheckpoint(id) {
        return this.checkpoints.get(id);
    }
    listCheckpoints(sessionId) {
        return [...this.checkpoints.values()]
            .filter((checkpoint) => !sessionId || checkpoint.sessionId === sessionId)
            .map(({ image, ...checkpoint }) => ({ ...checkpoint, width: image.width, height: image.height }));
    }
    deleteCheckpoint(id) {
        return this.checkpoints.delete(id);
    }
    addWaiver(waiver) {
        if (this.waivers.size >= MAX_WAIVERS)
            throw new Error(`Lint waivers are limited to ${MAX_WAIVERS}.`);
        const stored = { ...waiver, id: randomUUID(), createdAt: new Date().toISOString() };
        this.waivers.set(stored.id, stored);
        return stored;
    }
    listWaivers(sessionId) {
        return [...this.waivers.values()].filter((waiver) => !sessionId || waiver.sessionId === sessionId);
    }
    deleteWaiver(id) {
        return this.waivers.delete(id);
    }
    applyWaivers(findings, context) {
        const waivers = this.listWaivers(context.sessionId);
        const kept = [];
        const suppressed = [];
        for (const finding of findings) {
            const waiver = waivers.find((candidate) => candidate.rule === finding.rule
                && (candidate.frameNumber === undefined || candidate.frameNumber === context.frameNumber)
                && (candidate.layerName === undefined || candidate.layerName === context.layerName)
                && (candidate.x === undefined || candidate.x === finding.x)
                && (candidate.y === undefined || candidate.y === finding.y));
            if (waiver)
                suppressed.push({ finding, waiverId: waiver.id });
            else
                kept.push(finding);
        }
        return { findings: kept, suppressed };
    }
}
//# sourceMappingURL=reviewState.js.map