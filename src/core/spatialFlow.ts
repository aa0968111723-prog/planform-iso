/**
 * Spatial flow helpers for DES visualization and travel-time penalties.
 *
 * Queue lanes, congestion grids/heatmaps, route crossings, and light aisle
 * penalties — no heavy crowd physics.
 */

import type { Project, Route, RoutePoint, ServiceStation } from "./model";
import { routeLength } from "./simulation";

/** Minimal playback shape — avoids circular import with eventFlow. */
export interface SpatialPlaybackAgent {
  x: number;
  z: number;
  state: string;
}
export interface SpatialPlaybackFrame {
  t: number;
  agents: SpatialPlaybackAgent[];
  queues: Record<string, number>;
}

export const DEFAULT_QUEUE_SPACING = 0.55;

export type SpatialIssueKind =
  | "queue-overflow"
  | "queue-blocks-door"
  | "route-crossing"
  | "narrow-aisle"
  | "entrance-congestion"
  | "station-congestion";

export interface SpatialIssue {
  kind: SpatialIssueKind;
  stationId?: string;
  severity: "info" | "warn" | "error";
  message: string;
  x: number;
  z: number;
  /** Simulation time (seconds) when this peaked, if known. */
  atTime?: number;
  value?: number;
}

export interface CongestionCell {
  ix: number;
  iz: number;
  x: number;
  z: number;
  /** Peak simultaneous agents observed in this cell. */
  peak: number;
  /** Time-integrated density (agent-seconds). */
  integral: number;
}

export interface CongestionGrid {
  cellSize: number;
  cells: CongestionCell[];
  peakTime: number;
  peakTotalQueued: number;
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Effective queue growth direction (degrees). Default: opposite of facing, or -Z. */
export function queueDirectionDeg(station: ServiceStation): number {
  if (typeof station.queueDirectionDeg === "number") return station.queueDirectionDeg;
  const facing = station.facingDeg ?? 0;
  return facing + 180;
}

export function queueSpacingOf(station: ServiceStation): number {
  return Math.max(0.35, station.queueSpacing ?? DEFAULT_QUEUE_SPACING);
}

/** World position of the n-th person waiting (0 = first in line near desk). */
export function queueSlotPosition(
  station: ServiceStation,
  index: number,
): { x: number; z: number } {
  const spacing = queueSpacingOf(station);
  const dir = degToRad(queueDirectionDeg(station));
  // Facing 0 = +Z in Planform; queue direction uses same convention.
  const dx = Math.sin(dir);
  const dz = Math.cos(dir);
  const dist = spacing * (index + 1);
  return {
    x: station.x + dx * dist,
    z: station.z + dz * dist,
  };
}

/** Approximate queue footprint length in meters for `count` waiting people. */
export function queueFootprintLength(station: ServiceStation, count: number): number {
  if (count <= 0) return 0;
  return queueSpacingOf(station) * count;
}

export function segmentsIntersect(
  a1: RoutePoint,
  a2: RoutePoint,
  b1: RoutePoint,
  b2: RoutePoint,
): boolean {
  const o = (p: RoutePoint, q: RoutePoint, r: RoutePoint) => {
    const val = (q.z - p.z) * (r.x - q.x) - (q.x - p.x) * (r.z - q.z);
    if (Math.abs(val) < 1e-9) return 0;
    return val > 0 ? 1 : 2;
  };
  const onSeg = (p: RoutePoint, q: RoutePoint, r: RoutePoint) =>
    Math.min(p.x, r.x) - 1e-9 <= q.x &&
    q.x <= Math.max(p.x, r.x) + 1e-9 &&
    Math.min(p.z, r.z) - 1e-9 <= q.z &&
    q.z <= Math.max(p.z, r.z) + 1e-9;

  const o1 = o(a1, a2, b1);
  const o2 = o(a1, a2, b2);
  const o3 = o(b1, b2, a1);
  const o4 = o(b1, b2, a2);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSeg(a1, b1, a2)) return true;
  if (o2 === 0 && onSeg(a1, b2, a2)) return true;
  if (o3 === 0 && onSeg(b1, a1, b2)) return true;
  if (o4 === 0 && onSeg(b1, a2, b2)) return true;
  return false;
}

export interface RouteCrossing {
  routeAId: string;
  routeBId: string;
  x: number;
  z: number;
}

export function detectRouteCrossings(routes: Route[]): RouteCrossing[] {
  const visible = routes.filter((r) => r.visible && r.points.length >= 2);
  const out: RouteCrossing[] = [];
  for (let i = 0; i < visible.length; i++) {
    for (let j = i + 1; j < visible.length; j++) {
      const A = visible[i];
      const B = visible[j];
      for (let ai = 0; ai < A.points.length - 1; ai++) {
        for (let bi = 0; bi < B.points.length - 1; bi++) {
          const a1 = A.points[ai];
          const a2 = A.points[ai + 1];
          const b1 = B.points[bi];
          const b2 = B.points[bi + 1];
          if (!segmentsIntersect(a1, a2, b1, b2)) continue;
          out.push({
            routeAId: A.id,
            routeBId: B.id,
            x: (a1.x + a2.x + b1.x + b2.x) / 4,
            z: (a1.z + a2.z + b1.z + b2.z) / 4,
          });
        }
      }
    }
  }
  return out;
}

/** Euclidean distance between two points. */
export function pointDist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * Prefer a route polyline connecting near both stations; else straight-line.
 * Returns meters.
 */
export function travelDistanceMeters(
  from: { x: number; z: number },
  to: { x: number; z: number },
  routes?: Route[],
): number {
  const straight = pointDist(from, to);
  if (!routes?.length) return straight;

  let best: number | null = null;
  for (const r of routes) {
    if (!r.visible || r.points.length < 2) continue;
    // Snap to nearest endpoints / points within 2.5m of from/to.
    let iFrom = -1;
    let iTo = -1;
    let dFrom = Infinity;
    let dTo = Infinity;
    for (let i = 0; i < r.points.length; i++) {
      const df = pointDist(from, r.points[i]);
      const dt = pointDist(to, r.points[i]);
      if (df < dFrom) {
        dFrom = df;
        iFrom = i;
      }
      if (dt < dTo) {
        dTo = dt;
        iTo = i;
      }
    }
    if (dFrom > 2.5 || dTo > 2.5 || iFrom < 0 || iTo < 0 || iFrom === iTo) continue;
    const lo = Math.min(iFrom, iTo);
    const hi = Math.max(iFrom, iTo);
    const slice = r.points.slice(lo, hi + 1);
    const along = routeLength(slice) + dFrom + dTo;
    if (best === null || along < best) best = along;
  }
  return best ?? straight;
}

/**
 * Extra travel seconds when the straight path crosses a narrow gap between
 * large floor objects (very lightweight probe — not full navmesh).
 */
export function narrowAislePenaltySeconds(
  project: Project | undefined,
  from: { x: number; z: number },
  to: { x: number; z: number },
  minAisle = 0.9,
): number {
  if (!project) return 0;
  const samples = 6;
  let tight = 0;
  for (let i = 1; i < samples; i++) {
    const t = i / samples;
    const x = from.x + (to.x - from.x) * t;
    const z = from.z + (to.z - from.z) * t;
    // Clearance to nearest blocking object center (approx).
    let nearest = Infinity;
    for (const o of project.objects) {
      if (o.hidden || o.kind === "switch" || o.kind === "mat") continue;
      const half = Math.max(o.width, o.depth) / 2;
      const d = Math.hypot(o.x - x, o.z - z) - half;
      if (d < nearest) nearest = d;
    }
    if (nearest < minAisle / 2) tight += 1;
  }
  // Each tight sample adds a small delay (people slow / weave).
  return tight * 2.5;
}

export function peakCongestionTime(
  playback: SpatialPlaybackFrame[],
): { time: number; totalQueued: number } {
  let bestT = 0;
  let bestQ = 0;
  for (const f of playback) {
    let q = 0;
    for (const v of Object.values(f.queues)) q += v;
    if (q > bestQ) {
      bestQ = q;
      bestT = f.t;
    }
  }
  return { time: bestT, totalQueued: bestQ };
}

/** Build a lightweight congestion grid from playback samples. */
export function buildCongestionGrid(
  playback: SpatialPlaybackFrame[],
  cellSize = 1.0,
): CongestionGrid {
  const map = new Map<string, CongestionCell>();
  let peakTime = 0;
  let peakTotalQueued = 0;

  for (const f of playback) {
    let frameQueued = 0;
    for (const v of Object.values(f.queues)) frameQueued += v;
    if (frameQueued > peakTotalQueued) {
      peakTotalQueued = frameQueued;
      peakTime = f.t;
    }
    // Count agents currently present (not pending/done).
    const counts = new Map<string, number>();
    for (const a of f.agents) {
      if (a.state === "pending" || a.state === "done") continue;
      const ix = Math.floor(a.x / cellSize);
      const iz = Math.floor(a.z / cellSize);
      const key = `${ix}|${iz}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const dt =
      playback.length > 1
        ? Math.max(0.1, (playback[playback.length - 1].t - playback[0].t) / (playback.length - 1))
        : 1;
    for (const [key, n] of counts) {
      const [ixs, izs] = key.split("|");
      const ix = Number(ixs);
      const iz = Number(izs);
      let cell = map.get(key);
      if (!cell) {
        cell = {
          ix,
          iz,
          x: (ix + 0.5) * cellSize,
          z: (iz + 0.5) * cellSize,
          peak: 0,
          integral: 0,
        };
        map.set(key, cell);
      }
      cell.peak = Math.max(cell.peak, n);
      cell.integral += n * dt;
    }
  }

  return {
    cellSize,
    cells: [...map.values()].filter((c) => c.peak >= 2 || c.integral > 2),
    peakTime,
    peakTotalQueued,
  };
}

/** Cells active near time t (for heatmap overlay). */
export function heatmapAt(
  grid: CongestionGrid,
  playback: SpatialPlaybackFrame[],
  t: number,
  cellSize = grid.cellSize,
): { x: number; z: number; count: number }[] {
  if (!playback.length) return [];
  let best = playback[0];
  for (const f of playback) {
    if (Math.abs(f.t - t) < Math.abs(best.t - t)) best = f;
  }
  const counts = new Map<string, { x: number; z: number; count: number }>();
  for (const a of best.agents) {
    if (a.state === "pending" || a.state === "done") continue;
    const ix = Math.floor(a.x / cellSize);
    const iz = Math.floor(a.z / cellSize);
    const key = `${ix}|${iz}`;
    const cur = counts.get(key);
    if (cur) cur.count += 1;
    else
      counts.set(key, {
        x: (ix + 0.5) * cellSize,
        z: (iz + 0.5) * cellSize,
        count: 1,
      });
  }
  return [...counts.values()].filter((c) => c.count >= 1);
}

/**
 * Derive spatial issues from station stats + optional project geometry.
 */
export function deriveSpatialIssues(opts: {
  stations: ServiceStation[];
  maxQueues: Record<string, number>;
  peakTime?: number;
  project?: Project;
  routes?: Route[];
  overflowStationIds?: string[];
}): SpatialIssue[] {
  const issues: SpatialIssue[] = [];
  const {
    stations,
    maxQueues,
    peakTime,
    project,
    routes,
    overflowStationIds = [],
  } = opts;

  for (const id of overflowStationIds) {
    const st = stations.find((s) => s.id === id);
    if (!st) continue;
    issues.push({
      kind: "queue-overflow",
      stationId: id,
      severity: "error",
      message: `${st.name} 排隊超出容量（${st.queueCapacity}）`,
      x: st.x,
      z: st.z,
      atTime: peakTime,
      value: maxQueues[id],
    });
  }

  for (const st of stations) {
    const mq = maxQueues[st.id] ?? 0;
    if (mq < 3) continue;
    const len = queueFootprintLength(st, mq);
    if (st.type === "entrance" && mq >= 5) {
      issues.push({
        kind: "entrance-congestion",
        stationId: st.id,
        severity: "warn",
        message: `入口壅塞：最多 ${mq} 人排隊`,
        x: st.x,
        z: st.z,
        atTime: peakTime,
        value: mq,
      });
    }
    if (mq >= 6) {
      issues.push({
        kind: "station-congestion",
        stationId: st.id,
        severity: mq >= 10 ? "error" : "warn",
        message: `${st.name} 最多排 ${mq} 人`,
        x: st.x,
        z: st.z,
        atTime: peakTime,
        value: mq,
      });
    }
    if (project) {
      for (const o of project.objects) {
        if (o.kind !== "door" || o.hidden) continue;
        const d = pointDist(st, o);
        if (d < len * 0.5 + 0.8 && mq >= 4) {
          issues.push({
            kind: "queue-blocks-door",
            stationId: st.id,
            severity: "error",
            message: `${st.name} 排隊可能擋住門口`,
            x: o.x,
            z: o.z,
            atTime: peakTime,
            value: mq,
          });
        }
      }
      // Queue extending outside classroom roughly
      const room = project.classroom;
      const end = queueSlotPosition(st, Math.max(0, mq - 1));
      const inside =
        end.x >= room.x - 0.2 &&
        end.x <= room.x + room.length + 0.2 &&
        end.z >= room.z - 0.2 &&
        end.z <= room.z + room.width + project.corridor.width + 0.2;
      if (!inside && mq >= 4) {
        issues.push({
          kind: "queue-overflow",
          stationId: st.id,
          severity: "warn",
          message: `${st.name} 排隊足跡可能超出可用空間`,
          x: end.x,
          z: end.z,
          atTime: peakTime,
          value: mq,
        });
      }
    }
  }

  if (routes?.length) {
    for (const c of detectRouteCrossings(routes)) {
      issues.push({
        kind: "route-crossing",
        severity: "info",
        message: "主要動線交叉",
        x: c.x,
        z: c.z,
      });
    }
  }

  // Dedup by kind+stationId+message
  const seen = new Set<string>();
  return issues.filter((iss) => {
    const k = `${iss.kind}|${iss.stationId ?? ""}|${iss.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Pull station x/z from bound scene objects / zones / route waypoints.
 */
export function syncScenarioToLayout(
  project: Project,
  scenario: {
    stations: ServiceStation[];
  },
): ServiceStation[] {
  return scenario.stations.map((st) => {
    if (st.objectId) {
      const o = project.objects.find((x) => x.id === st.objectId);
      if (o) {
        return {
          ...st,
          x: o.x,
          z: o.z,
          facingDeg: st.facingDeg ?? o.rotationDeg,
        };
      }
    }
    if (st.zoneId) {
      const z = project.zones.find((x) => x.id === st.zoneId);
      if (z) {
        return {
          ...st,
          x: z.x + z.width / 2,
          z: z.z + z.depth / 2,
        };
      }
    }
    if (st.routeWaypoint) {
      const r = project.routes.find((x) => x.id === st.routeWaypoint!.routeId);
      const pt = r?.points[st.routeWaypoint.index];
      if (pt) return { ...st, x: pt.x, z: pt.z };
    }
    return { ...st };
  });
}
