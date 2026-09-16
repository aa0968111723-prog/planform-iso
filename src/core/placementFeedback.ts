/**
 * Placement-mode validity: colour plus a short Chinese reason.
 *
 * Green / yellow / red already live on the ghost mesh. This module is the
 * single source for the caption next to them, so the toolbar, toast and tests
 * cannot drift.
 */

import type { AreaConfig, Project, SceneObject, Surface } from "./model";
import {
  areaBounds,
  clampPointToAreas,
  findParentTable,
  nearestWallSnap,
  pointInRect,
  rectsOverlap,
  type Bounds,
} from "./placement";
import { applySnap, type SnapMode } from "./units";
import { ensureCorridorLayout, pointInCorridorLayout } from "./corridorGeometry";

export type PlacementValidity = "ok" | "warn" | "bad";

export type PlacementReasonId =
  | "ok"
  | "overlap"
  | "out-of-bounds"
  | "blocks-entrance"
  | "wall-clearance"
  | "need-tabletop"
  | "need-wall"
  | "overflow";

export const PLACEMENT_REASON_TEXT: Record<PlacementReasonId, string> = {
  ok: "可以放置",
  overlap: "與其他物件重疊",
  "out-of-bounds": "超出教室邊界",
  "blocks-entrance": "擋住入口",
  "wall-clearance": "距離牆面不足",
  "need-tabletop": "需要放在桌面上",
  "need-wall": "需要貼齊牆面",
  overflow: "超出教室邊界",
};

export interface PlacementProbe {
  x: number;
  z: number;
  rotationDeg: number;
  validity: PlacementValidity;
  reason: PlacementReasonId;
  text: string;
  surface: Surface;
}

const TABLE_KINDS: ReadonlySet<string> = new Set(["table", "regTable"]);

export function venueAreas(project: Project): AreaConfig[] {
  return [project.classroom, project.corridor];
}

export function pointInsideVenue(px: number, pz: number, project: Project): boolean {
  const c = project.classroom;
  if (px >= c.x && px <= c.x + c.length && pz >= c.z && pz <= c.z + c.width) return true;
  return pointInCorridorLayout(px, pz, ensureCorridorLayout(project));
}

function footprintOverlaps(
  x: number, z: number, w: number, d: number, rot: number,
  others: SceneObject[],
): boolean {
  const self = { cx: x, cz: z, w, d, rot };
  for (const o of others) {
    if (o.hidden || o.collisionEnabled === false) continue;
    if (rectsOverlap(self, { cx: o.x, cz: o.z, w: o.width, d: o.depth, rot: o.rotationDeg })) return true;
  }
  return false;
}

function blocksDoor(
  x: number, z: number, w: number, d: number, rot: number,
  project: Project,
): boolean {
  const door = project.objects.find((o) => o.kind === "door" && !o.hidden);
  if (!door) return false;
  const clearance = project.validationSettings.doorFrontClearance ?? 0.6;
  const front = { cx: door.x, cz: door.z, w: door.width + clearance, d: door.depth + clearance + 0.4, rot: door.rotationDeg };
  return rectsOverlap({ cx: x, cz: z, w, d, rot }, front);
}

function wallClearanceShort(
  x: number, z: number, w: number, d: number,
  classroom: AreaConfig,
  min = 0.05,
): boolean {
  const b: Bounds = areaBounds(classroom);
  const hx = w / 2, hz = d / 2;
  const left = (x - hx) - b.minX;
  const right = b.maxX - (x + hx);
  const north = (z - hz) - b.minZ;
  const south = b.maxZ - (z + hz);
  const nearest = Math.min(left, right, north, south);
  return nearest >= -1e-6 && nearest < min;
}

export function probePlacement(opts: {
  project: Project;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  rotationDeg: number;
  surface: Surface;
  snap: SnapMode;
  skipObjectId?: string;
}): PlacementProbe {
  const { project, width, depth, surface, snap } = opts;
  let { x, z } = opts;
  const rotationDeg = opts.rotationDeg;
  if (surface === "floor") {
    const s = applySnap(x, z, project.tile, snap);
    x = s.x; z = s.z;
  }

  if (surface === "wall") {
    const wall = nearestWallSnap(x, z, venueAreas(project), width);
    if (!wall || wall.distance > 3) {
      return { x, z, rotationDeg, validity: "bad", reason: "need-wall", text: PLACEMENT_REASON_TEXT["need-wall"], surface };
    }
    return {
      x: wall.x, z: wall.z, rotationDeg: wall.rotationDeg,
      validity: wall.distance < 1.2 ? "ok" : "warn",
      reason: wall.distance < 1.2 ? "ok" : "need-wall",
      text: wall.distance < 1.2 ? PLACEMENT_REASON_TEXT.ok : PLACEMENT_REASON_TEXT["need-wall"],
      surface,
    };
  }

  if (surface === "tabletop") {
    const table = findParentTable(x, z, project.objects, TABLE_KINDS);
    if (!table) {
      return { x, z, rotationDeg, validity: "bad", reason: "need-tabletop", text: PLACEMENT_REASON_TEXT["need-tabletop"], surface };
    }
    const on = pointInRect(x, z, table.x, table.z, table.width, table.depth, table.rotationDeg);
    if (!on) {
      return { x, z, rotationDeg, validity: "bad", reason: "need-tabletop", text: PLACEMENT_REASON_TEXT["need-tabletop"], surface };
    }
    return { x, z, rotationDeg, validity: "ok", reason: "ok", text: PLACEMENT_REASON_TEXT.ok, surface };
  }

  if (!pointInsideVenue(x, z, project)) {
    const clamped = clampPointToAreas(x, z, venueAreas(project));
    return {
      x: clamped.x, z: clamped.z, rotationDeg,
      validity: "bad", reason: "out-of-bounds", text: PLACEMENT_REASON_TEXT["out-of-bounds"], surface,
    };
  }

  const others = project.objects.filter((o) => o.id !== opts.skipObjectId);
  if (footprintOverlaps(x, z, width, depth, rotationDeg, others)) {
    return { x, z, rotationDeg, validity: "warn", reason: "overlap", text: PLACEMENT_REASON_TEXT.overlap, surface };
  }
  if (blocksDoor(x, z, width, depth, rotationDeg, project)) {
    return { x, z, rotationDeg, validity: "bad", reason: "blocks-entrance", text: PLACEMENT_REASON_TEXT["blocks-entrance"], surface };
  }
  if (wallClearanceShort(x, z, width, depth, project.classroom, project.validationSettings.matWallClearance ?? 0.05)) {
    return { x, z, rotationDeg, validity: "warn", reason: "wall-clearance", text: PLACEMENT_REASON_TEXT["wall-clearance"], surface };
  }
  return { x, z, rotationDeg, validity: "ok", reason: "ok", text: PLACEMENT_REASON_TEXT.ok, surface };
}

export function applyEditorSnap(
  px: number,
  pz: number,
  project: Project,
  mode: SnapMode,
  objects: SceneObject[] = project.objects,
): { x: number; z: number; hint: string | null } {
  if (mode === "wall") {
    const snap = nearestWallSnap(px, pz, venueAreas(project), 0.2);
    if (snap && snap.distance < 0.8) return { x: snap.x, z: snap.z, hint: "牆面" };
    return { x: px, z: pz, hint: null };
  }
  if (mode === "entrance") {
    const door = objects.find((o) => o.kind === "door" && !o.hidden);
    if (door) {
      const dx = px - door.x, dz = pz - door.z;
      if (Math.hypot(dx, dz) < 1.5) return { x: door.x, z: door.z, hint: "入口" };
    }
    return { x: px, z: pz, hint: null };
  }
  if (mode === "centerline") {
    const c = project.classroom;
    const midX = c.x + c.length / 2;
    const midZ = c.z + c.width / 2;
    if (Math.abs(px - midX) < Math.abs(pz - midZ)) return { x: midX, z: pz, hint: "中線" };
    return { x: px, z: midZ, hint: "中線" };
  }
  if (mode === "object") {
    let best: { x: number; z: number; d: number } | null = null;
    for (const o of objects) {
      if (o.hidden) continue;
      const d = Math.hypot(px - o.x, pz - o.z);
      if (d < 0.8 && (!best || d < best.d)) best = { x: o.x, z: o.z, d };
      const hw = o.width / 2, hd = o.depth / 2;
      for (const [ex, ez] of [[o.x - hw, o.z], [o.x + hw, o.z], [o.x, o.z - hd], [o.x, o.z + hd]]) {
        const de = Math.hypot(px - ex, pz - ez);
        if (de < 0.5 && (!best || de < best.d)) best = { x: ex, z: ez, d: de };
      }
    }
    if (best) return { x: best.x, z: best.z, hint: "物件" };
    return { x: px, z: pz, hint: null };
  }
  const s = applySnap(px, pz, project.tile, mode);
  return { x: s.x, z: s.z, hint: mode === "off" ? null : "格線" };
}

export function placementCaption(validity: PlacementValidity, reason: PlacementReasonId): string {
  return PLACEMENT_REASON_TEXT[reason] ?? (validity === "ok" ? "可以放置" : "無法放置");
}
