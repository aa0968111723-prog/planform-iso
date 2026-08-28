/**
 * 夥伴模式 describes the plan in front of it.
 *
 * A booth plan has no `scenario`, so the briefing fell through to a branch that
 * infers a CLASSROOM journey from zone types. On the club's own booth plan the
 * brief bar read 「入口 → 引導 → 報到」 while the plan's nine steps —
 * 歡迎打招呼 → Q1 真心話檢測 → … → 領 OK 蹦小卡 — appeared nowhere. A 夥伴 was
 * briefed on a check-in desk that does not exist in the plan they were holding.
 *
 * Pressing 演練一次 then made it permanent: the rehearsal ran
 * `ensureEventScenario`, which WRITES the invented classroom scenario into the
 * project. From that tap on, the plan carried a 進場流程 it never had.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { buildRoleBriefing } from "../src/core/partner";
import { migrateProject } from "../src/core/migrate";
import { boothVenuePreset, createProjectFromVenuePreset, venuePresetById } from "../src/core/venues";
import { buildE310GoldenProject } from "../src/core/quickStart";
import type { Project } from "../src/core/model";

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

const boothPlan = (): Project =>
  migrateProject(JSON.parse(JSON.stringify(createProjectFromVenuePreset(boothVenuePreset()))) as Partial<Project>);

describe("the brief for a booth plan describes the booth", () => {
  it("names the flow's own stations, in the flow's own order", () => {
    const project = boothPlan();
    const brief = buildRoleBriefing(project, "all", null);
    const stations = project.interaction!.stations.map((s) => s.name);
    expect(brief.flowSummary).toBe(stations.join(" → "));
    expect(brief.steps.map((s) => s.text).join(" ")).toContain(stations[0]);
  });

  it("invents no check-in desk, no 引導, no 入口", () => {
    const brief = buildRoleBriefing(boothPlan(), "all", null);
    for (const fabricated of ["報到", "引導", "入口"]) {
      expect(brief.flowSummary, `the booth has no ${fabricated}`).not.toContain(fabricated);
    }
  });

  it("a station visited by several steps in a row is one stop, not five", () => {
    const project = boothPlan();
    const brief = buildRoleBriefing(project, "all", null);
    // Five of the nine steps happen 桌前; a volunteer is told about one table.
    expect(brief.steps).toHaveLength(project.interaction!.stations.length);
    expect(new Set((brief.flowSummary ?? "").split(" → ")).size).toBe(brief.steps.length);
  });
});

describe("the classroom brief is unchanged", () => {
  it("still reads its scenario, in journey order", () => {
    const project = buildE310GoldenProject(venuePresetById("venue:tku-e310")!);
    const brief = buildRoleBriefing(project, "all", project.scenarios[0]);
    expect(brief.flowSummary).toContain("報到");
    expect(brief.flowSummary).toContain("巧拼座區");
    expect(brief.steps.length).toBe(project.scenarios[0].stations.length);
  });

  it("a classroom plan that also grew a step list uses the step list", () => {
    // Converting with 「改成我自己的流程」 is the user saying this flow is now
    // the truth; the brief has to follow them there.
    const project = buildE310GoldenProject(venuePresetById("venue:tku-e310")!);
    const withFlow: Project = { ...project, interaction: boothPlan().interaction };
    const brief = buildRoleBriefing(withFlow, "all", project.scenarios[0]);
    expect(brief.flowSummary).toContain("桌前");
    expect(brief.flowSummary).not.toContain("報到");
  });
});
