import { describe, expect, it } from "vitest";
import { createDefaultProject, planHasContent } from "../src/core/model";
import { createDefaultScenario } from "../src/core/migrate";

/**
 * `planHasContent` guards the two "this will replace what you have" confirms
 * (載入平面圖 / 匯入 JSON). The old inline check looked at objects, zones,
 * groups and routes only, so the two kinds of work that exist *before* any
 * furniture is placed — a measured-up room, and saved simulation scenarios —
 * were replaced without asking.
 */
describe("planHasContent", () => {
  it("treats a brand new project as empty", () => {
    expect(planHasContent(createDefaultProject())).toBe(false);
  });

  it("counts measurements — a measured-up room is real work", () => {
    const p = createDefaultProject();
    p.measurements.push({
      id: "m1",
      type: "free-distance",
      start: { x: 0, z: 0 },
      end: { x: 3, z: 0 },
      locked: false,
      visible: true,
      color: "#38bdf8",
    });
    expect(planHasContent(p)).toBe(true);
  });

  it("counts scenarios", () => {
    const p = createDefaultProject();
    p.scenarios.push(createDefaultScenario(p));
    expect(planHasContent(p)).toBe(true);
  });

  it("still counts the four it always counted", () => {
    for (const fill of [
      (p: ReturnType<typeof createDefaultProject>) => p.zones.push({
        id: "z", type: "registration", name: "報到", x: 1, z: 1, width: 2, depth: 1,
        color: "#fff", locked: false, hidden: false, icon: "", capacity: null,
      }),
      (p: ReturnType<typeof createDefaultProject>) => p.objects.push({
        id: "o", kind: "chair", x: 1, z: 1, rotationDeg: 0, locked: false, hidden: false,
      } as never),
      (p: ReturnType<typeof createDefaultProject>) => p.groups.push({ id: "g" } as never),
      (p: ReturnType<typeof createDefaultProject>) => p.routes.push({ id: "r" } as never),
    ]) {
      const p = createDefaultProject();
      fill(p);
      expect(planHasContent(p)).toBe(true);
    }
  });
});
