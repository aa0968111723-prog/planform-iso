/**
 * Local-first project data model (v2). All spatial values are in meters
 * (1 Three.js unit = 1 meter). Angles are in degrees; an object's rotationDeg
 * is its yaw about +Y and also defines the direction it faces (0 = facing +Z).
 *
 * v2 upgrades objects from interchangeable boxes to semantic assets with a
 * placement surface, elevation, parent (tabletop), wall anchor and door
 * behaviour, and adds ArrayGroups for repeated layouts. See assets.ts.
 */

export const PROJECT_VERSION = 4;

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
  | "life"
  | "group"
  | "meditation"
  | "shoe"
  | "backpack";

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
  | "entry" | "registration" | "shoe" | "backpack" | "seating" | "group" | "staff" | "custom";

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

export interface Project {
  version: number;
  name: string;
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
  life: { label: "生活組區", color: "#34d399", width: 2, depth: 2, icon: "🧺" },
  group: { label: "小組組別區", color: "#a78bfa", width: 3, depth: 3, icon: "👥" },
  meditation: { label: "講師禪定區", color: "#f472b6", width: 2, depth: 2, icon: "🧘" },
  shoe: { label: "鞋子擺放區", color: "#fbbf24", width: 2, depth: 1, icon: "👟" },
  backpack: { label: "背包放置區", color: "#fb923c", width: 2, depth: 1, icon: "🎒" },
};

export function createDefaultProject(): Project {
  return {
    version: PROJECT_VERSION,
    name: "未命名平面圖",
    description: "",
    classroom: { id: "classroom", name: "教室", length: 10, width: 8, x: 0, z: 0 },
    corridor: { id: "corridor", name: "走廊", length: 10, width: 2, x: 0, z: 8 },
    tile: { width: 0.6, depth: 0.6, originX: 0, originZ: 0, rotationDeg: 0, visible: true },
    calibration: { referenceLength: null, note: "" },
    zones: [],
    objects: [],
    groups: [],
    routes: [],
    measurements: [],
    validationSettings: { ...DEFAULT_VALIDATION_SETTINGS },
    view: "top",
    layers: { areas: true, zones: true, objects: true, tiles: true, routes: true },
  };
}
