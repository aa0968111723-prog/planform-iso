import { describe, expect, it } from "vitest";
import {
  OSM_ATTRIBUTION,
  OSM_TILE_URL,
  buildingNavLinks,
  campusMapView,
  entranceStatusText,
  pickNonOverlappingMapLabels,
  pinsForCampus,
  placeHeadline,
  placeNavLinks,
} from "../src/core/campusMap";
import {
  buildingByCode,
  findTkuPlace,
  formatFreshmanHeadline,
  physicalCampuses,
  placeById,
  placeFromVenuePreset,
  searchTkuDirectory,
} from "../src/core/tkuCampus";

describe("Tamkang campus map helpers", () => {
  it("covers the three physical campuses without a paid key", () => {
    expect(physicalCampuses().map((c) => c.id)).toEqual(["tamsui", "taipei", "lanyang"]);
    expect(OSM_TILE_URL).toContain("openstreetmap.org");
    expect(OSM_ATTRIBUTION).toMatch(/OpenStreetMap/);
    expect(campusMapView("tamsui")?.lat).toBeGreaterThan(25);
    expect(campusMapView("taipei")?.lng).toBeGreaterThan(121);
    expect(campusMapView("lanyang")?.lat).toBeGreaterThan(24);
    expect(campusMapView("cyber")).toBeNull();
  });

  it("pins buildings as 樓館位置 and never invents indoor coordinates", () => {
    const pins = pinsForCampus("tamsui", "E");
    expect(pins.every((p) => p.pinKind === "building")).toBe(true);
    expect(pins.find((p) => p.code === "E")?.weight).toBe("current");
    expect(pins.find((p) => p.code === "E")?.name).toBe("工學大樓");
    const dim = pins.find((p) => p.weight === "dim");
    expect(dim).toBeTruthy();
  });

  it("drops overlapping labels but keeps the current venue", () => {
    const visible = pickNonOverlappingMapLabels([
      { id: "E", x: 10, y: 10, width: 80, height: 20, priority: 0 },
      { id: "G", x: 20, y: 12, width: 80, height: 20, priority: 2 },
      { id: "SG", x: 200, y: 10, width: 80, height: 20, priority: 1 },
    ]);
    expect(visible.has("E")).toBe(true);
    expect(visible.has("G")).toBe(false);
    expect(visible.has("SG")).toBe(true);
  });

  it("searching E305 / E310 / SG320 does not mix the rooms", () => {
    expect(searchTkuDirectory("E305")[0]).toMatchObject({ placeId: "E305", title: "E305 工學大樓教室" });
    expect(searchTkuDirectory("E310")[0]?.placeId).toBe("E310");
    expect(searchTkuDirectory("E308")[0]?.placeId).toBe("E308");
    expect(searchTkuDirectory("SG320")[0]?.placeId).toBe("SG320");
    expect(searchTkuDirectory("工學大樓")[0]?.buildingCode).toBe("E");
    expect(searchTkuDirectory("淡水")[0]?.kind).toBe("campus");
    expect(searchTkuDirectory("E305").some((h) => h.placeId === "E310")).toBe(false);
    expect(searchTkuDirectory("E310").some((h) => h.placeId === "E305")).toBe(false);
  });

  it("keeps unverified doors labelled 入口待現場確認", () => {
    const e305 = placeById("E305")!;
    expect(e305.entranceVerified).toBeFalsy();
    expect(entranceStatusText(e305)).toContain("入口待現場確認");
    expect(placeHeadline(e305)).toBe("淡江大學 · 淡水校園 · 工學大樓 · E305 · 3F");
    expect(formatFreshmanHeadline({ campusId: "tamsui", buildingCode: "E", floor: 3, room: "10", placeId: "E310" }))
      .toBe("淡江大學 · 淡水校園 · 工學大樓 · E310 · 3F");
  });

  it("opens Google Maps and OSM at the building pin, not a fake room", () => {
    const e = buildingByCode("E")!;
    const links = buildingNavLinks(e);
    expect(links.google).toContain("google.com/maps");
    expect(links.osm).toContain("openstreetmap.org");
    expect(links.osm).toContain(String(e.lat));
    const placeLinks = placeNavLinks(findTkuPlace("E310")!);
    expect(placeLinks.google).toContain(String(e.lat));
  });

  it("maps unique venue presets onto one place and leaves shared templates unbound", () => {
    expect(placeFromVenuePreset("venue:tku-e305")?.id).toBe("E305");
    expect(placeFromVenuePreset("venue:tku-e310")?.id).toBe("E310");
    expect(placeFromVenuePreset("venue:tku-classroom")).toBeUndefined();
    expect(placeFromVenuePreset("venue:tku-booth")).toBeUndefined();
  });
});
