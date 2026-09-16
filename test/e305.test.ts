import { beforeEach, describe, expect, it } from "vitest";
import { createProjectFromVenuePreset, venuePresetById } from "../src/core/venues";
import { uniquePlaceForVenuePreset } from "../src/core/tkuCampus";
import { photosForVenue, photosWouldOverwrite, VENUE_PHOTOS } from "../src/core/venuePhotos";
import { buildQuickStartProject, DEFAULT_NEEDS } from "../src/core/quickStart";
import { venueNeedsCalibration } from "../src/core/model";

function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

describe("E305 is not E310", () => {
  beforeEach(installLocalStorage);

  it("keeps a smaller photo-reference box, not E310's 12×9 estimate", () => {
    const e305 = venuePresetById("venue:tku-e305")!;
    const e310 = venuePresetById("venue:tku-e310")!;
    expect(e305.id).not.toBe(e310.id);
    expect(e305.classroom).toMatchObject({ length: 10, width: 8 });
    expect(e310.classroom).toMatchObject({ length: 12, width: 9 });
    expect(e305.note).toMatch(/不是 E310/);
    expect(e310.note).not.toMatch(/E305/);
    const p305 = createProjectFromVenuePreset(e305, "E305");
    const p310 = createProjectFromVenuePreset(e310, "E310");
    expect(p305.venuePresetId).toBe("venue:tku-e305");
    expect(p310.venuePresetId).toBe("venue:tku-e310");
    expect(p305.campusRef?.placeId).toBe("E305");
    expect(p310.campusRef?.placeId).toBe("E310");
    expect(p305.objects.some((o) => o.assetId === "builtin:stage-platform")).toBe(false);
    expect(p310.objects.some((o) => o.assetId === "builtin:stage-platform")).toBe(true);
    expect(p305.view).toBe("top");
    expect(venueNeedsCalibration(p305)).toBe(true);
  });

  it("never offers E305 photographs as E310 evidence", () => {
    expect(photosForVenue("venue:tku-e310")).toEqual([]);
    expect(photosForVenue("venue:tku-e305").every((p) => p.placeId === "E305")).toBe(true);
    expect(photosWouldOverwrite("venue:tku-e305", "venue:tku-e310")).toBe(true);
    expect(VENUE_PHOTOS.some((p) => p.placeId === "E310")).toBe(false);
    expect(uniquePlaceForVenuePreset("venue:tku-e305")?.id).toBe("E305");
  });

  it("Quick Start on E305 does not copy E310 geometry", () => {
    const e305 = venuePresetById("venue:tku-e305")!;
    const e310 = venuePresetById("venue:tku-e310")!;
    const a = buildQuickStartProject({
      venue: e305, eventName: "E305 社課", participants: 30,
      needs: { ...DEFAULT_NEEDS, payment: true, life: true, teacher: true }, centralAisle: true,
    });
    const b = buildQuickStartProject({
      venue: e310, eventName: "E310 社課", participants: 30,
      needs: { ...DEFAULT_NEEDS, payment: true, life: true, teacher: true }, centralAisle: true,
    });
    expect(a.classroom.length).toBe(10);
    expect(b.classroom.length).toBe(12);
    expect(a.venuePresetId).toBe("venue:tku-e305");
    expect(b.venuePresetId).toBe("venue:tku-e310");
  });
});
