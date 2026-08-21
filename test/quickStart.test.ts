import { describe, expect, it } from "vitest";
import { buildQuickStartProject, DEFAULT_NEEDS } from "../src/core/quickStart";
import { BUILTIN_VENUE_PRESETS } from "../src/core/venues";
import { validateProject } from "../src/core/validation";
import { groupMembers } from "../src/core/arrays";

const tku = BUILTIN_VENUE_PRESETS[0];

describe("quick start builder", () => {
  it("30 人社課: zones + desk + mats + entry route, no validation errors", () => {
    const p = buildQuickStartProject({
      venue: tku,
      eventName: "期初茶會",
      participants: 30,
      needs: { ...DEFAULT_NEEDS },
      centralAisle: true,
    });
    expect(p.name).toBe("期初茶會");
    expect(p.zones.some((z) => z.type === "registration")).toBe(true);
    expect(p.zones.some((z) => z.type === "shoe")).toBe(true);
    expect(p.zones.some((z) => z.type === "backpack")).toBe(true);
    expect(p.objects.some((o) => o.serviceRole === "checkin")).toBe(true);
    const matCount = p.groups.reduce((sum, g) => sum + groupMembers(g).length, 0);
    expect(matCount).toBeGreaterThanOrEqual(30);
    expect(p.routes.some((r) => r.type === "entry")).toBe(true);
    const errors = validateProject(p).filter((i) => i.severity === "error");
    expect(errors).toHaveLength(0);
  });

  it("60 人＋收費: payment zone + payment desk appear", () => {
    const p = buildQuickStartProject({
      venue: tku,
      eventName: "大型活動",
      participants: 60,
      needs: { ...DEFAULT_NEEDS, payment: true, staffRoute: true },
      centralAisle: true,
    });
    expect(p.zones.some((z) => z.type === "payment")).toBe(true);
    expect(p.objects.some((o) => o.serviceRole === "payment")).toBe(true);
    expect(p.routes.some((r) => r.type === "staff")).toBe(true);
    const errors = validateProject(p).filter((i) => i.severity === "error");
    expect(errors).toHaveLength(0);
  });

  it("central aisle keeps two mat blocks", () => {
    const p = buildQuickStartProject({
      venue: tku,
      eventName: "x",
      participants: 40,
      needs: { ...DEFAULT_NEEDS, checkin: false, shoe: false, backpack: false },
      centralAisle: true,
    });
    expect(p.groups.length).toBe(2);
  });

  it("nothing ticked → clean empty starting point", () => {
    const p = buildQuickStartProject({
      venue: BUILTIN_VENUE_PRESETS[2],
      eventName: "空白",
      participants: 10,
      needs: {
        mats: false, checkin: false, payment: false, shoe: false,
        backpack: false, teacher: false, groups: false, staffRoute: false,
      },
      centralAisle: false,
    });
    expect(p.zones).toHaveLength(0);
    expect(p.groups).toHaveLength(0);
  });
});
