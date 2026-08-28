/**
 * A label nobody can read is a plan that says something else.
 *
 * On the shipped E310 example, 「鞋子｜右側」 was drawn almost entirely behind
 * 「背包｜課桌椅」. Given that render and no other context, a reader described
 * the plan as putting shoes on one side only, and reported it as a design
 * error — the exact arrangement the field research had corrected
 * (`REFERENCE_MAPPING.md`: 「左右兩側各一列」, with 「⚠️ 原設計只放一側」).
 *
 * The plan was right and the picture was wrong, which is the worse of the two.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { LABEL_SIZE, stackedLabelY, type PlacedLabel } from "../src/scene/labelLayout";
import { buildE310ClubGoldenProject } from "../src/core/quickStart";
import { venuePresetById } from "../src/core/venues";

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
installLocalStorage();

/** Could these two pills overlap on screen? Same test the layout uses. */
function collides(a: PlacedLabel, b: PlacedLabel): boolean {
  return Math.abs(a.x - b.x) < LABEL_SIZE.width
    && Math.abs(a.z - b.z) < LABEL_SIZE.width
    && Math.abs(a.y - b.y) < LABEL_SIZE.height;
}

/** Lay out every zone of a plan the way the scene does. */
function layout(zones: { x: number; z: number; name: string }[]): (PlacedLabel & { name: string })[] {
  const placed: (PlacedLabel & { name: string })[] = [];
  for (const zone of zones) {
    placed.push({ ...zone, y: stackedLabelY(zone, placed, 0.5) });
  }
  return placed;
}

describe("the shipped E310 example shows both shoe zones", () => {
  const zones = () =>
    buildE310ClubGoldenProject(venuePresetById("venue:tku-e310")!).zones
      .filter((z) => !z.hidden)
      .map((z) => ({ x: z.x, z: z.z, name: z.name }));

  it("no two labels overlap", () => {
    const placed = layout(zones());
    const clashes: string[] = [];
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        if (collides(placed[i], placed[j])) clashes.push(`${placed[i].name} × ${placed[j].name}`);
      }
    }
    expect(clashes, clashes.join(" / ")).toEqual([]);
  });

  it("specifically 鞋子｜右側 and 背包｜課桌椅, which sit 0.6 m apart", () => {
    const placed = layout(zones());
    const shoe = placed.find((p) => p.name.includes("鞋子") && p.name.includes("右"))!;
    const bag = placed.find((p) => p.name.includes("背包"))!;
    expect(shoe).toBeDefined();
    expect(bag).toBeDefined();
    expect(Math.abs(shoe.x - bag.x)).toBeLessThan(LABEL_SIZE.width);
    // …so they must be separated in height, by more than the sprite is tall.
    expect(Math.abs(shoe.y - bag.y)).toBeGreaterThanOrEqual(LABEL_SIZE.height);
  });

  it("both shoe zones exist in the first place", () => {
    const names = zones().map((z) => z.name);
    expect(names.filter((n) => n.includes("鞋子"))).toHaveLength(2);
  });
});

describe("the stacking rule itself", () => {
  it("leaves a label alone when nothing is near it", () => {
    expect(stackedLabelY({ x: 0, z: 0 }, [{ x: 8, z: 8, y: 0.5 }], 0.5)).toBe(0.5);
  });

  it("compares the LABEL's size, not the zone's", () => {
    // Two zones 1 m apart do not overlap as rectangles if they are narrow —
    // but their 1.6 m labels do. That is the case the old rule missed.
    const raised = stackedLabelY({ x: 1, z: 0 }, [{ x: 0, z: 0, y: 0.5 }], 0.5);
    expect(raised).toBeGreaterThan(0.5);
  });

  it("steps far enough to actually clear the sprite", () => {
    const raised = stackedLabelY({ x: 0.6, z: 0 }, [{ x: 0, z: 0, y: 0.5 }], 0.5);
    expect(raised - 0.5).toBeGreaterThan(LABEL_SIZE.height);
  });

  it("keeps stepping past a stack of them", () => {
    const placed: PlacedLabel[] = [{ x: 0, z: 0, y: 0.5 }];
    for (let i = 0; i < 4; i++) {
      const y = stackedLabelY({ x: 0.2, z: 0.2 }, placed, 0.5);
      placed.push({ x: 0.2, z: 0.2, y });
    }
    const ys = placed.map((p) => p.y).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i] - ys[i - 1], `labels ${i - 1} and ${i} are on top of each other`)
        .toBeGreaterThanOrEqual(LABEL_SIZE.height);
    }
  });

  it("gives up rather than looping forever on a pathological stack", () => {
    const placed: PlacedLabel[] = Array.from({ length: 200 }, (_, i) => ({ x: 0, z: 0, y: 0.5 + i * 0.01 }));
    expect(Number.isFinite(stackedLabelY({ x: 0, z: 0 }, placed, 0.5))).toBe(true);
  });
});
