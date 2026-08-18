/**
 * Lightweight traffic simulation (V1) — markers walk along routes at a fixed
 * speed with a fixed spacing, so users can see where flow bottlenecks or
 * crosses. Not a physics engine; just waypoint-following + density buckets.
 */

import type { Route, RoutePoint } from "./model";

export interface SimParams {
  countPerRoute: number;
  speed: number; // meters / second
  spacing: number; // meters between people on the same route
}

export interface Agent {
  routeId: string;
  index: number;
  dist: number; // meters travelled along the route (may be negative before spawn)
}

export interface SimState {
  agents: Agent[];
  time: number;
  params: SimParams;
}

export function routeLength(points: RoutePoint[]): number {
  let len = 0;
  for (let i = 0; i < points.length - 1; i++) len += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z);
  return len;
}

/** Position at a given distance along a polyline (clamped to the ends). */
export function pointAtDistance(points: RoutePoint[], dist: number): RoutePoint {
  if (points.length === 0) return { x: 0, z: 0 };
  if (dist <= 0) return points[0];
  let acc = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const seg = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z);
    if (acc + seg >= dist) {
      const t = seg === 0 ? 0 : (dist - acc) / seg;
      return { x: points[i].x + (points[i + 1].x - points[i].x) * t, z: points[i].z + (points[i + 1].z - points[i].z) * t };
    }
    acc += seg;
  }
  return points[points.length - 1];
}

export function initSimulation(routes: Route[], params: SimParams): SimState {
  const agents: Agent[] = [];
  for (const r of routes) {
    if (!r.visible || r.points.length < 2) continue;
    for (let i = 0; i < params.countPerRoute; i++) {
      agents.push({ routeId: r.id, index: i, dist: -i * params.spacing || 0 });
    }
  }
  return { agents, time: 0, params };
}

/** Advance the simulation by dt seconds (agents clamp at the route end). */
export function stepSimulation(state: SimState, routes: Route[], dt: number): SimState {
  const lengths = new Map<string, number>();
  for (const r of routes) lengths.set(r.id, routeLength(r.points));
  const move = state.params.speed * dt;
  const agents = state.agents.map((a) => {
    const len = lengths.get(a.routeId) ?? 0;
    return { ...a, dist: Math.min(len, a.dist + move) };
  });
  return { agents, time: state.time + dt, params: state.params };
}

export function agentPositions(state: SimState, routes: Route[]): { x: number; z: number; routeId: string }[] {
  const byId = new Map(routes.map((r) => [r.id, r.points] as const));
  const out: { x: number; z: number; routeId: string }[] = [];
  for (const a of state.agents) {
    if (a.dist < 0) continue; // not spawned yet
    const pts = byId.get(a.routeId);
    if (!pts) continue;
    const p = pointAtDistance(pts, a.dist);
    out.push({ x: p.x, z: p.z, routeId: a.routeId });
  }
  return out;
}

export interface Bottleneck { x: number; z: number; count: number }

/** Grid-bucket agent positions; buckets with >= threshold are bottlenecks. */
export function detectBottlenecks(
  positions: { x: number; z: number }[],
  cellSize: number,
  threshold: number,
): Bottleneck[] {
  const buckets = new Map<string, { x: number; z: number; count: number }>();
  for (const p of positions) {
    const key = `${Math.floor(p.x / cellSize)}|${Math.floor(p.z / cellSize)}`;
    const b = buckets.get(key);
    if (b) { b.count += 1; b.x += p.x; b.z += p.z; }
    else buckets.set(key, { x: p.x, z: p.z, count: 1 });
  }
  const out: Bottleneck[] = [];
  for (const b of buckets.values()) {
    if (b.count >= threshold) out.push({ x: b.x / b.count, z: b.z / b.count, count: b.count });
  }
  return out;
}

export function simulationDone(state: SimState, routes: Route[]): boolean {
  const lengths = new Map(routes.map((r) => [r.id, routeLength(r.points)] as const));
  return state.agents.every((a) => a.dist >= (lengths.get(a.routeId) ?? 0) - 1e-6);
}
