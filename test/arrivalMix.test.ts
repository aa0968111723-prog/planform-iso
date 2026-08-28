/**
 * The 40/20 mix has to arrive mixed, and the queue has to stand where the
 * capacity said it would fit.
 *
 * Three defects the audit found in the numbers the tool asks people to trust:
 *  1. `allocateProfiles` returns every prepaid attendee first and every
 *     pay-on-site one last; arrivals are sorted ascending and zipped
 *     positionally, so the payment desk sat idle for two thirds of the window
 *     and was then hit by twenty consecutive payers.
 *  2. The queue's capacity was counted in lanes while its placement ran
 *     single-file, so a long line was drawn metres outside the building and
 *     still reported as fitting.
 *  3. Pressing ▶ 模擬 wrote the session's default arrival profile back over the
 *     one the shipped example was authored with.
 */

import { describe, expect, it } from "vitest";
import { allocateProfiles, runDiscreteEvent } from "../src/core/eventFlow";
import { buildSimulationSpatial, queuePlacement } from "../src/core/simSpatial";
import { buildE310GoldenProject } from "../src/core/quickStart";
import { venuePresetById } from "../src/core/venues";
import type { ServiceStation } from "../src/core/model";

function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

describe("a 40 / 20 mix arrives mixed", () => {
  installLocalStorage();

  it("pay-on-site attendees are spread through the arrival window", () => {
    const project = buildE310GoldenProject(venuePresetById("venue:tku-e310")!);
    const scenario = project.scenarios[0];
    expect(scenario.participantCount).toBe(60);

    const result = runDiscreteEvent(scenario, { sampleDt: 5 });
    // Reconstruct arrival order from the playback: the first frame each agent
    // stops being "pending" is its arrival.
    const firstSeen = new Map<number, { t: number; profile: string }>();
    for (const frame of result.playback) {
      for (const a of frame.agents) {
        if (a.state === "pending" || firstSeen.has(a.id)) continue;
        firstSeen.set(a.id, { t: frame.t, profile: a.profileId });
      }
    }
    const order = [...firstSeen.entries()]
      .sort((a, b) => a[1].t - b[1].t || a[0] - b[0])
      .map(([, v]) => v.profile);
    const onsite = order.map((p, i) => (p === "pay-on-site" ? i : -1)).filter((i) => i >= 0);
    expect(onsite.length).toBeGreaterThan(0);

    // Grouped, the twenty payers occupy ranks 40..59 — the last third only.
    const firstThird = onsite.filter((i) => i < order.length / 3).length;
    expect(firstThird, "no on-site payer arrived in the first third of the window")
      .toBeGreaterThan(0);
  });

  it("still allocates exactly the right counts", () => {
    const counts = allocateProfiles(60, [
      { id: "prepaid", ratio: 2 / 3, branch: ["a"] },
      { id: "pay-on-site", ratio: 1 / 3, branch: ["a", "b"] },
    ]);
    expect(counts).toHaveLength(60);
    expect(counts.filter((p) => p.id === "prepaid")).toHaveLength(40);
    expect(counts.filter((p) => p.id === "pay-on-site")).toHaveLength(20);
  });

  it("is still reproducible from the same seed", () => {
    const project = buildE310GoldenProject(venuePresetById("venue:tku-e310")!);
    const a = runDiscreteEvent(project.scenarios[0], { sampleDt: 10 });
    const b = runDiscreteEvent(project.scenarios[0], { sampleDt: 10 });
    expect(b.finishTimeSeconds).toBe(a.finishTimeSeconds);
    expect(b.maxQueue).toBe(a.maxQueue);
    expect(b.avgWaitSeconds).toBeCloseTo(a.avgWaitSeconds, 9);
  });
});

describe("a queue stands where its capacity said it would fit", () => {
  installLocalStorage();

  it("wraps into lanes instead of marching out of the building", () => {
    const project = buildE310GoldenProject(venuePresetById("venue:tku-e310")!);
    const spatial = buildSimulationSpatial(project);
    const corridor = spatial.corridor;
    const station: ServiceStation = {
      id: "st", name: "報到", type: "checkin",
      staffCount: 1, parallelServers: 1, meanServiceSeconds: 30, queueCapacity: 40,
      x: corridor.x + corridor.length - 2, z: corridor.z + corridor.width / 2,
    };

    const first = queuePlacement(station, 0, spatial);
    expect(first.capacity).toBeGreaterThan(1);

    // Everybody the capacity claims to hold must actually stand inside the room.
    const held = Math.min(first.capacity, 60);
    for (let i = 0; i < held; i++) {
      const p = queuePlacement(station, i, spatial);
      expect(p.overflow, `person ${i} is within capacity ${first.capacity}`).toBe(false);
      expect(p.point.x, `person ${i} stands ${p.point.x.toFixed(2)} m, outside the corridor`)
        .toBeGreaterThanOrEqual(corridor.x - 0.6);
      expect(p.point.x).toBeLessThanOrEqual(corridor.x + corridor.length + 0.6);
      expect(p.point.z).toBeGreaterThanOrEqual(corridor.z - 0.6);
      expect(p.point.z).toBeLessThanOrEqual(corridor.z + corridor.width + 0.6);
    }
  });

  it("past capacity it says so instead of drawing people into the car park", () => {
    const project = buildE310GoldenProject(venuePresetById("venue:tku-e310")!);
    const spatial = buildSimulationSpatial(project);
    const corridor = spatial.corridor;
    const station: ServiceStation = {
      id: "st", name: "報到", type: "checkin",
      staffCount: 1, parallelServers: 1, meanServiceSeconds: 30, queueCapacity: 40,
      x: corridor.x + corridor.length - 2, z: corridor.z + corridor.width / 2,
    };
    const cap = queuePlacement(station, 0, spatial).capacity;
    expect(queuePlacement(station, cap, spatial).overflow).toBe(true);
  });
});
