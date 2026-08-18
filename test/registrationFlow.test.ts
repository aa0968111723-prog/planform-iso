import { describe, expect, it } from "vitest";
import {
  applyLayoutCandidate,
  compareLayoutCandidates,
  normalizeWizardInput,
  buildScenarioFromWizard,
} from "../src/core/registrationFlow";
import { createDefaultProject } from "../src/core/model";
import { acceptance60Project } from "./fixtures/acceptance60";

describe("Registration Flow Wizard", () => {
  it("normalizes prepaid/onsite counts to participant total", () => {
    const input = normalizeWizardInput({
      participantCount: 60,
      prepaidCount: 40,
      onsitePaymentCount: 20,
      arrivalWindowMinutes: 20,
      checkinStaff: 2,
      paymentStaff: 1,
    });
    expect(input.prepaidCount + input.onsitePaymentCount).toBe(60);
  });

  it("builds real stations and routes from wizard input", () => {
    const project = createDefaultProject();
    const input = normalizeWizardInput({
      participantCount: 60,
      prepaidCount: 40,
      onsitePaymentCount: 20,
      arrivalWindowMinutes: 20,
      checkinStaff: 2,
      paymentStaff: 1,
      template: "full-flow",
    });
    const { project: patched, scenario } = buildScenarioFromWizard(project, input);
    expect(scenario.stations.some((s) => s.type === "checkin")).toBe(true);
    expect(scenario.stations.some((s) => s.type === "payment")).toBe(true);
    expect(scenario.stations.some((s) => s.type === "shoe")).toBe(true);
    expect(patched.objects.some((o) => o.serviceRole === "checkin")).toBe(true);
    expect(patched.routes.some((r) => r.points.length >= 2)).toBe(true);
  });

  it("compares A/B/C layout candidates with simulation metrics", () => {
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
    expect(results.length).toBeGreaterThanOrEqual(3);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("combined");
    expect(ids).toContain("separated");
    expect(ids).toContain("entrance-split");
    for (const r of results) {
      expect(r.result.participantCount).toBe(60);
      expect(r.result.finishTimeSeconds).toBeGreaterThan(0);
      expect(typeof r.result.maxQueue).toBe("number");
      expect(typeof r.result.avgWaitSeconds).toBe("number");
      expect(r.scenario.stations.length).toBeGreaterThan(3);
    }
    // Candidates should not all be identical
    const finishes = new Set(results.map((r) => Math.round(r.result.finishTimeSeconds)));
    expect(finishes.size).toBeGreaterThanOrEqual(1);
  });

  it("applyLayoutCandidate writes scenario into project clone", () => {
    const project = acceptance60Project();
    const input = normalizeWizardInput({
      participantCount: 60,
      prepaidCount: 40,
      onsitePaymentCount: 20,
      checkinStaff: 2,
      paymentStaff: 1,
    });
    const [first] = compareLayoutCandidates(project, input);
    const applied = applyLayoutCandidate(project, first);
    expect(applied.activeScenarioId).toBe(first.scenario.id);
    expect(applied.scenarios[0].id).toBe(first.scenario.id);
    expect(project.activeScenarioId).not.toBe(first.scenario.id);
  });
});
