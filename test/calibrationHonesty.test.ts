/**
 * §11 — 「禁止假裝 verified」.
 *
 * `venueNeedsCalibration` was hard-wired to the single id "venue:tku-e310", so
 * every other template exported with no 尺寸待現場校正 footer and reported
 * 「檢查通過」 in the header. The outdoor booth is the case that made it bite:
 * every one of its dimensions is an estimate read off a photograph, and it was
 * telling the user its plan had passed.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  calibrationComplete,
  calibrationPendingLabels,
  createDefaultProject,
  venueNeedsCalibration,
  type Project,
} from "../src/core/model";
import { boothVenuePreset, createProjectFromVenuePreset, venuePresetById } from "../src/core/venues";

function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

describe("a plan built from estimates says so", () => {
  beforeEach(() => installLocalStorage());

  it("the outdoor booth needs calibration — every dimension is a photo estimate", () => {
    const booth = createProjectFromVenuePreset(boothVenuePreset(), "攤位");
    expect(booth.calibration.note).toContain("待現場校正");
    expect(venueNeedsCalibration(booth), "a booth reported 檢查通過 over invented sizes").toBe(true);
    expect(calibrationComplete(booth)).toBe(false);
  });

  it("E310 still needs calibration, exactly as before", () => {
    const p = createProjectFromVenuePreset(venuePresetById("venue:tku-e310")!, "E310");
    expect(venueNeedsCalibration(p)).toBe(true);
    expect(calibrationComplete(p)).toBe(false);
    expect(calibrationPendingLabels(p)).toEqual(["地磚", "門寬", "已知距離"]);
  });

  it("a plain project with no estimate note is not nagged", () => {
    const p: Project = createDefaultProject();
    expect(venueNeedsCalibration(p)).toBe(false);
    expect(calibrationComplete(p)).toBe(true);
    expect(calibrationPendingLabels(p)).toEqual([]);
  });
});

describe("only the confirmations a venue can actually offer are demanded", () => {
  beforeEach(() => installLocalStorage());

  it("a booth is never asked to measure a door it does not have", () => {
    const booth = createProjectFromVenuePreset(boothVenuePreset(), "攤位");
    expect(booth.objects.some((o) => o.kind === "door")).toBe(false);
    expect(calibrationPendingLabels(booth)).toEqual(["地磚", "已知距離"]);

    booth.calibration.confirmed = { tile: true, room: true };
    // Without this, an outdoor pitch stays 待校正 forever with no way to finish
    // — which is how people learn to ignore the warning everywhere.
    expect(calibrationComplete(booth)).toBe(true);
    expect(calibrationPendingLabels(booth)).toEqual([]);
  });

  it("a room with a door still has to measure the door", () => {
    const p = createProjectFromVenuePreset(venuePresetById("venue:tku-e310")!, "E310");
    p.calibration.confirmed = { tile: true, room: true };
    expect(calibrationComplete(p)).toBe(false);
    expect(calibrationPendingLabels(p)).toEqual(["門寬"]);

    p.calibration.confirmed = { tile: true, room: true, door: true };
    expect(calibrationComplete(p)).toBe(true);
  });
});
