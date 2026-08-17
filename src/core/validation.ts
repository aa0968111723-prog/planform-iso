/**
 * Field validation — turns the plan into an actionable problem list instead of
 * silent console warnings. Each issue carries a severity, a human message, the
 * target id to select and a focus point so the UI can zoom to it.
 */

import { assetDef } from "./assets";
import type { ObjectKind, Project } from "./model";
import { groupMembers } from "./arrays";
import {
  areaBounds,
  doorSweep,
  pointInDoorSweep,
  pointInRect,
  rectCorners,
  rectsOverlap,
  nearestWallSnap,
} from "./placement";

export type Severity = "error" | "warning" | "info";

export interface Issue {
  id: string;
  severity: Severity;
  code: string;
  message: string;
  targetId: string | null;
  focus: { x: number; z: number };
}

interface PObj {
  id: string; // object id, or the owning group id for members
  kind: ObjectKind;
  x: number;
  z: number;
  w: number;
  d: number;
  rot: number;
  parentId?: string;
}

const FURNITURE: ReadonlySet<ObjectKind> = new Set<ObjectKind>(["table", "chair", "regTable"]);
const WALL_KINDS: ReadonlySet<ObjectKind> = new Set<ObjectKind>(["door", "switch", "screen"]);
const WALL_TOLERANCE = 0.3; // meters a wall asset may sit off the wall before flagging

function expand(project: Project): PObj[] {
  const list: PObj[] = [];
  for (const o of project.objects) {
    if (o.hidden) continue;
    list.push({ id: o.id, kind: o.kind, x: o.x, z: o.z, w: o.width, d: o.depth, rot: o.rotationDeg, parentId: o.parentId });
  }
  for (const g of project.groups) {
    if (g.hidden) continue;
    for (const m of groupMembers(g)) {
      list.push({ id: g.id, kind: g.sourceKind, x: m.x, z: m.z, w: g.itemWidth, d: g.itemDepth, rot: m.rotationDeg });
    }
  }
  return list;
}

function insideAny(px: number, pz: number, project: Project): boolean {
  for (const a of [project.classroom, project.corridor]) {
    const b = areaBounds(a);
    if (px >= b.minX - 1e-9 && px <= b.maxX + 1e-9 && pz >= b.minZ - 1e-9 && pz <= b.maxZ + 1e-9) return true;
  }
  return false;
}

export function validateProject(project: Project): Issue[] {
  const issues: Issue[] = [];
  const objs = expand(project);
  let n = 0;
  const push = (severity: Severity, code: string, message: string, targetId: string | null, focus: { x: number; z: number }) => {
    issues.push({ id: `iss_${n++}`, severity, code, message, targetId, focus });
  };

  // Out of bounds (any footprint corner outside both areas).
  for (const o of objs) {
    const corners = rectCorners(o.x, o.z, o.w, o.d, o.rot);
    if (corners.some((c) => !insideAny(c.x, c.z, project))) {
      push("error", "bounds", `${assetDef(o.kind).displayName}超出場地邊界`, o.id, { x: o.x, z: o.z });
    }
  }

  // Furniture overlap (skip a computer sitting on its own parent table).
  const furn = objs.filter((o) => FURNITURE.has(o.kind) || o.kind === "computer");
  for (let i = 0; i < furn.length; i++) {
    for (let j = i + 1; j < furn.length; j++) {
      const a = furn[i];
      const b = furn[j];
      if (a.parentId === b.id || b.parentId === a.id) continue;
      if (a.kind === "computer" || b.kind === "computer") continue; // computers handled below
      if (rectsOverlap(rect(a), rect(b))) {
        push("warning", "overlap", `${assetDef(a.kind).displayName}與${assetDef(b.kind).displayName}重疊`, a.id, mid(a, b));
      }
    }
  }

  // Mat overlap.
  const mats = objs.filter((o) => o.kind === "mat");
  for (let i = 0; i < mats.length; i++) {
    for (let j = i + 1; j < mats.length; j++) {
      if (rectsOverlap(rect(mats[i]), rect(mats[j]))) {
        push("warning", "mat-overlap", "地墊互相重疊", mats[i].id, mid(mats[i], mats[j]));
        break; // one per mat is enough to avoid noise
      }
    }
  }

  // Door sweep blocked.
  for (const door of project.objects) {
    if (door.kind !== "door" || door.hidden) continue;
    const sweep = doorSweep(door);
    for (const o of objs) {
      if (o.id === door.id || o.kind === "door") continue;
      const corners = rectCorners(o.x, o.z, o.w, o.d, o.rot);
      if (corners.some((c) => pointInDoorSweep(c.x, c.z, sweep))) {
        push("warning", "door-sweep", `門的開啟範圍被${assetDef(o.kind).displayName}擋住`, door.id, { x: door.x, z: door.z });
        break;
      }
    }
  }

  // Wall assets off the wall.
  for (const o of project.objects) {
    if (!WALL_KINDS.has(o.kind) || o.hidden) continue;
    const snap = nearestWallSnap(o.x, o.z, [project.classroom, project.corridor], o.width);
    if (!snap || snap.distance > WALL_TOLERANCE) {
      push("warning", "wall-off", `${assetDef(o.kind).displayName}沒有貼在牆面上`, o.id, { x: o.x, z: o.z });
    }
  }

  // Computer parent integrity.
  for (const o of project.objects) {
    if (o.kind !== "computer" || o.hidden) continue;
    if (o.surface === "tabletop") {
      const parent = o.parentId ? project.objects.find((p) => p.id === o.parentId) : null;
      if (!parent) {
        push("error", "orphan", "電腦沒有可放置的桌面", o.id, { x: o.x, z: o.z });
      } else if (!pointInRect(o.x, o.z, parent.x, parent.z, parent.width, parent.depth, parent.rotationDeg)) {
        push("warning", "off-table", "電腦超出所在桌面範圍", o.id, { x: o.x, z: o.z });
      }
    }
  }

  // Zones outside the classroom footprint.
  const cb = areaBounds(project.classroom);
  for (const z of project.zones) {
    if (z.hidden) continue;
    const corners = rectCorners(z.x, z.z, z.width, z.depth, 0);
    const outClass = corners.some((c) => c.x < cb.minX - 1e-9 || c.x > cb.maxX + 1e-9 || c.z < cb.minZ - 1e-9 || c.z > cb.maxZ + 1e-9);
    if (outClass && !corners.every((c) => insideAny(c.x, c.z, project))) {
      push("warning", "zone-bounds", `小區域「${z.name}」超出教室`, z.id, { x: z.x, z: z.z });
    }
  }

  // Routes crossing furniture.
  for (const route of project.routes) {
    if (!route.visible) continue;
    for (let i = 0; i < route.points.length - 1; i++) {
      const p = route.points[i];
      const q = route.points[i + 1];
      const blocker = furn.find((o) => o.kind !== "computer" && segmentIntersectsRect(p, q, o));
      if (blocker) {
        push("info", "route-cross", `動線「${route.name}」穿越${assetDef(blocker.kind).displayName}`, route.id, mid(p, blocker));
        break;
      }
    }
  }

  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function issueCounts(issues: Issue[]): { error: number; warning: number; info: number } {
  return {
    error: issues.filter((i) => i.severity === "error").length,
    warning: issues.filter((i) => i.severity === "warning").length,
    info: issues.filter((i) => i.severity === "info").length,
  };
}

function rect(o: PObj) {
  return { cx: o.x, cz: o.z, w: o.w, d: o.d, rot: o.rot };
}

function mid(a: { x: number; z: number }, b: { x: number; z: number }): { x: number; z: number } {
  return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
}

function segmentIntersectsRect(
  p: { x: number; z: number },
  q: { x: number; z: number },
  o: PObj,
): boolean {
  // Cheap: sample the segment and test rect containment.
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = p.x + (q.x - p.x) * t;
    const z = p.z + (q.z - p.z) * t;
    if (pointInRect(x, z, o.x, o.z, o.w, o.d, o.rot)) return true;
  }
  return false;
}
