import { describe, expect, it } from "vitest";
import { migrateObject, migrateProject } from "../src/core/migrate";
import { PROJECT_VERSION } from "../src/core/model";

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
    expect(p.version).toBe(7);
    expect(p.scenarios).toEqual([]);
    expect(p.activeScenarioId).toBeNull();
    expect(p.calibration.confirmed).toEqual({});
  });
});
