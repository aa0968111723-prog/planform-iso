/**
 * Placement geometry: wall snapping, door hinge/sweep, tabletop parenting and
 * rectangle footprint math. Pure functions (no Three.js) so they are unit
 * tested and shared by the 3D scene, the top-plan exporter and validation.
 *
 * Facing convention: an object's rotationDeg yaw makes its "front" point along
 * facingVec(rotationDeg) = (sin, cos). rot 0 → +Z, 90 → +X, 180 → −Z, 270 → −X.
 */

import type { AreaConfig, SceneObject, WallAnchor, WallEdge } from "./model";

const D2R = Math.PI / 180;

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function areaBounds(a: AreaConfig): Bounds {
  return { minX: a.x, maxX: a.x + a.length, minZ: a.z, maxZ: a.z + a.width };
}

export function facingVec(rotationDeg: number): { x: number; z: number } {
  const r = rotationDeg * D2R;
  return { x: Math.sin(r), z: Math.cos(r) };
}

/** Inward-facing yaw for a wall edge (front points into the room). */
export function edgeRotation(edge: WallEdge): number {
  switch (edge) {
    case "n": return 0; // wall at min Z, inward +Z
    case "s": return 180; // wall at max Z, inward −Z
    case "w": return 90; // wall at min X, inward +X
    case "e": return 270; // wall at max X, inward −X
  }
}

export interface WallSnap {
  x: number;
  z: number;
  rotationDeg: number;
  areaId: "classroom" | "corridor";
  edge: WallEdge;
  offset: number; // along wall from its min corner (meters)
  distance: number; // how far the query point was from the wall (meters)
}

/**
 * Snap a point to the nearest wall among the given areas. `widthAlongWall` is
 * the object's size along the wall, used to keep it fully within the wall.
 */
export function nearestWallSnap(
  px: number,
  pz: number,
  areas: AreaConfig[],
  widthAlongWall: number,
): WallSnap | null {
  let best: WallSnap | null = null;
  const consider = (s: WallSnap) => {
    if (!best || s.distance < best.distance) best = s;
  };
  for (const a of areas) {
    const b = areaBounds(a);
    const half = Math.min(widthAlongWall / 2, a.length / 2, a.width / 2);
    // n / s walls run along X.
    const clampX = clamp(px, b.minX + half, b.maxX - half);
    consider({ x: clampX, z: b.minZ, rotationDeg: edgeRotation("n"), areaId: a.id, edge: "n", offset: clampX - b.minX, distance: Math.abs(pz - b.minZ) });
    consider({ x: clampX, z: b.maxZ, rotationDeg: edgeRotation("s"), areaId: a.id, edge: "s", offset: clampX - b.minX, distance: Math.abs(pz - b.maxZ) });
    // w / e walls run along Z.
    const clampZ = clamp(pz, b.minZ + half, b.maxZ - half);
    consider({ x: b.minX, z: clampZ, rotationDeg: edgeRotation("w"), areaId: a.id, edge: "w", offset: clampZ - b.minZ, distance: Math.abs(px - b.minX) });
    consider({ x: b.maxX, z: clampZ, rotationDeg: edgeRotation("e"), areaId: a.id, edge: "e", offset: clampZ - b.minZ, distance: Math.abs(px - b.maxX) });
  }
  return best;
}

/** Recompute world position from a stored wall anchor (e.g. after area resize). */
export function wallAnchorToPosition(
  anchor: WallAnchor,
  areas: AreaConfig[],
): { x: number; z: number; rotationDeg: number } | null {
  const area = areas.find((a) => a.id === anchor.areaId);
  if (!area) return null;
  const b = areaBounds(area);
  const rotationDeg = edgeRotation(anchor.edge);
  switch (anchor.edge) {
    case "n": return { x: b.minX + anchor.offset, z: b.minZ, rotationDeg };
    case "s": return { x: b.minX + anchor.offset, z: b.maxZ, rotationDeg };
    case "w": return { x: b.minX, z: b.minZ + anchor.offset, rotationDeg };
    case "e": return { x: b.maxX, z: b.minZ + anchor.offset, rotationDeg };
  }
}

/** Corners of a rotated rectangle footprint (world meters). */
export function rectCorners(
  cx: number,
  cz: number,
  w: number,
  d: number,
  rotationDeg: number,
): { x: number; z: number }[] {
  const r = rotationDeg * D2R;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const hw = w / 2;
  const hd = d / 2;
  return [
    { x: -hw, z: -hd },
    { x: hw, z: -hd },
    { x: hw, z: hd },
    { x: -hw, z: hd },
  ].map((p) => ({ x: cx + p.x * cos - p.z * sin, z: cz + p.x * sin + p.z * cos }));
}

export function pointInRect(
  px: number,
  pz: number,
  cx: number,
  cz: number,
  w: number,
  d: number,
  rotationDeg: number,
): boolean {
  const r = -rotationDeg * D2R;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = px - cx;
  const dz = pz - cz;
  const lx = dx * cos - dz * sin;
  const lz = dx * sin + dz * cos;
  return Math.abs(lx) <= w / 2 + 1e-9 && Math.abs(lz) <= d / 2 + 1e-9;
}

/** Separating-axis overlap test for two rotated rectangles. */
export function rectsOverlap(
  a: { cx: number; cz: number; w: number; d: number; rot: number },
  b: { cx: number; cz: number; w: number; d: number; rot: number },
): boolean {
  const ca = rectCorners(a.cx, a.cz, a.w, a.d, a.rot);
  const cb = rectCorners(b.cx, b.cz, b.w, b.d, b.rot);
  return satOverlap(ca, cb) && satOverlap(cb, ca);
}

function satOverlap(poly: { x: number; z: number }[], other: { x: number; z: number }[]): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const axis = { x: -(b.z - a.z), z: b.x - a.x };
    let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
    for (const p of poly) {
      const proj = p.x * axis.x + p.z * axis.z;
      minA = Math.min(minA, proj); maxA = Math.max(maxA, proj);
    }
    for (const p of other) {
      const proj = p.x * axis.x + p.z * axis.z;
      minB = Math.min(minB, proj); maxB = Math.max(maxB, proj);
    }
    if (maxA < minB - 1e-9 || maxB < minA - 1e-9) return false;
  }
  return true;
}

export interface DoorSweep {
  hingeX: number;
  hingeZ: number;
  radius: number;
  startAngle: number; // radians, closed leaf direction
  sweepAngle: number; // signed radians to fully open
}

/** Door hinge point + swing arc. Used for the top-plan arc and sweep validation. */
export function doorSweep(door: SceneObject): DoorSweep {
  const rot = door.rotationDeg;
  const facing = facingVec(rot); // into the room
  // Wall tangent (perpendicular to facing).
  const tangent = { x: facing.z, z: -facing.x };
  const hingeSign = door.hinge === "right" ? 1 : -1;
  const hingeX = door.x + hingeSign * (door.width / 2) * tangent.x;
  const hingeZ = door.z + hingeSign * (door.width / 2) * tangent.z;
  // Closed leaf points from hinge toward the other jamb (opposite hinge side).
  const closed = { x: -hingeSign * tangent.x, z: -hingeSign * tangent.z };
  const openSide = door.openInward === false ? -1 : 1;
  const open = { x: openSide * facing.x, z: openSide * facing.z };
  const startAngle = Math.atan2(closed.z, closed.x);
  const openDeg = door.openDeg ?? 90;
  // Choose rotation sign that moves the closed leaf toward the open side.
  const plus = rotate(closed, openDeg * D2R);
  const dotPlus = plus.x * open.x + plus.z * open.z;
  const sign = dotPlus >= 0 ? 1 : -1;
  return {
    hingeX,
    hingeZ,
    radius: door.width,
    startAngle,
    sweepAngle: sign * openDeg * D2R,
  };
}

export function pointInDoorSweep(px: number, pz: number, s: DoorSweep): boolean {
  const dx = px - s.hingeX;
  const dz = pz - s.hingeZ;
  const r = Math.hypot(dx, dz);
  if (r > s.radius + 1e-9 || r < 1e-6) return false;
  let ang = Math.atan2(dz, dx) - s.startAngle;
  // Normalize into the sweep direction.
  ang = normalizeSigned(ang, s.sweepAngle);
  const lo = Math.min(0, s.sweepAngle);
  const hi = Math.max(0, s.sweepAngle);
  return ang >= lo - 1e-9 && ang <= hi + 1e-9;
}

/** Find the top-most table/regTable whose footprint contains a point. */
export function findParentTable(
  px: number,
  pz: number,
  objects: SceneObject[],
  allowed: ReadonlySet<string>,
): SceneObject | null {
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (!allowed.has(o.kind) || o.hidden) continue;
    if (pointInRect(px, pz, o.x, o.z, o.width, o.depth, o.rotationDeg)) return o;
  }
  return null;
}

function rotate(v: { x: number; z: number }, a: number): { x: number; z: number } {
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return { x: v.x * cos - v.z * sin, z: v.x * sin + v.z * cos };
}

function normalizeSigned(ang: number, sweep: number): number {
  // Bring ang into (-PI, PI] then align to sweep sign.
  while (ang > Math.PI) ang -= 2 * Math.PI;
  while (ang <= -Math.PI) ang += 2 * Math.PI;
  if (sweep < 0 && ang > 0) ang -= 2 * Math.PI;
  if (sweep > 0 && ang < 0) ang += 2 * Math.PI;
  return ang;
}

function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return (lo + hi) / 2;
  return Math.max(lo, Math.min(hi, v));
}
