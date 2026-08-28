/**
 * The gatekeeper for the interaction-flow refactor.
 *
 * The classroom simulation is about to stop being its own code path and start
 * being one shape of a generic interaction flow. The whole claim of that
 * refactor is "the E310 numbers do not move" — and a claim like that is worth
 * nothing until it is a file on disk that a diff can disagree with.
 *
 * So this lands FIRST, before anything can break it: four representative runs,
 * frozen. Any change that shifts a single wait, a single queue peak or a single
 * RNG draw shows up here as a diff, not as a surprise three commits later.
 *
 * `playback` is excluded deliberately — it is a sampled rendering artifact, and
 * its size depends on `sampleDt`. Everything the user is shown as a NUMBER is
 * in the snapshot.
 *
 * If you are updating the fixture, say why in the commit message. "Tests
 * failed" is not a reason.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import {
  buildCheckinPaymentVariants,
  runDiscreteEvent,
  runScenarioMedian,
} from "../src/core/eventFlow";
import { resolveScenarioBindings } from "../src/core/migrate";
import { buildE310GoldenProject } from "../src/core/quickStart";
import { venuePresetById } from "../src/core/venues";
import type { SimulationResult } from "../src/core/eventFlow";
import type { EventScenario, ServiceStation } from "../src/core/model";

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

const FIXTURE = new URL("./fixtures/e310-des.json", import.meta.url);

/**
 * Everything the user is shown as a number.
 *
 * `playback` is excluded — a sampled rendering artifact whose size depends on
 * `sampleDt`. Station ids are replaced by their names, because `uid()` mixes in
 * `Date.now()`: the ids are different on every run, so freezing them would
 * make the fixture fail for a reason that has nothing to do with the numbers.
 */
function numbers(result: SimulationResult): unknown {
  const nameOf = new Map(result.stations.map((s) => [s.stationId, s.name]));
  const snapshot: Record<string, unknown> = { ...result };
  // Sampled rendering artifact, and its size follows `sampleDt`.
  delete snapshot.playback;
  // `uid()` mixes in Date.now(), so these differ on every run. Freezing them
  // would make the fixture fail for a reason unrelated to the numbers.
  delete snapshot.scenarioId;
  snapshot.bottleneckStationId = result.bottleneckStationId
    ? nameOf.get(result.bottleneckStationId) ?? "?"
    : null;
  snapshot.stations = result.stations.map((s) => {
    const row: Record<string, unknown> = { ...s };
    delete row.stationId;
    return row;
  });
  return snapshot;
}

function station(
  type: ServiceStation["type"],
  x: number,
  z: number,
  over: Partial<ServiceStation> = {},
): ServiceStation {
  return {
    id: over.id ?? `${type}_${x}`,
    name: type,
    type,
    staffCount: 1,
    parallelServers: 1,
    meanServiceSeconds: 30,
    queueCapacity: 20,
    x, z,
    ...over,
  };
}

/** The same shape `eventFlow.test.ts` exercises, pinned at seed 42. */
function miniScenario(): EventScenario {
  return {
    id: "scn1",
    name: "test",
    participantCount: 20,
    arrivalWindowSeconds: 300,
    arrivalProfile: "uniform",
    stations: [
      station("entrance", 0, 0, { id: "ent", meanServiceSeconds: 2 }),
      station("checkin", 5, 0, { id: "ck", meanServiceSeconds: 40 }),
      station("payment", 8, 0, { id: "pay", meanServiceSeconds: 50 }),
      station("seating", 12, 0, { id: "seat", meanServiceSeconds: 5 }),
    ],
    profiles: [
      { id: "prepaid", ratio: 0.5, branch: ["ent", "ck", "seat"] },
      { id: "pay-on-site", ratio: 0.5, branch: ["ent", "ck", "pay", "seat"] },
    ],
    seed: 42,
    settings: { speedMetersPerSecond: 1.5 },
  };
}

function currentRuns(): Record<string, unknown> {
  const project = buildE310GoldenProject(venuePresetById("venue:tku-e310")!);
  const golden = project.scenarios[0];
  const bound = resolveScenarioBindings(project, golden);
  const variants = buildCheckinPaymentVariants(golden);
  return {
    "e310-golden": numbers(runDiscreteEvent(golden, { sampleDt: 5 })),
    "e310-bound": numbers(runDiscreteEvent(bound, { sampleDt: 5 })),
    "mini-seed42": numbers(runDiscreteEvent(miniScenario(), { sampleDt: 5 })),
    "variant-combined": numbers(runScenarioMedian(variants.combined, { sampleDt: 2 })),
    "variant-separated": numbers(runScenarioMedian(variants.separated, { sampleDt: 2 })),
    "variant-corridor": numbers(runScenarioMedian(variants.corridor ?? variants.separated, { sampleDt: 2 })),
  };
}

describe("the classroom simulation gives the same answers it gives today", () => {
  it("matches the recorded fixture, run for run", () => {
    const runs = currentRuns();
    if (!existsSync(FIXTURE)) {
      // First run writes the baseline. Committing it is the point of this test.
      writeFileSync(FIXTURE, `${JSON.stringify(runs, null, 1)}\n`, "utf8");
    }
    const recorded = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, unknown>;
    for (const key of Object.keys(recorded)) {
      expect(runs[key], `run "${key}" changed`).toEqual(recorded[key]);
    }
    expect(Object.keys(runs).sort()).toEqual(Object.keys(recorded).sort());
  });
});

describe("sampleDt is a rendering choice, not an input", () => {
  it("changing it moves no statistic", () => {
    const base = numbers(runDiscreteEvent(miniScenario(), { sampleDt: 1 }));
    for (const dt of [2, 5, 13]) {
      expect(numbers(runDiscreteEvent(miniScenario(), { sampleDt: dt })), `sampleDt ${dt}`)
        .toEqual(base);
    }
  });

  it("and the same holds on the real golden scenario", () => {
    const golden = buildE310GoldenProject(venuePresetById("venue:tku-e310")!).scenarios[0];
    const a = numbers(runDiscreteEvent(golden, { sampleDt: 1 }));
    const b = numbers(runDiscreteEvent(golden, { sampleDt: 7 }));
    expect(b).toEqual(a);
  });
});
