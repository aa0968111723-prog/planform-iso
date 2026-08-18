/**
 * Project migration. Older (v1) projects stored objects as plain boxes with no
 * placement semantics; v2 adds surface / elevation / facing / parent / door
 * behaviour and ArrayGroups. Migration derives sensible defaults from the asset
 * registry so existing saved plans keep working and nothing disappears.
 */

import { assetDef } from "./assets";
import {
  createDefaultProject,
  DEFAULT_VALIDATION_SETTINGS,
  PROJECT_VERSION,
  ZONE_DEFAULTS,
  type ArrayGroup,
  type MeasurementAnnotation,
  type ObjectKind,
  type Project,
  type Route,
  type SceneObject,
  type Zone,
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

export function migrateObject(input: Partial<SceneObject> & { kind: ObjectKind }): SceneObject {
  const def = assetDef(input.kind);
  const dims = def.defaultDimensions;

  // A pre-v2 computer with no parent was effectively floor-placed; keep it there
  // rather than instantly flagging it as an orphan tabletop asset.
  const surface =
    input.surface ??
    (input.kind === "computer" && !input.parentId ? "floor" : def.placementType);

  const elevation =
    input.elevation ??
    (surface === "wall"
      ? def.defaultElevation
      : surface === "tabletop"
        ? def.defaultElevation
        : 0);

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
  const def = assetDef(g.sourceKind);
  return {
    id: g.id ?? `grp_${Math.random().toString(36).slice(2)}`,
    name: g.name ?? "陣列",
    sourceKind: g.sourceKind,
    rows: g.rows ?? 1,
    cols: g.cols ?? 1,
    itemWidth: g.itemWidth ?? def.defaultDimensions.width,
    itemDepth: g.itemDepth ?? def.defaultDimensions.depth,
    itemHeight: g.itemHeight ?? def.defaultDimensions.height,
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

function migrateZone(z: Zone): Zone {
  const def = ZONE_DEFAULTS[z.type] ?? ZONE_DEFAULTS.group;
  return { ...z, icon: z.icon ?? def.icon, capacity: z.capacity ?? null };
}

function migrateRoute(r: Route): Route {
  return {
    ...r,
    type: r.type ?? "custom",
    startZoneId: r.startZoneId,
    endZoneId: r.endZoneId,
    waypointZoneIds: Array.isArray(r.waypointZoneIds) ? r.waypointZoneIds : undefined,
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

/** Fill in any missing fields from an older or partial project blob. */
export function migrateProject(input: Partial<Project>): Project {
  const base = createDefaultProject();
  const p: Project = { ...base, ...input, version: PROJECT_VERSION };
  p.classroom = { ...base.classroom, ...input.classroom };
  p.corridor = { ...base.corridor, ...input.corridor };
  p.tile = { ...base.tile, ...input.tile };
  p.calibration = { ...base.calibration, ...input.calibration };
  p.layers = { ...base.layers, ...input.layers };
  p.description = input.description ?? "";
  p.zones = (Array.isArray(input.zones) ? input.zones : []).map(migrateZone);
  p.routes = (Array.isArray(input.routes) ? input.routes : []).map(migrateRoute);

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

  return p;
}
