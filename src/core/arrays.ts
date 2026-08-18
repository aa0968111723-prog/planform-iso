/**
 * ArrayGroup math — a repeated grid (mats, chairs …) kept as one editable unit.
 * Members are computed on demand from the group spec, so changing rows/cols/
 * spacing/size never orphans dozens of unrelated objects.
 */

import type { ArrayGroup } from "./model";

export interface GroupMember {
  x: number;
  z: number;
  rotationDeg: number;
  index: number;
  row: number;
  col: number;
}

export function groupFootprint(g: ArrayGroup): {
  count: number;
  totalWidth: number;
  totalDepth: number;
} {
  const cols = Math.max(0, Math.floor(g.cols));
  const rows = Math.max(0, Math.floor(g.rows));
  const totalWidth = cols <= 0 ? 0 : cols * g.itemWidth + (cols - 1) * g.gapX;
  const totalDepth = rows <= 0 ? 0 : rows * g.itemDepth + (rows - 1) * g.gapZ;
  return { count: rows * cols, totalWidth, totalDepth };
}

/** World centers + rotation for every member, honouring the group rotation. */
export function groupMembers(g: ArrayGroup): GroupMember[] {
  const cols = Math.max(0, Math.floor(g.cols));
  const rows = Math.max(0, Math.floor(g.rows));
  const t = (g.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const out: GroupMember[] = [];
  let index = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const ox = col * (g.itemWidth + g.gapX) + g.itemWidth / 2;
      const oz = row * (g.itemDepth + g.gapZ) + g.itemDepth / 2;
      out.push({
        x: g.anchorX + ox * cos - oz * sin,
        z: g.anchorZ + ox * sin + oz * cos,
        rotationDeg: g.rotationDeg,
        index,
        row,
        col,
      });
      index += 1;
    }
  }
  return out;
}

/** Center of the whole group's footprint (world), for a move handle / label. */
export function groupCenter(g: ArrayGroup): { x: number; z: number } {
  const fp = groupFootprint(g);
  const t = (g.rotationDeg * Math.PI) / 180;
  const cx = fp.totalWidth / 2;
  const cz = fp.totalDepth / 2;
  return {
    x: g.anchorX + cx * Math.cos(t) - cz * Math.sin(t),
    z: g.anchorZ + cx * Math.sin(t) + cz * Math.cos(t),
  };
}

/** Move the whole group so its footprint center lands on (x,z). */
export function setGroupCenter(g: ArrayGroup, x: number, z: number): { anchorX: number; anchorZ: number } {
  const cur = groupCenter(g);
  return { anchorX: g.anchorX + (x - cur.x), anchorZ: g.anchorZ + (z - cur.z) };
}

/** 1-based construction sequence number for a member, honouring order + start corner. */
export function memberNumber(g: ArrayGroup, row: number, col: number): number {
  const rows = Math.max(1, Math.floor(g.rows));
  const cols = Math.max(1, Math.floor(g.cols));
  let r = row;
  let c = col;
  if (g.numberStart === "sw" || g.numberStart === "se") r = rows - 1 - row;
  if (g.numberStart === "ne" || g.numberStart === "se") c = cols - 1 - col;
  const seq = g.numberOrder === "col" ? c * rows + r : r * cols + c;
  return seq + 1;
}

/** Construction label for a member, e.g. "A-01". */
export function memberLabel(g: ArrayGroup, row: number, col: number): string {
  const n = memberNumber(g, row, col);
  return `${g.numberPrefix}-${String(n).padStart(2, "0")}`;
}
