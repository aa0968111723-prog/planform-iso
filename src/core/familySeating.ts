/**
 * R-06 — 家族／小組座談座位.
 *
 * Club class second half: split the hall into family circles instead of one
 * lecture field facing the screen. Pure geometry; no AI.
 */

import type { Bounds } from "./placement";

export interface FamilyGroupSpec {
  rows: number;
  cols: number;
  itemWidth: number;
  itemDepth: number;
  gapX: number;
  gapZ: number;
  rotationDeg: number;
  anchorX: number;
  anchorZ: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export interface FamilyZoneSpec {
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  capacity: number;
}

export interface FamilyLayoutCandidate {
  id: string;
  label: string;
  groups: FamilyGroupSpec[];
  count: number;
  footprint: { width: number; depth: number };
  warnings: string[];
  fits: boolean;
  mode: "family";
  capacity: number;
  familyZones: FamilyZoneSpec[];
}

export interface FamilyLayoutInput {
  participants: number;
  aisleWidth: number;
  bounds: Bounds;
}

function blockWidth(cols: number, w: number, gap: number): number {
  return cols <= 0 ? 0 : cols * w + (cols - 1) * gap;
}
function blockDepth(rows: number, d: number, gap: number): number {
  return rows <= 0 ? 0 : rows * d + (rows - 1) * gap;
}

/**
 * Propose 2–3 family-circle layouts. Each family is a small 巧拼 cluster
 * with a named 家族 zone around it.
 */
export function generateFamilyLayouts(input: FamilyLayoutInput): FamilyLayoutCandidate[] {
  const n = Math.max(0, Math.floor(input.participants));
  const tile = 0.6;
  const gap = 0;
  const { bounds } = input;
  const W = Math.max(0, bounds.maxX - bounds.minX);
  const D = Math.max(0, bounds.maxZ - bounds.minZ);
  if (n <= 0 || W < tile * 2 || D < tile * 2) return [];

  const aisle = Math.max(0.9, input.aisleWidth);
  const counts = uniqueFamilyCounts(n);
  const out: FamilyLayoutCandidate[] = [];
  const labels = ["A 家族圈", "B 較多圈", "C 兩大家族"];
  counts.forEach((familyCount, i) => {
    const cand = layoutFamilies(n, familyCount, bounds, aisle, tile, gap, labels[i] ?? `家族 ${familyCount} 圈`);
    if (cand) out.push(cand);
  });
  return out;
}

function uniqueFamilyCounts(n: number): number[] {
  const a = clamp(Math.round(n / 7), 2, 5);
  const b = clamp(Math.round(n / 5), 3, 6);
  const c = 2;
  const seen = new Set<number>();
  const out: number[] = [];
  for (const v of [a, b, c]) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function layoutFamilies(
  n: number,
  familyCount: number,
  bounds: Bounds,
  aisle: number,
  tile: number,
  gap: number,
  baseLabel: string,
): FamilyLayoutCandidate | null {
  const per = Math.ceil(n / familyCount);
  const cols = Math.max(2, Math.ceil(Math.sqrt(per)));
  const rows = Math.max(2, Math.ceil(per / cols));
  const blockW = blockWidth(cols, tile, gap);
  const blockD = blockDepth(rows, tile, gap);
  const W = bounds.maxX - bounds.minX;
  const D = bounds.maxZ - bounds.minZ;

  const colsF = familyCount <= 3 || familyCount * blockW + (familyCount - 1) * aisle <= W + 1e-6
    ? familyCount
    : Math.ceil(familyCount / 2);
  const rowsF = Math.ceil(familyCount / colsF);
  const totalW = colsF * blockW + (colsF - 1) * aisle;
  const totalD = rowsF * blockD + (rowsF - 1) * aisle;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const startX = cx - totalW / 2;
  const startZ = cz - totalD / 2;

  const groups: FamilyGroupSpec[] = [];
  const familyZones: FamilyZoneSpec[] = [];
  let placed = 0;
  for (let i = 0; i < familyCount; i++) {
    const col = i % colsF;
    const row = Math.floor(i / colsF);
    const remaining = n - placed;
    const capacity = i === familyCount - 1 ? remaining : Math.min(per, remaining);
    const gCols = Math.max(2, Math.min(cols, Math.ceil(Math.sqrt(Math.max(1, capacity)))));
    const gRows = Math.max(2, Math.ceil(Math.max(1, capacity) / gCols));
    const gW = blockWidth(gCols, tile, gap);
    const gD = blockDepth(gRows, tile, gap);
    const cellX = startX + col * (blockW + aisle);
    const cellZ = startZ + row * (blockD + aisle);
    const anchorX = cellX + (blockW - gW) / 2;
    const anchorZ = cellZ + (blockD - gD) / 2;
    groups.push({
      rows: gRows,
      cols: gCols,
      itemWidth: tile,
      itemDepth: tile,
      gapX: gap,
      gapZ: gap,
      rotationDeg: 0,
      anchorX,
      anchorZ,
    });
    const name = `家族 ${String.fromCharCode(65 + i)}`;
    familyZones.push({
      name,
      x: anchorX + gW / 2,
      z: anchorZ + gD / 2,
      width: gW + 0.6,
      depth: gD + 0.6,
      capacity,
    });
    placed += capacity;
  }

  const minX = Math.min(...groups.map((g) => g.anchorX));
  const minZ = Math.min(...groups.map((g) => g.anchorZ));
  const maxX = Math.max(...groups.map((g) => g.anchorX + blockWidth(g.cols, g.itemWidth, g.gapX)));
  const maxZ = Math.max(...groups.map((g) => g.anchorZ + blockDepth(g.rows, g.itemDepth, g.gapZ)));
  const warnings: string[] = [];
  const geometryFits = maxX <= bounds.maxX + 1e-6 && minX >= bounds.minX - 1e-6
    && maxZ <= bounds.maxZ + 1e-6 && minZ >= bounds.minZ - 1e-6;
  if (!geometryFits) warnings.push("超出可用區域");
  if (totalW > W + 1e-6 || totalD > D + 1e-6) warnings.push("家族圈之間的走道偏緊");

  return {
    id: `family-${familyCount}`,
    label: `${baseLabel}（${familyCount} 圈 · 可坐 ${n} 人）`,
    groups,
    count: n,
    capacity: n,
    mode: "family",
    familyZones,
    footprint: { width: maxX - minX, depth: maxZ - minZ },
    warnings,
    fits: geometryFits,
  };
}
