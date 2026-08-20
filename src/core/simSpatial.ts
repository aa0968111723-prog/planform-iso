/** Pure spatial constraints used by the event-flow simulator. */

import type {
  Project,
  Route,
  RoutePoint,
  ServiceStation,
  SimulationDoor,
  SimulationSpatial,
} from "./model";

export interface SpatialPoint { x: number; z: number }

export interface TravelPath {
  points: RoutePoint[];
  distance: number;
  seconds: number;
  doorIds: string[];
}

export interface QueuePlacement {
  point: SpatialPoint;
  capacity: number;
  overflow: boolean;
}

function distance(a: SpatialPoint, b: SpatialPoint): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function routeLength(points: RoutePoint[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) total += distance(points[i], points[i + 1]);
  return total;
}

export function pointAtPolyline(points: RoutePoint[], travelled: number): RoutePoint {
  if (!points.length) return { x: 0, z: 0 };
  if (travelled <= 0) return { ...points[0] };
  let left = travelled;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const len = distance(a, b);
    if (left <= len) {
      const f = len ? left / len : 0;
      return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
    }
    left -= len;
  }
  return { ...points[points.length - 1] };
}

interface Projection { point: RoutePoint; along: number; distance: number; tangent: SpatialPoint }

function projectToRoute(point: SpatialPoint, route: Route): Projection {
  let best: Projection = {
    point: route.points[0] ?? { x: 0, z: 0 },
    along: 0,
    distance: Infinity,
    tangent: { x: 1, z: 0 },
  };
  let along = 0;
  for (let i = 0; i < route.points.length - 1; i++) {
    const a = route.points[i], b = route.points[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const len = Math.sqrt(len2);
    const t = len2 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / len2)) : 0;
    const candidate = { x: a.x + dx * t, z: a.z + dz * t };
    const d = distance(point, candidate);
    if (d < best.distance) best = { point: candidate, along: along + len * t, distance: d, tangent: len ? { x: dx / len, z: dz / len } : best.tangent };
    along += len;
  }
  return best;
}

function routeSegment(route: Route, from: SpatialPoint, to: SpatialPoint): RoutePoint[] {
  const a = projectToRoute(from, route);
  const b = projectToRoute(to, route);
  const reverse = a.along > b.along;
  const start = reverse ? b : a;
  const end = reverse ? a : b;
  const points: RoutePoint[] = [start.point];
  let along = 0;
  for (let i = 0; i < route.points.length - 1; i++) {
    const segLen = distance(route.points[i], route.points[i + 1]);
    const nextAlong = along + segLen;
    if (nextAlong > start.along + 1e-6 && nextAlong < end.along - 1e-6) points.push(route.points[i + 1]);
    along = nextAlong;
  }
  points.push(end.point);
  const ordered = reverse ? points.reverse() : points;
  const result: RoutePoint[] = [{ ...from }];
  for (const p of ordered) {
    if (distance(result[result.length - 1], p) > 1e-6) result.push({ ...p });
  }
  if (distance(result[result.length - 1], to) > 1e-6) result.push({ ...to });
  return result;
}

function pointToRouteDistance(point: SpatialPoint, route: Route): number {
  return projectToRoute(point, route).distance;
}

/** Choose a nearby visible polyline and follow its centerline; otherwise use a straight segment. */
export function buildTravelPath(
  from: SpatialPoint,
  to: SpatialPoint,
  spatial: SimulationSpatial | undefined,
  speedMetersPerSecond: number,
): TravelPath {
  const direct = distance(from, to);
  const candidates = (spatial?.routes ?? [])
    .filter((r) => r.visible && r.points.length >= 2)
    .map((route) => {
      const score = pointToRouteDistance(from, route) + pointToRouteDistance(to, route) + (route.type === "entry" ? 0 : 0.25);
      return { route, score };
    })
    .sort((a, b) => a.score - b.score);
  const chosen = candidates[0];
  const points = chosen && chosen.score <= Math.max(2, direct * 0.75 + 1.5)
    ? routeSegment(chosen.route, from, to)
    : [{ ...from }, { ...to }];
  const length = routeLength(points);
  const doorIds = (spatial?.doors ?? [])
    .filter((door) => pointToRouteDistance(door, { ...spatialRoute(points) }) <= 0.8)
    .map((door) => door.id);
  const throughput = doorIds.reduce((value, id) => {
    const door = spatial?.doors.find((d) => d.id === id);
    return Math.min(value, door?.throughput ?? 1);
  }, 1);
  return {
    points,
    distance: length,
    seconds: length / Math.max(0.2, speedMetersPerSecond) / Math.max(0.05, throughput),
    doorIds,
  };
}

function spatialRoute(points: RoutePoint[]): Route {
  return { id: "__travel__", name: "", color: "", points, visible: true, type: "custom" };
}

export function queuePlacement(
  station: ServiceStation,
  queueIndex: number,
  spatial: SimulationSpatial | undefined,
  spacing = 0.5,
): QueuePlacement {
  // Queues run ALONG the room the station is in (people line up down the
  // corridor, not across it); capacity is the walkable length on the side the
  // queue extends into, so a corridor station overflows when the line would
  // run past the corridor, not when the corridor is merely narrow.
  const inRect = (r: { x: number; z: number; length: number; width: number } | undefined) =>
    !!r &&
    station.x >= r.x - 1e-6 && station.x <= r.x + r.length + 1e-6 &&
    station.z >= r.z - 1e-6 && station.z <= r.z + r.width + 1e-6;
  const room = inRect(spatial?.corridor) ? spatial?.corridor
    : inRect(spatial?.classroom) ? spatial?.classroom
    : undefined;
  let direction: SpatialPoint = { x: -1, z: 0 };
  let available = Number.POSITIVE_INFINITY;
  let lanes = 1;
  if (room) {
    if (room === spatial?.corridor) {
      // Corridor: the line forms on the approach side (back toward the
      // corridor start, where people come from). A wider corridor lets the
      // line double up while keeping one walking lane free.
      direction = { x: -1, z: 0 };
      available = station.x - room.x;
      lanes = Math.max(1, Math.floor(room.width / 0.6) - 1);
    } else {
      // Classroom: extend toward whichever side of the room has more space.
      const leftRoom = station.x - room.x;
      const rightRoom = room.x + room.length - station.x;
      direction = { x: leftRoom >= rightRoom ? -1 : 1, z: 0 };
      available = Math.max(leftRoom, rightRoom);
    }
  }
  const capacity = Number.isFinite(available)
    ? Math.max(1, lanes * Math.floor(Math.max(0, available - 0.3) / spacing))
    : Number.POSITIVE_INFINITY;
  const point = {
    x: station.x + direction.x * spacing * (queueIndex + 1),
    z: station.z + direction.z * spacing * (queueIndex + 1),
  };
  return { point, capacity, overflow: queueIndex + 1 > capacity };
}

function doorBlocked(project: Project, door: Project["objects"][number]): boolean {
  const clearance = project.validationSettings.doorFrontClearance;
  const angle = (door.rotationDeg * Math.PI) / 180;
  const forward = { x: Math.sin(angle), z: Math.cos(angle) };
  const lateral = { x: Math.cos(angle), z: -Math.sin(angle) };
  return project.objects.some((object) => {
    if (object.id === door.id || object.hidden || object.kind === "door") return false;
    const dx = object.x - door.x, dz = object.z - door.z;
    const front = dx * forward.x + dz * forward.z;
    const side = Math.abs(dx * lateral.x + dz * lateral.z);
    const radius = Math.hypot(object.width, object.depth) / 2;
    return front >= door.depth / 2 - radius && front <= door.depth / 2 + clearance + radius && side <= door.width / 2 + radius;
  });
}

export function buildSimulationSpatial(project: Project): SimulationSpatial {
  const doors: SimulationDoor[] = project.objects
    .filter((object) => object.kind === "door" && !object.hidden)
    .map((door) => {
      const blocked = doorBlocked(project, door);
      const narrow = door.width < 0.9;
      return {
        id: door.id,
        x: door.x,
        z: door.z,
        width: door.width,
        blocked,
        throughput: blocked ? 0.18 : narrow ? 0.65 : 1,
      };
    });
  return {
    routes: project.routes.map((route) => ({ ...route, points: route.points.map((point) => ({ ...point })) })),
    corridor: { ...project.corridor },
    classroom: { ...project.classroom },
    doors,
  };
}
