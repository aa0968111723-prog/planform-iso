/**
 * Project migration.
 *
 * v1 → v2: surface / elevation / facing / parent / door / ArrayGroups
 * v2 → v3: measurements + validationSettings
 * v3 → v4: description, zone icon/capacity, route type + zone links
 * v4 → v5: Asset Catalog assetId / serviceRole / catalogExtras
 * v5 → v6: Event Flow scenarios / ServiceStations
 * v6 → v7: venue identity + independent field-calibration confirmations
 *
 * The outdoor booth fields are version-less: a file without them is a
 * classroom project and stays one, and a booth file opened by a build that
 * predates them keeps its objects, zones and routes.
 */

import { AssetCatalog, BUILTIN_PREFIX, type AssetCatalogEntry } from "./catalog";
import { BOOTH_ZONE_ROLES } from "./boothCatalog";
import { BOOTH_STATION_TYPES, defaultBoothParams } from "./boothFlow";
import {
  createDefaultProject,
  DEFAULT_VALIDATION_SETTINGS,
  PROJECT_VERSION,
  ZONE_DEFAULTS,
  type ArrayGroup,
  type BoothConfig,
  type BoothParams,
  type BoothScenarioId,
  type BoothStation,
  type BoothStationType,
  type BoothZoneRole,
  type EventScenario,
  type MeasurementAnnotation,
  type ObjectKind,
  type ParticipantProfile,
  type Project,
  type ProjectCatalogExtra,
  type Route,
  type SceneObject,
  type ServiceRole,
  type ServiceStation,
  type StationType,
  type Zone,
  uid,
} from "./model";
import { buildSimulationSpatial } from "./simSpatial";

const BOOTH_ZONE_ROLE_SET: ReadonlySet<string> = new Set(Object.keys(BOOTH_ZONE_ROLES));
const BOOTH_STATION_TYPE_SET: ReadonlySet<string> = new Set(Object.keys(BOOTH_STATION_TYPES));

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

function migrateZone(z: Zone): Zone {
  const def = ZONE_DEFAULTS[z.type] ?? ZONE_DEFAULTS.group;
  const boothRole = BOOTH_ZONE_ROLE_SET.has(String(z.boothRole)) ? (z.boothRole as BoothZoneRole) : undefined;
  return { ...z, icon: z.icon ?? def.icon, capacity: z.capacity ?? null, boothRole };
}

function migrateRoute(r: Route): Route {
  return {
    ...r,
    type: r.type ?? "custom",
    startZoneId: r.startZoneId,
    endZoneId: r.endZoneId,
    waypointZoneIds: Array.isArray(r.waypointZoneIds) ? r.waypointZoneIds : undefined,
    boothRole: r.boothRole === "visitor" || r.boothRole === "staff" ? r.boothRole : undefined,
  };
}

function migrateBoothStation(raw: Partial<BoothStation>): BoothStation | null {
  if (!raw || !BOOTH_STATION_TYPE_SET.has(String(raw.boothType))) return null;
  const boothType = raw.boothType as BoothStationType;
  const def = BOOTH_STATION_TYPES[boothType];
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : uid("st"),
    name: typeof raw.name === "string" && raw.name ? raw.name : def.label,
    // Booth stations always sit in the "custom" StationType bucket so an older
    // build reading this file does not choke on an unknown station type.
    type: "custom",
    boothType,
    x: raw.x ?? 0,
    z: raw.z ?? 0,
    staffCount: Math.max(0, raw.staffCount ?? 1),
    parallelServers: Math.max(1, raw.parallelServers ?? def.servers),
    meanServiceSeconds: Math.max(0, raw.meanServiceSeconds ?? def.dwell),
    queueCapacity: Math.max(1, raw.queueCapacity ?? def.queueCapacity),
    enabled: raw.enabled !== false,
  };
}

/**
 * A booth block survives round-tripping; a project without one stays without
 * one. Booth data is never invented for a classroom plan — the 模擬 tab is
 * only offered on a project that actually has a booth.
 */
function migrateBooth(raw: Partial<BoothConfig> | undefined): BoothConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const stations = (Array.isArray(raw.stations) ? raw.stations : [])
    .map((s) => migrateBoothStation(s as Partial<BoothStation>))
    .filter((s): s is BoothStation => s !== null);
  if (!stations.length) return undefined;
  const scenarioId: BoothScenarioId = raw.scenarioId === "peak" ? "peak" : "normal";
  const base = defaultBoothParams(scenarioId);
  const p: Partial<BoothParams> = raw.params ?? {};
  return {
    stations,
    scenarioId,
    params: {
      visitorCount: Math.max(1, Math.round(p.visitorCount ?? base.visitorCount)),
      arrivalPerMin: Math.max(0.1, p.arrivalPerMin ?? base.arrivalPerMin),
      talkSeconds: Math.max(1, p.talkSeconds ?? base.talkSeconds),
      queueCapacity: Math.max(1, Math.round(p.queueCapacity ?? base.queueCapacity)),
      deskStaff: Math.max(1, Math.round(p.deskStaff ?? base.deskStaff)),
      boardDwell: Math.max(0, p.boardDwell ?? base.boardDwell),
      gameDwell: Math.max(0, p.gameDwell ?? base.gameDwell),
      balk: p.balk !== false,
    },
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

function migrateStation(raw: Partial<ServiceStation>): ServiceStation | null {
  if (!raw || typeof raw.id !== "string" || typeof raw.name !== "string") return null;
  const type = (raw.type as StationType) || "custom";
  return {
    id: raw.id,
    name: raw.name,
    type,
    zoneId: raw.zoneId,
    objectId: raw.objectId,
    routeWaypoint: raw.routeWaypoint,
    staffCount: Math.max(1, raw.staffCount ?? 1),
    parallelServers: Math.max(1, raw.parallelServers ?? 1),
    meanServiceSeconds: Math.max(1, raw.meanServiceSeconds ?? 30),
    profileServiceSeconds: raw.profileServiceSeconds,
    serviceVariance: raw.serviceVariance,
    queueCapacity: Math.max(1, raw.queueCapacity ?? 20),
    x: raw.x ?? 0,
    z: raw.z ?? 0,
  };
}

function migrateProfile(raw: Partial<ParticipantProfile>): ParticipantProfile | null {
  if (!raw || !raw.id) return null;
  return {
    id: raw.id,
    ratio: typeof raw.ratio === "number" ? Math.max(0, raw.ratio) : 0,
    branch: Array.isArray(raw.branch) ? raw.branch.filter((b) => typeof b === "string") : [],
  };
}

function migrateScenario(raw: Partial<EventScenario>): EventScenario | null {
  if (!raw || typeof raw.id !== "string" || typeof raw.name !== "string") return null;
  const stations = (Array.isArray(raw.stations) ? raw.stations : [])
    .map((s) => migrateStation(s as Partial<ServiceStation>))
    .filter((s): s is ServiceStation => s !== null);
  const profiles = (Array.isArray(raw.profiles) ? raw.profiles : [])
    .map((p) => migrateProfile(p as Partial<ParticipantProfile>))
    .filter((p): p is ParticipantProfile => p !== null);
  return {
    id: raw.id,
    name: raw.name,
    participantCount: Math.max(1, raw.participantCount ?? 30),
    arrivalWindowSeconds: Math.max(60, raw.arrivalWindowSeconds ?? 1200),
    arrivalProfile: raw.arrivalProfile === "front-loaded" ? "front-loaded" : "uniform",
    profiles: profiles.length
      ? profiles
      : [{ id: "general", ratio: 1, branch: stations.map((s) => s.id) }],
    stations,
    seed: raw.seed ?? 1,
    settings: {
      speedMetersPerSecond: Math.max(0.3, raw.settings?.speedMetersPerSecond ?? 1.0),
    },
  };
}

/** Resolve spatial bindings against the current project without mutating either input. */
export function resolveStationPosition(project: Project, station: ServiceStation): { x: number; z: number } {
  const object = station.objectId && project.objects.find((item) => item.id === station.objectId && !item.hidden);
  if (object) return { x: object.x, z: object.z };
  const zone = station.zoneId && project.zones.find((item) => item.id === station.zoneId && !item.hidden);
  if (zone) return { x: zone.x, z: zone.z };
  return { x: station.x, z: station.z };
}

function zoneParallelServers(project: Project, station: ServiceStation): number {
  if (!station.zoneId || !["shoe", "backpack", "seating"].includes(station.type)) return station.parallelServers;
  const zone = project.zones.find((item) => item.id === station.zoneId && !item.hidden);
  if (!zone) return station.parallelServers;
  return Math.min(12, Math.max(1, Math.floor((zone.width * zone.depth) / 0.5)));
}

/** Rebuild all project-derived station geometry immediately before a simulation. */
export function resolveScenarioBindings(project: Project, scenario: EventScenario): EventScenario {
  return {
    ...scenario,
    stations: scenario.stations.map((station) => ({
      ...station,
      ...resolveStationPosition(project, station),
      parallelServers: zoneParallelServers(project, station),
    })),
    profiles: scenario.profiles.map((profile) => ({ ...profile, branch: [...profile.branch] })),
    settings: { ...scenario.settings },
    spatial: buildSimulationSpatial(project),
  };
}

const STATION_DEFAULTS: Record<StationType, { name: string; meanServiceSeconds: number }> = {
  entrance: { name: "入口", meanServiceSeconds: 5 },
  guide: { name: "引導", meanServiceSeconds: 10 },
  queue: { name: "排隊點", meanServiceSeconds: 5 },
  checkin: { name: "報到", meanServiceSeconds: 45 },
  payment: { name: "收費", meanServiceSeconds: 60 },
  shoe: { name: "鞋子", meanServiceSeconds: 20 },
  backpack: { name: "背包", meanServiceSeconds: 20 },
  seating: { name: "入座", meanServiceSeconds: 15 },
  group: { name: "小組", meanServiceSeconds: 30 },
  custom: { name: "自訂站點", meanServiceSeconds: 30 },
};

/** Build a usable default scenario from current zones / service-role objects. */
export function createDefaultScenario(
  project: Project,
  opts?: Partial<Pick<EventScenario, "name" | "participantCount" | "seed">>,
): EventScenario {
  const stations: ServiceStation[] = [];
  const push = (type: StationType, x: number, z: number, extra?: Partial<ServiceStation>) => {
    const def = STATION_DEFAULTS[type];
    stations.push({
      id: uid("stn"),
      name: extra?.name ?? def.name,
      type,
      staffCount: extra?.staffCount ?? 1,
      parallelServers: extra?.parallelServers ?? 1,
      meanServiceSeconds: extra?.meanServiceSeconds ?? def.meanServiceSeconds,
      queueCapacity: extra?.queueCapacity ?? 30,
      x,
      z,
      zoneId: extra?.zoneId,
      objectId: extra?.objectId,
    });
  };

  // Entrance near corridor mid.
  const corr = project.corridor;
  push("entrance", corr.x + corr.length / 2, corr.z + corr.width / 2);
  push("guide", corr.x + corr.length / 2, corr.z + 0.4);

  const byRole = (role: ServiceRole) =>
    project.objects.find((o) => !o.hidden && o.serviceRole === role);

  const checkinObj = byRole("checkin") ?? project.objects.find((o) => o.kind === "regTable");
  const paymentObj = byRole("payment");
  const checkinZone = project.zones.find((z) => z.type === "registration");
  const shoeZone = project.zones.find((z) => z.type === "shoe");
  const bagZone = project.zones.find((z) => z.type === "backpack");
  const seatZone =
    project.zones.find((z) => z.type === "group") ??
    project.zones.find((z) => z.type === "meditation");

  if (checkinObj) {
    push("checkin", checkinObj.x, checkinObj.z, { objectId: checkinObj.id, name: "報到" });
  } else if (checkinZone) {
    push("checkin", checkinZone.x, checkinZone.z, {
      zoneId: checkinZone.id,
    });
  } else {
    push("checkin", project.classroom.x + 2, project.classroom.z + project.classroom.width - 1.5);
  }

  const paymentZone = project.zones.find((z) => z.type === "payment");
  if (paymentObj) {
    push("payment", paymentObj.x, paymentObj.z, { objectId: paymentObj.id, name: "收費" });
  } else if (paymentZone) {
    push("payment", paymentZone.x, paymentZone.z, {
      zoneId: paymentZone.id,
      name: "收費",
    });
  } else {
    // Combined with checkin by default (same coords, separate station for branching).
    const ck = stations.find((s) => s.type === "checkin")!;
    push("payment", ck.x + 1.5, ck.z, { name: "收費" });
  }

  if (shoeZone) {
    push("shoe", shoeZone.x, shoeZone.z, {
      zoneId: shoeZone.id,
    });
  } else {
    push("shoe", project.classroom.x + 1.5, project.classroom.z + 1.5);
  }

  if (bagZone) {
    push("backpack", bagZone.x, bagZone.z, {
      zoneId: bagZone.id,
    });
  } else {
    push("backpack", project.classroom.x + 3.5, project.classroom.z + 1.5);
  }

  if (seatZone) {
    push("seating", seatZone.x, seatZone.z, {
      zoneId: seatZone.id,
    });
  } else {
    push(
      "seating",
      project.classroom.x + project.classroom.length / 2,
      project.classroom.z + project.classroom.width / 2,
    );
  }

  const idOf = (t: StationType) => stations.find((s) => s.type === t)!.id;
  const fullBranch = [
    idOf("entrance"),
    idOf("guide"),
    idOf("checkin"),
    idOf("payment"),
    idOf("shoe"),
    idOf("backpack"),
    idOf("seating"),
  ];
  const prepaidBranch = [
    idOf("entrance"),
    idOf("guide"),
    idOf("checkin"),
    idOf("shoe"),
    idOf("backpack"),
    idOf("seating"),
  ];

  return {
    id: uid("scn"),
    name: opts?.name ?? "預設進場流程",
    participantCount: opts?.participantCount ?? 60,
    arrivalWindowSeconds: 1200,
    arrivalProfile: "uniform",
    profiles: [
      { id: "prepaid", ratio: 2 / 3, branch: prepaidBranch },
      { id: "pay-on-site", ratio: 1 / 3, branch: fullBranch },
    ],
    stations,
    seed: opts?.seed ?? 1,
    settings: { speedMetersPerSecond: 1.0 },
  };
}

/** Fill in any missing fields from an older or partial project blob. */
export function migrateProject(input: Partial<Project>): Project {
  const base = createDefaultProject();
  const p: Project = { ...base, ...input, version: PROJECT_VERSION };
  // v8: keep an existing id. Without this the fresh uid() from
  // createDefaultProject() would be overwritten by the spread only when the
  // input HAS one — and a document without one must keep the fresh id rather
  // than inherit a shared constant. Guards "" and non-strings from hand-edited
  // or foreign JSON.
  p.id = typeof input.id === "string" && input.id.length > 0 ? input.id : base.id;
  p.classroom = { ...base.classroom, ...input.classroom };
  p.corridor = { ...base.corridor, ...input.corridor };
  p.tile = { ...base.tile, ...input.tile };
  p.calibration = {
    ...base.calibration,
    ...input.calibration,
    confirmed: { ...base.calibration.confirmed, ...(input.calibration?.confirmed ?? {}) },
  };
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

  // v5 catalog extras (v4 visual-comm fields already handled above).
  const rawExtras = Array.isArray(input.catalogExtras) ? input.catalogExtras : [];
  p.catalogExtras = rawExtras
    .map((e) => migrateCatalogExtra(e as Partial<ProjectCatalogExtra>))
    .filter((e): e is ProjectCatalogExtra => e !== null);

  // v6 event-flow scenarios.
  const rawScenarios = Array.isArray(input.scenarios) ? input.scenarios : [];
  p.scenarios = rawScenarios
    .map((s) => migrateScenario(s as Partial<EventScenario>))
    .filter((s): s is EventScenario => s !== null);
  p.activeScenarioId =
    typeof input.activeScenarioId === "string"
      ? input.activeScenarioId
      : p.scenarios[0]?.id ?? null;
  if (p.activeScenarioId && !p.scenarios.some((s) => s.id === p.activeScenarioId)) {
    p.activeScenarioId = p.scenarios[0]?.id ?? null;
  }

  // Outdoor booth (optional; absent on every classroom project).
  p.booth = migrateBooth(input.booth);
  if (!p.booth) delete p.booth;

  return p;
}

export function catalogFromProject(project: Project): AssetCatalog {
  const catalog = new AssetCatalog();
  if (project.catalogExtras?.length) {
    catalog.setExtras(project.catalogExtras as AssetCatalogEntry[]);
  }
  return catalog;
}
