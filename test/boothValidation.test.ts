import { beforeEach, describe, expect, it } from "vitest";
import { boothVenuePreset, createProjectFromVenuePreset } from "../src/core/venues";
import { validateProject, type Issue } from "../src/core/validation";
import type { Project, SceneObject } from "../src/core/model";

function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

function boothProject(): Project {
  return createProjectFromVenuePreset(boothVenuePreset(), "攤位");
}

function find(issues: Issue[], code: string): Issue[] {
  return issues.filter((i) => i.code === code);
}

function obj(p: Project, assetId: string): SceneObject {
  return p.objects.find((o) => o.assetId === assetId)!;
}

describe("booth validation rules", () => {
  beforeEach(() => installLocalStorage());

  it("reports overlapping booth furniture as an error", () => {
    const p = boothProject();
    const table = obj(p, "custom:booth-table");
    // Slide the display board 5 cm into the end of the table.
    const board = obj(p, "custom:display-board");
    board.rotationDeg = 0;
    board.x = table.x + table.width / 2 + board.width / 2 - 0.05;
    board.z = table.z;

    const overlaps = find(validateProject(p), "booth-overlap");
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].severity).toBe("error");
    expect(overlaps[0].message).toContain("攤位桌");
    expect(overlaps[0].message).toContain("展示板");
  });

  it("does not report one issue twice — the generic overlap warning stands down", () => {
    const p = boothProject();
    const table = obj(p, "custom:booth-table");
    const stool = p.objects.find((o) => o.assetId === "custom:red-stool")!;
    stool.rotationDeg = 0;
    stool.x = table.x;
    stool.z = table.z;

    const issues = validateProject(p);
    expect(find(issues, "booth-overlap")).toHaveLength(1);
    expect(find(issues, "overlap")).toHaveLength(0);
  });

  it("lets chairs and tables stand under the tent canopy", () => {
    const p = boothProject();
    // The default layout already has stools and the table inside the tent.
    const issues = validateProject(p);
    expect(find(issues, "booth-overlap")).toHaveLength(0);
    expect(find(issues, "overlap")).toHaveLength(0);
  });

  it("reports a standee parked on the entrance", () => {
    const p = boothProject();
    const entry = p.zones.find((z) => z.boothRole === "entry")!;
    const standee = obj(p, "custom:blank-standee");
    standee.x = entry.x;
    standee.z = entry.z;

    const blocked = find(validateProject(p), "booth-entry-blocked");
    expect(blocked).toHaveLength(1);
    expect(blocked[0].severity).toBe("error");
    expect(blocked[0].targetId).toBe(standee.id);
  });

  it("reports the display board pushed onto the paved path", () => {
    const p = boothProject();
    const board = obj(p, "custom:display-board");
    board.x = 3;
    board.z = p.corridor.z + p.corridor.width / 2;

    const onPath = find(validateProject(p), "booth-object-in-corridor");
    expect(onPath).toHaveLength(1);
    expect(onPath[0].severity).toBe("warning");
    expect(onPath[0].message).toContain("石磚走道");
  });

  it("warns when the gap between table and display board drops below the threshold", () => {
    const p = boothProject();
    const table = obj(p, "custom:booth-table");
    const board = obj(p, "custom:display-board");
    board.rotationDeg = 0;
    // 80 cm of clear gap against a 90 cm threshold.
    board.x = table.x + table.width / 2 + board.width / 2 + 0.8;
    board.z = table.z;
    expect(p.validationSettings.minAisleWidth).toBe(0.9);

    const narrow = find(validateProject(p), "booth-aisle-too-narrow");
    expect(narrow).toHaveLength(1);
    expect(narrow[0].severity).toBe("warning");
    expect(narrow[0].message).toContain("80 cm");
  });

  it("does not warn about a wide gap", () => {
    const p = boothProject();
    expect(find(validateProject(p), "booth-aisle-too-narrow")).toHaveLength(0);
  });

  it("does not call an outdoor pitch's neighbour stall out of bounds", () => {
    const p = boothProject();
    // The neighbouring stall sits at x ≈ 8.7, outside the 7 × 7 pitch by design.
    expect(obj(p, "custom:neighbor-booth").x).toBeGreaterThan(p.classroom.x + p.classroom.length);
    expect(find(validateProject(p), "bounds")).toHaveLength(0);
  });

  it("does not tell an outdoor banner to go stand against a wall", () => {
    const p = boothProject();
    expect(obj(p, "custom:banner").kind).toBe("screen");
    expect(find(validateProject(p), "wall-off")).toHaveLength(0);
  });

  it("still applies the classroom rules to classroom plans", () => {
    const p = boothProject();
    delete p.booth;
    // With no booth data the plan is a classroom again: the neighbour stall
    // outside the room rectangle becomes a genuine out-of-bounds error.
    expect(find(validateProject(p), "bounds").length).toBeGreaterThan(0);
  });
});
