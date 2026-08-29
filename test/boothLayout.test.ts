import { describe, expect, it } from "vitest";
import { areaBounds, obbGap } from "../src/core/placement";
import { buildScheme, compareSchemes, generateLayoutSchemes, RECOMMENDED_SCHEME } from "../src/core/spatialPlanner";
import { createDefaultProject, type Project } from "../src/core/model";

/**
 * A stall is not a small room. These pin the two things that make it different:
 * the queue must stay inside the module, and nothing is "seated".
 */

/** A 3 × 3 stall with the aisle on its south side. */
function stall(): Project {
  const p = createDefaultProject();
  p.classroom = { ...p.classroom, x: 0, z: 0, length: 3, width: 3 };
  p.corridor = { ...p.corridor, x: 0, z: 3, length: 3, width: 2 };
  return p;
}

const brief = { participants: 40, eventType: "booth" as const, staffCount: 2 };

/** BASE_WEIGHTS waiting (0.25) + circulation (0.15) before any redistribution. */
const BASE_WAITING_PLUS_CIRCULATION = 0.4;

describe("booth schemes", () => {
  it("produces three named stall strategies, not classroom ones", () => {
    const r = generateLayoutSchemes(stall(), brief);
    expect(r.schemes.map((s) => s.name)).toEqual(["A 正面開放", "B 側面入口", "C 體驗優先"]);
  });

  it("uses the real booth catalogue and carries it with the scheme", () => {
    const r = generateLayoutSchemes(stall(), brief);
    for (const s of r.schemes) {
      expect(s.objects.some((o) => o.assetId === "custom:booth-tent"), s.id).toBe(true);
      expect(s.objects.some((o) => o.assetId === "custom:booth-table"), s.id).toBe(true);
      // Without the catalogue travelling with it, every asset id resolves to a
      // grey box of the wrong size in a project that has never seen a booth.
      expect(s.catalogExtras?.some((e) => e.id === "custom:booth-tent"), s.id).toBe(true);
    }
  });

  it("seats nobody — a stall has no mat field", () => {
    const r = generateLayoutSchemes(stall(), brief);
    for (const s of r.schemes) expect(s.groups, s.id).toEqual([]);
  });

  it("every scheme validates clean", () => {
    // The first cut had stools overlapping the table in two schemes and a
    // staff zone hanging outside the stall. The validator caught all three.
    const r = generateLayoutSchemes(stall(), brief);
    for (const s of r.schemes) {
      expect(s.validation.errors, s.id).toBe(0);
      const real = s.validation.issues.filter((i) => i.severity !== "info");
      expect(real.map((i) => `${i.code}: ${i.message}`), s.id).toEqual([]);
    }
  });

  it("keeps every object inside the stall footprint", () => {
    const room = stall();
    const b = areaBounds(room.classroom);
    const r = generateLayoutSchemes(room, brief);
    for (const s of r.schemes) {
      for (const o of s.objects) {
        expect(o.x - o.width / 2, `${s.id} ${o.assetId}`).toBeGreaterThanOrEqual(b.minX - 1e-6);
        expect(o.x + o.width / 2, `${s.id} ${o.assetId}`).toBeLessThanOrEqual(b.maxX + 1e-6);
      }
    }
  });

  it("staff furniture never overlaps the table", () => {
    const r = generateLayoutSchemes(stall(), brief);
    for (const s of r.schemes) {
      const table = s.objects.find((o) => o.assetId === "custom:booth-table")!;
      const tRect = { cx: table.x, cz: table.z, w: table.width, d: table.depth, rot: table.rotationDeg };
      for (const stool of s.objects.filter((o) => o.assetId === "custom:red-stool")) {
        const sRect = { cx: stool.x, cz: stool.z, w: stool.width, d: stool.depth, rot: stool.rotationDeg };
        expect(obbGap(tRect, sRect), `${s.id} 椅子與桌子重疊`).toBeGreaterThan(0);
      }
    }
  });
});

describe("the queue stays inside the stall", () => {
  it("B and C put a queue zone inside the module, per booth-entry-clear", () => {
    // The research finding this encodes: a line that spills into the main aisle
    // blocks its own visitors and everyone else's.
    const room = stall();
    const b = areaBounds(room.classroom);
    const r = generateLayoutSchemes(room, brief);
    for (const id of ["scheme-b", "scheme-c"]) {
      const s = r.schemes.find((x) => x.id === id)!;
      const queue = s.zones.find((z) => z.name.includes("排隊"));
      expect(queue, `${id} 沒有排隊區`).toBeTruthy();
      expect(queue!.x - queue!.width / 2, id).toBeGreaterThanOrEqual(b.minX - 1e-6);
      expect(queue!.x + queue!.width / 2, id).toBeLessThanOrEqual(b.maxX + 1e-6);
      expect(queue!.z - queue!.depth / 2, id).toBeGreaterThanOrEqual(b.minZ - 1e-6);
      expect(queue!.z + queue!.depth / 2, id).toBeLessThanOrEqual(b.maxZ + 1e-6);
    }
  });

  it("A states the cost of its frontage instead of hiding it", () => {
    // The front-open layout genuinely does push its queue into the aisle. That
    // is a legitimate trade, but it has to be said, not discovered on the day.
    const r = generateLayoutSchemes(stall(), brief);
    const a = r.schemes.find((s) => s.id === "scheme-a")!;
    expect(a.risks.join(" ")).toContain("主通道");
  });

  it("cites the booth research on every scheme", () => {
    const r = generateLayoutSchemes(stall(), brief);
    for (const s of r.schemes) {
      expect(s.knowledgeRefs, s.id).toContain("booth-entry-clear");
    }
  });
});

describe("「不能阻擋主要通道」 is a constraint, not a preference", () => {
  it("disqualifies the front-open layout, whatever it scores", () => {
    const r = generateLayoutSchemes(stall(), { ...brief, objectives: ["keep-aisle-clear"] });
    const a = r.schemes.find((s) => s.id === "scheme-a")!;
    expect(a.eligible).toBe(false);
    expect(a.ineligibleReason).toContain("通道");
    expect(r.recommendedId).not.toBe("scheme-a");
  });

  it("still lists it, with the reason, so the user can see the trade", () => {
    const r = generateLayoutSchemes(stall(), { ...brief, objectives: ["keep-aisle-clear"] });
    expect(r.schemes.length).toBe(3);
    const rows = compareSchemes(r);
    expect(rows.find((x) => x.id === "scheme-a")!.ineligibleReason).toBeTruthy();
  });

  it("leaves all three eligible when the brief never said it", () => {
    const r = generateLayoutSchemes(stall(), brief);
    expect(r.schemes.every((s) => s.eligible)).toBe(true);
  });
});

describe("a stall is measured as standing room, not seats", () => {
  it("reports simultaneous standing capacity, not zero", () => {
    const r = generateLayoutSchemes(stall(), brief);
    for (const s of r.schemes) {
      expect(s.estimatedCapacity, s.id).toBeGreaterThan(0);
      // A 3 × 3 stall does not hold thirty people.
      expect(s.estimatedCapacity, s.id).toBeLessThan(20);
    }
  });

  it("says 可同時容納, not 可坐", () => {
    const r = generateLayoutSchemes(stall(), brief);
    expect(r.recommendation).toContain("可同時容納");
    expect(r.recommendation).not.toContain("可坐");
  });

  it("does not warn that a stall cannot seat everyone who visits", () => {
    // 40 visitors over an afternoon vs 6 standing at once is not a shortfall.
    const r = generateLayoutSchemes(stall(), brief);
    for (const s of r.schemes) {
      expect(s.risks.join(" "), s.id).not.toContain("估算只能坐");
    }
  });

  it("drops the capacity weight rather than scoring a category error", () => {
    const r = generateLayoutSchemes(stall(), brief);
    const w = r.schemes[0].score.weights;
    expect(w.capacity).toBe(0);
    // The weight goes to what actually decides a stall.
    expect(w.waiting + w.circulation).toBeGreaterThan(BASE_WAITING_PLUS_CIRCULATION);
    expect(w.capacity + w.waiting + w.validation + w.circulation + w.staffing).toBeCloseTo(1, 6);
  });
});

describe("applying a booth scheme", () => {
  it("brings its catalogue into the draft so the assets resolve", () => {
    const base = stall();
    const built = buildScheme(base, RECOMMENDED_SCHEME, brief)!;
    const draft = structuredClone(base);
    built.apply(draft);
    expect(draft.objects.some((o) => o.assetId === "custom:booth-tent")).toBe(true);
    expect((draft.catalogExtras ?? []).some((e) => e.id === "custom:booth-tent")).toBe(true);
  });

  it("comparison rows work the same as for a room", () => {
    const rows = compareSchemes(generateLayoutSchemes(stall(), brief));
    expect(rows.length).toBe(3);
    for (const row of rows) expect(row.score).toBeGreaterThan(0);
  });
});

describe("a room is still planned as a room", () => {
  it("a classroom brief keeps the classroom strategies and its seats", () => {
    const room = createDefaultProject();
    room.classroom = { ...room.classroom, length: 12, width: 9 };
    const r = generateLayoutSchemes(room, { participants: 40, eventType: "tea-gathering", staffCount: 4 });
    expect(r.schemes.map((s) => s.name)).toEqual(["A 集中服務", "B 報到收費分流", "C 走道優先"]);
    expect(r.schemes[0].groups.length).toBeGreaterThan(0);
    expect(r.schemes[0].score.weights.capacity).toBeGreaterThan(0);
  });
});
