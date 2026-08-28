/**
 * §9 — 未校正資訊誠實標示，不把估計偽裝成實測.
 *
 * Three specific ways the app used to claim more than it knew:
 *   1. 記錄結果 — the button whose own hint says the OTHER two 「會改動既有場佈
 *      比例」, so it reads as the safe one — blanked the estimate marker, which
 *      cleared the 待校正 badge and exported the 場刊圖 with no footer;
 *   2. 套用到教室長 grew the classroom and left the corridor behind, so the
 *      plan drew a room overhanging the walkway that serves it;
 *   3. the partner briefing named a 後牆長桌 that is not where the bags are.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { applyCalibrationPath } from "../src/core/calibration";
import { calibrationFooterText } from "../src/export/constructionPlan";
import { calibrationComplete, venueNeedsCalibration, type Project } from "../src/core/model";
import { buildE310GoldenProject } from "../src/core/quickStart";
import { boothVenuePreset, createProjectFromVenuePreset, venuePresetById } from "../src/core/venues";
import { buildRoleBriefing } from "../src/core/partner";

function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}
beforeEach(() => installLocalStorage());
installLocalStorage();

const booth = (): Project => createProjectFromVenuePreset(boothVenuePreset());
const e310 = () => buildE310GoldenProject(venuePresetById("venue:tku-e310")!);

describe("a plan built from estimates keeps saying so", () => {
  it("the booth ships marked as an estimate", () => {
    const p = booth();
    expect(venueNeedsCalibration(p)).toBe(true);
    expect(calibrationComplete(p)).toBe(false);
    expect(calibrationFooterText(p)).toBe("尺寸待現場校正");
  });

  it("記錄結果 does not quietly clear the marking", () => {
    const p = booth();
    applyCalibrationPath(p, "record", 1.2);
    // Recording a measurement confirms nothing — and it must not un-mark the
    // plan either. Before this guard, one tap on the safest-looking button
    // exported a 7×7 pitch and a 3×3 tent as if somebody had measured them.
    expect(p.calibration.confirmed).toEqual({});
    expect(venueNeedsCalibration(p)).toBe(true);
    expect(calibrationFooterText(p)).toBe("尺寸待現場校正");
  });

  it("a real measurement still confirms its own item", () => {
    const p = e310();
    applyCalibrationPath(p, "tile", 0.6, 0.6);
    expect(p.calibration.confirmed.tile).toBe(true);
    // …and the plan stays marked until all three are done.
    expect(calibrationFooterText(p)).toBe("尺寸待現場校正");
  });
});

describe("scaling the room takes the corridor with it", () => {
  it("the corridor still spans the room it serves", () => {
    const p = e310();
    const before = { room: p.classroom.length, corridor: p.corridor.length };
    expect(before.corridor).toBeCloseTo(before.room, 6);

    applyCalibrationPath(p, "classroom-length", 13.2, 12);
    expect(p.classroom.length).toBeCloseTo(13.2, 6);
    // Without this the room grew to 13.2 m against a 12 m walkway and the
    // exported plan showed the room overhanging it by 1.2 m.
    expect(p.corridor.length).toBeCloseTo(13.2, 6);
    expect(p.corridor.x + p.corridor.length).toBeCloseTo(p.classroom.x + p.classroom.length, 6);
  });

  it("but does NOT invent a corridor width", () => {
    const p = e310();
    const width = p.corridor.width;
    applyCalibrationPath(p, "classroom-length", 13.2, 12);
    // The corridor's width is recorded as unknown in the evidence mapping.
    // Scaling it by a classroom-length ratio would manufacture a measurement
    // — and would silently move the 「排隊會排到走道上」 verdict, which is
    // derived from how many 0.6 m queue lanes fit across it.
    expect(p.corridor.width).toBe(width);
  });

  it("the corridor still sits against the room's back edge", () => {
    const p = e310();
    applyCalibrationPath(p, "classroom-length", 13.2, 12);
    expect(p.corridor.z).toBeCloseTo(p.classroom.z + p.classroom.width, 6);
  });
});

describe("the briefing names the place the bags actually are", () => {
  it("the backpack station is named after the zone it is bound to", () => {
    const p = e310();
    const scenario = p.scenarios[0];
    const station = scenario.stations.find((s) => s.type === "backpack")!;
    const zone = p.zones.find((z) => z.id === station.zoneId)!;
    expect(station.name).toBe(zone.name);
    // The specific lie: the bags are on the side-wall 課桌椅, and the brief
    // used to send volunteers to a 後牆長桌 that is not there.
    expect(station.name).not.toContain("後牆");
  });

  it("and the partner brief repeats that name, not the old one", () => {
    const p = e310();
    const brief = buildRoleBriefing(p, "all", p.scenarios[0]);
    expect(brief.flowSummary).not.toContain("後牆長桌");
    expect(brief.flowSummary).toContain("背包");
  });
});
