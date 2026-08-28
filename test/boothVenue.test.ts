import { beforeEach, describe, expect, it } from "vitest";
import { createDefaultProject, uid, type SceneObject } from "../src/core/model";
import { applyVenuePreset, boothVenuePreset, createProjectFromVenuePreset, venuePresetById } from "../src/core/venues";
import { validateProject } from "../src/core/validation";
import { planHasContent } from "../src/core/model";
import { isBoothProject } from "../src/core/boothCatalog";

function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

describe("戶外攤位 venue template", () => {
  beforeEach(() => installLocalStorage());

  it("is registered and produces a plan with content", () => {
    expect(venuePresetById("venue:tku-booth")?.name).toBe("戶外攤位（3×3 帳篷）");
    const p = createProjectFromVenuePreset(boothVenuePreset(), "禪學社戶外攤位");
    expect(planHasContent(p)).toBe(true);
    expect(p.venuePresetId).toBe("venue:tku-booth");
    expect(isBoothProject(p)).toBe(true);
  });

  it("places the whole stall: tent with four legs, table, boards, mats, neighbour", () => {
    const p = createProjectFromVenuePreset(boothVenuePreset(), "攤位");
    const count = (assetId: string) => p.objects.filter((o) => o.assetId === assetId).length;
    expect(count("custom:booth-tent")).toBe(1);
    // A template with four legs must place four, not just the first one.
    expect(count("custom:tent-leg")).toBe(4);
    expect(count("custom:booth-table")).toBe(1);
    expect(count("custom:red-stool")).toBe(6);
    expect(count("builtin:mat")).toBe(4);
    expect(count("custom:neighbor-booth")).toBe(1);
    expect(p.objects.find((o) => o.assetId === "custom:neighbor-booth")?.locked).toBe(true);
    // 巧拼 are 60 × 60, not the builtin mat's default 60 × 180.
    for (const mat of p.objects.filter((o) => o.assetId === "builtin:mat")) {
      expect(mat.depth).toBeCloseTo(0.6, 5);
    }
  });

  it("sits the tabletop props on the booth table rather than leaving them orphaned", () => {
    const p = createProjectFromVenuePreset(boothVenuePreset(), "攤位");
    const table = p.objects.find((o) => o.assetId === "custom:booth-table")!;
    for (const id of ["custom:flyer-tray", "custom:table-prop", "custom:token-disc"]) {
      const prop = p.objects.find((o) => o.assetId === id)!;
      expect(prop.surface).toBe("tabletop");
      expect(prop.parentId).toBe(table.id);
    }
  });

  it("seeds the seven zones, four flows and eight simulation stations", () => {
    const p = createProjectFromVenuePreset(boothVenuePreset(), "攤位");
    expect(p.zones.map((z) => z.boothRole)).toEqual([
      "staff", "visitor", "queue", "interact", "calm", "entry", "exit",
    ]);
    expect(p.routes).toHaveLength(4);
    expect(p.routes.filter((r) => r.boothRole === "staff")).toHaveLength(1);
    expect(p.booth?.stations).toHaveLength(8);
    expect(p.booth?.scenarioId).toBe("normal");
  });

  it("is a clean starting point: no validation errors", () => {
    const p = createProjectFromVenuePreset(boothVenuePreset(), "攤位");
    const errors = validateProject(p).filter((i) => i.severity === "error");
    expect(errors.map((e) => `${e.code}: ${e.message}`)).toEqual([]);
  });

  it("does not delete existing classroom objects when the template is applied", () => {
    const p = createDefaultProject();
    const chair: SceneObject = {
      id: uid("obj"), kind: "chair", x: 2, z: 2, rotationDeg: 0,
      width: 0.45, depth: 0.45, height: 0.9, locked: false, hidden: false,
      surface: "floor", elevation: 0, assetId: "builtin:chair",
    };
    p.objects.push(chair);
    applyVenuePreset(p, boothVenuePreset(), { withFixtures: true });
    expect(p.objects.some((o) => o.id === chair.id)).toBe(true);
    expect(p.objects.some((o) => o.assetId === "custom:booth-tent")).toBe(true);
  });

  it("re-applying the template does not duplicate zones, routes or stations", () => {
    const p = createProjectFromVenuePreset(boothVenuePreset(), "攤位");
    const stationIds = p.booth!.stations.map((s) => s.id);
    applyVenuePreset(p, boothVenuePreset(), { withFixtures: true });
    expect(p.zones).toHaveLength(7);
    expect(p.routes).toHaveLength(4);
    expect(p.booth!.stations.map((s) => s.id)).toEqual(stationIds);
  });

  it("turns off the projector-sightline rule — an outdoor pitch has no screen", () => {
    const p = createProjectFromVenuePreset(boothVenuePreset(), "攤位");
    expect(p.validationSettings.checkScreenView).toBe(false);
    expect(p.calibration.note).toContain("待現場校正");
  });

  it("opens in 立體 — a tent seen from directly above is a white rectangle", () => {
    expect(boothVenuePreset().defaultView).toBe("iso");
    expect(createProjectFromVenuePreset(boothVenuePreset(), "攤位").view).toBe("iso");
  });

  it("does not yank the camera when the template lands on an existing plan", () => {
    const p = createDefaultProject();
    p.view = "front";
    applyVenuePreset(p, boothVenuePreset(), { withFixtures: true });
    expect(p.view).toBe("front");
  });
});
