/**
 * EventOptimizationEngine — local deterministic candidate search.
 *
 * generate → validate → simulate → score → rank
 * No LLM. Returns quantified before/after comparisons.
 */

import {
  buildCheckinPaymentVariants,
  cloneScenario,
  formatSimDuration,
  runDiscreteEvent,
  type RunOptions,
  type SimulationResult,
} from "./eventFlow";
import type { EventScenario, LayoutVariantId, Project, ServiceStation } from "./model";
import { issueCounts, validateProject } from "./validation";

export type OptimizationObjective =
  | "fastest"
  | "least-wait"
  | "lowest-max-queue"
  | "least-staff"
  | "smoothest-flow";

export interface OptimizationCandidate {
  id: string;
  name: string;
  layoutVariant?: LayoutVariantId;
  scenario: EventScenario;
  /** Optional scene object position patches applied on a project clone for validation. */
  objectPatches?: Record<string, { x: number; z: number; rotationDeg?: number }>;
}

export interface ScoredCandidate {
  candidate: OptimizationCandidate;
  result: SimulationResult;
  score: number;
  validationErrors: number;
  validationWarnings: number;
}

export interface MetricDelta {
  label: string;
  before: number;
  after: number;
  unit: "seconds" | "people" | "count" | "staff";
  /** Human before → after */
  display: string;
}

export interface OptimizationReport {
  objective: OptimizationObjective;
  baseline: ScoredCandidate;
  improved: ScoredCandidate | null;
  ranked: ScoredCandidate[];
  deltas: MetricDelta[];
  summary: string;
}

function runOpts(project?: Project): RunOptions {
  return {
    sampleDt: 2,
    project,
    routes: project?.routes,
  };
}

function staffOf(scn: EventScenario): number {
  return scn.stations.reduce((n, s) => {
    if (s.staffCount <= 0 || s.parallelServers <= 0) return n;
    return n + Math.max(1, Math.min(s.staffCount, s.parallelServers));
  }, 0);
}

function formatPeople(n: number): string {
  return `${Math.round(n)}`;
}

export function formatMetricDelta(
  label: string,
  before: number,
  after: number,
  unit: MetricDelta["unit"],
): MetricDelta {
  let display: string;
  if (unit === "seconds") {
    display = `${formatSimDuration(before)} → ${formatSimDuration(after)}`;
  } else if (unit === "staff") {
    display = `${formatPeople(before)} → ${formatPeople(after)}`;
  } else {
    display = `${formatPeople(before)} → ${formatPeople(after)}`;
  }
  return { label, before, after, unit, display };
}

/** Lower is better for all weighted terms after objective transforms. */
export function scoreResult(
  result: SimulationResult,
  objective: OptimizationObjective,
  staff: number,
  validationErrors: number,
): number {
  const spatialPenalty =
    result.spatialIssues.filter((i) => i.severity === "error").length * 80 +
    result.spatialIssues.filter((i) => i.severity === "warn").length * 25;
  const unfinishedPenalty = result.unfinished * 120;
  const valPenalty = validationErrors * 200;

  const finish = result.finishTimeSeconds;
  const wait = result.avgWaitSeconds;
  const maxQ = result.maxQueue;
  const smooth =
    maxQ * 40 +
    result.bottleneckDurationSeconds * 0.5 +
    spatialPenalty;

  switch (objective) {
    case "fastest":
      return finish + wait * 0.3 + maxQ * 8 + staff * 5 + unfinishedPenalty + valPenalty + spatialPenalty * 0.3;
    case "least-wait":
      return wait * 3 + result.maxWaitSeconds + maxQ * 10 + finish * 0.15 + unfinishedPenalty + valPenalty;
    case "lowest-max-queue":
      return maxQ * 60 + wait + finish * 0.1 + unfinishedPenalty + valPenalty + spatialPenalty * 0.5;
    case "least-staff":
      return staff * 180 + finish * 0.4 + wait * 0.5 + maxQ * 15 + unfinishedPenalty + valPenalty;
    case "smoothest-flow":
      return smooth + finish * 0.2 + wait * 0.4 + staff * 8 + unfinishedPenalty + valPenalty;
    default:
      return finish + wait + maxQ * 20 + unfinishedPenalty + valPenalty;
  }
}

function shiftStation(
  scn: EventScenario,
  type: ServiceStation["type"],
  dx: number,
  dz: number,
): EventScenario {
  const target = scn.stations.find((s) => s.type === type);
  if (!target) return scn;
  return cloneScenario(scn, {
    stationPatches: {
      [target.id]: { x: target.x + dx, z: target.z + dz },
    },
  });
}

function setQueueDir(scn: EventScenario, type: ServiceStation["type"], deg: number): EventScenario {
  const target = scn.stations.find((s) => s.type === type);
  if (!target) return scn;
  return cloneScenario(scn, {
    stationPatches: { [target.id]: { queueDirectionDeg: deg } },
  });
}

function reassignStaff(
  scn: EventScenario,
  checkinStaff: number,
  paymentStaff: number,
): EventScenario {
  const patches: Record<string, Partial<ServiceStation>> = {};
  for (const s of scn.stations) {
    if (s.type === "checkin") {
      patches[s.id] = {
        staffCount: Math.max(0, checkinStaff),
        parallelServers: Math.max(0, checkinStaff),
      };
    }
    if (s.type === "payment") {
      patches[s.id] = {
        staffCount: Math.max(0, paymentStaff),
        parallelServers: Math.max(0, paymentStaff),
      };
    }
  }
  return cloneScenario(scn, { stationPatches: patches });
}

/** Entrance-first split: prepaid and onsite diverge after guide (C). */
export function buildEntranceSplitVariant(base: EventScenario): EventScenario {
  const { separated } = buildCheckinPaymentVariants(base);
  const checkin = separated.stations.find((s) => s.type === "checkin");
  const payment = separated.stations.find((s) => s.type === "payment");
  const guide = separated.stations.find((s) => s.type === "guide");
  if (!checkin || !payment || !guide) {
    return cloneScenario(separated, {
      id: `${base.id}_split`,
      name: "C 入口先分流",
      layoutVariant: "entrance-split",
    });
  }
  // Push payment further aside; checkin stays; guide stays near entrance.
  const scn = cloneScenario(separated, {
    id: `${base.id}_split`,
    name: "C 入口先分流＋分站",
    layoutVariant: "entrance-split",
    stationPatches: {
      [checkin.id]: { x: checkin.x - 1.2, z: checkin.z, queueDirectionDeg: 0 },
      [payment.id]: { x: checkin.x + 3.2, z: checkin.z, queueDirectionDeg: 0 },
      [guide.id]: {
        x: guide.x,
        z: guide.z,
        meanServiceSeconds: Math.max(6, guide.meanServiceSeconds),
      },
    },
  });
  // Prepaid: entrance → guide → checkin → … (skip payment)
  // Onsite: entrance → guide → payment → checkin → … OR guide → checkin → payment
  // Prefer: onsite goes payment desk first after guide for true entrance split feel.
  const ent = scn.stations.find((s) => s.type === "entrance")!;
  const shoe = scn.stations.find((s) => s.type === "shoe");
  const bag = scn.stations.find((s) => s.type === "backpack");
  const seat = scn.stations.find((s) => s.type === "seating");
  const tail = [shoe?.id, bag?.id, seat?.id].filter(Boolean) as string[];
  const prepaidRatio =
    scn.profiles.find((p) => p.id === "prepaid")?.ratio ??
    scn.profiles[0]?.ratio ??
    0.67;
  const onsiteRatio = 1 - prepaidRatio;
  scn.profiles = [
    {
      id: "prepaid",
      ratio: prepaidRatio,
      branch: [ent.id, guide.id, checkin.id, ...tail],
    },
    {
      id: "pay-on-site",
      ratio: onsiteRatio,
      branch: [ent.id, guide.id, payment.id, checkin.id, ...tail],
    },
  ];
  return scn;
}

export function buildParallelVariant(base: EventScenario): EventScenario {
  const checkin = base.stations.find((s) => s.type === "checkin");
  if (!checkin) {
    return cloneScenario(base, {
      id: `${base.id}_parallel`,
      name: "D 多桌平行報到",
      layoutVariant: "parallel-checkin",
    });
  }
  const totalStaff = Math.max(2, checkin.staffCount);
  const aStaff = Math.ceil(totalStaff / 2);
  const bStaff = Math.max(1, totalStaff - aStaff);
  const checkinA: ServiceStation = {
    ...checkin,
    name: "報到 A",
    staffCount: aStaff,
    parallelServers: aStaff,
  };
  const checkinB: ServiceStation = {
    ...checkin,
    id: `${checkin.id}_b`,
    name: "報到 B",
    x: checkin.x + 2.4,
    z: checkin.z,
    staffCount: bStaff,
    parallelServers: bStaff,
  };
  const stations = base.stations.flatMap((s) =>
    s.id === checkin.id ? [checkinA, checkinB] : [{ ...s }],
  );
  const splitProfiles = base.profiles.flatMap((p) => {
    const i = p.branch.indexOf(checkin.id);
    if (i < 0) {
      return [{ ...p, branch: [...p.branch] }];
    }
    const before = p.branch.slice(0, i);
    const after = p.branch.slice(i + 1).filter((id) => id !== checkin.id);
    return [
      {
        ...p,
        ratio: p.ratio / 2,
        branch: [...before, checkinA.id, ...after],
      },
      {
        ...p,
        ratio: p.ratio / 2,
        branch: [...before, checkinB.id, ...after],
      },
    ];
  });
  return {
    ...base,
    id: `${base.id}_parallel`,
    name: "D 多桌平行報到",
    layoutVariant: "parallel-checkin",
    stations,
    profiles: splitProfiles,
    settings: { ...base.settings },
  };
}

export function generateLayoutCandidates(base: EventScenario): OptimizationCandidate[] {
  const { combined, separated } = buildCheckinPaymentVariants(base);
  const entranceSplit = buildEntranceSplitVariant(base);
  const parallel = buildParallelVariant(base);

  const checkinStaff = base.stations.find((s) => s.type === "checkin")?.staffCount ?? 1;
  const paymentStaff = base.stations.find((s) => s.type === "payment")?.staffCount ?? 1;

  const candidates: OptimizationCandidate[] = [
    { id: "baseline", name: "目前方案", scenario: cloneScenario(base), layoutVariant: base.layoutVariant },
    { id: "combined", name: combined.name, scenario: combined, layoutVariant: "combined" },
    { id: "separated", name: separated.name, scenario: separated, layoutVariant: "separated" },
    {
      id: "entrance-split",
      name: entranceSplit.name,
      scenario: entranceSplit,
      layoutVariant: "entrance-split",
    },
    {
      id: "parallel",
      name: parallel.name,
      scenario: parallel,
      layoutVariant: "parallel-checkin",
    },
    {
      id: "pay-right",
      name: "收費桌右移",
      scenario: shiftStation(separated, "payment", 1.5, 0),
      layoutVariant: "separated",
    },
    {
      id: "checkin-left",
      name: "報到桌左移離門",
      scenario: shiftStation(separated, "checkin", -1.5, -0.5),
      layoutVariant: "separated",
    },
    {
      id: "queue-away",
      name: "排隊方向改向場內",
      scenario: setQueueDir(separated, "checkin", 0),
      layoutVariant: "separated",
    },
    {
      id: "queue-side",
      name: "排隊方向改側向",
      scenario: setQueueDir(separated, "checkin", 90),
      layoutVariant: "separated",
    },
    {
      id: "staff-2-1",
      name: "人力 報到2／收費1",
      scenario: reassignStaff(separated, 2, 1),
      layoutVariant: "separated",
    },
    {
      id: "staff-1-2",
      name: "人力 報到1／收費2",
      scenario: reassignStaff(separated, 1, Math.max(1, paymentStaff + 1)),
      layoutVariant: "separated",
    },
    {
      id: "staff-minus-1",
      name: "少一個報到人力",
      scenario: reassignStaff(
        separated,
        Math.max(1, checkinStaff - 1),
        Math.max(1, paymentStaff),
      ),
      layoutVariant: "separated",
    },
  ];

  // Dedup by id
  const seen = new Set<string>();
  return candidates.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}

function validateCandidate(project: Project | undefined, candidate: OptimizationCandidate): {
  errors: number;
  warnings: number;
} {
  if (!project) return { errors: 0, warnings: 0 };
  const draft = structuredClone(project);
  // Apply station-bound object moves when objectId present.
  for (const st of candidate.scenario.stations) {
    if (!st.objectId) continue;
    const obj = draft.objects.find((o) => o.id === st.objectId);
    if (obj) {
      obj.x = st.x;
      obj.z = st.z;
    }
  }
  if (candidate.objectPatches) {
    for (const [id, patch] of Object.entries(candidate.objectPatches)) {
      const obj = draft.objects.find((o) => o.id === id);
      if (obj) Object.assign(obj, patch);
    }
  }
  draft.scenarios = [candidate.scenario];
  draft.activeScenarioId = candidate.scenario.id;
  const counts = issueCounts(validateProject(draft));
  return { errors: counts.error, warnings: counts.warning };
}

export function optimizeEventFlow(
  base: EventScenario,
  objective: OptimizationObjective = "fastest",
  project?: Project,
  opts?: { maxCandidates?: number },
): OptimizationReport {
  const all = generateLayoutCandidates(base);
  const limited = all.slice(0, opts?.maxCandidates ?? 12);
  const scored: ScoredCandidate[] = [];

  for (const candidate of limited) {
    const v = validateCandidate(project, candidate);
    const result = runDiscreteEvent(candidate.scenario, runOpts(project));
    const staff = staffOf(candidate.scenario);
    scored.push({
      candidate,
      result,
      validationErrors: v.errors,
      validationWarnings: v.warnings,
      score: scoreResult(result, objective, staff, v.errors),
    });
  }

  scored.sort((a, b) => a.score - b.score || a.result.finishTimeSeconds - b.result.finishTimeSeconds);

  const baseline =
    scored.find((s) => s.candidate.id === "baseline") ??
    scored[0];
  // Prefer best that is not baseline; if baseline wins, still report null improved.
  const best = scored[0];
  const improved =
    best && best.candidate.id !== "baseline" && best.score < baseline.score - 1e-6
      ? best
      : scored.find((s) => s.candidate.id !== "baseline" && s.score < baseline.score - 1e-6) ??
        null;

  const deltas: MetricDelta[] = improved
    ? [
        formatMetricDelta(
          "平均等待",
          baseline.result.avgWaitSeconds,
          improved.result.avgWaitSeconds,
          "seconds",
        ),
        formatMetricDelta(
          "最大排隊",
          baseline.result.maxQueue,
          improved.result.maxQueue,
          "people",
        ),
        formatMetricDelta(
          "總完成",
          baseline.result.finishTimeSeconds,
          improved.result.finishTimeSeconds,
          "seconds",
        ),
        formatMetricDelta(
          "工作人員",
          baseline.result.staffUsed,
          improved.result.staffUsed,
          "staff",
        ),
      ]
    : [];

  let summary: string;
  if (!improved) {
    summary = `目前方案已是「${objectiveLabel(objective)}」目標下較佳選擇。`;
  } else {
    summary = `建議改為「${improved.candidate.name}」：${deltas.map((d) => `${d.label} ${d.display}`).join("；")}。`;
  }

  return {
    objective,
    baseline,
    improved,
    ranked: scored,
    deltas,
    summary,
  };
}

export function objectiveLabel(objective: OptimizationObjective): string {
  switch (objective) {
    case "fastest":
      return "最快完成";
    case "least-wait":
      return "最少等待";
    case "lowest-max-queue":
      return "最低最大排隊";
    case "least-staff":
      return "最省工作人員";
    case "smoothest-flow":
      return "最順動線";
    default:
      return objective;
  }
}

/** What-if: reduce total service staff by one (prefer checkin). Staged scenario only. */
export function whatIfFewerStaff(base: EventScenario, remove = 1): EventScenario {
  const stations = base.stations.map((s) => ({ ...s }));
  let left = remove;
  const order: ServiceStation["type"][] = ["guide", "checkin", "payment", "shoe", "backpack"];
  for (const type of order) {
    if (left <= 0) break;
    const st = stations.find((s) => s.type === type && s.staffCount > 0);
    if (!st) continue;
    const next = Math.max(0, st.staffCount - left);
    const removed = st.staffCount - next;
    st.staffCount = next;
    st.parallelServers = next;
    left -= removed;
  }
  return {
    ...base,
    id: `${base.id}_staff_minus`,
    name: `少 ${remove} 個工作人員`,
    stations,
    profiles: base.profiles.map((p) => ({ ...p, branch: [...p.branch] })),
    settings: { ...base.settings },
  };
}
