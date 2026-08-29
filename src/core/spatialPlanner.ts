/**
 * Spatial planner — turns a brief into several complete, comparable layouts.
 *
 * The division of labour this module exists to enforce: **the AI chooses the
 * goal, this file computes the geometry.** Nothing here consults a model. Every
 * coordinate, every clearance, every capacity number and every wait time is
 * produced by code that can be unit-tested, and every scheme is measured with
 * the SAME validators and the SAME discrete-event simulator the manual editor
 * uses (`validateProject`, `createDefaultScenario`, `runDiscreteEvent`). A
 * scheme that scores well here scores well because the plan is good, not
 * because the planner graded its own homework with a private ruler.
 *
 * Three schemes are produced from one brief:
 *
 *   A 集中服務   one combined desk beside the entrance — fewest staff, shortest
 *                walk, but one queue for everything.
 *   B 報到收費分流 two desks on opposite sides of the entrance — more staff, two
 *                short queues instead of one long one.
 *   C 走道優先   desks pulled off the entrance wall with a wide spine aisle —
 *                lowest crowding, at the cost of seats.
 *
 * They are deliberately different *strategies*, not three random seeds, so the
 * comparison tells the user something.
 */

import { groupMembers } from "./arrays";
import { catalogFromProject } from "./migrate";
import { createDefaultScenario, resolveScenarioBindings } from "./migrate";
import { buildCheckinPaymentVariants, runDiscreteEvent, type SimulationResult } from "./eventFlow";
import { areaBounds, nearestWallSnap, rectsOverlap, type Bounds, type Rect } from "./placement";
import { generateLayouts, type GroupSpec } from "./smartLayout";
import { issueCounts, validateProject, type Issue } from "./validation";
import {
  DEFAULT_VALIDATION_SETTINGS,
  uid,
  ZONE_DEFAULTS,
  type ArrayGroup,
  type ObjectKind,
  type Project,
  type Route,
  type SceneObject,
  type ServiceStation,
  type Zone,
  type ZoneType,
} from "./model";

export type EventType =
  | "tea-gathering"
  | "meditation"
  | "classroom"
  | "booth"
  | "lecture"
  | "workshop"
  | "custom";

export type LayoutObjective =
  | "clear-doors"
  | "separate-checkin-payment"
  | "reduce-crowding"
  | "increase-interaction"
  | "easy-to-staff"
  | "maximise-capacity";

/**
 * A piece of furniture the organiser said they need, over and above the seats.
 *
 * 「要三張長桌、一個茶水區的桌子」 is a real sentence, and until this existed
 * the brief could only express seating — so the planner produced a layout that
 * silently omitted half of what was asked for.
 */
export interface RequiredAsset {
  /** Catalog id. Anything `catalogFromProject` can resolve. */
  assetId: string;
  count: number;
  /** Put it near this zone when the plan has one. */
  zone?: ZoneType;
}

export interface LayoutBrief {
  /** How many people the plan must seat and move. */
  participants: number;
  eventType: EventType;
  /** People running the event. Drives how many desks can actually be opened. */
  staffCount: number;
  /** Minimum aisle width in metres. */
  minAisleWidth: number;
  /** Metres kept clear in front of every door. */
  doorClearance: number;
  /** Zones the organiser said they need. */
  requiredZones: ZoneType[];
  objectives: LayoutObjective[];
  /** Catalog id used for one seat. Defaults by event type. */
  seatAssetId?: string;
  /** Extra furniture the brief asked for by name and count. */
  requiredAssets: RequiredAsset[];
}

export interface SchemeScoreBreakdown {
  /** 0–1 each. */
  capacity: number;
  waiting: number;
  validation: number;
  circulation: number;
  staffing: number;
}

export interface SchemeScore {
  /** 0–100, higher is better. */
  total: number;
  breakdown: SchemeScoreBreakdown;
  /** Which objective drove each weight, so the number can be explained. */
  weights: SchemeScoreBreakdown;
}

export interface SchemeSimulation {
  avgWaitSeconds: number;
  maxWaitSeconds: number;
  avgJourneySeconds: number;
  finishTimeSeconds: number;
  maxQueue: number;
  /** Where the longest queue formed, in words and in metres. */
  busiest: { name: string; x: number; z: number; queue: number } | null;
}

export interface LayoutScheme {
  id: string;
  name: string;
  /** Why this scheme is shaped the way it is. */
  rationale: string[];
  /** What could go wrong, and what the planner could not check. */
  risks: string[];
  objects: SceneObject[];
  groups: ArrayGroup[];
  zones: Zone[];
  routes: Route[];
  stations: ServiceStation[];
  /** Seats the layout actually produces, counted from the geometry. */
  estimatedCapacity: number;
  simulation: SchemeSimulation | null;
  validation: { errors: number; warnings: number; issues: Issue[] };
  score: SchemeScore;
  /** Knowledge-base entry ids the rationale draws on. */
  knowledgeRefs: string[];
  /**
   * Whether this scheme satisfies the brief's HARD requirements.
   *
   * An objective like 「收費另外分流」 is not a preference to be weighed — it is
   * an instruction. Treating it as a weight let a combined-desk scheme outscore
   * a split one and get applied to someone who had just said, in words, that
   * they wanted the desks separated. Scoring chooses among schemes that satisfy
   * the brief; it does not get to overrule it.
   */
  eligible: boolean;
  /** Why it is out of the running. Present exactly when `eligible` is false. */
  ineligibleReason?: string;
}

export interface PlannerResult {
  brief: NormalizedBrief;
  schemes: LayoutScheme[];
  /** Highest scoring scheme id, or null when nothing could be produced. */
  recommendedId: string | null;
  recommendation: string;
  /** Things the planner could not do, stated rather than hidden. */
  notes: string[];
}

export interface NormalizedBrief extends LayoutBrief {
  usable: Bounds;
  entrance: { x: number; z: number; source: "door" | "corridor-midpoint" };
  exits: { x: number; z: number }[];
  seatKind: ObjectKind;
  seatWidth: number;
  seatDepth: number;
}

/* ------------------------------------------------------------------ */
/* Brief normalisation                                                 */
/* ------------------------------------------------------------------ */

const DEFAULT_SEAT: Record<EventType, { kind: ObjectKind; assetId: string; w: number; d: number }> = {
  "tea-gathering": { kind: "mat", assetId: "builtin:mat", w: 0.6, d: 0.6 },
  meditation: { kind: "mat", assetId: "builtin:mat", w: 0.6, d: 0.6 },
  classroom: { kind: "chair", assetId: "builtin:chair", w: 0.45, d: 0.45 },
  booth: { kind: "chair", assetId: "builtin:chair", w: 0.45, d: 0.45 },
  lecture: { kind: "chair", assetId: "builtin:chair", w: 0.45, d: 0.45 },
  workshop: { kind: "chair", assetId: "builtin:chair", w: 0.45, d: 0.45 },
  custom: { kind: "mat", assetId: "builtin:mat", w: 0.6, d: 0.6 },
};

export const DEFAULT_BRIEF: LayoutBrief = {
  participants: 60,
  eventType: "tea-gathering",
  staffCount: 4,
  minAisleWidth: DEFAULT_VALIDATION_SETTINGS.minAisleWidth,
  doorClearance: 1.2,
  requiredZones: ["registration", "payment", "shoe", "meditation"],
  objectives: ["clear-doors", "reduce-crowding"],
  requiredAssets: [],
};

/**
 * Where people come in. A real door beats a guess; when the plan has no door
 * object the planner says so through `source` rather than pretending the
 * corridor midpoint is a door it found.
 */
function findEntrance(project: Project): NormalizedBrief["entrance"] {
  const doors = project.objects.filter((o) => o.kind === "door" && !o.hidden);
  if (doors.length) {
    // The door nearest the corridor is the way in; the rest are exits.
    const corr = project.corridor;
    const cz = corr.z + corr.width / 2;
    const cx = corr.x + corr.length / 2;
    let best = doors[0];
    let bestD = Infinity;
    for (const d of doors) {
      const dist = Math.hypot(d.x - cx, d.z - cz);
      if (dist < bestD) {
        bestD = dist;
        best = d;
      }
    }
    return { x: best.x, z: best.z, source: "door" };
  }
  return {
    x: project.corridor.x + project.corridor.length / 2,
    z: project.corridor.z + project.corridor.width / 2,
    source: "corridor-midpoint",
  };
}

function normalizeBrief(project: Project, input: Partial<LayoutBrief>): NormalizedBrief {
  const brief: LayoutBrief = { ...DEFAULT_BRIEF, ...input };
  const seat = DEFAULT_SEAT[brief.eventType] ?? DEFAULT_SEAT.custom;
  const catalog = catalogFromProject(project);
  const chosen = brief.seatAssetId ? catalog.get(brief.seatAssetId) : undefined;

  const wallInset = Math.max(
    project.validationSettings?.matWallClearance ?? DEFAULT_VALIDATION_SETTINGS.matWallClearance,
    0.3,
  );
  const b = areaBounds(project.classroom);
  const usable: Bounds = {
    minX: b.minX + wallInset,
    maxX: b.maxX - wallInset,
    minZ: b.minZ + wallInset,
    maxZ: b.maxZ - wallInset,
  };

  const doors = project.objects.filter((o) => o.kind === "door" && !o.hidden);
  const entrance = findEntrance(project);

  return {
    ...brief,
    participants: Math.max(1, Math.floor(brief.participants)),
    staffCount: Math.max(0, Math.floor(brief.staffCount)),
    usable,
    entrance,
    exits: doors.filter((d) => Math.hypot(d.x - entrance.x, d.z - entrance.z) > 0.5).map((d) => ({ x: d.x, z: d.z })),
    seatKind: chosen?.kind ?? seat.kind,
    seatWidth: chosen?.dimensions.width ?? seat.w,
    seatDepth: chosen?.dimensions.depth ?? seat.d,
  };
}

/* ------------------------------------------------------------------ */
/* Building blocks                                                     */
/* ------------------------------------------------------------------ */

const DESK_W = 1.8;
const DESK_D = 0.6;
const DESK_H = 0.74;

function makeDesk(
  assetId: string,
  role: SceneObject["serviceRole"],
  x: number,
  z: number,
  rotationDeg: number,
): SceneObject {
  return {
    id: uid("obj"),
    kind: "regTable",
    assetId,
    serviceRole: role,
    x, z,
    rotationDeg,
    width: DESK_W,
    depth: DESK_D,
    height: DESK_H,
    locked: false,
    hidden: false,
    surface: "floor",
    elevation: 0,
  };
}

function makeZone(type: ZoneType, x: number, z: number, width: number, depth: number, capacity: number | null): Zone {
  const d = ZONE_DEFAULTS[type] ?? ZONE_DEFAULTS.custom ?? ZONE_DEFAULTS.registration;
  return {
    id: uid("zone"),
    type,
    name: d.label,
    x, z,
    width: Math.max(0.4, width),
    depth: Math.max(0.4, depth),
    color: d.color,
    icon: d.icon,
    capacity,
    locked: false,
    hidden: false,
  };
}

function makeRoute(name: string, type: Route["type"], color: string, points: { x: number; z: number }[]): Route {
  return { id: uid("route"), name, color, type, points, visible: true };
}

function groupFromSpec(spec: GroupSpec, kind: ObjectKind, height: number, name: string, prefix: string): ArrayGroup {
  return {
    id: uid("grp"),
    name,
    sourceKind: kind,
    rows: spec.rows,
    cols: spec.cols,
    itemWidth: spec.itemWidth,
    itemDepth: spec.itemDepth,
    itemHeight: height,
    gapX: spec.gapX,
    gapZ: spec.gapZ,
    rotationDeg: spec.rotationDeg,
    anchorX: spec.anchorX,
    anchorZ: spec.anchorZ,
    locked: false,
    hidden: false,
    numberPrefix: prefix,
    numberOrder: "row",
    numberStart: "nw",
  };
}

/** Clamp a point into the usable rectangle so a desk never lands in a wall. */
function clampToUsable(x: number, z: number, u: Bounds, halfW = 0, halfD = 0): { x: number; z: number } {
  return {
    x: Math.min(Math.max(x, u.minX + halfW), u.maxX - halfW),
    z: Math.min(Math.max(z, u.minZ + halfD), u.maxZ - halfD),
  };
}

/* ------------------------------------------------------------------ */
/* Extra furniture the brief asked for                                 */
/* ------------------------------------------------------------------ */

/** Every footprint a new object must not land on. */
function occupiedRects(objects: SceneObject[], groups: ArrayGroup[]): Rect[] {
  const out: Rect[] = objects
    .filter((o) => !o.hidden)
    .map((o) => ({ cx: o.x, cz: o.z, w: o.width, d: o.depth, rot: o.rotationDeg }));
  for (const g of groups) {
    if (g.hidden) continue;
    // The whole block, not each member: a hundred separate mat rects turns a
    // linear scan into a quadratic one for no extra accuracy here.
    const w = g.cols * g.itemWidth + (g.cols - 1) * g.gapX;
    const d = g.rows * g.itemDepth + (g.rows - 1) * g.gapZ;
    out.push({ cx: g.anchorX + w / 2, cz: g.anchorZ + d / 2, w, d, rot: g.rotationDeg });
  }
  return out;
}

interface Spot { x: number; z: number; rotationDeg?: number }

/** Nearest free lattice point to `anchor`, on the floor. */
function bestFloorSpot(
  u: Bounds, w: number, d: number, step: number, clear: number,
  anchor: { x: number; z: number }, blocked: Rect[],
): Spot | null {
  let best: { x: number; z: number; dist: number } | null = null;
  for (let x = u.minX + w / 2; x <= u.maxX - w / 2 + 1e-9; x += step) {
    for (let z = u.minZ + d / 2; z <= u.maxZ - d / 2 + 1e-9; z += step) {
      const candidate: Rect = { cx: x, cz: z, w: w + clear, d: d + clear, rot: 0 };
      if (blocked.some((r) => rectsOverlap(candidate, r))) continue;
      const dist = Math.hypot(x - anchor.x, z - anchor.z);
      if (!best || dist < best.dist) best = { x, z, dist };
    }
  }
  return best ? { x: best.x, z: best.z } : null;
}

/**
 * Nearest free spot ON a wall.
 *
 * Walks each wall of the classroom at the same lattice pitch and snaps the
 * result with `nearestWallSnap` — the same function `validateProject` uses to
 * decide whether something is against a wall, so a placement that passes here
 * passes there too.
 */
function bestWallSpot(
  project: Project, w: number, d: number, clear: number,
  anchor: { x: number; z: number }, blocked: Rect[],
): Spot | null {
  const b = areaBounds(project.classroom);
  const areas = [project.classroom, project.corridor];
  const step = 0.3;
  const probes: { x: number; z: number }[] = [];
  for (let x = b.minX; x <= b.maxX + 1e-9; x += step) {
    probes.push({ x, z: b.minZ }, { x, z: b.maxZ });
  }
  for (let z = b.minZ; z <= b.maxZ + 1e-9; z += step) {
    probes.push({ x: b.minX, z }, { x: b.maxX, z });
  }

  let best: { spot: Spot; dist: number } | null = null;
  for (const probe of probes) {
    const snap = nearestWallSnap(probe.x, probe.z, areas, w);
    if (!snap || snap.areaId !== "classroom") continue;
    const candidate: Rect = { cx: snap.x, cz: snap.z, w: w + clear, d: d + clear, rot: snap.rotationDeg };
    if (blocked.some((r) => rectsOverlap(candidate, r))) continue;
    const dist = Math.hypot(snap.x - anchor.x, snap.z - anchor.z);
    if (!best || dist < best.dist) {
      best = { spot: { x: snap.x, z: snap.z, rotationDeg: snap.rotationDeg }, dist };
    }
  }
  return best?.spot ?? null;
}

/**
 * Place the brief's extra furniture in space the scheme has actually left free.
 *
 * A greedy scan on a 0.3 m lattice, preferring positions near the zone the item
 * was assigned to. Anything that cannot be placed is REPORTED, not dropped:
 * quietly leaving out two of the three tables someone asked for is the same
 * class of failure as a tool returning ok:true without doing anything.
 */
function placeRequiredAssets(
  project: Project,
  b: NormalizedBrief,
  parts: { objects: SceneObject[]; groups: ArrayGroup[]; zones: Zone[] },
): { placed: SceneObject[]; unplaced: string[] } {
  if (!b.requiredAssets.length) return { placed: [], unplaced: [] };

  const catalog = catalogFromProject(project);
  const placed: SceneObject[] = [];
  const unplaced: string[] = [];
  // Keep the caller's own furniture, the doors and the walls out of bounds.
  const blocked: Rect[] = [
    ...occupiedRects(parts.objects, parts.groups),
    ...occupiedRects(project.objects.filter((o) => o.kind === "door" || o.locked), []),
  ];

  const u = b.usable;
  const STEP = 0.3;
  const CLEAR = 0.3; // breathing room around each new item

  for (const req of b.requiredAssets) {
    const entry = catalog.get(req.assetId);
    if (!entry) {
      unplaced.push(`找不到素材 ${req.assetId}，沒有放置。`);
      continue;
    }
    const zone = req.zone ? parts.zones.find((z) => z.type === req.zone) : undefined;
    const anchor = zone
      ? { x: zone.x, z: zone.z }
      : { x: (u.minX + u.maxX) / 2, z: (u.minZ + u.maxZ) / 2 };

    // A screen or a switch mounts on a WALL. Dropping it on the floor lattice
    // produced a plan that failed the product's own `wall-off` check — the
    // planner must not hand the user a layout its validator rejects.
    const onWall = entry.placementType === "wall";
    let done = 0;
    for (let i = 0; i < req.count; i += 1) {
      const w = entry.dimensions.width;
      const d = entry.dimensions.depth;
      const spot = onWall
        ? bestWallSpot(project, w, d, CLEAR, anchor, blocked)
        : bestFloorSpot(u, w, d, STEP, CLEAR, anchor, blocked);
      if (!spot) break;

      const obj: SceneObject = {
        id: uid("obj"),
        kind: entry.kind,
        assetId: entry.id,
        ...(entry.serviceRole ? { serviceRole: entry.serviceRole } : {}),
        x: spot.x,
        z: spot.z,
        rotationDeg: spot.rotationDeg ?? entry.defaultFacingDeg,
        width: w,
        depth: d,
        height: entry.dimensions.height,
        locked: false,
        hidden: false,
        surface: entry.placementType,
        elevation: onWall ? entry.defaultElevation ?? 0 : 0,
      };
      placed.push(obj);
      blocked.push({ cx: spot.x, cz: spot.z, w: w + CLEAR, d: d + CLEAR, rot: spot.rotationDeg ?? 0 });
      done += 1;
    }

    if (done < req.count) {
      unplaced.push(`${entry.name}要 ${req.count} 件，只排得下 ${done} 件——場地空間不足。`);
    }
  }
  return { placed, unplaced };
}

/* ------------------------------------------------------------------ */
/* Scheme shapes                                                       */
/* ------------------------------------------------------------------ */

interface SchemeParts {
  objects: SceneObject[];
  zones: Zone[];
  routes: Route[];
  groups: ArrayGroup[];
  rationale: string[];
  risks: string[];
  knowledgeRefs: string[];
  /** Depth reserved at the entrance side for service, in metres. */
  serviceBand: number;
  /**
   * How the desks actually serve people. This is the difference between A and
   * B and it has to reach the simulator, or both schemes report the same wait
   * and the comparison says nothing. "combined" = one queue, one desk doing
   * check-in AND payment (service times add up for whoever still has to pay).
   * "split" = two desks, two queues, staff divided between them.
   */
  serviceModel: "combined" | "split";
}

type SchemeBuilder = (b: NormalizedBrief) => SchemeParts;

/**
 * Which side of the room the entrance is on, so desks land between the door
 * and the seats instead of behind them.
 */
function entranceSide(b: NormalizedBrief): "north" | "south" {
  const midZ = (b.usable.minZ + b.usable.maxZ) / 2;
  return b.entrance.z >= midZ ? "south" : "north";
}

/** The z coordinate of the service band's centre line. */
function serviceZ(b: NormalizedBrief, bandDepth: number, pullIn: number): number {
  return entranceSide(b) === "south"
    ? b.usable.maxZ - bandDepth / 2 - pullIn
    : b.usable.minZ + bandDepth / 2 + pullIn;
}

/** Seats occupy whatever is left after the service band and the door clearance. */
function seatBounds(b: NormalizedBrief, bandDepth: number, pullIn: number): Bounds {
  const consumed = bandDepth + pullIn + b.minAisleWidth;
  return entranceSide(b) === "south"
    ? { ...b.usable, maxZ: b.usable.maxZ - consumed }
    : { ...b.usable, minZ: b.usable.minZ + consumed };
}

function seatingFor(b: NormalizedBrief, bounds: Bounds, aisle: number, preferId: string): {
  groups: ArrayGroup[];
  capacity: number;
  warnings: string[];
} {
  const field = b.seatKind === "mat";
  const candidates = generateLayouts({
    participants: b.participants,
    matWidth: b.seatWidth,
    matDepth: b.seatDepth,
    gap: field ? 0 : 0.15,
    aisleWidth: aisle,
    bounds,
    mode: field ? "field" : "individual",
  });
  if (!candidates.length) return { groups: [], capacity: 0, warnings: ["可用面積排不下任何座位"] };
  const pick = candidates.find((c) => c.id === preferId) ?? candidates.find((c) => c.fits) ?? candidates[0];
  const height = b.seatKind === "mat" ? 0.03 : 0.45;
  return {
    groups: pick.groups.map((g, i) =>
      groupFromSpec(g, b.seatKind, height, `${b.seatKind === "mat" ? "座墊區" : "座位區"}${i + 1}`, i === 0 ? "A" : "B"),
    ),
    capacity: pick.capacity ?? pick.count,
    warnings: pick.warnings,
  };
}

/** A — one desk doing everything, right beside the entrance. */
const buildCombined: SchemeBuilder = (b) => {
  const band = DESK_D + 1.2;
  const z = serviceZ(b, band, b.doorClearance);
  const p = clampToUsable(b.entrance.x + 1.6, z, b.usable, DESK_W / 2, DESK_D / 2);
  const desk = makeDesk("builtin:regTable", "checkin", p.x, p.z, entranceSide(b) === "south" ? 180 : 0);

  const zones: Zone[] = [];
  if (b.requiredZones.includes("registration")) {
    zones.push(makeZone("registration", p.x, p.z, DESK_W + 1.4, band, null));
  }
  const sb = seatBounds(b, band, b.doorClearance);
  const seats = seatingFor(b, sb, b.minAisleWidth, "field-balanced");
  const seatZone = b.requiredZones.find((t) => t === "meditation" || t === "group");
  if (seatZone) {
    zones.push(makeZone(seatZone, (sb.minX + sb.maxX) / 2, (sb.minZ + sb.maxZ) / 2, sb.maxX - sb.minX, sb.maxZ - sb.minZ, seats.capacity));
  }

  const routes = [
    makeRoute("入場動線", "entry", "#38bdf8", [
      { x: b.entrance.x, z: b.entrance.z },
      { x: p.x, z: p.z + (entranceSide(b) === "south" ? 0.9 : -0.9) },
      { x: (sb.minX + sb.maxX) / 2, z: (sb.minZ + sb.maxZ) / 2 },
    ]),
  ];

  return {
    objects: [desk],
    zones,
    routes,
    groups: seats.groups,
    serviceBand: band,
    serviceModel: "combined",
    rationale: [
      "報到與收費共用一張桌子，人力需求最低，適合工作人員少的場合。",
      `桌子擺在入口內側 ${b.doorClearance.toFixed(1)} 公尺處，讓門前保持淨空。`,
      "座位區佔滿剩下的空間，換取最大容納人數。",
    ],
    risks: [
      "只有一條隊伍：報到與收費互相排隊，人一多等待時間會明顯拉長。",
      ...seats.warnings,
    ],
    knowledgeRefs: ["queue-single-line", "door-clearance", "event-area-per-person"],
  };
};

/** B — check-in and payment split to either side of the entrance. */
const buildSplit: SchemeBuilder = (b) => {
  const band = DESK_D + 1.4;
  const z = serviceZ(b, band, b.doorClearance);
  const facing = entranceSide(b) === "south" ? 180 : 0;
  const offset = Math.max(DESK_W / 2 + b.minAisleWidth, 2.0);
  const right = clampToUsable(b.entrance.x + offset, z, b.usable, DESK_W / 2, DESK_D / 2);
  const left = clampToUsable(b.entrance.x - offset, z, b.usable, DESK_W / 2, DESK_D / 2);

  const checkin = makeDesk("builtin:regTable", "checkin", right.x, right.z, facing);
  const payment = makeDesk("builtin:regTable", "payment", left.x, left.z, facing);

  const zones: Zone[] = [];
  if (b.requiredZones.includes("registration")) {
    zones.push(makeZone("registration", right.x, right.z, DESK_W + 1.0, band, null));
  }
  if (b.requiredZones.includes("payment")) {
    zones.push(makeZone("payment", left.x, left.z, DESK_W + 1.0, band, null));
  }

  const sb = seatBounds(b, band, b.doorClearance);
  const seats = seatingFor(b, sb, b.minAisleWidth, "field-aisle");
  const seatZone = b.requiredZones.find((t) => t === "meditation" || t === "group");
  if (seatZone) {
    zones.push(makeZone(seatZone, (sb.minX + sb.maxX) / 2, (sb.minZ + sb.maxZ) / 2, sb.maxX - sb.minX, sb.maxZ - sb.minZ, seats.capacity));
  }
  if (b.requiredZones.includes("shoe")) {
    const sx = clampToUsable(b.usable.minX + 0.9, z, b.usable, 0.6, 0.6);
    zones.push(makeZone("shoe", sx.x, sx.z, 1.2, 1.2, null));
  }

  const midZ = (sb.minZ + sb.maxZ) / 2;
  const routes = [
    makeRoute("報到動線", "registration", "#38bdf8", [
      { x: b.entrance.x, z: b.entrance.z },
      { x: right.x, z: right.z + (entranceSide(b) === "south" ? 0.9 : -0.9) },
      { x: (sb.minX + sb.maxX) / 2, z: midZ },
    ]),
    makeRoute("收費動線", "payment", "#f59e0b", [
      { x: b.entrance.x, z: b.entrance.z },
      { x: left.x, z: left.z + (entranceSide(b) === "south" ? 0.9 : -0.9) },
      { x: (sb.minX + sb.maxX) / 2, z: midZ },
    ]),
  ];

  return {
    objects: [checkin, payment],
    zones,
    routes,
    groups: seats.groups,
    serviceBand: band,
    serviceModel: "split",
    rationale: [
      "報到與收費分成兩張桌子、兩條隊伍，已繳費的人不必等在收費隊伍後面。",
      `兩桌之間留 ${(offset * 2 - DESK_W).toFixed(1)} 公尺，讓兩條隊伍不會互相卡住。`,
      "座位區保留中央走道，讓人可以直接走到後排。",
    ],
    risks: [
      "需要至少兩名工作人員同時在線，否則其中一張桌子會空著。",
      "入口分流需要現場指引，沒有人引導時分流效果會下降。",
      ...seats.warnings,
    ],
    knowledgeRefs: ["queue-parallel-servers", "checkin-payment-split", "door-clearance"],
  };
};

/** C — service pulled deep, a wide spine aisle, fewest people per square metre. */
const buildCirculation: SchemeBuilder = (b) => {
  const band = DESK_D + 1.8;
  const pullIn = b.doorClearance + b.minAisleWidth;
  const z = serviceZ(b, band, pullIn);
  const facing = entranceSide(b) === "south" ? 180 : 0;
  const offset = Math.max(DESK_W / 2 + b.minAisleWidth * 1.5, 2.6);
  const right = clampToUsable(b.entrance.x + offset, z, b.usable, DESK_W / 2, DESK_D / 2);
  const left = clampToUsable(b.entrance.x - offset, z, b.usable, DESK_W / 2, DESK_D / 2);

  const checkin = makeDesk("builtin:regTable", "checkin", right.x, right.z, facing);
  const payment = makeDesk("builtin:regTable", "payment", left.x, left.z, facing);

  const zones: Zone[] = [];
  if (b.requiredZones.includes("registration")) zones.push(makeZone("registration", right.x, right.z, DESK_W + 1.2, band, null));
  if (b.requiredZones.includes("payment")) zones.push(makeZone("payment", left.x, left.z, DESK_W + 1.2, band, null));
  if (b.requiredZones.includes("shoe")) {
    const sx = clampToUsable(b.usable.minX + 0.9, z, b.usable, 0.6, 0.6);
    zones.push(makeZone("shoe", sx.x, sx.z, 1.2, 1.2, null));
  }
  if (b.requiredZones.includes("backpack")) {
    const bx = clampToUsable(b.usable.maxX - 0.9, z, b.usable, 0.6, 0.6);
    zones.push(makeZone("backpack", bx.x, bx.z, 1.2, 1.2, null));
  }

  const sb = seatBounds(b, band, pullIn);
  const seats = seatingFor(b, sb, Math.max(b.minAisleWidth, 1.2), "field-spacious");
  const seatZone = b.requiredZones.find((t) => t === "meditation" || t === "group");
  if (seatZone) {
    zones.push(makeZone(seatZone, (sb.minX + sb.maxX) / 2, (sb.minZ + sb.maxZ) / 2, sb.maxX - sb.minX, sb.maxZ - sb.minZ, seats.capacity));
  }

  const spineX = (b.usable.minX + b.usable.maxX) / 2;
  const routes = [
    makeRoute("主通道", "entry", "#38bdf8", [
      { x: b.entrance.x, z: b.entrance.z },
      { x: spineX, z: z + (entranceSide(b) === "south" ? -0.2 : 0.2) },
      { x: spineX, z: (sb.minZ + sb.maxZ) / 2 },
    ]),
    makeRoute("工作人員動線", "staff", "#a78bfa", [
      { x: left.x, z: left.z + (entranceSide(b) === "south" ? -1.0 : 1.0) },
      { x: right.x, z: right.z + (entranceSide(b) === "south" ? -1.0 : 1.0) },
    ]),
  ];

  return {
    objects: [checkin, payment],
    zones,
    routes,
    groups: seats.groups,
    serviceBand: band,
    serviceModel: "split",
    rationale: [
      "服務桌往內退，讓門口到桌子之間有一段緩衝，人不會塞在門邊。",
      `中央留一條 ${Math.max(b.minAisleWidth, 1.2).toFixed(1)} 公尺的主通道，直接通到座位後排。`,
      "每人座位間距加大，適合需要走動或互動的活動。",
    ],
    risks: [
      "座位密度較低，同樣的教室能坐的人比 A、B 少。",
      "服務桌離門較遠，需要指標或引導人員，否則進來的人會不知道往哪走。",
      ...seats.warnings,
    ],
    knowledgeRefs: ["circulation-aisle-width", "accessibility-turning-space", "event-area-per-person"],
  };
};

const BUILDERS: { id: string; name: string; build: SchemeBuilder }[] = [
  { id: "scheme-a", name: "A 集中服務", build: buildCombined },
  { id: "scheme-b", name: "B 報到收費分流", build: buildSplit },
  { id: "scheme-c", name: "C 走道優先", build: buildCirculation },
];

/* ------------------------------------------------------------------ */
/* Measuring a scheme                                                  */
/* ------------------------------------------------------------------ */

/**
 * Build the project a scheme would produce. The planner never edits the caller's
 * project: it clones, applies, and hands the clone to the real validators.
 */
export function projectWithScheme(base: Project, parts: SchemeParts): Project {
  const next = structuredClone(base);
  // Existing furniture is replaced, not stacked on top of. Leaving the previous
  // desks in place would make every scheme fail overlap validation for reasons
  // that have nothing to do with the scheme.
  next.objects = [
    ...next.objects.filter((o) => o.kind === "door" || o.kind === "switch" || o.kind === "screen" || o.locked),
    ...parts.objects,
  ];
  next.groups = [...next.groups.filter((g) => g.locked), ...parts.groups];
  next.zones = [...next.zones.filter((z) => z.locked), ...parts.zones];
  next.routes = [...next.routes.filter((r) => !r.visible), ...parts.routes];
  return next;
}

function seatCountOf(groups: ArrayGroup[]): number {
  return groups.reduce((n, g) => n + groupMembers(g).length, 0);
}

function simulate(
  project: Project,
  participants: number,
  staffCount: number,
  serviceModel: "combined" | "split",
): {
  sim: SchemeSimulation | null;
  stations: ServiceStation[];
  note?: string;
} {
  let scenario = createDefaultScenario(project, { participantCount: participants });
  // Spread the declared staff over the service desks. Without this every
  // scheme simulates with one server per station and B's whole point — two
  // desks open at once — never shows up in the numbers.
  //
  // The split is by OFFERED LOAD, not by desk count. Only a third of the
  // participants pay on site, so an even 2/2 split leaves the payment desk
  // idle while the check-in queue grows — and scheme B then loses a comparison
  // it lost to the rostering, not to the layout. Offered load is arrival share
  // times service time, which is how a real organiser staffs a door.
  const staffable = scenario.stations.filter((s) => s.type === "checkin" || s.type === "payment");
  if (staffable.length && staffCount > 0) {
    const share = (stationId: string): number =>
      scenario.profiles
        .filter((pr) => pr.branch.includes(stationId))
        .reduce((sum, pr) => sum + pr.ratio, 0);
    const loads = staffable.map((s) => Math.max(1e-6, share(s.id) * s.meanServiceSeconds));
    const totalLoad = loads.reduce((a, b) => a + b, 0);
    // Largest-remainder apportionment, with at least one server anywhere a
    // participant is routed — a station on a branch with nobody staffing it is
    // an infinite queue, not a cheap plan.
    const exact = loads.map((l) => (l / totalLoad) * staffCount);
    const servers = exact.map((v) => Math.max(1, Math.floor(v)));
    let left = staffCount - servers.reduce((a, b) => a + b, 0);
    const order = exact
      .map((v, i) => ({ i, frac: v - Math.floor(v) }))
      .sort((a, b) => b.frac - a.frac);
    for (const { i } of order) {
      if (left <= 0) break;
      servers[i] += 1;
      left -= 1;
    }
    scenario = {
      ...scenario,
      stations: scenario.stations.map((s) => {
        const idx = staffable.findIndex((x) => x.id === s.id);
        if (idx < 0) return s;
        return { ...s, staffCount: servers[idx], parallelServers: servers[idx] };
      }),
    };
  }
  const bound = resolveScenarioBindings(project, scenario);
  if (!bound.stations.length) {
    return { sim: null, stations: [], note: "沒有可模擬的服務站點" };
  }
  // A shared desk is ONE queue whose service takes longer for whoever still has
  // to pay — not two desks that happen to sit next to each other. Running the
  // combined scheme through the split model made A and B report the same wait,
  // which is exactly the comparison the user asked the tool to make.
  const variants = buildCheckinPaymentVariants(bound);
  const modelled = serviceModel === "combined" ? variants.combined : variants.separated;
  let result: SimulationResult;
  try {
    result = runDiscreteEvent(modelled, { sampleDt: 5 });
  } catch (e) {
    return { sim: null, stations: bound.stations, note: `模擬失敗：${e instanceof Error ? e.message : String(e)}` };
  }
  const worst = result.stations.reduce<SimulationResult["stations"][number] | null>(
    (acc, s) => (!acc || s.maxQueue > acc.maxQueue ? s : acc),
    null,
  );
  const worstStation = worst ? modelled.stations.find((s) => s.id === worst.stationId) : undefined;
  return {
    sim: {
      avgWaitSeconds: result.avgWaitSeconds,
      // The longest single journey is the honest answer to 「最久要等多久」;
      // averaging it away is what makes a plan look fine and feel terrible.
      maxWaitSeconds: result.maxJourneySeconds,
      avgJourneySeconds: result.avgJourneySeconds,
      finishTimeSeconds: result.finishTimeSeconds,
      maxQueue: result.maxQueue,
      busiest: worst && worstStation
        ? { name: worst.name, x: worstStation.x, z: worstStation.z, queue: worst.maxQueue }
        : null,
    },
    stations: modelled.stations,
  };
}

const BASE_WEIGHTS: SchemeScoreBreakdown = {
  capacity: 0.25,
  waiting: 0.25,
  validation: 0.25,
  circulation: 0.15,
  staffing: 0.10,
};

function weightsFor(objectives: LayoutObjective[]): SchemeScoreBreakdown {
  const w = { ...BASE_WEIGHTS };
  for (const o of objectives) {
    switch (o) {
      case "reduce-crowding": w.waiting += 0.15; w.circulation += 0.10; break;
      case "separate-checkin-payment": w.waiting += 0.15; break;
      case "clear-doors": w.validation += 0.15; break;
      case "increase-interaction": w.circulation += 0.15; w.capacity -= 0.05; break;
      case "easy-to-staff": w.staffing += 0.20; break;
      case "maximise-capacity": w.capacity += 0.20; break;
    }
  }
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  return {
    capacity: Math.max(0, w.capacity) / total,
    waiting: Math.max(0, w.waiting) / total,
    validation: Math.max(0, w.validation) / total,
    circulation: Math.max(0, w.circulation) / total,
    staffing: Math.max(0, w.staffing) / total,
  };
}

function scoreScheme(
  b: NormalizedBrief,
  capacity: number,
  sim: SchemeSimulation | null,
  counts: { error: number; warning: number },
  deskCount: number,
  aisle: number,
): SchemeScore {
  const weights = weightsFor(b.objectives);
  const capacityScore = Math.min(1, capacity / Math.max(1, b.participants));
  // 5 minutes of average wait is the point at which a check-in line stops
  // feeling like a queue and starts feeling like a problem.
  const waitingScore = sim ? Math.max(0, 1 - sim.avgWaitSeconds / 300) : 0.5;
  const validationScore = Math.max(0, 1 - counts.error * 0.25 - counts.warning * 0.05);
  const circulationScore = Math.min(1, aisle / Math.max(0.9, b.minAisleWidth * 1.4));
  // Two things, not one. "Can it be run at all" saturates as soon as there are
  // enough people; without the second term 「人力少一點好管理」 could not tell a
  // one-desk scheme from a two-desk one, because both scored a flat 1.0.
  const staffable = deskCount === 0 ? 0.5 : Math.min(1, b.staffCount / deskCount);
  const simplicity = deskCount <= 1 ? 1 : deskCount === 2 ? 0.85 : 0.7;
  const staffingScore = staffable * simplicity;

  const breakdown: SchemeScoreBreakdown = {
    capacity: capacityScore,
    waiting: waitingScore,
    validation: validationScore,
    circulation: circulationScore,
    staffing: staffingScore,
  };
  const total =
    breakdown.capacity * weights.capacity +
    breakdown.waiting * weights.waiting +
    breakdown.validation * weights.validation +
    breakdown.circulation * weights.circulation +
    breakdown.staffing * weights.staffing;
  return { total: Math.round(total * 1000) / 10, breakdown, weights };
}

/* ------------------------------------------------------------------ */
/* Entry points                                                        */
/* ------------------------------------------------------------------ */

/** Produce every scheme, fully measured. */
export function generateLayoutSchemes(project: Project, input: Partial<LayoutBrief> = {}): PlannerResult {
  const b = normalizeBrief(project, input);
  const notes: string[] = [];
  if (b.entrance.source === "corridor-midpoint") {
    notes.push("這份計畫沒有門物件，入口位置以走廊中點推估；加入門之後方案會更準確。");
  }
  if ((b.usable.maxX - b.usable.minX) <= 0 || (b.usable.maxZ - b.usable.minZ) <= 0) {
    return { brief: b, schemes: [], recommendedId: null, recommendation: "場地尺寸不足，無法排版。", notes };
  }

  /**
   * Hard requirements read off the objectives. A scheme that fails one is still
   * shown in the comparison — the user asked for three options and deserves to
   * see what the third looks like — but it cannot be recommended or applied.
   */
  const eligibilityOf = (parts: SchemeParts): { eligible: boolean; reason?: string } => {
    if (b.objectives.includes("separate-checkin-payment") && parts.serviceModel === "combined") {
      return { eligible: false, reason: "你指定要報到與收費分流，這個方案是共用一張桌子。" };
    }
    return { eligible: true };
  };

  const schemes: LayoutScheme[] = [];
  for (const { id: schemeId, name, build } of BUILDERS) {
    const parts = build(b);
    // The brief's extra furniture goes in AFTER the scheme has claimed its own
    // space, so a requested table lands in a gap rather than on the seats.
    const extras = placeRequiredAssets(project, b, parts);
    parts.objects = [...parts.objects, ...extras.placed];
    parts.risks.push(...extras.unplaced);
    const candidate = projectWithScheme(project, parts);
    const issues = validateProject(candidate);
    const counts = issueCounts(issues);
    const { sim, stations, note } = simulate(candidate, b.participants, b.staffCount, parts.serviceModel);
    if (note) parts.risks.push(note);

    const capacity = seatCountOf(parts.groups) > 0
      ? (parts.zones.find((z) => z.capacity != null)?.capacity ?? seatCountOf(parts.groups))
      : 0;
    const aisle = schemeId === "scheme-c" ? Math.max(b.minAisleWidth, 1.2) : b.minAisleWidth;
    const deskCount = parts.objects.filter((o) => o.serviceRole === "checkin" || o.serviceRole === "payment").length;

    const eligibility = eligibilityOf(parts);
    const risks = [...parts.risks];
    if (!eligibility.eligible && eligibility.reason) risks.push(eligibility.reason);
    if (capacity < b.participants) {
      risks.push(`估算只能坐 ${capacity} 人，少於 ${b.participants} 人。`);
    }
    if (counts.error > 0) {
      risks.push(`檢查有 ${counts.error} 個錯誤需要先處理。`);
    }

    schemes.push({
      id: schemeId,
      name,
      rationale: parts.rationale,
      risks,
      objects: parts.objects,
      groups: parts.groups,
      zones: parts.zones,
      routes: parts.routes,
      stations,
      estimatedCapacity: capacity,
      simulation: sim,
      validation: { errors: counts.error, warnings: counts.warning, issues },
      score: scoreScheme(b, capacity, sim, counts, deskCount, aisle),
      knowledgeRefs: parts.knowledgeRefs,
      ...eligibility,
      ...(eligibility.reason ? { ineligibleReason: eligibility.reason } : {}),
    });
  }

  const eligible = schemes.filter((s) => s.eligible);
  // If nothing satisfies the brief, recommending the least-bad option silently
  // would be worse than saying so; fall back but keep the note.
  const pool = eligible.length ? eligible : schemes;
  if (!eligible.length && schemes.length) {
    notes.push("沒有方案完全符合你指定的條件，以下是最接近的。");
  }
  const best = pool.reduce<LayoutScheme | null>((acc, s) => (!acc || s.score.total > acc.score.total ? s : acc), null);
  const recommendation = best
    ? `推薦「${best.name}」（${best.score.total} 分）：` +
      [
        `可坐 ${best.estimatedCapacity} 人`,
        best.simulation ? `平均等待 ${Math.round(best.simulation.avgWaitSeconds)} 秒` : "未能模擬",
        `檢查 ${best.validation.errors} 錯誤 / ${best.validation.warnings} 警告`,
      ].join("、")
    : "無法產生方案。";

  return { brief: b, schemes, recommendedId: best?.id ?? null, recommendation, notes };
}

/** The id a caller passes to apply whichever scheme scored best. */
export const RECOMMENDED_SCHEME = "recommended";

/**
 * Rebuild one scheme's parts so a caller can apply it to a draft.
 *
 * `RECOMMENDED_SCHEME` resolves to the highest-scoring scheme for this brief.
 * That sentinel exists because the planner used to choose with its own
 * objective→scheme heuristic while the engine recommended by measured score —
 * so the user could be shown 「推薦 C」 and handed B. One decision, one place.
 */
export function buildScheme(project: Project, schemeId: string, input: Partial<LayoutBrief> = {}): {
  scheme: LayoutScheme;
  apply: (draft: Project) => void;
} | null {
  const result = generateLayoutSchemes(project, input);
  const wanted = schemeId === RECOMMENDED_SCHEME ? result.recommendedId : schemeId;
  const scheme = result.schemes.find((s) => s.id === wanted);
  if (!scheme) return null;
  // An explicitly named scheme that breaks the brief is still buildable — the
  // user may have chosen it from the comparison after reading why it is out.
  // The reason travels with it so the UI can keep saying so.
  return {
    scheme,
    apply(draft: Project) {
      draft.objects = [
        ...draft.objects.filter((o) => o.kind === "door" || o.kind === "switch" || o.kind === "screen" || o.locked),
        ...structuredClone(scheme.objects),
      ];
      draft.groups = [...draft.groups.filter((g) => g.locked), ...structuredClone(scheme.groups)];
      draft.zones = [...draft.zones.filter((z) => z.locked), ...structuredClone(scheme.zones)];
      draft.routes = [...draft.routes.filter((r) => !r.visible), ...structuredClone(scheme.routes)];
    },
  };
}

/** Compare every scheme on the numbers a user actually decides with. */
export interface SchemeComparisonRow {
  id: string;
  name: string;
  capacity: number;
  avgWaitSeconds: number | null;
  maxWaitSeconds: number | null;
  errors: number;
  warnings: number;
  score: number;
  busiest: string | null;
  /** False when the scheme breaks a requirement the brief stated in words. */
  eligible: boolean;
  ineligibleReason: string | null;
}

export function compareSchemes(result: PlannerResult): SchemeComparisonRow[] {
  return result.schemes.map((s) => ({
    id: s.id,
    name: s.name,
    capacity: s.estimatedCapacity,
    avgWaitSeconds: s.simulation ? Math.round(s.simulation.avgWaitSeconds) : null,
    maxWaitSeconds: s.simulation ? Math.round(s.simulation.maxWaitSeconds) : null,
    errors: s.validation.errors,
    warnings: s.validation.warnings,
    score: s.score.total,
    busiest: s.simulation?.busiest?.name ?? null,
    eligible: s.eligible,
    ineligibleReason: s.ineligibleReason ?? null,
  }));
}
