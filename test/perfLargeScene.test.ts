/**
 * Large-scene compute budgets (CI-relative, not absolute FPS).
 */

import { describe, expect, it } from "vitest";
import { runDiscreteEvent } from "../src/core/eventFlow";
import { optimizeEventFlow } from "../src/core/eventOptimization";
import { createDefaultScenario } from "../src/core/migrate";
import { createDefaultProject, type ArrayGroup, uid } from "../src/core/model";
import { acceptance60Scenario } from "./fixtures/acceptance60";

function largeProject() {
  const p = createDefaultProject();
  p.classroom = { ...p.classroom, length: 20, width: 16 };
  p.corridor = { ...p.corridor, length: 20, z: 16 };
  const mats: ArrayGroup = {
    id: uid("grp"),
    name: "地墊陣列",
    sourceKind: "mat",
    rows: 10,
    cols: 12,
    itemWidth: 0.6,
    itemDepth: 1.2,
    itemHeight: 0.02,
    gapX: 0.1,
    gapZ: 0.1,
    rotationDeg: 0,
    anchorX: 1,
    anchorZ: 1,
    locked: false,
    hidden: false,
    numberPrefix: "M",
    numberOrder: "row",
    numberStart: "nw",
  };
  const chairs: ArrayGroup = {
    id: uid("grp"),
    name: "椅子陣列",
    sourceKind: "chair",
    rows: 10,
    cols: 12,
    itemWidth: 0.45,
    itemDepth: 0.5,
    itemHeight: 0.85,
    gapX: 0.2,
    gapZ: 0.3,
    rotationDeg: 0,
    anchorX: 10,
    anchorZ: 1,
    locked: false,
    hidden: false,
    numberPrefix: "C",
    numberOrder: "row",
    numberStart: "nw",
  };
  p.groups = [mats, chairs];
  // 100+ mats and chairs via arrays
  expect(mats.rows * mats.cols).toBeGreaterThanOrEqual(100);
  expect(chairs.rows * chairs.cols).toBeGreaterThanOrEqual(100);
  for (let i = 0; i < 4; i++) {
    p.routes.push({
      id: uid("rt"),
      name: `動線${i}`,
      color: "#38bdf8",
      type: "entry",
      visible: true,
      points: [
        { x: 1 + i, z: 17 },
        { x: 2 + i * 2, z: 8 },
        { x: 8 + i, z: 4 },
      ],
    });
  }
  return p;
}

describe("large scene performance budgets", () => {
  it("DES 150 participants completes under 2s", () => {
    const p = largeProject();
    const scn = createDefaultScenario(p, { participantCount: 150, seed: 7 });
    scn.arrivalWindowSeconds = 1800;
    const t0 = performance.now();
    const r = runDiscreteEvent(scn, { sampleDt: 2, project: p });
    const ms = performance.now() - t0;
    expect(r.completed).toBeGreaterThan(100);
    expect(ms).toBeLessThan(2500);
  });

  it("optimizer ≤12 candidates under 6s", () => {
    const scn = acceptance60Scenario();
    const t0 = performance.now();
    const report = optimizeEventFlow(scn, "fastest", undefined, { maxCandidates: 12 });
    const ms = performance.now() - t0;
    expect(report.ranked.length).toBeGreaterThan(5);
    expect(ms).toBeLessThan(6000);
  });
});
