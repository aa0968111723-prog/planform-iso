import { describe, expect, it } from "vitest";
import {
  buildRoleBriefing,
  PARTNER_ROLES,
  partnerEmphasis,
  partnerMarks,
  partnerStatus,
  roleFocus,
  type PartnerRole,
} from "../src/core/partner";
import {
  buildRehearsalTimeline,
  comparePlainMetrics,
  DEFAULT_START_CLOCK,
  formatClock,
  formatDuration,
  plainMetrics,
} from "../src/core/rehearsal";
import type { SimulationResult, StationStats } from "../src/core/eventFlow";
import { createDefaultProject, type Project, type Route, type SceneObject, type Zone, type ZoneType } from "../src/core/model";
import { migrateObject } from "../src/core/migrate";

// --- fixtures ---------------------------------------------------------------

function zone(type: ZoneType, over: Partial<Zone> = {}): Zone {
  return {
    id: `z-${type}`, type, name: `${type}區`, x: 3, z: 3, width: 2, depth: 2,
    color: "#38bdf8", locked: false, hidden: false, icon: "🔷", capacity: null, ...over,
  };
}
function route(id: string, type: Route["type"], over: Partial<Route> = {}): Route {
  return {
    id, type, name: `${id}動線`, color: "#38bdf8", visible: true,
    points: [{ x: 0, z: 0 }, { x: 4, z: 4 }], ...over,
  };
}
function obj(id: string, over: Partial<SceneObject> & { kind: SceneObject["kind"] }): SceneObject {
  return migrateObject({ id, x: 2, z: 2, rotationDeg: 0, locked: false, hidden: false, ...over });
}

/** A plan with a registration desk, a payment desk and the usual zones. */
function plan(): Project {
  const p = createDefaultProject();
  p.zones = [zone("registration"), zone("shoe"), zone("backpack"), zone("group"), zone("life")];
  p.objects = [
    obj("o-reg", { kind: "regTable", serviceRole: "checkin" }),
    obj("o-pay", { kind: "regTable", serviceRole: "payment" }),
    obj("o-door", { kind: "door" }),
    obj("o-chair", { kind: "chair" }),
  ];
  p.routes = [route("r1", "entry"), route("r2", "registration"), route("r3", "shoe"), route("r4", "staff")];
  return p;
}

function station(over: Partial<StationStats> & { stationId: string; name: string }): StationStats {
  return {
    type: "checkin", maxQueue: 0, avgWaitSeconds: 0, totalWaitSeconds: 0,
    served: 0, utilization: 0, busyServerSeconds: 0, ...over,
  };
}

function simResult(over: Partial<SimulationResult> = {}): SimulationResult {
  return {
    scenarioId: "s1", seed: 1, participantCount: 60, completed: 60, unfinished: 0,
    avgJourneySeconds: 300, maxJourneySeconds: 900, finishTimeSeconds: 1200,
    stations: [
      station({ stationId: "checkin", name: "報到", maxQueue: 8, avgWaitSeconds: 120 }),
      station({ stationId: "payment", name: "收費", type: "payment", maxQueue: 3, avgWaitSeconds: 40 }),
    ],
    bottleneckStationId: "checkin", bottleneckName: "報到", summaryLines: [],
    playback: [
      { t: 0, agents: [{ id: 1, profileId: "prepaid", x: 0, z: 0, stationId: null, state: "pending" }], queues: { checkin: 0, payment: 0 } },
      { t: 60, agents: [{ id: 1, profileId: "prepaid", x: 1, z: 1, stationId: null, state: "traveling" }], queues: { checkin: 1, payment: 0 } },
      { t: 180, agents: [], queues: { checkin: 4, payment: 0 } },
      { t: 240, agents: [], queues: { checkin: 8, payment: 1 } },
      { t: 600, agents: [], queues: { checkin: 1, payment: 0 } },
    ],
    ...over,
  };
}

// --- roles ------------------------------------------------------------------

describe("partner roles", () => {
  it("offers exactly the five partner viewpoints", () => {
    expect(PARTNER_ROLES.map((r) => r.id)).toEqual(["all", "checkin", "payment", "guide", "life"]);
  });

  it("treats 全部 as an unfiltered overview", () => {
    expect(roleFocus("all")).toBeNull();
    const e = partnerEmphasis(plan(), "all");
    expect(Object.values(e.zones).every((v) => v === "primary")).toBe(true);
    expect(Object.values(e.routes).every((v) => v === "primary")).toBe(true);
    expect(Object.values(e.objects).every((v) => v === "primary")).toBe(true);
    expect(e.empty).toBe(false);
  });

  it("highlights only the check-in team's own places and flows", () => {
    const p = plan();
    const e = partnerEmphasis(p, "checkin");
    expect(e.zones["z-registration"]).toBe("primary");
    expect(e.zones["z-life"]).toBe("muted");
    expect(e.routes.r1).toBe("primary"); // entry
    expect(e.routes.r2).toBe("primary"); // registration
    expect(e.routes.r4).toBe("muted"); // staff
    expect(e.objects["o-reg"]).toBe("primary");
    expect(e.objects["o-pay"]).toBe("muted"); // payment belongs to another team
    expect(e.objects["o-chair"]).toBe("muted");
  });

  it("separates the payment team from the check-in team", () => {
    const e = partnerEmphasis(plan(), "payment");
    expect(e.objects["o-pay"]).toBe("primary");
    expect(e.objects["o-reg"]).toBe("muted");
  });

  it("reports an empty role instead of showing a blank plan", () => {
    const p = createDefaultProject();
    expect(partnerEmphasis(p, "life").empty).toBe(true);
    expect(buildRoleBriefing(p, "life").emptyHint).toContain("生活組");
  });
});

// --- briefing ---------------------------------------------------------------

describe("role briefing", () => {
  it("answers where you stand, where people come from and where they go next", () => {
    const b = buildRoleBriefing(plan(), "checkin");
    expect(b.title).toBe("報到組");
    expect(b.youAre).toBe("registration區");
    expect(b.peopleComeFrom).toBeTruthy();
    expect(b.nextStop).toBeTruthy();
    expect(b.nextStop).not.toBe(b.youAre);
    expect(b.steps.length).toBeGreaterThanOrEqual(3);
    expect(b.steps.map((s) => s.index)).toEqual(b.steps.map((_, i) => i + 1));
    expect(b.emptyHint).toBeNull();
  });

  it("never leaks measurements or coordinates into partner text", () => {
    const engineering = /\d+\s*(cm|mm|公分|公尺|m\b)|[XZ]\s*[:：]|snap|吸附/i;
    for (const role of PARTNER_ROLES.map((r) => r.id as PartnerRole)) {
      const b = buildRoleBriefing(plan(), role);
      const text = [b.title, b.youAre, b.peopleComeFrom, b.nextStop, b.emptyHint, ...b.steps.map((s) => s.text)]
        .filter(Boolean)
        .join(" ");
      expect(text, `${role}: ${text}`).not.toMatch(engineering);
    }
  });

  it("tells the whole journey in order for 全部", () => {
    const b = buildRoleBriefing(plan(), "all");
    expect(b.title).toBe("整場流程");
    expect(b.steps.length).toBeGreaterThan(2);
    expect(b.steps[0].text).toContain("進場");
    expect(b.steps[b.steps.length - 1].text).toContain("最後");
  });
});

// --- marks ------------------------------------------------------------------

describe("canvas marks", () => {
  const issues = [
    { id: "i1", severity: "info", shortTitle: "建議", message: "訊息一", suggestedAction: "動作一", focus: { x: 1, z: 1 } },
    { id: "i2", severity: "error", shortTitle: "擋門", message: "訊息二", suggestedAction: "移開門前物件", focus: { x: 2, z: 2 } },
    { id: "i3", severity: "warning", shortTitle: "走道過窄", message: "訊息三", focus: { x: 3, z: 3 } },
    { id: "i4", severity: "warning", shortTitle: "第二個警告", message: "訊息四", focus: { x: 4, z: 4 } },
  ];

  it("puts the worst problems first and caps how many land on the plan", () => {
    const marks = partnerMarks(issues);
    expect(marks).toHaveLength(3);
    expect(marks[0].tone).toBe("bad");
    expect(marks.map((m) => m.tone)).toEqual(["bad", "warn", "warn"]);
  });

  it("keeps the pin label short and the instruction for the list", () => {
    const [worst] = partnerMarks(issues);
    expect(worst.text).toBe("擋門");
    expect(worst.action).toBe("移開門前物件");
  });

  it("falls back to the message when an issue has no suggested action", () => {
    const [mark] = partnerMarks([issues[2]]);
    expect(mark.action).toBe("訊息三");
  });

  it("summarises the plan as a traffic light", () => {
    expect(partnerStatus(partnerMarks(issues)).tone).toBe("bad");
    expect(partnerStatus(partnerMarks([issues[2]])).tone).toBe("warn");
    expect(partnerStatus([]).tone).toBe("ok");
    expect(partnerStatus([]).text).not.toMatch(/\d/);
  });
});

// --- rehearsal narrative ----------------------------------------------------

describe("rehearsal timeline", () => {
  it("reads the clock forward from the start time", () => {
    expect(formatClock("17:20", 0)).toBe("17:20");
    expect(formatClock("17:20", 480)).toBe("17:28");
    expect(formatClock("17:20", 660)).toBe("17:31");
    expect(formatClock("23:50", 1200)).toBe("00:10"); // wraps past midnight
  });

  it("says durations the way a person would", () => {
    expect(formatDuration(45)).toBe("45 秒");
    expect(formatDuration(120)).toBe("2 分");
    expect(formatDuration(200)).toBe("3 分 20 秒");
  });

  it("narrates arrival, queueing, congestion, recovery and finish", () => {
    const events = buildRehearsalTimeline(simResult(), { startClock: "17:20" });
    const texts = events.map((e) => e.text);
    expect(texts.some((t) => t.includes("開始進場"))).toBe(true);
    expect(texts.some((t) => t === "報到開始排隊")).toBe(true);
    expect(texts.some((t) => t.includes("報到開始塞車"))).toBe(true);
    expect(texts.some((t) => t.includes("恢復順暢"))).toBe(true);
    expect(texts.some((t) => t.includes("全部就位"))).toBe(true);
    // Sorted, and each beat carries a wall clock rather than a raw offset.
    expect(events.map((e) => e.t)).toEqual([...events.map((e) => e.t)].sort((a, b) => a - b));
    for (const e of events) expect(e.clock).toMatch(/^\d{2}:\d{2}$/);
  });

  it("uses the example phrasing from the brief", () => {
    const events = buildRehearsalTimeline(simResult(), { startClock: "17:20" });
    const queueing = events.find((e) => e.text === "報到開始排隊");
    expect(queueing?.clock).toBe("17:23");
    expect(queueing?.tone).toBe("info");
    const jam = events.find((e) => e.text.includes("塞車"));
    expect(jam?.tone).toBe("warn");
  });

  it("caps the list at a readable length, giving problems the slots", () => {
    const many = simResult({
      playback: Array.from({ length: 40 }, (_, i) => ({
        t: i * 30,
        agents: [],
        queues: Object.fromEntries([[`s${i}`, 9]]),
      })),
      stations: Array.from({ length: 40 }, (_, i) => station({ stationId: `s${i}`, name: `站${i}` })),
    });
    const events = buildRehearsalTimeline(many, { maxEvents: 8 });
    expect(events.length).toBeLessThanOrEqual(8);
    expect(events.filter((e) => e.tone === "warn").length).toBeGreaterThan(0);
    // With no start clock the default one is used.
    const [first] = buildRehearsalTimeline(simResult());
    expect(first.clock).toBe(formatClock(DEFAULT_START_CLOCK, first.t));
  });

  it("stays quiet when nothing was simulated", () => {
    const empty = simResult({ playback: [], finishTimeSeconds: 0, stations: [] });
    expect(buildRehearsalTimeline(empty)).toEqual([]);
  });
});

// --- before / after ---------------------------------------------------------

describe("plain-language comparison", () => {
  it("summarises a result without engineering vocabulary", () => {
    const m = plainMetrics(simResult());
    expect(m.maxQueue).toBe(8);
    expect(m.maxQueueWhere).toBe("報到");
    expect(m.worstWaitSeconds).toBe(120);
    expect(m.finishSeconds).toBe(1200);
  });

  it("calls out a genuinely better suggestion", () => {
    const before = plainMetrics(simResult());
    const after = plainMetrics(simResult({
      finishTimeSeconds: 900,
      stations: [
        station({ stationId: "checkin", name: "報到", maxQueue: 3, avgWaitSeconds: 40 }),
        station({ stationId: "payment", name: "收費", type: "payment", maxQueue: 2, avgWaitSeconds: 20 }),
      ],
    }));
    const cmp = comparePlainMetrics(before, after);
    expect(cmp.suggestionWins).toBe(true);
    expect(cmp.verdict).toContain("建議方案比較順");
    expect(cmp.verdict).toContain("排隊少 5 人");
    expect(cmp.rows.map((r) => r.label)).toEqual([
      "最多幾個人在排隊", "平均要等多久", "最久要等多久", "多久全部就位",
    ]);
    expect(cmp.rows[0].delta).toBe("better");
    // Values are human units, never raw seconds or percentages.
    for (const row of cmp.rows) {
      expect(`${row.before} ${row.after}`).not.toMatch(/utilization|%|秒數|throughput/i);
    }
  });

  it("tells the user to keep their own plan when the suggestion is worse", () => {
    const before = plainMetrics(simResult());
    const after = plainMetrics(simResult({
      finishTimeSeconds: 2000,
      stations: [station({ stationId: "checkin", name: "報到", maxQueue: 20, avgWaitSeconds: 400 })],
    }));
    const cmp = comparePlainMetrics(before, after);
    expect(cmp.suggestionWins).toBe(false);
    expect(cmp.verdict).toContain("目前方案比較好");
  });

  it("says so plainly when the two plans behave the same", () => {
    const m = plainMetrics(simResult());
    const cmp = comparePlainMetrics(m, m);
    expect(cmp.suggestionWins).toBe(false);
    expect(cmp.verdict).toContain("差不多");
    expect(cmp.rows.every((r) => r.delta === "same")).toBe(true);
  });
});
