import { describe, expect, it } from "vitest";
import { createDefaultProject, OBJECT_DEFAULTS } from "../src/core/model";
import { buildSummary, legendEntries } from "../src/core/summary";

function makeMat(id: string) {
  return {
    id,
    kind: "mat" as const,
    x: 0,
    z: 0,
    rotationDeg: 0,
    width: OBJECT_DEFAULTS.mat.width,
    depth: OBJECT_DEFAULTS.mat.depth,
    height: OBJECT_DEFAULTS.mat.height,
    locked: false,
    hidden: false,
  };
}

describe("plan summary", () => {
  it("describes room size and tile size in plain language", () => {
    const p = createDefaultProject();
    const s = buildSummary(p);
    expect(s.title).toBe(p.name);
    expect(s.lines.join("\n")).toContain("教室：10 × 8 公尺");
    expect(s.lines.join("\n")).toContain("地磚：60 × 60 公分");
  });

  it("counts mats and lists zones and routes", () => {
    const p = createDefaultProject();
    p.objects.push(makeMat("m1"), makeMat("m2"), makeMat("m3"));
    p.zones.push({
      id: "z1", type: "group", name: "小組區", x: 0, z: 0, width: 3, depth: 3,
      color: "#a78bfa", locked: false, hidden: false,
    });
    p.routes.push({ id: "r1", name: "報到動線", color: "#f97316", points: [], visible: true });
    const s = buildSummary(p);
    const mat = s.objectCounts.find((o) => o.label === OBJECT_DEFAULTS.mat.label);
    expect(mat?.count).toBe(3);
    expect(s.zoneNames).toContain("小組區");
    expect(s.routeNames).toContain("報到動線");
    expect(s.lines.join("\n")).toContain("地墊：共 3 張");
  });
});

describe("legend", () => {
  it("includes both zone and object entries with colors", () => {
    const entries = legendEntries();
    expect(entries.some((e) => e.kind === "zone")).toBe(true);
    expect(entries.some((e) => e.kind === "object")).toBe(true);
    expect(entries.every((e) => /^#/.test(e.color))).toBe(true);
  });
});
