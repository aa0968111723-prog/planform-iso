/**
 * A queue is drawn where the queue could physically stand.
 *
 * The entry station sits 0.6 m from the corridor's end, so the model computed
 * one person per lane and then gave every extra queuer a lane of their own —
 * drawing the line PERPENDICULAR to the corridor. Measured on the shipped E310
 * example: queuer 15 stood at z = 15.00 against a corridor that ends at 11.40,
 * i.e. 3.6 m outside the building, while the queuers on the other side were
 * drawn inside the 巧拼 seating field, through a solid wall.
 *
 * Somebody deciding whether the corridor can hold the entry queue was looking
 * at a line whose drawn length had nothing to do with the corridor.
 *
 * What is NOT changed here: `capacity` and `overflow`. They are still computed
 * from the un-clamped index, so 「排隊人龍會塞滿走廊（約多出 N 人）」 still
 * reports the whole overflow. Where people stand and how many fit are two
 * different claims, and only the first one was wrong.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { buildSimulationSpatial, queuePlacement } from "../src/core/simSpatial";
import { buildE310GoldenProject } from "../src/core/quickStart";
import { resolveScenarioBindings } from "../src/core/migrate";
import { venuePresetById } from "../src/core/venues";
import { runDiscreteEvent } from "../src/core/eventFlow";
import type { Project, ServiceStation, SimulationSpatial } from "../src/core/model";

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

const golden = (): Project => buildE310GoldenProject(venuePresetById("venue:tku-e310")!);

/** Is this point inside either room of the plan? */
function insideAnyRoom(p: { x: number; z: number }, spatial: SimulationSpatial): boolean {
  const rooms = [spatial.classroom, spatial.corridor].filter(Boolean) as {
    x: number; z: number; length: number; width: number;
  }[];
  return rooms.some((r) =>
    p.x >= r.x - 1e-6 && p.x <= r.x + r.length + 1e-6
    && p.z >= r.z - 1e-6 && p.z <= r.z + r.width + 1e-6);
}

describe("every drawn queue position is inside the venue", () => {
  it("holds for every station of the shipped E310 example, 60 deep", () => {
    const project = golden();
    const scenario = resolveScenarioBindings(project, project.scenarios[0]);
    const spatial = buildSimulationSpatial(project);
    const outside: string[] = [];
    for (const station of scenario.stations) {
      for (let i = 0; i < 60; i++) {
        const { point } = queuePlacement(station, i, spatial);
        if (!insideAnyRoom(point, spatial)) {
          outside.push(`${station.name} #${i} → (${point.x.toFixed(2)}, ${point.z.toFixed(2)})`);
        }
      }
    }
    expect(outside, outside.slice(0, 6).join(" / ")).toEqual([]);
  });

  it("specifically at the corridor mouth, where the line used to leave the building", () => {
    const project = golden();
    const spatial = buildSimulationSpatial(project);
    const corridor = spatial.corridor!;
    const entry: ServiceStation = {
      id: "entry", name: "走廊入口", type: "entrance",
      staffCount: 1, parallelServers: 1, meanServiceSeconds: 5, queueCapacity: 30,
      x: corridor.x + 0.6, z: corridor.z + corridor.width / 2,
    };
    for (let i = 0; i < 40; i++) {
      const { point } = queuePlacement(entry, i, spatial);
      expect(point.z, `queuer ${i} left the corridor`).toBeGreaterThanOrEqual(corridor.z - 1e-6);
      expect(point.z, `queuer ${i} left the corridor`).toBeLessThanOrEqual(corridor.z + corridor.width + 1e-6);
      expect(point.x).toBeGreaterThanOrEqual(corridor.x - 1e-6);
      expect(point.x).toBeLessThanOrEqual(corridor.x + corridor.length + 1e-6);
    }
  });

  it("and the overflow is still reported at full size, not clamped away", () => {
    const project = golden();
    const spatial = buildSimulationSpatial(project);
    const corridor = spatial.corridor!;
    const entry: ServiceStation = {
      id: "entry", name: "走廊入口", type: "entrance",
      staffCount: 1, parallelServers: 1, meanServiceSeconds: 5, queueCapacity: 30,
      x: corridor.x + 0.6, z: corridor.z + corridor.width / 2,
    };
    const { capacity } = queuePlacement(entry, 0, spatial);
    expect(capacity).toBeLessThan(40);
    // The 40th person is still an overflow even though they are drawn inside.
    expect(queuePlacement(entry, 39, spatial).overflow).toBe(true);
  });

  it("the run still tells the organiser the corridor is over capacity", () => {
    const project = golden();
    const scenario = resolveScenarioBindings(project, project.scenarios[0]);
    const result = runDiscreteEvent(scenario, { sampleDt: 5 });
    const corridor = result.spatialBottlenecks.find((b) => b.kind === "corridor");
    expect(corridor, "the E310 example overflows its corridor and must say so").toBeDefined();
    expect(corridor!.count).toBeGreaterThan(0);
    expect(result.summaryLines.join(" ")).toContain("走廊");
  });
});

describe("playback never puts a figure through a wall", () => {
  it("no sampled agent position on the golden run is outside both rooms", () => {
    const project = golden();
    const scenario = resolveScenarioBindings(project, project.scenarios[0]);
    const spatial = buildSimulationSpatial(project);
    const result = runDiscreteEvent(scenario, { sampleDt: 5 });
    let outside = 0;
    let worst = { x: 0, z: 0 };
    for (const frame of result.playback) {
      for (const agent of frame.agents) {
        if (agent.state === "pending" || agent.state === "done") continue;
        if (insideAnyRoom(agent, spatial)) continue;
        outside += 1;
        if (Math.abs(agent.z - 10.2) > Math.abs(worst.z - 10.2)) worst = { x: agent.x, z: agent.z };
      }
    }
    // 2 407 of 93 600 live samples were outside before the clamp, the furthest
    // 3.6 m past the corridor's outer wall.
    expect(outside, `worst at (${worst.x.toFixed(2)}, ${worst.z.toFixed(2)})`).toBe(0);
  });
});

describe("a station pushed against the wall", () => {
  /**
   * The lane wrap keeps a CENTRED station's lanes inside the room by
   * arithmetic. A desk shoved against the corridor wall — which is exactly
   * where a real check-in desk goes, to keep the walking lane clear — is the
   * case where that arithmetic runs out: the lanes stack outwards from the
   * station, and half of them are through the wall.
   */
  it("still has all its lanes inside the corridor", () => {
    const project = golden();
    const spatial = buildSimulationSpatial(project);
    const corridor = spatial.corridor!;
    const againstTheWall: ServiceStation = {
      id: "desk", name: "靠牆的桌子", type: "checkin",
      staffCount: 1, parallelServers: 1, meanServiceSeconds: 45, queueCapacity: 30,
      x: corridor.x + corridor.length / 2,
      z: corridor.z + 0.2,
    };
    for (let i = 0; i < 40; i++) {
      const { point } = queuePlacement(againstTheWall, i, spatial);
      expect(point.z, `queuer ${i} at z=${point.z.toFixed(2)} is through the wall`)
        .toBeGreaterThanOrEqual(corridor.z - 1e-6);
      expect(point.z).toBeLessThanOrEqual(corridor.z + corridor.width + 1e-6);
    }
  });
});

describe("an overflowing queue is drawn distributed, not piled on the wall", () => {
  /**
   * Two mechanisms keep people inside, and this pins the second one.
   *
   * Clamping alone would satisfy 「inside the room」 by stacking every extra
   * queuer ON the wall line — a solid bar of figures along both corridor
   * edges, which reads as a rendering bug rather than as a queue. The lane
   * WRAP is what puts them back among the lanes that exist, so the clamp only
   * ever acts as a backstop for a station shoved against a wall.
   */
  it("keeps a shoulder's clearance from both corridor walls", () => {
    const project = golden();
    const spatial = buildSimulationSpatial(project);
    const corridor = spatial.corridor!;
    const entry: ServiceStation = {
      id: "entry", name: "走廊入口", type: "entrance",
      staffCount: 1, parallelServers: 1, meanServiceSeconds: 5, queueCapacity: 30,
      x: corridor.x + 0.6, z: corridor.z + corridor.width / 2,
    };
    const shoulder = 0.25;
    for (let i = 0; i < 30; i++) {
      const { point } = queuePlacement(entry, i, spatial);
      expect(point.z, `queuer ${i} is standing in the wall at z=${point.z.toFixed(2)}`)
        .toBeGreaterThanOrEqual(corridor.z + shoulder);
      expect(point.z).toBeLessThanOrEqual(corridor.z + corridor.width - shoulder);
    }
  });
});
