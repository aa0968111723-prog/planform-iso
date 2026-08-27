import { beforeEach, describe, expect, it } from "vitest";
import { migrateProject } from "../src/core/migrate";
import { PROJECT_VERSION, type Project } from "../src/core/model";
import { boothVenuePreset, createProjectFromVenuePreset } from "../src/core/venues";
import { isBoothProject } from "../src/core/boothFlow";

function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

function roundTrip(p: Project | Partial<Project>): Project {
  return migrateProject(JSON.parse(JSON.stringify(p)) as Partial<Project>);
}

describe("booth migration", () => {
  beforeEach(() => installLocalStorage());

  it("adds no project version — booth data rides on optional fields", () => {
    expect(PROJECT_VERSION).toBe(8);
    const p = createProjectFromVenuePreset(boothVenuePreset(), "攤位");
    expect(p.version).toBe(8);
  });

  it("leaves an old project without booth data alone", () => {
    const legacy: Partial<Project> = {
      version: 6,
      name: "舊教室",
      objects: [{
        id: "o1", kind: "chair", x: 1, z: 1, rotationDeg: 0,
        width: 0.45, depth: 0.45, height: 0.9, locked: false, hidden: false,
        surface: "floor", elevation: 0,
      }],
      zones: [],
      routes: [],
    };
    const p = roundTrip(legacy);
    expect(p.booth).toBeUndefined();
    expect(isBoothProject(p)).toBe(false);
    expect(p.objects).toHaveLength(1);
    expect(p.version).toBe(PROJECT_VERSION);
  });

  it("keeps stations, scenario and parameters across a save / load", () => {
    const p = createProjectFromVenuePreset(boothVenuePreset(), "攤位");
    p.booth!.scenarioId = "peak";
    p.booth!.params.deskStaff = 5;
    p.booth!.stations[0].enabled = false;
    const ids = p.booth!.stations.map((s) => s.id);

    const back = roundTrip(p);
    expect(back.booth?.scenarioId).toBe("peak");
    expect(back.booth?.params.deskStaff).toBe(5);
    expect(back.booth?.stations.map((s) => s.id)).toEqual(ids);
    expect(back.booth?.stations[0].enabled).toBe(false);
  });

  it("fills in missing booth parameters from the scenario defaults", () => {
    const p = createProjectFromVenuePreset(boothVenuePreset(), "攤位");
    const raw = JSON.parse(JSON.stringify(p)) as Record<string, unknown>;
    (raw.booth as { params: unknown }).params = { deskStaff: 4 };
    const back = migrateProject(raw as Partial<Project>);
    expect(back.booth?.params.deskStaff).toBe(4);
    expect(back.booth?.params.visitorCount).toBe(40);
    expect(back.booth?.params.balk).toBe(true);
  });

  it("drops booth data that has no usable stations", () => {
    const p = createProjectFromVenuePreset(boothVenuePreset(), "攤位");
    const raw = JSON.parse(JSON.stringify(p)) as Record<string, unknown>;
    (raw.booth as { stations: unknown }).stations = [{ id: "x", name: "怪站點", boothType: "nope" }];
    const back = migrateProject(raw as Partial<Project>);
    expect(back.booth).toBeUndefined();
    // The plan itself survives — objects, zones and routes are untouched.
    expect(back.objects.length).toBeGreaterThan(0);
    expect(back.zones).toHaveLength(7);
    expect(back.routes).toHaveLength(4);
  });

  it("keeps booth zone roles and route roles through a round trip", () => {
    const p = createProjectFromVenuePreset(boothVenuePreset(), "攤位");
    const back = roundTrip(p);
    expect(back.zones.map((z) => z.boothRole)).toEqual([
      "staff", "visitor", "queue", "interact", "calm", "entry", "exit",
    ]);
    expect(back.routes.filter((r) => r.boothRole === "visitor")).toHaveLength(3);
    expect(back.routes.filter((r) => r.boothRole === "staff")).toHaveLength(1);
  });

  it("stays readable by the old schema: objects, zones and routes still parse", () => {
    const p = createProjectFromVenuePreset(boothVenuePreset(), "攤位");
    // Simulate a build that knows nothing about booths: strip every booth-only
    // field and confirm what is left is still a complete, valid plan.
    const raw = JSON.parse(JSON.stringify(p)) as Record<string, unknown>;
    delete raw.booth;
    for (const z of raw.zones as Record<string, unknown>[]) delete z.boothRole;
    for (const r of raw.routes as Record<string, unknown>[]) delete r.boothRole;

    const back = migrateProject(raw as Partial<Project>);
    expect(back.objects).toHaveLength(p.objects.length);
    expect(back.zones).toHaveLength(7);
    expect(back.zones.every((z) => z.type === "custom")).toBe(true);
    expect(back.routes).toHaveLength(4);
    expect(back.catalogExtras).toHaveLength(12);
    expect(back.booth).toBeUndefined();
  });
});
