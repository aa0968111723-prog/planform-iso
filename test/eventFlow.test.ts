import { describe, expect, it } from "vitest";
import {
  buildCheckinPaymentVariants,
  cloneScenario,
  compareScenarioResults,
  compareScenarioVariants,
  createRng,
  allocateProfiles,
  runDiscreteEvent,
  runScenarioMedian,
} from "../src/core/eventFlow";
import { createDefaultScenario, migrateProject } from "../src/core/migrate";
import {
  PROJECT_VERSION,
  createDefaultProject,
  type EventScenario,
  type ServiceStation,
  uid,
} from "../src/core/model";

function station(
  type: ServiceStation["type"],
  x: number,
  z: number,
  opts: Partial<ServiceStation> = {},
): ServiceStation {
  return {
    id: opts.id ?? uid("stn"),
    name: opts.name ?? type,
    type,
    x,
    z,
    staffCount: opts.staffCount ?? 1,
    parallelServers: opts.parallelServers ?? 1,
    meanServiceSeconds: opts.meanServiceSeconds ?? 30,
    queueCapacity: opts.queueCapacity ?? 40,
    ...opts,
  };
}

function miniScenario(overrides: Partial<EventScenario> = {}): EventScenario {
  const entrance = station("entrance", 0, 0, { id: "ent", meanServiceSeconds: 2 });
  const checkin = station("checkin", 5, 0, { id: "ck", meanServiceSeconds: 40 });
  const payment = station("payment", 8, 0, { id: "pay", meanServiceSeconds: 50 });
  const seat = station("seating", 12, 0, { id: "seat", meanServiceSeconds: 5 });
  return {
    id: "scn1",
    name: "test",
    participantCount: 20,
    arrivalWindowSeconds: 300,
    arrivalProfile: "uniform",
    stations: [entrance, checkin, payment, seat],
    profiles: [
      { id: "prepaid", ratio: 0.5, branch: ["ent", "ck", "seat"] },
      { id: "pay-on-site", ratio: 0.5, branch: ["ent", "ck", "pay", "seat"] },
    ],
    seed: 42,
    settings: { speedMetersPerSecond: 1.5 },
    ...overrides,
  };
}

describe("createRng", () => {
  it("is deterministic for the same seed", () => {
    const a = createRng(7);
    const b = createRng(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("profile allocation", () => {
  it("allocates 60 people as exactly 40 prepaid and 20 on-site", () => {
    const profiles = allocateProfiles(60, [
      { id: "prepaid", ratio: 2 / 3, branch: [] },
      { id: "pay-on-site", ratio: 1 / 3, branch: [] },
    ]);
    expect(profiles.filter((profile) => profile.id === "prepaid")).toHaveLength(40);
    expect(profiles.filter((profile) => profile.id === "pay-on-site")).toHaveLength(20);
  });

  it("keeps the comparison seed hidden behind deterministic median metrics", () => {
    const scn = miniScenario({ participantCount: 30, seed: 21 });
    const a = runScenarioMedian(scn, { sampleDt: 2 }, 5);
    const b = runScenarioMedian(scn, { sampleDt: 2 }, 5);
    expect(a.seed).toBe(21);
    expect(a.finishTimeSeconds).toBe(b.finishTimeSeconds);
    expect(a.avgWaitSeconds).toBe(b.avgWaitSeconds);
  });
});

describe("runDiscreteEvent", () => {
  it("uses route travel, half-metre queue positions and door bottlenecks", () => {
    const scn = miniScenario({
      participantCount: 5,
      arrivalWindowSeconds: 0,
      stations: [
        station("entrance", 0, 0, { id: "ent", meanServiceSeconds: 2 }),
        station("checkin", 0, 5, { id: "ck", meanServiceSeconds: 40 }),
      ],
      profiles: [{ id: "general", ratio: 1, branch: ["ent", "ck"] }],
      spatial: {
        routes: [{ id: "entry", name: "entry", color: "#fff", visible: true, type: "entry", points: [{ x: 0, z: 0 }, { x: 0, z: 2 }, { x: 0, z: 5 }] }],
        corridor: { id: "corridor", name: "corridor", length: 10, width: 1.2, x: -5, z: -1 },
        classroom: { id: "classroom", name: "classroom", length: 10, width: 8, x: -5, z: -5 },
        doors: [{ id: "door", x: 0, z: 2, width: 0.8, throughput: 0.18, blocked: true }],
      },
    });
    const result = runDiscreteEvent(scn, { sampleDt: 1 });
    expect(result.spatialBottlenecks.some((bottleneck) => bottleneck.kind === "door")).toBe(true);
    expect(result.bottleneckName).toBe("門前");
    const travelling = result.playback.flatMap((frame) => frame.agents).filter((agent) => agent.state === "traveling");
    expect(travelling.some((agent) => agent.z > 0 && agent.z < 5)).toBe(true);
    const queued = result.playback.flatMap((frame) => frame.agents).filter((agent) => agent.state === "queued");
    expect(new Set(queued.map((agent) => `${agent.x.toFixed(2)}|${agent.z.toFixed(2)}`)).size).toBeGreaterThan(1);
  });

  it("makes the same queue scenario distinguish 1.2m from 2.4m corridor width", () => {
    const base = miniScenario({
      participantCount: 8,
      arrivalWindowSeconds: 0,
      profiles: [{ id: "general", ratio: 1, branch: ["ck"] }],
      // 1 m into the corridor: little approach length, so lane count (width)
      // decides how many people fit before the line spills out.
      stations: [station("checkin", -4, 0, { id: "ck", meanServiceSeconds: 20 })],
    });
    const withWidth = (width: number) => ({
      ...base,
      spatial: {
        routes: [],
        corridor: { id: "corridor" as const, name: "corridor", length: 10, width, x: -5, z: -1 },
        classroom: { id: "classroom" as const, name: "classroom", length: 10, width: 8, x: -5, z: -5 },
        doors: [],
      },
    });
    const narrow = runDiscreteEvent(withWidth(1.2));
    const wide = runDiscreteEvent(withWidth(2.4));
    const narrowOverflow = narrow.spatialBottlenecks.find((bottleneck) => bottleneck.kind === "corridor")!;
    const wideOverflow = wide.spatialBottlenecks.find((bottleneck) => bottleneck.kind === "corridor")!;
    expect(narrowOverflow.count).toBeGreaterThan(wideOverflow.count);
  });

  it("reports average wait per participant, not an average of station averages", () => {
    const scn = miniScenario({
      participantCount: 2,
      arrivalWindowSeconds: 0,
      profiles: [{ id: "general", ratio: 1, branch: ["ck"] }],
      stations: [station("checkin", 0, 0, {
        id: "ck", meanServiceSeconds: 10, serviceVariance: 0,
      })],
    });
    const result = runDiscreteEvent(scn);
    expect(result.totalWaitSeconds).toBeCloseTo(10, 6);
    expect(result.avgWaitSeconds).toBeCloseTo(5, 6);
    expect(result.stations[0].avgWaitSeconds).toBeCloseTo(5, 6);
    expect(result.maxQueue).toBe(1);
    expect(result.maxQueueWhere).toBe("checkin");
  });

  it("completes most participants and is deterministic", () => {
    const scn = miniScenario();
    const r1 = runDiscreteEvent(scn, { sampleDt: 2 });
    const r2 = runDiscreteEvent(scn, { sampleDt: 2 });
    expect(r1.completed).toBe(r2.completed);
    expect(r1.finishTimeSeconds).toBeCloseTo(r2.finishTimeSeconds, 5);
    expect(r1.avgJourneySeconds).toBeCloseTo(r2.avgJourneySeconds, 5);
    expect(r1.stations.map((s) => s.maxQueue)).toEqual(r2.stations.map((s) => s.maxQueue));
    expect(r1.completed).toBeGreaterThan(0);
    expect(r1.playback.length).toBeGreaterThan(5);
  });

  it("prepaid branch skips payment (payment served < total)", () => {
    const scn = miniScenario({ participantCount: 40, seed: 3 });
    const r = runDiscreteEvent(scn);
    const pay = r.stations.find((s) => s.stationId === "pay")!;
    const ck = r.stations.find((s) => s.stationId === "ck")!;
    expect(ck.served).toBeGreaterThan(pay.served);
    expect(pay.served).toBeGreaterThan(0);
    expect(pay.served).toBeLessThan(scn.participantCount);
  });

  it("more servers reduce max queue at a bottleneck", () => {
    const slow = miniScenario({
      participantCount: 40,
      seed: 9,
      arrivalWindowSeconds: 120,
    });
    // Make checkin very slow with 1 server.
    slow.stations = slow.stations.map((s) =>
      s.id === "ck" ? { ...s, meanServiceSeconds: 60, staffCount: 1, parallelServers: 1 } : s,
    );
    const one = runDiscreteEvent(slow);
    const multi = runDiscreteEvent(
      cloneScenario(slow, {
        stationPatches: { ck: { staffCount: 3, parallelServers: 3 } },
      }),
    );
    const q1 = one.stations.find((s) => s.stationId === "ck")!.maxQueue;
    const q3 = multi.stations.find((s) => s.stationId === "ck")!.maxQueue;
    expect(q3).toBeLessThanOrEqual(q1);
    expect(multi.finishTimeSeconds).toBeLessThan(one.finishTimeSeconds);
  });

  it("front-loaded arrivals create earlier congestion than uniform", () => {
    const base = miniScenario({ participantCount: 50, arrivalWindowSeconds: 400, seed: 11 });
    base.stations = base.stations.map((s) =>
      s.id === "ck" ? { ...s, meanServiceSeconds: 45, staffCount: 1 } : s,
    );
    const uni = runDiscreteEvent({ ...base, arrivalProfile: "uniform" });
    const front = runDiscreteEvent({ ...base, arrivalProfile: "front-loaded" });
    const qUni = uni.stations.find((s) => s.stationId === "ck")!.maxQueue;
    const qFront = front.stations.find((s) => s.stationId === "ck")!.maxQueue;
    expect(qFront).toBeGreaterThanOrEqual(qUni);
  });

  it("handles 100 participants within a reasonable time budget", () => {
    const scn = miniScenario({ participantCount: 100, seed: 1, arrivalWindowSeconds: 900 });
    const t0 = performance.now();
    const r = runDiscreteEvent(scn, { sampleDt: 2 });
    const ms = performance.now() - t0;
    expect(r.completed).toBeGreaterThan(80);
    expect(ms).toBeLessThan(2000);
  });
});

describe("compareScenarioResults / variants", () => {
  it("models A/B/C with the actual desk geometry and lane branches", () => {
    const base = miniScenario({ participantCount: 30, seed: 8 });
    const { combined, separated, corridor } = buildCheckinPaymentVariants(base);
    expect(combined.stations.find((s) => s.id === "ck")).toMatchObject({ staffCount: 2, parallelServers: 2 });
    expect(combined.stations.find((s) => s.id === "ck")?.profileServiceSeconds?.prepaid).toBe(40);
    expect(separated.stations.find((s) => s.id === "pay")?.x).toBe(8);
    expect(corridor).toBeTruthy();
    expect(corridor!.profiles.every((profile) => profile.branch.some((id) => id.includes("_c_")))).toBe(true);
    expect(corridor!.stations.filter((s) => s.id.includes("_c_")).length).toBe(4);
  });

  it("keeps A competitive when almost everyone is prepaid and covers the 30/60/100 matrix", () => {
    const highPrepaid = miniScenario({
      participantCount: 30,
      seed: 12,
      profiles: [
        { id: "prepaid", ratio: 0.95, branch: ["ent", "ck", "seat"] },
        { id: "pay-on-site", ratio: 0.05, branch: ["ent", "ck", "pay", "seat"] },
      ],
    });
    const high = buildCheckinPaymentVariants(highPrepaid);
    expect(runDiscreteEvent(high.combined).finishTimeSeconds).toBeLessThanOrEqual(runDiscreteEvent(high.separated).finishTimeSeconds);

    for (const participantCount of [30, 60, 100]) {
      const scn = miniScenario({ participantCount, seed: participantCount });
      const variants = buildCheckinPaymentVariants(scn);
      const a = runDiscreteEvent(variants.combined);
      const b = runDiscreteEvent(variants.separated);
      const c = runDiscreteEvent(variants.corridor ?? variants.separated);
      const compare = compareScenarioVariants(a, b, c);
      expect([compare.a, compare.b, compare.c].every((result) => result.participantCount === participantCount)).toBe(true);
      expect(compare.reason.length).toBeGreaterThan(4);
      expect(compareScenarioVariants(a, b, c).winner).toBe(compare.winner);
    }
  });

  it("prefers separated desks when checkin+payment share one slow spot", () => {
    const base = miniScenario({
      participantCount: 48,
      seed: 5,
      arrivalWindowSeconds: 240,
      profiles: [
        { id: "prepaid", ratio: 0.4, branch: ["ent", "ck", "seat"] },
        { id: "pay-on-site", ratio: 0.6, branch: ["ent", "ck", "pay", "seat"] },
      ],
    });
    base.stations = base.stations.map((s) => {
      if (s.id === "ck") return { ...s, meanServiceSeconds: 40, staffCount: 1 };
      if (s.id === "pay") return { ...s, meanServiceSeconds: 50, staffCount: 1 };
      return s;
    });
    const { combined, separated } = buildCheckinPaymentVariants(base);
    const a = runDiscreteEvent(combined);
    const b = runDiscreteEvent(separated);
    const cmp = compareScenarioResults(a, b);
    expect(["a", "b", "tie"]).toContain(cmp.winner);
    expect(Math.abs(cmp.deltas.finishTimeSeconds)).toBeGreaterThan(0);
    expect(cmp.reason.length).toBeGreaterThan(4);
  });
});

describe("createDefaultScenario + migration v6", () => {
  it("builds stations from empty project", () => {
    const p = createDefaultProject();
    const scn = createDefaultScenario(p, { participantCount: 60 });
    expect(scn.stations.some((s) => s.type === "checkin")).toBe(true);
    expect(scn.stations.some((s) => s.type === "payment")).toBe(true);
    expect(scn.profiles.some((pr) => pr.id === "prepaid")).toBe(true);
    const r = runDiscreteEvent(scn);
    expect(r.completed).toBeGreaterThan(0);
  });

  it("migrates v5 project to v6 with empty scenarios", () => {
    const p = migrateProject({
      version: 5,
      name: "舊",
      objects: [
        {
          id: "o1",
          kind: "regTable",
          x: 2,
          z: 2,
          rotationDeg: 0,
          width: 1.5,
          depth: 0.6,
          height: 0.74,
          locked: false,
          hidden: false,
          serviceRole: "checkin",
        } as never,
      ],
    });
    expect(p.version).toBe(PROJECT_VERSION);
    expect(p.version).toBe(7);
    expect(Array.isArray(p.scenarios)).toBe(true);
    expect(p.scenarios).toHaveLength(0);
    expect(p.activeScenarioId).toBeNull();
  });

  it("roundtrips a scenario through migrateProject", () => {
    const p = createDefaultProject();
    const scn = createDefaultScenario(p);
    p.scenarios = [scn];
    p.activeScenarioId = scn.id;
    const again = migrateProject(JSON.parse(JSON.stringify(p)));
    expect(again.scenarios).toHaveLength(1);
    expect(again.scenarios[0].stations.length).toBe(scn.stations.length);
    expect(again.activeScenarioId).toBe(scn.id);
  });
});

describe("平均等待 is per attendee, not an average of stations", () => {
  // Review finding: averaging the per-station avgWaitSeconds gives a barely
  // used station the same weight as check-in, and counts stations nobody
  // queued at as zero. The headline 「平均等待」 must answer "how long did a
  // person wait", so it has to divide total wait by people.
  const result = runDiscreteEvent(miniScenario());

  it("equals totalWaitSeconds divided by the participant count", () => {
    expect(result.avgWaitSeconds).toBeCloseTo(
      result.totalWaitSeconds / result.participantCount,
      6,
    );
  });

  it("does not equal the unweighted mean of the station averages", () => {
    // Only half the attendees visit 收費, so the two must differ — if they ever
    // coincide the guard above has stopped proving anything.
    const stationMean =
      result.stations.reduce((sum, s) => sum + s.avgWaitSeconds, 0) / result.stations.length;
    expect(Math.abs(stationMean - result.avgWaitSeconds)).toBeGreaterThan(1);
  });

  it("station stats still divide each station's wait by the people it served", () => {
    for (const s of result.stations) {
      if (!s.served) {
        expect(s.avgWaitSeconds).toBe(0);
        continue;
      }
      expect(s.avgWaitSeconds).toBeCloseTo(s.totalWaitSeconds / s.served, 6);
    }
  });
});
