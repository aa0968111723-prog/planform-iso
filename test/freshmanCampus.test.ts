import { beforeEach, describe, expect, it } from "vitest";
import { photosForPlace, photosForVenue, photosLeakAcrossVenues, unboundPhotos, VENUE_PHOTO_REFS } from "../src/core/venuePhotos";
import { createProjectFromVenuePreset, venuePresetById } from "../src/core/venues";
import { buildFreshmanGuide, freshmanBriefLines, freshmanCopyLeaks } from "../src/core/freshman";
import { buildQuickStartProject, DEFAULT_NEEDS } from "../src/core/quickStart";

function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

beforeEach(() => installLocalStorage());

describe("E305 photographs never become E310", () => {
  it("binds E305 photos only to the E305 venue", () => {
    expect(photosLeakAcrossVenues()).toEqual([]);
    expect(photosForPlace("E305").length).toBeGreaterThan(0);
    expect(photosForPlace("E305").every((p) => p.venuePresetId === "venue:tku-e305")).toBe(true);
    expect(photosForVenue("venue:tku-e310")).toEqual([]);
    expect(photosForPlace("E310")).toEqual([]);
    expect(unboundPhotos().some((p) => p.note.includes("尚未綁定"))).toBe(true);
  });

  it("keeps E305 geometry independent of the E310 golden template", () => {
    const e305 = venuePresetById("venue:tku-e305")!;
    const e310 = venuePresetById("venue:tku-e310")!;
    expect(e305.classroom.length).not.toBe(e310.classroom.length);
    expect(e305.extraObjects?.some((o) => o.assetId === "builtin:stage-platform")).toBeFalsy();
    expect(e310.extraObjects?.some((o) => o.assetId === "builtin:stage-platform")).toBe(true);
    expect(e305.note).toMatch(/不是 E310/);
    expect(e305.calibrationNote).toMatch(/待現場校正/);
    const project = createProjectFromVenuePreset(e305, "E305");
    expect(project.objects.some((o) => o.assetId === "builtin:stage-platform")).toBe(false);
    expect(project.objects.some((o) => o.kind === "door")).toBe(true);
  });
});

describe("freshman copy stays in plain Chinese", () => {
  it("tells a new student where to go in E310 without coordinates", () => {
    const venue = venuePresetById("venue:tku-e310")!;
    const project = buildQuickStartProject({
      venue,
      eventName: "迎新",
      participants: 30,
      needs: { ...DEFAULT_NEEDS, teacher: true, life: true },
      centralAisle: true,
    });
    const guide = buildFreshmanGuide(project);
    expect(guide.headline).toContain("淡江大學");
    expect(guide.headline).toContain("淡水校園");
    expect(guide.headline).toContain("工學大樓");
    expect(guide.headline).toContain("E310");
    expect(guide.howToRoom).toMatch(/工學大樓/);
    expect(guide.howLayout).toMatch(/入口/);
    expect(guide.youAreNow).toContain("入口");
    expect(guide.path.length).toBeGreaterThan(1);
    const indoor = freshmanBriefLines(guide, "indoor");
    expect(indoor.map((line) => line.label)).toEqual([
      "我們在哪裡", "怎麼走到教室", "教室怎麼擺", "我現在在哪裡", "下一步去哪裡",
    ]);
    expect(freshmanBriefLines(guide, "campus")[3]?.text).toContain("校園位置圖");
    expect(freshmanCopyLeaks(guide)).toEqual([]);
    expect(guide.lines.join("\n")).not.toMatch(/latitude|longitude|mesh|shader/i);
  });

  it("does not describe an E305 event as E310", () => {
    const project = buildQuickStartProject({
      venue: venuePresetById("venue:tku-e305")!,
      eventName: "E305 迎新",
      participants: 20,
      needs: DEFAULT_NEEDS,
      centralAisle: true,
    });
    const guide = buildFreshmanGuide(project);
    expect(guide.headline).toContain("E305");
    expect(guide.headline).not.toContain("E310");
    expect(guide.photos.every((p) => p.placeId === "E305")).toBe(true);
  });
});

describe("photo catalog language", () => {
  it("always tags unbound or pending photos in freshman language", () => {
    for (const photo of VENUE_PHOTO_REFS) {
      if (!photo.placeId) expect(photo.note).toMatch(/尚未綁定/);
      else expect(photo.status).toBe("pending-site-check");
    }
  });
});
