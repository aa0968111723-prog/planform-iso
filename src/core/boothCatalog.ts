/**
 * Outdoor booth asset catalog (攤位素材).
 *
 * These ship as `custom:*` catalog entries carried in `Project.catalogExtras`,
 * NOT as additions to BUILTIN_CATALOG — so classroom projects, old JSON files
 * and the existing library keep behaving exactly as before. Every entry's
 * `kind` stays inside the original eight ObjectKinds, which is what lets an
 * older build still place, validate and export a booth plan.
 *
 * Dimensions are estimates from standard product sizes — a 3×3 m folding
 * gazebo, a common 台灣 plastic stool, a 180 cm trestle table — plus an assumed
 * 7×7 m pitch. They are NOT read off reference photos: unlike the classroom
 * half of this product, the booth has no photographic record
 * (`docs/field-research/REFERENCE_MAPPING.md` has no booth rows, and the
 * club's 擺攤 folder holds two planning documents and two screen recordings,
 * no images). Every entry is `allowCustomSize`, and the plan carries its
 * 待校正 marking until somebody measures the real pitch.
 *
 * Nothing here bakes in text, a club name or a logo. Boards, banners and
 * standees are blank `replaceable-surface` meshes.
 */

import type { AssetCatalogEntry } from "./catalog";
import {
  uid,
  type BoothParams,
  type BoothScenarioId,
  type BoothStation,
  type BoothStationType,
  type BoothZoneRole,
  type Project,
  type ProjectCatalogExtra,
} from "./model";

export const BOOTH_TAG = "booth";

/**
 * Booth zone vocabulary. Colours match ROUTE/ZONE conventions elsewhere so a
 * booth plan reads with the same legend as a classroom plan.
 */
export const BOOTH_ZONE_ROLES: Record<BoothZoneRole, { label: string; color: string; icon: string }> = {
  staff: { label: "工作人員區", color: "#f43f5e", icon: "🦺" },
  visitor: { label: "訪客站立區", color: "#38bdf8", icon: "🧍" },
  queue: { label: "排隊區", color: "#facc15", icon: "⏳" },
  interact: { label: "互動體驗區", color: "#a78bfa", icon: "🎲" },
  calm: { label: "靜心體驗區", color: "#34d399", icon: "🧘" },
  entry: { label: "入口", color: "#f97316", icon: "🚪" },
  exit: { label: "出口", color: "#94a3b8", icon: "↩" },
};

export const BOOTH_ZONE_ROLE_IDS = Object.keys(BOOTH_ZONE_ROLES) as BoothZoneRole[];

function boothEntry(
  partial: Omit<AssetCatalogEntry, "sourceType" | "createdBy" | "version" | "visualRef" | "tags"> & {
    tags?: string[];
  },
): AssetCatalogEntry {
  return {
    ...partial,
    sourceType: "builtin-procedural",
    createdBy: "builtin",
    version: 1,
    // `custom:booth-tent` → `proc:booth-tent`, matching scene/assets.ts.
    visualRef: `proc:${partial.id.replace(/^custom:/, "")}`,
    planSymbolRef: partial.planSymbolRef ?? "plan:other",
    tags: [BOOTH_TAG, ...(partial.tags ?? [])],
    allowCustomSize: true,
    defaultElevation: partial.defaultElevation ?? 0,
  };
}

/** The twelve booth-only assets. The other three come from BUILTIN_CATALOG. */
export const BOOTH_CATALOG: AssetCatalogEntry[] = [
  boothEntry({
    id: "custom:booth-tent",
    name: "戶外帳篷",
    semanticType: "other",
    category: "custom",
    placementType: "floor",
    dimensions: { width: 3, depth: 3, height: 2.5 },
    defaultFacingDeg: 0,
    clearanceFront: 0,
    // A tent is a roof on four thin legs: people walk under it, so it must not
    // block flow and must not raise an overlap error against what it covers.
    blocksFlow: false,
    serviceRole: "none",
    kind: "table",
    icon: "⛺",
    color: "#f1f5f9",
    tags: ["tent"],
  }),
  boothEntry({
    id: "custom:tent-leg",
    name: "帳篷支架",
    semanticType: "other",
    category: "custom",
    placementType: "floor",
    dimensions: { width: 0.06, depth: 0.06, height: 2.5 },
    defaultFacingDeg: 0,
    clearanceFront: 0,
    blocksFlow: false,
    serviceRole: "none",
    kind: "chair",
    icon: "🁢",
    color: "#9aa3af",
    tags: ["tent"],
  }),
  boothEntry({
    id: "custom:booth-table",
    name: "攤位桌",
    semanticType: "service-desk",
    category: "service",
    placementType: "floor",
    dimensions: { width: 1.8, depth: 0.75, height: 0.74 },
    defaultFacingDeg: 0,
    clearanceFront: 0.6,
    blocksFlow: true,
    serviceRole: "checkin",
    kind: "regTable",
    icon: "🧾",
    color: "#1e3a5f",
    tags: ["desk"],
  }),
  boothEntry({
    id: "custom:red-chair",
    name: "紅色塑膠椅",
    semanticType: "chair",
    category: "furniture",
    placementType: "floor",
    dimensions: { width: 0.42, depth: 0.45, height: 0.8 },
    defaultFacingDeg: 0,
    clearanceFront: 0,
    blocksFlow: false,
    serviceRole: "none",
    kind: "chair",
    icon: "🪑",
    color: "#c0392b",
    tags: ["seat"],
  }),
  boothEntry({
    id: "custom:red-stool",
    name: "紅色椅凳",
    semanticType: "chair",
    category: "furniture",
    placementType: "floor",
    dimensions: { width: 0.35, depth: 0.35, height: 0.45 },
    defaultFacingDeg: 0,
    clearanceFront: 0,
    blocksFlow: false,
    serviceRole: "none",
    kind: "chair",
    icon: "🔴",
    color: "#c0392b",
    tags: ["seat"],
  }),
  boothEntry({
    id: "custom:display-board",
    name: "展示板",
    semanticType: "signage",
    category: "custom",
    placementType: "floor",
    dimensions: { width: 0.8, depth: 0.1, height: 1.5 },
    defaultFacingDeg: 0,
    clearanceFront: 0.6,
    blocksFlow: true,
    serviceRole: "guidance",
    kind: "chair",
    icon: "🪧",
    color: "#f8fafc",
    tags: ["signage", "blank-surface"],
  }),
  boothEntry({
    id: "custom:blank-standee",
    name: "空白立牌",
    semanticType: "signage",
    category: "custom",
    placementType: "floor",
    dimensions: { width: 0.5, depth: 0.35, height: 1.2 },
    defaultFacingDeg: 0,
    clearanceFront: 0.3,
    blocksFlow: false,
    serviceRole: "guidance",
    kind: "chair",
    icon: "▯",
    color: "#f8fafc",
    tags: ["signage", "blank-surface"],
  }),
  boothEntry({
    id: "custom:banner",
    name: "空白布條",
    semanticType: "signage",
    category: "custom",
    placementType: "floor",
    dimensions: { width: 2.4, depth: 0.04, height: 0.5 },
    defaultFacingDeg: 0,
    clearanceFront: 0,
    blocksFlow: false,
    serviceRole: "none",
    kind: "screen",
    icon: "▭",
    color: "#f8fafc",
    // Hangs off the tent valance rather than sitting on the ground.
    defaultElevation: 1.85,
    tags: ["signage", "blank-surface"],
  }),
  boothEntry({
    id: "custom:flyer-tray",
    name: "傳單展示區",
    semanticType: "other",
    category: "custom",
    placementType: "tabletop",
    dimensions: { width: 0.5, depth: 0.32, height: 0.04 },
    defaultFacingDeg: 0,
    clearanceFront: 0,
    blocksFlow: false,
    serviceRole: "none",
    kind: "computer",
    icon: "📄",
    color: "#f8fafc",
    allowedParents: ["table", "regTable"],
    defaultElevation: 0.74,
  }),
  boothEntry({
    id: "custom:table-prop",
    name: "桌面物件",
    semanticType: "other",
    category: "equipment",
    placementType: "tabletop",
    dimensions: { width: 0.24, depth: 0.18, height: 0.16 },
    defaultFacingDeg: 0,
    clearanceFront: 0,
    blocksFlow: false,
    serviceRole: "none",
    kind: "computer",
    icon: "🧺",
    color: "#d9b45b",
    allowedParents: ["table", "regTable"],
    defaultElevation: 0.74,
  }),
  boothEntry({
    id: "custom:token-disc",
    name: "手作圓牌",
    semanticType: "other",
    category: "equipment",
    placementType: "tabletop",
    dimensions: { width: 0.18, depth: 0.18, height: 0.03 },
    defaultFacingDeg: 0,
    clearanceFront: 0,
    blocksFlow: false,
    serviceRole: "none",
    kind: "computer",
    icon: "⏺",
    color: "#e7d7b8",
    allowedParents: ["table", "regTable"],
    defaultElevation: 0.74,
  }),
  boothEntry({
    id: "custom:neighbor-booth",
    name: "隔壁社團攤位",
    semanticType: "other",
    category: "custom",
    placementType: "floor",
    dimensions: { width: 3, depth: 3, height: 2.5 },
    defaultFacingDeg: 0,
    clearanceFront: 0,
    // Not ours: it exists only so the plan shows what the crowd has to walk around.
    blocksFlow: true,
    serviceRole: "none",
    kind: "table",
    icon: "⛺",
    color: "#b3452f",
    tags: ["tent", "neighbour"],
  }),
];

/** Builtins the booth library reuses as-is (no duplicate catalog entries). */
export const BOOTH_BUILTIN_IDS = [
  "builtin:mat",
  "builtin:signage-stand",
  "builtin:queue-barrier",
] as const;

/** Every asset id offered in the booth library, in library order. */
export const BOOTH_ASSET_IDS: string[] = [
  ...BOOTH_CATALOG.map((e) => e.id),
  ...BOOTH_BUILTIN_IDS,
];

const boothById = new Map(BOOTH_CATALOG.map((e) => [e.id, e]));

export function boothCatalogEntry(id: string): AssetCatalogEntry | undefined {
  return boothById.get(id);
}

export function isBoothAssetId(id: string | undefined): boolean {
  return !!id && boothById.has(id);
}

/** Booth dimensions in meters, or null for anything not in this catalog. */
export function boothDimensions(id: string): { width: number; depth: number; height: number } | null {
  const e = boothById.get(id);
  return e ? { ...e.dimensions } : null;
}

/**
 * The `catalogExtras` payload a booth project carries. Written into the
 * project so the entries survive export → import on a machine that has never
 * opened a booth plan before.
 */
export function boothCatalogExtras(): ProjectCatalogExtra[] {
  return BOOTH_CATALOG.map((e) => ({ ...e, dimensions: { ...e.dimensions } })) as ProjectCatalogExtra[];
}

/** Assets a booth plan may legitimately overlap: a roof, a mat, a hung banner. */
export const BOOTH_OVERLAP_EXEMPT: ReadonlySet<string> = new Set<string>([
  "custom:booth-tent",
  "custom:neighbor-booth",
  "custom:banner",
  "builtin:mat",
]);

// --- 攤位活動的既有設定值 ---------------------------------------------------
//
// These moved here from `boothFlow.ts` verbatim. `boothFlow.ts` is a second
// simulation engine and is going away; these are DATA about the club's booth
// activity, and data outlives the engine that first read it. The numbers below
// are exactly the ones the booth simulation has been running with — this was a
// move, not a re-tune.

/** Walking speed at the booth, metres per second. */
export const BOOTH_WALK_SPEED = 1.15;

/** The booth plan's seed. Same plan, same seed, same answer. */
export const BOOTH_DEFAULT_SEED = 20260302;

/**
 * The eight things a visitor can do at the booth, with the dwell times and
 * server counts the booth simulation has always used.
 */
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

/**
 * Order visitors attempt the stations in. 排隊 is the waiting area, not a stop.
 *
 * This used to be a module constant no organiser could reach. It is exported
 * now for one reason: `templateFromBooth` copies it into the STEP LIST, where
 * the order is a row order the user can drag. Nothing else should read it.
 */
export const BOOTH_JOURNEY_ORDER: readonly BoothStationType[] = [
  "board", "queue", "talk", "flyer", "game", "form", "cushion", "photo",
];

/** Probability a visitor skips each station entirely. */
export const BOOTH_SKIP_RATE: Record<BoothStationType, number> = {
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
  return DEFAULT_STATION_LAYOUT.map((s) =>
    createBoothStation(s.type, s.x, s.z, { servers: s.servers, dwell: s.dwell }),
  );
}

/** Does this project carry booth data (and therefore a 模擬 tab)? */
export function isBoothProject(project: Project): boolean {
  return !!project.booth && project.booth.stations.length > 0;
}
