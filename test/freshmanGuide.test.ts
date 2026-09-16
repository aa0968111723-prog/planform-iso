import { beforeEach, describe, expect, it } from "vitest";
import { createProjectFromVenuePreset, venuePresetById } from "../src/core/venues";
import { buildE310ClubGoldenProject, buildQuickStartProject, DEFAULT_NEEDS } from "../src/core/quickStart";
import {
  FRESHMAN_ENGINEERING,
  FRESHMAN_STAGES,
  formatFreshmanHeadline,
  freshmanBriefing,
  freshmanJourney,
  freshmanLayoutView,
  resolveProjectCampusRef,
} from "../src/core/freshmanGuide";
import { layoutMapLabels } from "../src/core/campusMap";
import { createDefaultProject } from "../src/core/model";

function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

describe("freshman partner copy", () => {
  beforeEach(installLocalStorage);

  it("prints the path headline without engineering words", () => {
    const e310 = createProjectFromVenuePreset(venuePresetById("venue:tku-e310")!, "E310");
    const head = formatFreshmanHeadline(resolveProjectCampusRef(e310));
    expect(head.text).toBe("淡江大學 · 淡水校園 · 工學大樓 · E310 · 3F");
    const e305 = createProjectFromVenuePreset(venuePresetById("venue:tku-e305")!, "E305");
    expect(formatFreshmanHeadline(resolveProjectCampusRef(e305)).text)
      .toBe("淡江大學 · 淡水校園 · 工學大樓 · E305 · 3F");
    expect(FRESHMAN_STAGES.map((s) => s.id)).toEqual(["campus", "building", "classroom", "layout"]);
  });

  it("walks a first-time visitor through the classroom in plain Chinese", () => {
    const project = buildE310ClubGoldenProject(venuePresetById("venue:tku-e310")!);
    const b = freshmanBriefing(project, 0);
    expect(b.headline).toContain("E310");
    expect(b.howToRoom).toMatch(/工學大樓 3F/);
    expect(b.steps.map((s) => s.text).join("\n")).toMatch(/請從教室後側入口進入/);
    expect(b.steps.map((s) => s.text).join("\n")).toMatch(/報到區/);
    expect(b.steps.map((s) => s.text).join("\n")).toMatch(/鞋子區/);
    expect(b.steps.map((s) => s.text).join("\n")).toMatch(/中央青綠色地墊區/);
    expect(b.entrance).toMatch(/入口待現場確認/);
    expect(FRESHMAN_ENGINEERING.test([
      b.headline, b.where, b.howToRoom, b.howLaidOut, b.youAre, b.next, b.entrance,
      ...b.steps.map((s) => s.text),
    ].join(" "))).toBe(false);
  });

  it("keeps E305 briefing from claiming it is E310", () => {
    const project = buildQuickStartProject({
      venue: venuePresetById("venue:tku-e305")!,
      eventName: "E305",
      participants: 30,
      needs: { ...DEFAULT_NEEDS, payment: true, life: true, teacher: true },
      centralAisle: true,
    });
    const b = freshmanBriefing(project);
    expect(b.headline).toContain("E305");
    expect(b.headline).not.toContain("E310");
    expect(b.photosNote).toMatch(/待現場確認/);
  });

  it("layout pins include 你在這裡 and numbered path", () => {
    const p = createDefaultProject();
    const view = freshmanLayoutView(p, 0);
    expect(view.pins.youAreHere.label).toBe("你在這裡");
    expect(view.path[0]?.index).toBe(1);
    expect(view.zones.some((z) => z.label === "地墊區")).toBe(true);
    expect(view.zones.some((z) => z.label === "報到區")).toBe(true);
    expect(freshmanJourney(p).length).toBeGreaterThanOrEqual(5);
    const boxes = view.zones.map((z, i) => ({
      id: z.id, x: i * 90, y: 10, width: 80, height: 22, priority: 1 as const,
    }));
    const placed = layoutMapLabels(boxes, { width: 390, height: 400 });
    expect(placed.filter((x) => !x.hidden).length).toBeGreaterThan(0);
  });
});
