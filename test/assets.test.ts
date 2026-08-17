import { describe, expect, it } from "vitest";
import { ALL_KINDS, ASSETS, assetDef, assetsByCategory } from "../src/core/assets";

describe("asset registry", () => {
  it("defines every ObjectKind with coherent metadata", () => {
    expect(ALL_KINDS.length).toBe(8);
    for (const kind of ALL_KINDS) {
      const def = ASSETS[kind];
      expect(def.kind).toBe(kind);
      expect(def.displayName.length).toBeGreaterThan(0);
      expect(["fixture", "furniture", "equipment", "floor"]).toContain(def.category);
      expect(["floor", "wall", "tabletop"]).toContain(def.placementType);
      expect(def.defaultDimensions.width).toBeGreaterThan(0);
      expect(def.presets.length).toBeGreaterThan(0);
    }
  });

  it("classifies placement surfaces correctly", () => {
    expect(assetDef("door").placementType).toBe("wall");
    expect(assetDef("switch").placementType).toBe("wall");
    expect(assetDef("screen").placementType).toBe("wall");
    expect(assetDef("computer").placementType).toBe("tabletop");
    expect(assetDef("computer").allowedParents).toContain("table");
    expect(assetDef("computer").allowedParents).toContain("regTable");
    for (const k of ["table", "chair", "regTable", "mat"] as const) {
      expect(assetDef(k).placementType).toBe("floor");
    }
  });

  it("groups by category", () => {
    expect(assetsByCategory("fixture").map((a) => a.kind).sort()).toEqual(["door", "screen", "switch"]);
    expect(assetsByCategory("floor").map((a) => a.kind)).toEqual(["mat"]);
  });

  it("stores screen presets as real widths, not just labels", () => {
    for (const p of assetDef("screen").presets) {
      expect(p.width).toBeGreaterThan(1);
      expect(p.height).toBeGreaterThan(0.5);
    }
  });
});
