/**
 * Local-first project data model. All spatial values are in meters
 * (1 Three.js unit = 1 meter). Angles are in degrees; an object's rotationDeg
 * is its yaw about +Y and also defines the direction it faces (0 = facing +Z).
 *
 * v2: semantic placement (surface / elevation / parent / wall / door) + arrays.
 * v3: measurements + validation settings.
 * v4: visual-comm — description, zone icon/capacity, route type + zone links.
 * v5: Asset Catalog — optional assetId / serviceRole; custom catalogExtras.
 * v6: Event Flow — ServiceStation / EventScenario for DES simulation.
 * v7: E310 venue identity + three independent field-calibration confirmations.
 */

export const PROJECT_VERSION = 7;

export type ServiceRole = "checkin" | "payment" | "guidance" | "storage" | "none";

export interface AreaConfig {
  id: "classroom" | "corridor";
  name: string;
  length: number; // +X, meters
  width: number; // +Z, meters
  x: number; // north-west corner, meters
  z: number;
}

export interface TileConfig {
  width: number; // meters (+X)
  depth: number; // meters (+Z)
  originX: number;
  originZ: number;
  rotationDeg: number;
  visible: boolean;
}

export interface Calibration {
  referenceLength: number | null;
  note: string;
  /** Independent on-site confirmations; missing means not yet confirmed. */
  confirmed: {
    tile?: boolean;
    door?: boolean;
    room?: boolean;
  };
}

export type ObjectKind =
  | "computer"
  | "door"
  | "switch"
  | "screen"
  | "table"
  | "chair"
  | "mat"
  | "regTable";

export type Surface = "floor" | "wall" | "tabletop";
export type WallEdge = "n" | "s" | "e" | "w";
export type HingeSide = "left" | "right";

export interface WallAnchor {
  areaId: "classroom" | "corridor";
  edge: WallEdge;
  /** Distance (meters) along the wall from its min corner to the object center. */
  offset: number;
}

export interface SceneObject {
  id: string;
  kind: ObjectKind;
  x: number; // center, meters
  z: number;
  rotationDeg: number; // yaw = facing (0 faces +Z)
  width: number; // meters (+X before rotation)
  depth: number; // meters (+Z before rotation)
  height: number; // meters (+Y)
  locked: boolean;
  hidden: boolean;

  // v2 semantic placement
  surface: Surface;
  elevation: number; // base above floor (meters)
  parentId?: string; // tabletop host
  presetId?: string;
  note?: string;
  wallAnchor?: WallAnchor;

  // door-specific
  hinge?: HingeSide;
  openInward?: boolean;
  openDeg?: number;

  // v4 Asset Catalog
  /** Catalog entry id (builtin:kind or custom:*). */
  assetId?: string;
  serviceRole?: ServiceRole;
}

export type NumberOrder = "row" | "col";
export type NumberStart = "nw" | "ne" | "sw" | "se";

/** A repeated layout (e.g. a mat block or a chair grid) kept as one editable unit. */
export interface ArrayGroup {
  id: string;
  name: string;
  sourceKind: ObjectKind;
  rows: number; // along +Z
  cols: number; // along +X
  itemWidth: number;
  itemDepth: number;
  itemHeight: number;
  gapX: number;
  gapZ: number;
  rotationDeg: number;
  anchorX: number; // min-corner anchor (meters), pre-rotation
  anchorZ: number;
  locked: boolean;
  hidden: boolean;
  // v3 construction numbering
  numberPrefix: string; // e.g. "A" → A-01
  numberOrder: NumberOrder; // row-first or column-first
  numberStart: NumberStart; // which corner is #1
}

export type MeasurementType = "free-distance" | "wall-clearance" | "object-gap" | "aisle-width";

/** A persistent (or session) on-canvas dimension line. */
export interface MeasurementAnnotation {
  id: string;
  type: MeasurementType;
  start: { x: number; z: number };
  end: { x: number; z: number };
  label?: string;
  locked: boolean;
  visible: boolean;
  color: string;
}

/** User-configurable field rules (thresholds, not legal standards). */
export interface ValidationSettings {
  minAisleWidth: number; // meters
  doorFrontClearance: number; // extra meters kept clear in front of a door
  matWallClearance: number; // min meters between mats and walls
  checkScreenView: boolean;
  checkZoneRouteIntrusion: boolean;
}

export const DEFAULT_VALIDATION_SETTINGS: ValidationSettings = {
  minAisleWidth: 0.9,
  doorFrontClearance: 0.6,
  matWallClearance: 0.3,
  checkScreenView: true,
  checkZoneRouteIntrusion: true,
};

export type ZoneType =
  | "registration"
  | "payment"
  | "life"
  | "group"
  | "meditation"
  | "shoe"
  | "backpack"
  | "custom";

export interface Zone {
  id: string;
  type: ZoneType;
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  color: string;
  locked: boolean;
  hidden: boolean;
  icon: string;
  /** Optional people capacity, shown on the zone label for quick comprehension. */
  capacity: number | null;
}

export interface RoutePoint {
  x: number;
  z: number;
}

export type RouteType =
  | "entry" | "registration" | "payment" | "shoe" | "backpack" | "seating" | "group" | "staff" | "custom";

export interface Route {
  id: string;
  name: string;
  color: string;
  points: RoutePoint[];
  visible: boolean;
  type: RouteType;
  /** Optional zone associations so a route can be re-checked when zones move. */
  startZoneId?: string;
  endZoneId?: string;
  waypointZoneIds?: string[];
}

export type ViewName = "iso" | "top" | "front" | "left" | "right";

export interface LayerVisibility {
  areas: boolean;
  zones: boolean;
  objects: boolean;
  tiles: boolean;
  routes: boolean;
}

// --- v6 Event Flow -------------------------------------------------------

export type StationType =
  | "entrance"
  | "guide"
  | "queue"
  | "checkin"
  | "payment"
  | "shoe"
  | "backpack"
  | "seating"
  | "group"
  | "custom";

export interface ServiceStation {
  id: string;
  name: string;
  type: StationType;
  zoneId?: string;
  objectId?: string;
  routeWaypoint?: { routeId: string; index: number };
  staffCount: number;
  parallelServers: number;
  meanServiceSeconds: number;
  /** Optional branch-specific duration, used by a shared desk variant. */
  profileServiceSeconds?: Partial<Record<ParticipantProfileId, number>>;
  serviceVariance?: number;
  queueCapacity: number;
  /** Spatial position in meters (derived from zone/object when bound). */
  x: number;
  z: number;
}

export type ParticipantProfileId = "general" | "prepaid" | "pay-on-site" | "staff";

export interface ParticipantProfile {
  id: ParticipantProfileId;
  /** Fraction of participants using this profile (0–1). Ratios are normalized. */
  ratio: number;
  /** Ordered station ids for this profile's branch. */
  branch: string[];
}

export type ArrivalProfile = "uniform" | "front-loaded";

export interface SimulationDoor {
  id: string;
  x: number;
  z: number;
  width: number;
  /** 1 is unobstructed; lower values represent a narrower or blocked passage. */
  throughput: number;
  blocked: boolean;
}

export interface SimulationSpatial {
  routes: Route[];
  corridor: AreaConfig;
  classroom: AreaConfig;
  doors: SimulationDoor[];
}

export interface EventScenario {
  id: string;
  name: string;
  participantCount: number;
  arrivalWindowSeconds: number;
  arrivalProfile: ArrivalProfile;
  profiles: ParticipantProfile[];
  stations: ServiceStation[];
  seed: number;
  settings: { speedMetersPerSecond: number };
  spatial?: SimulationSpatial;
}

/** Custom catalog entry metadata stored in project JSON (blobs live in IndexedDB). */
export interface ProjectCatalogExtra {
  id: string;
  name: string;
  semanticType: string;
  sourceType: string;
  category: string;
  placementType: Surface;
  dimensions: { width: number; depth: number; height: number };
  defaultFacingDeg: number;
  clearanceFront: number;
  blocksFlow: boolean;
  serviceRole?: ServiceRole;
  kind: ObjectKind;
  icon: string;
  color: string;
  visualRef: string;
  planSymbolRef?: string;
  thumbnailRef?: string;
  tags: string[];
  createdBy: "photo" | "import" | "agent" | "builtin";
  version: number;
  blobIds?: { sourceImage?: string; glb?: string; thumbnail?: string };
  allowCustomSize?: boolean;
  defaultElevation?: number;
  allowedParents?: ObjectKind[];
}

export interface Project {
  version: number;
  name: string;
  /** Built-in venue identity, retained so honest calibration copy survives reload. */
  venuePresetId?: string;
  /** Short activity description shown in the team/partner view. */
  description: string;
  classroom: AreaConfig;
  corridor: AreaConfig;
  tile: TileConfig;
  calibration: Calibration;
  zones: Zone[];
  objects: SceneObject[];
  groups: ArrayGroup[];
  routes: Route[];
  measurements: MeasurementAnnotation[];
  validationSettings: ValidationSettings;
  view: ViewName;
  layers: LayerVisibility;
  /** v5: user/custom catalog entries (binary blobs referenced via blobIds). */
  catalogExtras?: ProjectCatalogExtra[];
  /** v6: event-flow simulation scenarios (DES). */
  scenarios: EventScenario[];
  activeScenarioId: string | null;
}

let idCounter = 0;
export function uid(prefix = "id"): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

export const ZONE_DEFAULTS: Record<
  ZoneType,
  { label: string; color: string; width: number; depth: number; icon: string }
> = {
  registration: { label: "報到區", color: "#38bdf8", width: 2.5, depth: 1.5, icon: "👋" },
  payment: { label: "收費區", color: "#facc15", width: 2, depth: 1.5, icon: "💰" },
  life: { label: "生活組區", color: "#34d399", width: 2, depth: 2, icon: "🧺" },
  group: { label: "小組組別區", color: "#a78bfa", width: 3, depth: 3, icon: "👥" },
  meditation: { label: "講師禪定區", color: "#f472b6", width: 2, depth: 2, icon: "🧘" },
  shoe: { label: "鞋子擺放區", color: "#fbbf24", width: 2, depth: 1, icon: "👟" },
  backpack: { label: "背包放置區", color: "#fb923c", width: 2, depth: 1, icon: "🎒" },
  custom: { label: "自訂區", color: "#94a3b8", width: 2, depth: 2, icon: "📦" },
};

export function createDefaultProject(): Project {
  return {
    version: PROJECT_VERSION,
    name: "未命名平面圖",
    description: "",
    classroom: { id: "classroom", name: "教室", length: 10, width: 8, x: 0, z: 0 },
    corridor: { id: "corridor", name: "走廊", length: 10, width: 2, x: 0, z: 8 },
    tile: { width: 0.6, depth: 0.6, originX: 0, originZ: 0, rotationDeg: 0, visible: true },
    calibration: { referenceLength: null, note: "", confirmed: {} },
    zones: [],
    objects: [],
    groups: [],
    routes: [],
    measurements: [],
    validationSettings: { ...DEFAULT_VALIDATION_SETTINGS },
    view: "top",
    layers: { areas: true, zones: true, objects: true, tiles: true, routes: true },
    catalogExtras: [],
    scenarios: [],
    activeScenarioId: null,
  };
}

/**
 * Is there work in this plan that replacing it would throw away?
 *
 * Counts everything the user builds by hand, not just the furniture: a plan
 * holding only 尺寸線 (a measured-up room, before anything is placed) or only
 * saved 情境 is exactly the kind of work that used to be replaced with no
 * confirmation at all, because the check looked at objects/zones/groups/routes.
 */
export function planHasContent(project: Project): boolean {
  return project.objects.length > 0
    || project.zones.length > 0
    || project.groups.length > 0
    || project.routes.length > 0
    || project.measurements.length > 0
    || project.scenarios.length > 0;
}

export function venueNeedsCalibration(project: Project): boolean {
  return project.venuePresetId === "venue:tku-e310";
}

export function calibrationComplete(project: Project): boolean {
  if (!venueNeedsCalibration(project)) return true;
  const c = project.calibration.confirmed;
  return c.tile === true && c.door === true && c.room === true;
}

export function calibrationPendingLabels(project: Project): string[] {
  if (!venueNeedsCalibration(project)) return [];
  const c = project.calibration.confirmed;
  return [
    c.tile ? null : "地磚",
    c.door ? null : "門寬",
    c.room ? null : "已知距離",
  ].filter((x): x is string => x !== null);
}
