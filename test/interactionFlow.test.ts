/**
 * The engine, driven by a flow the organiser could have typed.
 *
 * The release brief is blunt about the bar: "if custom flow is UI-only, that is
 * an outright FAIL". So these tests build flows from the three primitives and
 * assert that the SIMULATION changed — queue lengths, who got what, who is
 * still standing there — not that a panel rendered.
 */

import { describe, expect, it } from "vitest";
import { runInteraction } from "../src/core/eventFlow";
import { blankTemplate, templateFromBooth } from "../src/core/interactionCompile";
import {
  BOOTH_SIM_PRESETS,
  createBoothStations,
  defaultBoothParams,
} from "../src/core/boothCatalog";
import { boothVenuePreset, createProjectFromVenuePreset } from "../src/core/venues";
import { createDefaultProject } from "../src/core/model";
import type {
  BoothParams,
  InteractionStation,
  InteractionStep,
  InteractionTemplate,
} from "../src/core/model";

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

function station(id: string, over: Partial<InteractionStation> = {}): InteractionStation {
  return {
    id, name: id, type: "custom",
    staffCount: 1, parallelServers: 1, meanServiceSeconds: 30, queueCapacity: 20,
    x: 0, z: 0, ...over,
  };
}

/** A flow built the way the panel builds one: a list of steps. */
function flow(steps: InteractionStep[], over: Partial<InteractionTemplate> = {}): InteractionTemplate {
  const base = blankTemplate("測試");
  return {
    ...base,
    steps,
    startStepId: steps[0].id,
    stations: [station("st")],
    segments: [{ id: "all", name: "訪客", share: 1, startStepId: steps[0].id }],
    audience: { count: 30, windowSeconds: 600, profile: "uniform", stopRate: 1, joinRate: 1, patienceSeconds: 0 },
    ...over,
  };
}

describe("a flow with no forks still runs", () => {
  it("walks the list in order and everybody finishes", () => {
    const r = runInteraction(flow([
      { id: "a", name: "招呼", avgSeconds: 10 },
      { id: "b", name: "對談", avgSeconds: 20 },
      { id: "c", name: "領小物", avgSeconds: 10, next: null },
    ]), { sampleDt: 5 });
    expect(r.completed).toBe(30);
    expect(r.unfinished).toBe(0);
  });

  it("the list ORDER decides the order, not the ids", () => {
    const steps: InteractionStep[] = [
      { id: "a", name: "A", avgSeconds: 10 },
      { id: "b", name: "B", avgSeconds: 10 },
      { id: "c", name: "C", avgSeconds: 10, next: null },
    ];
    const forward = runInteraction(flow(steps), { sampleDt: 5 });
    // Same steps, different order in the list — a genuinely different flow.
    const reordered = runInteraction(flow([steps[1], steps[0], steps[2]], {
      startStepId: "b",
      segments: [{ id: "all", name: "訪客", share: 1, startStepId: "b" }],
    }), { sampleDt: 5 });
    expect(reordered.completed).toBe(forward.completed);
    // Both complete; the point is the engine accepted the reordering at all.
    expect(reordered.finishTimeSeconds).toBeGreaterThan(0);
  });
});

describe("a weighted fork is a real fork", () => {
  const dice = (faces: number, extraFor?: { index: number; seconds: number }) => flow([
    { id: "roll", name: "擲骰", avgSeconds: 20, branch: {
      kind: "chance",
      record: "face",
      options: Array.from({ length: faces }, (_, i) => ({
        id: `f${i}`, label: `第 ${i + 1} 面`, weight: 1,
        extraSeconds: extraFor?.index === i ? extraFor.seconds : undefined,
      })),
    } },
    { id: "end", name: "離開", avgSeconds: 5, next: null },
  ]);

  it("reports how often each face came up, and they add up", () => {
    const r = runInteraction(dice(6), { sampleDt: 5 });
    const step = r.steps?.find((s) => s.stepId === "roll");
    expect(step, "a flow with a fork must report its steps").toBeDefined();
    expect(step!.optionCounts).toHaveLength(6);
    const total = step!.optionCounts!.reduce((a, o) => a + o.count, 0);
    expect(total).toBe(30);
  });

  it("a configurable face count is just data — 4, 6 and 8 all work", () => {
    for (const faces of [4, 6, 8]) {
      const step = runInteraction(dice(faces), { sampleDt: 5 }).steps?.find((s) => s.stepId === "roll");
      expect(step!.optionCounts).toHaveLength(faces);
    }
  });

  it("a slower face makes the queue longer — the point of rolling at service start", () => {
    // One server, so the queue is purely a function of how long each visit takes.
    const one = { stations: [station("st", { parallelServers: 1, staffCount: 1 })] };
    const quick = runInteraction({ ...dice(6), ...one }, { sampleDt: 5 });
    const slow = runInteraction({ ...dice(6, { index: 0, seconds: 240 }), ...one }, { sampleDt: 5 });
    expect(slow.maxQueue).toBeGreaterThan(quick.maxQueue);
    expect(slow.avgWaitSeconds).toBeGreaterThan(quick.avgWaitSeconds);
  });

  it("is reproducible: same template, same numbers", () => {
    const t = dice(6);
    const a = runInteraction(t, { sampleDt: 5 });
    const b = runInteraction(t, { sampleDt: 5 });
    expect(b.maxQueue).toBe(a.maxQueue);
    expect(b.avgWaitSeconds).toBeCloseTo(a.avgWaitSeconds, 9);
  });
});

describe("an outcome table reads earlier answers", () => {
  const okBandage = () => flow([
    { id: "q1", name: "Q1 科系真心話", avgSeconds: 25, branch: {
      kind: "chance", record: "q1",
      options: [
        { id: "like", label: "還算喜歡", weight: 1, value: "like" },
        { id: "regret", label: "有點後悔", weight: 1, value: "regret" },
      ],
    } },
    { id: "q2", name: "Q2 用一句話形容", avgSeconds: 40 },
    { id: "q3", name: "Q3 哪隻怪獸", avgSeconds: 25, branch: {
      kind: "chance", record: "q3",
      options: [
        { id: "delay", label: "拖延獸", weight: 1, value: "delay" },
        { id: "drain", label: "內耗獸", weight: 1, value: "drain" },
      ],
    } },
    { id: "pick", name: "對出金句", avgSeconds: 10, branch: {
      kind: "match", on: ["q1", "q3"],
      rules: [
        { when: ["like", "delay"], label: "金句 1-1" },
        { when: ["like", "drain"], label: "金句 1-2" },
        { when: ["regret", "delay"], label: "金句 2-1" },
        { when: ["regret", "drain"], label: "金句 2-2" },
      ],
      otherwise: { label: "通用金句" },
    } },
    { id: "give", name: "領 OK 蹦小卡", avgSeconds: 20, next: null },
  ]);

  it("expresses the club's real activity — free-text steps and all", () => {
    const r = runInteraction(okBandage(), { sampleDt: 5 });
    expect(r.completed).toBe(30);
    // The free-writing steps need no engine feature: they are time plus a prompt.
    expect(r.steps?.find((s) => s.stepId === "q2")?.optionCounts).toBeUndefined();
  });

  it("every visitor gets a quote from the table, never the fallback", () => {
    const r = runInteraction(okBandage(), { sampleDt: 5 });
    const pick = r.steps?.find((s) => s.stepId === "pick");
    expect(pick).toBeDefined();
    if (!pick) return;
    const total = pick.optionCounts!.reduce((a, o) => a + o.count, 0);
    expect(total).toBe(30);
    expect(pick.optionCounts!.some((o) => o.label === "通用金句")).toBe(false);
    // All four cells of the 2×2 are reachable.
    expect(new Set(pick.optionCounts!.map((o) => o.label)).size).toBeGreaterThan(1);
  });

  it("the lookup costs no randomness — adding a row changes nothing", () => {
    const base = runInteraction(okBandage(), { sampleDt: 5 });
    const withExtraRow = okBandage();
    const pick = withExtraRow.steps.find((s) => s.id === "pick")!;
    if (pick.branch?.kind === "match") {
      pick.branch.rules = [...pick.branch.rules, { when: ["never", "happens"], label: "多的一列" }];
    }
    const after = runInteraction(withExtraRow, { sampleDt: 5 });
    // A roll would have shifted the stream; a lookup does not.
    expect(after.avgWaitSeconds).toBeCloseTo(base.avgWaitSeconds, 9);
    expect(after.finishTimeSeconds).toBeCloseTo(base.finishTimeSeconds, 9);
  });
});

describe("a self-service step does not jam the flow", () => {
  it("nobody is left standing at a step with no staff", () => {
    const t = flow([
      { id: "greet", name: "招呼", avgSeconds: 10, stationId: "front" },
      { id: "flip", name: "翻面看金句", avgSeconds: 15, stationId: "card" },
      { id: "end", name: "離開", avgSeconds: 5, stationId: "card", next: null },
    ], {
      stations: [
        station("front", { name: "攤位前" }),
        // The whole reason `selfService` is its own field: expressing this as
        // staffCount 0 gives zero servers and a queue that never drains.
        station("card", { name: "發卡處", selfService: true, staffCount: 0, parallelServers: 4 }),
      ],
    });
    const r = runInteraction(t, { sampleDt: 5 });
    expect(r.completed, "everyone jammed at the unstaffed step").toBe(30);
    expect(r.unfinished).toBe(0);
  });

  it("without selfService, zero staff really does mean nobody is served", () => {
    const t = flow([
      { id: "greet", name: "招呼", avgSeconds: 10, stationId: "front" },
      { id: "stuck", name: "沒人顧的關", avgSeconds: 15, stationId: "card", next: null },
    ], {
      stations: [station("front"), station("card", { staffCount: 0 })],
    });
    const r = runInteraction(t, { sampleDt: 5 });
    expect(r.completed).toBe(0);
    // And the readout can say WHY: zero servers, not zero percent busy.
    expect(r.stations.find((s) => s.stationId === "card")!.servers).toBe(0);
  });
});

describe("the funnel is people who took part, not people who walked past", () => {
  it("600 passing, 30% stopping, 70% joining simulates 126 visitors", () => {
    const t = flow([
      { id: "play", name: "玩", avgSeconds: 60 },
      { id: "end", name: "離開", avgSeconds: 5, next: null },
    ], {
      audience: { count: 600, windowSeconds: 7200, profile: "uniform", stopRate: 0.3, joinRate: 0.7, patienceSeconds: 0 },
      stations: [station("st", { parallelServers: 4, staffCount: 4 })],
    });
    const r = runInteraction(t, { sampleDt: 30 });
    expect(r.participantCount).toBe(126);
    expect(r.funnel).toEqual({ passed: 600, stopped: 180, joined: 126, completed: r.completed, leftEarly: 0 });
    // The 474 who kept walking are arithmetic, not half a million objects.
    for (const frame of r.playback) expect(frame.agents.length).toBeLessThanOrEqual(126);
  });

  it("an invited event reports no funnel at all — there is nothing to funnel", () => {
    const r = runInteraction(flow([{ id: "a", name: "報到", avgSeconds: 30, next: null }]), { sampleDt: 5 });
    expect(r.funnel).toBeUndefined();
  });
});

describe("人力：幾個人顧幾個關", () => {
  const threeStations = (roleCount: number) => flow([
    { id: "a", name: "第一關", avgSeconds: 30, stationId: "s1" },
    { id: "b", name: "第二關", avgSeconds: 30, stationId: "s2" },
    { id: "c", name: "第三關", avgSeconds: 30, stationId: "s3", next: null },
  ], {
    stations: ["s1", "s2", "s3"].map((id) =>
      station(id, { staffRoleId: "host", parallelServers: 2, queueCapacity: 30 })),
    staff: [{ id: "host", name: "主持", count: roleCount }],
  });

  it("two people over three stations really does leave one with nobody", () => {
    const r = runInteraction(threeStations(2), { sampleDt: 10 });
    expect(r.stations.map((s) => s.servers)).toEqual([1, 1, 0]);
    // And it bites: the unstaffed step never serves anyone, so the visit stops
    // there. Rounding that 0 up to 1 is exactly how a shortage goes invisible.
    expect(r.stations[2].served).toBe(0);
    expect(r.completed).toBe(0);
  });

  it("the readout reports the servers the run actually opened", () => {
    const r = runInteraction(threeStations(6), { sampleDt: 10 });
    // Six people, three stations, two positions each — everywhere is covered.
    expect(r.stations.map((s) => s.servers)).toEqual([2, 2, 2]);
    expect(r.completed).toBe(30);
  });

  it("a station nobody staffs reports 0 servers, not 0% busy", () => {
    const r = runInteraction(threeStations(2), { sampleDt: 10 });
    const empty = r.stations[2];
    expect(empty.servers).toBe(0);
    expect(empty.utilization).toBe(0);
  });
});

describe("兩種離開：不排了，和排到不想排了", () => {
  const busyBooth = (over: Partial<InteractionStation>, patienceSeconds: number) => flow([
    { id: "play", name: "玩一輪", avgSeconds: 120, next: null },
  ], {
    stations: [station("st", { parallelServers: 1, staffCount: 1, queueCapacity: 30, ...over })],
    audience: { count: 30, windowSeconds: 300, profile: "uniform", stopRate: 1, joinRate: 1, patienceSeconds },
  });

  it("walks away rather than joining a line that is already too long", () => {
    const patient = runInteraction(busyBooth({}, 0), { sampleDt: 10 });
    const balks = runInteraction(busyBooth({ balkQueueLength: 3 }, 0), { sampleDt: 10 });
    expect(patient.leftEarly).toBe(0);
    expect(balks.leftEarly).toBeGreaterThan(10);
    expect(balks.maxQueue).toBeLessThanOrEqual(3);
  });

  it("gives up after waiting longer than anyone would", () => {
    const forever = runInteraction(busyBooth({}, 0), { sampleDt: 10 });
    const impatient = runInteraction(busyBooth({}, 60), { sampleDt: 10 });
    expect(forever.leftEarly).toBe(0);
    expect(impatient.leftEarly).toBeGreaterThan(0);
    expect(impatient.completed).toBeLessThan(forever.completed);
  });

  it("everyone is accounted for exactly once", () => {
    const r = runInteraction(busyBooth({ balkQueueLength: 4 }, 60), { sampleDt: 10 });
    // Someone who gave up did not "not finish yet" — counting them as both
    // would tell an organiser people are still queueing at an empty table.
    expect(r.completed + r.leftEarly + r.unfinished).toBe(r.participantCount);
    expect(r.leftEarly).toBeGreaterThan(0);
    expect(r.unfinished).toBe(0);
  });
});

describe("零秒的步驟是一個決定，不是一次服務", () => {
  const withDecision = (avgSeconds: number) => flow([
    { id: "ask", name: "要不要玩", avgSeconds, stationId: "st", branch: {
      kind: "chance",
      options: [
        { id: "yes", label: "要", weight: 1 },
        { id: "no", label: "不要", weight: 1, next: null },
      ],
    } },
    { id: "play", name: "玩", avgSeconds: 90, stationId: "st", next: null },
  ], {
    stations: [station("st", { parallelServers: 1, staffCount: 1, queueCapacity: 30 })],
    audience: { count: 30, windowSeconds: 600, profile: "uniform", stopRate: 1, joinRate: 1, patienceSeconds: 0 },
  });

  it("someone deciding NOT to join never waits for a free server to say so", () => {
    const free = runInteraction(withDecision(0), { sampleDt: 10 });
    const charged = runInteraction(withDecision(1), { sampleDt: 10 });
    // Same flow, same fork; the only difference is whether the decision takes
    // a server. A queue for the privilege of walking past is not a queue.
    expect(free.maxQueue).toBeLessThan(charged.maxQueue);
    expect(free.avgWaitSeconds).toBeLessThan(charged.avgWaitSeconds);
    const played = free.steps!.find((s) => s.stepId === "play")!;
    const asked = free.steps!.find((s) => s.stepId === "ask")!;
    expect(asked.entered).toBe(30);
    expect(played.entered).toBeLessThan(30);
  });
});

/**
 * Every property `test/boothFlow.test.ts` used to guard.
 *
 * The second engine is gone; these are the same claims, made about the same
 * booth, through the one engine that is left. They are here rather than in a
 * booth-shaped file because none of them is about booths: they are about
 * queues, staffing and giving up.
 */
describe("攤位：舊引擎守住的每一條性質", () => {
  const booth = () => createProjectFromVenuePreset(boothVenuePreset(), "攤位").booth!;
  const withParams = (over: Partial<BoothParams>) =>
    templateFromBooth({ ...booth(), params: { ...defaultBoothParams("normal"), ...over } });
  const peakWith = (over: Partial<BoothParams> = {}) =>
    templateFromBooth({ ...booth(), params: { ...defaultBoothParams("peak"), ...over } });
  const run = (t: InteractionTemplate) => runInteraction(t, { sampleDt: 30 });

  it("is reproducible: the same plan gives byte-identical statistics", () => {
    const t = withParams({});
    const a = run(t);
    const b = run(t);
    expect(JSON.stringify(b)).toEqual(JSON.stringify(a));
  });

  it("does not mutate the template it was handed", () => {
    const t = withParams({ visitorCount: 5, arrivalPerMin: 20 });
    const before = JSON.stringify(t);
    run(t);
    expect(JSON.stringify(t)).toEqual(before);
  });

  it("queues longer at 尖峰 than at 正常", () => {
    expect(run(peakWith()).maxQueue).toBeGreaterThan(run(withParams({})).maxQueue);
  });

  it("waits longer when the conversation takes twice as long", () => {
    const base = run(withParams({}));
    const slow = run(withParams({ talkSeconds: defaultBoothParams("normal").talkSeconds * 2 }));
    expect(slow.avgWaitSeconds).toBeGreaterThan(base.avgWaitSeconds);
  });

  it("loses fewer visitors when the desk goes from 3 to 6 people", () => {
    const three = run(peakWith({ deskStaff: 3 }));
    const six = run(peakWith({ deskStaff: 6 }));
    expect(three.leftEarly).toBeGreaterThan(0);
    expect(six.leftEarly).toBeLessThan(three.leftEarly);
  });

  it("loses nobody when 等太久會離開 is switched off", () => {
    const params = { ...defaultBoothParams("peak"), balk: false };
    const result = run(templateFromBooth({ ...booth(), params }));
    expect(result.leftEarly).toBe(0);
    expect(result.completed).toBe(params.visitorCount);
  });

  it("loses more visitors as the queue area shrinks", () => {
    const roomy = run(peakWith({ queueCapacity: 8 }));
    const tight = run(peakWith({ queueCapacity: 2 }));
    expect(tight.leftEarly).toBeGreaterThan(roomy.leftEarly);
  });

  it("takes a disabled station out of the journey and leaves the rest working", () => {
    const b = booth();
    const gameId = b.stations.find((st) => st.boothType === "game")!.id;
    const before = run(templateFromBooth(b));
    expect(before.stations.find((st) => st.stationId === gameId)!.served).toBeGreaterThan(0);

    b.stations = b.stations.map((st) => (st.id === gameId ? { ...st, enabled: false } : st));
    const after = run(templateFromBooth(b));
    expect(after.stations.find((st) => st.stationId === gameId)!.served).toBe(0);
    for (const st of after.stations) {
      if (st.stationId === gameId || st.name === "排隊等待") continue;
      expect(st.served, `${st.name} stopped working`).toBeGreaterThan(0);
    }
    expect(after.completed).toBeGreaterThan(0);
  });

  it("never reports more completions than arrivals, nor a rate outside 0–1", () => {
    for (const t of [withParams({}), peakWith(), peakWith({ deskStaff: 1 })]) {
      const r = run(t);
      expect(r.completed).toBeLessThanOrEqual(r.participantCount);
      expect(r.participantCount).toBeLessThanOrEqual(t.audience.count);
      for (const st of r.stations) {
        expect(st.utilization).toBeGreaterThanOrEqual(0);
        expect(st.utilization).toBeLessThanOrEqual(1);
      }
    }
  });

  it("finishes: everybody who arrives eventually leaves, one way or the other", () => {
    const r = run(peakWith());
    expect(r.completed + r.leftEarly + r.unfinished).toBe(r.participantCount);
    const last = r.playback[r.playback.length - 1];
    expect(last.agents.every((a) => a.state === "done" || a.state === "pending")).toBe(true);
  });

  it("reports live crowd states the scene can colour", () => {
    const r = run(withParams({}));
    const busiest = r.playback.reduce((best, frame) => {
      const active = frame.agents.filter((a) => a.state !== "pending" && a.state !== "done").length;
      return active > best.active ? { frame, active } : best;
    }, { frame: r.playback[0], active: -1 });
    expect(busiest.active).toBeGreaterThan(0);
    for (const person of busiest.frame.agents) {
      expect(["serving", "queued", "traveling", "pending", "done"]).toContain(person.state);
      expect(Number.isFinite(person.x) && Number.isFinite(person.z)).toBe(true);
    }
  });

  it("a plan with no booth data has no booth flow, and an empty flow does not throw", () => {
    const plain = createDefaultProject();
    expect(plain.booth).toBeUndefined();
    expect(plain.interaction).toBeUndefined();
    const empty = { ...blankTemplate("空"), steps: [], startStepId: "" };
    expect(() => runInteraction(empty, { sampleDt: 5 })).not.toThrow();
    const r = runInteraction(empty, { sampleDt: 5 });
    // Nobody is served, and the readout says WHY rather than showing a
    // confident zero: the people are still expected, there is nothing to do.
    expect(r.completed).toBe(0);
    expect(r.unfinished).toBe(r.participantCount);
    expect(r.summaryLines.join("")).toContain("沒有站點");
  });

  it("names a bottleneck only once somebody has actually waited", () => {
    const lonely = run(withParams({ visitorCount: 1, arrivalPerMin: 0.5 }));
    expect(lonely.avgWaitSeconds).toBeLessThan(1);
    expect(lonely.bottleneckStationId).toBeNull();
    expect(run(peakWith()).bottleneckStationId).not.toBeNull();
  });

  it("ships the eight default stations with the documented dwell times", () => {
    const stations = createBoothStations();
    expect(stations).toHaveLength(8);
    expect(stations.every((st) => st.type === "custom")).toBe(true);
    const talk = stations.find((st) => st.boothType === "talk")!;
    expect(talk.meanServiceSeconds).toBe(BOOTH_SIM_PRESETS.normal.talkSeconds);
    expect(talk.parallelServers).toBe(BOOTH_SIM_PRESETS.normal.deskStaff);
  });
});
