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

  it("中央走道是留空位，墊子仍是一整片", () => {
    const withAisle = buildQuickStartProject({
      venue: tku,
      eventName: "x",
      participants: 40,
      needs: { ...DEFAULT_NEEDS, checkin: false, shoe: false, backpack: false },
      centralAisle: true,
    });
    // 實照：墊子一路對接成一整片，走道是靠中間那一列不坐人做出來的
    // （docs/field-research/REFERENCE_MAPPING.md 一、中央走道）。
    expect(withAisle.groups.length).toBe(1);

    const noAisle = buildQuickStartProject({
      venue: tku,
      eventName: "x",
      participants: 40,
      needs: { ...DEFAULT_NEEDS, checkin: false, shoe: false, backpack: false },
      centralAisle: false,
    });
    expect(noAisle.groups.length).toBe(1);
    // 兩種都坐得下這 40 人。差別在於留走道版要鋪更多墊子才辦得到——
    // 走道的成本是多搬幾片墊子，不是把墊子切成兩塊。
    const tiles = (p: typeof withAisle) => p.groups.reduce((s, g) => s + g.rows * g.cols, 0);
    const seats = (p: typeof withAisle) =>
      p.groups.reduce((s, g) => s + g.cols * Math.floor((g.rows * g.itemDepth + 1e-9) / 0.9), 0);
    expect(seats(withAisle)).toBeGreaterThanOrEqual(40);
    expect(seats(noAisle)).toBeGreaterThanOrEqual(40);
    expect(tiles(withAisle)).toBeGreaterThanOrEqual(tiles(noAisle));
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
