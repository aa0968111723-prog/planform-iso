/**
 * Guards the product values that come from real field evidence rather than
 * from a designer's taste, so a later refactor cannot quietly drift back to
 * generic-classroom defaults.
 *
 * Every assertion here cites its row in docs/field-research/REFERENCE_MAPPING.md.
 */

import { describe, expect, it } from "vitest";
import { BUILTIN_CATALOG } from "../src/core/catalog";
import { BUILTIN_VENUE_PRESETS, venuePresetById } from "../src/core/venues";
import { planSymbolForKind } from "../src/core/planSymbol";
import { MATERIAL_PRESETS } from "../src/scene/materials";
import { buildE310GoldenProject } from "../src/core/quickStart";
import { inventoryLines } from "../src/export/constructionPlan";

const entry = (id: string) => {
  const found = BUILTIN_CATALOG.find((e) => e.id === id);
  if (!found) throw new Error(`catalog entry missing: ${id}`);
  return found;
};

/** Rough hue check: is this colour green rather than purple/blue/red? */
function isGreenish(hex: string): boolean {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return g > r && g > b;
}

describe("M-01 巧拼 are green, as in the club's event photos", () => {
  it("catalog mat colour is green, not the old lavender", () => {
    const mat = entry("builtin:mat");
    expect(isGreenish(mat.color)).toBe(true);
    expect(mat.color.toLowerCase()).not.toBe("#8b8fc7");
  });

  it("the 3D material matches the catalog colour", () => {
    expect(isGreenish(MATERIAL_PRESETS["mat-soft"].baseColor)).toBe(true);
  });

  it("the plan symbol used in the exported 場刊圖 matches too", () => {
    expect(isGreenish(planSymbolForKind("mat").fill)).toBe(true);
  });
});

describe("M-02 the club's mat is a 60 × 60 巧拼", () => {
  it("offers a 60 × 60 preset named as 巧拼, not just a size", () => {
    const preset = entry("builtin:mat").presets?.find((p) => p.id === "m6060");
    expect(preset).toBeDefined();
    expect(preset!.width).toBeCloseTo(0.6, 6);
    expect(preset!.depth).toBeCloseTo(0.6, 6);
    expect(preset!.label).toContain("巧拼");
  });
});

describe("V-01..V-05 E310 stays honest about being uncalibrated", () => {
  const e310 = BUILTIN_VENUE_PRESETS.find((v) => v.id === "venue:tku-e310");

  it("exists and is named as needing on-site calibration", () => {
    expect(e310).toBeDefined();
    expect(e310!.name).toContain("待現場校正");
  });

  it("has a corridor along the classroom's back wall", () => {
    expect(e310!.corridor).toBeDefined();
    expect(e310!.corridor!.z).toBeCloseTo(e310!.classroom.width, 6);
  });

  it("puts the door on the back wall so it opens onto the corridor", () => {
    const door = e310!.fixtures.find((f) => f.kind === "door");
    expect(door).toBeDefined();
    expect(door!.edge).toBe("s");
    expect(door!.areaId).toBe("classroom");
  });

  it("puts the projector screen on the front wall the seating faces", () => {
    const screen = e310!.fixtures.find((f) => f.kind === "screen");
    expect(screen).toBeDefined();
    expect(screen!.edge).toBe("n");
  });

  it("keeps the stage platform locked against the front wall", () => {
    const stage = e310!.extraObjects?.find((o) => o.assetId === "builtin:stage-platform");
    expect(stage).toBeDefined();
    expect(stage!.locked).toBe(true);
  });
});

describe("V-08/V-09 unconfirmed fixtures must not ship as presets", () => {
  const e310 = BUILTIN_VENUE_PRESETS.find((v) => v.id === "venue:tku-e310")!;

  it("ships exactly one door — the front-wall door is unconfirmed", () => {
    expect(e310.fixtures.filter((f) => f.kind === "door")).toHaveLength(1);
  });

  it("ships exactly one screen — the side screen's position is unconfirmed", () => {
    expect(e310.fixtures.filter((f) => f.kind === "screen")).toHaveLength(1);
  });
});

describe("S-07/S-08/S-09 unverified kit stays removable, never fixed furniture", () => {
  // The photos show shoes on the floor at the mat edge; racks, barriers and
  // sign stands are reasonable-but-unverified. They must remain ordinary
  // objects the user can delete, not locked venue fixtures.
  for (const id of ["builtin:shoe-rack", "builtin:queue-barrier", "builtin:signage-stand"]) {
    it(`${id} is a normal editable catalog item`, () => {
      const item = entry(id);
      expect(item.category).not.toBe("fixture");
      expect(item.allowCustomSize).not.toBe(false);
    });
  }
});

describe("物資清單 names the material the 場務組 has to carry", () => {
  it("lists mat groups as 巧拼 60 × 60, not a generic 地墊", () => {
    const project = buildE310GoldenProject(venuePresetById("venue:tku-e310")!);
    const matLine = inventoryLines(project).find((l) => l.name.includes("巧拼"));
    expect(matLine).toBeDefined();
    // The old code emitted the placeholder "▫" icon and the bare kind name 地墊.
    expect(matLine!.icon).not.toBe("▫");
    expect(matLine!.name).toContain("60");
    // Short enough that the count still fits the 物資數量 column.
    expect(matLine!.name.length).toBeLessThanOrEqual(16);
    // The golden 60-person example lays a real field, not a handful of mats.
    expect(matLine!.count).toBeGreaterThan(50);
  });

  it("still lists the service kit the example places", () => {
    const names = inventoryLines(buildE310GoldenProject(venuePresetById("venue:tku-e310")!)).map((l) => l.name);
    for (const expected of ["報到桌", "收費桌", "鞋架", "電腦", "名牌"]) {
      expect(names).toContain(expected);
    }
  });
});

describe("F-03 the golden scenario is 60 人 over a 20-minute arrival window", () => {
  it("matches the spec in REAL_REFERENCE_CONTRACT §8", () => {
    const project = buildE310GoldenProject(venuePresetById("venue:tku-e310")!);
    const scenario = project.scenarios?.[0];
    expect(scenario?.participantCount).toBe(60);
    expect(scenario?.arrivalWindowSeconds).toBe(20 * 60);
  });

  it("splits 40 prepaid / 20 paying on site", () => {
    const scenario = buildE310GoldenProject(venuePresetById("venue:tku-e310")!).scenarios![0];
    const prepaid = scenario.profiles.find((p) => p.id === "prepaid")!;
    const onsite = scenario.profiles.find((p) => p.id === "pay-on-site")!;
    expect(Math.round(prepaid.ratio * scenario.participantCount)).toBe(40);
    expect(Math.round(onsite.ratio * scenario.participantCount)).toBe(20);
  });
});
