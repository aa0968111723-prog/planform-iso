/**
 * What gets printed, and what must never get printed.
 *
 * The 場刊圖 is handed to a volunteer standing behind a table. It has to carry
 * every word they need to say and every thing they need to hand over — and
 * none of the machinery the SIMULATION uses to walk the flow. A step id or an
 * option weight on a briefing sheet is noise at best and a distraction at the
 * moment someone is trying to read the next question out loud.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { flowSheetLines } from "../src/export/constructionPlan";
import { eventFlowAdapter } from "../src/adapters/eventFlow";
import { interactionPreset } from "../src/core/interactionPresets";
import { templateFromScenario } from "../src/core/interactionCompile";
import { runDiscreteEvent, runInteraction } from "../src/core/eventFlow";
import { buildE310GoldenProject } from "../src/core/quickStart";
import { venuePresetById } from "../src/core/venues";
import {
  applyTemplate,
  deleteTemplate,
  listTemplates,
  loadTemplate,
  portableTemplate,
  saveTemplate,
} from "../src/state/templateLibrary";
import { createDefaultProject, type Project } from "../src/core/model";

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

const okBandage = () => interactionPreset("preset:ok-bandage")!;
const planWithFlow = (): Project => ({ ...createDefaultProject(), interaction: okBandage() });

describe("the 場刊 prints the flow a volunteer has to run", () => {
  const text = () => flowSheetLines(planWithFlow()).map((l) => l.text).join("\n");

  it("names every step, in order", () => {
    const lines = flowSheetLines(planWithFlow()).filter((l) => l.kind === "step");
    expect(lines.map((l) => l.text.replace(/^\d+\. /, "").split("（")[0]))
      .toEqual(okBandage().steps.map((s) => s.name));
  });

  it("prints every prompt, because that is the thing being read out loud", () => {
    const printed = text();
    for (const step of okBandage().steps) {
      if (step.prompt) expect(printed, step.name).toContain(step.prompt);
    }
  });

  it("prints the options by name — all four monsters, all sixteen quotes", () => {
    const printed = text();
    const q3 = okBandage().steps.find((s) => s.id === "s_q3")!;
    if (q3.branch?.kind === "chance") {
      for (const option of q3.branch.options) expect(printed).toContain(option.label);
    }
    const pick = okBandage().steps.find((s) => s.id === "s_pick")!;
    if (pick.branch?.kind === "match") {
      for (const rule of pick.branch.rules) {
        expect(printed).toContain(rule.label);
        if (rule.prompt) expect(printed).toContain(rule.prompt);
      }
    }
  });

  it("collects the supplies into one list", () => {
    const printed = text();
    expect(printed).toContain("要帶的東西");
    for (const item of okBandage().steps.flatMap((s) => s.supplies ?? [])) {
      expect(printed).toContain(item);
    }
  });

  it("says how many people, and repeats the honesty note", () => {
    const printed = text();
    expect(printed).toContain("126");
    expect(printed).toContain("估計值");
  });

  it("prints not one id, weight or jump", () => {
    const printed = text();
    for (const step of okBandage().steps) {
      expect(printed, `step id ${step.id} leaked`).not.toContain(step.id);
      if (step.branch?.kind !== "chance") continue;
      for (const option of step.branch.options) {
        expect(printed, `option id ${option.id} leaked`).not.toMatch(new RegExp(`\\b${option.id}\\b`));
      }
    }
    for (const station of okBandage().stations) {
      expect(printed, `station id ${station.id} leaked`).not.toContain(station.id);
    }
    expect(printed).not.toContain("weight");
    expect(printed).not.toContain("next");
  });

  it("prints nothing at all for a plan without a flow", () => {
    expect(flowSheetLines(createDefaultProject())).toEqual([]);
  });
});

describe("my own templates", () => {
  it("saves and lists", () => {
    expect(listTemplates()).toEqual([]);
    const meta = saveTemplate(okBandage(), "期初擺攤 v2");
    expect(listTemplates().map((m) => m.name)).toEqual(["期初擺攤 v2"]);
    expect(meta.stepCount).toBe(9);
    expect(loadTemplate(meta.id)!.steps).toHaveLength(9);
    deleteTemplate(meta.id);
    expect(listTemplates()).toEqual([]);
    expect(loadTemplate(meta.id)).toBeNull();
  });

  it("does not carry one room's coordinates into another", () => {
    const t = okBandage();
    const bound = {
      ...t,
      stations: t.stations.map((st) => ({ ...st, x: 7.5, z: 2.25, objectId: "obj1", zoneId: "zone1" })),
    };
    const portable = portableTemplate(bound, "帶著走");
    for (const st of portable.stations) {
      expect(st.x).toBe(0);
      expect(st.z).toBe(0);
      expect(st.objectId).toBeUndefined();
      expect(st.zoneId).toBeUndefined();
    }
    expect(portable.spatial).toBeUndefined();
  });

  it("lands back on the stations of the plan it is applied to, by name", () => {
    const saved = portableTemplate(okBandage(), "帶著走");
    const onto = okBandage().stations.map((st, i) => ({ ...st, x: i + 1, z: 5, objectId: `obj${i}` }));
    const { template, unplaced } = applyTemplate(saved, { stations: onto, centre: { x: 99, z: 99 } });
    expect(unplaced).toEqual([]);
    expect(template.stations.map((st) => st.x)).toEqual([1, 2, 3]);
    expect(template.stations[0].objectId).toBe("obj0");
  });

  it("says which stations it could not place rather than parking them silently", () => {
    const saved = portableTemplate(okBandage(), "帶著走");
    const { unplaced, template } = applyTemplate(saved, {
      stations: [{ ...okBandage().stations[0], x: 3, z: 3 }],
      centre: { x: 5, z: 4 },
    });
    expect(unplaced).toEqual(["桌前", "發卡處"]);
    // Parked at the centre of the room, not at (0,0) under the wall.
    expect(template.stations[1].x).toBe(5);
    expect(template.stations[1].z).toBe(4);
  });

  it("survives a corrupt index without losing the panel", () => {
    saveTemplate(okBandage(), "好的");
    localStorage.setItem("planform-iso:interaction-templates", "{{{not json");
    expect(listTemplates()).toEqual([]);
  });
});

describe("改成我自己的流程 changes nothing until someone changes something", () => {
  it("the first run after converting is bit-identical to the run before", () => {
    const project = buildE310GoldenProject(venuePresetById("venue:tku-e310")!);
    const scenario = project.scenarios[0];
    const before = runDiscreteEvent(scenario, { sampleDt: 5 });
    // What the button does, exactly.
    const converted = templateFromScenario(scenario);
    const after = runInteraction(converted, { sampleDt: 5 });
    const numbers = (r: typeof before) => ({
      ...r, playback: undefined, scenarioId: undefined,
      stations: r.stations.map((s) => ({ ...s, stationId: undefined })),
    });
    expect(numbers(after)).toEqual(numbers(before));
  });

  it("and the scenario is still there afterwards", () => {
    const project = buildE310GoldenProject(venuePresetById("venue:tku-e310")!);
    const converted: Project = { ...project, interaction: templateFromScenario(project.scenarios[0]) };
    expect(converted.scenarios).toHaveLength(project.scenarios.length);
    expect(converted.scenarios[0]).toEqual(project.scenarios[0]);
  });
});

describe("the AI is told about the plan's own flow, not an invented one", () => {
  it("summarises a booth plan's steps rather than a check-in desk", () => {
    const project = planWithFlow();
    const summary = eventFlowAdapter.getSimulationSummary(project, 60);
    expect(summary.available).toBe(true);
    if (!summary.available) return;
    // 126 joiners out of 600 passers-by — the flow's own funnel, not the 60
    // people the caller asked about.
    expect(summary.participants).toBe(126);
    expect(summary.message).toContain("完成");
  });

  it("still answers for a classroom plan the old way", () => {
    const project = buildE310GoldenProject(venuePresetById("venue:tku-e310")!);
    const summary = eventFlowAdapter.getSimulationSummary(project, 60);
    expect(summary.available).toBe(true);
    if (!summary.available) return;
    expect(summary.participants).toBe(60);
  });
});
