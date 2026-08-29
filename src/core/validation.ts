/**
 * Field validation 2.0 — an actionable problem list with user-configurable
 * thresholds (not legal standards). Uses a spatial-hash broad-phase for
 * overlap checks and exact segment-vs-rotated-rect for route intrusion so
 * 100+ mats/chairs stay cheap.
 */

import { assetDef } from "./assets";
import { BOOTH_OVERLAP_EXEMPT, boothCatalogEntry } from "./boothCatalog";
import { isBoothProject } from "./boothCatalog";
import { propForAssetId } from "./propCatalog";
import {
  DEFAULT_VALIDATION_SETTINGS,
  type ObjectKind,
  type Project,
  type PropDefinition,
  type SceneObject,
  type ValidationSettings,
} from "./model";
import { groupFootprint, groupMembers } from "./arrays";
import {
  areaBounds,
  doorSweep,
  facingVec,
  footprintBounds,
  pointInDoorSweep,
  pointInRect,
  rectCorners,
  rectsOverlap,
  segmentIntersectsRect,
  segmentsIntersect,
  nearestWallSnap,
  wallClearances,
  type Bounds,
  type Rect,
} from "./placement";
import { SpatialHash } from "./spatialHash";

export type Severity = "error" | "warning" | "info";

export interface Issue {
  id: string;
  severity: Severity;
  code: string;
  shortTitle: string;
  message: string;
  targetId: string | null;
  focus: { x: number; z: number };
  suggestedAction?: string;
}

interface PObj extends Rect {
  id: string; // object id, or owning group id for members
  kind: ObjectKind;
  parentId?: string;
  assetId?: string;
}

const FURNITURE: ReadonlySet<ObjectKind> = new Set<ObjectKind>(["table", "chair", "regTable"]);
const TALL: ReadonlySet<ObjectKind> = new Set<ObjectKind>(["table", "regTable"]);
const WALL_KINDS: ReadonlySet<ObjectKind> = new Set<ObjectKind>(["door", "switch", "screen"]);
const WALL_TOLERANCE = 0.3;
const SCREEN_VIEW_DEPTH = 4;

function expand(project: Project): PObj[] {
  const list: PObj[] = [];
  for (const o of project.objects) {
    if (o.hidden) continue;
    list.push({ id: o.id, kind: o.kind, cx: o.x, cz: o.z, w: o.width, d: o.depth, rot: o.rotationDeg, parentId: o.parentId, assetId: o.assetId });
  }
  for (const g of project.groups) {
    if (g.hidden) continue;
    for (const m of groupMembers(g)) {
      list.push({ id: g.id, kind: g.sourceKind, cx: m.x, cz: m.z, w: g.itemWidth, d: g.itemDepth, rot: m.rotationDeg });
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

export function validateProject(project: Project, settings?: ValidationSettings): Issue[] {
  const cfg = settings ?? project.validationSettings ?? DEFAULT_VALIDATION_SETTINGS;
  const issues: Issue[] = [];
  const objs = expand(project);
  let n = 0;
  const push = (
    severity: Severity, code: string, shortTitle: string, message: string,
    targetId: string | null, focus: { x: number; z: number }, suggestedAction?: string,
  ) => {
    issues.push({ id: `iss_${n++}`, severity, code, shortTitle, message, targetId, focus, suggestedAction });
  };

  // Broad-phase spatial hash of every footprint.
  const hash = new SpatialHash(1);
  for (const o of objs) hash.insert(o);
  const pairs = hash.candidatePairs();

  // Outdoor booth rules run first so their (error-level) overlap findings can
  // suppress the generic (warning-level) furniture-overlap report on the same
  // pair — one problem should produce one line, not two.
  const booth = isBoothProject(project);
  const boothOverlapPairs = new Set<string>();
  // Prop checks apply to ANY plan with definitions — a dice station in a
  // classroom is as capable of putting its player in a wall as one in a booth.
  for (const raw of propValidationIssues(project)) {
    issues.push({ ...raw, id: `iss_${n++}` });
  }
  if (booth) {
    for (const raw of boothValidationIssues(project, cfg, boothOverlapPairs)) {
      push(raw.severity, raw.code, raw.shortTitle, raw.message, raw.targetId, raw.focus, raw.suggestedAction);
    }
  }

  // Bounds. Wall-mounted assets sit centered on the wall line by design, so
  // half their thin depth legitimately overhangs the room rectangle — for
  // those only the center must be on a wall of the venue.
  //
  // Skipped entirely on an outdoor booth: a pitch has no walls, and the
  // neighbouring stall and the edge-of-pitch signage are deliberately outside
  // the 攤位範圍 rectangle. The booth rules below cover what actually matters
  // there (blocked entrance, occupied path, overlaps, aisle width).
  if (!booth) {
    for (const o of objs) {
      if (WALL_KINDS.has(o.kind)) {
        if (!insideAny(o.cx, o.cz, project)) {
          push("error", "bounds", "超出場地", `${assetDef(o.kind).displayName}超出場地邊界`, o.id, { x: o.cx, z: o.cz }, "移回教室或走廊範圍內");
        }
        continue;
      }
      const corners = rectCorners(o.cx, o.cz, o.w, o.d, o.rot);
      if (corners.some((c) => !insideAny(c.x, c.z, project))) {
        push("error", "bounds", "超出場地", `${assetDef(o.kind).displayName}超出場地邊界`, o.id, { x: o.cx, z: o.cz }, "移回教室或走廊範圍內");
      }
    }
  }

  // Overlaps (broad-phase filtered).
  const overlapSeen = new Set<string>();
  const matOverlapReported = new Set<string>();
  for (const [ia, ib] of pairs) {
    const a = hash.getItem(ia) as PObj;
    const b = hash.getItem(ib) as PObj;
    if (a.id === b.id) continue; // members of same group cannot overlap
    if (a.parentId === b.id || b.parentId === a.id) continue;
    // A tent roof, a hung banner and a floor mat are *meant* to have other
    // things inside their footprint. Two of the SAME asset overlapping is
    // still a mistake, so mat-on-mat keeps reporting.
    const exempt = a.assetId !== b.assetId
      && (BOOTH_OVERLAP_EXEMPT.has(a.assetId ?? "") || BOOTH_OVERLAP_EXEMPT.has(b.assetId ?? ""));
    if (exempt) continue;
    if (boothOverlapPairs.has([a.id, b.id].sort().join("|"))) continue;
    const bothMat = a.kind === "mat" && b.kind === "mat";
    const bothFurn = (FURNITURE.has(a.kind)) && (FURNITURE.has(b.kind));
    if (!bothMat && !bothFurn) continue;
    if (!rectsOverlap(a, b)) continue;
    if (bothMat) {
      if (!matOverlapReported.has(a.id)) {
        matOverlapReported.add(a.id);
        push("warning", "mat-overlap", "地墊重疊", "地墊互相重疊", a.id, mid(a, b), "調整間距或位置");
      }
    } else {
      const key = [a.id, b.id].sort().join("|");
      if (!overlapSeen.has(key)) {
        overlapSeen.add(key);
        push("warning", "overlap", "家具重疊", `${assetDef(a.kind).displayName}與${assetDef(b.kind).displayName}重疊`, a.id, mid(a, b), "分開兩件家具");
      }
    }
  }

  // Door sweep + entrance clearance.
  for (const door of project.objects) {
    if (door.kind !== "door" || door.hidden) continue;
    const sweep = doorSweep(door);
    const facing = facingVec(door.rotationDeg);
    const clearance = Math.max(0, cfg.doorFrontClearance);
    const front: Rect = { cx: door.x + facing.x * (sweep.radius / 2 + clearance / 2), cz: door.z + facing.z * (sweep.radius / 2 + clearance / 2), w: door.width, d: sweep.radius + clearance, rot: door.rotationDeg };
    const near = hash.queryRect(front);
    let sweepBlocked = false;
    let regBlocked = false;
    for (const idx of near) {
      const o = hash.getItem(idx) as PObj;
      if (o.kind === "door") continue;
      const corners = rectCorners(o.cx, o.cz, o.w, o.d, o.rot);
      if (!sweepBlocked && corners.some((c) => pointInDoorSweep(c.x, c.z, sweep))) {
        sweepBlocked = true;
        push("warning", "door-sweep", "門被擋", `門的開啟範圍被${assetDef(o.kind).displayName}擋住`, door.id, { x: door.x, z: door.z }, "移開擋住門弧的物件");
      }
      if (rectsOverlap(front, o)) {
        if (o.kind === "regTable" && !regBlocked) {
          regBlocked = true;
          push("warning", "registration-blocks-entry", "報到桌擋入口", "報到桌擋住入口動線", o.id, { x: o.cx, z: o.cz }, "把報到桌移離門前淨空區");
        } else if (o.kind !== "regTable") {
          push("warning", "entrance-blocked", "入口被擋", `入口前方淨空被${assetDef(o.kind).displayName}佔用`, door.id, { x: front.cx, z: front.cz }, "保留門前淨空");
        }
      }
    }
  }

  // Wall assets off the wall. Only for assets actually placed on a wall: an
  // outdoor banner is a `screen` hanging off a tent, and telling the user it
  // is "not against the wall" on a pitch that has no walls is nonsense.
  for (const o of project.objects) {
    if (!WALL_KINDS.has(o.kind) || o.hidden || o.surface !== "wall") continue;
    const snap = nearestWallSnap(o.x, o.z, [project.classroom, project.corridor], o.width);
    if (!snap || snap.distance > WALL_TOLERANCE) {
      push("warning", "wall-off", "未貼牆", `${assetDef(o.kind).displayName}沒有貼在牆面上`, o.id, { x: o.x, z: o.z }, "拖到牆邊自動吸附");
    }
  }

  // Tabletop parent integrity (computers, QR 立架, 名牌…).
  for (const o of project.objects) {
    if (o.kind !== "computer" || o.hidden || o.surface !== "tabletop") continue;
    const parent = o.parentId ? project.objects.find((p) => p.id === o.parentId) : null;
    const label = propForAssetId(project.props, o.assetId)?.name ?? assetDef(o.kind).displayName;
    if (!parent) push("error", "orphan", `${label}懸空`, `${label}沒有可放置的桌面`, o.id, { x: o.x, z: o.z }, "放到桌面上或解除桌面關聯");
    else if (!pointInRect(o.x, o.z, parent.x, parent.z, parent.width, parent.depth, parent.rotationDeg)) {
      push("warning", "off-table", `${label}超出桌面`, `${label}超出所在桌面範圍`, o.id, { x: o.x, z: o.z }, "移回桌面內");
    }
  }

  // Zones outside the classroom footprint.
  const cb = areaBounds(project.classroom);
  for (const z of project.zones) {
    if (z.hidden) continue;
    const corners = rectCorners(z.x, z.z, z.width, z.depth, 0);
    if (corners.some((c) => c.x < cb.minX - 1e-9 || c.x > cb.maxX + 1e-9 || c.z < cb.minZ - 1e-9 || c.z > cb.maxZ + 1e-9)
      && !corners.every((c) => insideAny(c.x, c.z, project))) {
      push("warning", "zone-bounds", "區域超界", `小區域「${z.name}」超出教室`, z.id, { x: z.x, z: z.z }, "縮小或移入教室");
    }
  }

  // Mat too close to wall.
  for (const o of objs) {
    if (o.kind !== "mat") continue;
    const wc = wallClearances(o, project.classroom);
    if (wc.nearest < cfg.matWallClearance - 1e-6 && wc.nearest > -0.5) {
      push("warning", "mat-too-close-to-wall", "地墊太靠牆", `地墊距牆僅 ${(wc.nearest * 100).toFixed(0)} cm（低於 ${(cfg.matWallClearance * 100).toFixed(0)} cm）`, o.id, { x: o.cx, z: o.cz }, "調整地墊距牆距離或修改門檻");
    }
  }

  // Aisle too narrow between big blocks (array groups + tall furniture).
  const blocks: { id: string; b: Bounds; focus: { x: number; z: number } }[] = [];
  for (const g of project.groups) {
    if (g.hidden) continue;
    const fp = groupFootprint(g);
    if (fp.count === 0) continue;
    const b = groupAabb(g);
    blocks.push({ id: g.id, b, focus: { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 } });
  }
  for (const o of project.objects) {
    if (o.hidden || !TALL.has(o.kind)) continue;
    const b = footprintBounds({ cx: o.x, cz: o.z, w: o.width, d: o.depth, rot: o.rotationDeg });
    blocks.push({ id: o.id, b, focus: { x: o.x, z: o.z } });
  }
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const gap = aisleBetween(blocks[i].b, blocks[j].b, cfg.minAisleWidth);
      if (gap !== null && gap < cfg.minAisleWidth - 1e-6) {
        push("warning", "aisle-too-narrow", "走道過窄", `走道僅約 ${(gap * 100).toFixed(0)} cm（低於 ${(cfg.minAisleWidth * 100).toFixed(0)} cm）`, blocks[i].id, midB(blocks[i].b, blocks[j].b), "拉開間距或降低走道門檻");
      }
    }
  }

  // Screen view blocked.
  if (cfg.checkScreenView) {
    for (const screen of project.objects) {
      if (screen.kind !== "screen" || screen.hidden) continue;
      const f = facingVec(screen.rotationDeg);
      const strip: Rect = { cx: screen.x + f.x * (SCREEN_VIEW_DEPTH / 2), cz: screen.z + f.z * (SCREEN_VIEW_DEPTH / 2), w: screen.width, d: SCREEN_VIEW_DEPTH, rot: screen.rotationDeg };
      for (const idx of hash.queryRect(strip)) {
        const o = hash.getItem(idx) as PObj;
        if (!TALL.has(o.kind)) continue;
        if (rectsOverlap(strip, o)) {
          push("info", "screen-view-blocked", "投影幕視線被擋", `投影幕前方視線被${assetDef(o.kind).displayName}擋住`, screen.id, { x: o.cx, z: o.cz }, "移開投影幕正前方的高家具");
          break;
        }
      }
    }
  }

  // Route intrusion (exact segment vs OBB) + zone-blocks-route + route conflicts.
  const furnItems = objs.filter((o) => TALL.has(o.kind) || o.kind === "chair");
  for (const route of project.routes) {
    if (!route.visible || route.points.length < 2) continue;
    outer: for (let i = 0; i < route.points.length - 1; i++) {
      const p = route.points[i], q = route.points[i + 1];
      for (const o of furnItems) {
        if (segmentIntersectsRect(p, q, o)) {
          push("info", "route-cross", "動線穿越家具", `動線「${route.name}」穿越${assetDef(o.kind).displayName}`, route.id, mid(p, o), "調整動線或移開家具");
          break outer;
        }
      }
    }
    if (cfg.checkZoneRouteIntrusion) {
      for (const z of project.zones) {
        if (z.hidden || (z.type !== "shoe" && z.type !== "backpack")) continue;
        const zr: Rect = { cx: z.x, cz: z.z, w: z.width, d: z.depth, rot: 0 };
        const hit = route.points.some((_, i) => i < route.points.length - 1 && segmentIntersectsRect(route.points[i], route.points[i + 1], zr));
        if (hit) {
          const code = z.type === "shoe" ? "shoe-zone-blocks-route" : "backpack-zone-blocks-route";
          push("info", code, "區域擋動線", `動線「${route.name}」穿越「${z.name}」`, route.id, { x: z.x, z: z.z }, "讓主要動線避開此區域");
        }
      }
    }
  }
  // Primary route conflicts (routes crossing each other).
  for (let a = 0; a < project.routes.length; a++) {
    for (let b = a + 1; b < project.routes.length; b++) {
      const ra = project.routes[a], rb = project.routes[b];
      if (!ra.visible || !rb.visible) continue;
      if (routesCross(ra.points, rb.points)) {
        push("info", "primary-route-conflict", "動線交叉", `動線「${ra.name}」與「${rb.name}」交叉`, ra.id, mid(ra.points[0] ?? { x: 0, z: 0 }, rb.points[0] ?? { x: 0, z: 0 }), "檢查是否造成人流衝突");
      }
    }
  }

  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}

// --- outdoor booth rules ---------------------------------------------------

type RawIssue = Omit<Issue, "id">;

/** Overlap under this (meters) on either axis is a graze, not a collision. */
const BOOTH_OVERLAP_TOLERANCE = 0.04;
/** Anything less than this touching an entrance / path is rounding, not blocking. */
const BOOTH_TOUCH_TOLERANCE = 0.01;

function boothName(o: SceneObject): string {
  return boothCatalogEntry(o.assetId ?? "")?.name ?? assetDef(o.kind).displayName;
}

/** Axis-aligned overlap of two AABBs, per axis. Negative means separated. */
function aabbOverlap(a: Bounds, b: Bounds): { x: number; z: number } {
  return {
    x: Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX),
    z: Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ),
  };
}

function rectBounds(cx: number, cz: number, w: number, d: number): Bounds {
  return { minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 };
}

/**
 * The four checks a booth plan needs, per BOOTH_SIMULATION_SPEC.md §5:
 * things standing in each other, things standing in the entrance or exit,
 * things standing on the paved path, and a too-narrow gap between the table
 * and the display board.
 *
 * `overlapPairs` collects "a|b" keys so the caller can suppress the generic
 * furniture-overlap warning for the same pair.
 */
export function boothValidationIssues(
  project: Project,
  cfg: ValidationSettings,
  overlapPairs: Set<string> = new Set(),
): RawIssue[] {
  const out: RawIssue[] = [];
  // Ground-standing booth kit only: tabletop props, the tent roof, the hung
  // banner and floor mats are all things other objects legitimately share
  // space with.
  const solid = project.objects.filter(
    (o) => !o.hidden && o.surface === "floor" && !BOOTH_OVERLAP_EXEMPT.has(o.assetId ?? ""),
  );
  const bounds = new Map<string, Bounds>(
    solid.map((o) => [o.id, footprintBounds({ cx: o.x, cz: o.z, w: o.width, d: o.depth, rot: o.rotationDeg })]),
  );

  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i], b = solid[j];
      if (a.parentId === b.id || b.parentId === a.id) continue;
      const ov = aabbOverlap(bounds.get(a.id)!, bounds.get(b.id)!);
      if (ov.x <= BOOTH_OVERLAP_TOLERANCE || ov.z <= BOOTH_OVERLAP_TOLERANCE) continue;
      overlapPairs.add([a.id, b.id].sort().join("|"));
      out.push({
        severity: "error",
        code: "booth-overlap",
        shortTitle: "物件重疊",
        message: `${boothName(a)}與${boothName(b)}重疊約 ${(ov.x * 100).toFixed(0)}×${(ov.z * 100).toFixed(0)} cm`,
        targetId: a.id,
        focus: { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 },
        suggestedAction: "拉開兩件物品",
      });
    }
  }

  for (const z of project.zones) {
    if (z.hidden || (z.boothRole !== "entry" && z.boothRole !== "exit")) continue;
    const zb = rectBounds(z.x, z.z, z.width, z.depth);
    for (const o of solid) {
      const ov = aabbOverlap(bounds.get(o.id)!, zb);
      if (ov.x <= BOOTH_TOUCH_TOLERANCE || ov.z <= BOOTH_TOUCH_TOLERANCE) continue;
      out.push({
        severity: "error",
        code: z.boothRole === "entry" ? "booth-entry-blocked" : "booth-exit-blocked",
        shortTitle: `擋住${z.name}`,
        message: `${boothName(o)}壓在${z.name}上，請移開`,
        targetId: o.id,
        focus: { x: o.x, z: o.z },
        suggestedAction: `讓出${z.name}的整塊範圍`,
      });
    }
  }

  const c = project.corridor;
  const corridorBounds = { minX: c.x, maxX: c.x + c.length, minZ: c.z, maxZ: c.z + c.width };
  for (const o of solid) {
    const ov = aabbOverlap(bounds.get(o.id)!, corridorBounds);
    if (ov.x <= BOOTH_TOUCH_TOLERANCE || ov.z <= BOOTH_TOUCH_TOLERANCE) continue;
    out.push({
      severity: "warning",
      code: "booth-object-in-corridor",
      shortTitle: "物件在走道上",
      message: `${boothName(o)}位於${c.name}內，可能阻擋主要人流`,
      targetId: o.id,
      focus: { x: o.x, z: o.z },
      suggestedAction: "移回攤位範圍內",
    });
  }

  const table = project.objects.find((o) => o.assetId === "custom:booth-table" && !o.hidden);
  const board = project.objects.find((o) => o.assetId === "custom:display-board" && !o.hidden);
  if (table && board) {
    const tb = bounds.get(table.id) ?? footprintBounds({ cx: table.x, cz: table.z, w: table.width, d: table.depth, rot: table.rotationDeg });
    const bb = bounds.get(board.id) ?? footprintBounds({ cx: board.x, cz: board.z, w: board.width, d: board.depth, rot: board.rotationDeg });
    const gap = Math.max(tb.minX, bb.minX) - Math.min(tb.maxX, bb.maxX);
    if (gap < cfg.minAisleWidth) {
      out.push({
        severity: "warning",
        code: "booth-aisle-too-narrow",
        shortTitle: "走道過窄",
        message: `攤位桌與展示板之間約 ${(Math.max(0, gap) * 100).toFixed(0)} cm，低於 ${(cfg.minAisleWidth * 100).toFixed(0)} cm`,
        targetId: board.id,
        focus: { x: (table.x + board.x) / 2, z: (table.z + board.z) / 2 },
        suggestedAction: "把展示板往外挪，或降低走道門檻",
      });
    }
  }

  return out;
}

export function issueCounts(issues: Issue[]): { error: number; warning: number; info: number } {
  return {
    error: issues.filter((i) => i.severity === "error").length,
    warning: issues.filter((i) => i.severity === "warning").length,
    info: issues.filter((i) => i.severity === "info").length,
  };
}

function groupAabb(g: import("./model").ArrayGroup): Bounds {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const m of groupMembers(g)) {
    const fb = footprintBounds({ cx: m.x, cz: m.z, w: g.itemWidth, d: g.itemDepth, rot: m.rotationDeg });
    minX = Math.min(minX, fb.minX); maxX = Math.max(maxX, fb.maxX);
    minZ = Math.min(minZ, fb.minZ); maxZ = Math.max(maxZ, fb.maxZ);
  }
  return { minX, maxX, minZ, maxZ };
}

/** Gap between two AABBs if they form a passage (overlap on one axis), else null. */
function aisleBetween(a: Bounds, b: Bounds, cap: number): number | null {
  const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const overlapZ = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
  const gapX = Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX);
  const gapZ = Math.max(a.minZ, b.minZ) - Math.min(a.maxZ, b.maxZ);
  // A passage exists when blocks overlap on one axis and are separated on the other.
  if (overlapZ > 0.5 && gapX > 0 && gapX < cap) return gapX;
  if (overlapX > 0.5 && gapZ > 0 && gapZ < cap) return gapZ;
  return null;
}

function routesCross(a: { x: number; z: number }[], b: { x: number; z: number }[]): boolean {
  for (let i = 0; i < a.length - 1; i++) {
    for (let j = 0; j < b.length - 1; j++) {
      if (segmentsIntersect(a[i], a[i + 1], b[j], b[j + 1])) return true;
    }
  }
  return false;
}

function pt(o: { x?: number; z?: number; cx?: number; cz?: number }): { x: number; z: number } {
  return { x: o.cx ?? o.x ?? 0, z: o.cz ?? o.z ?? 0 };
}

function mid(a: { x?: number; z?: number; cx?: number; cz?: number }, b: { x?: number; z?: number; cx?: number; cz?: number }): { x: number; z: number } {
  const pa = pt(a), pb = pt(b);
  return { x: (pa.x + pb.x) / 2, z: (pa.z + pb.z) / 2 };
}

function midB(a: Bounds, b: Bounds): { x: number; z: number } {
  return { x: ((a.minX + a.maxX) / 2 + (b.minX + b.maxX) / 2) / 2, z: ((a.minZ + a.maxZ) / 2 + (b.minZ + b.maxZ) / 2) / 2 };
}

/**
 * Prop-specific checks (§63) — the rehearsal only means something when the
 * places it puts people can physically hold them.
 *
 * Modest by design: the anchors are advisory geometry, so these are warnings
 * that point at a spot, never errors that block a share.
 */
export function propValidationIssues(project: Project): Omit<Issue, "id">[] {
  const defs = project.props;
  if (!defs?.length) return [];
  const out: Omit<Issue, "id">[] = [];
  const rooms = [project.classroom, project.corridor];
  const inside = (x: number, z: number) =>
    rooms.some((r) => x >= r.x - 1e-6 && x <= r.x + r.length + 1e-6 && z >= r.z - 1e-6 && z <= r.z + r.width + 1e-6);

  interface PlacedProp { obj: Project["objects"][number]; def: PropDefinition }
  const placed: PlacedProp[] = [];
  for (const obj of project.objects) {
    if (obj.hidden) continue;
    const def = propForAssetId(defs, obj.assetId);
    if (def) placed.push({ obj, def });
  }

  for (const { obj, def } of placed) {
    const rad = (obj.rotationDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const world = (ax: number, az: number) => ({
      x: obj.x + ax * cos + az * sin,
      z: obj.z - ax * sin + az * cos,
    });
    for (const anchor of def.anchors) {
      if (anchor.role !== "player" && anchor.role !== "staff") continue;
      const pos = world(anchor.x, anchor.z);
      if (!inside(pos.x, pos.z)) {
        out.push({
          severity: "warning",
          code: "prop-anchor-outside",
          shortTitle: "站位在場地外",
          message: `「${def.name}」的${anchor.role === "player" ? "參加者" : "工作人員"}站位落在場地外——把道具往內移或轉個方向`,
          targetId: obj.id,
          focus: pos,
          suggestedAction: "把道具往場地內移動或旋轉",
        });
      }
    }
  }

  // §18 — two interactive stations too close: their operating circles overlap.
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      if (!a.def.interaction || !b.def.interaction) continue;
      const ra = a.def.interactionZone ?? 1;
      const rb = b.def.interactionZone ?? 1;
      const dist = Math.hypot(a.obj.x - b.obj.x, a.obj.z - b.obj.z);
      if (dist < ra + rb) {
        out.push({
          severity: "warning",
          code: "prop-zone-overlap",
          shortTitle: "互動站太近",
          message: `「${a.def.name}」和「${b.def.name}」的互動範圍重疊，高峰時容易互相干擾`,
          targetId: b.obj.id,
          focus: { x: (a.obj.x + b.obj.x) / 2, z: (a.obj.z + b.obj.z) / 2 },
          suggestedAction: "把兩個互動站拉開一點",
        });
      }
    }
  }

  return out;
}
