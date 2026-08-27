/**
 * Outdoor booth asset catalog (攤位素材).
 *
 * These ship as `custom:*` catalog entries carried in `Project.catalogExtras`,
 * NOT as additions to BUILTIN_CATALOG — so classroom projects, old JSON files
 * and the existing library keep behaving exactly as before. Every entry's
 * `kind` stays inside the original eight ObjectKinds, which is what lets an
 * older build still place, validate and export a booth plan.
 *
 * Dimensions are honest estimates read off the reference photos, not surveyed
 * measurements: every entry is `allowCustomSize`, and the UI says so until the
 * plan is calibrated on site.
 *
 * Nothing here bakes in text, a club name or a logo. Boards, banners and
 * standees are blank `replaceable-surface` meshes.
 */

import type { AssetCatalogEntry } from "./catalog";
import type { BoothZoneRole, ProjectCatalogExtra } from "./model";

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
