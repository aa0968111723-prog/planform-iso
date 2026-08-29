/**
 * V2 報到流程精靈 — A–E templates + one-click split.
 *
 * Spec: docs/MAJOR_OPTIMIZATION_V2_PLAN.md §4.
 */

import type { EventScenario, ParticipantProfileId, Project, ServiceStation, StationType } from "./model";
import { uid } from "./model";
import { createDefaultScenario, resolveScenarioBindings } from "./migrate";
import { buildCheckinPaymentVariants } from "./eventFlow";

export type WizardPatternId = "A" | "B" | "C" | "D" | "E";
export type WizardSplitId = "same-table" | "split-table" | "entry-first" | "multi-desk";

export interface WizardPattern {
  id: WizardPatternId;
  name: string;
  summary: string;
}

export interface WizardSplit {
  id: WizardSplitId;
  name: string;
}

export const WIZARD_PATTERNS: readonly WizardPattern[] = [
  { id: "A", name: "一般報到", summary: "入口 → 報到 → 入場" },
  { id: "B", name: "報到＋現場收費", summary: "入口 → 分流 → 已繳／未繳 → 入場" },
  { id: "C", name: "鞋子＋背包", summary: "入口 → 鞋子 → 報到 → 背包 → 入場" },
  { id: "D", name: "引導＋報到／收費＋鞋包", summary: "入口 → 引導分流 → 報到／收費 → 鞋子 → 背包 → 入場" },
  { id: "E", name: "多組報到", summary: "入口 → 分組 → A／B／C 組報到 → 入場" },
];

export const WIZARD_SPLITS: readonly WizardSplit[] = [
  { id: "same-table", name: "同桌" },
  { id: "split-table", name: "分桌" },
  { id: "entry-first", name: "入口先分流" },
  { id: "multi-desk", name: "多桌平行" },
];

export interface WizardInputs {
  pattern: WizardPatternId;
  split: WizardSplitId;
  participants: number;
  prepaidRatio: number;
  arrivalWindowSeconds: number;
  arrivalProfile?: EventScenario["arrivalProfile"];
  checkinStaff: number;
  paymentStaff: number;
  hasOnsitePayment?: boolean;
}

const PATTERN_STATIONS: Record<WizardPatternId, StationType[]> = {
  A: ["entrance", "guide", "checkin", "seating"],
  B: ["entrance", "guide", "checkin", "payment", "seating"],
  C: ["entrance", "shoe", "checkin", "backpack", "seating"],
  D: ["entrance", "guide", "checkin", "payment", "shoe", "backpack", "seating"],
  E: ["entrance", "guide", "checkin", "seating"],
};

export function wizardPattern(id: WizardPatternId): WizardPattern {
  return WIZARD_PATTERNS.find((p) => p.id === id) ?? WIZARD_PATTERNS[0];
}

export function applyRegistrationWizard(project: Project, inputs: WizardInputs): EventScenario {
  const hasPay = inputs.pattern === "B" || inputs.pattern === "D";

  let scn = createDefaultScenario(project, {
    participantCount: inputs.participants,
    name: `流程 ${inputs.pattern} ${wizardPattern(inputs.pattern).name}`,
  });
  scn = resolveScenarioBindings(project, {
    ...scn,
    arrivalWindowSeconds: inputs.arrivalWindowSeconds,
    arrivalProfile: inputs.arrivalProfile ?? "uniform",
  });

  scn.stations = scn.stations.map((st) => {
    if (st.type === "checkin") {
      return { ...st, staffCount: inputs.checkinStaff, parallelServers: inputs.checkinStaff };
    }
    if (st.type === "payment") {
      const staff = hasPay ? inputs.paymentStaff : 0;
      return { ...st, staffCount: staff, parallelServers: staff };
    }
    return st;
  });

  if (inputs.pattern === "E") {
    scn = expandMultiGroupCheckin(scn, inputs.checkinStaff);
  }

  const keep = new Set<StationType>(PATTERN_STATIONS[inputs.pattern]);
  if (inputs.pattern === "E") keep.add("checkin");
  scn.stations = scn.stations.filter((s) => keep.has(s.type));

  const prepaid = Math.max(0, Math.min(1, inputs.prepaidRatio));
  scn.profiles = buildProfiles(scn, inputs.pattern, prepaid, hasPay);

  const variants = buildCheckinPaymentVariants(scn);
  if (hasPay && inputs.split === "same-table") {
    scn = { ...variants.combined, id: scn.id, name: scn.name };
  } else if (hasPay && inputs.split === "split-table") {
    scn = { ...variants.separated, id: scn.id, name: scn.name };
  } else if (inputs.split === "entry-first" && variants.corridor) {
    scn = { ...variants.corridor, id: scn.id, name: scn.name };
  } else if (inputs.split === "multi-desk") {
    scn = expandParallelCheckin(scn, Math.max(2, inputs.checkinStaff));
  }

  scn.id = uid("scn");
  scn.name = `${wizardPattern(inputs.pattern).name} · ${WIZARD_SPLITS.find((s) => s.id === inputs.split)?.name ?? ""}`.trim();
  return scn;
}

function buildProfiles(
  scn: EventScenario,
  pattern: WizardPatternId,
  prepaid: number,
  hasPay: boolean,
): EventScenario["profiles"] {
  const checkins = scn.stations.filter((s) => s.type === "checkin");
  if (pattern === "E" && checkins.length > 1) {
    const ratio = 1 / checkins.length;
    const ids: ParticipantProfileId[] = ["prepaid", "pay-on-site", "general", "staff"];
    return checkins.map((desk, i) => ({
      id: ids[i] ?? "general",
      ratio: i === checkins.length - 1 ? 1 - ratio * (checkins.length - 1) : ratio,
      branch: branchThrough(scn, desk.id, false),
    }));
  }
  const payment = scn.stations.find((s) => s.type === "payment");
  const prepaidBranch = scn.stations.filter((s) => s.type !== "payment").map((s) => s.id);
  const fullBranch = scn.stations.map((s) => s.id);
  if (!hasPay || !payment) {
    return [{ id: "prepaid", ratio: 1, branch: prepaidBranch.length ? prepaidBranch : fullBranch }];
  }
  return [
    { id: "prepaid", ratio: prepaid, branch: prepaidBranch },
    { id: "pay-on-site", ratio: 1 - prepaid, branch: fullBranch },
  ];
}

function branchThrough(scn: EventScenario, checkinId: string, includePayment: boolean): string[] {
  const ids: string[] = [];
  for (const s of scn.stations) {
    if (s.type === "checkin" && s.id !== checkinId) continue;
    if (s.type === "payment" && !includePayment) continue;
    ids.push(s.id);
  }
  return ids;
}

function expandMultiGroupCheckin(scn: EventScenario, staff: number): EventScenario {
  const base = scn.stations.find((s) => s.type === "checkin");
  if (!base) return scn;
  const extras: ServiceStation[] = [0, 1, 2].map((i) => ({
    ...base,
    id: i === 0 ? base.id : uid("stn"),
    name: `報到 ${String.fromCharCode(65 + i)}`,
    x: base.x + (i - 1) * 2.2,
    z: base.z,
    staffCount: Math.max(1, Math.round(staff / 3) || 1),
    parallelServers: Math.max(1, Math.round(staff / 3) || 1),
  }));
  return {
    ...scn,
    stations: scn.stations.flatMap((s) => (s.id === base.id ? extras : [s])),
  };
}

function expandParallelCheckin(scn: EventScenario, desks: number): EventScenario {
  const base = scn.stations.find((s) => s.type === "checkin");
  if (!base || desks < 2) return scn;
  const copies: ServiceStation[] = Array.from({ length: desks }, (_, i) => ({
    ...base,
    id: i === 0 ? base.id : uid("stn"),
    name: desks > 2 ? `報到 ${i + 1}` : i === 0 ? "報到 A" : "報到 B",
    x: base.x + i * 2.0,
    z: base.z,
    staffCount: Math.max(1, Math.floor(base.staffCount / desks) || 1),
    parallelServers: Math.max(1, Math.floor(base.parallelServers / desks) || 1),
  }));
  const stations = scn.stations.flatMap((s) => (s.id === base.id ? copies : [s]));
  const ratio = 1 / copies.length;
  const ids: ParticipantProfileId[] = ["prepaid", "pay-on-site", "general", "staff"];
  const profiles = copies.map((desk, i) => ({
    id: ids[i] ?? "general",
    ratio: i === copies.length - 1 ? 1 - ratio * (copies.length - 1) : ratio,
    branch: stations.filter((s) => s.type !== "checkin" || s.id === desk.id).filter((s) => s.type !== "payment").map((s) => s.id),
  }));
  return { ...scn, stations, profiles };
}
