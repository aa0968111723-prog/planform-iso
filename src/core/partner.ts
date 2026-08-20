/**
 * Partner Mode domain rules — the "I have never seen this system before"
 * reading of a plan.
 *
 * Everything here is pure: given a project (and optionally the event scenario),
 * work out what a partner in a given role should look at, and say it in plain
 * Chinese. No measurements, no coordinates, no engineering vocabulary — a
 * partner needs to know where they stand, where people arrive from and where
 * they send them next.
 */

import type {
  EventScenario,
  Project,
  Route,
  RouteType,
  ServiceRole,
  ServiceStation,
  StationType,
  Zone,
  ZoneType,
} from "./model";
import { assetDef } from "./assets";

export type PartnerRole = "all" | "checkin" | "payment" | "guide" | "life";

export interface PartnerRoleDef {
  id: PartnerRole;
  label: string;
  icon: string;
  color: string;
}

export const PARTNER_ROLES: PartnerRoleDef[] = [
  { id: "all", label: "全部", icon: "👀", color: "#e2e8f0" },
  { id: "checkin", label: "報到組", icon: "👋", color: "#38bdf8" },
  { id: "payment", label: "收費組", icon: "💰", color: "#facc15" },
  { id: "guide", label: "引導組", icon: "🧭", color: "#fb923c" },
  { id: "life", label: "生活組", icon: "🧺", color: "#34d399" },
];

export function partnerRoleDef(role: PartnerRole): PartnerRoleDef {
  return PARTNER_ROLES.find((r) => r.id === role) ?? PARTNER_ROLES[0];
}

/** What matters to a role: which zones, routes, objects and stations are theirs. */
export interface RoleFocus {
  zoneTypes: ReadonlySet<ZoneType>;
  routeTypes: ReadonlySet<RouteType>;
  serviceRoles: ReadonlySet<ServiceRole>;
  stationTypes: ReadonlySet<StationType>;
  /** Object kinds a role needs to see even without a service role. */
  objectKinds: ReadonlySet<string>;
}

const FOCUS: Record<Exclude<PartnerRole, "all">, RoleFocus> = {
  checkin: {
    zoneTypes: new Set<ZoneType>(["registration"]),
    routeTypes: new Set<RouteType>(["entry", "registration"]),
    serviceRoles: new Set<ServiceRole>(["checkin"]),
    stationTypes: new Set<StationType>(["checkin"]),
    objectKinds: new Set(["regTable", "door"]),
  },
  payment: {
    zoneTypes: new Set<ZoneType>(["registration"]),
    routeTypes: new Set<RouteType>(["registration"]),
    serviceRoles: new Set<ServiceRole>(["payment"]),
    stationTypes: new Set<StationType>(["payment"]),
    objectKinds: new Set(["regTable"]),
  },
  guide: {
    zoneTypes: new Set<ZoneType>(["shoe", "backpack", "group"]),
    routeTypes: new Set<RouteType>(["entry", "shoe", "backpack", "seating", "group"]),
    serviceRoles: new Set<ServiceRole>(["guidance"]),
    stationTypes: new Set<StationType>(["entrance", "guide", "shoe", "backpack", "seating"]),
    objectKinds: new Set(["door", "screen"]),
  },
  life: {
    zoneTypes: new Set<ZoneType>(["life", "meditation"]),
    routeTypes: new Set<RouteType>(["staff", "group"]),
    serviceRoles: new Set<ServiceRole>(["storage"]),
    stationTypes: new Set<StationType>(["group"]),
    objectKinds: new Set(["table", "chair", "mat"]),
  },
};

export function roleFocus(role: PartnerRole): RoleFocus | null {
  return role === "all" ? null : FOCUS[role];
}

/** Emphasis level used by the scene to fade everything that is not yours. */
export type Emphasis = "primary" | "muted";

export interface PartnerEmphasis {
  zones: Record<string, Emphasis>;
  routes: Record<string, Emphasis>;
  objects: Record<string, Emphasis>;
  /** True when the role owns nothing in this plan — the UI says so plainly. */
  empty: boolean;
}

/**
 * Decide what to highlight for a role. "all" highlights everything, so the
 * first thing a partner sees is the whole plan rather than a filtered one.
 */
export function partnerEmphasis(project: Project, role: PartnerRole): PartnerEmphasis {
  const focus = roleFocus(role);
  const zones: Record<string, Emphasis> = {};
  const routes: Record<string, Emphasis> = {};
  const objects: Record<string, Emphasis> = {};
  let primaries = 0;

  for (const z of project.zones) {
    const on = !focus || focus.zoneTypes.has(z.type);
    zones[z.id] = on ? "primary" : "muted";
    if (on && focus) primaries++;
  }
  for (const r of project.routes) {
    const on = !focus || focus.routeTypes.has(r.type);
    routes[r.id] = on ? "primary" : "muted";
    if (on && focus) primaries++;
  }
  for (const o of project.objects) {
    // An object that declares a service role is judged by that role alone: a
    // payment desk and a check-in desk are both `regTable`, so falling through
    // to the kind list would hand each team the other team's desk.
    const tagged = o.serviceRole && o.serviceRole !== "none";
    const on = !focus
      || (tagged ? focus.serviceRoles.has(o.serviceRole!) : focus.objectKinds.has(o.kind));
    objects[o.id] = on ? "primary" : "muted";
    if (on && focus) primaries++;
  }

  return { zones, routes, objects, empty: !!focus && primaries === 0 };
}

/** One numbered step in the "what happens here" story. */
export interface PartnerStep {
  index: number;
  text: string;
}

export interface RoleBriefing {
  role: PartnerRole;
  /** e.g. 報到組 */
  title: string;
  icon: string;
  /** 你站哪裡 — null when the role has no post in this plan. */
  youAre: string | null;
  /** 人從哪裡來 */
  peopleComeFrom: string | null;
  /** 下一步去哪裡 */
  nextStop: string | null;
  steps: PartnerStep[];
  /** Shown when the plan has nothing for this role yet. */
  emptyHint: string | null;
}

const STATION_LABEL: Record<StationType, string> = {
  entrance: "入口",
  guide: "引導",
  queue: "排隊區",
  checkin: "報到",
  payment: "收費",
  shoe: "鞋子擺放",
  backpack: "背包放置",
  seating: "入座",
  group: "小組",
  custom: "站點",
};

/** Canonical order of the journey, used when a plan has no scenario yet. */
const JOURNEY: StationType[] = [
  "entrance", "guide", "checkin", "payment", "shoe", "backpack", "seating", "group",
];

function orderedStations(project: Project, scenario: EventScenario | null): { type: StationType; name: string }[] {
  if (scenario && scenario.stations.length) {
    const rank = (s: ServiceStation) => {
      const i = JOURNEY.indexOf(s.type);
      return i < 0 ? JOURNEY.length : i;
    };
    return [...scenario.stations]
      .sort((a, b) => rank(a) - rank(b))
      .map((s) => ({ type: s.type, name: s.name || STATION_LABEL[s.type] }));
  }
  // Without a scenario, infer the journey from what the plan actually contains.
  const has = (t: ZoneType) => project.zones.some((z) => z.type === t);
  const steps: StationType[] = ["entrance", "guide"];
  if (has("registration") || project.objects.some((o) => o.serviceRole === "checkin" || o.kind === "regTable")) {
    steps.push("checkin");
  }
  if (project.objects.some((o) => o.serviceRole === "payment")) steps.push("payment");
  if (has("shoe")) steps.push("shoe");
  if (has("backpack")) steps.push("backpack");
  if (has("group") || has("meditation")) steps.push("seating");
  return steps.map((t) => ({ type: t, name: STATION_LABEL[t] }));
}

function roleZone(project: Project, focus: RoleFocus): Zone | null {
  return project.zones.find((z) => focus.zoneTypes.has(z.type)) ?? null;
}

function roleObjectName(project: Project, focus: RoleFocus): string | null {
  const o = project.objects.find((x) => x.serviceRole && focus.serviceRoles.has(x.serviceRole));
  if (o) return assetDef(o.kind).displayName;
  const k = project.objects.find((x) => focus.objectKinds.has(x.kind));
  return k ? assetDef(k.kind).displayName : null;
}

function roleRouteName(project: Project, focus: RoleFocus): string | null {
  const r: Route | undefined = project.routes.find((x) => focus.routeTypes.has(x.type) && x.points.length >= 2);
  return r ? r.name : null;
}

/**
 * The 10-second briefing: where you stand, where people come from, where you
 * send them, and the two or three things you personally do.
 */
export function buildRoleBriefing(
  project: Project,
  role: PartnerRole,
  scenario: EventScenario | null = null,
): RoleBriefing {
  const def = partnerRoleDef(role);
  const journey = orderedStations(project, scenario);

  if (role === "all") {
    const steps = journey.map((s, i) => ({ index: i + 1, text: stepSentence(s.name, i, journey.length) }));
    return {
      role,
      title: "整場流程",
      icon: def.icon,
      youAre: null,
      peopleComeFrom: journey[0] ? `${journey[0].name}` : null,
      nextStop: journey.length > 1 ? journey[journey.length - 1].name : null,
      steps,
      emptyHint: steps.length ? null : "這個場佈還沒有動線與區域，先請主辦加上報到區與入場動線。",
    };
  }

  const focus = FOCUS[role];
  const mine = journey.findIndex((s) => focus.stationTypes.has(s.type));
  const zone = roleZone(project, focus);
  const post = zone?.name ?? roleObjectName(project, focus) ?? (mine >= 0 ? journey[mine].name : null);
  const from = mine > 0 ? journey[mine - 1].name : roleRouteName(project, focus);
  const next = mine >= 0 && mine < journey.length - 1 ? journey[mine + 1].name : null;

  const steps: PartnerStep[] = [];
  if (post) steps.push({ index: 1, text: `到「${post}」就位` });
  if (from) steps.push({ index: steps.length + 1, text: `夥伴從「${from}」過來，請他們排成一排` });
  steps.push({ index: steps.length + 1, text: roleTask(role) });
  if (next) steps.push({ index: steps.length + 1, text: `完成後請他們前往「${next}」` });

  const empty = !post && !from && !next;
  return {
    role,
    title: def.label,
    icon: def.icon,
    youAre: post,
    peopleComeFrom: from,
    nextStop: next,
    steps: empty ? [] : steps,
    emptyHint: empty ? `這個場佈還沒有安排${def.label}的位置，可以先看「全部」。` : null,
  };
}

function roleTask(role: Exclude<PartnerRole, "all">): string {
  switch (role) {
    case "checkin": return "核對名單、發名牌";
    case "payment": return "收費、找零、蓋章";
    case "guide": return "指引方向，讓通道保持順暢";
    case "life": return "準備物資、照顧現場需求";
  }
}

function stepSentence(name: string, index: number, total: number): string {
  if (index === 0) return `從「${name}」進場`;
  if (index === total - 1) return `最後到「${name}」`;
  return `接著到「${name}」`;
}

/** Marker severity shown on the canvas as red / orange / green. */
export type PartnerMarkTone = "bad" | "warn" | "ok";

export interface PartnerMark {
  id: string;
  x: number;
  z: number;
  tone: PartnerMarkTone;
  /** Two-or-three-word label drawn next to the pin. */
  text: string;
  /** The full "what to do about it" sentence, shown in the sheet. */
  action: string;
}

const TONE_BY_SEVERITY: Record<string, PartnerMarkTone> = {
  error: "bad",
  warning: "warn",
  info: "ok",
};

/**
 * Turn validation issues into on-canvas marks. Partners never see rule names or
 * thresholds — just a coloured pin and what to do about it.
 */
export function partnerMarks(
  issues: { id: string; severity: string; shortTitle: string; message: string; suggestedAction?: string; focus: { x: number; z: number } }[],
  limit = 3,
): PartnerMark[] {
  const order: PartnerMarkTone[] = ["bad", "warn", "ok"];
  return issues
    .map((i) => ({
      id: i.id,
      x: i.focus.x,
      z: i.focus.z,
      tone: TONE_BY_SEVERITY[i.severity] ?? "ok",
      // Only the short title goes on the canvas: a full sentence floating over
      // the plan is what made the old team view unreadable.
      text: i.shortTitle,
      action: i.suggestedAction ?? i.message,
    }))
    .sort((a, b) => order.indexOf(a.tone) - order.indexOf(b.tone))
    .slice(0, limit);
}

/** One-line verdict for the header chip: 綠燈 / 橘燈 / 紅燈. */
export function partnerStatus(marks: PartnerMark[]): { tone: PartnerMarkTone; text: string } {
  const bad = marks.filter((m) => m.tone === "bad").length;
  const warn = marks.filter((m) => m.tone === "warn").length;
  if (bad) return { tone: "bad", text: `${bad} 個地方要先處理` };
  if (warn) return { tone: "warn", text: `${warn} 個地方要注意` };
  return { tone: "ok", text: "動線看起來沒問題" };
}
