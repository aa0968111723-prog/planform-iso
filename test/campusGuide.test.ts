import { describe, expect, it } from "vitest";
import {
  buildingLocation,
  campusAnchor,
  campusMapPins,
  entranceHint,
  formatFreshmanHeadline,
  googleMapsUrl,
  osmUrl,
  resolveProjectPlace,
  searchTkuDirectory,
} from "../src/core/campusGuide";
import { buildingByCode, findTkuPlace, parseTkuRoomCode } from "../src/core/tkuCampus";
import { createDefaultProject } from "../src/core/model";
import { createProjectFromVenuePreset, venuePresetById } from "../src/core/venues";
import { migrateProject } from "../src/core/migrate";

function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

describe("Tamkang campus search does not mix rooms", () => {
  it("keeps E305 and E310 as different rooms", () => {
    expect(findTkuPlace("E305")?.id).toBe("E305");
    expect(findTkuPlace("E310")?.id).toBe("E310");
    expect(findTkuPlace("E305")?.venuePresetId).toBe("venue:tku-e305");
    expect(findTkuPlace("E310")?.venuePresetId).toBe("venue:tku-e310");
    expect(searchTkuDirectory("E305")[0]?.placeId).toBe("E305");
    expect(searchTkuDirectory("E310")[0]?.placeId).toBe("E310");
    const e305Hits = searchTkuDirectory("E305").filter((h) => h.kind === "place");
    expect(e305Hits.some((h) => h.placeId === "E310")).toBe(false);
  });

  it("finds E308, SG320 and building names", () => {
    expect(searchTkuDirectory("E308")[0]?.placeId).toBe("E308");
    expect(searchTkuDirectory("SG320")[0]?.placeId).toBe("SG320");
    expect(searchTkuDirectory("工學大樓").some((h) => h.buildingCode === "E")).toBe(true);
    expect(parseTkuRoomCode("E305")).toMatchObject({ buildingCode: "E", floor: 3, room: "05" });
  });

  it("lists the three physical campuses without inventing room coordinates", () => {
    expect(campusAnchor("tamsui")?.precision).toBe("campus");
    expect(campusAnchor("taipei")?.precision).toBe("campus");
    expect(campusAnchor("lanyang")?.precision).toBe("campus");
    expect(campusAnchor("cyber")).toBeNull();
    const e = buildingByCode("E")!;
    expect(buildingLocation(e)?.label).toBe("樓館位置");
    const pins = campusMapPins({ campusId: "tamsui", activeBuildingCode: "E" });
    expect(pins.find((p) => p.buildingCode === "E")?.weight).toBe("active");
    expect(pins.filter((p) => p.weight === "muted").length).toBeGreaterThan(0);
  });

  it("writes navigation URLs without an API key", () => {
    const loc = buildingLocation(buildingByCode("E")!)!;
    expect(googleMapsUrl(loc, "工學大樓")).toMatch(/^https:\/\/www\.google\.com\/maps\//);
    expect(osmUrl(loc)).toMatch(/^https:\/\/www\.openstreetmap\.org\//);
    expect(googleMapsUrl(loc, "工學大樓")).not.toMatch(/key=/i);
  });

  it("marks unsurveyed classroom doors as pending", () => {
    expect(entranceHint(findTkuPlace("E305")).pending).toBe(true);
    expect(entranceHint(findTkuPlace("E305")).text).toContain("入口待現場確認");
    expect(entranceHint(findTkuPlace("E310")).text).toMatch(/後側入口/);
  });
});

describe("project place identity survives old files", () => {
  it("infers E310 from the old venue id when placeId is missing", () => {
    const project = createDefaultProject();
    project.venuePresetId = "venue:tku-e310";
    expect(resolveProjectPlace(project)?.id).toBe("E310");
    expect(formatFreshmanHeadline(resolveProjectPlace(project))).toContain("E310");
    expect(formatFreshmanHeadline(resolveProjectPlace(project))).toContain("工學大樓");
  });

  it("opens a legacy JSON body without placeId", () => {
    const opened = migrateProject({ name: "舊專案", venuePresetId: "venue:tku-e310" });
    expect(opened.name).toBe("舊專案");
    expect(opened.placeId).toBeUndefined();
    expect(resolveProjectPlace(opened)?.id).toBe("E310");
  });

  it("new E305 / E310 projects carry distinct place ids", () => {
    installLocalStorage();
    const e305 = createProjectFromVenuePreset(venuePresetById("venue:tku-e305")!, "E305 社課");
    const e310 = createProjectFromVenuePreset(venuePresetById("venue:tku-e310")!, "E310 社課");
    expect(e305.placeId).toBe("E305");
    expect(e310.placeId).toBe("E310");
    expect(e305.venuePresetId).not.toBe(e310.venuePresetId);
  });
});
