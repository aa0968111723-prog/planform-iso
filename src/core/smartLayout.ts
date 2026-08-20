/**
 * SmartLayoutEngine — participant-driven mat layouts, pure TypeScript (no AI).
 * Given a headcount + mat size + aisle + available area, it proposes a few
 * candidate arrangements (balanced grid / central aisle / wide rows) as
 * ArrayGroup specs, with footprint and fit warnings.
 */

import type { Bounds } from "./placement";

export interface LayoutInput {
  participants: number;
  matWidth: number; // meters (+X)
  matDepth: number; // meters (+Z)
  gap: number; // gap between mats (meters)
  aisleWidth: number; // central aisle width (meters)
  bounds: Bounds; // usable area (already inset from walls if desired)
  rotationDeg?: number;
  /** "field" is a contiguous 0.6 × 0.6 mat field; default keeps legacy mats. */
  mode?: "individual" | "field";
}

export interface GroupSpec {
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

export interface LayoutCandidate {
  id: string;
  label: string;
  groups: GroupSpec[];
  count: number;
  footprint: { width: number; depth: number };
  warnings: string[];
  fits: boolean;
  mode?: "individual" | "field";
  /** Seats represented by a field; one person occupies two 0.6 m cells. */
  capacity?: number;
}

function capacityAlong(avail: number, size: number, gap: number): number {
  if (size <= 0) return 0;
  return Math.max(0, Math.floor((avail + gap) / (size + gap) + 1e-9));
}

function blockWidth(cols: number, w: number, gap: number): number {
  return cols <= 0 ? 0 : cols * w + (cols - 1) * gap;
}
function blockDepth(rows: number, d: number, gap: number): number {
  return rows <= 0 ? 0 : rows * d + (rows - 1) * gap;
}

/** Generate up to 3 candidate mat layouts for the given headcount. */
export function generateLayouts(input: LayoutInput): LayoutCandidate[] {
  if (input.mode === "field") return generateFieldLayouts(input);
  const { participants: n, matWidth: w, matDepth: d, gap, aisleWidth, bounds } = input;
  const rot = input.rotationDeg ?? 0;
  const W = Math.max(0, bounds.maxX - bounds.minX);
  const D = Math.max(0, bounds.maxZ - bounds.minZ);
  const colsMax = capacityAlong(W, w, gap);
  const rowsMax = capacityAlong(D, d, gap);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const out: LayoutCandidate[] = [];
  if (n <= 0 || colsMax <= 0 || rowsMax <= 0) return out;

  const mk = (id: string, label: string, groups: GroupSpec[]): LayoutCandidate => {
    const count = groups.reduce((s, g) => s + g.rows * g.cols, 0);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const g of groups) {
      minX = Math.min(minX, g.anchorX); minZ = Math.min(minZ, g.anchorZ);
      maxX = Math.max(maxX, g.anchorX + blockWidth(g.cols, g.itemWidth, g.gapX));
      maxZ = Math.max(maxZ, g.anchorZ + blockDepth(g.rows, g.itemDepth, g.gapZ));
    }
    const footprint = { width: maxX - minX, depth: maxZ - minZ };
    const warnings: string[] = [];
    if (count < n) warnings.push(`只能排 ${count} 張，少於 ${n} 人`);
    const fits = footprint.width <= W + 1e-6 && footprint.depth <= D + 1e-6;
    if (!fits) warnings.push("超出可用區域");
    return { id, label, groups, count, footprint, warnings, fits };
  };

  const centeredAnchor = (cols: number, rows: number): { anchorX: number; anchorZ: number } => ({
    anchorX: cx - blockWidth(cols, w, gap) / 2,
    anchorZ: cz - blockDepth(rows, d, gap) / 2,
  });

  // Candidate 1 — balanced grid (roughly square in physical space).
  {
    const targetCols = Math.max(1, Math.min(colsMax, Math.round(Math.sqrt((n * d) / w))));
    const cols = Math.min(colsMax, targetCols);
    const rows = Math.min(rowsMax, Math.ceil(n / cols));
    const a = centeredAnchor(cols, rows);
    out.push(mk("balanced", `A 整齊排列 ${rows} × ${cols}`, [{ rows, cols, itemWidth: w, itemDepth: d, gapX: gap, gapZ: gap, rotationDeg: rot, ...a }]));
  }

  // Candidate 2 — central aisle (two blocks split by an aisle).
  {
    const sideW = (W - aisleWidth) / 2;
    const colsPerSide = capacityAlong(sideW, w, gap);
    if (colsPerSide >= 1) {
      const rows = Math.min(rowsMax, Math.ceil(n / (colsPerSide * 2)));
      const leftW = blockWidth(colsPerSide, w, gap);
      const totalW = leftW * 2 + aisleWidth;
      const startX = cx - totalW / 2;
      const anchorZ = cz - blockDepth(rows, d, gap) / 2;
      const g: Omit<GroupSpec, "anchorX"> = { rows, cols: colsPerSide, itemWidth: w, itemDepth: d, gapX: gap, gapZ: gap, rotationDeg: rot, anchorZ };
      out.push(mk("aisle", `B 中央走道 ${rows} × ${colsPerSide}＋${colsPerSide}（走道 ${Math.round(aisleWidth * 100)}cm）`, [
        { ...g, anchorX: startX },
        { ...g, anchorX: startX + leftW + aisleWidth },
      ]));
    }
  }

  // Candidate 3 — wide rows (fill width, fewer rows).
  {
    const cols = colsMax;
    const rows = Math.min(rowsMax, Math.ceil(n / cols));
    if (cols >= 1 && (out.length === 0 || rows !== out[0].groups[0].rows || cols !== out[0].groups[0].cols)) {
      const a = centeredAnchor(cols, rows);
      out.push(mk("wide", `C 較寬鬆 ${rows} × ${cols}`, [{ rows, cols, itemWidth: w, itemDepth: d, gapX: gap, gapZ: gap, rotationDeg: rot, ...a }]));
    }
  }

  return out;
}

/**
 * Generate contiguous 60 × 60 cm mat fields. The group footprint is kept on
 * the tile grid and the capacity is deliberately reported as seats, not tile
 * count: one person uses one cell wide by two cells deep.
 */
function generateFieldLayouts(input: LayoutInput): LayoutCandidate[] {
  const n = Math.max(0, Math.floor(input.participants));
  const tile = 0.6;
  const { bounds } = input;
  const W = Math.max(0, bounds.maxX - bounds.minX);
  const D = Math.max(0, bounds.maxZ - bounds.minZ);
  const colsMax = Math.floor((W + 1e-9) / tile);
  const rowsMax = Math.floor((D + 1e-9) / tile);
  const personRowsMax = Math.floor(rowsMax / 2);
  if (n <= 0 || colsMax <= 0 || personRowsMax <= 0) return [];
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const rot = input.rotationDeg ?? 0;
  const block = (rows: number, cols: number) => ({ width: cols * tile, depth: rows * tile });
  const centered = (rows: number, cols: number) => {
    const size = block(rows, cols);
    return { anchorX: cx - size.width / 2, anchorZ: cz - size.depth / 2 };
  };
  const make = (id: string, label: string, groups: GroupSpec[]): LayoutCandidate => {
    const tiles = groups.reduce((sum, g) => sum + g.rows * g.cols, 0);
    const capacity = Math.floor(tiles / 2);
    const minX = Math.min(...groups.map((g) => g.anchorX));
    const minZ = Math.min(...groups.map((g) => g.anchorZ));
    const maxX = Math.max(...groups.map((g) => g.anchorX + g.cols * tile));
    const maxZ = Math.max(...groups.map((g) => g.anchorZ + g.rows * tile));
    const warnings: string[] = [];
    if (capacity < n) warnings.push(`塞不下 ${n} 人，建議減少人數或改用較大的教室`);
    const geometryFits = maxX <= bounds.maxX + 1e-6 && minX >= bounds.minX - 1e-6 && maxZ <= bounds.maxZ + 1e-6 && minZ >= bounds.minZ - 1e-6;
    if (!geometryFits) warnings.push("超出可用區域");
    return {
      id, label, groups, count: capacity, capacity, mode: "field",
      footprint: { width: maxX - minX, depth: maxZ - minZ },
      warnings, fits: geometryFits && capacity >= n,
    };
  };
  const rowsFor = (cols: number, people = n): number => Math.max(2, Math.min(personRowsMax, Math.ceil(people / Math.max(1, cols))) * 2);
  const group = (rows: number, cols: number, anchorX: number, anchorZ: number): GroupSpec => ({
    rows, cols, itemWidth: tile, itemDepth: tile, gapX: 0, gapZ: 0, rotationDeg: rot, anchorX, anchorZ,
  });
  const out: LayoutCandidate[] = [];

  // A — one centred field, favouring a compact rectangle.
  const targetCols = Math.max(1, Math.min(colsMax, Math.ceil(Math.sqrt((n * 2 * W) / Math.max(D, tile)))));
  const colsA = Math.min(colsMax, Math.max(1, targetCols));
  const rowsA = rowsFor(colsA);
  const a = centered(rowsA, colsA);
  out.push(make("field-balanced", `A 整片座區 ${Math.floor(rowsA / 2)} × ${colsA}（可坐 ${Math.floor(rowsA * colsA / 2)} 人）`, [group(rowsA, colsA, a.anchorX, a.anchorZ)]));

  // B — two contiguous fields with a real central walking lane.
  const aisle = Math.max(0.9, input.aisleWidth);
  const sideCols = Math.floor(Math.max(0, (W - aisle) / 2) / tile);
  if (sideCols > 0) {
    const rowsB = rowsFor(sideCols, Math.ceil(n / 2));
    const sideW = sideCols * tile;
    const totalW = sideW * 2 + aisle;
    const startX = cx - totalW / 2;
    const az = cz - (rowsB * tile) / 2;
    out.push(make("field-aisle", `B 中央走道（可坐 ${sideCols * rowsB} 人）`, [
      group(rowsB, sideCols, startX, az),
      group(rowsB, sideCols, startX + sideW + aisle, az),
    ]));
  }

  // C — wider rows, still grid-aligned and gap-free.
  const colsC = colsMax;
  const rowsC = rowsFor(colsC);
  const c = centered(rowsC, colsC);
  out.push(make("field-spacious", `C 寬鬆座區（可坐 ${Math.floor(rowsC * colsC / 2)} 人）`, [group(rowsC, colsC, c.anchorX, c.anchorZ)]));
  return out;
}
