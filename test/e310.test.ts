import { describe, expect, it } from "vitest";
import { applyCalibrationPath } from "../src/core/calibration";
import { buildE310GoldenProject, buildQuickStartProject, DEFAULT_NEEDS } from "../src/core/quickStart";
import { groupMembers } from "../src/core/arrays";
import { calibrationComplete, calibrationPendingLabels } from "../src/core/model";
import { generateLayouts } from "../src/core/smartLayout";
import { calibrationFooterText } from "../src/export/constructionPlan";
import { runDiscreteEvent } from "../src/core/eventFlow";
import { createProjectFromVenuePreset, venuePresetById } from "../src/core/venues";

const e310 = venuePresetById("venue:tku-e310")!;

describe("E310 golden venue", () => {
  it.each([20, 30, 40, 60])("field candidate for %i people stays inside its usable bounds", (participants) => {
    const candidates = generateLayouts({
      participants, matWidth: 0.6, matDepth: 0.6, gap: 0, aisleWidth: 0.9,
      bounds: { minX: 0.4, maxX: 9.6, minZ: 3.7, maxZ: 6.1 }, mode: "field",
    });
    expect(candidates.length).toBe(3);
    for (const candidate of candidates) {
      expect(candidate.mode).toBe("field");
      expect(candidate.groups.every((g) => g.itemWidth === 0.6 && g.itemDepth === 0.6 && g.gapX === 0 && g.gapZ === 0)).toBe(true);
      expect(candidate.footprint.width).toBeLessThanOrEqual(9.2 + 1e-6);
      expect(candidate.footprint.depth).toBeLessThanOrEqual(2.4 + 1e-6);
      if (participants === 60) expect(candidate.warnings.join(" ")).toContain("塞不下");
    }
  });

  it("Quick Start uses field mats and keeps the stage/front walking strip clear", () => {
    const p = buildQuickStartProject({
      venue: e310, eventName: "E310", participants: 60,
      needs: { ...DEFAULT_NEEDS, payment: true, life: true, teacher: true }, centralAisle: true,
    });
    expect(p.groups.length).toBe(2);
    const platform = p.objects.find((o) => o.assetId === "builtin:stage-platform")!;
    for (const g of p.groups) {
      expect(g.itemWidth).toBe(0.6);
      expect(g.itemDepth).toBe(0.6);
      expect(g.gapX).toBe(0);
      expect(g.gapZ).toBe(0);
      for (const m of groupMembers(g)) {
        expect(m.x - g.itemWidth / 2).toBeGreaterThanOrEqual(0);
        expect(m.x + g.itemWidth / 2).toBeLessThanOrEqual(10);
        expect(m.z - g.itemDepth / 2).toBeGreaterThan(platform.z + platform.depth / 2);
        expect(m.z + g.itemDepth / 2).toBeLessThan(8);
      }
    }
    expect(p.objects.filter((o) => o.width === 1.8 && o.depth === 0.6)).toHaveLength(2);
  });

  it("one click golden scenario has the 40/20 branch and corridor-first route", () => {
    const p = buildE310GoldenProject(e310);
    const scenario = p.scenarios[0];
    expect(p.name).toBe("E310 演講活動（範例）");
    expect(scenario).toMatchObject({ participantCount: 60, arrivalWindowSeconds: 900, arrivalProfile: "front-loaded" });
    expect(scenario.profiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "prepaid", ratio: 40 / 60 }),
      expect.objectContaining({ id: "pay-on-site", ratio: 20 / 60 }),
    ]));
    expect(p.objects.some((o) => o.assetId === "builtin:computer" && o.surface === "tabletop")).toBe(true);
    expect(p.objects.some((o) => o.assetId === "builtin:payment-box" && o.surface === "tabletop")).toBe(true);
    expect(scenario.stations.map((s) => s.type)).toEqual([
      "entrance", "guide", "queue", "checkin", "payment", "shoe", "backpack", "seating",
    ]);
    const result = runDiscreteEvent(scenario, { sampleDt: 5 });
    expect(result.completed).toBe(60);
    expect(p.routes[0].points[0].z).toBeGreaterThanOrEqual(8);
    expect(p.routes[0].points.some((point) => point.z === 8)).toBe(true);
  });

  it("each field calibration path updates its field and clears its badge", () => {
    const p = createProjectFromVenuePreset(e310);
    expect(calibrationPendingLabels(p)).toEqual(["地磚", "門寬", "已知距離"]);
    applyCalibrationPath(p, "tile", 0.5);
    expect(p.tile.width).toBe(0.5);
    expect(p.calibration.confirmed.tile).toBe(true);
    applyCalibrationPath(p, "door", 0.8);
    expect(p.objects.find((o) => o.kind === "door")?.width).toBe(0.8);
    expect(p.calibration.confirmed.door).toBe(true);
    applyCalibrationPath(p, "classroom-length", 12, 10);
    expect(p.classroom.length).toBe(12);
    expect(p.classroom.width).toBe(9.6);
    expect(calibrationComplete(p)).toBe(true);
    expect(calibrationFooterText(p)).toBe("");
  });
});
