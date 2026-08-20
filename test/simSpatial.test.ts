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

  it("uses half-metre queue spacing and exposes narrow-corridor overflow", () => {
    const p = createDefaultProject();
    p.corridor.width = 1.2;
    const spatial = buildSimulationSpatial(p);
    const first = queuePlacement(station, 0, spatial);
    const second = queuePlacement(station, 1, spatial);
    expect(Math.hypot(second.point.x - first.point.x, second.point.z - first.point.z)).toBeCloseTo(0.5, 6);
    expect(queuePlacement(station, 2, spatial).overflow).toBe(true);
    p.corridor.width = 2.4;
    const wide = buildSimulationSpatial(p);
    expect(queuePlacement(station, 2, wide).overflow).toBe(false);
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

