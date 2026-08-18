import { describe, expect, it } from "vitest";
import {
  buildCheckinPaymentVariants,
  cloneScenario,
  compareScenarioResults,
  createRng,
  runDiscreteEvent,
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

describe("runDiscreteEvent", () => {
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
    expect(cmp.winner).toBe("b");
    expect(cmp.deltas.finishTimeSeconds).toBeLessThan(0);
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
    expect(p.version).toBe(6);
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
