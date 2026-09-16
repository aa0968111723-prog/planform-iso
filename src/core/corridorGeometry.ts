/**
 * Independent corridor geometry: straight / L / T / multi-segment.
 *
 * Changing the corridor never rewrites classroom object positions. Wall-anchored
 * corridor fixtures follow the corridor AABB; classroom wall anchors stay put.
 */

import {
  uid,
  type AreaConfig,
  type ClassroomCorridorLink,
  type CorridorKind,
  type CorridorLayout,
  type CorridorSegment,
  type CorridorSegmentKind,
  type Project,
  type SceneObject,
} from "./model";
import { pointInRect, rectCorners, wallAnchorToPosition } from "./placement";

export function corridorFromArea(area: AreaConfig): CorridorLayout {
  return {
    kind: "straight",
    segments: [segmentFromArea(area, "passage")],
    links: [],
  };
}

export function segmentFromArea(area: Pick<AreaConfig, "name" | "x" | "z" | "length" | "width">, kind: CorridorSegmentKind = "passage"): CorridorSegment {
  return {
    id: uid("seg"),
    name: area.name || "走廊段",
    x: area.x,
    z: area.z,
    length: area.length,
    width: area.width,
    rotationDeg: 0,
    kind,
    passable: kind !== "restricted",
  };
}

export function ensureCorridorLayout(project: Project): CorridorLayout {
  if (project.corridorLayout && project.corridorLayout.segments.length) return project.corridorLayout;
  return corridorFromArea(project.corridor);
}

/** World AABB of a (possibly rotated) segment, as a min-corner AreaConfig. */
export function segmentAabb(seg: CorridorSegment): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const cx = seg.x + seg.length / 2;
  const cz = seg.z + seg.width / 2;
  const corners = rectCorners(cx, cz, seg.length, seg.width, seg.rotationDeg);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const c of corners) {
    minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
    minZ = Math.min(minZ, c.z); maxZ = Math.max(maxZ, c.z);
  }
  return { minX, maxX, minZ, maxZ };
}

export function aabbOfSegments(segments: CorridorSegment[]): Pick<AreaConfig, "x" | "z" | "length" | "width"> {
  if (!segments.length) return { x: 0, z: 0, length: 1, width: 1 };
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const seg of segments) {
    const b = segmentAabb(seg);
    minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX);
    minZ = Math.min(minZ, b.minZ); maxZ = Math.max(maxZ, b.maxZ);
  }
  return { x: minX, z: minZ, length: Math.max(0.4, maxX - minX), width: Math.max(0.4, maxZ - minZ) };
}

export function pointInSegment(px: number, pz: number, seg: CorridorSegment): boolean {
  const cx = seg.x + seg.length / 2;
  const cz = seg.z + seg.width / 2;
  return pointInRect(px, pz, cx, cz, seg.length, seg.width, seg.rotationDeg);
}

export function pointInCorridorLayout(px: number, pz: number, layout: CorridorLayout, opts?: { passableOnly?: boolean }): boolean {
  for (const seg of layout.segments) {
    if (opts?.passableOnly && !seg.passable) continue;
    if (pointInSegment(px, pz, seg)) return true;
  }
  return false;
}

export function buildStraightCorridor(classroom: AreaConfig, corridorWidth = 2): CorridorSegment[] {
  return [{
    id: uid("seg"),
    name: "主走廊",
    x: classroom.x,
    z: classroom.z + classroom.width,
    length: classroom.length,
    width: corridorWidth,
    rotationDeg: 0,
    kind: "passage",
    passable: true,
  }];
}

/** South strip + SE corner square + east arm. Classroom objects are not referenced. */
export function buildLCorridor(classroom: AreaConfig, corridorWidth = 2): CorridorSegment[] {
  const south = buildStraightCorridor(classroom, corridorWidth)[0];
  const corner: CorridorSegment = {
    id: uid("seg"),
    name: "轉角",
    x: classroom.x + classroom.length,
    z: classroom.z + classroom.width,
    length: corridorWidth,
    width: corridorWidth,
    rotationDeg: 0,
    kind: "passage",
    passable: true,
  };
  const east: CorridorSegment = {
    id: uid("seg"),
    name: "轉角走廊",
    x: classroom.x + classroom.length,
    z: classroom.z,
    length: corridorWidth,
    width: classroom.width,
    rotationDeg: 0,
    kind: "passage",
    passable: true,
  };
  return [south, corner, east];
}

/** South strip + a stem from the middle going further south. */
export function buildTCorridor(classroom: AreaConfig, corridorWidth = 2, stemLength = 4): CorridorSegment[] {
  const south = buildStraightCorridor(classroom, corridorWidth)[0];
  const stem: CorridorSegment = {
    id: uid("seg"),
    name: "分支走廊",
    x: classroom.x + classroom.length / 2 - corridorWidth / 2,
    z: classroom.z + classroom.width + corridorWidth,
    length: corridorWidth,
    width: stemLength,
    rotationDeg: 0,
    kind: "passage",
    passable: true,
  };
  return [south, stem];
}

export function layoutForKind(kind: CorridorKind, classroom: AreaConfig, corridorWidth = 2): CorridorLayout {
  const segments =
    kind === "L" ? buildLCorridor(classroom, corridorWidth)
      : kind === "T" ? buildTCorridor(classroom, corridorWidth)
        : kind === "multi" ? [...buildLCorridor(classroom, corridorWidth), ...buildTCorridor(classroom, corridorWidth).slice(1)]
          : buildStraightCorridor(classroom, corridorWidth);
  return { kind: kind === "multi" ? "multi" : kind, segments, links: [] };
}

/**
 * Write corridor geometry onto the project. Classroom objects keep their x/z.
 * Only corridor wall-anchors are recomputed.
 */
export function applyCorridorLayout(project: Project, layout: CorridorLayout): void {
  const box = aabbOfSegments(layout.segments);
  project.corridorLayout = layout;
  project.corridor = {
    ...project.corridor,
    id: "corridor",
    x: box.x,
    z: box.z,
    length: box.length,
    width: box.width,
  };
  const areas = [project.classroom, project.corridor];
  for (const o of project.objects) {
    if (!o.wallAnchor || o.wallAnchor.areaId !== "corridor") continue;
    const pos = wallAnchorToPosition(o.wallAnchor, areas);
    if (pos) {
      o.x = pos.x;
      o.z = pos.z;
      o.rotationDeg = pos.rotationDeg;
    }
  }
}

export function addCorridorSegment(layout: CorridorLayout, patch?: Partial<CorridorSegment>): CorridorLayout {
  const last = layout.segments[layout.segments.length - 1];
  const seg: CorridorSegment = {
    id: uid("seg"),
    name: `走廊段 ${layout.segments.length + 1}`,
    x: last ? last.x + last.length : 0,
    z: last ? last.z : 0,
    length: last?.length ?? 4,
    width: last?.width ?? 2,
    rotationDeg: 0,
    kind: "passage",
    passable: true,
    ...patch,
  };
  return { ...layout, kind: "multi", segments: [...layout.segments, seg] };
}

export function copyCorridorSegment(layout: CorridorLayout, id: string): CorridorLayout {
  const src = layout.segments.find((s) => s.id === id);
  if (!src) return layout;
  const copy: CorridorSegment = {
    ...src,
    id: uid("seg"),
    name: `${src.name} 副本`,
    x: src.x + 0.6,
    z: src.z + 0.6,
  };
  return { ...layout, kind: "multi", segments: [...layout.segments, copy] };
}

export function deleteCorridorSegment(layout: CorridorLayout, id: string): CorridorLayout {
  if (layout.segments.length <= 1) return layout;
  return {
    ...layout,
    kind: layout.segments.length - 1 === 1 ? "straight" : "multi",
    segments: layout.segments.filter((s) => s.id !== id),
    links: layout.links.filter((l) => l.segmentId !== id),
  };
}

export function updateCorridorSegment(layout: CorridorLayout, id: string, patch: Partial<CorridorSegment>): CorridorLayout {
  return {
    ...layout,
    segments: layout.segments.map((s) => s.id === id ? { ...s, ...patch } : s),
  };
}

/** Snap segment B so it shares an edge with A (connect). */
export function connectCorridorSegments(layout: CorridorLayout, aId: string, bId: string): CorridorLayout {
  const a = layout.segments.find((s) => s.id === aId);
  const b = layout.segments.find((s) => s.id === bId);
  if (!a || !b) return layout;
  const next = { ...b, x: a.x + a.length, z: a.z };
  return updateCorridorSegment(layout, bId, next);
}

export function connectClassroomDoor(
  project: Project,
  door: SceneObject,
  segmentId?: string,
): ClassroomCorridorLink {
  const layout = ensureCorridorLayout(project);
  const seg = (segmentId && layout.segments.find((s) => s.id === segmentId))
    || layout.segments.find((s) => pointInSegment(door.x, door.z + 0.4, s))
    || layout.segments[0];
  return {
    id: uid("link"),
    doorObjectId: door.id,
    segmentId: seg?.id ?? "",
    enterDir: "into-classroom",
    leaveDir: "into-corridor",
    primary: !layout.links.some((l) => l.primary),
    showLink: true,
    locked: false,
  };
}

const CORRIDORS_KEY = "planform-iso:corridor-templates";

export interface CorridorTemplate {
  id: string;
  name: string;
  layout: CorridorLayout;
  width: number;
  createdAt: number;
}

function safeStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function listCorridorTemplates(): CorridorTemplate[] {
  const ls = safeStorage();
  if (!ls) return [];
  try {
    const raw = ls.getItem(CORRIDORS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed as CorridorTemplate[] : [];
  } catch {
    return [];
  }
}

export function saveCorridorTemplate(name: string, layout: CorridorLayout, width: number): CorridorTemplate | null {
  const ls = safeStorage();
  if (!ls) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const item: CorridorTemplate = {
    id: uid("cormy"),
    name: trimmed,
    layout: JSON.parse(JSON.stringify(layout)) as CorridorLayout,
    width,
    createdAt: Date.now(),
  };
  const next = [...listCorridorTemplates().filter((t) => t.name !== trimmed), item];
  try {
    ls.setItem(CORRIDORS_KEY, JSON.stringify(next));
    return item;
  } catch {
    return null;
  }
}

export function deleteCorridorTemplate(id: string): void {
  const ls = safeStorage();
  if (!ls) return;
  try {
    ls.setItem(CORRIDORS_KEY, JSON.stringify(listCorridorTemplates().filter((t) => t.id !== id)));
  } catch { /* ignore */ }
}

/** Classroom objects keep their coordinates after a corridor rewrite. */
export function classroomObjectsUnmoved(
  before: SceneObject[],
  after: SceneObject[],
): boolean {
  const afterById = new Map(after.map((o) => [o.id, o]));
  for (const o of before) {
    if (o.wallAnchor?.areaId === "corridor") continue;
    const n = afterById.get(o.id);
    if (!n) continue;
    if (Math.abs(n.x - o.x) > 1e-9 || Math.abs(n.z - o.z) > 1e-9) return false;
  }
  return true;
}
