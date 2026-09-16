/**
 * Multi-select align / distribute / grid-arrange. Pure so tests cover the
 * workbench without a canvas.
 */

import type { SceneObject, TileConfig } from "./model";
import { applySnap, type SnapMode } from "./units";

export type AlignEdge = "left" | "right" | "top" | "bottom" | "centerX" | "centerZ";

export interface Pose {
  id: string;
  x: number;
  z: number;
  rotationDeg: number;
  width: number;
  depth: number;
}

function poseOf(o: Pick<SceneObject, "id" | "x" | "z" | "rotationDeg" | "width" | "depth">): Pose {
  return { id: o.id, x: o.x, z: o.z, rotationDeg: o.rotationDeg, width: o.width, depth: o.depth };
}

export function alignPoses(items: Pose[], edge: AlignEdge): Pose[] {
  if (items.length < 2) return items.map((p) => ({ ...p }));
  const xs = items.map((p) => p.x);
  const zs = items.map((p) => p.z);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...zs);
  const bottom = Math.max(...zs);
  const cx = (left + right) / 2;
  const cz = (top + bottom) / 2;
  return items.map((p) => {
    switch (edge) {
      case "left": return { ...p, x: left };
      case "right": return { ...p, x: right };
      case "top": return { ...p, z: top };
      case "bottom": return { ...p, z: bottom };
      case "centerX": return { ...p, x: cx };
      case "centerZ": return { ...p, z: cz };
    }
  });
}

export function distributePoses(items: Pose[], axis: "x" | "z"): Pose[] {
  if (items.length < 3) return items.map((p) => ({ ...p }));
  const sorted = [...items].sort((a, b) => (axis === "x" ? a.x - b.x : a.z - b.z));
  const lo = axis === "x" ? sorted[0].x : sorted[0].z;
  const hi = axis === "x" ? sorted[sorted.length - 1].x : sorted[sorted.length - 1].z;
  const step = (hi - lo) / (sorted.length - 1);
  return sorted.map((p, i) => axis === "x"
    ? { ...p, x: lo + i * step }
    : { ...p, z: lo + i * step });
}

/** Pack selected items into a grid using the tile size (or a custom gap). */
export function gridArrangePoses(items: Pose[], opts: { cols?: number; gapX: number; gapZ: number }): Pose[] {
  if (items.length < 2) return items.map((p) => ({ ...p }));
  const cols = Math.max(1, opts.cols ?? Math.ceil(Math.sqrt(items.length)));
  const originX = Math.min(...items.map((p) => p.x));
  const originZ = Math.min(...items.map((p) => p.z));
  const cellW = Math.max(...items.map((p) => p.width)) + opts.gapX;
  const cellD = Math.max(...items.map((p) => p.depth)) + opts.gapZ;
  return items.map((p, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return { ...p, x: originX + col * cellW, z: originZ + row * cellD };
  });
}

export function tileArrangePoses(items: Pose[], tile: TileConfig): Pose[] {
  return gridArrangePoses(items, { gapX: tile.width, gapZ: tile.depth });
}

export function scalePosesAroundCentroid(items: Pose[], factor: number): Pose[] {
  if (!items.length) return [];
  const cx = items.reduce((s, p) => s + p.x, 0) / items.length;
  const cz = items.reduce((s, p) => s + p.z, 0) / items.length;
  const f = Math.max(0.1, Math.min(10, factor));
  return items.map((p) => ({
    ...p,
    x: cx + (p.x - cx) * f,
    z: cz + (p.z - cz) * f,
    width: p.width * f,
    depth: p.depth * f,
  }));
}

export function snapPose(p: Pose, tile: TileConfig, mode: SnapMode): Pose {
  const s = applySnap(p.x, p.z, tile, mode);
  return { ...p, x: s.x, z: s.z };
}

export function posesFromObjects(objects: SceneObject[]): Pose[] {
  return objects.map(poseOf);
}
