import { describe, expect, it } from "vitest";
import { buildSimulationSpatial, buildTravelPath, pointAtPolyline, queuePlacement } from "../src/core/simSpatial";
import { createDefaultProject, type ServiceStation } from "../src/core/model";
import { migrateObject } from "../src/core/migrate";

const station: ServiceStation = {
  id: "s", name: "s", type: "checkin", x: 2, z: 0, staffCount: 1, parallelServers: 1,
  meanServiceSeconds: 10, queueCapacity: 20,
};

describe("simulation spatial constraints", () => {
  it("follows a route polyline and returns a route position at the bend", () => {
    const p = createDefaultProject();
    p.routes = [{ id: "entry", name: "entry", color: "#fff", visible: true, type: "entry", points: [{ x: 0, z: 0 }, { x: 0, z: 4 }, { x: 4, z: 4 }] }];
    const spatial = buildSimulationSpatial(p);
    const path = buildTravelPath({ x: 0, z: 0 }, { x: 4, z: 4 }, spatial, 1);
    expect(path.distance).toBeCloseTo(8, 6);
    expect(pointAtPolyline(path.points, 4)).toEqual({ x: 0, z: 4 });
  });

  it("queues run along the corridor and overflow when the line outruns it", () => {
    const p = createDefaultProject(); // corridor 10 × 2 at z = 8
    const spatial = buildSimulationSpatial(p);
    // Station 1.5 m into the 2 m-wide corridor: ~1.2 m of approach × 2 lanes → 4 slots.
    const nearStart: ServiceStation = { ...station, x: 1.5, z: 8.5 };
    const first = queuePlacement(nearStart, 0, spatial);
    const second = queuePlacement(nearStart, 1, spatial);
    expect(Math.hypot(second.point.x - first.point.x, second.point.z - first.point.z)).toBeCloseTo(0.5, 6);
    expect(second.point.x).toBeLessThan(first.point.x); // line forms on the approach side
    expect(queuePlacement(nearStart, 3, spatial).overflow).toBe(false);
    expect(queuePlacement(nearStart, 4, spatial).overflow).toBe(true);
    // The same station deeper into the corridor has room for a long line.
    const deep: ServiceStation = { ...station, x: 6, z: 8.5 };
    expect(queuePlacement(deep, 4, spatial).overflow).toBe(false);
    // A classroom station is not capped by corridor geometry at all.
    const inRoom: ServiceStation = { ...station, x: 2, z: 4 };
    expect(queuePlacement(inRoom, 6, spatial).overflow).toBe(false);
  });

  it("turns a door in front of a table into a reduced-throughput node", () => {
    const p = createDefaultProject();
    p.validationSettings.doorFrontClearance = 0.6;
    p.objects = [
      migrateObject({ id: "door", kind: "door", x: 0, z: 0, rotationDeg: 0, width: 0.8, depth: 0.12, locked: false, hidden: false }),
      migrateObject({ id: "table", kind: "table", x: 0, z: 0.45, rotationDeg: 0, width: 1.2, depth: 0.6, locked: false, hidden: false }),
    ];
    const door = buildSimulationSpatial(p).doors[0];
    expect(door.width).toBe(0.8);
    expect(door.blocked).toBe(true);
    expect(door.throughput).toBeLessThan(0.3);
  });
});

