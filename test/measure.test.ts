import { describe, expect, it } from "vitest";
import { createDefaultProject, type SceneObject } from "../src/core/model";
import { migrateObject } from "../src/core/migrate";
import { calibrationCompare, measure, objectFieldInfo } from "../src/core/measure";

const tile = { width: 0.6, depth: 0.6, originX: 0, originZ: 0 };

describe("measure", () => {
  it("reports meters, cm and tile spans", () => {
    const r = measure({ x: 0, z: 0 }, { x: 1.2, z: 0 }, tile);
    expect(r.meters).toBeCloseTo(1.2);
    expect(r.cm).toBeCloseTo(120);
    expect(r.tilesX).toBeCloseTo(2);
  });
});

describe("field info", () => {
  it("reports tile ref, wall distances and zone membership", () => {
    const p = createDefaultProject();
    p.zones.push({ id: "z", type: "group", name: "小組區", x: 3, z: 3, width: 4, depth: 4, color: "#fff", locked: false, hidden: false });
    const o: SceneObject = migrateObject({ kind: "mat", x: 3, z: 3, rotationDeg: 0, width: 0.6, depth: 1.8, height: 0.04, locked: false, hidden: false });
    const info = objectFieldInfo(o, p);
    expect(info.tileRef).toContain("行");
    expect(info.zoneName).toBe("小組區");
    expect(info.distLeftWall).toBeCloseTo(3);
    expect(info.sizeCm.w).toBe(60);
  });
});

describe("calibration compare", () => {
  it("computes ratio and delta vs the model value", () => {
    const c = calibrationCompare(0.62, 0.6);
    expect(c.ratio).toBeCloseTo(0.62 / 0.6);
    expect(c.deltaMeters).toBeCloseTo(0.02);
    expect(c.matches).toBe(false);
    expect(calibrationCompare(0.6, 0.6).matches).toBe(true);
  });
});
