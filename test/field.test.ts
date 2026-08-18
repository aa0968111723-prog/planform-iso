import { describe, expect, it } from "vitest";
import {
  obbGap,
  segSegDist,
  segmentIntersectsRect,
  segmentsIntersect,
  wallClearances,
  type Rect,
} from "../src/core/placement";
import { SpatialHash } from "../src/core/spatialHash";
import { inventory, objectGap, snapMeasurePoint } from "../src/core/measure";
import { validateProject } from "../src/core/validation";
import { migrateObject, migrateProject } from "../src/core/migrate";
import { createDefaultProject, type ArrayGroup, type ObjectKind, type SceneObject } from "../src/core/model";

function obj(over: Partial<SceneObject> & { kind: ObjectKind }): SceneObject {
  return migrateObject({ x: 5, z: 4, rotationDeg: 0, locked: false, hidden: false, ...over });
}
function group(over: Partial<ArrayGroup> & { sourceKind: ObjectKind }): ArrayGroup {
  return {
    id: "g", name: "grp", rows: 3, cols: 2, itemWidth: 0.6, itemDepth: 0.6, itemHeight: 0.05,
    gapX: 0.1, gapZ: 0.1, rotationDeg: 0, anchorX: 1, anchorZ: 1, locked: false, hidden: false,
    numberPrefix: "M", numberOrder: "row", numberStart: "nw", ...over,
  };
}

describe("geometry core", () => {
  it("obbGap is the edge-to-edge distance, 0 when overlapping", () => {
    expect(obbGap({ cx: 0, cz: 0, w: 1, d: 1, rot: 0 }, { cx: 2, cz: 0, w: 1, d: 1, rot: 0 })).toBeCloseTo(1);
    expect(obbGap({ cx: 0, cz: 0, w: 1, d: 1, rot: 0 }, { cx: 0.5, cz: 0, w: 1, d: 1, rot: 0 })).toBe(0);
  });

  it("exact segment vs rotated rect", () => {
    const r: Rect = { cx: 0, cz: 0, w: 1, d: 1, rot: 0 };
    expect(segmentIntersectsRect({ x: -2, z: 0 }, { x: 2, z: 0 }, r)).toBe(true);
    expect(segmentIntersectsRect({ x: -2, z: 2 }, { x: 2, z: 2 }, r)).toBe(false);
    expect(segmentIntersectsRect({ x: 0, z: 0 }, { x: 5, z: 5 }, r)).toBe(true); // endpoint inside
  });

  it("segment intersection + segment distance", () => {
    expect(segmentsIntersect({ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 1, z: -1 }, { x: 1, z: 1 })).toBe(true);
    expect(segSegDist({ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 0, z: 1 }, { x: 2, z: 1 })).toBeCloseTo(1);
  });

  it("wall clearances use the footprint edges", () => {
    const c = { id: "classroom" as const, name: "教室", length: 10, width: 8, x: 0, z: 0 };
    const wc = wallClearances({ cx: 2, cz: 2, w: 1, d: 1, rot: 0 }, c);
    expect(wc.west).toBeCloseTo(1.5);
    expect(wc.north).toBeCloseTo(1.5);
    expect(wc.east).toBeCloseTo(7.5);
    expect(wc.nearest).toBeCloseTo(1.5);
  });
});

describe("spatial hash broad-phase", () => {
  it("only pairs nearby footprints", () => {
    const h = new SpatialHash(1);
    h.insert({ id: "a", cx: 0, cz: 0, w: 0.5, d: 0.5, rot: 0 });
    h.insert({ id: "b", cx: 0.2, cz: 0, w: 0.5, d: 0.5, rot: 0 });
    h.insert({ id: "c", cx: 50, cz: 50, w: 0.5, d: 0.5, rot: 0 });
    const pairs = h.candidatePairs();
    // a-b are near (paired); c is far (never paired).
    expect(pairs.length).toBe(1);
  });
});

describe("measure 2.0", () => {
  it("object gap is edge-to-edge", () => {
    const a = obj({ kind: "table", x: 0, z: 0, width: 1, depth: 1 });
    const b = obj({ kind: "table", x: 3, z: 0, width: 1, depth: 1 });
    expect(objectGap(a, b)).toBeCloseTo(2);
  });

  it("snaps a measurement endpoint to a tile intersection", () => {
    const p = createDefaultProject(); // 60cm tiles from origin 0
    const s = snapMeasurePoint(2.95, 2.95, p, 0.3); // interior, near intersection (3,3)
    expect(s.x).toBeCloseTo(3);
    expect(s.z).toBeCloseTo(3);
    expect(s.hint).not.toBeNull();
  });

  it("inventory counts array group members", () => {
    const p = createDefaultProject();
    p.objects.push(obj({ kind: "chair", x: 2, z: 2 }));
    p.groups.push(group({ sourceKind: "mat", rows: 5, cols: 6 }));
    const inv = inventory(p);
    expect(inv.find((e) => e.kind === "mat")?.count).toBe(30);
    expect(inv.find((e) => e.kind === "chair")?.count).toBe(1);
  });
});

describe("validation 2.0", () => {
  it("flags mat too close to the wall (configurable)", () => {
    const p = createDefaultProject();
    p.objects.push(obj({ kind: "mat", x: 0.2, z: 4, width: 0.6, depth: 0.6 }));
    const issues = validateProject(p);
    expect(issues.some((i) => i.code === "mat-too-close-to-wall")).toBe(true);
  });

  it("flags a narrow aisle between two mat blocks", () => {
    const p = createDefaultProject();
    p.groups.push(group({ id: "g1", sourceKind: "mat", rows: 3, cols: 2, anchorX: 1, anchorZ: 1 }));
    p.groups.push(group({ id: "g2", sourceKind: "mat", rows: 3, cols: 2, anchorX: 2.8, anchorZ: 1 }));
    const issues = validateProject(p, { ...p.validationSettings, minAisleWidth: 0.9, matWallClearance: 0 });
    expect(issues.some((i) => i.code === "aisle-too-narrow")).toBe(true);
  });

  it("flags registration table blocking the entrance", () => {
    const p = createDefaultProject();
    p.objects.push(obj({ kind: "door", x: 3, z: 0, surface: "wall", rotationDeg: 0, hinge: "left", openInward: true, openDeg: 90 }));
    p.objects.push(obj({ kind: "regTable", x: 3, z: 0.5, width: 1.5, depth: 0.7 }));
    expect(validateProject(p).some((i) => i.code === "registration-blocks-entry")).toBe(true);
  });

  it("flags screen view blocked and can be disabled", () => {
    const p = createDefaultProject();
    p.objects.push(obj({ kind: "screen", x: 6, z: 0, surface: "wall", rotationDeg: 0 }));
    p.objects.push(obj({ kind: "table", x: 6, z: 2, width: 1.2, depth: 0.6 }));
    expect(validateProject(p).some((i) => i.code === "screen-view-blocked")).toBe(true);
    expect(validateProject(p, { ...p.validationSettings, checkScreenView: false }).some((i) => i.code === "screen-view-blocked")).toBe(false);
  });

  it("flags a route crossing a shoe zone and route conflicts", () => {
    const p = createDefaultProject();
    p.zones.push({ id: "z", type: "shoe", name: "鞋子區", x: 5, z: 4, width: 2, depth: 2, color: "#fff", locked: false, hidden: false });
    p.routes.push({ id: "r1", name: "動線1", color: "#f00", points: [{ x: 5, z: 1 }, { x: 5, z: 7 }], visible: true });
    p.routes.push({ id: "r2", name: "動線2", color: "#0f0", points: [{ x: 1, z: 4 }, { x: 9, z: 4 }], visible: true });
    const issues = validateProject(p);
    expect(issues.some((i) => i.code === "shoe-zone-blocks-route")).toBe(true);
    expect(issues.some((i) => i.code === "primary-route-conflict")).toBe(true);
  });

  it("handles 100 mats + 100 chairs without O(n^2) blow-up", () => {
    const p = createDefaultProject();
    p.classroom = { ...p.classroom, length: 30, width: 30 };
    p.groups.push(group({ id: "mats", sourceKind: "mat", rows: 10, cols: 10, anchorX: 1, anchorZ: 1, gapX: 0.3, gapZ: 0.3 }));
    p.groups.push(group({ id: "chairs", sourceKind: "chair", rows: 10, cols: 10, itemWidth: 0.45, itemDepth: 0.45, anchorX: 15, anchorZ: 1, gapX: 0.3, gapZ: 0.3 }));
    const start = Date.now();
    const issues = validateProject(p);
    const elapsed = Date.now() - start;
    expect(Array.isArray(issues)).toBe(true);
    expect(elapsed).toBeLessThan(1500); // generous; broad-phase keeps it well under
  });
});

describe("migration v2 -> v3", () => {
  it("adds measurements and validation settings with defaults", () => {
    const p = migrateProject({ version: 2, objects: [{ id: "o", kind: "table", x: 1, z: 1, width: 1.2, depth: 0.6, height: 0.74, rotationDeg: 0, surface: "floor", elevation: 0, locked: false, hidden: false }] } as never);
    expect(p.version).toBe(3);
    expect(Array.isArray(p.measurements)).toBe(true);
    expect(p.validationSettings.minAisleWidth).toBeGreaterThan(0);
    expect(p.groups).toHaveLength(0);
  });

  it("round-trips measurements through JSON", () => {
    const p = createDefaultProject();
    p.measurements.push({ id: "m1", type: "free-distance", start: { x: 0, z: 0 }, end: { x: 2, z: 0 }, locked: true, visible: true, color: "#facc15" });
    const back = migrateProject(JSON.parse(JSON.stringify(p)));
    expect(back.measurements).toHaveLength(1);
    expect(back.measurements[0].type).toBe("free-distance");
    expect(back.measurements[0].locked).toBe(true);
  });
});
