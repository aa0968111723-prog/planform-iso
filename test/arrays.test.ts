import { describe, expect, it } from "vitest";
import type { ArrayGroup } from "../src/core/model";
import { groupCenter, groupFootprint, groupMembers, memberLabel, setGroupCenter } from "../src/core/arrays";

function makeGroup(overrides: Partial<ArrayGroup> = {}): ArrayGroup {
  return {
    id: "g1", name: "地墊 A", sourceKind: "mat",
    rows: 3, cols: 4, itemWidth: 0.6, itemDepth: 1.8, gapX: 0.1, gapZ: 0.1, itemHeight: 0.04,
    rotationDeg: 0, anchorX: 0, anchorZ: 0, locked: false, hidden: false,
    numberPrefix: "A", numberOrder: "row", numberStart: "nw", ...overrides,
  };
}

describe("array group", () => {
  it("computes footprint including gaps", () => {
    const fp = groupFootprint(makeGroup());
    expect(fp.count).toBe(12);
    expect(fp.totalWidth).toBeCloseTo(2.7); // 4*0.6 + 3*0.1
    expect(fp.totalDepth).toBeCloseTo(5.6); // 3*1.8 + 2*0.1
  });

  it("produces one member per cell with the first at half-item offset", () => {
    const members = groupMembers(makeGroup());
    expect(members).toHaveLength(12);
    expect(members[0].x).toBeCloseTo(0.3);
    expect(members[0].z).toBeCloseTo(0.9);
  });

  it("resizing rows/cols changes count without touching anchor", () => {
    const g = makeGroup({ rows: 6, cols: 6 });
    expect(groupFootprint(g).count).toBe(36);
    expect(g.anchorX).toBe(0);
  });

  it("moves the whole group by re-centering", () => {
    const g = makeGroup();
    const patch = setGroupCenter(g, 5, 5);
    const moved = { ...g, ...patch };
    const c = groupCenter(moved);
    expect(c.x).toBeCloseTo(5);
    expect(c.z).toBeCloseTo(5);
  });

  it("numbers members A-01.. row-first from NW, and respects start corner", () => {
    const g = makeGroup(); // 3 rows x 4 cols
    expect(memberLabel(g, 0, 0)).toBe("A-01");
    expect(memberLabel(g, 0, 3)).toBe("A-04");
    expect(memberLabel(g, 1, 0)).toBe("A-05");
    // Column-first.
    expect(memberLabel({ ...g, numberOrder: "col" }, 1, 0)).toBe("A-02");
    // Start SE reverses both.
    expect(memberLabel({ ...g, numberStart: "se" }, 2, 3)).toBe("A-01");
  });
});
