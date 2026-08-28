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

/**
 * The wall the classroom and the corridor share, as a z line, or null when the
 * two rectangles do not sit back to back.
 *
 * Only this one wall matters for travel: it is the only one a participant has
 * to cross to get from the corridor into the room.
 */
export function sharedWallZ(
  classroom: SimulationSpatial["classroom"],
  corridor: SimulationSpatial["corridor"],
): number | null {
  const EPS = 0.05;
  const pairs = [classroom.z + classroom.width, classroom.z];
  for (const z of pairs) {
    if (Math.abs(corridor.z - z) < EPS || Math.abs(corridor.z + corridor.width - z) < EPS) {
      // The two must actually overlap along x, or they merely touch at a corner.
      const overlap = Math.min(classroom.x + classroom.length, corridor.x + corridor.length)
        - Math.max(classroom.x, corridor.x);
      return overlap > 0.5 ? z : null;
    }
  }
  return null;
}

/** Does `x` fall inside a doorway opening (with a hand's width of tolerance)? */
function doorwayAt(x: number, doors: SimulationDoor[], wallZ: number): SimulationDoor | null {
  for (const door of doors) {
    if (Math.abs(door.z - wallZ) > 0.6) continue;
    if (Math.abs(x - door.x) <= door.width / 2 + 0.1) return door;
  }
  return null;
}

/**
 * Bend a path so it crosses the classroom wall through a doorway.
 *
 * Travel used to be a straight segment between two stations, or a snap onto the
 * nearest *visible* polyline — and neither is a geometry constraint. On the
 * release's own default project (the 30-person club setup, whose routes ship
 * hidden) every one of the 30 participants walked through the solid back wall
 * two metres from the only door. The doorway was therefore unfalsifiable: no
 * leg ever recorded a door, so the 門前 bottleneck could never fire and no
 * door-related decision — where to put the check-in desk, whether the doorway
 * is wide enough — could be tested by a rehearsal.
 *
 * This does not pathfind. It answers the one question the venue actually poses:
 * when a leg crosses the shared wall somewhere solid, send it through the
 * nearest doorway instead, entering and leaving square to the wall so the
 * queue in front of the door reads as a queue in front of the door.
 */
export function routeThroughDoorways(
  points: RoutePoint[],
  spatial: SimulationSpatial | undefined,
): RoutePoint[] {
  const doors = spatial?.doors ?? [];
  if (!spatial || points.length < 2 || doors.length === 0) return points;
  const wallZ = sharedWallZ(spatial.classroom, spatial.corridor);
  if (wallZ === null) return points;

  const APPROACH = 0.45; // how far from the wall the door approach points sit
  const out: RoutePoint[] = [{ ...points[0] }];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const da = a.z - wallZ, db = b.z - wallZ;
    const crosses = (da < 0 && db > 0) || (da > 0 && db < 0);
    if (crosses) {
      const t = da / (da - db);
      const crossX = a.x + (b.x - a.x) * t;
      if (!doorwayAt(crossX, doors, wallZ)) {
        // Pick the doorway that adds least walking, not simply the closest to
        // the crossing: a door behind you is a longer trip than one ahead.
        let best: SimulationDoor | null = null;
        let bestCost = Infinity;
        for (const door of doors) {
          if (Math.abs(door.z - wallZ) > 0.6) continue;
          const cost = Math.hypot(door.x - a.x, wallZ - a.z) + Math.hypot(b.x - door.x, b.z - wallZ);
          if (cost < bestCost) { bestCost = cost; best = door; }
        }
        if (best) {
          const sign = da < 0 ? -1 : 1;
          out.push({ x: best.x, z: wallZ + sign * APPROACH });
          out.push({ x: best.x, z: wallZ - sign * APPROACH });
        }
      }
    }
    out.push({ ...b });
  }
  return out;
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
  const snapped = chosen && chosen.score <= Math.max(2, direct * 0.75 + 1.5)
    ? routeSegment(chosen.route, from, to)
    : [{ ...from }, { ...to }];
  const points = routeThroughDoorways(snapped, spatial);
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

/**
 * Which room a station stands in.
 *
 * Exported because two different answers depended on it and only one of them
 * asked: the queue is placed inside the station's own room, but the
 * 「排隊人龍會塞滿走廊」 warning counted the overflow of EVERY station — so a
 * queue backing up inside the classroom printed a corridor warning and drew a
 * red marker in the middle of an empty corridor.
 */
export function stationRoom(
  station: { x: number; z: number },
  spatial: SimulationSpatial | undefined,
): "corridor" | "classroom" | null {
  const inRect = (r: { x: number; z: number; length: number; width: number } | undefined) =>
    !!r
    && station.x >= r.x - 1e-6 && station.x <= r.x + r.length + 1e-6
    && station.z >= r.z - 1e-6 && station.z <= r.z + r.width + 1e-6;
  if (inRect(spatial?.corridor)) return "corridor";
  if (inRect(spatial?.classroom)) return "classroom";
  return null;
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
  const room = stationRoom(station, spatial) === "corridor" ? spatial?.corridor
    : stationRoom(station, spatial) === "classroom" ? spatial?.classroom
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
  const perLane = Number.isFinite(available)
    ? Math.max(1, Math.floor(Math.max(0, available - 0.3) / spacing))
    : Number.POSITIVE_INFINITY;
  const capacity = Number.isFinite(perLane) ? Math.max(1, lanes * perLane) : Number.POSITIVE_INFINITY;

  // Place people the way the capacity was counted. Capacity said the line may
  // double up in a wide corridor; placement ran strictly single-file, so a
  // 30-person queue was drawn seven metres outside the building while the tool
  // reported it as fitting. Now the line wraps into the same lanes the capacity
  // was computed from, and once every lane is full it is honestly an overflow.
  const laneIndex = Number.isFinite(perLane) ? Math.floor(queueIndex / perLane) : 0;
  const inLane = Number.isFinite(perLane) ? queueIndex % perLane : queueIndex;
  // Lanes stack across the room, away from its centre line, so the first lane
  // is the one nearest the wall and the walking lane stays open. Past the last
  // lane they WRAP rather than inventing more: the overflow is already reported
  // as a number, and there is no eleventh lane to stand in. Without the wrap
  // the clamp below would still keep everyone inside — by stacking them ON the
  // wall line, which reads as a rendering bug rather than as a queue.
  const lane = lanes > 0 ? laneIndex % lanes : 0;
  const lateral = lane === 0 ? 0 : (lane % 2 === 1 ? 1 : -1) * Math.ceil(lane / 2) * 0.6;
  const point = {
    x: station.x + direction.x * spacing * (inLane + 1),
    z: station.z + lateral,
  };
  // Nobody queues outside the building.
  //
  // At the corridor mouth the approach is 0.6 m long, so `perLane` is 1 and
  // every queuer got their own lane — the line was drawn PERPENDICULAR to the
  // corridor, marching 3.6 m past the outer wall on one side and into the
  // 巧拼 seating field on the other. A person judging whether the corridor can
  // hold the entry queue was looking at a line whose drawn length had nothing
  // to do with the corridor.
  //
  // `capacity` and `overflow` are deliberately computed above from the
  // UNCLAMPED index, so 「排隊人龍會塞滿走廊（約多出 N 人）」 still reports the
  // full overflow. This clamps where people are DRAWN, not how many fit.
  if (room) {
    point.x = Math.min(room.x + room.length, Math.max(room.x, point.x));
    point.z = Math.min(room.z + room.width, Math.max(room.z, point.z));
  }
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
