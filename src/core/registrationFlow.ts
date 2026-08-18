/**
 * Registration Flow Wizard — user inputs → real Scene/Station/Route candidates.
 */

import {
  buildCheckinPaymentVariants,
  cloneScenario,
  runDiscreteEvent,
  type SimulationResult,
} from "./eventFlow";
import {
  buildEntranceSplitVariant,
  buildParallelVariant,
} from "./eventOptimization";
import { createDefaultScenario } from "./migrate";
import {
  uid,
  type EventScenario,
  type LayoutVariantId,
  type Project,
  type SceneObject,
  type ServiceStation,
} from "./model";
import { syncScenarioToLayout } from "./spatialFlow";

export type RegistrationTemplateId =
  | "checkin-only"
  | "checkin-payment"
  | "checkin-shoe-bag"
  | "full-flow"
  | "multi-group";

export interface RegistrationWizardInput {
  participantCount: number;
  arrivalWindowMinutes: number;
  prepaidCount: number;
  onsitePaymentCount: number;
  checkinStaff: number;
  paymentStaff: number;
  arrivalProfile?: EventScenario["arrivalProfile"];
  template?: RegistrationTemplateId;
  seed?: number;
}

export interface LayoutCandidateResult {
  id: LayoutVariantId | "baseline";
  name: string;
  scenario: EventScenario;
  projectPatch: Partial<Project>;
  result: SimulationResult;
}

export function normalizeWizardInput(raw: Partial<RegistrationWizardInput>): RegistrationWizardInput {
  const participantCount = Math.max(1, Math.round(raw.participantCount ?? 60));
  let prepaidCount = Math.max(0, Math.round(raw.prepaidCount ?? Math.round(participantCount * 2 / 3)));
  let onsitePaymentCount = Math.max(
    0,
    Math.round(raw.onsitePaymentCount ?? Math.max(0, participantCount - prepaidCount)),
  );
  if (prepaidCount + onsitePaymentCount !== participantCount) {
    // Prefer explicit onsite; fill prepaid.
    if (raw.onsitePaymentCount != null && raw.prepaidCount == null) {
      prepaidCount = Math.max(0, participantCount - onsitePaymentCount);
    } else if (raw.prepaidCount != null && raw.onsitePaymentCount == null) {
      onsitePaymentCount = Math.max(0, participantCount - prepaidCount);
    } else {
      const sum = prepaidCount + onsitePaymentCount || 1;
      prepaidCount = Math.round((prepaidCount / sum) * participantCount);
      onsitePaymentCount = participantCount - prepaidCount;
    }
  }
  return {
    participantCount,
    arrivalWindowMinutes: Math.max(1, raw.arrivalWindowMinutes ?? 20),
    prepaidCount,
    onsitePaymentCount,
    checkinStaff: Math.max(1, Math.round(raw.checkinStaff ?? 2)),
    paymentStaff: Math.max(0, Math.round(raw.paymentStaff ?? (onsitePaymentCount > 0 ? 1 : 0))),
    arrivalProfile: raw.arrivalProfile ?? "uniform",
    template: raw.template ?? (onsitePaymentCount > 0 ? "full-flow" : "checkin-only"),
    seed: raw.seed ?? 42,
  };
}

function ensureServiceDesks(project: Project): Project {
  const p = structuredClone(project);
  const hasCheckin = p.objects.some((o) => o.serviceRole === "checkin" || o.kind === "regTable");
  const hasPayment = p.objects.some((o) => o.serviceRole === "payment");
  if (!hasCheckin) {
    p.objects.push({
      id: uid("obj"),
      kind: "regTable",
      x: p.classroom.x + 2.5,
      z: p.classroom.z + p.classroom.width - 1.5,
      rotationDeg: 180,
      width: 1.5,
      depth: 0.7,
      height: 0.74,
      locked: false,
      hidden: false,
      surface: "floor",
      elevation: 0,
      serviceRole: "checkin",
      assetId: "builtin:regTable",
    });
  }
  if (!hasPayment) {
    const ck = p.objects.find((o) => o.serviceRole === "checkin")!;
    p.objects.push({
      id: uid("obj"),
      kind: "regTable",
      x: ck.x + 2.5,
      z: ck.z,
      rotationDeg: 180,
      width: 1.5,
      depth: 0.7,
      height: 0.74,
      locked: false,
      hidden: false,
      surface: "floor",
      elevation: 0,
      serviceRole: "payment",
      assetId: "builtin:payment-desk",
    });
  }
  // Ensure zones for shoe/bag/seat when missing
  const ensureZone = (
    type: "shoe" | "backpack" | "group" | "registration",
    name: string,
    x: number,
    z: number,
  ) => {
    if (p.zones.some((z) => z.type === type)) return;
    p.zones.push({
      id: uid("zn"),
      type,
      name,
      x,
      z,
      width: type === "group" ? 4 : 2,
      depth: type === "group" ? 4 : 1,
      color: type === "shoe" ? "#fbbf24" : type === "backpack" ? "#fb923c" : "#a78bfa",
      locked: false,
      hidden: false,
      icon: type === "shoe" ? "👟" : type === "backpack" ? "🎒" : "👥",
      capacity: type === "group" ? 60 : 30,
    });
  };
  ensureZone("registration", "報到區", p.classroom.x + 1.5, p.classroom.z + p.classroom.width - 2.5);
  ensureZone("shoe", "鞋子區", p.classroom.x + 1, p.classroom.z + 1);
  ensureZone("backpack", "背包區", p.classroom.x + 3.5, p.classroom.z + 1);
  ensureZone("group", "入座區", p.classroom.x + 5, p.classroom.z + 2.5);
  return p;
}

function applyTemplateStations(scn: EventScenario, template: RegistrationTemplateId): EventScenario {
  const byType = (t: ServiceStation["type"]) => scn.stations.find((s) => s.type === t);
  const ent = byType("entrance");
  const guide = byType("guide");
  const checkin = byType("checkin");
  const payment = byType("payment");
  const shoe = byType("shoe");
  const bag = byType("backpack");
  const seat = byType("seating");
  if (!ent || !checkin) return scn;

  const keepTypes = new Set<ServiceStation["type"]>();
  let prepaidBranch: string[];
  let onsiteBranch: string[];

  switch (template) {
    case "checkin-only":
      keepTypes.add("entrance");
      keepTypes.add("checkin");
      keepTypes.add("seating");
      prepaidBranch = [ent.id, checkin.id, seat?.id].filter(Boolean) as string[];
      onsiteBranch = prepaidBranch;
      break;
    case "checkin-payment":
      keepTypes.add("entrance");
      keepTypes.add("guide");
      keepTypes.add("checkin");
      keepTypes.add("payment");
      keepTypes.add("seating");
      prepaidBranch = [ent.id, guide?.id, checkin.id, seat?.id].filter(Boolean) as string[];
      onsiteBranch = [ent.id, guide?.id, checkin.id, payment?.id, seat?.id].filter(Boolean) as string[];
      break;
    case "checkin-shoe-bag":
      keepTypes.add("entrance");
      keepTypes.add("shoe");
      keepTypes.add("checkin");
      keepTypes.add("backpack");
      keepTypes.add("seating");
      prepaidBranch = [ent.id, shoe?.id, checkin.id, bag?.id, seat?.id].filter(Boolean) as string[];
      onsiteBranch = prepaidBranch;
      break;
    case "multi-group":
      return buildParallelVariant(scn);
    case "full-flow":
    default:
      return scn;
  }

  const stations = scn.stations.filter((s) => keepTypes.has(s.type));
  const prepaidRatio = scn.profiles.find((p) => p.id === "prepaid")?.ratio ?? 1;
  return {
    ...scn,
    stations,
    profiles:
      template === "checkin-payment"
        ? [
            { id: "prepaid", ratio: prepaidRatio, branch: prepaidBranch },
            { id: "pay-on-site", ratio: 1 - prepaidRatio, branch: onsiteBranch },
          ]
        : [{ id: "prepaid", ratio: 1, branch: prepaidBranch }],
  };
}

function buildFlowRoute(stations: ServiceStation[]): Project["routes"][0] {
  const points = stations
    .filter((s) =>
      ["entrance", "guide", "checkin", "payment", "shoe", "backpack", "seating"].includes(s.type),
    )
    .map((s) => ({ x: s.x, z: s.z }));
  // Dedup consecutive
  const dedup = points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.z !== points[i - 1].z);
  return {
    id: uid("rt"),
    name: "進場動線",
    color: "#f97316",
    type: "entry",
    visible: true,
    points: dedup.length >= 2 ? dedup : [{ x: 0, z: 0 }, { x: 1, z: 1 }],
  };
}

function alignObjectsToStations(project: Project, scenario: EventScenario): Project {
  const p = structuredClone(project);
  for (const st of scenario.stations) {
    let obj: SceneObject | undefined;
    if (st.objectId) obj = p.objects.find((o) => o.id === st.objectId);
    if (!obj && st.type === "checkin") {
      obj = p.objects.find((o) => o.serviceRole === "checkin");
    }
    if (!obj && st.type === "payment") {
      obj = p.objects.find((o) => o.serviceRole === "payment");
    }
    if (obj) {
      obj.x = st.x;
      obj.z = st.z;
      if (!st.objectId) st.objectId = obj.id;
    }
  }
  // Refresh route
  const ordered = scenario.stations;
  const route = buildFlowRoute(ordered);
  p.routes = [route, ...p.routes.filter((r) => r.type !== "entry")];
  return p;
}

export function buildScenarioFromWizard(
  project: Project,
  input: RegistrationWizardInput,
): { project: Project; scenario: EventScenario } {
  const withDesks = ensureServiceDesks(project);
  let scn = createDefaultScenario(withDesks, {
    name: "報到流程",
    participantCount: input.participantCount,
    seed: input.seed ?? 42,
  });
  const prepaidRatio =
    input.participantCount === 0 ? 1 : input.prepaidCount / input.participantCount;
  scn = {
    ...scn,
    arrivalWindowSeconds: input.arrivalWindowMinutes * 60,
    arrivalProfile: input.arrivalProfile ?? "uniform",
    stations: syncScenarioToLayout(withDesks, {
      stations: scn.stations.map((st) => {
        if (st.type === "checkin") {
          return {
            ...st,
            staffCount: input.checkinStaff,
            parallelServers: input.checkinStaff,
          };
        }
        if (st.type === "payment") {
          const staff = input.onsitePaymentCount > 0 ? input.paymentStaff : 0;
          return { ...st, staffCount: staff, parallelServers: staff };
        }
        return st;
      }),
    }),
  };
  const paymentId = scn.stations.find((s) => s.type === "payment")?.id;
  const prepaidBranch = scn.stations.filter((s) => s.type !== "payment").map((s) => s.id);
  const fullBranch = scn.stations.map((s) => s.id);
  scn.profiles =
    input.onsitePaymentCount > 0
      ? [
          { id: "prepaid", ratio: prepaidRatio, branch: prepaidBranch },
          { id: "pay-on-site", ratio: 1 - prepaidRatio, branch: fullBranch },
        ]
      : [{ id: "prepaid", ratio: 1, branch: prepaidBranch }];
  if (input.onsitePaymentCount <= 0 && paymentId) {
    scn.stations = scn.stations.map((s) =>
      s.id === paymentId ? { ...s, staffCount: 0, parallelServers: 0 } : s,
    );
  }
  scn = applyTemplateStations(scn, input.template ?? "full-flow");
  const patched = alignObjectsToStations(withDesks, scn);
  scn.stations = syncScenarioToLayout(patched, scn);
  return { project: patched, scenario: scn };
}

export function compareLayoutCandidates(
  project: Project,
  input: RegistrationWizardInput,
): LayoutCandidateResult[] {
  const { project: baseProject, scenario: base } = buildScenarioFromWizard(project, input);
  const { combined, separated } = buildCheckinPaymentVariants(base);
  const entranceSplit = buildEntranceSplitVariant(base);
  const parallel = buildParallelVariant(base);

  const variants: { id: LayoutCandidateResult["id"]; name: string; scenario: EventScenario }[] = [
    { id: "combined", name: combined.name, scenario: combined },
    { id: "separated", name: separated.name, scenario: separated },
    { id: "entrance-split", name: entranceSplit.name, scenario: entranceSplit },
  ];
  // Only include parallel when classroom is wide enough / staff >= 2
  if (input.checkinStaff >= 2 || baseProject.classroom.length >= 8) {
    variants.push({ id: "parallel-checkin", name: parallel.name, scenario: parallel });
  }

  return variants.map((v) => {
    const projectPatch = alignObjectsToStations(baseProject, v.scenario);
    const result = runDiscreteEvent(v.scenario, {
      sampleDt: 2,
      project: projectPatch,
      routes: projectPatch.routes,
    });
    return {
      id: v.id,
      name: v.name,
      scenario: v.scenario,
      projectPatch: {
        objects: projectPatch.objects,
        zones: projectPatch.zones,
        routes: projectPatch.routes,
        scenarios: [v.scenario],
        activeScenarioId: v.scenario.id,
      },
      result,
    };
  });
}

/** Apply a candidate into a project clone (for preview / commit). */
export function applyLayoutCandidate(
  project: Project,
  candidate: LayoutCandidateResult,
): Project {
  const next = structuredClone(project);
  if (candidate.projectPatch.objects) next.objects = candidate.projectPatch.objects;
  if (candidate.projectPatch.zones) next.zones = candidate.projectPatch.zones;
  if (candidate.projectPatch.routes) next.routes = candidate.projectPatch.routes;
  next.scenarios = candidate.projectPatch.scenarios ?? [candidate.scenario];
  next.activeScenarioId = candidate.scenario.id;
  return next;
}

export function wizardTemplateLabel(id: RegistrationTemplateId): string {
  switch (id) {
    case "checkin-only":
      return "一般報到";
    case "checkin-payment":
      return "報到＋現場收費";
    case "checkin-shoe-bag":
      return "報到＋鞋子＋背包";
    case "full-flow":
      return "報到＋收費＋鞋子＋背包";
    case "multi-group":
      return "多組報到";
    default:
      return id;
  }
}

export { cloneScenario };
