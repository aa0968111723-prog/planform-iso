/**
 * Project migration.
 *
 * v1 → v2: surface / elevation / facing / parent / door / ArrayGroups
 * v2 → v3: measurements + validationSettings
 * v3 → v4: Asset Catalog assetId / serviceRole / catalogExtras
 */

import { AssetCatalog, BUILTIN_PREFIX, type AssetCatalogEntry } from "./catalog";
import {
  createDefaultProject,
  DEFAULT_VALIDATION_SETTINGS,
  PROJECT_VERSION,
  type ArrayGroup,
  type MeasurementAnnotation,
  type ObjectKind,
  type Project,
  type ProjectCatalogExtra,
  type SceneObject,
  type ServiceRole,
} from "./model";

const KINDS: ReadonlySet<string> = new Set<ObjectKind>([
  "computer",
  "door",
  "switch",
  "screen",
  "table",
  "chair",
  "mat",
  "regTable",
]);

const SERVICE_ROLES: ReadonlySet<string> = new Set<ServiceRole>([
  "checkin",
  "payment",
  "guidance",
  "storage",
  "none",
]);

function assetDefFromKind(kind: ObjectKind): AssetCatalogEntry {
  return new AssetCatalog().resolve(undefined, kind);
}

export function migrateObject(input: Partial<SceneObject> & { kind: ObjectKind }): SceneObject {
  const def = assetDefFromKind(input.kind);
  const dims = def.dimensions;

  // A pre-v2 computer with no parent was effectively floor-placed; keep it there
  // rather than instantly flagging it as an orphan tabletop asset.
  const surface =
    input.surface ??
    (input.kind === "computer" && !input.parentId ? "floor" : def.placementType);

  const elevation =
    input.elevation ??
    (surface === "wall"
      ? (def.defaultElevation ?? 0)
      : surface === "tabletop"
        ? (def.defaultElevation ?? 0)
        : 0);

  const assetId = input.assetId ?? `${BUILTIN_PREFIX}${input.kind}`;
  const catalogEntry = new AssetCatalog().get(assetId);
  const serviceRole: ServiceRole | undefined =
    input.serviceRole && SERVICE_ROLES.has(input.serviceRole)
      ? input.serviceRole
      : catalogEntry?.serviceRole;

  const obj: SceneObject = {
    id: input.id ?? `obj_${Math.random().toString(36).slice(2)}`,
    kind: input.kind,
    x: input.x ?? 0,
    z: input.z ?? 0,
    rotationDeg: input.rotationDeg ?? def.defaultFacingDeg,
    width: input.width ?? dims.width,
    depth: input.depth ?? dims.depth,
    height: input.height ?? dims.height,
    locked: input.locked ?? false,
    hidden: input.hidden ?? false,
    surface,
    elevation,
    parentId: input.parentId,
    presetId: input.presetId,
    note: input.note,
    wallAnchor: input.wallAnchor,
    assetId,
    serviceRole,
  };

  if (input.kind === "door") {
    obj.hinge = input.hinge ?? "left";
    obj.openInward = input.openInward ?? true;
    obj.openDeg = input.openDeg ?? 90;
  }
  return obj;
}

function migrateGroup(g: Partial<ArrayGroup>): ArrayGroup | null {
  if (!g || !g.sourceKind || !KINDS.has(g.sourceKind)) return null;
  const def = assetDefFromKind(g.sourceKind);
  return {
    id: g.id ?? `grp_${Math.random().toString(36).slice(2)}`,
    name: g.name ?? "陣列",
    sourceKind: g.sourceKind,
    rows: g.rows ?? 1,
    cols: g.cols ?? 1,
    itemWidth: g.itemWidth ?? def.dimensions.width,
    itemDepth: g.itemDepth ?? def.dimensions.depth,
    itemHeight: g.itemHeight ?? def.dimensions.height,
    gapX: g.gapX ?? 0.1,
    gapZ: g.gapZ ?? 0.1,
    rotationDeg: g.rotationDeg ?? 0,
    anchorX: g.anchorX ?? 0,
    anchorZ: g.anchorZ ?? 0,
    locked: g.locked ?? false,
    hidden: g.hidden ?? false,
    numberPrefix: g.numberPrefix ?? (g.sourceKind === "mat" ? "M" : g.sourceKind === "chair" ? "C" : "A"),
    numberOrder: g.numberOrder ?? "row",
    numberStart: g.numberStart ?? "nw",
  };
}

function migrateMeasurement(m: Partial<MeasurementAnnotation>): MeasurementAnnotation | null {
  if (!m || !m.start || !m.end) return null;
  return {
    id: m.id ?? `msr_${Math.random().toString(36).slice(2)}`,
    type: m.type ?? "free-distance",
    start: { x: m.start.x ?? 0, z: m.start.z ?? 0 },
    end: { x: m.end.x ?? 0, z: m.end.z ?? 0 },
    label: m.label,
    locked: m.locked ?? false,
    visible: m.visible ?? true,
    color: m.color ?? "#facc15",
  };
}

function migrateCatalogExtra(raw: Partial<ProjectCatalogExtra>): ProjectCatalogExtra | null {
  if (!raw || !raw.id || !raw.kind || !KINDS.has(raw.kind)) return null;
  if (typeof raw.name !== "string" || !raw.dimensions) return null;
  return {
    id: raw.id,
    name: raw.name,
    semanticType: raw.semanticType ?? "other",
    sourceType: raw.sourceType ?? "simple-proxy",
    category: raw.category ?? "custom",
    placementType: raw.placementType ?? "floor",
    dimensions: {
      width: raw.dimensions.width ?? 1,
      depth: raw.dimensions.depth ?? 1,
      height: raw.dimensions.height ?? 1,
    },
    defaultFacingDeg: raw.defaultFacingDeg ?? 0,
    clearanceFront: raw.clearanceFront ?? 0,
    blocksFlow: raw.blocksFlow ?? false,
    serviceRole: raw.serviceRole && SERVICE_ROLES.has(raw.serviceRole) ? raw.serviceRole : "none",
    kind: raw.kind,
    icon: raw.icon ?? "📦",
    color: raw.color ?? "#64748b",
    visualRef: raw.visualRef ?? "proxy:missing",
    planSymbolRef: raw.planSymbolRef,
    thumbnailRef: raw.thumbnailRef,
    tags: Array.isArray(raw.tags) ? raw.tags : ["custom"],
    createdBy: raw.createdBy === "import" || raw.createdBy === "agent" || raw.createdBy === "builtin" ? raw.createdBy : "photo",
    version: raw.version ?? 1,
    blobIds: raw.blobIds,
    allowCustomSize: raw.allowCustomSize ?? true,
    defaultElevation: raw.defaultElevation ?? 0,
    allowedParents: raw.allowedParents,
  };
}

/** Fill in any missing fields from an older or partial project blob. */
export function migrateProject(input: Partial<Project>): Project {
  const base = createDefaultProject();
  const p: Project = { ...base, ...input, version: PROJECT_VERSION };
  p.classroom = { ...base.classroom, ...input.classroom };
  p.corridor = { ...base.corridor, ...input.corridor };
  p.tile = { ...base.tile, ...input.tile };
  p.calibration = { ...base.calibration, ...input.calibration };
  p.layers = { ...base.layers, ...input.layers };
  p.zones = Array.isArray(input.zones) ? input.zones : [];
  p.routes = Array.isArray(input.routes) ? input.routes : [];

  const rawObjects: Array<Partial<SceneObject>> = Array.isArray(input.objects) ? input.objects : [];
  p.objects = rawObjects
    .filter((o) => !!o && KINDS.has(String((o as { kind?: string }).kind)))
    .map((o) => migrateObject(o as Partial<SceneObject> & { kind: ObjectKind }));

  const rawGroups = Array.isArray(input.groups) ? input.groups : [];
  p.groups = rawGroups
    .map((g) => migrateGroup(g as Partial<ArrayGroup>))
    .filter((g): g is ArrayGroup => g !== null);

  // v3 additions.
  const rawMeasurements = Array.isArray(input.measurements) ? input.measurements : [];
  p.measurements = rawMeasurements
    .map((m) => migrateMeasurement(m as Partial<MeasurementAnnotation>))
    .filter((m): m is MeasurementAnnotation => m !== null);
  p.validationSettings = { ...DEFAULT_VALIDATION_SETTINGS, ...(input.validationSettings ?? {}) };

  // v4 catalog extras.
  const rawExtras = Array.isArray(input.catalogExtras) ? input.catalogExtras : [];
  p.catalogExtras = rawExtras
    .map((e) => migrateCatalogExtra(e as Partial<ProjectCatalogExtra>))
    .filter((e): e is ProjectCatalogExtra => e !== null);

  return p;
}

export function catalogFromProject(project: Project): AssetCatalog {
  const catalog = new AssetCatalog();
  if (project.catalogExtras?.length) {
    catalog.setExtras(project.catalogExtras as AssetCatalogEntry[]);
  }
  return catalog;
}
