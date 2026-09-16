import { describe, expect, it } from "vitest";
import {
  photoBindingLabel,
  photosForPlace,
  photosForVenue,
  photosWouldOverwrite,
  unboundPhotos,
  VENUE_PHOTOS,
} from "../src/core/venuePhotos";

describe("venue photographs are a catalogue, not a detector", () => {
  it("binds door-plate shots to E305 only", () => {
    const e305 = photosForPlace("E305");
    expect(e305.length).toBeGreaterThan(0);
    expect(e305.every((p) => p.placeId === "E305")).toBe(true);
    expect(e305.every((p) => p.confirmTag === "待現場確認")).toBe(true);
    expect(photosForPlace("E310")).toEqual([]);
    expect(photosForVenue("venue:tku-e310")).toEqual([]);
  });

  it("labels unbound shots so they cannot become a room", () => {
    const unbound = unboundPhotos();
    expect(unbound.length).toBeGreaterThan(0);
    expect(photoBindingLabel(unbound[0]!)).toBe("照片場地尚未綁定");
    expect(VENUE_PHOTOS.some((p) => p.status === "unbound")).toBe(true);
  });

  it("refuses to overwrite another room with bound photos", () => {
    expect(photosWouldOverwrite("venue:tku-e305", "venue:tku-e310")).toBe(true);
    expect(photosWouldOverwrite("venue:tku-e305", "venue:tku-e305")).toBe(false);
  });
});
