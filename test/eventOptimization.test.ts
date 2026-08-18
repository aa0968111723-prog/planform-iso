import { describe, expect, it } from "vitest";
import {
  generateLayoutCandidates,
  objectiveLabel,
  optimizeEventFlow,
  whatIfFewerStaff,
} from "../src/core/eventOptimization";
import { runDiscreteEvent } from "../src/core/eventFlow";
import { acceptance60Project, acceptance60Scenario } from "./fixtures/acceptance60";

describe("EventOptimizationEngine", () => {
  it("generates multiple layout candidates deterministically", () => {
    const scn = acceptance60Scenario();
    const a = generateLayoutCandidates(scn);
    const b = generateLayoutCandidates(scn);
    expect(a.length).toBeGreaterThanOrEqual(6);
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
  });

  it("finds a quantified improvement for 60-person fixture", () => {
    const project = acceptance60Project();
    const scn = acceptance60Scenario(project);
    // Stress baseline: combined slow desk tends to be worse.
    const stressed = {
      ...scn,
      stations: scn.stations.map((s) => {
        if (s.type === "checkin") {
          return { ...s, staffCount: 1, parallelServers: 1, meanServiceSeconds: 50 };
        }
        if (s.type === "payment") {
          return { ...s, staffCount: 1, parallelServers: 1, meanServiceSeconds: 55 };
        }
        return s;
      }),
    };
    const report = optimizeEventFlow(stressed, "fastest", project);
    expect(report.ranked.length).toBeGreaterThan(3);
    expect(report.baseline).toBeTruthy();
    // Should usually find something better than single-server stress baseline.
    expect(report.improved).toBeTruthy();
    expect(report.deltas.length).toBeGreaterThanOrEqual(3);
    expect(report.deltas.every((d) => d.display.includes("→"))).toBe(true);
    expect(report.summary.length).toBeGreaterThan(8);
    expect(objectiveLabel("fastest")).toContain("最快");
  });

  it("what-if fewer staff worsens or changes metrics without mutating base", () => {
    const scn = acceptance60Scenario();
    const before = runDiscreteEvent(scn);
    const reduced = whatIfFewerStaff(scn, 1);
    const after = runDiscreteEvent(reduced);
    expect(reduced.stations).not.toBe(scn.stations);
    expect(after.staffUsed).toBeLessThanOrEqual(before.staffUsed);
    // Original unchanged
    expect(scn.stations.find((s) => s.type === "checkin")!.staffCount).toBe(2);
  });

  it("least-staff objective prefers fewer servers when finish still acceptable", () => {
    const project = acceptance60Project();
    const scn = acceptance60Scenario(project);
    const report = optimizeEventFlow(scn, "least-staff", project, { maxCandidates: 10 });
    expect(report.ranked[0].score).toBeLessThanOrEqual(report.baseline.score + 1e-6);
  });
});
