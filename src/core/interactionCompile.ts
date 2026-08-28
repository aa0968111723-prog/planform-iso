/**
 * Turning an interaction flow into something runnable, and editing one.
 *
 * Pure functions only — no engine, no UI, no storage. Two jobs:
 *
 *   1. `templateFromScenario` expresses the existing classroom scenario as an
 *      interaction template, so the classroom stops being its own code path
 *      without any saved file changing. Every value is copied VERBATIM: the
 *      whole point is that E310's numbers do not move.
 *   2. The list editors (`addStep`, `moveStep`, …) are here rather than in the
 *      panel, because "the list order is the flow" is a rule about the model,
 *      not about a screen — and a rule in a click handler is a rule nobody can
 *      test.
 */

import {
  BOOTH_DEFAULT_SEED,
  BOOTH_JOURNEY_ORDER,
  BOOTH_SKIP_RATE,
  BOOTH_WALK_SPEED,
} from "./boothCatalog";
import type {
  AudienceSegment,
  BoothConfig,
  BoothStation,
  EventScenario,
  InteractionAudience,
  InteractionOption,
  InteractionStation,
  InteractionStep,
  InteractionTemplate,
  ServiceStation,
} from "./model";
import { uid } from "./model";

/**
 * The classroom scenario as a template.
 *
 * Bit-identical is the requirement, so this copies rather than recomputes:
 * - segment ids stay verbatim ("prepaid" / "pay-on-site"), because
 *   `arrivalMix.test.ts` reads them out of the playback;
 * - `serviceVariance` is copied, never converted — a seconds round trip would
 *   drift the float and move the numbers;
 * - `stopRate` / `joinRate` are 1 and `patienceSeconds` is 0, so no funnel roll
 *   and no give-up event exist, and the rng stream is untouched.
 */
export function templateFromScenario(scenario: EventScenario): InteractionTemplate {
  const stations: InteractionStation[] = scenario.stations.map((s) => ({ ...s }));
  const byId = new Map(scenario.stations.map((s) => [s.id, s]));

  const steps: InteractionStep[] = [];
  const segments: AudienceSegment[] = [];

  for (const profile of scenario.profiles) {
    const chain = profile.branch.filter((id) => byId.has(id));
    if (!chain.length) {
      // A profile with no reachable station still has to exist, or its share of
      // the audience silently vanishes into the other segments.
      const fallback = scenario.stations[0];
      if (!fallback) continue;
      chain.push(fallback.id);
    }
    const stepIds = chain.map((stationId) => `${profile.id}__${stationId}`);
    chain.forEach((stationId, i) => {
      const station = byId.get(stationId)!;
      steps.push({
        id: stepIds[i],
        name: station.name,
        stationId,
        avgSeconds: station.profileServiceSeconds?.[profile.id] ?? station.meanServiceSeconds,
        serviceVariance: station.serviceVariance,
        next: i + 1 < stepIds.length ? stepIds[i + 1] : null,
      });
    });
    segments.push({
      id: profile.id,
      name: profile.id,
      share: profile.ratio,
      startStepId: stepIds[0],
    });
  }

  const audience: InteractionAudience = {
    count: scenario.participantCount,
    windowSeconds: scenario.arrivalWindowSeconds,
    profile: scenario.arrivalProfile,
    // An invited event: everybody who was invited turns up and takes part.
    stopRate: 1,
    joinRate: 1,
    // Nobody gives up: a classroom scenario has no balking today, and adding
    // one here would change its answers.
    patienceSeconds: 0,
  };

  return {
    id: scenario.id,
    name: scenario.name,
    steps,
    startStepId: segments[0]?.startStepId ?? steps[0]?.id ?? "",
    stations,
    // No roles: with `staffRoleId` unset every station keeps today's
    // min(staffCount, parallelServers) rule, including the 同桌 variant that
    // switches the payment desk off with staffCount: 0.
    staff: [],
    audience,
    segments,
    seed: scenario.seed,
    settings: { ...scenario.settings },
    spatial: scenario.spatial,
  };
}

/**
 * The booth plan as a template.
 *
 * A one-time, faithful copy of everything `boothFlow.ts` had hard-coded, into
 * data the organiser can actually see and change. Same eight stations, same
 * order, same dwell times, same skip rates, same balk rule — the plan still
 * rehearses the activity it has always rehearsed. What changes is that none of
 * it is a module constant any more:
 *
 * - `JOURNEY_ORDER` becomes the ROW ORDER, which is draggable, and a second
 *   station of the same type finally gets into the flow (the old
 *   `.find(byType)` lookup could only ever see the first one);
 * - each `SKIP_RATE` becomes a two-option fork the organiser can re-weight;
 * - the `params` layer that used to override per-station edits is baked in
 *   once and then gone, so editing a station is no longer silently undone.
 *
 * The numbers are not bit-identical to the old engine's — that one integrated
 * at a fixed 0.1 s with its own queue rules — and nothing here pretends
 * otherwise. What is preserved is the activity and every setting of it.
 */
export function templateFromBooth(booth: BoothConfig, name = "攤位人流"): InteractionTemplate {
  const params = booth.params;
  const dwellOf = (s: BoothStation): number =>
    s.boothType === "talk" ? params.talkSeconds
      : s.boothType === "board" ? params.boardDwell
        : s.boothType === "game" ? params.gameDwell
          : s.meanServiceSeconds;
  // 排隊區容量 is the booth's waiting area, and the line that forms in it is
  // the one for the table — the same two stations the old engine capped.
  const capacityOf = (s: BoothStation): number =>
    s.boothType === "queue" || s.boothType === "talk" ? params.queueCapacity : s.queueCapacity;

  const stations: InteractionStation[] = booth.stations.map((s) => ({
    id: s.id,
    name: s.name,
    type: s.type,
    x: s.x,
    z: s.z,
    staffCount: s.staffCount,
    // Only the table has people behind it. Everywhere else the old engine
    // opened `parallelServers` positions and never looked at `staffCount`, so
    // `selfService` — which does exactly that — is the honest translation.
    // Reading those stations as staffed instead would quietly cut a 3-slot
    // display board down to one.
    ...(s.boothType === "talk"
      ? { staffRoleId: "talker", parallelServers: Math.max(1, params.deskStaff) }
      : { selfService: true, parallelServers: Math.max(1, s.parallelServers) }),
    meanServiceSeconds: dwellOf(s),
    queueCapacity: capacityOf(s),
    // Walk away rather than join a line that is already longer than the space
    // holds — the old engine's "balk on arrival", and the ONE place where a
    // queue capacity doubles as a threshold, because that is what it did.
    ...(params.balk ? { balkQueueLength: capacityOf(s) } : {}),
  }));

  const order = booth.stations
    .filter((s) => s.enabled !== false)
    .map((s, i) => ({ s, i, rank: BOOTH_JOURNEY_ORDER.indexOf(s.boothType) }))
    .filter((r) => r.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((r) => r.s);

  // Where the NEXT station's block starts — its own "shall I?" step when it
  // has one. Jumping straight to the next visit instead would skip that
  // question, and every station after a skipped one would become compulsory.
  const entryRow = (station: BoothStation | undefined): string | null =>
    !station ? null
      : (BOOTH_SKIP_RATE[station.boothType] ?? 0) > 0 ? `ask__${station.id}` : `do__${station.id}`;

  const steps: InteractionStep[] = [];
  order.forEach((station, i) => {
    const skip = BOOTH_SKIP_RATE[station.boothType] ?? 0;
    const after = order[i + 1];
    if (skip > 0) {
      steps.push({
        id: `ask__${station.id}`,
        name: `要不要${station.name}`,
        stationId: station.id,
        // A decision costs no time and takes no server: you decide as you walk
        // up, exactly as the old engine did before joining any queue.
        avgSeconds: 0,
        branch: {
          kind: "chance",
          options: [
            { id: "join", label: station.name, weight: 1 - skip },
            {
              id: "skip",
              label: "路過",
              weight: skip,
              next: entryRow(after),
            },
          ],
        },
      });
    }
    steps.push({
      id: `do__${station.id}`,
      name: station.name,
      stationId: station.id,
      avgSeconds: dwellOf(station),
    });
  });

  const windowSeconds = Math.max(
    60,
    Math.round((params.visitorCount / Math.max(0.1, params.arrivalPerMin)) * 60),
  );

  return {
    id: `booth__${booth.scenarioId}`,
    name,
    steps,
    startStepId: steps[0]?.id ?? "",
    stations,
    staff: [{ id: "talker", name: "顧攤位的人", count: Math.max(0, Math.floor(params.deskStaff)) }],
    audience: {
      count: params.visitorCount,
      windowSeconds,
      profile: "uniform",
      // `visitorCount` always meant "people who come in", never "people who
      // walk past", so there is no funnel to invent here.
      stopRate: 1,
      joinRate: 1,
      // The old engine gave each visitor `18 + rand*40` seconds of patience and
      // compared three times that against their wait: a median of 114 s. One
      // fixed number instead of a per-person draw, so the same plan does not
      // answer differently twice.
      patienceSeconds: params.balk ? 114 : 0,
    },
    segments: [{ id: "visitor", name: "訪客", share: 1, startStepId: steps[0]?.id ?? "" }],
    seed: BOOTH_DEFAULT_SEED,
    settings: { speedMetersPerSecond: BOOTH_WALK_SPEED },
  };
}

// --- reading a template ----------------------------------------------------

export interface NormalizedTemplate {
  template: InteractionTemplate;
  stepById: Map<string, InteractionStep>;
  stationById: Map<string, InteractionStation>;
  /** The step that follows this one when `next` is undefined: the next row. */
  nextRowId: Map<string, string | null>;
}

/**
 * Resolve the template into something the engine can walk without re-deriving
 * the same three lookups on every visitor.
 *
 * Repairs rather than rejects. A step whose `next` points at a deleted step
 * means "the visitor leaves here", not "throw the flow away" — an organiser
 * who deletes a step in the middle of planning must not lose the rest of it.
 */
export function normalizeTemplate(template: InteractionTemplate): NormalizedTemplate {
  const stepById = new Map(template.steps.map((s) => [s.id, s]));
  const stationById = new Map(template.stations.map((s) => [s.id, s]));
  const nextRowId = new Map<string, string | null>();
  template.steps.forEach((step, i) => {
    nextRowId.set(step.id, template.steps[i + 1]?.id ?? null);
  });
  return { template, stepById, stationById, nextRowId };
}

/** Where a step happens: its own station, else the one that led here. */
export function stationForStep(
  step: InteractionStep,
  inherited: string | null,
  n: NormalizedTemplate,
): InteractionStation | null {
  const id = step.stationId ?? inherited;
  if (id && n.stationById.has(id)) return n.stationById.get(id)!;
  return n.template.stations[0] ?? null;
}

/**
 * The step after this one.
 *
 * `undefined` means the next row — the list order IS the flow. `null` means the
 * visitor is finished. A name that no longer exists also means finished, so a
 * half-edited flow still runs.
 */
export function stepAfter(
  from: InteractionStep,
  override: string | null | undefined,
  n: NormalizedTemplate,
): InteractionStep | null {
  const target = override !== undefined ? override : from.next;
  if (target === null) return null;
  if (target === undefined) {
    const rowId = n.nextRowId.get(from.id) ?? null;
    return rowId ? n.stepById.get(rowId) ?? null : null;
  }
  return n.stepById.get(target) ?? null;
}

/**
 * How many of the people who pass by actually take part.
 *
 * Arithmetic, not agents. A booth might have 600 people walk past in two hours
 * and 120 of them join; spawning all 600 as simulated people would put half a
 * million objects in a phone's memory to model 480 people who never stopped
 * walking. The funnel numbers the organiser is shown are exact either way.
 */
export function audienceJoiners(audience: InteractionAudience): {
  passed: number; stopped: number; joined: number;
} {
  const passed = Math.max(0, Math.round(audience.count));
  const stopped = Math.round(passed * clamp01(audience.stopRate));
  const joined = Math.round(stopped * clamp01(audience.joinRate));
  return { passed, stopped, joined };
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
}

// --- editing the list ------------------------------------------------------
//
// Every editor returns a NEW template. They live here, not in the panel,
// because "the list order is the flow" is a property of the model.

function withSteps(t: InteractionTemplate, steps: InteractionStep[]): InteractionTemplate {
  const startStepId = steps.some((s) => s.id === t.startStepId) ? t.startStepId : steps[0]?.id ?? "";
  return { ...t, steps, startStepId };
}

export function addStep(t: InteractionTemplate, at: number, step?: Partial<InteractionStep>): InteractionTemplate {
  const created: InteractionStep = {
    id: uid("step"),
    name: step?.name ?? "新的步驟",
    avgSeconds: step?.avgSeconds ?? 30,
    ...step,
  };
  const steps = [...t.steps];
  steps.splice(Math.max(0, Math.min(at, steps.length)), 0, created);
  return withSteps(t, steps);
}

/** Move a step up or down. This is what actually re-orders the flow. */
export function moveStep(t: InteractionTemplate, id: string, delta: number): InteractionTemplate {
  const i = t.steps.findIndex((s) => s.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= t.steps.length) return t;
  const steps = [...t.steps];
  [steps[i], steps[j]] = [steps[j], steps[i]];
  return withSteps(t, steps);
}

export function duplicateStep(t: InteractionTemplate, id: string): InteractionTemplate {
  const i = t.steps.findIndex((s) => s.id === id);
  if (i < 0) return t;
  const source = t.steps[i];
  const copy: InteractionStep = {
    ...structuredCloneish(source),
    id: uid("step"),
    name: `${source.name}（複製）`,
    // The copy takes its place in the list; an inherited `next` would make it
    // jump to wherever the original jumped, skipping itself.
    next: source.next === null ? null : undefined,
  };
  const steps = [...t.steps];
  steps.splice(i + 1, 0, copy);
  return withSteps(t, steps);
}

/**
 * Remove a step, and heal anything that pointed at it.
 *
 * Pointers become `undefined` (= the next row), not `null`: deleting a step in
 * the middle should close the gap, not end everybody's visit there.
 */
export function removeStep(t: InteractionTemplate, id: string): InteractionTemplate {
  if (!t.steps.some((s) => s.id === id)) return t;
  const steps = t.steps
    .filter((s) => s.id !== id)
    .map((s) => healPointers(s, id));
  return withSteps(t, steps);
}

function healPointers(step: InteractionStep, goneId: string): InteractionStep {
  const next = step.next === goneId ? undefined : step.next;
  let branch = step.branch;
  if (branch?.kind === "chance") {
    branch = {
      ...branch,
      options: branch.options.map((o) => (o.next === goneId ? { ...o, next: undefined } : o)),
    };
  } else if (branch?.kind === "match") {
    branch = {
      ...branch,
      rules: branch.rules.map((r) => (r.next === goneId ? { ...r, next: undefined } : r)),
      otherwise: branch.otherwise?.next === goneId
        ? { ...branch.otherwise, next: undefined }
        : branch.otherwise,
    };
  }
  return { ...step, next, branch };
}

export function renameStep(t: InteractionTemplate, id: string, name: string): InteractionTemplate {
  return withSteps(t, t.steps.map((s) => (s.id === id ? { ...s, name } : s)));
}

export function setStepStation(t: InteractionTemplate, id: string, stationId: string | undefined): InteractionTemplate {
  return withSteps(t, t.steps.map((s) => (s.id === id ? { ...s, stationId } : s)));
}

export function updateStep(t: InteractionTemplate, id: string, patch: Partial<InteractionStep>): InteractionTemplate {
  return withSteps(t, t.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)));
}

/**
 * Resize a chance fork — a four-sided dice becoming six-sided.
 *
 * Existing faces keep their labels, weights and durations; new ones arrive
 * equally weighted and unnamed, because naming them is the organiser's job and
 * the core must never ship a fixed set of six themes.
 */
export function setOptionCount(t: InteractionTemplate, id: string, count: number): InteractionTemplate {
  const wanted = Math.max(2, Math.min(20, Math.round(count)));
  return withSteps(t, t.steps.map((s) => {
    if (s.id !== id) return s;
    const existing = s.branch?.kind === "chance" ? s.branch.options : [];
    const record = s.branch?.kind === "chance" ? s.branch.record : undefined;
    const options: InteractionOption[] = Array.from({ length: wanted }, (_, i) =>
      existing[i] ?? { id: uid("opt"), label: `選項 ${i + 1}`, weight: 1 });
    return { ...s, branch: { kind: "chance", options, record } };
  }));
}

/** Deep-enough copy for a step: plain data, no class instances, no cycles. */
function structuredCloneish(step: InteractionStep): InteractionStep {
  return JSON.parse(JSON.stringify(step)) as InteractionStep;
}

/** Stations a template can place a step at, in list order. */
/**
 * Change how many people a station can serve at once.
 *
 * Its own function because the rule is not obvious. `effectiveServers` takes
 * `min(staffCount, parallelServers)`, so writing positions alone left the
 * control inert: raising 走廊入口 from 1 to 4 opened exactly one server and the
 * run came back identical to the last decimal, while the panel went on naming
 * that station as the worst spot.
 *
 * With no role declared, the people and the positions ARE the same number, so
 * one control sets both. A station a role staffs keeps its own headcount —
 * that is the entire point of declaring the role — and a self-service step has
 * no headcount to imply.
 */
export function setStationPositions(
  t: InteractionTemplate,
  stationId: string,
  positions: number,
): InteractionTemplate {
  const n = Math.max(1, Math.round(positions));
  return {
    ...t,
    stations: t.stations.map((st) => {
      if (st.id !== stationId) return st;
      const next: InteractionStation = { ...st, parallelServers: n };
      if (!next.staffRoleId && !next.selfService) next.staffCount = n;
      return next;
    }),
  };
}

export function stationChoices(t: InteractionTemplate): { id: string; name: string }[] {
  return t.stations.map((s) => ({ id: s.id, name: s.name }));
}

/** A blank flow: one step, one station. The starting point for 「我的互動」. */
export function blankTemplate(name = "我的互動"): InteractionTemplate {
  const station: InteractionStation = {
    id: uid("stn"), name: "攤位前", type: "custom",
    staffCount: 1, parallelServers: 1, meanServiceSeconds: 60, queueCapacity: 8,
    x: 0, z: 0,
  };
  const step: InteractionStep = { id: uid("step"), name: "招呼", avgSeconds: 30, next: null };
  return {
    id: uid("tpl"), name,
    steps: [step], startStepId: step.id,
    stations: [station], staff: [],
    audience: { count: 100, windowSeconds: 3600, profile: "uniform", stopRate: 0.3, joinRate: 0.7, patienceSeconds: 180 },
    segments: [{ id: "all", name: "訪客", share: 1, startStepId: step.id }],
    seed: 20260302,
    settings: { speedMetersPerSecond: 1.15 },
  };
}

/** A station carried over as-is, for a template compiled from stations. */
export function stationFrom(station: ServiceStation, over: Partial<InteractionStation> = {}): InteractionStation {
  return { ...station, ...over };
}
