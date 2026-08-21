import { describe, expect, it } from "vitest";
import { createDefaultScenario, migrateObject, migrateProject, resolveScenarioBindings, resolveStationPosition } from "../src/core/migrate";
import { createDefaultProject, PROJECT_VERSION } from "../src/core/model";

describe("simulation spatial bindings", () => {
  it("resolves object first, then zone, and keeps the old position as a final fallback", () => {
    const p = createDefaultProject();
    p.zones.push({ id: "z", type: "registration", name: "z", x: 4, z: 5, width: 2, depth: 1, color: "#fff", locked: false, hidden: false, icon: "", capacity: null });
    const base = { id: "s", name: "s", type: "checkin" as const, x: 1, z: 2, staffCount: 1, parallelServers: 1, meanServiceSeconds: 10, queueCapacity: 10 };
    expect(resolveStationPosition(p, { ...base, zoneId: "z" })).toEqual({ x: 4, z: 5 });
    p.objects.push(migrateObject({ id: "o", kind: "regTable", x: 8, z: 9, rotationDeg: 0, locked: false, hidden: false }));
    expect(resolveStationPosition(p, { ...base, objectId: "o", zoneId: "z" })).toEqual({ x: 8, z: 9 });
    expect(resolveStationPosition(p, base)).toEqual({ x: 1, z: 2 });
  });

  it("rebuilds station geometry and self-service capacity from the moved project", () => {
    const p = createDefaultProject();
    p.zones.push({ id: "shoe", type: "shoe", name: "shoe", x: 3, z: 4, width: 2, depth: 1, color: "#fff", locked: false, hidden: false, icon: "", capacity: null });
    const scenario = createDefaultScenario(p);
    const shoe = scenario.stations.find((station) => station.type === "shoe")!;
    expect(shoe.zoneId).toBe("shoe");
    expect(resolveScenarioBindings(p, scenario).stations.find((station) => station.id === shoe.id)).toMatchObject({ x: 3, z: 4, parallelServers: 4 });
    p.zones[0].x = 12;
    const moved = resolveScenarioBindings(p, scenario).stations.find((station) => station.id === shoe.id)!;
    expect(moved.x).toBe(12);
    expect(moved.parallelServers).toBe(4);
  });
});

describe("v1 → v2 object migration", () => {
  it("derives placement metadata from the asset kind", () => {
    const door = migrateObject({ kind: "door", x: 1, z: 0, width: 0.9, depth: 0.12, height: 2, rotationDeg: 0, locked: false, hidden: false });
    expect(door.surface).toBe("wall");
    expect(door.hinge).toBe("left");
    expect(door.openInward).toBe(true);
    expect(door.openDeg).toBe(90);

    const sw = migrateObject({ kind: "switch", x: 0, z: 0, width: 0.1, depth: 0.05, height: 0.1, rotationDeg: 0, locked: false, hidden: false });
    expect(sw.surface).toBe("wall");
    expect(sw.elevation).toBeCloseTo(1.2);
  });

  it("keeps a legacy parent-less computer on the floor (no false orphan)", () => {
    const c = migrateObject({ kind: "computer", x: 3, z: 3, width: 0.5, depth: 0.5, height: 0.4, rotationDeg: 0, locked: false, hidden: false });
    expect(c.surface).toBe("floor");
    expect(c.elevation).toBe(0);
  });

  it("preserves an explicit tabletop computer with parent", () => {
    const c = migrateObject({ kind: "computer", x: 1, z: 1, width: 0.5, depth: 0.22, height: 0.4, rotationDeg: 0, locked: false, hidden: false, surface: "tabletop", parentId: "t1", elevation: 0.74 });
    expect(c.surface).toBe("tabletop");
    expect(c.parentId).toBe("t1");
  });
});

describe("project migration", () => {
  it("upgrades a v1 project and keeps objects", () => {
    const v1 = {
      version: 1,
      name: "舊圖",
      objects: [
        { id: "o1", kind: "table", x: 2, z: 2, rotationDeg: 0, width: 1.2, depth: 0.6, height: 0.74, locked: false, hidden: false },
        { id: "o2", kind: "chair", x: 2, z: 3, rotationDeg: 0, width: 0.45, depth: 0.45, height: 0.9, locked: false, hidden: false },
      ],
    };
    const p = migrateProject(v1 as never);
    expect(p.version).toBe(PROJECT_VERSION);
    expect(p.objects).toHaveLength(2);
    expect(p.objects[0].surface).toBe("floor");
    expect(p.objects[0].assetId).toBe("builtin:table");
    expect(p.objects[1].assetId).toBe("builtin:chair");
    expect(Array.isArray(p.groups)).toBe(true);
    expect(p.groups).toHaveLength(0);
    expect(Array.isArray(p.catalogExtras)).toBe(true);
  });

  it("drops unknown object kinds and keeps valid groups", () => {
    const p = migrateProject({
      objects: [{ id: "x", kind: "stage" } as never],
      groups: [{ id: "g1", sourceKind: "mat", rows: 2, cols: 3 } as never],
    });
    expect(p.objects).toHaveLength(0);
    expect(p.groups).toHaveLength(1);
    expect(p.groups[0].sourceKind).toBe("mat");
  });

  it("upgrades older projects with scenarios and calibration state", () => {
    const p = migrateProject({ version: 5, name: "v5" } as never);
    expect(p.version).toBe(8);
    expect(p.scenarios).toEqual([]);
    expect(p.activeScenarioId).toBeNull();
    expect(p.calibration.confirmed).toEqual({});
  });

  it("兩次 migrateProject({}) 產生不同的 id", () => {
    // The single most dangerous failure mode in the whole project library: the
    // migration blind-spreads over a fresh `createDefaultProject()` base, so a
    // constant or memoised default id would collapse every legacy document
    // onto one `planform-iso:project:<id>` key and destroy the library in one
    // migration pass.
    const a = migrateProject({} as never);
    const b = migrateProject({} as never);
    expect(a.id).toBeTruthy();
    expect(b.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
  });

  it("migrateProject({ id: \"proj_keep\" }) 保留原本的 id", () => {
    expect(migrateProject({ id: "proj_keep" } as never).id).toBe("proj_keep");
    // "" and non-strings from hand-edited or foreign JSON get a fresh one.
    expect(migrateProject({ id: "" } as never).id).toBeTruthy();
    expect(migrateProject({ id: 7 } as never).id).toBeTruthy();
  });
});
