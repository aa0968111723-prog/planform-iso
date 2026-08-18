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
    out.push(mk("balanced", `整齊方格 ${rows} × ${cols}`, [{ rows, cols, itemWidth: w, itemDepth: d, gapX: gap, gapZ: gap, rotationDeg: rot, ...a }]));
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
      out.push(mk("aisle", `中央走道 ${rows} × ${colsPerSide}＋${colsPerSide}（走道 ${Math.round(aisleWidth * 100)}cm）`, [
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
      out.push(mk("wide", `寬排 ${rows} × ${cols}`, [{ rows, cols, itemWidth: w, itemDepth: d, gapX: gap, gapZ: gap, rotationDeg: rot, ...a }]));
    }
  }

  return out;
}
