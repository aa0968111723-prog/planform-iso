import { describe, expect, it } from "vitest";
import { buildFreshmanGuide, freshmanGuideHasEngineering, freshmanPlainTexts, freshmanStops } from "../src/core/freshman";
import { layoutFreshmanPlan } from "../src/core/freshmanPlan";
import { migrateProject } from "../src/core/migrate";
import { buildE305PhotoReferenceProject, buildE310ClubGoldenProject } from "../src/core/quickStart";
import { photoBindingLabel, unboundVenuePhotos, venuePhotosForPlace, venuePhotosForPreset } from "../src/core/venuePhotos";
import { createProjectFromVenuePreset, venuePresetById } from "../src/core/venues";

const e305 = venuePresetById("venue:tku-e305")!;
const e310 = venuePresetById("venue:tku-e310")!;

describe("E305 and E310 stay separate venues", () => {
  it("does not copy E305 photos or size onto E310", () => {
    const a = createProjectFromVenuePreset(e305, "E305");
    const b = createProjectFromVenuePreset(e310, "E310");
    expect(a.placeId).toBe("E305");
    expect(b.placeId).toBe("E310");
    expect(a.venuePresetId).toBe("venue:tku-e305");
    expect(b.venuePresetId).toBe("venue:tku-e310");
    expect(a.classroom.length).toBe(10);
    expect(a.classroom.width).toBe(8);
    expect(b.classroom.length).toBe(12);
    expect(b.classroom.width).toBe(9);
    expect(a.objects.some((o) => o.assetId === "builtin:stage-platform")).toBe(false);
    expect(b.objects.some((o) => o.assetId === "builtin:stage-platform")).toBe(true);
    expect(e305.note).toMatch(/不是 E310/);
    expect(e310.note).not.toMatch(/E305 照片/);
  });

  it("binds photo cards to E305 only and labels unbound shots", () => {
    const e305Photos = venuePhotosForPlace("E305");
    const e310Photos = venuePhotosForPlace("E310");
    expect(e305Photos.length).toBeGreaterThan(0);
    expect(e310Photos).toEqual([]);
    expect(e305Photos.every((p) => p.venuePresetId === "venue:tku-e305")).toBe(true);
    expect(venuePhotosForPreset("venue:tku-e310")).toEqual([]);
    expect(unboundVenuePhotos().every((p) => photoBindingLabel(p) === "照片場地尚未綁定")).toBe(true);
    expect(e305Photos.every((p) => photoBindingLabel(p) === "待現場確認")).toBe(true);
  });

  it("builds an E305 photo-reference plan that is not the E310 golden", () => {
    const photo = buildE305PhotoReferenceProject(e305);
    const golden = buildE310ClubGoldenProject(e310);
    expect(photo.placeId).toBe("E305");
    expect(golden.placeId).toBe("E310");
    expect(photo.name).toContain("E305");
    expect(golden.name).toContain("E310");
    expect(photo.classroom.length).not.toBe(golden.classroom.length);
    expect(photo.objects.some((o) => o.assetId === "builtin:stage-platform")).toBe(false);
  });

  it("opens an old E310 JSON without placeId", () => {
    const p = migrateProject({
      version: 6,
      name: "舊 E310",
      venuePresetId: "venue:tku-e310",
    } as never);
    expect(p.placeId).toBe("E310");
    const generic = migrateProject({
      version: 6,
      name: "舊教室",
      venuePresetId: "venue:tku-classroom",
    } as never);
    expect(generic.placeId).toBeUndefined();
  });
});

describe("freshman partner reading", () => {
  it("answers the five questions without engineering vocabulary", () => {
    const project = buildE310ClubGoldenProject(e310);
    const guide = buildFreshmanGuide(project, 0);
    expect(guide.headline).toBe("淡江大學 · 淡水校園 · 工學大樓 · E310 · 3F");
    expect(guide.whereWeAre).toContain("淡水校園");
    expect(guide.howToClassroom).toContain("工學大樓");
    expect(guide.howToClassroom).toContain("E310");
    expect(guide.howClassroomLooks).toMatch(/入口|投影幕|地墊/);
    expect(guide.youAreHere).toContain("你在這裡");
    expect(guide.nextStop).toBeTruthy();
    expect(guide.steps[0].text).toContain("後側入口");
    expect(freshmanPlainTexts(guide).some((t) => freshmanGuideHasEngineering(t))).toBe(false);
  });

  it("walks entrance → check-in → shoes → mats", () => {
    const project = buildE310ClubGoldenProject(e310);
    const ids = freshmanStops(project).map((s) => s.id);
    expect(ids[0]).toBe("entrance");
    expect(ids).toContain("checkin");
    expect(ids).toContain("shoe");
    expect(ids).toContain("mats");
    const later = buildFreshmanGuide(project, 1);
    expect(later.youAreHere).toContain("報到");
  });

  it("draws a top-down plan with door, screen, mats and you-are-here", () => {
    const project = buildE310ClubGoldenProject(e310);
    const view = layoutFreshmanPlan(project, buildFreshmanGuide(project, 0), false);
    expect(view.boxes.some((b) => b.kind === "door")).toBe(true);
    expect(view.boxes.some((b) => b.kind === "screen")).toBe(true);
    expect(view.boxes.some((b) => b.kind === "mat")).toBe(true);
    expect(view.boxes.some((b) => b.kind === "here")).toBe(true);
    expect(view.labels.some((l) => l.tone === "here" && l.text === "你在這裡")).toBe(true);
    expect(view.arrows.length).toBeGreaterThan(0);
    expect(view.detailLine).toBeNull();
    const detailed = layoutFreshmanPlan(project, buildFreshmanGuide(project, 0), true);
    expect(detailed.detailLine).toMatch(/待現場校正/);
    expect(view.frontCaption).toContain("投影幕");
  });
});
