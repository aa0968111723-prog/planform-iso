/**
 * Full acceptance: 60 people, A/B/C compare, optimizer, staff what-if staged.
 */

import { describe, expect, it } from "vitest";
import { Store } from "../src/state/store";
import { MockProvider } from "../src/agent/provider";
import { QuickAgent } from "../src/agent/quickAgent";
import { runDiscreteEvent } from "../src/core/eventFlow";
import { optimizeEventFlow } from "../src/core/eventOptimization";
import {
  compareLayoutCandidates,
  normalizeWizardInput,
} from "../src/core/registrationFlow";
import { acceptance60Project, acceptance60Scenario } from "./fixtures/acceptance60";

describe("acceptance 60-person registration flow", () => {
  it("compares A/B/C with playable metrics", () => {
    const project = acceptance60Project();
    const input = normalizeWizardInput({
      participantCount: 60,
      prepaidCount: 40,
      onsitePaymentCount: 20,
      arrivalWindowMinutes: 20,
      checkinStaff: 2,
      paymentStaff: 1,
    });
    const results = compareLayoutCandidates(project, input);
    expect(results.map((r) => r.id)).toEqual(
      expect.arrayContaining(["combined", "separated", "entrance-split"]),
    );
    for (const r of results) {
      expect(r.result.completed).toBeGreaterThan(40);
      expect(r.result.playback.length).toBeGreaterThan(10);
      expect(r.result.maxQueue).toBeGreaterThanOrEqual(0);
      expect(r.result.avgWaitSeconds).toBeGreaterThanOrEqual(0);
      expect(r.result.finishTimeSeconds).toBeGreaterThan(0);
      expect(r.result.staffUsed).toBeGreaterThan(0);
      // Queue markers should sometimes spread (not all identical when queued)
      const busy = r.result.playback.find((f) =>
        Object.values(f.queues).some((q) => q >= 2),
      );
      if (busy) {
        const queued = busy.agents.filter((a) => a.state === "queued");
        if (queued.length >= 2) {
          const xs = new Set(queued.map((a) => a.x.toFixed(2)));
          const zs = new Set(queued.map((a) => a.z.toFixed(2)));
          expect(xs.size + zs.size).toBeGreaterThan(2);
        }
      }
    }
  });

  it("optimizer finds quantified improvement on stressed layout", () => {
    const project = acceptance60Project();
    const scn = acceptance60Scenario(project);
    const stressed = {
      ...scn,
      stations: scn.stations.map((s) =>
        s.type === "checkin" || s.type === "payment"
          ? { ...s, staffCount: 1, parallelServers: 1, meanServiceSeconds: s.meanServiceSeconds + 15 }
          : s,
      ),
    };
    const report = optimizeEventFlow(stressed, "fastest", project);
    expect(report.improved).toBeTruthy();
    expect(report.deltas.length).toBeGreaterThanOrEqual(3);
    expect(report.deltas.every((d) => /\d/.test(d.display) && d.display.includes("→"))).toBe(true);
    expect(report.improved!.result.finishTimeSeconds).toBeLessThanOrEqual(
      report.baseline.result.finishTimeSeconds + 1,
    );
  });

  it("agent staff what-if is staged only", async () => {
    const project = acceptance60Project();
    project.scenarios = [acceptance60Scenario(project)];
    project.activeScenarioId = project.scenarios[0].id;
    const store = new Store(project);
    const liveStations = structuredClone(store.getState().scenarios[0].stations);
    const agent = new QuickAgent(store, new MockProvider());
    const result = await agent.run({ text: "少一個工作人員會怎樣？" });
    expect(result.previewActive).toBe(true);
    expect(store.getState().scenarios[0].stations).toEqual(liveStations);
    expect(result.toolResults.some((t) => t.tool === "assignStaff" && t.ok)).toBe(true);
    expect(result.toolResults.some((t) => t.tool === "simulateScenario" && t.ok)).toBe(true);
    agent.rollback();
    expect(store.getState().scenarios[0].stations).toEqual(liveStations);
  });

  it("moving desks changes simulation outcomes", () => {
    const project = acceptance60Project();
    const scn = acceptance60Scenario(project);
    const near = runDiscreteEvent(scn, { project, sampleDt: 2, syncLayout: false });
    const farStations = scn.stations.map((s) =>
      s.type === "checkin" || s.type === "payment" || s.type === "seating"
        ? { ...s, x: s.x + 18, z: s.z + 8 }
        : s,
    );
    const far = runDiscreteEvent(
      { ...scn, stations: farStations },
      { sampleDt: 2, syncLayout: false },
    );
    expect(far.avgJourneySeconds).toBeGreaterThan(near.avgJourneySeconds);
    expect(far.finishTimeSeconds).toBeGreaterThan(near.finishTimeSeconds);
  });
});
