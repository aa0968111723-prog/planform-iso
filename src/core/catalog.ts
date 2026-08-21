/**
 * Asset Catalog 2.0 — Semantic Asset vs Visual Asset separation.
 *
 * SceneObject.kind remains a backward-compatible placement/validation bucket.
 * SceneObject.assetId points at a catalog entry that owns display name, service
 * role, dimensions defaults, and visual/plan-symbol refs.
 */

import type { ObjectKind, Surface } from "./model";

export type AssetSourceType =
  | "builtin-procedural"
  | "generated-procedural"
  | "glb"
  | "gltf"
  | "simple-proxy";

export type SemanticAssetType =
  | "door"
  | "switch"
  | "screen"
  | "table"
  | "chair"
  | "mat"
  | "computer"
  | "service-desk"
  | "storage"
  | "signage"
  | "queue-barrier"
  | "payment-equipment"
  | "other";

export type CatalogCategory =
  | "fixture"
  | "furniture"
  | "equipment"
  | "floor"
  | "service"
  | "custom";

export type PlacementType = Surface;

export type ServiceRole = "checkin" | "payment" | "guidance" | "storage" | "none";

export type AssetCreatedBy = "builtin" | "photo" | "import" | "agent";

export interface CatalogDimensions {
  width: number;
  depth: number;
  height: number;
}

export interface AssetCatalogEntry {
  id: string;
  name: string;
  semanticType: SemanticAssetType;
  sourceType: AssetSourceType;
  category: CatalogCategory;
  placementType: PlacementType;
  dimensions: CatalogDimensions;
  defaultFacingDeg: number;
  clearanceFront: number;
  blocksFlow: boolean;
  serviceRole?: ServiceRole;
  /** Maps to legacy ObjectKind for placement / validation buckets. */
  kind: ObjectKind;
  /** Icon glyph for cards (dependency-free). */
  icon: string;
  color: string;
  visualRef: string;
  planSymbolRef?: string;
  thumbnailRef?: string;
  tags: string[];
  createdBy: AssetCreatedBy;
  version: number;
  /** Optional IDB blob keys. */
  blobIds?: {
    sourceImage?: string;
    glb?: string;
    thumbnail?: string;
  };
  allowCustomSize?: boolean;
  presets?: { id: string; label: string; width: number; depth: number; height?: number }[];
  allowedParents?: ObjectKind[];
  defaultElevation?: number;
}

export const BUILTIN_PREFIX = "builtin:";

function preset(id: string, w: number, d: number, h?: number) {
  const label = `${Math.round(w * 100)} × ${Math.round(d * 100)} cm`;
  return { id, label, width: w, depth: d, height: h };
}

function builtin(
  kind: ObjectKind,
  partial: Omit<AssetCatalogEntry, "id" | "kind" | "sourceType" | "createdBy" | "version" | "visualRef"> & {
    visualRef?: string;
  },
): AssetCatalogEntry {
  const id = `${BUILTIN_PREFIX}${kind}`;
  return {
    ...partial,
    id,
    kind,
    sourceType: "builtin-procedural",
    createdBy: "builtin",
    version: 1,
    visualRef: partial.visualRef ?? `proc:${kind}`,
    planSymbolRef: partial.planSymbolRef ?? `plan:${kind}`,
    allowCustomSize: partial.allowCustomSize ?? true,
    defaultElevation: partial.defaultElevation ?? 0,
  };
}

/** Built-in catalog: original eight + event-adjacent variants (still 8 ObjectKinds). */
export const BUILTIN_CATALOG: AssetCatalogEntry[] = [
  builtin("door", {
    name: "門",
    semanticType: "door",
    category: "fixture",
    placementType: "wall",
    dimensions: { width: 0.9, depth: 0.12, height: 2.0 },
    defaultFacingDeg: 0,
    clearanceFront: 0.9,
    blocksFlow: true,
    serviceRole: "none",
    icon: "🚪",
    color: "#a1a1aa",
    tags: ["fixture", "entrance"],
    presets: [preset("d80", 0.8, 0.12, 2.0), preset("d90", 0.9, 0.12, 2.0), preset("d100", 1.0, 0.12, 2.0)],
    defaultElevation: 0,
  }),
  builtin("switch", {
    name: "電燈開關",
    semanticType: "switch",
    category: "fixture",
    placementType: "wall",
    dimensions: { width: 0.086, depth: 0.04, height: 0.086 },
    defaultFacingDeg: 0,
    clearanceFront: 0,
    blocksFlow: false,
    serviceRole: "none",
    icon: "🔌",
    color: "#e5e7eb",
    tags: ["fixture"],
    allowCustomSize: false,
    presets: [preset("std", 0.086, 0.04, 0.086)],
    defaultElevation: 1.2,
  }),
  builtin("screen", {
    name: "投影幕",
    semanticType: "screen",
    category: "fixture",
    placementType: "wall",
    dimensions: { width: 2.21, depth: 0.08, height: 1.24 },
    defaultFacingDeg: 0,
    clearanceFront: 0,
    blocksFlow: false,
    serviceRole: "none",
    icon: "📽️",
    color: "#f8fafc",
    tags: ["fixture", "av"],
    presets: [
      { id: "in100", label: "100 吋 (221 cm)", width: 2.21, depth: 0.08, height: 1.24 },
      { id: "in120", label: "120 吋 (266 cm)", width: 2.66, depth: 0.08, height: 1.49 },
      { id: "w200", label: "寬 200 cm", width: 2.0, depth: 0.08, height: 1.2 },
    ],
    defaultElevation: 1.0,
  }),
  builtin("table", {
    name: "桌子",
    semanticType: "table",
    category: "furniture",
    placementType: "floor",
    dimensions: { width: 1.2, depth: 0.6, height: 0.74 },
    defaultFacingDeg: 0,
    clearanceFront: 0,
    blocksFlow: true,
    serviceRole: "none",
    icon: "🪑",
    color: "#c8b6a6",
    tags: ["furniture", "desk"],
    presets: [preset("t12060", 1.2, 0.6, 0.74), preset("t18060", 1.8, 0.6, 0.74), preset("t18075", 1.8, 0.75, 0.74)],
  }),
  builtin("chair", {
    name: "椅子",
    semanticType: "chair",
    category: "furniture",
    placementType: "floor",
    dimensions: { width: 0.45, depth: 0.45, height: 0.9 },
    defaultFacingDeg: 0,
    clearanceFront: 0,
    blocksFlow: false,
    serviceRole: "none",
    icon: "💺",
    color: "#b8c0cc",
    tags: ["furniture", "seat"],
    presets: [preset("c45", 0.45, 0.45, 0.9), preset("c50", 0.5, 0.5, 0.9)],
  }),
  builtin("regTable", {
    name: "報到桌",
    semanticType: "service-desk",
    category: "service",
    placementType: "floor",
    dimensions: { width: 1.5, depth: 0.7, height: 0.74 },
    defaultFacingDeg: 0,
    clearanceFront: 0.6,
    blocksFlow: true,
    serviceRole: "checkin",
    icon: "🧾",
    color: "#a8b3a0",
    tags: ["service", "checkin", "desk"],
    presets: [preset("r15070", 1.5, 0.7, 0.74), preset("r18070", 1.8, 0.7, 0.74)],
  }),
  builtin("computer", {
    name: "電腦",
    semanticType: "computer",
    category: "equipment",
    placementType: "tabletop",
    dimensions: { width: 0.5, depth: 0.22, height: 0.4 },
    defaultFacingDeg: 0,
    clearanceFront: 0,
    blocksFlow: false,
    serviceRole: "none",
    icon: "🖥️",
    color: "#94a3b8",
    tags: ["equipment"],
    presets: [preset("std", 0.5, 0.22, 0.4)],
    allowedParents: ["table", "regTable"],
    defaultElevation: 0.74,
  }),
  builtin("mat", {
    name: "地墊",
    semanticType: "mat",
    category: "floor",
    placementType: "floor",
    dimensions: { width: 0.6, depth: 1.8, height: 0.04 },
    defaultFacingDeg: 0,
    clearanceFront: 0,
    blocksFlow: false,
    serviceRole: "none",
    // Green puzzle mat: the club's 巧拼 are green in the event photos
    // (docs/e310/E310_GOLDEN_SCENARIO.md §1.6, REFERENCE_MAPPING M-01).
    // 🧩 rather than 🟩 so it does not collide with the stage platform icon.
    icon: "🧩",
    color: "#4fb89a",
    tags: ["floor", "mat"],
    presets: [
      preset("m60180", 0.6, 1.8, 0.04),
      preset("m60120", 0.6, 1.2, 0.04),
      // The club's actual material, so it reads as 巧拼 rather than a bare size.
      { ...preset("m6060", 0.6, 0.6, 0.04), label: "巧拼 60 × 60 cm" },
    ],
  }),
  // Event-adjacent variants (catalog-only; kind stays one of the eight)
  {
    id: "builtin:stage-platform",
    name: "講台平台",
    semanticType: "other",
    sourceType: "builtin-procedural",
    category: "fixture",
    placementType: "floor",
    dimensions: { width: 6.0, depth: 1.2, height: 0.18 },
    defaultFacingDeg: 0,
    clearanceFront: 0.6,
    blocksFlow: true,
    serviceRole: "none",
    kind: "table",
    icon: "🟩",
    color: "#315b45",
    visualRef: "proc:stage-platform",
    planSymbolRef: "plan:stage-platform",
    tags: ["fixture", "stage", "講台"],
    createdBy: "builtin",
    version: 1,
    allowCustomSize: true,
    presets: [preset("sp60120", 6.0, 1.2, 0.18)],
  },
  {
    id: "builtin:lectern",
    name: "講桌",
    semanticType: "other",
    sourceType: "builtin-procedural",
    category: "fixture",
    placementType: "floor",
    dimensions: { width: 0.6, depth: 0.45, height: 1.1 },
    defaultFacingDeg: 0,
    clearanceFront: 0.6,
    blocksFlow: true,
    serviceRole: "none",
    kind: "table",
    icon: "🎤",
    color: "#8b6b4a",
    visualRef: "proc:lectern",
    planSymbolRef: "plan:lectern",
    tags: ["fixture", "lectern", "講桌"],
    createdBy: "builtin",
    version: 1,
    allowCustomSize: true,
    presets: [preset("l604511", 0.6, 0.45, 1.1)],
  },
  {
    id: "builtin:payment-desk",
    name: "收費桌",
    semanticType: "service-desk",
    sourceType: "builtin-procedural",
    category: "service",
    placementType: "floor",
    dimensions: { width: 1.5, depth: 0.7, height: 0.74 },
    defaultFacingDeg: 0,
    clearanceFront: 0.6,
    blocksFlow: true,
    serviceRole: "payment",
    kind: "table",
    icon: "💳",
    color: "#c4a574",
    visualRef: "proc:payment-desk",
    planSymbolRef: "plan:payment-desk",
    tags: ["service", "payment", "desk"],
    createdBy: "builtin",
    version: 1,
    allowCustomSize: true,
    presets: [preset("p15070", 1.5, 0.7, 0.74), preset("p18070", 1.8, 0.7, 0.74)],
  },
  {
    id: "builtin:signage-stand",
    name: "指示立牌",
    semanticType: "signage",
    sourceType: "builtin-procedural",
    category: "service",
    placementType: "floor",
    dimensions: { width: 0.4, depth: 0.3, height: 1.4 },
    defaultFacingDeg: 0,
    clearanceFront: 0.3,
    blocksFlow: false,
    serviceRole: "guidance",
    kind: "chair",
    icon: "🪧",
    color: "#f1f5f9",
    visualRef: "proc:signage-stand",
    planSymbolRef: "plan:signage",
    tags: ["service", "guidance", "signage"],
    createdBy: "builtin",
    version: 1,
    allowCustomSize: true,
    presets: [preset("s4030", 0.4, 0.3, 1.4)],
  },
  {
    id: "builtin:queue-barrier",
    name: "排隊欄杆",
    semanticType: "queue-barrier",
    sourceType: "builtin-procedural",
    category: "service",
    placementType: "floor",
    dimensions: { width: 1.0, depth: 0.15, height: 0.95 },
    defaultFacingDeg: 0,
    clearanceFront: 0,
    blocksFlow: true,
    serviceRole: "guidance",
    kind: "table",
    icon: "⎯",
    color: "#64748b",
    visualRef: "proc:queue-barrier",
    planSymbolRef: "plan:queue-barrier",
    tags: ["service", "queue"],
    createdBy: "builtin",
    version: 1,
    allowCustomSize: true,
    presets: [preset("q100", 1.0, 0.15, 0.95)],
  },
  {
    id: "builtin:shoe-rack",
    name: "鞋架",
    semanticType: "storage",
    sourceType: "builtin-procedural",
    category: "service",
    placementType: "floor",
    dimensions: { width: 1.0, depth: 0.35, height: 0.8 },
    defaultFacingDeg: 0,
    clearanceFront: 0.4,
    blocksFlow: true,
    serviceRole: "storage",
    kind: "table",
    icon: "👟",
    color: "#94a3b8",
    visualRef: "proc:shoe-rack",
    planSymbolRef: "plan:storage",
    tags: ["service", "storage", "shoes"],
    createdBy: "builtin",
    version: 1,
    allowCustomSize: true,
    presets: [preset("sr10035", 1.0, 0.35, 0.8)],
  },
  {
    id: "builtin:payment-box",
    name: "收費箱",
    semanticType: "payment-equipment",
    sourceType: "builtin-procedural",
    category: "equipment",
    placementType: "tabletop",
    dimensions: { width: 0.25, depth: 0.2, height: 0.18 },
    defaultFacingDeg: 0,
    clearanceFront: 0,
    blocksFlow: false,
    serviceRole: "payment",
    kind: "computer",
    icon: "💵",
    color: "#475569",
    visualRef: "proc:payment-box",
    planSymbolRef: "plan:payment-box",
    tags: ["equipment", "payment"],
    createdBy: "builtin",
    version: 1,
    allowCustomSize: true,
    presets: [preset("pb", 0.25, 0.2, 0.18)],
    allowedParents: ["table", "regTable"],
    defaultElevation: 0.74,
  },
];

const builtinById = new Map(BUILTIN_CATALOG.map((e) => [e.id, e]));
const builtinByKind = new Map<ObjectKind, AssetCatalogEntry>();
for (const e of BUILTIN_CATALOG) {
  if (e.id === `${BUILTIN_PREFIX}${e.kind}` && !builtinByKind.has(e.kind)) {
    builtinByKind.set(e.kind, e);
  }
}

/** Mutable runtime catalog: builtins + project custom extras. */
export class AssetCatalog {
  private extras = new Map<string, AssetCatalogEntry>();
  private recent: string[] = [];

  constructor(extras: AssetCatalogEntry[] = []) {
    for (const e of extras) this.extras.set(e.id, e);
  }

  static builtinId(kind: ObjectKind): string {
    return `${BUILTIN_PREFIX}${kind}`;
  }

  get(id: string): AssetCatalogEntry | undefined {
    return this.extras.get(id) ?? builtinById.get(id);
  }

  /** Resolve entry for a scene object (assetId or kind fallback). */
  resolve(assetId: string | undefined, kind: ObjectKind): AssetCatalogEntry {
    if (assetId) {
      const hit = this.get(assetId);
      if (hit) return hit;
    }
    return builtinByKind.get(kind) ?? BUILTIN_CATALOG[0];
  }

  list(filter?: {
    category?: CatalogCategory;
    tag?: string;
    createdBy?: AssetCreatedBy;
    includeBuiltin?: boolean;
  }): AssetCatalogEntry[] {
    const includeBuiltin = filter?.includeBuiltin !== false;
    const all = [
      ...(includeBuiltin ? BUILTIN_CATALOG : []),
      ...this.extras.values(),
    ];
    return all.filter((e) => {
      if (filter?.category && e.category !== filter.category) return false;
      if (filter?.tag && !e.tags.includes(filter.tag)) return false;
      if (filter?.createdBy && e.createdBy !== filter.createdBy) return false;
      return true;
    });
  }

  upsert(entry: AssetCatalogEntry): void {
    if (entry.id.startsWith(BUILTIN_PREFIX) && builtinById.has(entry.id)) {
      // Allow overriding visual refs on builtins only via extras shadow? Prefer reject.
      throw new Error(`cannot overwrite builtin catalog entry: ${entry.id}`);
    }
    this.extras.set(entry.id, entry);
  }

  remove(id: string): boolean {
    return this.extras.delete(id);
  }

  getExtras(): AssetCatalogEntry[] {
    return [...this.extras.values()];
  }

  setExtras(entries: AssetCatalogEntry[]): void {
    this.extras.clear();
    for (const e of entries) this.extras.set(e.id, e);
  }

  markRecent(id: string): void {
    this.recent = [id, ...this.recent.filter((x) => x !== id)].slice(0, 12);
  }

  listRecent(): AssetCatalogEntry[] {
    return this.recent.map((id) => this.get(id)).filter((e): e is AssetCatalogEntry => !!e);
  }
}

export function kindForSemantic(
  semantic: SemanticAssetType,
  serviceRole?: ServiceRole,
): ObjectKind {
  switch (semantic) {
    case "door":
    case "switch":
    case "screen":
    case "table":
    case "chair":
    case "mat":
    case "computer":
      return semantic;
    case "service-desk":
      return serviceRole === "checkin" ? "regTable" : "table";
    case "payment-equipment":
      return "computer";
    case "storage":
    case "signage":
    case "queue-barrier":
    case "other":
    default:
      return "table";
  }
}

export function missingVisualFallback(entry: Pick<AssetCatalogEntry, "dimensions" | "color" | "name">): AssetCatalogEntry {
  return {
    id: "fallback:missing",
    name: entry.name || "遺失素材",
    semanticType: "other",
    sourceType: "simple-proxy",
    category: "custom",
    placementType: "floor",
    dimensions: entry.dimensions,
    defaultFacingDeg: 0,
    clearanceFront: 0,
    blocksFlow: false,
    serviceRole: "none",
    kind: "table",
    icon: "?",
    color: entry.color || "#64748b",
    visualRef: "proxy:missing",
    planSymbolRef: "plan:other",
    tags: ["fallback"],
    createdBy: "builtin",
    version: 1,
  };
}
