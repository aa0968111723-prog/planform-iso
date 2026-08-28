/**
 * The control the panel offers has to move the answer.
 *
 * The tool named 走廊入口 as the worst spot on the shipped E310 example and
 * then offered no lever that touched it. 「同時幾人」 wrote `parallelServers`,
 * but `effectiveServers` takes `min(staffCount, parallelServers)` — so raising
 * the positions from 1 to 4 opened exactly one, and the run came back
 * identical to the last decimal (finish 1558.6938194279483, both times).
 *
 * A rehearsal that hands somebody a named culprit and an inert control has
 * stopped answering the question they opened it to ask.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { runInteraction } from "../src/core/eventFlow";
import { setStationPositions, templateFromScenario } from "../src/core/interactionCompile";
import { interactionPreset } from "../src/core/interactionPresets";
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
beforeEach(() => installLocalStorage());
installLocalStorage();

const golden = (): InteractionTemplate =>
  templateFromScenario(buildE310GoldenProject(venuePresetById("venue:tku-e310")!).scenarios[0]);

/** The panel's 「同時幾人」 field, calling the same function the app calls. */
function setPositions(t: InteractionTemplate, name: string, positions: number): InteractionTemplate {
  return setStationPositions(t, t.stations.find((s) => s.name === name)!.id, positions);
}

const rowFor = (t: InteractionTemplate, name: string) => {
  const result = runInteraction(t, { sampleDt: 5 });
  const station = t.stations.find((s) => s.name === name)!;
  return {
    ...result.stations.find((s) => s.stationId === station.id)!,
    finish: result.finishTimeSeconds,
  };
};

describe("「同時幾人」 opens service positions", () => {
  it("moves the corridor entry the tool itself named as the bottleneck", () => {
    const base = golden();
    const before = rowFor(base, "走廊入口");
    const after = rowFor(setPositions(base, "走廊入口", 4), "走廊入口");

    expect(before.servers).toBe(1);
    expect(after.servers).toBe(4);
    expect(after.maxQueue).toBeLessThan(before.maxQueue);
    expect(after.avgWaitSeconds).toBeLessThan(before.avgWaitSeconds);
  });

  it("does not silently restaff a station a role is responsible for", () => {
    const base = golden();
    const withRole: InteractionTemplate = {
      ...base,
      staff: [{ id: "greeter", name: "招呼", count: 2 }],
      stations: base.stations.map((st) => (st.name === "走廊入口" ? { ...st, staffRoleId: "greeter" } : st)),
    };
    const bumped = setPositions(withRole, "走廊入口", 4);
    const station = bumped.stations.find((s) => s.name === "走廊入口")!;
    // The role owns the headcount — that is what declaring a role means. The
    // positions say how many can be open at once; the people say how many are.
    expect(station.parallelServers).toBe(4);
    expect(station.staffCount).toBe(1);
    expect(rowFor(bumped, "走廊入口").servers).toBe(2);
  });

  it("leaves a self-service step alone", () => {
    const base = golden();
    const selfServe: InteractionTemplate = {
      ...base,
      stations: base.stations.map((st) => (st.name === "鞋子" ? { ...st, selfService: true } : st)),
    };
    const bumped = setPositions(selfServe, "鞋子", 6);
    const station = bumped.stations.find((s) => s.name === "鞋子")!;
    expect(station.parallelServers).toBe(6);
    // Nobody is staffing it, so no headcount is implied by the positions.
    expect(station.staffCount).toBe(base.stations.find((s) => s.name === "鞋子")!.staffCount);
    expect(rowFor(bumped, "鞋子").servers).toBe(6);
  });
});

describe("人力讀數 says how hard each role worked, in words", () => {
  const okBandage = () => interactionPreset("preset:ok-bandage")!;

  it("names every role, and says something a person can act on", () => {
    const r = runInteraction(okBandage(), { sampleDt: 30 });
    expect(r.staffLoad, "the panel reads this line; the engine must write it").toBeDefined();
    expect(r.staffLoad!.map((l) => l.roleName)).toEqual(["招呼", "主持", "發卡"]);
    for (const line of r.staffLoad!) {
      expect(line.phrase).toContain(line.roleName);
      expect(line.busyFraction).toBeGreaterThanOrEqual(0);
      expect(line.busyFraction).toBeLessThanOrEqual(1);
    }
  });

  it("the two hosts at the table are the ones who never stop", () => {
    const r = runInteraction(okBandage(), { sampleDt: 30 });
    const host = r.staffLoad!.find((l) => l.roleName === "主持")!;
    const greeter = r.staffLoad!.find((l) => l.roleName === "招呼")!;
    // Five of the nine steps happen 桌前, so this is the constraint of the
    // whole activity — and the readout has to be the thing that says so.
    expect(host.busyFraction).toBeGreaterThan(greeter.busyFraction);
    expect(host.phrase).toContain("幾乎沒停過");
    expect(host.stationNames).toEqual(["桌前"]);
  });

  it("a role with nobody in it is called out, not averaged away", () => {
    const t = okBandage();
    const unstaffed = { ...t, staff: t.staff.map((r) => (r.id === "host" ? { ...r, count: 0 } : r)) };
    const r = runInteraction(unstaffed, { sampleDt: 30 });
    const host = r.staffLoad!.find((l) => l.roleId === "host")!;
    expect(host.shortage).toBe(true);
    expect(host.phrase).toContain("卡住");
    // And it really does stop the activity, rather than just reading badly.
    expect(r.completed).toBe(0);
  });

  it("a classroom, which declares no roles, reports no staff line at all", () => {
    expect(runInteraction(golden(), { sampleDt: 5 }).staffLoad).toBeUndefined();
  });
});
