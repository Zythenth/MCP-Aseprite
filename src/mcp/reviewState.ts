import { randomUUID } from "node:crypto";
import type { ImageBuffer } from "../image/png.js";
import type { PixelArtFinding } from "../image/pixelArt.js";

const MAX_CHECKPOINTS = 32;
const MAX_CHECKPOINT_BYTES = 64 * 1024 * 1024;
const MAX_WAIVERS = 1000;

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

export class ReviewState {
  private readonly checkpoints = new Map<string, ReviewCheckpoint>();
  private readonly waivers = new Map<string, LintWaiver>();

  public addCheckpoint(checkpoint: Omit<ReviewCheckpoint, "id" | "createdAt">): ReviewCheckpoint {
    if (this.checkpoints.size >= MAX_CHECKPOINTS) {
      throw new Error(`Review checkpoints are limited to ${MAX_CHECKPOINTS}; delete an old checkpoint first.`);
    }
    const usedBytes = [...this.checkpoints.values()].reduce((total, item) => total + item.image.data.byteLength, 0);
    if (usedBytes + checkpoint.image.data.byteLength > MAX_CHECKPOINT_BYTES) {
      throw new Error(`Review checkpoint images are limited to ${MAX_CHECKPOINT_BYTES} bytes per server process.`);
    }
    const stored: ReviewCheckpoint = {
      ...checkpoint,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      image: { ...checkpoint.image, data: new Uint8Array(checkpoint.image.data) },
    };
    this.checkpoints.set(stored.id, stored);
    return stored;
  }

  public getCheckpoint(id: string): ReviewCheckpoint | undefined {
    return this.checkpoints.get(id);
  }

  public listCheckpoints(sessionId?: string): Array<Omit<ReviewCheckpoint, "image"> & { width: number; height: number }> {
    return [...this.checkpoints.values()]
      .filter((checkpoint) => !sessionId || checkpoint.sessionId === sessionId)
      .map(({ image, ...checkpoint }) => ({ ...checkpoint, width: image.width, height: image.height }));
  }

  public deleteCheckpoint(id: string): boolean {
    return this.checkpoints.delete(id);
  }

  public addWaiver(waiver: Omit<LintWaiver, "id" | "createdAt">): LintWaiver {
    if (this.waivers.size >= MAX_WAIVERS) throw new Error(`Lint waivers are limited to ${MAX_WAIVERS}.`);
    const stored: LintWaiver = { ...waiver, id: randomUUID(), createdAt: new Date().toISOString() };
    this.waivers.set(stored.id, stored);
    return stored;
  }

  public listWaivers(sessionId?: string): LintWaiver[] {
    return [...this.waivers.values()].filter((waiver) => !sessionId || waiver.sessionId === sessionId);
  }

  public deleteWaiver(id: string): boolean {
    return this.waivers.delete(id);
  }

  public applyWaivers(
    findings: PixelArtFinding[],
    context: { sessionId: string; frameNumber?: number; layerName?: string }
  ): { findings: PixelArtFinding[]; suppressed: Array<{ finding: PixelArtFinding; waiverId: string }> } {
    const waivers = this.listWaivers(context.sessionId);
    const kept: PixelArtFinding[] = [];
    const suppressed: Array<{ finding: PixelArtFinding; waiverId: string }> = [];
    for (const finding of findings) {
      const waiver = waivers.find((candidate) =>
        candidate.rule === finding.rule
        && (candidate.frameNumber === undefined || candidate.frameNumber === context.frameNumber)
        && (candidate.layerName === undefined || candidate.layerName === context.layerName)
        && (candidate.x === undefined || candidate.x === finding.x)
        && (candidate.y === undefined || candidate.y === finding.y)
      );
      if (waiver) suppressed.push({ finding, waiverId: waiver.id });
      else kept.push(finding);
    }
    return { findings: kept, suppressed };
  }
}
