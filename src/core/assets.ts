/**
 * Asset registry — the semantic model for every placeable asset.
 *
 * Instead of treating every kind as an interchangeable box, each asset has a
 * category, a placement surface (floor / wall / tabletop), real-scale default
 * dimensions + common presets, clearance rules and facing behaviour. UI,
 * placement rules, procedural geometry and validation all read from here.
 *
 * All dimensions are meters internally (UI may show cm).
 */

import type { ObjectKind } from "./model";

export type AssetCategory = "fixture" | "furniture" | "equipment" | "floor";

/** Which surface an asset lives on. */
export type PlacementType = "floor" | "wall" | "tabletop";

export interface Dimensions {
  width: number; // +X (meters, before rotation)
  depth: number; // +Z (meters)
  height: number; // +Y (meters)
}

export interface DimensionPreset {
  id: string;
  label: string; // shown in UI, e.g. "120 × 60 cm"
  width: number;
  depth: number;
  height?: number;
}

export interface AssetDefinition {
  kind: ObjectKind;
  category: AssetCategory;
  displayName: string;
  /** One-glyph icon for cards / mobile (kept dependency-free). */
  icon: string;
  placementType: PlacementType;
  defaultDimensions: Dimensions;
  presets: DimensionPreset[];
  allowCustomSize: boolean;
  /** For tabletop assets: which kinds can host them. */
  allowedParents?: ObjectKind[];
  /** Degrees; 0 means facing +Z. */
  defaultFacingDeg: number;
  /** Height of the asset's base above the floor (meters). Wall assets sit up high. */
  defaultElevation: number;
  /** Front clearance to keep free (meters) — used by validation (door sweep etc). */
  clearanceFront: number;
  /** Neutral base color; furniture stays low-saturation on purpose. */
  color: string;
}

export const ASSET_CATEGORIES: { id: AssetCategory; label: string }[] = [
  { id: "fixture", label: "固定設施" },
  { id: "furniture", label: "家具" },
  { id: "equipment", label: "設備" },
  { id: "floor", label: "地面用品" },
];

function preset(id: string, w: number, d: number, h?: number): DimensionPreset {
  const label = h
    ? `${Math.round(w * 100)} × ${Math.round(d * 100)} cm`
    : `${Math.round(w * 100)} × ${Math.round(d * 100)} cm`;
  return { id, label, width: w, depth: d, height: h };
}

export const ASSETS: Record<ObjectKind, AssetDefinition> = {
  door: {
    kind: "door",
    category: "fixture",
    displayName: "門",
    icon: "🚪",
    placementType: "wall",
    defaultDimensions: { width: 0.9, depth: 0.12, height: 2.0 },
    presets: [
      preset("d80", 0.8, 0.12, 2.0),
      preset("d90", 0.9, 0.12, 2.0),
      preset("d100", 1.0, 0.12, 2.0),
    ],
    allowCustomSize: true,
    defaultFacingDeg: 0,
    defaultElevation: 0,
    clearanceFront: 0.9, // door sweep radius ≈ leaf width
    color: "#a1a1aa",
  },
  switch: {
    kind: "switch",
    category: "fixture",
    displayName: "電燈開關",
    icon: "🔌",
    placementType: "wall",
    defaultDimensions: { width: 0.086, depth: 0.04, height: 0.086 },
    presets: [preset("std", 0.086, 0.04, 0.086)],
    allowCustomSize: false,
    defaultFacingDeg: 0,
    defaultElevation: 1.2, // standard switch height
    clearanceFront: 0,
    color: "#e5e7eb",
  },
  screen: {
    kind: "screen",
    category: "fixture",
    displayName: "投影幕",
    icon: "📽️",
    placementType: "wall",
    defaultDimensions: { width: 2.21, depth: 0.08, height: 1.24 }, // ~100"
    presets: [
      { id: "in100", label: "100 吋 (221 cm)", width: 2.21, depth: 0.08, height: 1.24 },
      { id: "in120", label: "120 吋 (266 cm)", width: 2.66, depth: 0.08, height: 1.49 },
      { id: "w200", label: "寬 200 cm", width: 2.0, depth: 0.08, height: 1.2 },
    ],
    allowCustomSize: true,
    defaultFacingDeg: 0,
    defaultElevation: 1.0,
    clearanceFront: 0,
    color: "#f8fafc",
  },
  table: {
    kind: "table",
    category: "furniture",
    displayName: "桌子",
    icon: "🪑",
    placementType: "floor",
    defaultDimensions: { width: 1.2, depth: 0.6, height: 0.74 },
    presets: [
      preset("t12060", 1.2, 0.6, 0.74),
      preset("t18060", 1.8, 0.6, 0.74),
      preset("t18075", 1.8, 0.75, 0.74),
    ],
    allowCustomSize: true,
    defaultFacingDeg: 0,
    defaultElevation: 0,
    clearanceFront: 0,
    color: "#c8b6a6",
  },
  chair: {
    kind: "chair",
    category: "furniture",
    displayName: "椅子",
    icon: "💺",
    placementType: "floor",
    defaultDimensions: { width: 0.45, depth: 0.45, height: 0.9 },
    presets: [preset("c45", 0.45, 0.45, 0.9), preset("c50", 0.5, 0.5, 0.9)],
    allowCustomSize: true,
    defaultFacingDeg: 0,
    defaultElevation: 0,
    clearanceFront: 0,
    color: "#b8c0cc",
  },
  regTable: {
    kind: "regTable",
    category: "furniture",
    displayName: "報到桌",
    icon: "🧾",
    placementType: "floor",
    defaultDimensions: { width: 1.5, depth: 0.7, height: 0.74 },
    presets: [preset("r15070", 1.5, 0.7, 0.74), preset("r18070", 1.8, 0.7, 0.74)],
    allowCustomSize: true,
    defaultFacingDeg: 0,
    defaultElevation: 0,
    clearanceFront: 0,
    color: "#a8b3a0",
  },
  computer: {
    kind: "computer",
    category: "equipment",
    displayName: "電腦",
    icon: "🖥️",
    placementType: "tabletop",
    defaultDimensions: { width: 0.5, depth: 0.22, height: 0.4 },
    presets: [preset("std", 0.5, 0.22, 0.4)],
    allowCustomSize: true,
    allowedParents: ["table", "regTable"],
    defaultFacingDeg: 0,
    defaultElevation: 0.74, // on a table by default
    clearanceFront: 0,
    color: "#94a3b8",
  },
  mat: {
    kind: "mat",
    category: "floor",
    displayName: "地墊",
    icon: "🟪",
    placementType: "floor",
    defaultDimensions: { width: 0.6, depth: 1.8, height: 0.04 },
    presets: [preset("m60180", 0.6, 1.8, 0.04), preset("m60120", 0.6, 1.2, 0.04)],
    allowCustomSize: true,
    defaultFacingDeg: 0,
    defaultElevation: 0,
    clearanceFront: 0,
    color: "#8b8fc7",
  },
};

export function assetDef(kind: ObjectKind): AssetDefinition {
  return ASSETS[kind];
}

export function assetsByCategory(category: AssetCategory): AssetDefinition[] {
  return Object.values(ASSETS).filter((a) => a.category === category);
}

export const ALL_KINDS = Object.keys(ASSETS) as ObjectKind[];
