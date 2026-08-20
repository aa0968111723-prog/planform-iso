import { beforeEach, describe, expect, it } from "vitest";
import { createDefaultProject } from "../src/core/model";
import { validateProject } from "../src/core/validation";
import {
  applyVenuePreset,
  BUILTIN_VENUE_PRESETS,
  createProjectFromVenuePreset,
  deleteUserVenuePreset,
  listUserVenuePresets,
  saveUserVenuePreset,
  venuePresetById,
  venuePresetFromProject,
} from "../src/core/venues";

// Minimal localStorage stub for the node test environment.
function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

describe("venue presets", () => {
  beforeEach(() => installLocalStorage());

  it("provides 淡江教室模板 / 一般矩形 / 空白 builtins", () => {
    expect(BUILTIN_VENUE_PRESETS.map((p) => p.name)).toEqual([
      "淡江教室模板",
      "一般矩形教室",
      "空白自訂場地",
    ]);
    for (const p of BUILTIN_VENUE_PRESETS) {
      expect(p.builtin).toBe(true);
      expect(p.classroom.length).toBeGreaterThan(0);
      expect(p.tile.width).toBeGreaterThan(0);
    }
  });

  it("淡江 template creates a valid project with door and screen on walls", () => {
    const p = createProjectFromVenuePreset(BUILTIN_VENUE_PRESETS[0], "測試活動");
    expect(p.name).toBe("測試活動");
    const door = p.objects.find((o) => o.kind === "door");
    const screen = p.objects.find((o) => o.kind === "screen");
    expect(door?.wallAnchor?.edge).toBe("s");
    expect(screen?.wallAnchor?.edge).toBe("n");
    const issues = validateProject(p);
    expect(issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("apply keeps existing fixtures instead of duplicating them", () => {
    const p = createProjectFromVenuePreset(BUILTIN_VENUE_PRESETS[0]);
    const doorCount = p.objects.filter((o) => o.kind === "door").length;
    applyVenuePreset(p, BUILTIN_VENUE_PRESETS[0]);
    expect(p.objects.filter((o) => o.kind === "door")).toHaveLength(doorCount);
  });

  it("round-trips 儲存為我的場地", () => {
    const p = createDefaultProject();
    p.classroom.length = 13.5;
    p.tile.width = 0.4;
    const preset = venuePresetFromProject(p, "B302");
    expect(saveUserVenuePreset(preset)).toBe(true);
    const listed = listUserVenuePresets();
    expect(listed).toHaveLength(1);
    expect(listed[0].name).toBe("B302");
    expect(listed[0].classroom.length).toBe(13.5);
    expect(venuePresetById(listed[0].id)?.tile.width).toBe(0.4);
    deleteUserVenuePreset(listed[0].id);
    expect(listUserVenuePresets()).toHaveLength(0);
  });

  it("saving the same name replaces instead of duplicating", () => {
    const p = createDefaultProject();
    saveUserVenuePreset(venuePresetFromProject(p, "B302"));
    p.classroom.length = 20;
    saveUserVenuePreset(venuePresetFromProject(p, "B302"));
    const listed = listUserVenuePresets();
    expect(listed).toHaveLength(1);
    expect(listed[0].classroom.length).toBe(20);
  });

  it("survives corrupt venue storage", () => {
    localStorage.setItem("planform-iso:venues", "{not json");
    expect(listUserVenuePresets()).toEqual([]);
  });
});
