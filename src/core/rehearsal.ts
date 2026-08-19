/**
 * Rehearsal narrative — the simulation, told the way a partner would tell it.
 *
 * The DES engine already produces queues, waits and utilisation. None of that
 * is meaningful to someone seeing the plan for the first time, so this module
 * turns the same result into wall-clock sentences ("17:31 收費區開始塞車") and
 * into before/after numbers a person can compare at a glance.
 *
 * Pure functions only — no DOM, no rendering, no engine changes.
 */

import type { SimulationResult } from "./eventFlow";

export const DEFAULT_START_CLOCK = "17:20";

export type RehearsalTone = "info" | "warn" | "good";

export interface RehearsalEvent {
  /** Seconds from the start of the rehearsal. */
  t: number;
  /** Wall clock, e.g. "17:31". */
  clock: string;
  icon: string;
  text: string;
  tone: RehearsalTone;
}

/** "17:20" + 680s → "17:31". Wraps past midnight. */
export function formatClock(startClock: string, tSeconds: number): string {
  const [h, m] = startClock.split(":").map((v) => parseInt(v, 10));
  const base = (Number.isFinite(h) ? h : 0) * 3600 + (Number.isFinite(m) ? m : 0) * 60;
  const total = Math.max(0, Math.round(base + tSeconds));
  const hh = Math.floor(total / 3600) % 24;
  const mm = Math.floor((total % 3600) / 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** "3 分 20 秒" / "45 秒" — never decimals, never units a partner has to decode. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${m} 分 ${rest} 秒` : `${m} 分`;
}

export interface RehearsalOptions {
  startClock?: string;
  /** Queue length that counts as "starting to back up". */
  busyQueue?: number;
  /** Queue length that counts as congestion. */
  jamQueue?: number;
  maxEvents?: number;
}

/**
 * Build the rehearsal timeline. Each station contributes at most three beats —
 * a queue forming, congestion, and recovery — so the list stays readable
 * instead of turning into a log.
 */
export function buildRehearsalTimeline(
  result: SimulationResult,
  opts: RehearsalOptions = {},
): RehearsalEvent[] {
  const startClock = opts.startClock ?? DEFAULT_START_CLOCK;
  const busy = opts.busyQueue ?? 3;
  const jam = opts.jamQueue ?? 6;
  const maxEvents = opts.maxEvents ?? 12;
  const nameOf = new Map(result.stations.map((s) => [s.stationId, s.name]));
  const events: RehearsalEvent[] = [];
  const add = (t: number, icon: string, text: string, tone: RehearsalTone) =>
    events.push({ t, clock: formatClock(startClock, t), icon, text, tone });

  const frames = result.playback;
  if (frames.length) {
    const firstMoving = frames.find((f) => f.agents.some((a) => a.state !== "pending"));
    if (firstMoving) add(firstMoving.t, "🚶", "夥伴開始進場", "info");
  }

  const seenBusy = new Set<string>();
  const seenJam = new Set<string>();
  const seenClear = new Set<string>();
  for (const frame of frames) {
    for (const [stationId, queue] of Object.entries(frame.queues)) {
      const name = nameOf.get(stationId) ?? "站點";
      if (queue >= busy && !seenBusy.has(stationId)) {
        seenBusy.add(stationId);
        add(frame.t, "⏳", `${name}開始排隊`, "info");
      }
      if (queue >= jam && !seenJam.has(stationId)) {
        seenJam.add(stationId);
        add(frame.t, "⚠️", `${name}開始塞車，${queue} 個人在等`, "warn");
      }
      if (seenJam.has(stationId) && queue <= 1 && !seenClear.has(stationId)) {
        seenClear.add(stationId);
        add(frame.t, "✅", `${name}恢復順暢`, "good");
      }
    }
  }

  if (result.finishTimeSeconds > 0) {
    add(result.finishTimeSeconds, "🎉", "全部就位，活動可以開始", "good");
  }

  events.sort((a, b) => a.t - b.t);
  if (events.length <= maxEvents) return events;
  // Problems win the limited slots, earliest first — but the cap is a real cap:
  // a list nobody can scan is no more useful than no list at all.
  const problems = events.filter((e) => e.tone === "warn").slice(0, maxEvents);
  const rest = events.filter((e) => e.tone !== "warn").slice(0, Math.max(0, maxEvents - problems.length));
  return [...problems, ...rest].sort((a, b) => a.t - b.t);
}

// --- before / after in plain language --------------------------------------

export interface PlainMetrics {
  maxQueue: number;
  maxQueueWhere: string;
  avgWaitSeconds: number;
  worstWaitSeconds: number;
  finishSeconds: number;
}

export function plainMetrics(result: SimulationResult): PlainMetrics {
  let maxQueue = 0;
  let where = "";
  let worstWait = 0;
  let waitSum = 0;
  for (const s of result.stations) {
    if (s.maxQueue > maxQueue) { maxQueue = s.maxQueue; where = s.name; }
    worstWait = Math.max(worstWait, s.avgWaitSeconds);
    waitSum += s.avgWaitSeconds;
  }
  return {
    maxQueue,
    maxQueueWhere: where || "現場",
    avgWaitSeconds: result.stations.length ? waitSum / result.stations.length : 0,
    worstWaitSeconds: worstWait,
    finishSeconds: result.finishTimeSeconds,
  };
}

export type PlainDelta = "better" | "worse" | "same";

export interface PlainComparisonRow {
  label: string;
  before: string;
  after: string;
  delta: PlainDelta;
}

export interface PlainComparison {
  rows: PlainComparisonRow[];
  /** One sentence a partner can act on. */
  verdict: string;
  /** True when the suggestion is worth applying. */
  suggestionWins: boolean;
}

function deltaOf(before: number, after: number, tolerance: number): PlainDelta {
  if (Math.abs(after - before) <= tolerance) return "same";
  return after < before ? "better" : "worse";
}

/**
 * Compare the current plan against a suggestion using only numbers a person
 * already understands: how many people are queuing, how long they wait, when
 * everyone is finally in.
 */
export function comparePlainMetrics(before: PlainMetrics, after: PlainMetrics): PlainComparison {
  const rows: PlainComparisonRow[] = [
    {
      label: "最多幾個人在排隊",
      before: `${before.maxQueue} 人（${before.maxQueueWhere}）`,
      after: `${after.maxQueue} 人（${after.maxQueueWhere}）`,
      delta: deltaOf(before.maxQueue, after.maxQueue, 0),
    },
    {
      label: "平均要等多久",
      before: formatDuration(before.avgWaitSeconds),
      after: formatDuration(after.avgWaitSeconds),
      delta: deltaOf(before.avgWaitSeconds, after.avgWaitSeconds, 5),
    },
    {
      label: "最久要等多久",
      before: formatDuration(before.worstWaitSeconds),
      after: formatDuration(after.worstWaitSeconds),
      delta: deltaOf(before.worstWaitSeconds, after.worstWaitSeconds, 5),
    },
    {
      label: "多久全部就位",
      before: formatDuration(before.finishSeconds),
      after: formatDuration(after.finishSeconds),
      delta: deltaOf(before.finishSeconds, after.finishSeconds, 15),
    },
  ];

  const better = rows.filter((r) => r.delta === "better").length;
  const worse = rows.filter((r) => r.delta === "worse").length;
  const suggestionWins = better > worse;

  let verdict: string;
  if (better === 0 && worse === 0) {
    verdict = "兩個方案差不多，保持目前的就好。";
  } else if (suggestionWins) {
    const gains: string[] = [];
    if (after.maxQueue < before.maxQueue) gains.push(`排隊少 ${before.maxQueue - after.maxQueue} 人`);
    if (after.avgWaitSeconds < before.avgWaitSeconds - 5) {
      gains.push(`平均少等 ${formatDuration(before.avgWaitSeconds - after.avgWaitSeconds)}`);
    }
    if (after.finishSeconds < before.finishSeconds - 15) {
      gains.push(`早 ${formatDuration(before.finishSeconds - after.finishSeconds)} 全部就位`);
    }
    verdict = gains.length ? `建議方案比較順：${gains.join("、")}。` : "建議方案比較順。";
  } else {
    verdict = "目前方案比較好，先不用改。";
  }
  return { rows, verdict, suggestionWins };
}
