/**
 * Event-flow discrete-event simulation (DES).
 *
 * Local, deterministic, no AI. Participants arrive, travel between service
 * stations, queue, get served by parallel staff, and follow profile branches
 * (e.g. prepaid skips payment). Playback samples are produced once so the UI
 * does not re-run the full model every animation frame.
 */

import type {
  EventScenario,
  ParticipantProfile,
  ParticipantProfileId,
  ServiceStation,
} from "./model";

// --- PRNG -----------------------------------------------------------------

/** Mulberry32 — small deterministic PRNG from a 32-bit seed. */
export function createRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Types ----------------------------------------------------------------

export interface StationStats {
  stationId: string;
  name: string;
  type: ServiceStation["type"];
  maxQueue: number;
  avgWaitSeconds: number;
  totalWaitSeconds: number;
  served: number;
  utilization: number; // 0–1 over [0, horizon]
  busyServerSeconds: number;
}

export interface SimulationResult {
  scenarioId: string;
  seed: number;
  participantCount: number;
  completed: number;
  unfinished: number;
  avgJourneySeconds: number;
  maxJourneySeconds: number;
  finishTimeSeconds: number;
  stations: StationStats[];
  bottleneckStationId: string | null;
  bottleneckName: string | null;
  summaryLines: string[];
  /** Sparse playback samples at fixed dt for canvas markers. */
  playback: PlaybackFrame[];
}

export interface PlaybackAgent {
  id: number;
  profileId: ParticipantProfileId;
  x: number;
  z: number;
  stationId: string | null;
  state: "traveling" | "queued" | "serving" | "done" | "pending";
}

export interface PlaybackFrame {
  t: number;
  agents: PlaybackAgent[];
  queues: Record<string, number>;
}

export interface ScenarioCompareResult {
  a: SimulationResult;
  b: SimulationResult;
  winner: "a" | "b" | "tie";
  reason: string;
  deltas: {
    finishTimeSeconds: number;
    avgJourneySeconds: number;
    maxQueue: number;
  };
}

type EventKind = "arrive" | "arriveStation" | "startService" | "finishService";

interface SimEvent {
  t: number;
  kind: EventKind;
  agentId: number;
  stationId?: string;
  /** Stable tie-break. */
  seq: number;
}

interface AgentRuntime {
  id: number;
  profileId: ParticipantProfileId;
  branch: string[];
  branchIndex: number;
  arrivalT: number;
  journeyStart: number;
  journeyEnd: number | null;
  state: PlaybackAgent["state"];
  x: number;
  z: number;
  stationId: string | null;
  waitAccum: number;
  enqueueT: number | null;
}

interface StationRuntime {
  def: ServiceStation;
  queue: number[]; // agent ids
  busyUntil: number[]; // per-server free time
  maxQueue: number;
  totalWait: number;
  served: number;
  busyServerSeconds: number;
}

// --- Helpers --------------------------------------------------------------

function dist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function effectiveServers(st: ServiceStation): number {
  if (st.staffCount <= 0 || st.parallelServers <= 0) return 0;
  return Math.max(1, Math.min(st.staffCount, st.parallelServers));
}

function normalizeProfiles(profiles: ParticipantProfile[]): ParticipantProfile[] {
  const sum = profiles.reduce((s, p) => s + Math.max(0, p.ratio), 0) || 1;
  return profiles.map((p) => ({ ...p, ratio: Math.max(0, p.ratio) / sum }));
}

function pickProfile(rng: () => number, profiles: ParticipantProfile[]): ParticipantProfile {
  const u = rng();
  let acc = 0;
  for (const p of profiles) {
    acc += p.ratio;
    if (u <= acc) return p;
  }
  return profiles[profiles.length - 1];
}

function arrivalTimes(
  count: number,
  windowSeconds: number,
  profile: EventScenario["arrivalProfile"],
  rng: () => number,
): number[] {
  const times: number[] = [];
  for (let i = 0; i < count; i++) {
    const u = rng();
    // Front-loaded: beta-ish via square — more early arrivals.
    const t = profile === "front-loaded" ? windowSeconds * (u * u) : windowSeconds * u;
    times.push(t);
  }
  times.sort((a, b) => a - b);
  return times;
}

function serviceDuration(st: ServiceStation, rng: () => number): number {
  const mean = Math.max(1, st.meanServiceSeconds);
  const variance = st.serviceVariance ?? mean * 0.2;
  // Box-Muller truncated to [0.3*mean, 2.5*mean]
  const u1 = Math.max(1e-9, rng());
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const raw = mean + z * Math.sqrt(Math.max(0, variance));
  return Math.min(mean * 2.5, Math.max(mean * 0.3, raw));
}

function pushEvent(heap: SimEvent[], ev: SimEvent): void {
  heap.push(ev);
  // Binary heap would be nicer; N≤200 events*participants is fine with sort-on-pop.
}

function popEvent(heap: SimEvent[]): SimEvent | undefined {
  if (!heap.length) return undefined;
  heap.sort((a, b) => a.t - b.t || a.seq - b.seq || a.agentId - b.agentId);
  return heap.shift();
}

function stationPos(st: ServiceStation): { x: number; z: number } {
  return { x: st.x, z: st.z };
}

// --- Core run -------------------------------------------------------------

export interface RunOptions {
  /** Playback sample interval (seconds). Default 1. */
  sampleDt?: number;
  /** Hard stop horizon. Default arrivalWindow + 2h. */
  maxHorizonSeconds?: number;
}

export function runDiscreteEvent(
  scenario: EventScenario,
  opts: RunOptions = {},
): SimulationResult {
  const rng = createRng(scenario.seed >>> 0 || 1);
  const profiles = normalizeProfiles(scenario.profiles);
  if (!scenario.stations.length || !profiles.length) {
    return emptyResult(scenario, "沒有站點或參與者設定。");
  }
  const stationMap = new Map(scenario.stations.map((s) => [s.id, s]));
  for (const p of profiles) {
    for (const sid of p.branch) {
      if (!stationMap.has(sid)) {
        return emptyResult(scenario, `站點 ${sid} 不存在於流程中。`);
      }
    }
  }

  const sampleDt = opts.sampleDt ?? 1;
  const maxHorizon =
    opts.maxHorizonSeconds ?? scenario.arrivalWindowSeconds + 7200;

  const stations: Record<string, StationRuntime> = {};
  for (const s of scenario.stations) {
    const n = effectiveServers(s);
    stations[s.id] = {
      def: s,
      queue: [],
      busyUntil: Array.from({ length: n }, () => 0),
      maxQueue: 0,
      totalWait: 0,
      served: 0,
      busyServerSeconds: 0,
    };
  }

  const arrivals = arrivalTimes(
    scenario.participantCount,
    scenario.arrivalWindowSeconds,
    scenario.arrivalProfile,
    rng,
  );

  const agents: AgentRuntime[] = [];
  const events: SimEvent[] = [];
  let seq = 0;

  const firstStationPos = stationPos(stationMap.get(profiles[0].branch[0])!);

  for (let i = 0; i < arrivals.length; i++) {
    const profile = pickProfile(rng, profiles);
    const branch = profile.branch.length ? profile.branch : [scenario.stations[0].id];
    agents.push({
      id: i,
      profileId: profile.id,
      branch,
      branchIndex: 0,
      arrivalT: arrivals[i],
      journeyStart: arrivals[i],
      journeyEnd: null,
      state: "pending",
      x: firstStationPos.x,
      z: firstStationPos.z,
      stationId: null,
      waitAccum: 0,
      enqueueT: null,
    });
    pushEvent(events, { t: arrivals[i], kind: "arrive", agentId: i, seq: seq++ });
  }

  const speed = Math.max(0.2, scenario.settings.speedMetersPerSecond);
  const playback: PlaybackFrame[] = [];
  let nextSample = 0;

  const snapshot = (t: number) => {
    const queues: Record<string, number> = {};
    for (const [id, st] of Object.entries(stations)) queues[id] = st.queue.length;
    playback.push({
      t,
      agents: agents.map((a) => ({
        id: a.id,
        profileId: a.profileId,
        x: a.x,
        z: a.z,
        stationId: a.stationId,
        state: a.state,
      })),
      queues: { ...queues },
    });
  };

  const tryStartService = (stationId: string, t: number) => {
    const st = stations[stationId];
    if (!st || !st.queue.length) return;
    // Find a free server
    let freeIdx = -1;
    let freeAt = Infinity;
    for (let i = 0; i < st.busyUntil.length; i++) {
      if (st.busyUntil[i] <= t + 1e-9 && st.busyUntil[i] < freeAt) {
        freeAt = st.busyUntil[i];
        freeIdx = i;
      }
    }
    if (freeIdx < 0) return;
    const agentId = st.queue.shift()!;
    const agent = agents[agentId];
    if (agent.enqueueT !== null) {
      agent.waitAccum += t - agent.enqueueT;
      st.totalWait += t - agent.enqueueT;
      agent.enqueueT = null;
    }
    agent.state = "serving";
    agent.stationId = stationId;
    agent.x = st.def.x;
    agent.z = st.def.z;
    const dur = serviceDuration(st.def, rng);
    st.busyUntil[freeIdx] = t + dur;
    st.busyServerSeconds += dur;
    pushEvent(events, {
      t: t + dur,
      kind: "finishService",
      agentId,
      stationId,
      seq: seq++,
    });
  };

  const enqueue = (agent: AgentRuntime, stationId: string, t: number) => {
    const st = stations[stationId];
    agent.state = "queued";
    agent.stationId = stationId;
    agent.x = st.def.x;
    agent.z = st.def.z;
    agent.enqueueT = t;
    st.queue.push(agent.id);
    st.maxQueue = Math.max(st.maxQueue, st.queue.length);
    tryStartService(stationId, t);
  };

  const sendToStation = (agent: AgentRuntime, stationId: string, t: number) => {
    const st = stationMap.get(stationId)!;
    const from = { x: agent.x, z: agent.z };
    const to = stationPos(st);
    const travel = dist(from, to) / speed;
    agent.state = "traveling";
    agent.stationId = stationId;
    // Approximate mid-travel position for samples; snap on arrive.
    agent.x = from.x;
    agent.z = from.z;
    pushEvent(events, {
      t: t + travel,
      kind: "arriveStation",
      agentId: agent.id,
      stationId,
      seq: seq++,
    });
  };

  let simT = 0;
  snapshot(0);

  while (events.length) {
    const ev = popEvent(events)!;
    if (ev.t > maxHorizon) break;
    // Emit samples up to this event.
    while (nextSample + sampleDt <= ev.t + 1e-9) {
      nextSample += sampleDt;
      // Interpolate traveling agents roughly toward their target station.
      for (const a of agents) {
        if (a.state === "traveling" && a.stationId) {
          const st = stationMap.get(a.stationId);
          if (st) {
            const d = dist(a, st);
            const step = speed * sampleDt;
            if (d > 1e-6) {
              const f = Math.min(1, step / d);
              a.x += (st.x - a.x) * f;
              a.z += (st.z - a.z) * f;
            }
          }
        }
      }
      snapshot(nextSample);
    }
    simT = ev.t;
    const agent = agents[ev.agentId];
    if (!agent) continue;

    switch (ev.kind) {
      case "arrive": {
        agent.journeyStart = ev.t;
        const first = agent.branch[0];
        if (!first) {
          agent.state = "done";
          agent.journeyEnd = ev.t;
          break;
        }
        // Spawn at first station (zero travel from "outside").
        agent.x = stationMap.get(first)!.x;
        agent.z = stationMap.get(first)!.z;
        enqueue(agent, first, ev.t);
        break;
      }
      case "arriveStation": {
        if (!ev.stationId) break;
        agent.x = stationMap.get(ev.stationId)!.x;
        agent.z = stationMap.get(ev.stationId)!.z;
        enqueue(agent, ev.stationId, ev.t);
        break;
      }
      case "finishService": {
        if (!ev.stationId) break;
        const st = stations[ev.stationId];
        st.served += 1;
        agent.branchIndex += 1;
        if (agent.branchIndex >= agent.branch.length) {
          agent.state = "done";
          agent.stationId = null;
          agent.journeyEnd = ev.t;
        } else {
          sendToStation(agent, agent.branch[agent.branchIndex], ev.t);
        }
        // Free server may take next in queue.
        tryStartService(ev.stationId, ev.t);
        break;
      }
      case "startService":
        break;
    }
  }

  // Final sample
  if (!playback.length || playback[playback.length - 1].t < simT) snapshot(simT);

  const completedAgents = agents.filter((a) => a.journeyEnd !== null);
  const unfinished = agents.length - completedAgents.length;
  const journeys = completedAgents.map((a) => (a.journeyEnd! - a.journeyStart));
  const avgJourney =
    journeys.length ? journeys.reduce((s, v) => s + v, 0) / journeys.length : 0;
  const maxJourney = journeys.length ? Math.max(...journeys) : 0;
  const finishTime = journeys.length
    ? Math.max(...completedAgents.map((a) => a.journeyEnd!))
    : simT;

  const horizon = Math.max(finishTime, 1);
  const stationStats: StationStats[] = scenario.stations.map((s) => {
    const st = stations[s.id];
    const servers = effectiveServers(s);
    return {
      stationId: s.id,
      name: s.name,
      type: s.type,
      maxQueue: st.maxQueue,
      avgWaitSeconds: st.served ? st.totalWait / st.served : 0,
      totalWaitSeconds: st.totalWait,
      served: st.served,
      utilization: Math.min(1, st.busyServerSeconds / (horizon * servers)),
      busyServerSeconds: st.busyServerSeconds,
    };
  });

  let bottleneck: StationStats | null = null;
  for (const s of stationStats) {
    if (!bottleneck || s.maxQueue > bottleneck.maxQueue ||
      (s.maxQueue === bottleneck.maxQueue && s.avgWaitSeconds > bottleneck.avgWaitSeconds)) {
      bottleneck = s;
    }
  }
  if (bottleneck && bottleneck.maxQueue < 2) bottleneck = null;

  const summaryLines: string[] = [];
  summaryLines.push(
    `完成 ${completedAgents.length}/${agents.length} 人，總時長約 ${formatMin(finishTime)}。`,
  );
  if (bottleneck) {
    summaryLines.push(
      `最塞：${bottleneck.name}（最大排隊 ${bottleneck.maxQueue} 人，平均等待 ${Math.round(bottleneck.avgWaitSeconds)} 秒）。`,
    );
  } else {
    summaryLines.push("未偵測到明顯站點瓶頸。");
  }
  summaryLines.push(`平均全程 ${Math.round(avgJourney)} 秒。`);

  return {
    scenarioId: scenario.id,
    seed: scenario.seed,
    participantCount: scenario.participantCount,
    completed: completedAgents.length,
    unfinished,
    avgJourneySeconds: avgJourney,
    maxJourneySeconds: maxJourney,
    finishTimeSeconds: finishTime,
    stations: stationStats,
    bottleneckStationId: bottleneck?.stationId ?? null,
    bottleneckName: bottleneck?.name ?? null,
    summaryLines,
    playback,
  };
}

function emptyResult(scenario: EventScenario, msg: string): SimulationResult {
  return {
    scenarioId: scenario.id,
    seed: scenario.seed,
    participantCount: scenario.participantCount,
    completed: 0,
    unfinished: scenario.participantCount,
    avgJourneySeconds: 0,
    maxJourneySeconds: 0,
    finishTimeSeconds: 0,
    stations: [],
    bottleneckStationId: null,
    bottleneckName: null,
    summaryLines: [msg],
    playback: [],
  };
}

function formatMin(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m} 分 ${s} 秒`;
}

/** Compare two scenario results (same or different layouts). */
export function compareScenarioResults(
  a: SimulationResult,
  b: SimulationResult,
): ScenarioCompareResult {
  const maxQueueA = Math.max(0, ...a.stations.map((s) => s.maxQueue));
  const maxQueueB = Math.max(0, ...b.stations.map((s) => s.maxQueue));
  const deltas = {
    finishTimeSeconds: b.finishTimeSeconds - a.finishTimeSeconds,
    avgJourneySeconds: b.avgJourneySeconds - a.avgJourneySeconds,
    maxQueue: maxQueueB - maxQueueA,
  };

  // Prefer lower finish time, then lower max queue, then lower avg journey.
  let score = 0;
  if (Math.abs(deltas.finishTimeSeconds) > 5) {
    score += deltas.finishTimeSeconds < 0 ? 2 : -2;
  }
  if (Math.abs(deltas.maxQueue) >= 1) {
    score += deltas.maxQueue < 0 ? 2 : -2;
  }
  if (Math.abs(deltas.avgJourneySeconds) > 5) {
    score += deltas.avgJourneySeconds < 0 ? 1 : -1;
  }

  let winner: "a" | "b" | "tie" = "tie";
  if (score > 0) winner = "b";
  else if (score < 0) winner = "a";

  let reason: string;
  if (winner === "tie") {
    reason = "兩方案完成時間與排隊大致相當。";
  } else {
    const better = winner === "a" ? "A" : "B";
    const parts: string[] = [];
    if (Math.abs(deltas.finishTimeSeconds) > 5) {
      parts.push(
        `完成時間差 ${Math.abs(Math.round(deltas.finishTimeSeconds))} 秒`,
      );
    }
    if (Math.abs(deltas.maxQueue) >= 1) {
      parts.push(`最大排隊差 ${Math.abs(deltas.maxQueue)} 人`);
    }
    reason = `方案 ${better} 較順（${parts.join("、") || "整體指標較佳"}）。`;
    if (winner === "b" && b.bottleneckName) {
      reason += ` B 瓶頸：${b.bottleneckName}。`;
    } else if (winner === "a" && a.bottleneckName) {
      reason += ` A 瓶頸：${a.bottleneckName}。`;
    }
  }

  return { a, b, winner, reason, deltas };
}

/** Deep-clone a scenario and apply a patch (for A/B variants). */
export function cloneScenario(
  scenario: EventScenario,
  patch?: Partial<EventScenario> & { stationPatches?: Record<string, Partial<ServiceStation>> },
): EventScenario {
  const stations = scenario.stations.map((s) => {
    const p = patch?.stationPatches?.[s.id];
    return p ? { ...s, ...p } : { ...s };
  });
  const { stationPatches: _sp, ...rest } = patch ?? {};
  return {
    ...scenario,
    ...rest,
    id: rest.id ?? scenario.id,
    stations,
    profiles: (rest.profiles ?? scenario.profiles).map((p) => ({
      ...p,
      branch: [...p.branch],
    })),
    settings: { ...(rest.settings ?? scenario.settings) },
  };
}

/**
 * Build A/B variants for check-in vs payment staffing.
 *
 * A 同桌: one shared desk — payment has no own servers; pay-on-site spends
 *   extra time at checkin (checkin mean += payment mean), prepaid keeps checkin only.
 * B 分桌: checkin and payment each have their own server and can pipeline.
 */
export function buildCheckinPaymentVariants(base: EventScenario): {
  combined: EventScenario;
  separated: EventScenario;
} {
  const checkin = base.stations.find((s) => s.type === "checkin");
  const payment = base.stations.find((s) => s.type === "payment");
  if (!checkin || !payment) {
    return {
      combined: cloneScenario(base, { name: "A 同桌" }),
      separated: cloneScenario(base, { name: "B 分桌" }),
    };
  }

  const comboMean = checkin.meanServiceSeconds + payment.meanServiceSeconds;
  const combinedStations = base.stations.map((s) => {
    if (s.id === checkin.id) {
      return {
        ...s,
        name: "報到＋收費",
        meanServiceSeconds: comboMean,
        staffCount: 1,
        parallelServers: 1,
      };
    }
    if (s.id === payment.id) {
      // Keep node for spatial binding but take it out of active service.
      return { ...s, x: checkin.x, z: checkin.z, staffCount: 0, parallelServers: 0, meanServiceSeconds: 1 };
    }
    return { ...s };
  });
  // All profiles skip the inert payment station; service time already folded into checkin.
  const combinedProfiles = base.profiles.map((p) => ({
    ...p,
    branch: p.branch.filter((id) => id !== payment.id),
  }));

  const combined: EventScenario = {
    ...base,
    id: `${base.id}_combined`,
    name: "A 報到＋收費同桌",
    stations: combinedStations,
    profiles: combinedProfiles,
    settings: { ...base.settings },
  };

  const separated = cloneScenario(base, {
    id: `${base.id}_separated`,
    name: "B 報到／收費分桌",
    stationPatches: {
      [checkin.id]: {
        staffCount: Math.max(1, checkin.staffCount),
        parallelServers: Math.max(1, checkin.parallelServers),
        meanServiceSeconds: checkin.meanServiceSeconds,
      },
      [payment.id]: {
        x: checkin.x + 2.5,
        z: checkin.z,
        staffCount: Math.max(1, payment.staffCount),
        parallelServers: Math.max(1, payment.parallelServers),
        meanServiceSeconds: payment.meanServiceSeconds,
      },
    },
  });

  return { combined, separated };
}

/** Sample playback frame at time t (nearest). */
export function frameAt(result: SimulationResult, t: number): PlaybackFrame | null {
  if (!result.playback.length) return null;
  let best = result.playback[0];
  for (const f of result.playback) {
    if (Math.abs(f.t - t) < Math.abs(best.t - t)) best = f;
  }
  return best;
}
