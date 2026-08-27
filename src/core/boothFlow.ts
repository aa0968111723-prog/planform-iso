/**
 * Outdoor booth crowd simulation (DES-lite).
 *
 * Sits beside eventFlow.ts and shares none of its state: eventFlow answers
 * "will 60 people get checked in before the class starts", this answers
 * "will a 3×3 tent with three people behind the table survive a rush".
 *
 * Fixed-step (dt = 0.1 s), seeded and reproducible: the same project and the
 * same seed always produce the same statistics, so the 正常 / 尖峰 comparison
 * is a real comparison and not two rolls of a die.
 *
 * Visitor journey — each station may be skipped, because not every visitor
 * does everything:
 *
 *   入口 → 看展示板 → 排隊 → 與工作人員對談 → 拿傳單 → 互動小活動
 *        → 填報名表 → 體驗坐墊靜心 → 拍照 → 出口
 *
 * The PRNG is the repository's mulberry32 (`createRng`), not the prototype's
 * LCG, so the headline numbers differ slightly from the ones recorded in
 * BOOTH_SIMULATION_SPEC.md §5 — those were measured on the prototype. The
 * behaviour, and every relationship the tests assert, is the same.
 */

import { createRng } from "./eventFlow";
import {
  uid,
  type BoothParams,
  type BoothScenarioId,
  type BoothStation,
  type BoothStationType,
  type Project,
} from "./model";

/** Walking speed, metres per second. */
export const BOOTH_WALK_SPEED = 1.15;

/** Fixed integration step. Small enough that a 1.15 m/s walker never skips a slot. */
export const BOOTH_STEP_SECONDS = 0.1;

export const BOOTH_DEFAULT_SEED = 20260302;

export const BOOTH_STATION_TYPES: Record<
  BoothStationType,
  { label: string; icon: string; dwell: number; servers: number; queueCapacity: number }
> = {
  board: { label: "看展示板", icon: "🪧", dwell: 20, servers: 3, queueCapacity: 4 },
  queue: { label: "排隊等待", icon: "⏳", dwell: 0, servers: 99, queueCapacity: 8 },
  talk: { label: "與工作人員對談", icon: "💬", dwell: 75, servers: 3, queueCapacity: 8 },
  flyer: { label: "拿傳單／DM", icon: "📄", dwell: 12, servers: 4, queueCapacity: 4 },
  game: { label: "互動小活動", icon: "🎲", dwell: 60, servers: 2, queueCapacity: 5 },
  form: { label: "填報名表／問卷", icon: "📝", dwell: 45, servers: 2, queueCapacity: 4 },
  cushion: { label: "體驗坐墊靜心", icon: "🧘", dwell: 120, servers: 3, queueCapacity: 3 },
  photo: { label: "拍照", icon: "📷", dwell: 25, servers: 1, queueCapacity: 3 },
};

/** Order visitors attempt the stations in. 排隊 is the waiting area, not a stop. */
const JOURNEY_ORDER: BoothStationType[] = [
  "board", "queue", "talk", "flyer", "game", "form", "cushion", "photo",
];

/** Probability a visitor skips each station entirely. */
const SKIP_RATE: Record<BoothStationType, number> = {
  board: 0.15, queue: 0, talk: 0.05, flyer: 0.25,
  game: 0.35, form: 0.45, cushion: 0.75, photo: 0.6,
};

export const BOOTH_SIM_PRESETS: Record<BoothScenarioId, { label: string } & BoothParams> = {
  normal: {
    label: "正常人流",
    arrivalPerMin: 1.6, visitorCount: 40, talkSeconds: 75, queueCapacity: 8,
    deskStaff: 3, boardDwell: 20, gameDwell: 60, balk: true,
  },
  peak: {
    label: "尖峰人流",
    arrivalPerMin: 6, visitorCount: 90, talkSeconds: 60, queueCapacity: 8,
    deskStaff: 3, boardDwell: 16, gameDwell: 50, balk: true,
  },
};

/** The parameter block for a scenario, without its display label. */
export function defaultBoothParams(scenarioId: BoothScenarioId = "normal"): BoothParams {
  const p = BOOTH_SIM_PRESETS[scenarioId];
  return {
    visitorCount: p.visitorCount,
    arrivalPerMin: p.arrivalPerMin,
    talkSeconds: p.talkSeconds,
    queueCapacity: p.queueCapacity,
    deskStaff: p.deskStaff,
    boardDwell: p.boardDwell,
    gameDwell: p.gameDwell,
    balk: p.balk,
  };
}

/** Default station positions, in metres, for the 戶外攤位 venue template. */
const DEFAULT_STATION_LAYOUT: { type: BoothStationType; x: number; z: number; servers?: number; dwell?: number }[] = [
  { type: "board", x: 5.5, z: 5.1 },
  { type: "queue", x: 3.5, z: 6.1 },
  { type: "talk", x: 3.5, z: 4.85, servers: 3, dwell: 75 },
  { type: "flyer", x: 2.45, z: 4.85 },
  { type: "game", x: 5.95, z: 5.85 },
  { type: "form", x: 2.15, z: 5.65 },
  { type: "cushion", x: 2.62, z: 2.5 },
  { type: "photo", x: 4.75, z: 6.45 },
];

export function createBoothStation(
  type: BoothStationType,
  x: number,
  z: number,
  over: { servers?: number; dwell?: number; staffCount?: number; queueCapacity?: number } = {},
): BoothStation {
  const t = BOOTH_STATION_TYPES[type];
  return {
    id: uid("st"),
    name: t.label,
    type: "custom",
    boothType: type,
    x, z,
    staffCount: over.staffCount ?? 1,
    parallelServers: over.servers ?? t.servers,
    meanServiceSeconds: over.dwell ?? t.dwell,
    queueCapacity: over.queueCapacity ?? t.queueCapacity,
    enabled: true,
  };
}

export function createBoothStations(): BoothStation[] {
  return DEFAULT_STATION_LAYOUT.map((s) => createBoothStation(s.type, s.x, s.z, { servers: s.servers, dwell: s.dwell }));
}

// --- results ---------------------------------------------------------------

export interface BoothStationStats {
  id: string;
  name: string;
  boothType: BoothStationType;
  /** Peak queue length seen at this station. */
  maxQueue: number;
  served: number;
  avgWait: number;
  /** Fraction of server-seconds used over the elapsed run, 0–1. */
  utilization: number;
  avgQueue: number;
}

export interface BoothStats {
  /** Elapsed simulated seconds. */
  time: number;
  running: boolean;
  onSite: number;
  spawned: number;
  completed: number;
  /** Left without finishing: refused to join, or gave up waiting. */
  balked: number;
  maxQueue: number;
  avgWait: number;
  maxWait: number;
  /** Completed visitors per simulated minute. */
  throughput: number;
  bottleneck: string | null;
  bottleneckWait: number;
  /** Names of entry / exit zones a crowd stood in long enough to block. */
  blocked: string[];
  stations: BoothStationStats[];
}

export interface BoothCrowdPerson {
  id: number;
  x: number;
  z: number;
  state: "serving" | "queued" | "traveling";
}

type AgentState = "traveling" | "waiting" | "serving" | "leaving";

interface BoothAgent {
  id: number;
  x: number;
  z: number;
  /** Index into the journey; -1 before the first station is chosen. */
  leg: number;
  state: AgentState;
  station: RuntimeStation | null;
  target: { x: number; z: number } | null;
  /** Remaining service seconds while state === "serving". */
  timer: number;
  /** Simulated time this visitor joined the current queue. */
  enterQ: number;
  /** Stations completed, so a walk-through with no stop is not "completed". */
  stops: number;
  /** Seconds this visitor tolerates before giving up. */
  patience: number;
  gone?: boolean;
  qIndex?: number;
}

interface RuntimeStation extends BoothStation {
  /** Servers actually available this run (talk uses deskStaff). */
  servers: number;
  /** Mean service seconds actually used this run. */
  dwell: number;
  capacity: number;
  busy: number;
  queue: BoothAgent[];
  maxQueue: number;
  served: number;
  waitSum: number;
  waitMax: number;
  queueAreaSum: number;
}

/** Journey stations with their live parameters applied. */
function runtimeStations(project: Project, params: BoothParams): RuntimeStation[] {
  const stations = project.booth?.stations ?? [];
  return stations
    .filter((s) => s.enabled !== false)
    .map((s) => ({
      ...s,
      servers: s.boothType === "talk" ? Math.max(1, params.deskStaff) : Math.max(1, s.parallelServers),
      dwell:
        s.boothType === "talk" ? params.talkSeconds
          : s.boothType === "board" ? params.boardDwell
            : s.boothType === "game" ? params.gameDwell
              : s.meanServiceSeconds,
      // 排隊區容量 is the booth's waiting area, and the line that forms in it
      // is the one for the table. Capping only the (journey-less) queue
      // station would make the parameter decorative.
      capacity: s.boothType === "queue" || s.boothType === "talk"
        ? params.queueCapacity
        : s.queueCapacity,
      busy: 0,
      queue: [],
      maxQueue: 0,
      served: 0,
      waitSum: 0,
      waitMax: 0,
      queueAreaSum: 0,
    }));
}

export class BoothSim {
  private project!: Project;
  private params!: BoothParams;
  private stations: RuntimeStation[] = [];
  private journey: RuntimeStation[] = [];
  private agents: BoothAgent[] = [];
  private entry = { x: 1, z: 8 };
  private exit = { x: 6.5, z: 8.4 };
  private rand: () => number = createRng(BOOTH_DEFAULT_SEED);
  private congestion = new Map<string, number>();
  private arrivalAccum = 0;
  private samples = 0;
  private seed: number;

  time = 0;
  spawned = 0;
  completed = 0;
  balked = 0;
  done = false;

  /** Station runtimes by id, for the queue meters in the scene. */
  byId = new Map<string, RuntimeStation>();

  constructor(project: Project, seed = BOOTH_DEFAULT_SEED) {
    this.seed = seed;
    this.reset(project);
  }

  reset(project: Project): void {
    this.project = project;
    this.params = { ...(project.booth?.params ?? defaultBoothParams()) };
    this.stations = runtimeStations(project, this.params);
    this.byId = new Map(this.stations.map((s) => [s.id, s]));
    this.journey = JOURNEY_ORDER
      .map((t) => this.stations.find((s) => s.boothType === t))
      .filter((s): s is RuntimeStation => !!s)
      // 排隊 is the physical waiting area; the wait is modelled at each station.
      .filter((s) => s.boothType !== "queue");

    const entry = project.zones.find((z) => z.boothRole === "entry");
    const exit = project.zones.find((z) => z.boothRole === "exit");
    this.entry = entry ? { x: entry.x, z: entry.z + 1.1 } : { x: 1, z: 8 };
    this.exit = exit ? { x: exit.x, z: exit.z + 1.4 } : { x: 6.5, z: 8.4 };

    this.agents = [];
    this.rand = createRng(this.seed);
    this.congestion = new Map();
    this.arrivalAccum = 0;
    this.samples = 0;
    this.time = 0;
    this.spawned = 0;
    this.completed = 0;
    this.balked = 0;
    this.done = false;
  }

  /** Exponential service time with the same mean, floored so nothing is instant. */
  private expo(mean: number): number {
    return Math.max(2, -Math.log(1 - this.rand() * 0.98) * Math.max(0, mean));
  }

  /** Where the i-th person in a station's queue stands: rows of four, 45 cm apart. */
  private queueSlot(st: RuntimeStation, i: number): { x: number; z: number } {
    const back = st.boothType === "queue" ? 0.55 : 0.5;
    const perRow = 4;
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    return { x: st.x - 0.6 + col * 0.45, z: st.z + back + row * 0.55 };
  }

  private reindexQueue(st: RuntimeStation): void {
    st.queue.forEach((a, i) => {
      a.qIndex = i;
      if (a.state !== "serving") a.target = this.queueSlot(st, i);
    });
  }

  private leave(a: BoothAgent): void {
    a.state = "leaving";
    a.station = null;
    a.target = { x: this.exit.x, z: this.exit.z };
  }

  private spawn(): void {
    this.spawned += 1;
    const a: BoothAgent = {
      id: this.spawned,
      x: this.entry.x + (this.rand() - 0.5) * 0.7,
      z: this.entry.z + this.rand() * 0.6,
      leg: -1,
      state: "traveling",
      station: null,
      target: null,
      timer: 0,
      enterQ: 0,
      stops: 0,
      patience: 18 + this.rand() * 40,
    };
    this.agents.push(a);
    this.advance(a);
  }

  /** Move a visitor to their next station, skipping the ones they do not want. */
  private advance(a: BoothAgent): void {
    a.leg += 1;
    while (a.leg < this.journey.length) {
      const st = this.journey[a.leg];
      if (this.rand() > (SKIP_RATE[st.boothType] ?? 0.3)) break;
      a.leg += 1;
    }
    if (a.leg >= this.journey.length) {
      this.leave(a);
      return;
    }
    const st = this.journey[a.leg];
    a.station = st;
    a.state = "traveling";
    st.queue.push(a);
    a.qIndex = st.queue.length - 1;
    a.target = this.queueSlot(st, a.qIndex);
    a.enterQ = this.time;
    // Balk on arrival: the line is already longer than the queue area holds.
    if (this.params.balk && st.queue.length > st.capacity) {
      st.queue.pop();
      this.balked += 1;
      this.leave(a);
    }
  }

  step(dt: number): void {
    this.time += dt;
    this.samples += 1;

    if (this.spawned < this.params.visitorCount) {
      this.arrivalAccum += (this.params.arrivalPerMin / 60) * dt;
      while (this.arrivalAccum >= 1 && this.spawned < this.params.visitorCount) {
        this.arrivalAccum -= 1;
        this.spawn();
      }
    }

    // Stations pull whoever is standing in their slot into a free server.
    for (const st of this.stations) {
      st.maxQueue = Math.max(st.maxQueue, st.queue.filter((a) => a.state !== "serving").length);
      st.queueAreaSum += st.queue.length;
      let free = st.servers - st.busy;
      for (const a of st.queue) {
        if (free <= 0) break;
        if (a.state !== "waiting") continue;
        a.state = "serving";
        a.timer = this.expo(st.dwell);
        const waited = this.time - a.enterQ;
        a.enterQ = this.time;
        st.waitSum += waited;
        st.waitMax = Math.max(st.waitMax, waited);
        st.busy += 1;
        free -= 1;
      }
    }

    for (const a of this.agents) {
      if (a.state === "serving") {
        a.timer -= dt;
        if (a.timer <= 0) {
          const st = a.station!;
          st.busy -= 1;
          st.served += 1;
          st.queue = st.queue.filter((x) => x !== a);
          this.reindexQueue(st);
          a.stops += 1;
          this.advance(a);
        }
        continue;
      }
      if (a.state === "waiting") {
        // Gave up: waited far past their own patience.
        if (this.params.balk && this.time - a.enterQ > a.patience * 3) {
          const st = a.station!;
          st.queue = st.queue.filter((x) => x !== a);
          this.reindexQueue(st);
          this.balked += 1;
          this.leave(a);
        }
        continue;
      }
      const t = a.target;
      if (!t) continue;
      const dx = t.x - a.x;
      const dz = t.z - a.z;
      const dist = Math.hypot(dx, dz);
      const stepLen = BOOTH_WALK_SPEED * dt;
      if (dist <= stepLen) {
        a.x = t.x;
        a.z = t.z;
        if (a.state === "leaving") {
          a.gone = true;
          if (a.stops > 0) this.completed += 1;
        } else {
          a.state = "waiting";
          a.enterQ = this.time;
        }
      } else {
        a.x += (dx / dist) * stepLen;
        a.z += (dz / dist) * stepLen;
      }
      // Congestion sampling: seconds spent standing inside an entry / exit rect.
      for (const z of this.project.zones) {
        if (z.boothRole !== "entry" && z.boothRole !== "exit") continue;
        if (Math.abs(a.x - z.x) < z.width / 2 && Math.abs(a.z - z.z) < z.depth / 2) {
          this.congestion.set(z.id, (this.congestion.get(z.id) ?? 0) + dt);
        }
      }
    }

    this.agents = this.agents.filter((a) => !a.gone);
    if (this.spawned >= this.params.visitorCount && this.agents.length === 0) this.done = true;
  }

  /** Live queue length per station id, for the on-canvas queue badges. */
  queueLengths(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const st of this.stations) {
      out[st.id] = st.queue.filter((a) => a.state !== "serving").length;
    }
    return out;
  }

  crowd(): BoothCrowdPerson[] {
    return this.agents.map((a) => ({
      id: a.id,
      x: a.x,
      z: a.z,
      state: a.state === "serving" ? "serving" : a.state === "waiting" ? "queued" : "traveling",
    }));
  }

  stats(): BoothStats {
    const served = this.stations.reduce((n, s) => n + s.served, 0);
    const waitSum = this.stations.reduce((n, s) => n + s.waitSum, 0);
    const waitMax = this.stations.reduce((n, s) => Math.max(n, s.waitMax), 0);
    const maxQueue = this.stations.reduce((n, s) => Math.max(n, s.maxQueue), 0);
    const minutes = Math.max(this.time / 60, 1 / 60);
    // "最容易塞住 X（等 0 秒）" is not a bottleneck, it is a station. Only name
    // one once somebody has actually had to wait at it.
    const worst = [...this.stations]
      .filter((s) => s.served > 0 && s.waitSum / s.served >= 1)
      .sort((a, b) => b.waitSum / b.served - a.waitSum / a.served)[0];
    // A zone counts as blocked once people stood in it for a meaningful slice
    // of the run — a couple of seconds of walking through is not a blockage.
    const blockThreshold = Math.max(8, this.time * 0.12);
    const blocked = [...this.congestion.entries()]
      .filter(([, secs]) => secs > blockThreshold)
      .map(([id]) => this.project.zones.find((z) => z.id === id)?.name)
      .filter((n): n is string => !!n);

    return {
      time: this.time,
      running: !this.done,
      onSite: this.agents.length,
      spawned: this.spawned,
      completed: this.completed,
      balked: this.balked,
      maxQueue,
      avgWait: served ? waitSum / served : 0,
      maxWait: waitMax,
      throughput: this.completed / minutes,
      bottleneck: worst ? worst.name : null,
      bottleneckWait: worst ? worst.waitSum / worst.served : 0,
      blocked,
      stations: this.stations.map((s) => ({
        id: s.id,
        name: s.name,
        boothType: s.boothType,
        maxQueue: s.maxQueue,
        served: s.served,
        avgWait: s.served ? s.waitSum / s.served : 0,
        utilization: Math.min(1, (s.served * s.dwell) / Math.max(1, this.time * s.servers)),
        avgQueue: this.samples ? s.queueAreaSum / this.samples : 0,
      })),
    };
  }
}

/** Hard cap so a mis-set parameter can never hang the tab. */
const HEADLESS_MAX_STEPS = 200_000;

/**
 * Run a whole booth session with no rendering and return the statistics.
 * Used by 「比較正常／尖峰」 and by the tests. The project is not mutated:
 * `paramPatch` is applied to a copy.
 */
export function runBoothHeadless(
  project: Project,
  paramPatch?: Partial<BoothParams>,
  seed = BOOTH_DEFAULT_SEED,
): BoothStats {
  const booth = project.booth;
  if (!booth) return new BoothSim(project, seed).stats();
  const scoped: Project = paramPatch
    ? { ...project, booth: { ...booth, params: { ...booth.params, ...paramPatch } } }
    : project;
  const sim = new BoothSim(scoped, seed);
  let guard = 0;
  // 0.25 s steps: four times coarser than playback, still fine for a walker.
  while (!sim.done && guard < HEADLESS_MAX_STEPS) {
    sim.step(0.25);
    guard += 1;
  }
  return sim.stats();
}

/** Does this project carry booth data (and therefore a 模擬 tab)? */
export function isBoothProject(project: Project): boolean {
  return !!project.booth && project.booth.stations.length > 0;
}
