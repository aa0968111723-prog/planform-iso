import { describe, expect, it } from "vitest";
import {
  buildCongestionGrid,
  detectRouteCrossings,
  heatmapAt,
  peakCongestionTime,
  queueSlotPosition,
  segmentsIntersect,
  syncScenarioToLayout,
  travelDistanceMeters,
} from "../src/core/spatialFlow";
import { createDefaultProject, type ServiceStation, uid } from "../src/core/model";

function st(partial: Partial<ServiceStation> & Pick<ServiceStation, "x" | "z">): ServiceStation {
  const {
    id,
    name,
    type,
    staffCount,
    parallelServers,
    meanServiceSeconds,
    queueCapacity,
    queueDirectionDeg,
    queueSpacing,
    x,
    z,
    ...rest
  } = partial;
  return {
    id: id ?? uid("stn"),
    name: name ?? "站",
    type: type ?? "checkin",
    staffCount: staffCount ?? 1,
    parallelServers: parallelServers ?? 1,
    meanServiceSeconds: meanServiceSeconds ?? 30,
    queueCapacity: queueCapacity ?? 20,
    queueDirectionDeg: queueDirectionDeg ?? 0,
    queueSpacing: queueSpacing ?? 0.55,
    x,
    z,
    ...rest,
  };
}

describe("queueSlotPosition", () => {
  it("spaces queued agents along queue direction", () => {
    const station = st({ x: 0, z: 0, queueDirectionDeg: 0, queueSpacing: 0.5 });
    const a = queueSlotPosition(station, 0);
    const b = queueSlotPosition(station, 1);
    expect(a.z).toBeCloseTo(0.5);
    expect(b.z).toBeCloseTo(1.0);
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeCloseTo(0.5);
  });
});

describe("segmentsIntersect / route crossings", () => {
  it("detects crossing segments", () => {
    expect(
      segmentsIntersect(
        { x: 0, z: 0 },
        { x: 2, z: 2 },
        { x: 0, z: 2 },
        { x: 2, z: 0 },
      ),
    ).toBe(true);
    expect(
      segmentsIntersect(
        { x: 0, z: 0 },
        { x: 1, z: 0 },
        { x: 0, z: 1 },
        { x: 1, z: 1 },
      ),
    ).toBe(false);
  });

  it("finds route crossings", () => {
    const crossings = detectRouteCrossings([
      {
        id: "a",
        name: "A",
        color: "#fff",
        type: "entry",
        visible: true,
        points: [
          { x: 0, z: 0 },
          { x: 4, z: 4 },
        ],
      },
      {
        id: "b",
        name: "B",
        color: "#fff",
        type: "registration",
        visible: true,
        points: [
          { x: 0, z: 4 },
          { x: 4, z: 0 },
        ],
      },
    ]);
    expect(crossings.length).toBeGreaterThanOrEqual(1);
  });
});

describe("travelDistanceMeters", () => {
  it("uses route length when stations snap to a route", () => {
    const routes = [
      {
        id: "r1",
        name: "r",
        color: "#fff",
        type: "entry" as const,
        visible: true,
        points: [
          { x: 0, z: 0 },
          { x: 0, z: 5 },
          { x: 5, z: 5 },
        ],
      },
    ];
    const along = travelDistanceMeters({ x: 0, z: 0 }, { x: 5, z: 5 }, routes);
    const straight = travelDistanceMeters({ x: 0, z: 0 }, { x: 5, z: 5 });
    expect(along).toBeGreaterThan(straight);
    expect(along).toBeCloseTo(10, 0);
  });
});

describe("syncScenarioToLayout", () => {
  it("updates station coords from bound objects", () => {
    const p = createDefaultProject();
    const oid = uid("obj");
    p.objects.push({
      id: oid,
      kind: "regTable",
      x: 7,
      z: 3,
      rotationDeg: 90,
      width: 1.5,
      depth: 0.7,
      height: 0.74,
      locked: false,
      hidden: false,
      surface: "floor",
      elevation: 0,
      serviceRole: "checkin",
    });
    const synced = syncScenarioToLayout(p, {
      stations: [st({ id: "ck", x: 0, z: 0, objectId: oid })],
    });
    expect(synced[0].x).toBe(7);
    expect(synced[0].z).toBe(3);
    expect(synced[0].facingDeg).toBe(90);
  });
});

describe("congestion grid", () => {
  it("tracks peak time and heatmap cells", () => {
    const playback = [
      {
        t: 0,
        queues: { a: 0 },
        agents: [{ x: 1, z: 1, state: "traveling" }],
      },
      {
        t: 10,
        queues: { a: 5 },
        agents: [
          { x: 1.1, z: 1.1, state: "queued" },
          { x: 1.2, z: 1.0, state: "queued" },
          { x: 1.0, z: 1.3, state: "queued" },
          { x: 1.4, z: 1.2, state: "queued" },
          { x: 1.3, z: 1.4, state: "queued" },
        ],
      },
      {
        t: 20,
        queues: { a: 1 },
        agents: [{ x: 2, z: 2, state: "serving" }],
      },
    ];
    const peak = peakCongestionTime(playback);
    expect(peak.time).toBe(10);
    expect(peak.totalQueued).toBe(5);
    const grid = buildCongestionGrid(playback, 1);
    expect(grid.peakTime).toBe(10);
    expect(grid.cells.length).toBeGreaterThan(0);
    const heat = heatmapAt(grid, playback, 10);
    expect(heat.some((c) => c.count >= 2)).toBe(true);
  });
});
