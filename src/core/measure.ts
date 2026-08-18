/**
 * Measurement + on-site field info + calibration comparison (pure math).
 * Distances are edge-to-edge (footprint aware), not center-to-center.
 */

import type { Project, SceneObject } from "./model";
import { groupMembers } from "./arrays";
import {
  areaBounds,
  nearestWallSnap,
  obbGap,
  rectCorners,
  wallClearances,
  type Rect,
  type WallClearances,
} from "./placement";
import {
  formatTileRef,
  metersToCm,
  snapToTileCenter,
  snapToTileIntersection,
  worldToTile,
  type TileConfig,
} from "./units";

export interface MeasureResult {
  meters: number;
  cm: number;
  dxCm: number;
  dzCm: number;
  tilesX: number;
  tilesZ: number;
  tilesDiagonal: number;
}

export function measure(
  a: { x: number; z: number },
  b: { x: number; z: number },
  tile: TileConfig,
): MeasureResult {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const meters = Math.hypot(dx, dz);
  return {
    meters,
    cm: metersToCm(meters),
    dxCm: metersToCm(Math.abs(dx)),
    dzCm: metersToCm(Math.abs(dz)),
    tilesX: Math.abs(dx) / tile.width,
    tilesZ: Math.abs(dz) / tile.depth,
    tilesDiagonal: meters / ((tile.width + tile.depth) / 2),
  };
}

function objRect(o: SceneObject): Rect {
  return { cx: o.x, cz: o.z, w: o.width, d: o.depth, rot: o.rotationDeg };
}

/** Edge-to-edge gap (meters) between two objects; 0 if overlapping. */
export function objectGap(a: SceneObject, b: SceneObject): number {
  return obbGap(objRect(a), objRect(b));
}

export interface FieldInfo {
  tileRef: string;
  wall: WallClearances;
  zoneName: string | null;
  sizeCm: { w: number; d: number };
  facingDeg: number;
  /** Nearest edge gap (meters) to another object of the same kind, if any. */
  nearestSameKindGap: number | null;
}

export function objectFieldInfo(obj: SceneObject, project: Project): FieldInfo {
  const ref = worldToTile(obj.x, obj.z, project.tile);
  const wall = wallClearances(objRect(obj), project.classroom);
  const zone = project.zones.find(
    (z) =>
      obj.x >= z.x - z.width / 2 &&
      obj.x <= z.x + z.width / 2 &&
      obj.z >= z.z - z.depth / 2 &&
      obj.z <= z.z + z.depth / 2,
  );
  let nearest: number | null = null;
  for (const o of project.objects) {
    if (o.id === obj.id || o.kind !== obj.kind || o.hidden) continue;
    const g = objectGap(obj, o);
    if (nearest === null || g < nearest) nearest = g;
  }
  for (const grp of project.groups) {
    if (grp.sourceKind !== obj.kind || grp.hidden) continue;
    for (const m of groupMembers(grp)) {
      const g = obbGap(objRect(obj), { cx: m.x, cz: m.z, w: grp.itemWidth, d: grp.itemDepth, rot: m.rotationDeg });
      if (nearest === null || g < nearest) nearest = g;
    }
  }
  return {
    tileRef: formatTileRef(ref),
    wall,
    zoneName: zone ? zone.name : null,
    sizeCm: { w: Math.round(metersToCm(obj.width)), d: Math.round(metersToCm(obj.depth)) },
    facingDeg: obj.rotationDeg,
    nearestSameKindGap: nearest,
  };
}

export interface SnappedPoint {
  x: number;
  z: number;
  hint: string | null;
}

/**
 * Snap a measurement endpoint to tile intersections/centers, object footprint
 * corners/edge-midpoints, or the nearest wall — whichever is closest within
 * `radius` meters. Returns the raw point (hint null) if nothing is close.
 */
export function snapMeasurePoint(px: number, pz: number, project: Project, radius = 0.35): SnappedPoint {
  const candidates: { x: number; z: number; hint: string }[] = [];
  const ti = snapToTileIntersection(px, pz, project.tile);
  candidates.push({ ...ti, hint: "地磚交點" });
  const tc = snapToTileCenter(px, pz, project.tile);
  candidates.push({ ...tc, hint: "地磚中心" });
  const wall = nearestWallSnap(px, pz, [project.classroom, project.corridor], 0);
  if (wall) candidates.push({ x: wall.x, z: wall.z, hint: "牆面" });

  for (const o of project.objects) {
    if (o.hidden) continue;
    const corners = rectCorners(o.x, o.z, o.width, o.depth, o.rotationDeg);
    for (const c of corners) candidates.push({ x: c.x, z: c.z, hint: "物件邊角" });
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4];
      candidates.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, hint: "物件邊中點" });
    }
    candidates.push({ x: o.x, z: o.z, hint: "物件中心" });
  }

  let best: SnappedPoint = { x: px, z: pz, hint: null };
  let bestDist = radius;
  for (const c of candidates) {
    const dd = Math.hypot(c.x - px, c.z - pz);
    if (dd < bestDist) { bestDist = dd; best = { x: c.x, z: c.z, hint: c.hint }; }
  }
  return best;
}

export interface CalibrationCompare {
  ratio: number;
  deltaMeters: number;
  deltaPct: number;
  matches: boolean;
}

export function calibrationCompare(actual: number, model: number): CalibrationCompare {
  if (model <= 0) return { ratio: 1, deltaMeters: 0, deltaPct: 0, matches: true };
  const ratio = actual / model;
  const deltaMeters = actual - model;
  return { ratio, deltaMeters, deltaPct: (deltaMeters / model) * 100, matches: Math.abs(deltaMeters) < 0.005 };
}

/** Inventory of every asset in the plan, counting ArrayGroup members. */
export interface InventoryEntry { kind: SceneObject["kind"]; count: number }
export function inventory(project: Project): InventoryEntry[] {
  const counts = new Map<SceneObject["kind"], number>();
  for (const o of project.objects) if (!o.hidden) counts.set(o.kind, (counts.get(o.kind) ?? 0) + 1);
  for (const g of project.groups) {
    if (g.hidden) continue;
    counts.set(g.sourceKind, (counts.get(g.sourceKind) ?? 0) + Math.max(0, Math.floor(g.rows)) * Math.max(0, Math.floor(g.cols)));
  }
  return [...counts.entries()].map(([kind, count]) => ({ kind, count }));
}

/** Bounding-box aisle width between two footprints (edge gap). */
export function aisleWidth(a: Rect, b: Rect): number {
  return obbGap(a, b);
}

export function areaClearBounds(project: Project): { classroom: ReturnType<typeof areaBounds> } {
  return { classroom: areaBounds(project.classroom) };
}
