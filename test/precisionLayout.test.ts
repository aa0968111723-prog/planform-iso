import { describe, expect, it } from "vitest";
import { migrateObject, migrateProject } from "../src/core/migrate";

describe("precision tabletop project data", () => {
  it("gives an older object safe non-destructive label and layer defaults", () => {
    const object = migrateObject({
      id: "old-table", kind: "table", x: 1, z: 2, rotationDeg: 0,
      locked: false, hidden: false,
    });
    expect(object.showLabel).toBe(true);
    expect(object.labelPosition).toEqual({ offsetX: 0, offsetY: 0, offsetZ: 0 });
    expect(object.layer).toBe(0);
    expect(object.collisionEnabled).toBe(true);
    expect(object.snapEnabled).toBe(true);
    expect(object.allowTabletopOverflow).toBe(false);
    expect(object.hidden).toBe(false);
  });

  it("round-trips a tabletop annotation independently from its parent object", () => {
    const project = migrateProject({
      labelDisplayMode: "all",
      favoriteAssetIds: ["custom:prop_tea_pot", "custom:prop_tea_pot", 42] as never,
      objects: [{
        id: "pin", kind: "computer", x: 2, z: 2, rotationDeg: 0,
        width: 0.058, depth: 0.058, height: 0.008,
        locked: false, hidden: false, surface: "tabletop", elevation: 0.74,
        parentId: "table-a", name: "胸針樣品", label: "秋季茶會胸針",
        showLabel: false, labelPosition: { offsetX: 0.12, offsetY: 0.03, offsetZ: -0.08 },
        labelStyle: { fontSize: 18, color: "#112233", background: "#ffffff" },
        layer: 3, collisionEnabled: false, snapEnabled: true, allowTabletopOverflow: true,
      }],
    } as never);
    const reloaded = migrateProject(JSON.parse(JSON.stringify(project)));
    const pin = reloaded.objects[0];
    expect(reloaded.labelDisplayMode).toBe("all");
    expect(reloaded.favoriteAssetIds).toEqual(["custom:prop_tea_pot"]);
    expect(pin.parentId).toBe("table-a");
    expect(pin.label).toBe("秋季茶會胸針");
    expect(pin.showLabel).toBe(false);
    expect(pin.labelPosition).toEqual({ offsetX: 0.12, offsetY: 0.03, offsetZ: -0.08 });
    expect(pin.layer).toBe(3);
    expect(pin.allowTabletopOverflow).toBe(true);
    expect(pin.hidden).toBe(false);
  });
});
