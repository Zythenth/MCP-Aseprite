import { randomUUID } from "node:crypto";
import type { BridgeState } from "../bridge/state.js";
import type { ImageBuffer } from "../image/png.js";

export const LIVE_PAINTING_STAGES = [
  "sketch",
  "blocks",
  "silhouette",
  "line",
  "base_colors",
  "shadows",
  "details",
  "polish",
] as const;

export type LivePaintingStageName = (typeof LIVE_PAINTING_STAGES)[number];
export type LivePaintingSpeed = "slow" | "normal" | "fast";
export type LivePaintingStatus = "active" | "paused" | "cancelled" | "completed";

const MAX_SNAPSHOTS = 16;
const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;

export const LIVE_PAINTING_DELAY_MS: Record<LivePaintingSpeed, number> = {
  slow: 900,
  normal: 350,
  fast: 100,
};

export interface LivePaintingSnapshot {
  id: string;
  kind: "initial" | "stage";
  stage?: LivePaintingStageName;
  description?: string;
  comment?: string;
  frameNumber: number;
  layerName?: string;
  revision: number;
  capturedAt: string;
  image: ImageBuffer;
}

export interface LivePaintingStage {
  id: string;
  name: LivePaintingStageName;
  description: string;
  comment?: string;
  startedAt: string;
  completedAt?: string;
  mutationTool?: string;
  snapshotId?: string;
}

export interface LivePaintingRun {
  id: string;
  title: string;
  sessionId: string;
  spriteIdentifier: string;
  createdRevision: number;
  status: LivePaintingStatus;
  speed: LivePaintingSpeed;
  commentaryMode: boolean;
  stageOrder: LivePaintingStageName[];
  stages: LivePaintingStage[];
  activeStage: LivePaintingStage | null;
  createdAt: string;
  cancelledAt?: string;
  completedAt?: string;
}

export interface LivePaintingSummary {
  id: string;
  title: string;
  status: LivePaintingStatus;
  speed: LivePaintingSpeed;
  recommendedDelayMs: number;
  commentaryMode: boolean;
  stageOrder: LivePaintingStageName[];
  completedStages: Array<Omit<LivePaintingStage, "id"> & { id: string }>;
  activeStage: LivePaintingStage | null;
  nextStage: LivePaintingStageName | null;
  snapshotCount: number;
  sessionId: string;
  spriteIdentifier: string;
}

function cloneImage(image: ImageBuffer): ImageBuffer {
  return { width: image.width, height: image.height, data: new Uint8Array(image.data) };
}

function cloneStage(stage: LivePaintingStage): LivePaintingStage {
  return { ...stage };
}

export class LivePaintingState {
  private run: LivePaintingRun | null = null;
  private snapshots = new Map<string, LivePaintingSnapshot>();

  constructor(state: BridgeState) {
    state.on("connection_change", ({ connected }) => {
      if (!connected) this.clear();
    });
    state.on("sprite_change", () => {
      if (this.run) this.clear();
    });
    state.on("hello", () => {
      if (this.run) this.clear();
    });
  }

  public clear(): void {
    this.run = null;
    this.snapshots.clear();
  }

  public start(input: {
    title: string;
    sessionId: string;
    spriteIdentifier: string;
    revision: number;
    speed: LivePaintingSpeed;
    commentaryMode: boolean;
    stageOrder: LivePaintingStageName[];
    initialSnapshot: Omit<LivePaintingSnapshot, "id" | "kind" | "capturedAt">;
  }): LivePaintingRun {
    if (new Set(input.stageOrder).size !== input.stageOrder.length) {
      throw new Error("Live painting stages must not repeat.");
    }
    this.clear();
    this.run = {
      id: randomUUID(),
      title: input.title,
      sessionId: input.sessionId,
      spriteIdentifier: input.spriteIdentifier,
      createdRevision: input.revision,
      status: "active",
      speed: input.speed,
      commentaryMode: input.commentaryMode,
      stageOrder: [...input.stageOrder],
      stages: [],
      activeStage: null,
      createdAt: new Date().toISOString(),
    };
    this.addSnapshot({ ...input.initialSnapshot, kind: "initial" });
    return this.getRunOrThrow();
  }

  public getSummary(): LivePaintingSummary | null {
    if (!this.run) return null;
    const run = this.run;
    const completed = run.stages.map(cloneStage);
    return {
      id: run.id,
      title: run.title,
      status: run.status,
      speed: run.speed,
      recommendedDelayMs: LIVE_PAINTING_DELAY_MS[run.speed],
      commentaryMode: run.commentaryMode,
      stageOrder: [...run.stageOrder],
      completedStages: completed,
      activeStage: run.activeStage ? cloneStage(run.activeStage) : null,
      nextStage: run.status === "active" && !run.activeStage ? run.stageOrder[run.stages.length] ?? null : null,
      snapshotCount: this.snapshots.size,
      sessionId: run.sessionId,
      spriteIdentifier: run.spriteIdentifier,
    };
  }

  public getRunOrThrow(): LivePaintingRun {
    if (!this.run) throw new Error("No live painting process is active. Start one before painting.");
    return this.run;
  }

  public beginStage(input: { name: LivePaintingStageName; description: string; comment?: string }): LivePaintingStage {
    const run = this.getRunOrThrow();
    if (run.status !== "active") throw new Error(`Live painting is ${run.status}; continue or start a new process before painting.`);
    if (run.activeStage) throw new Error(`Live painting stage '${run.activeStage.name}' is already in progress.`);
    const expected = run.stageOrder[run.stages.length];
    if (!expected) throw new Error("All planned live painting stages are complete. Finish the process or start a new one.");
    if (input.name !== expected) throw new Error(`Expected live painting stage '${expected}', received '${input.name}'.`);
    if (run.commentaryMode && !input.comment) throw new Error("comment is required while live painting commentary mode is enabled.");
    run.activeStage = {
      id: randomUUID(),
      name: input.name,
      description: input.description,
      comment: input.comment,
      startedAt: new Date().toISOString(),
    };
    return cloneStage(run.activeStage);
  }

  public beforeSpriteMutation(toolName: string): void {
    if (!this.run) return;
    const run = this.run;
    if (run.status === "cancelled" || run.status === "completed") return;
    if (toolName === "undo" || toolName === "redo") {
      throw new Error("Use undo_live_painting_stage while a live painting process is active.");
    }
    if (run.status !== "active") throw new Error(`Live painting is ${run.status}; no sprite mutations are allowed.`);
    if (!run.activeStage) throw new Error("Begin the next live painting stage before modifying the sprite.");
    if (run.activeStage.mutationTool) {
      throw new Error("Each live painting stage permits one atomic Aseprite mutation so undo_last_stage is reliable. Complete this stage, then begin the next one.");
    }
  }

  public recordSpriteMutation(toolName: string): void {
    const stage = this.run?.activeStage;
    if (stage) stage.mutationTool = toolName;
  }

  public completeStage(snapshot: Omit<LivePaintingSnapshot, "id" | "kind" | "stage" | "description" | "comment" | "capturedAt">): LivePaintingStage {
    const run = this.getRunOrThrow();
    const stage = run.activeStage;
    if (run.status !== "active" || !stage) throw new Error("No active live painting stage to complete.");
    if (!stage.mutationTool) throw new Error("A live painting stage must perform one Aseprite mutation before it can be completed.");
    stage.completedAt = new Date().toISOString();
    const saved = this.addSnapshot({
      ...snapshot,
      kind: "stage",
      stage: stage.name,
      description: stage.description,
      comment: stage.comment,
    });
    stage.snapshotId = saved.id;
    run.stages.push(stage);
    run.activeStage = null;
    return cloneStage(stage);
  }

  public pause(): LivePaintingSummary {
    const run = this.getRunOrThrow();
    if (run.status !== "active") throw new Error(`Live painting is already ${run.status}.`);
    if (run.activeStage) throw new Error("Complete or cancel the current live painting stage before pausing.");
    run.status = "paused";
    return this.getSummary()!;
  }

  public continue(): LivePaintingSummary {
    const run = this.getRunOrThrow();
    if (run.status !== "paused") throw new Error("Only a paused live painting process can continue.");
    run.status = "active";
    return this.getSummary()!;
  }

  public setSpeed(speed: LivePaintingSpeed): LivePaintingSummary {
    const run = this.getRunOrThrow();
    if (run.status !== "active" && run.status !== "paused") throw new Error(`Live painting is ${run.status}; its speed cannot be changed.`);
    run.speed = speed;
    return this.getSummary()!;
  }

  public cancel(): LivePaintingSummary {
    const run = this.getRunOrThrow();
    if (run.status !== "active" && run.status !== "paused") throw new Error(`Live painting is already ${run.status}.`);
    run.status = "cancelled";
    run.cancelledAt = new Date().toISOString();
    run.activeStage = null;
    return this.getSummary()!;
  }

  public complete(): LivePaintingSummary {
    const run = this.getRunOrThrow();
    if (run.status !== "active") throw new Error(`Live painting is ${run.status}; it cannot be completed.`);
    if (run.activeStage) throw new Error("Complete the current live painting stage before finishing the process.");
    if (run.stages.length !== run.stageOrder.length) throw new Error("Complete every planned live painting stage before finishing the process.");
    run.status = "completed";
    run.completedAt = new Date().toISOString();
    return this.getSummary()!;
  }

  public getLastUndoableStage(): LivePaintingStage {
    const run = this.getRunOrThrow();
    if (run.status !== "active" && run.status !== "paused") throw new Error(`Live painting is ${run.status}; no stage can be undone.`);
    if (run.activeStage) throw new Error("Complete or cancel the current stage before undoing a completed stage.");
    const stage = run.stages.at(-1);
    if (!stage || !stage.mutationTool) throw new Error("There is no completed live painting stage to undo.");
    return cloneStage(stage);
  }

  public confirmUndoLastStage(): LivePaintingStage {
    const run = this.getRunOrThrow();
    const stage = run.stages.pop();
    if (!stage) throw new Error("There is no completed live painting stage to undo.");
    if (stage.snapshotId) this.snapshots.delete(stage.snapshotId);
    return cloneStage(stage);
  }

  public getSnapshot(id: string): LivePaintingSnapshot | undefined {
    const snapshot = this.snapshots.get(id);
    return snapshot ? { ...snapshot, image: cloneImage(snapshot.image) } : undefined;
  }

  public listSnapshots(): Array<Omit<LivePaintingSnapshot, "image"> & { width: number; height: number }> {
    return [...this.snapshots.values()].map(({ image, ...snapshot }) => ({ ...snapshot, width: image.width, height: image.height }));
  }

  public getReplayImages(): LivePaintingSnapshot[] {
    return [...this.snapshots.values()].map((snapshot) => ({ ...snapshot, image: cloneImage(snapshot.image) }));
  }

  private addSnapshot(snapshot: Omit<LivePaintingSnapshot, "id" | "capturedAt">): LivePaintingSnapshot {
    if (this.snapshots.size >= MAX_SNAPSHOTS) throw new Error(`Live painting snapshots are limited to ${MAX_SNAPSHOTS}.`);
    const usedBytes = [...this.snapshots.values()].reduce((total, item) => total + item.image.data.byteLength, 0);
    if (usedBytes + snapshot.image.data.byteLength > MAX_SNAPSHOT_BYTES) {
      throw new Error(`Live painting snapshots are limited to ${MAX_SNAPSHOT_BYTES} bytes per server process.`);
    }
    const stored: LivePaintingSnapshot = {
      ...snapshot,
      id: randomUUID(),
      capturedAt: new Date().toISOString(),
      image: cloneImage(snapshot.image),
    };
    this.snapshots.set(stored.id, stored);
    return stored;
  }
}
