import { describe, expect, it } from "vitest";
import {
  OSM_ATTRIBUTION_TEXT,
  OSM_TILE_URL,
  PHYSICAL_CAMPUSES,
  buildingLocationCaption,
  campusCenter,
  entranceCopy,
  fitTarget,
  googleMapsUrl,
  layoutMapLabels,
  mapMarkersForCampus,
  osmUrl,
} from "../src/core/campusMap";
import { placeById } from "../src/core/tkuCampus";

describe("Tamkang campus map (no indoor coordinates)", () => {
  it("covers the three physical campuses and needs no API key", () => {
    expect(PHYSICAL_CAMPUSES).toEqual(["tamsui", "taipei", "lanyang"]);
    expect(OSM_TILE_URL).toContain("tile.openstreetmap.org");
    expect(OSM_TILE_URL).not.toMatch(/key=|token=/i);
    expect(OSM_ATTRIBUTION_TEXT).toMatch(/OpenStreetMap/);
    expect(campusCenter("tamsui")).toMatchObject({ lat: expect.any(Number), lng: expect.any(Number) });
    expect(campusCenter("cyber")).toBeNull();
  });

  it("building pins are 樓館位置, never a classroom lat/lng", () => {
    const markers = mapMarkersForCampus("tamsui", { buildingCode: "E", placeId: "E310" });
    expect(markers.every((m) => m.locationKind === "樓館位置")).toBe(true);
    expect(markers.some((m) => m.active && m.buildingCode === "E")).toBe(true);
    expect(markers.find((m) => m.buildingCode === "E")?.name).toBe("工學大樓");
    expect(buildingLocationCaption()).toBe("樓館位置");
    const e310 = placeById("E310")!;
    expect("lat" in e310).toBe(false);
    expect(entranceCopy(e310)).toMatch(/入口待現場確認/);
  });

  it("drops overlapping labels and never hides the active one", () => {
    const boxes = Array.from({ length: 20 }, (_, i) => ({
      id: `b${i}`,
      x: 40,
      y: 40,
      width: 80,
      height: 20,
      priority: (i === 0 ? 0 : 2) as 0 | 1 | 2,
    }));
    const placed = layoutMapLabels(boxes, { width: 200, height: 120 }, 6);
    const visible = placed.filter((p) => !p.hidden);
    expect(placed.find((p) => p.id === "b0")?.hidden).toBe(false);
    expect(visible.length).toBeLessThanOrEqual(6);
    for (let i = 0; i < visible.length; i++) {
      for (let j = i + 1; j < visible.length; j++) {
        const a = visible[i], b = visible[j];
        const A = boxes.find((x) => x.id === a.id)!;
        const B = boxes.find((x) => x.id === b.id)!;
        const overlap = a.x < b.x + B.width && a.x + A.width > b.x
          && a.y < b.y + B.height && a.y + A.height > b.y;
        expect(overlap, `${a.id} vs ${b.id}`).toBe(false);
      }
    }
  });

  it("fits the current building and builds public navigation URLs", () => {
    const fit = fitTarget("tamsui", "E")!;
    expect(fit.zoom).toBe(18);
    expect(googleMapsUrl(fit.lat, fit.lng, "工學大樓")).toContain("google.com/maps");
    expect(osmUrl(fit.lat, fit.lng)).toContain("openstreetmap.org");
  });
});
