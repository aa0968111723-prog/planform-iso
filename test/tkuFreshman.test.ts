import { describe, expect, it } from "vitest";
import {
  BUILDING_PIN_KIND,
  ENTRANCE_UNCONFIRMED,
  MAP_TILE_ERROR_LIMIT,
  buildingMarkersForCampus,
  campusCenter,
  campusRefForVenuePreset,
  campusRefsEqual,
  fitBoundsForMarkers,
  formatFreshmanHeadline,
  googleMapsUrl,
  osmLocationUrl,
  physicalCampuses,
  placeNonOverlappingLabels,
  searchTkuDirectory,
  shouldShowMapFallback,
} from "../src/core/campusNav";
import {
  buildFreshmanGuide,
  freshmanFirstLayer,
  freshmanSecondLayer,
  freshmanTextIsPlain,
  freshmanVisibleText,
} from "../src/core/freshmanGuide";
import { migrateProject } from "../src/core/migrate";
import { PROJECT_VERSION } from "../src/core/model";
import { buildQuickStartProject, DEFAULT_NEEDS } from "../src/core/quickStart";
import { findTkuPlace } from "../src/core/tkuCampus";
import {
  photosCannotAliasVenues,
  photosForVenue,
  photoBindingLabel,
  UNBOUND_PHOTO_LABEL,
  unboundPhotos,
} from "../src/core/venuePhotos";
import { venuePresetById } from "../src/core/venues";

const e305 = venuePresetById("venue:tku-e305")!;
const e310 = venuePresetById("venue:tku-e310")!;

function freshmanPlan(preset = e310) {
  return buildQuickStartProject({
    venue: preset,
    eventName: preset.id === "venue:tku-e305" ? "E305 新生場" : "E310 新生場",
    participants: 30,
    needs: { ...DEFAULT_NEEDS, life: true, teacher: true },
    centralAisle: true,
  });
}

describe("E305 and E310 stay distinct", () => {
  it("maps each room onto its own venue preset", () => {
    expect(findTkuPlace("E305")?.venuePresetId).toBe("venue:tku-e305");
    expect(findTkuPlace("E310")?.venuePresetId).toBe("venue:tku-e310");
    expect(e305.classroom).not.toEqual(e310.classroom);
    expect(e305.classroom.length).toBe(10);
    expect(e310.classroom.length).toBe(12);
  });

  it("search hits E305 and E310 as different rooms", () => {
    const a = searchTkuDirectory("E305");
    const b = searchTkuDirectory("E310");
    expect(a.some((h) => h.id === "E305" && h.kind === "place")).toBe(true);
    expect(b.some((h) => h.id === "E310" && h.kind === "place")).toBe(true);
    expect(a[0].id).toBe("E305");
    expect(b[0].id).toBe("E310");
    expect(a.some((h) => h.id === "E310")).toBe(false);
    expect(searchTkuDirectory("SG320")[0].id).toBe("SG320");
    expect(searchTkuDirectory("工學").some((h) => h.buildingCode === "E")).toBe(true);
  });

  it("E305 photographs never bind to E310", () => {
    const photos = photosForVenue("venue:tku-e305");
    expect(photos.length).toBeGreaterThan(0);
    expect(photos.every((p) => p.venuePresetId === "venue:tku-e305")).toBe(true);
    expect(photos.every((p) => p.placeId === "E305")).toBe(true);
    expect(photosForVenue("venue:tku-e310")).toEqual([]);
    expect(photosCannotAliasVenues("venue:tku-e305", "venue:tku-e310")).toBe(true);
    expect(unboundPhotos().some((p) => photoBindingLabel(p) === UNBOUND_PHOTO_LABEL)).toBe(true);
    expect(photos.some((p) => p.note.includes("不得套用到 E310") || p.note.includes("不是 E310") || p.note.includes("不得把照片"))).toBe(true);
  });
});

describe("Tamkang campus directory map helpers", () => {
  it("covers the three physical campuses without inventing indoor GPS", () => {
    expect(physicalCampuses()).toEqual(["tamsui", "taipei", "lanyang"]);
    expect(campusCenter("tamsui")?.label).toMatch(/樓館位置/);
    expect(campusCenter("taipei")?.source).toBe("published-building");
    const pins = buildingMarkersForCampus("tamsui", "E");
    expect(pins.every((p) => p.pinKind === BUILDING_PIN_KIND)).toBe(true);
    expect(pins.find((p) => p.code === "E")?.isCurrent).toBe(true);
    expect(pins.find((p) => p.code === "E")?.weight).toBe("primary");
    expect(pins.filter((p) => p.code !== "E").every((p) => p.weight === "muted")).toBe(true);
  });

  it("opens Google Maps and OSM from building coordinates", () => {
    expect(googleMapsUrl(25.175, 121.45, "淡江大學 工學大樓")).toContain("google.com/maps");
    expect(osmLocationUrl(25.175, 121.45)).toContain("openstreetmap.org");
  });

  it("keeps map labels from sitting on top of each other", () => {
    const placed = placeNonOverlappingLabels([
      { id: "E", x: 10, y: 10, width: 80, height: 20, priority: 0 },
      { id: "SG", x: 12, y: 11, width: 80, height: 20, priority: 1 },
      { id: "T", x: 14, y: 12, width: 80, height: 20, priority: 1 },
    ]);
    const vis = placed.filter((p) => p.visible);
    expect(vis.some((p) => p.id === "E")).toBe(true);
    const boxes = vis.map((p) => ({
      x: p.x + p.dx, y: p.y + p.dy, w: 80, h: 20,
    }));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
        expect(overlap, `${vis[i].id} vs ${vis[j].id}`).toBe(false);
      }
    }
  });

  it("fits the current building instead of the whole campus", () => {
    const markers = buildingMarkersForCampus("tamsui", "E");
    const bounds = fitBoundsForMarkers(markers);
    const current = markers.find((m) => m.code === "E")!;
    expect(bounds).not.toBeNull();
    expect(bounds!.minLat).toBeLessThan(current.lat);
    expect(bounds!.maxLat).toBeGreaterThan(current.lat);
  });

  it("falls back after enough tile errors instead of a blank map", () => {
    expect(shouldShowMapFallback(MAP_TILE_ERROR_LIMIT - 1)).toBe(false);
    expect(shouldShowMapFallback(MAP_TILE_ERROR_LIMIT)).toBe(true);
  });

  it("infers a campus pin from a saved venue without bumping project version", () => {
    const old = migrateProject({
      version: 1,
      name: "舊場佈",
      venuePresetId: "venue:tku-e310",
      objects: [],
    } as never);
    expect(old.version).toBe(PROJECT_VERSION);
    expect(old.campusRef?.placeId).toBe("E310");
    expect(campusRefForVenuePreset("venue:tku-e305")?.placeId).toBe("E305");
    expect(campusRefsEqual(old.campusRef, campusRefForVenuePreset("venue:tku-e310"))).toBe(true);
  });
});

describe("freshman partner reading", () => {
  it("answers the five questions in plain language", () => {
    const project = freshmanPlan();
    const guide = buildFreshmanGuide(project, "where-i-am");
    expect(guide.headline).toBe("淡江大學 · 淡水校園 · 工學大樓 · E310 · 3F");
    expect(guide.goToBuilding).toMatch(/你現在要前往工學大樓 3F/);
    expect(guide.enterHow).toMatch(/請從教室後側入口進入/);
    expect(guide.enterHow).toContain(ENTRANCE_UNCONFIRMED);
    expect(guide.afterEnter).toMatch(/報到區/);
    expect(guide.afterCheckin).toMatch(/鞋子區/);
    expect(guide.lastStop).toMatch(/青綠色地墊區/);
    expect(freshmanTextIsPlain(freshmanVisibleText(guide, false))).toBe(true);
    expect(freshmanVisibleText(guide, false)).not.toMatch(/latitude|mesh|object ID|debug/i);
  });

  it("keeps sizes on the second layer", () => {
    const guide = buildFreshmanGuide(freshmanPlan(), "how-room-laid");
    const first = freshmanFirstLayer(guide).map((c) => c.label).join(" ");
    const second = freshmanSecondLayer(guide).map((c) => c.label).join(" ");
    expect(first).toMatch(/入口|報到|鞋子|背包|地墊|你在這裡|下一站|投影幕/);
    expect(first).not.toMatch(/公尺/);
    expect(second).toMatch(/公尺|待現場校正/);
  });

  it("does not mix E305 copy into an E310 plan", () => {
    const g305 = buildFreshmanGuide(freshmanPlan(e305));
    const g310 = buildFreshmanGuide(freshmanPlan(e310));
    expect(g305.headline).toContain("E305");
    expect(g305.headline).not.toContain("E310");
    expect(g310.headline).toContain("E310");
    expect(g310.headline).not.toContain("E305");
    expect(g305.photos.every((p) => p.placeId === "E305")).toBe(true);
    expect(g310.photos).toEqual([]);
  });

  it("formats the freshman headline from a campus pin", () => {
    expect(formatFreshmanHeadline({
      campusId: "tamsui", buildingCode: "E", floor: 3, room: "05", placeId: "E305",
    })).toBe("淡江大學 · 淡水校園 · 工學大樓 · E305 · 3F");
  });
});
