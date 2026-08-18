/**
 * Asset registry — compatibility shim over Asset Catalog 2.0.
 *
 * Existing UI / placement / validation keep calling assetDef(kind). New code
 * should prefer catalog.resolve(assetId, kind). Dimensions remain meters.
 */

import {
  AssetCatalog,
  BUILTIN_CATALOG,
  type AssetCatalogEntry,
  type CatalogCategory,
  type PlacementType,
} from "./catalog";
import type { ObjectKind } from "./model";

export type AssetCategory = "fixture" | "furniture" | "equipment" | "floor";

export type { PlacementType };

export interface Dimensions {
  width: number;
  depth: number;
  height: number;
}

export interface DimensionPreset {
  id: string;
  label: string;
  width: number;
  depth: number;
  height?: number;
}

export interface AssetDefinition {
  kind: ObjectKind;
  category: AssetCategory;
  displayName: string;
  icon: string;
  placementType: PlacementType;
  defaultDimensions: Dimensions;
  presets: DimensionPreset[];
  allowCustomSize: boolean;
  allowedParents?: ObjectKind[];
  defaultFacingDeg: number;
  defaultElevation: number;
  clearanceFront: number;
  color: string;
  /** Catalog id for this builtin kind. */
  assetId: string;
}

export const ASSET_CATEGORIES: { id: AssetCategory; label: string }[] = [
  { id: "fixture", label: "固定設施" },
  { id: "furniture", label: "家具" },
  { id: "equipment", label: "設備" },
  { id: "floor", label: "地面用品" },
];

export const CATALOG_CATEGORIES: { id: CatalogCategory; label: string }[] = [
  { id: "fixture", label: "場地設施" },
  { id: "furniture", label: "桌椅" },
  { id: "equipment", label: "設備" },
  { id: "floor", label: "地墊" },
  { id: "service", label: "報到 / 收費" },
  { id: "custom", label: "我的素材" },
];

function toLegacyCategory(c: CatalogCategory): AssetCategory {
  if (c === "service") return "furniture";
  if (c === "custom") return "furniture";
  return c;
}

export function entryToAssetDefinition(e: AssetCatalogEntry): AssetDefinition {
  return {
    kind: e.kind,
    category: toLegacyCategory(e.category),
    displayName: e.name,
    icon: e.icon,
    placementType: e.placementType,
    defaultDimensions: { ...e.dimensions },
    presets: e.presets ?? [],
    allowCustomSize: e.allowCustomSize ?? true,
    allowedParents: e.allowedParents,
    defaultFacingDeg: e.defaultFacingDeg,
    defaultElevation: e.defaultElevation ?? 0,
    clearanceFront: e.clearanceFront,
    color: e.color,
    assetId: e.id,
  };
}

/** Built-in ObjectKind → definition (original eight only). */
export const ASSETS: Record<ObjectKind, AssetDefinition> = (() => {
  const catalog = new AssetCatalog();
  const out = {} as Record<ObjectKind, AssetDefinition>;
  for (const kind of [
    "door",
    "switch",
    "screen",
    "table",
    "chair",
    "regTable",
    "computer",
    "mat",
  ] as ObjectKind[]) {
    out[kind] = entryToAssetDefinition(catalog.resolve(AssetCatalog.builtinId(kind), kind));
  }
  return out;
})();

export function assetDef(kind: ObjectKind): AssetDefinition {
  return ASSETS[kind];
}

export function assetsByCategory(category: AssetCategory): AssetDefinition[] {
  return Object.values(ASSETS).filter((a) => a.category === category);
}

export const ALL_KINDS = Object.keys(ASSETS) as ObjectKind[];

/** Prefer this for library UI — includes service variants. */
export function listLibraryEntries(catalog: AssetCatalog = new AssetCatalog()): AssetCatalogEntry[] {
  return catalog.list({ includeBuiltin: true });
}

export { BUILTIN_CATALOG, AssetCatalog };
