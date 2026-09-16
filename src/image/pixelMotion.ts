export type PixelGrid = string[][];

interface PixelCluster {
  color: string;
  pixels: Array<{ x: number; y: number }>;
  center: { x: number; y: number };
}

const TRANSPARENT = "#00000000";

function normalizeColor(color: string): string {
  const normalized = color.toUpperCase();
  return normalized.length === 7 ? `${normalized}FF` : normalized;
}

function isOpaque(color: string): boolean {
  return normalizeColor(color).slice(-2) !== "00";
}

function emptyGrid(width: number, height: number): PixelGrid {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => TRANSPARENT));
}

function collectClusters(grid: PixelGrid): PixelCluster[] {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const visited = new Set<string>();
  const clusters: PixelCluster[] = [];
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = normalizeColor(grid[y][x]);
      const key = `${x},${y}`;
      if (!isOpaque(color) || visited.has(key)) continue;
      const pixels: Array<{ x: number; y: number }> = [];
      const queue = [{ x, y }];
      visited.add(key);
      for (let index = 0; index < queue.length; index += 1) {
        const point = queue[index];
        pixels.push(point);
        for (const [dx, dy] of directions) {
          const nx = point.x + dx;
          const ny = point.y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const neighborKey = `${nx},${ny}`;
          if (visited.has(neighborKey) || normalizeColor(grid[ny][nx]) !== color) continue;
          visited.add(neighborKey);
          queue.push({ x: nx, y: ny });
        }
      }
      const totalX = pixels.reduce((sum, point) => sum + point.x, 0);
      const totalY = pixels.reduce((sum, point) => sum + point.y, 0);
      clusters.push({ color, pixels, center: { x: totalX / pixels.length, y: totalY / pixels.length } });
    }
  }
  return clusters;
}

function putCluster(
  output: PixelGrid,
  cluster: PixelCluster,
  offsetX: number,
  offsetY: number
): void {
  for (const point of cluster.pixels) {
    const x = point.x + offsetX;
    const y = point.y + offsetY;
    if (y >= 0 && y < output.length && x >= 0 && x < output[0].length) output[y][x] = cluster.color;
  }
}

function matchClusters(source: PixelCluster[], target: PixelCluster[]): Array<[PixelCluster, PixelCluster]> {
  const unmatchedTarget = new Set(target);
  const pairs: Array<[PixelCluster, PixelCluster]> = [];
  for (const from of source) {
    let best: PixelCluster | undefined;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const to of unmatchedTarget) {
      if (from.color !== to.color) continue;
      const dx = from.center.x - to.center.x;
      const dy = from.center.y - to.center.y;
      const score = dx * dx + dy * dy + Math.abs(from.pixels.length - to.pixels.length) * 4;
      if (score < bestScore) {
        best = to;
        bestScore = score;
      }
    }
    if (best) {
      unmatchedTarget.delete(best);
      pairs.push([from, best]);
    }
  }
  return pairs;
}

function easedProgress(progress: number, easing: "linear" | "ease_in_out"): number {
  return easing === "ease_in_out" ? (1 - Math.cos(Math.PI * progress)) / 2 : progress;
}

export function buildClusterTween(
  source: PixelGrid,
  target: PixelGrid,
  progress: number,
  easing: "linear" | "ease_in_out" = "ease_in_out"
): { grid: PixelGrid; movedClusters: number; unmatchedClusters: number } {
  if (source.length === 0 || source.length !== target.length || source[0].length !== target[0].length) {
    throw new Error("Tween key poses must have matching non-empty dimensions.");
  }
  const amount = easedProgress(progress, easing);
  const sourceClusters = collectClusters(source);
  const targetClusters = collectClusters(target);
  const pairs = matchClusters(sourceClusters, targetClusters);
  const pairedSource = new Set(pairs.map(([from]) => from));
  const pairedTarget = new Set(pairs.map(([, to]) => to));
  const output = emptyGrid(source[0].length, source.length);

  for (const [from, to] of pairs) {
    const dx = Math.round((to.center.x - from.center.x) * amount);
    const dy = Math.round((to.center.y - from.center.y) * amount);
    if (amount < 0.5) {
      putCluster(output, from, dx, dy);
    } else {
      putCluster(output, to, dx - Math.round(to.center.x - from.center.x), dy - Math.round(to.center.y - from.center.y));
    }
  }
  for (const cluster of sourceClusters) {
    if (!pairedSource.has(cluster) && amount < 0.5) putCluster(output, cluster, 0, 0);
  }
  for (const cluster of targetClusters) {
    if (!pairedTarget.has(cluster) && amount >= 0.5) putCluster(output, cluster, 0, 0);
  }
  return { grid: output, movedClusters: pairs.length, unmatchedClusters: sourceClusters.length + targetClusters.length - pairs.length * 2 };
}

function occupiedBounds(grid: PixelGrid): { centerX: number; centerY: number } | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      if (!isOpaque(grid[y][x])) continue;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  return Number.isFinite(minX) ? { centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 } : null;
}

function rasterLine(
  output: PixelGrid,
  color: string,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
): void {
  let x = fromX;
  let y = fromY;
  const dx = Math.abs(toX - fromX);
  const sx = fromX < toX ? 1 : -1;
  const dy = -Math.abs(toY - fromY);
  const sy = fromY < toY ? 1 : -1;
  let error = dx + dy;
  while (true) {
    if (y >= 0 && y < output.length && x >= 0 && x < output[0].length) output[y][x] = color;
    if (x === toX && y === toY) break;
    const twiceError = error * 2;
    if (twiceError >= dy) { error += dy; x += sx; }
    if (twiceError <= dx) { error += dx; y += sy; }
  }
}

export function buildSmearFrame(
  source: PixelGrid,
  target: PixelGrid,
  stretch: number
): { grid: PixelGrid; motion: { x: number; y: number }; pixelsStretched: number } {
  if (source.length === 0 || source.length !== target.length || source[0].length !== target[0].length) {
    throw new Error("Smear key poses must have matching non-empty dimensions.");
  }
  const sourceBounds = occupiedBounds(source);
  const targetBounds = occupiedBounds(target);
  if (!sourceBounds || !targetBounds) throw new Error("Smear frames require opaque pixels in both key poses.");
  const motion = { x: targetBounds.centerX - sourceBounds.centerX, y: targetBounds.centerY - sourceBounds.centerY };
  const magnitude = Math.hypot(motion.x, motion.y);
  if (magnitude < 0.5) throw new Error("Smear frames require visible movement between key poses.");
  const unitX = motion.x / magnitude;
  const unitY = motion.y / magnitude;
  const halfX = Math.round(motion.x / 2);
  const halfY = Math.round(motion.y / 2);
  const extentX = Math.round(unitX * stretch / 2);
  const extentY = Math.round(unitY * stretch / 2);
  const output = emptyGrid(source[0].length, source.length);
  let pixelsStretched = 0;
  for (let y = 0; y < source.length; y += 1) {
    for (let x = 0; x < source[y].length; x += 1) {
      const color = normalizeColor(source[y][x]);
      if (!isOpaque(color)) continue;
      rasterLine(output, color, x + halfX - extentX, y + halfY - extentY, x + halfX + extentX, y + halfY + extentY);
      pixelsStretched += 1;
    }
  }
  return { grid: output, motion: { x: Math.round(motion.x), y: Math.round(motion.y) }, pixelsStretched };
}
