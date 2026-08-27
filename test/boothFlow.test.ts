import { beforeEach, describe, expect, it } from "vitest";
import {
  BOOTH_DEFAULT_SEED,
  BOOTH_SIM_PRESETS,
  BoothSim,
  createBoothStations,
  defaultBoothParams,
  isBoothProject,
  runBoothHeadless,
} from "../src/core/boothFlow";
import { createDefaultProject, type Project } from "../src/core/model";
import { boothVenuePreset, createProjectFromVenuePreset } from "../src/core/venues";

function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

function boothProject(): Project {
  return createProjectFromVenuePreset(boothVenuePreset(), "攤位");
}

const normal = () => defaultBoothParams("normal");
const peak = () => defaultBoothParams("peak");

describe("booth flow simulation", () => {
  beforeEach(() => installLocalStorage());

  it("is reproducible: the same seed gives byte-identical statistics", () => {
    const p = boothProject();
    const a = runBoothHeadless(p, undefined, BOOTH_DEFAULT_SEED);
    const b = runBoothHeadless(p, undefined, BOOTH_DEFAULT_SEED);
    expect(JSON.stringify(b)).toEqual(JSON.stringify(a));
  });

  it("does not mutate the project it was handed", () => {
    const p = boothProject();
    const before = JSON.stringify(p);
    runBoothHeadless(p, { visitorCount: 5, arrivalPerMin: 20 });
    expect(JSON.stringify(p)).toEqual(before);
  });

  it("queues longer at 尖峰 than at 正常", () => {
    const p = boothProject();
    const quiet = runBoothHeadless(p, normal());
    const busy = runBoothHeadless(p, peak());
    expect(busy.maxQueue).toBeGreaterThan(quiet.maxQueue);
  });

  it("waits longer when the conversation takes twice as long", () => {
    const p = boothProject();
    const base = runBoothHeadless(p, normal());
    const slow = runBoothHeadless(p, { ...normal(), talkSeconds: normal().talkSeconds * 2 });
    expect(slow.avgWait).toBeGreaterThan(base.avgWait);
  });

  it("loses fewer visitors when the desk goes from 3 to 6 people", () => {
    const p = boothProject();
    const three = runBoothHeadless(p, { ...peak(), deskStaff: 3 });
    const six = runBoothHeadless(p, { ...peak(), deskStaff: 6 });
    expect(three.balked).toBeGreaterThan(0);
    expect(six.balked).toBeLessThan(three.balked);
  });

  it("loses nobody when 等太久會離開 is switched off", () => {
    const p = boothProject();
    const params = { ...peak(), balk: false };
    const stats = runBoothHeadless(p, params);
    expect(stats.balked).toBe(0);
    expect(stats.completed).toBe(params.visitorCount);
  });

  it("loses more visitors as the queue area shrinks", () => {
    const p = boothProject();
    const roomy = runBoothHeadless(p, { ...peak(), queueCapacity: 8 });
    const tight = runBoothHeadless(p, { ...peak(), queueCapacity: 2 });
    expect(tight.balked).toBeGreaterThan(roomy.balked);
  });

  it("takes a disabled station out of the journey and leaves the rest working", () => {
    const p = boothProject();
    const gameId = p.booth!.stations.find((s) => s.boothType === "game")!.id;
    const before = runBoothHeadless(p, normal());
    expect(before.stations.find((s) => s.id === gameId)?.served).toBeGreaterThan(0);

    p.booth!.stations = p.booth!.stations.map((s) => (s.id === gameId ? { ...s, enabled: false } : s));
    const after = runBoothHeadless(p, normal());
    expect(after.stations.find((s) => s.id === gameId)).toBeUndefined();
    for (const s of after.stations.filter((x) => x.boothType !== "queue")) {
      expect(s.served, `${s.name} stopped working`).toBeGreaterThan(0);
    }
    expect(after.completed).toBeGreaterThan(0);
  });

  it("never reports more completions than arrivals, nor a negative rate", () => {
    const p = boothProject();
    for (const params of [normal(), peak(), { ...peak(), deskStaff: 1 }]) {
      const s = runBoothHeadless(p, params);
      expect(s.completed).toBeLessThanOrEqual(s.spawned);
      expect(s.spawned).toBeLessThanOrEqual(params.visitorCount);
      expect(s.throughput).toBeGreaterThanOrEqual(0);
      for (const st of s.stations) {
        expect(st.utilization).toBeGreaterThanOrEqual(0);
        expect(st.utilization).toBeLessThanOrEqual(1);
      }
    }
  });

  it("finishes: everybody who arrives eventually leaves", () => {
    const p = boothProject();
    const sim = new BoothSim(p);
    let guard = 0;
    while (!sim.done && guard < 200_000) { sim.step(0.25); guard += 1; }
    expect(sim.done).toBe(true);
    expect(sim.crowd()).toHaveLength(0);
    expect(sim.stats().onSite).toBe(0);
  });

  it("reports live crowd states the scene can colour", () => {
    const p = boothProject();
    const sim = new BoothSim(p, BOOTH_DEFAULT_SEED);
    for (let i = 0; i < 4000; i++) sim.step(0.1);
    const people = sim.crowd();
    expect(people.length).toBeGreaterThan(0);
    for (const person of people) {
      expect(["serving", "queued", "traveling"]).toContain(person.state);
      expect(Number.isFinite(person.x) && Number.isFinite(person.z)).toBe(true);
    }
    const queues = sim.queueLengths();
    for (const st of p.booth!.stations) {
      expect(queues[st.id]).toBeGreaterThanOrEqual(0);
    }
  });

  it("treats a project with no booth data as not simulatable", () => {
    const plain = createDefaultProject();
    expect(isBoothProject(plain)).toBe(false);
    // Asking anyway must not throw; it just reports an empty run.
    expect(runBoothHeadless(plain).spawned).toBe(0);
  });

  it("names a bottleneck only once somebody has actually waited", () => {
    const p = boothProject();
    // One visitor, all the time in the world: nobody queues behind anybody.
    const lonely = runBoothHeadless(p, { ...normal(), visitorCount: 1, arrivalPerMin: 0.5 });
    expect(lonely.avgWait).toBeLessThan(1);
    expect(lonely.bottleneck).toBeNull();
    // A rush does produce one.
    expect(runBoothHeadless(p, peak()).bottleneck).not.toBeNull();
  });

  it("ships the eight default stations with the documented dwell times", () => {
    const stations = createBoothStations();
    expect(stations).toHaveLength(8);
    expect(stations.every((s) => s.type === "custom")).toBe(true);
    const talk = stations.find((s) => s.boothType === "talk")!;
    expect(talk.meanServiceSeconds).toBe(BOOTH_SIM_PRESETS.normal.talkSeconds);
    expect(talk.parallelServers).toBe(BOOTH_SIM_PRESETS.normal.deskStaff);
  });
});
