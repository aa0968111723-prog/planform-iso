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
  RoutePoint,
  ServiceStation,
} from "./model";
import { buildTravelPath, pointAtPolyline, queuePlacement, routeLength } from "./simSpatial";

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
  /**
   * How many service positions actually opened this run. 0 means nobody is
   * staffing it, which is a different statement from "0% busy" — and the
   * difference is exactly what a staffing readout has to be able to say.
   */
  servers: number;
}

/** One step of an interaction flow, as it actually ran. */
export interface StepStats {
  stepId: string;
  name: string;
  entered: number;
  avgSeconds: number;
  /** How often each option came up: 「怪獸：拖延 42 人」. Absent when there is no fork. */
  optionCounts?: { label: string; count: number }[];
}

/** 經過 → 停下 → 參加 → 完成, for an organiser rather than for a marketer. */
export interface FunnelStats {
  passed: number;
  stopped: number;
  joined: number;
  completed: number;
  leftEarly: number;
}

export interface StaffLoadLine {
  roleId: string;
  roleName: string;
  /** Plain language. The raw fraction is never the thing the user is shown. */
  phrase: string;
  busyFraction: number;
  stationNames: string[];
  /** A station under this role got nobody. */
  shortage: boolean;
}

export interface SimulationResult {
  scenarioId: string;
  seed: number;
  participantCount: number;
  completed: number;
  unfinished: number;
  avgJourneySeconds: number;
  maxJourneySeconds: number;
  /** Sum of every participant's accumulated queue wait. */
  totalWaitSeconds: number;
  /** Total queue wait divided by all participants, not by stations or visits. */
  avgWaitSeconds: number;
  /** Peak queue at any one station during the run. */
  maxQueue: number;
  maxQueueWhere: string | null;
  finishTimeSeconds: number;
  spatialBottlenecks: SpatialBottleneck[];
  stations: StationStats[];
  bottleneckStationId: string | null;
  bottleneckName: string | null;
  summaryLines: string[];
  /** People who queued too long and left. Always 0 for a classroom scenario. */
  leftEarly: number;
  steps?: StepStats[];
  funnel?: FunnelStats;
  staffLoad?: StaffLoadLine[];
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

export interface SpatialBottleneck {
  kind: "door" | "corridor";
  id: string;
  name: string;
  x: number;
  z: number;
  count: number;
}

export interface ScenarioVariantCompareResult {
  a: SimulationResult;
  b: SimulationResult;
  c: SimulationResult;
  winner: "a" | "b" | "c" | "tie";
  reason: string;
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
  travelPath: RoutePoint[];
  travelStartT: number;
  travelSeconds: number;
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

function effectiveServers(st: ServiceStation): number {
  if (st.staffCount <= 0 || st.parallelServers <= 0) return 0;
  return Math.max(1, Math.min(st.staffCount, st.parallelServers));
}

function normalizeProfiles(profiles: ParticipantProfile[]): ParticipantProfile[] {
  const sum = profiles.reduce((s, p) => s + Math.max(0, p.ratio), 0) || 1;
  return profiles.map((p) => ({ ...p, ratio: Math.max(0, p.ratio) / sum }));
}

/** Allocate whole people by largest remainder so ratios are exact and deterministic. */
export function allocateProfiles(count: number, profiles: ParticipantProfile[]): ParticipantProfile[] {
  const normalized = normalizeProfiles(profiles);
  const target = Math.max(0, Math.round(count));
  const raw = normalized.map((profile) => ({ profile, value: profile.ratio * target }));
  const counts = raw.map(({ value }) => Math.floor(value));
  const remaining = target - counts.reduce((sum, value) => sum + value, 0);
  const order = raw.map((entry, index) => ({ index, fraction: entry.value - counts[index] }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (let i = 0; i < remaining; i++) counts[order[i % order.length].index] += 1;
  return normalized.flatMap((profile, index) => Array.from({ length: counts[index] }, () => profile));
}

/** Fisher-Yates on a copy, driven by the scenario's own seeded rng. */
function shuffled<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
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

function serviceDuration(st: ServiceStation, profileId: ParticipantProfileId, rng: () => number): number {
  const mean = Math.max(1, st.profileServiceSeconds?.[profileId] ?? st.meanServiceSeconds);
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
  // Shuffled, because `allocateProfiles` returns them grouped — every prepaid
  // attendee, then every pay-on-site one — and arrivals are sorted ascending
  // before the two are zipped positionally. Unshuffled, a 40/20 mix meant the
  // payment desk sat idle for two thirds of the arrival window and was then hit
  // by twenty consecutive payers. That is not how a 40/20 mix arrives, and it
  // is the exact input to the 同桌／分桌 staffing comparison the user is asked
  // to trust. Seeded, so the run stays reproducible.
  const assignedProfiles = shuffled(allocateProfiles(scenario.participantCount, profiles), rng);

  const agents: AgentRuntime[] = [];
  const events: SimEvent[] = [];
  let seq = 0;
  let maxCorridorOverflow = 0;
  const traversedDoors = new Set<string>();

  const firstStationPos = stationPos(stationMap.get(profiles[0].branch[0])!);

  for (let i = 0; i < arrivals.length; i++) {
    const profile = assignedProfiles[i] ?? profiles[profiles.length - 1];
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
      travelPath: [],
      travelStartT: 0,
      travelSeconds: 0,
    });
    pushEvent(events, { t: arrivals[i], kind: "arrive", agentId: i, seq: seq++ });
  }

  const speed = Math.max(0.2, scenario.settings.speedMetersPerSecond);
  const playback: PlaybackFrame[] = [];
  let nextSample = 0;

  const refreshQueuePositions = (st: StationRuntime) => {
    for (let index = 0; index < st.queue.length; index++) {
      const agent = agents[st.queue[index]];
      if (!agent) continue;
      const placement = queuePlacement(st.def, index, scenario.spatial);
      agent.x = placement.point.x;
      agent.z = placement.point.z;
      const queueOverflow = index + 1 > st.def.queueCapacity ? index + 1 - st.def.queueCapacity : 0;
      if (placement.overflow || queueOverflow > 0) maxCorridorOverflow = Math.max(maxCorridorOverflow, index + 1 - Math.min(placement.capacity, st.def.queueCapacity));
    }
  };

  const snapshot = (t: number) => {
    const queues: Record<string, number> = {};
    for (const [id, st] of Object.entries(stations)) {
      refreshQueuePositions(st);
      queues[id] = st.queue.length;
    }
    for (const agent of agents) {
      if (agent.state !== "traveling" || !agent.travelPath.length) continue;
      const progress = agent.travelSeconds > 0 ? Math.min(1, Math.max(0, (t - agent.travelStartT) / agent.travelSeconds)) : 1;
      const point = pointAtPolyline(agent.travelPath, routeLength(agent.travelPath) * progress);
      agent.x = point.x;
      agent.z = point.z;
    }
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
    refreshQueuePositions(st);
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
    const dur = serviceDuration(st.def, agent.profileId, rng);
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
    refreshQueuePositions(st);
    tryStartService(stationId, t);
  };

  const sendToStation = (agent: AgentRuntime, stationId: string, t: number) => {
    const st = stationMap.get(stationId)!;
    const from = { x: agent.x, z: agent.z };
    const to = stationPos(st);
    const travel = buildTravelPath(from, to, scenario.spatial, speed);
    for (const doorId of travel.doorIds) traversedDoors.add(doorId);
    agent.state = "traveling";
    agent.stationId = stationId;
    agent.travelPath = travel.points;
    agent.travelStartT = t;
    agent.travelSeconds = travel.seconds;
    agent.x = from.x;
    agent.z = from.z;
    pushEvent(events, {
      t: t + travel.seconds,
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
  const totalWaitSeconds = agents.reduce((sum, a) => sum + a.waitAccum, 0);
  const avgWaitSeconds = agents.length ? totalWaitSeconds / agents.length : 0;
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
      // A station nobody staffs is idle, not undefined. `servers` is 0 for a
      // desk switched off by a staffing variant (同桌 turns the separate
      // payment desk off), and the bare division made this NaN — which the
      // 進階 station table printed to the user as 「利用率 NaN%」.
      utilization: servers > 0 && horizon > 0
        ? Math.min(1, st.busyServerSeconds / (horizon * servers))
        : 0,
      busyServerSeconds: st.busyServerSeconds,
      servers,
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

  const maxQueue = Math.max(0, ...stationStats.map((s) => s.maxQueue));
  const maxQueueWhere = stationStats.find((s) => s.maxQueue === maxQueue)?.name ?? null;
  const spatialBottlenecks: SpatialBottleneck[] = [];
  for (const door of scenario.spatial?.doors ?? []) {
    if (!traversedDoors.has(door.id) || door.throughput >= 1) continue;
    spatialBottlenecks.push({
      kind: "door",
      id: door.id,
      name: "門前",
      x: door.x,
      z: door.z,
      count: door.blocked ? scenario.participantCount : Math.max(1, Math.round(scenario.participantCount * (1 - door.throughput))),
    });
  }
  if (maxCorridorOverflow > 0 && scenario.spatial) {
    const corridor = scenario.spatial.corridor;
    spatialBottlenecks.push({
      kind: "corridor",
      id: "corridor",
      name: "走廊",
      x: corridor.x + corridor.length / 2,
      z: corridor.z + corridor.width / 2,
      count: maxCorridorOverflow,
    });
  }
  spatialBottlenecks.sort((left, right) => right.count - left.count || left.id.localeCompare(right.id));
  // A blocked/narrow DOOR is an independent cause and may take the headline.
  // Corridor overflow is a SYMPTOM of a station queue — report it as a
  // secondary warning instead of hiding the station that actually needs staff.
  const doorPrimary = spatialBottlenecks.find((b) => b.kind === "door") ?? null;
  const corridorOverflow = spatialBottlenecks.find((b) => b.kind === "corridor") ?? null;

  const summaryLines: string[] = [];
  if (doorPrimary) summaryLines.push(`最塞：${doorPrimary.name}（約影響 ${doorPrimary.count} 人）`);
  summaryLines.push(
    `完成 ${completedAgents.length}/${agents.length} 人，總時長約 ${formatMin(finishTime)}。`,
  );
  if (bottleneck && !doorPrimary) {
    summaryLines.push(
      `最塞：${bottleneck.name}（最大排隊 ${bottleneck.maxQueue} 人，平均等待 ${Math.round(bottleneck.avgWaitSeconds)} 秒）。`,
    );
  } else if (!doorPrimary && !corridorOverflow) {
    summaryLines.push("未偵測到明顯站點瓶頸。");
  }
  if (corridorOverflow) {
    summaryLines.push(`排隊人龍會塞滿走廊（約多出 ${corridorOverflow.count} 人）——建議提早分流或加人力。`);
  }
  summaryLines.push(`平均全程 ${Math.round(avgJourney)} 秒。`);

  return {
    scenarioId: scenario.id,
    seed: scenario.seed,
    participantCount: scenario.participantCount,
    leftEarly: 0,
    completed: completedAgents.length,
    unfinished,
    avgJourneySeconds: avgJourney,
    maxJourneySeconds: maxJourney,
    totalWaitSeconds,
    avgWaitSeconds,
    maxQueue,
    maxQueueWhere,
    spatialBottlenecks,
    finishTimeSeconds: finishTime,
    stations: stationStats,
    bottleneckStationId: doorPrimary ? null : bottleneck?.stationId ?? null,
    bottleneckName: doorPrimary?.name ?? bottleneck?.name ?? corridorOverflow?.name ?? null,
    summaryLines,
    playback,
  };
}

function median(values: number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered.length ? ordered[Math.floor(ordered.length / 2)] : 0;
}

/** Run stable seed variants for comparisons while keeping playback on one representative run. */
export function runScenarioMedian(
  scenario: EventScenario,
  opts: RunOptions = {},
  seedCount = 5,
): SimulationResult {
  const count = Math.max(1, Math.round(seedCount));
  const runs = Array.from({ length: count }, (_, index) => runDiscreteEvent({ ...scenario, seed: scenario.seed + index }, opts));
  const representative = runs[Math.floor(runs.length / 2)];
  return {
    ...representative,
    seed: scenario.seed,
    avgJourneySeconds: median(runs.map((run) => run.avgJourneySeconds)),
    maxJourneySeconds: median(runs.map((run) => run.maxJourneySeconds)),
    totalWaitSeconds: median(runs.map((run) => run.totalWaitSeconds)),
    avgWaitSeconds: median(runs.map((run) => run.avgWaitSeconds)),
    maxQueue: median(runs.map((run) => run.maxQueue)),
    maxQueueWhere: runs.find((run) => run.maxQueue === median(runs.map((item) => item.maxQueue)))?.maxQueueWhere ?? representative.maxQueueWhere,
    finishTimeSeconds: median(runs.map((run) => run.finishTimeSeconds)),
  };
}

function emptyResult(scenario: EventScenario, msg: string): SimulationResult {
  return {
    scenarioId: scenario.id,
    seed: scenario.seed,
    participantCount: scenario.participantCount,
    leftEarly: 0,
    completed: 0,
    unfinished: scenario.participantCount,
    avgJourneySeconds: 0,
    maxJourneySeconds: 0,
    totalWaitSeconds: 0,
    avgWaitSeconds: 0,
    maxQueue: 0,
    maxQueueWhere: null,
    spatialBottlenecks: [],
    finishTimeSeconds: 0,
    stations: [],
    bottleneckStationId: null,
    bottleneckName: null,
    summaryLines: [msg],
    playback: [],
  };
}

function formatMin(seconds: number): string {
  // Round to whole seconds FIRST so 46:59.6 reads 47 分 0 秒, never 46 分 60 秒.
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
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

/** Compare all three staffing/flow variants with a stable, human-sized tolerance. */
export function compareScenarioVariants(
  a: SimulationResult,
  b: SimulationResult,
  c: SimulationResult,
): ScenarioVariantCompareResult {
  const entries = [
    { id: "a" as const, result: a },
    { id: "b" as const, result: b },
    { id: "c" as const, result: c },
  ];
  const score = (result: SimulationResult) => result.finishTimeSeconds + result.avgWaitSeconds * 2 + result.maxQueue * 10;
  const ordered = [...entries].sort((left, right) => score(left.result) - score(right.result) || left.id.localeCompare(right.id));
  const best = ordered[0];
  const second = ordered[1];
  const close = Math.abs(score(best.result) - score(second.result)) <= 8 && Math.abs(best.result.maxQueue - second.result.maxQueue) <= 1;
  const winner = close ? "tie" : best.id;
  const reason = close
    ? "三種安排差不多，先保留目前的動線。"
    : `方案 ${best.id.toUpperCase()} 比較順，先看它的排隊位置。`;
  return { a, b, c, winner, reason };
}

/** Deep-clone a scenario and apply a patch (for A/B variants). */
export function cloneScenario(
  scenario: EventScenario,
  patch?: Partial<EventScenario> & { stationPatches?: Record<string, Partial<ServiceStation>> },
): EventScenario {
  const stations = (patch?.stations ?? scenario.stations).map((s) => {
    const p = patch?.stationPatches?.[s.id];
    return p ? { ...s, ...p } : { ...s };
  });
  const rest = { ...(patch ?? {}) };
  delete rest.stationPatches;
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

function buildCorridorVariant(base: EventScenario): EventScenario {
  const guide = base.stations.find((station) => station.type === "guide");
  const queue = base.stations.find((station) => station.type === "queue");
  const anchor = guide ?? base.stations[0];
  if (!anchor) return cloneScenario(base, { id: `${base.id}_corridor`, name: "C 走廊預分流" });
  const laneOffset = Math.max(0.25, Math.min(0.6, (base.spatial?.corridor.width ?? 2) / 4));
  const lane = (profile: "prepaid" | "onsite", offset: number) => {
    const suffix = profile === "prepaid" ? "prepaid" : "onsite";
    return [
      {
        id: `${base.id}_c_${suffix}_guide`, name: profile === "prepaid" ? "預繳引導" : "現場引導", type: "guide" as const,
        x: anchor.x, z: anchor.z + offset, staffCount: Math.max(1, anchor.staffCount), parallelServers: Math.max(1, anchor.parallelServers),
        meanServiceSeconds: 8, queueCapacity: 30,
      },
      {
        id: `${base.id}_c_${suffix}_queue`, name: profile === "prepaid" ? "預繳排隊" : "現場排隊", type: "queue" as const,
        x: anchor.x, z: anchor.z + offset, staffCount: Math.max(1, queue?.staffCount ?? 1), parallelServers: Math.max(1, queue?.parallelServers ?? 1),
        meanServiceSeconds: 3, queueCapacity: 30,
      },
    ];
  };
  const prepaidLane = lane("prepaid", -laneOffset);
  const onsiteLane = lane("onsite", laneOffset);
  const stations = base.stations
    .filter((station) => station.id !== guide?.id && station.id !== queue?.id)
    .concat(prepaidLane, onsiteLane);
  const replaceBranch = (branch: string[], laneGuideId: string, laneQueueId: string): string[] => {
    const next = branch.filter((id) => id !== guide?.id && id !== queue?.id);
    const index = Math.max(0, next.indexOf(base.stations.find((station) => station.type === "checkin")?.id ?? ""));
    next.splice(index, 0, laneGuideId, laneQueueId);
    return next;
  };
  const profiles = base.profiles.map((profile) => {
    const selected = profile.id === "prepaid" ? prepaidLane : onsiteLane;
    return { ...profile, branch: replaceBranch(profile.branch, selected[0].id, selected[1].id) };
  });
  return cloneScenario(base, {
    id: `${base.id}_corridor`, name: "C 走廊預分流", stations, profiles,
  });
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
  corridor?: EventScenario;
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
  const comboServers = Math.max(1, checkin.staffCount + Math.max(0, payment.staffCount));
  const combinedStations = base.stations.map((s) => {
    if (s.id === checkin.id) {
      return {
        ...s,
        name: "報到＋收費",
        meanServiceSeconds: comboMean,
        profileServiceSeconds: { prepaid: checkin.meanServiceSeconds, "pay-on-site": comboMean },
        staffCount: comboServers,
        parallelServers: comboServers,
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
        x: payment.x,
        z: payment.z,
        staffCount: Math.max(1, payment.staffCount),
        parallelServers: Math.max(1, payment.parallelServers),
        meanServiceSeconds: payment.meanServiceSeconds,
      },
    },
  });

  return { combined, separated, corridor: buildCorridorVariant(base) };
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
