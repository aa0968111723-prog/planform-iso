import { describe, expect, it } from "vitest";
import { generateLayouts } from "../src/core/smartLayout";
import {
  agentPositions,
  detectBottlenecks,
  initSimulation,
  pointAtDistance,
  routeLength,
  stepSimulation,
} from "../src/core/simulation";
import { ROUTE_PRESETS, routePreset } from "../src/core/routes";
import { migrateProject } from "../src/core/migrate";
import { PROJECT_VERSION, type Route } from "../src/core/model";

describe("SmartLayoutEngine", () => {
  const bounds = { minX: 0, maxX: 8, minZ: 0, maxZ: 12 };

  it("produces candidates that fit 30 people", () => {
    const cands = generateLayouts({ participants: 30, matWidth: 0.6, matDepth: 1.8, gap: 0.1, aisleWidth: 0.9, bounds });
    expect(cands.length).toBeGreaterThanOrEqual(2);
    const fitting = cands.filter((c) => c.fits && c.count >= 30);
    expect(fitting.length).toBeGreaterThanOrEqual(1);
    expect(cands.some((c) => c.id === "aisle" && c.groups.length === 2)).toBe(true);
  });

  it("warns when the area is too small", () => {
    const small = generateLayouts({ participants: 30, matWidth: 0.6, matDepth: 1.8, gap: 0.1, aisleWidth: 0.9, bounds: { minX: 0, maxX: 6, minZ: 0, maxZ: 6 } });
    expect(small.every((c) => c.count < 30 ? c.warnings.length > 0 : true)).toBe(true);
    expect(small.some((c) => c.warnings.some((w) => w.includes("少於")))).toBe(true);
  });
});

describe("traffic simulation", () => {
  const route: Route = { id: "r", name: "入場", color: "#f00", points: [{ x: 0, z: 0 }, { x: 10, z: 0 }], visible: true, type: "entry" };

  it("measures route length and point at distance", () => {
    expect(routeLength(route.points)).toBeCloseTo(10);
    expect(pointAtDistance(route.points, 5)).toEqual({ x: 5, z: 0 });
    expect(pointAtDistance(route.points, 99)).toEqual({ x: 10, z: 0 });
  });

  it("spawns staggered agents and advances them", () => {
    let s = initSimulation([route], { countPerRoute: 3, speed: 1, spacing: 2 });
    expect(s.agents.map((a) => a.dist)).toEqual([0, -2, -4]);
    s = stepSimulation(s, [route], 5);
    const pos = agentPositions(s, [route]);
    expect(pos.length).toBe(3); // all spawned by t=5
    expect(pos[0]).toMatchObject({ x: 5, z: 0 });
  });

  it("detects a bottleneck bucket", () => {
    const pts = [{ x: 1, z: 1 }, { x: 1.1, z: 1 }, { x: 1.2, z: 1.1 }, { x: 9, z: 9 }];
    const b = detectBottlenecks(pts, 1, 3);
    expect(b.length).toBe(1);
    expect(b[0].count).toBe(3);
  });
});

describe("route presets", () => {
  it("has 9 presets with colors and icons", () => {
    expect(ROUTE_PRESETS.length).toBe(9);
    expect(routePreset("entry").label).toContain("入場");
    expect(routePreset("payment").label).toContain("收費");
    expect(routePreset("staff").color).toMatch(/^#/);
    expect(routePreset("unknown" as never).type).toBe("custom");
  });
});

describe("migration v3 -> v4", () => {
  it("adds zone icons/capacity, route type and description", () => {
    const p = migrateProject({
      version: 3,
      zones: [{ id: "z", type: "shoe", name: "鞋子區", x: 1, z: 1, width: 2, depth: 1, color: "#fbbf24", locked: false, hidden: false } as never],
      routes: [{ id: "r", name: "動線", color: "#f00", points: [], visible: true } as never],
    } as never);
    expect(p.version).toBe(PROJECT_VERSION);
    expect(p.description).toBe("");
    expect(p.zones[0].icon).toBe("👟");
    expect(p.zones[0].capacity).toBeNull();
    expect(p.routes[0].type).toBe("custom");
  });
});
