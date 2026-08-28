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
