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
  BOOTH_STOP_RATE,
  BOOTH_WALK_SPEED,
} from "./boothCatalog";
import type {
  AudienceSegment,
  PropDefinition,
  PropInteractionSeed,
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
      // `visitorCount` is joiners ("people who come in"). Inflate to passers-by
      // so stopRate < 1 is a real funnel, not a classroom compile in disguise.
      count: Math.max(params.visitorCount, Math.round(params.visitorCount / BOOTH_STOP_RATE)),
      windowSeconds,
      profile: "uniform",
      stopRate: BOOTH_STOP_RATE,
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

// --- prop instantiation -----------------------------------------------------
//
// The wiring contract, in code. `next: undefined` means "the next row", so a
// fragment appended without rules is either unreachable (every existing flow
// ends in an explicit null) or compulsory (a booth chain falls through into
// it). The contract:
//   - the fragment arrives SEALED: its last step ends in an explicit null and
//     every internal jump is an explicit id (the presets are tested for this);
//   - insertion rewires the CURRENT terminals (explicit nulls on steps and
//     chance options, plus the last row's fall-through) to an ask-step whose
//     skip walks past the fragment — booth-style sequential visiting with a
//     per-prop skip rate;
//   - removal rewires everything pointing INTO the fragment back to what the
//     ask's skip pointed at, restoring the pre-insertion meaning — never a
//     bare row delete.

/** The deterministic station id — also what re-binds after an old-build save. */
export function propStationId(objectId: string): string {
  return `prop_${objectId}`;
}

function propAskId(objectId: string): string {
  return `ask_prop_${objectId}`;
}

/**
 * The live id a definition's step gets once spliced onto `objectId`.
 *
 * Exported because the face lookup has to name the fragment's OWN chance step:
 * scanning the station for "the first chance step" finds the ask-step
 * (「要不要玩」) that insertion put in front of it, which is also at this
 * station and also a chance branch.
 */
export function propStepId(objectId: string, defStepId: string): string {
  return `p_${objectId}_${defStepId}`;
}

/** Rewire every terminal (step nulls, option nulls, last-row fall-through). */
function rewireTerminals(steps: InteractionStep[], target: string): InteractionStep[] {
  const out = steps.map((step) => ({
    ...step,
    ...(step.next === null ? { next: target } : {}),
    ...(step.branch?.kind === "chance"
      ? {
        branch: {
          ...step.branch,
          options: step.branch.options.map((o) => (o.next === null ? { ...o, next: target } : o)),
        },
      }
      : {}),
  }));
  const last = out[out.length - 1];
  if (last && last.next === undefined) {
    out[out.length - 1] = { ...last, next: target };
  }
  return out;
}

/** A minimal template for a plan whose first flow IS a prop (bootstrap). */
export function propTemplateSkeleton(name = "攤位流程"): InteractionTemplate {
  return {
    id: uid("flow"),
    name,
    steps: [],
    startStepId: "",
    stations: [],
    staff: [],
    audience: {
      // Estimates, same honesty rule as every preset: replace with a stopwatch.
      count: 60,
      windowSeconds: 3600,
      profile: "uniform",
      stopRate: 1,
      joinRate: 1,
      patienceSeconds: 0,
    },
    segments: [],
    seed: 20260302,
    settings: { speedMetersPerSecond: 1.15 },
  };
}

/**
 * Push an edited definition's interaction onto the splice already running for
 * `objectId`, in place.
 *
 * This is what makes 儲存修改 mean something for a prop that is already on the
 * floor — which is the normal case, because people place a thing and then tune
 * it. Without it the Studio edited a frozen seed: the live station, the six
 * faces, the service time and the skip rate were all snapshot at placement and
 * never refreshed, so every 互動 edit was a silent no-op while the toast said
 * it had been saved.
 *
 * CONTENT is overwritten, WIRING is preserved. Face labels, colours, prompts,
 * per-face seconds and weights, the station's numbers, the staff role's size
 * and the skip rate all come from the new seed; every `next` pointer, the
 * ask-step's position in the list and the fragment's place in the flow stay
 * exactly as they are. That distinction is the point: re-splicing from scratch
 * would rewire terminals that other props now depend on.
 *
 * Adding or removing FACES is content too — a 6-face dice edited to 8 grows
 * two options, wired to fall through like every other new row.
 *
 * Per-instance edits made in the flow panel are overwritten, and that is the
 * intent: this is the 更新範本 door. §71's 只改這一個 is the other one.
 */
export function reseedPropInteraction(
  template: InteractionTemplate,
  def: PropDefinition,
  objectId: string,
): InteractionTemplate {
  const seed = def.interaction;
  const stationId = propStationId(objectId);
  if (!seed || !template.stations.some((s) => s.id === stationId)) return template;

  const prefix = `p_${objectId}_`;
  const seedById = new Map(seed.steps.map((st) => [`${prefix}${st.id}`, st]));
  const askId = propAskId(objectId);
  const skipRate = Math.min(1, Math.max(0, seed.skipRate ?? 0));

  const steps = template.steps.map((step) => {
    if (step.id === askId && step.branch?.kind === "chance") {
      // The ask keeps its two options and their targets; only the odds and the
      // prop's display name follow the definition.
      const branch = step.branch;
      return {
        ...step,
        name: `要不要玩「${def.name}」`,
        branch: {
          ...branch,
          options: branch.options.map((o) => o.id === "skip"
            ? { ...o, weight: skipRate }
            : { ...o, label: def.name, weight: 1 - skipRate }),
        },
      };
    }
    const from = seedById.get(step.id);
    if (!from) return step;
    const next: InteractionStep = {
      ...step,
      name: from.name,
      avgSeconds: from.avgSeconds,
      ...(from.prompt !== undefined ? { prompt: from.prompt } : {}),
      ...(from.serviceVariance !== undefined ? { serviceVariance: from.serviceVariance } : {}),
    };
    if (from.branch?.kind === "chance" && step.branch?.kind === "chance") {
      const live = step.branch.options;
      next.branch = {
        ...step.branch,
        // Content per face, wiring per position: a face that already exists
        // keeps its `next`; a new face falls through like any new row.
        options: from.branch.options.map((o, i) => ({
          ...o,
          ...(live[i]?.next !== undefined ? { next: live[i].next } : {}),
        })),
      };
    }
    return next;
  });

  const stations = template.stations.map((st) => st.id !== stationId ? st : {
    ...st,
    name: def.name,
    parallelServers: seed.station.parallelServers,
    meanServiceSeconds: seed.station.meanServiceSeconds,
    queueCapacity: seed.station.queueCapacity,
    staffCount: seed.staffRole?.count ?? st.staffCount,
    ...(seed.station.selfService ? { selfService: true as const } : {}),
    ...anchorFields(def),
  });

  // The shared role follows the definition's count. Renaming it would split
  // copies onto two crews — structural, not an edit.
  const staff = seed.staffRole
    ? template.staff.map((r) => r.name === seed.staffRole!.name
      ? { ...r, count: seed.staffRole!.count }
      : r)
    : template.staff;

  return { ...template, steps, stations, staff };
}

/** Drop keys whose value is undefined, so a fresh station carries no empty fields. */
function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** The station fields a definition's anchors dictate. Shared by splice and reseed. */
function anchorFields(def: PropDefinition): Partial<InteractionStation> {
  const player = def.anchors.find((a) => a.role === "player");
  const queue = def.anchors.find((a) => a.role === "queue");
  // `undefined` rather than an absent key: a spread cannot DELETE, so an
  // anchor removed from the definition used to leave the station standing at
  // the offset it no longer has — with §63 validation and the §85 partner
  // sentences reading the definition and giving the other answer.
  return {
    anchorOffset: player ? { x: player.x, z: player.z } : undefined,
    queueDirectionDeg: queue?.facingDeg,
  };
}

/**
 * Read a placed prop's LIVE interaction back out as a seed.
 *
 * §71's 只改這一個 used to fork the frozen definition, so an organiser who had
 * renamed all six faces in the flow panel lost every one of them the moment
 * they pressed it. A fork has to start from what is actually running.
 */
export function liveSeedFromInstance(
  template: InteractionTemplate | undefined,
  def: PropDefinition,
  objectId: string,
): PropInteractionSeed | undefined {
  const seed = def.interaction;
  if (!seed || !template) return seed;
  const stationId = propStationId(objectId);
  const station = template.stations.find((s) => s.id === stationId);
  if (!station) return seed;
  const prefix = `p_${objectId}_`;
  const ask = template.steps.find((s) => s.id === propAskId(objectId));
  const askSkip = ask?.branch?.kind === "chance"
    ? ask.branch.options.find((o) => o.id === "skip")?.weight
    : undefined;

  const steps = seed.steps.map((st) => {
    const live = template.steps.find((s) => s.id === `${prefix}${st.id}`);
    if (!live) return st;
    // Ids and wiring come from the DEFINITION — the fork is a fresh seed and
    // will be re-spliced. Everything a person edits comes from the live copy.
    const seedBranch = st.branch;
    return {
      ...st,
      name: live.name,
      avgSeconds: live.avgSeconds,
      ...(live.prompt !== undefined ? { prompt: live.prompt } : {}),
      ...(live.branch?.kind === "chance" && seedBranch?.kind === "chance"
        ? {
          branch: {
            ...seedBranch,
            options: live.branch.options.map((o, i) => ({
              ...o,
              next: seedBranch.options[i]?.next,
            })),
          },
        }
        : {}),
    };
  });

  return {
    ...seed,
    steps,
    station: {
      ...seed.station,
      parallelServers: station.parallelServers,
      meanServiceSeconds: station.meanServiceSeconds,
      queueCapacity: station.queueCapacity,
    },
    ...(seed.staffRole ? { staffRole: { ...seed.staffRole, count: station.staffCount } } : {}),
    ...(askSkip !== undefined ? { skipRate: askSkip } : {}),
  };
}

/**
 * Splice a prop's interaction into the template, bound to a placed object.
 *
 * Copies of one definition each get their own splice (their own ask, steps
 * and station) — a visitor walks past each station and decides at each, which
 * is what a booth with two dice tables is actually like. Their stations may
 * share one staff role by name; `allocateStaff` splits that role's people
 * STATICALLY, so one person over two stations leaves the second at zero
 * servers, stalled and named by the staff-load line. That satisfies §55's
 * literal requirement (one person cannot serve two at once); it is not
 * round-robin service, and no readout pretends otherwise.
 */
export function instantiatePropInteraction(
  template: InteractionTemplate,
  def: PropDefinition,
  objectId: string,
  at?: { x: number; z: number },
): InteractionTemplate {
  const seed = def.interaction;
  if (!seed || !seed.steps.length) return template;
  const stationId = propStationId(objectId);
  if (template.stations.some((s) => s.id === stationId)) return template;

  const prefix = `p_${objectId}_`;
  const idMap = new Map(seed.steps.map((st) => [st.id, `${prefix}${st.id}`]));
  const remap = (id: string | null | undefined): string | null | undefined =>
    typeof id === "string" ? idMap.get(id) ?? null : id;

  const fragment: InteractionStep[] = seed.steps.map((st, i) => ({
    ...st,
    id: idMap.get(st.id)!,
    stationId,
    next: i === seed.steps.length - 1 ? null : remap(st.next),
    ...(st.branch?.kind === "chance"
      ? {
        branch: {
          ...st.branch,
          options: st.branch.options.map((o) => ({ ...o, next: remap(o.next) })),
        },
      }
      : {}),
  }));
  // The seal lives in the mapping above: the last step's next is forced to
  // null regardless of what the seed said. A fragment that leaks into rows it
  // does not own is exactly the bug the contract exists to prevent.

  // Staff role: reuse by name so copies share one crew.
  let staff = template.staff;
  let staffRoleId: string | undefined;
  if (seed.staffRole) {
    const existing = staff.find((r) => r.name === seed.staffRole!.name);
    if (existing) {
      staffRoleId = existing.id;
    } else {
      staffRoleId = uid("role");
      staff = [...staff, { id: staffRoleId, name: seed.staffRole.name, count: seed.staffRole.count }];
    }
  }

  const station: InteractionStation = {
    id: stationId,
    name: def.name,
    type: "custom",
    // Seeded from the object when the caller knows it. `resolveStationPosition`
    // recomputes this on every run, so these are only the fallback — but a
    // fallback of 0,0 is the corner of the room, which is never right.
    x: at?.x ?? 0,
    z: at?.z ?? 0,
    staffCount: seed.staffRole?.count ?? 1,
    parallelServers: seed.station.parallelServers,
    meanServiceSeconds: seed.station.meanServiceSeconds,
    queueCapacity: seed.station.queueCapacity,
    ...(seed.station.selfService ? { selfService: true } : {}),
    ...(staffRoleId ? { staffRoleId } : {}),
    objectId,
    ...stripUndefined(anchorFields(def)),
  };

  const skipRate = Math.min(1, Math.max(0, seed.skipRate ?? 0));
  const firstFragmentId = fragment[0].id;
  const entrySteps: InteractionStep[] = [];
  let entryId = firstFragmentId;
  if (skipRate > 0) {
    entryId = propAskId(objectId);
    entrySteps.push({
      id: entryId,
      name: `要不要玩「${def.name}」`,
      stationId,
      // A decision, not a visit: zero seconds queues for nothing.
      avgSeconds: 0,
      branch: {
        kind: "chance",
        options: [
          { id: "join", label: def.name, weight: 1 - skipRate, next: firstFragmentId },
          { id: "skip", label: "路過", weight: skipRate, next: null },
        ],
      },
    });
  }

  const rewired = template.steps.length ? rewireTerminals(template.steps, entryId) : [];
  const steps = [...rewired, ...entrySteps, ...fragment];
  const startStepId = template.steps.length ? template.startStepId : entryId;
  const segments = template.segments.length
    ? template.segments
    : [{ id: "all", name: "訪客", share: 1, startStepId: entryId }];

  return {
    ...template,
    steps,
    startStepId: startStepId || entryId,
    stations: [...template.stations, station],
    staff,
    segments,
  };
}

/**
 * Undo one prop's splice, restoring the pre-insertion meaning.
 *
 * Returns null when nothing remains — the caller drops `project.interaction`
 * entirely, putting a classroom plan back on its quick-setup path.
 */
export function removePropInteraction(
  template: InteractionTemplate,
  objectId: string,
): InteractionTemplate | null {
  const stationId = propStationId(objectId);
  const askId = propAskId(objectId);
  const prefix = `p_${objectId}_`;
  const fragmentIds = new Set(
    template.steps.filter((s) => s.id === askId || s.id.startsWith(prefix)).map((s) => s.id),
  );
  if (!fragmentIds.size && !template.stations.some((s) => s.id === stationId)) return template;

  // What the visit continues to after the fragment: the ask's skip target, or
  // (no ask) whatever the sealed final step now points at.
  const ask = template.steps.find((s) => s.id === askId);
  const skipOption = ask?.branch?.kind === "chance"
    ? ask.branch.options.find((o) => o.id === "skip")
    : undefined;
  const fragmentSteps = template.steps.filter((s) => s.id.startsWith(prefix));
  const continuation: string | null =
    (skipOption ? skipOption.next : fragmentSteps[fragmentSteps.length - 1]?.next) ?? null;

  const redirect = (id: string | null | undefined): string | null | undefined =>
    typeof id === "string" && fragmentIds.has(id) ? continuation : id;

  const steps = template.steps
    .filter((s) => !fragmentIds.has(s.id))
    .map((step) => ({
      ...step,
      ...(step.next !== undefined ? { next: redirect(step.next) } : {}),
      ...(step.branch?.kind === "chance"
        ? {
          branch: {
            ...step.branch,
            options: step.branch.options.map((o) =>
              o.next !== undefined ? { ...o, next: redirect(o.next) } : o),
          },
        }
        : {}),
    }));

  if (!steps.length) return null;

  const stations = template.stations.filter((s) => s.id !== stationId);
  const removed = template.stations.find((s) => s.id === stationId);
  // A role nobody staffs any more goes too — a dangling staffRoleId opens
  // zero servers and stalls silently.
  const staff = removed?.staffRoleId
    && !stations.some((s) => s.staffRoleId === removed.staffRoleId)
    ? template.staff.filter((r) => r.id !== removed.staffRoleId)
    : template.staff;

  const stepIds = new Set(steps.map((s) => s.id));
  const startStepId = stepIds.has(template.startStepId) ? template.startStepId : steps[0].id;
  const segments = template.segments.map((seg) =>
    stepIds.has(seg.startStepId) ? seg : { ...seg, startStepId: steps[0].id });

  return { ...template, steps, startStepId, stations, staff, segments };
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
