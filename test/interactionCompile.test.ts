/**
 * The compiler that lets the classroom stop being its own code path.
 *
 * Two things have to hold before the engine is allowed to use it:
 *   1. compiling E310 produces a template that says EXACTLY what the scenario
 *      said — same ids, same numbers, no forks invented, no rng consumed;
 *   2. the list editors keep "the list order is the flow" true, including the
 *      awkward cases (delete the step something points at, duplicate a step
 *      that jumps somewhere).
 */

import { describe, expect, it } from "vitest";
import {
  addStep,
  audienceJoiners,
  blankTemplate,
  duplicateStep,
  moveStep,
  normalizeTemplate,
  removeStep,
  setOptionCount,
  stepAfter,
  templateFromScenario,
} from "../src/core/interactionCompile";
import { buildE310GoldenProject } from "../src/core/quickStart";
import { venuePresetById } from "../src/core/venues";
import type { InteractionTemplate } from "../src/core/model";

function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}
installLocalStorage();

const golden = () => buildE310GoldenProject(venuePresetById("venue:tku-e310")!).scenarios[0];

describe("compiling the E310 scenario says exactly what the scenario said", () => {
  it("keeps every station, verbatim", () => {
    const scenario = golden();
    const t = templateFromScenario(scenario);
    expect(t.stations).toHaveLength(scenario.stations.length);
    for (const s of scenario.stations) {
      const compiled = t.stations.find((x) => x.id === s.id)!;
      expect(compiled).toMatchObject({
        id: s.id, name: s.name, staffCount: s.staffCount,
        parallelServers: s.parallelServers, meanServiceSeconds: s.meanServiceSeconds,
        queueCapacity: s.queueCapacity, x: s.x, z: s.z,
      });
      // No role and no self-service, so the engine keeps today's
      // min(staffCount, parallelServers) rule — including 同桌's staffCount: 0.
      expect(compiled.staffRoleId).toBeUndefined();
      expect(compiled.selfService).toBeUndefined();
    }
  });

  it("keeps the segment ids verbatim — arrivalMix reads them from the playback", () => {
    const t = templateFromScenario(golden());
    expect(t.segments.map((s) => s.id).sort()).toEqual(["pay-on-site", "prepaid"]);
  });

  it("turns each profile branch into a linear chain with no forks", () => {
    const scenario = golden();
    const t = templateFromScenario(scenario);
    for (const step of t.steps) {
      expect(step.branch, `${step.name} grew a fork out of nowhere`).toBeUndefined();
    }
    for (const profile of scenario.profiles) {
      const seg = t.segments.find((s) => s.id === profile.id)!;
      const n = normalizeTemplate(t);
      const walked: string[] = [];
      let step = n.stepById.get(seg.startStepId) ?? null;
      while (step) {
        walked.push(step.stationId!);
        step = stepAfter(step, undefined, n);
      }
      expect(walked).toEqual(profile.branch);
    }
  });

  it("copies serviceVariance rather than converting it", () => {
    const scenario = golden();
    // A converted value would drift; identity is the only safe assertion.
    scenario.stations[3].serviceVariance = 12.34;
    const t = templateFromScenario(scenario);
    const step = t.steps.find((s) => s.stationId === scenario.stations[3].id)!;
    expect(Object.is(step.serviceVariance, 12.34)).toBe(true);
  });

  it("honours a per-profile service time where the scenario has one", () => {
    const scenario = golden();
    const checkin = scenario.stations.find((s) => s.type === "checkin")!;
    checkin.profileServiceSeconds = { "pay-on-site": 99 };
    const t = templateFromScenario(scenario);
    const onsite = t.steps.find((s) => s.id === `pay-on-site__${checkin.id}`)!;
    const prepaid = t.steps.find((s) => s.id === `prepaid__${checkin.id}`)!;
    expect(onsite.avgSeconds).toBe(99);
    expect(prepaid.avgSeconds).toBe(checkin.meanServiceSeconds);
  });

  it("is an invited event: everyone turns up, nobody gives up", () => {
    const scenario = golden();
    const t = templateFromScenario(scenario);
    expect(t.audience).toEqual({
      count: scenario.participantCount,
      windowSeconds: scenario.arrivalWindowSeconds,
      profile: scenario.arrivalProfile,
      stopRate: 1,
      joinRate: 1,
      patienceSeconds: 0,
    });
    const funnel = audienceJoiners(t.audience);
    expect(funnel).toEqual({ passed: 60, stopped: 60, joined: 60 });
  });
});

describe("the funnel is arithmetic, not agents", () => {
  it("600 passers-by with 30% stopping and 70% joining is 126 people", () => {
    expect(audienceJoiners({
      count: 600, windowSeconds: 7200, profile: "uniform",
      stopRate: 0.3, joinRate: 0.7, patienceSeconds: 180,
    })).toEqual({ passed: 600, stopped: 180, joined: 126 });
  });

  it("survives nonsense rates instead of producing NaN", () => {
    const f = audienceJoiners({
      count: 100, windowSeconds: 60, profile: "uniform",
      stopRate: 5, joinRate: -1, patienceSeconds: 0,
    });
    expect(f.stopped).toBe(100);
    expect(f.joined).toBe(0);
  });
});

describe("the list order is the flow", () => {
  const threeSteps = (): InteractionTemplate => {
    let t = blankTemplate("測試");
    t = { ...t, steps: [{ ...t.steps[0], id: "a", name: "A", next: undefined }] };
    t = addStep(t, 1, { id: "b", name: "B", avgSeconds: 10 });
    t = addStep(t, 2, { id: "c", name: "C", avgSeconds: 10, next: null });
    return { ...t, startStepId: "a" };
  };

  it("an undefined next means the next row", () => {
    const n = normalizeTemplate(threeSteps());
    expect(stepAfter(n.stepById.get("a")!, undefined, n)?.id).toBe("b");
    expect(stepAfter(n.stepById.get("b")!, undefined, n)?.id).toBe("c");
    expect(stepAfter(n.stepById.get("c")!, undefined, n)).toBeNull();
  });

  it("swapping two rows genuinely changes the flow", () => {
    const moved = moveStep(threeSteps(), "b", -1);
    expect(moved.steps.map((s) => s.id)).toEqual(["b", "a", "c"]);
    const n = normalizeTemplate(moved);
    expect(stepAfter(n.stepById.get("b")!, undefined, n)?.id).toBe("a");
  });

  it("moving off either end does nothing rather than throwing", () => {
    const t = threeSteps();
    expect(moveStep(t, "a", -1).steps.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(moveStep(t, "c", 1).steps.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("deleting a step closes the gap instead of ending the visit there", () => {
    let t = threeSteps();
    t = { ...t, steps: t.steps.map((s) => (s.id === "a" ? { ...s, next: "b" } : s)) };
    const after = removeStep(t, "b");
    expect(after.steps.map((s) => s.id)).toEqual(["a", "c"]);
    const n = normalizeTemplate(after);
    // A pointed at the deleted step; it must now fall through to the next row.
    expect(n.stepById.get("a")!.next).toBeUndefined();
    expect(stepAfter(n.stepById.get("a")!, undefined, n)?.id).toBe("c");
  });

  it("deleting the first step moves the start rather than orphaning it", () => {
    const after = removeStep(threeSteps(), "a");
    expect(after.startStepId).toBe("b");
  });

  it("a duplicated step takes its own place in the list", () => {
    let t = threeSteps();
    t = { ...t, steps: t.steps.map((s) => (s.id === "a" ? { ...s, next: "c" } : s)) };
    const after = duplicateStep(t, "a");
    expect(after.steps.map((s) => s.name)).toEqual(["A", "A（複製）", "B", "C"]);
    // Inheriting the original's jump would make the copy skip itself.
    expect(after.steps[1].next).toBeUndefined();
  });

  it("resizing a dice keeps the faces already named", () => {
    let t = threeSteps();
    t = setOptionCount(t, "b", 4);
    t = { ...t, steps: t.steps.map((s) => (s.id !== "b" || s.branch?.kind !== "chance" ? s : {
      ...s,
      branch: { ...s.branch, options: s.branch.options.map((o, i) => (i === 0 ? { ...o, label: "人際" } : o)) },
    })) };

    const six = setOptionCount(t, "b", 6);
    const branch = six.steps.find((s) => s.id === "b")!.branch;
    expect(branch?.kind).toBe("chance");
    if (branch?.kind === "chance") {
      expect(branch.options).toHaveLength(6);
      expect(branch.options[0].label).toBe("人際");
      expect(branch.options.every((o) => o.weight === 1)).toBe(true);
    }

    // Shrinking back keeps the first four, still named.
    const four = setOptionCount(six, "b", 4);
    const shrunk = four.steps.find((s) => s.id === "b")!.branch;
    if (shrunk?.kind === "chance") {
      expect(shrunk.options).toHaveLength(4);
      expect(shrunk.options[0].label).toBe("人際");
    }
  });

  it("a step name is whatever the organiser typed — no closed vocabulary", () => {
    const t = addStep(blankTemplate(), 1, { name: "抽一張祝福卡", avgSeconds: 45 });
    expect(t.steps.map((s) => s.name)).toContain("抽一張祝福卡");
  });
});
