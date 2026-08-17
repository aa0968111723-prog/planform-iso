/**
 * Local-first project data model. All spatial values are in meters
 * (1 Three.js unit = 1 meter). Angles are in degrees, measured clockwise
 * about the +Y axis in the X/Z plane.
 */

export const PROJECT_VERSION = 1;

export interface AreaConfig {
  /** "classroom" | "corridor" — a large physical area. */
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
  originX: number; // meters
  originZ: number; // meters
  rotationDeg: number; // grid orientation
  visible: boolean;
}

export interface Calibration {
  /**
   * A known real-world reference length (meters) for a measured segment,
   * used to sanity-check scale on site. Purely informational metadata.
   */
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

export interface SceneObject {
  id: string;
  kind: ObjectKind;
  x: number; // center, meters
  z: number;
  rotationDeg: number;
  width: number; // meters (+X before rotation)
  depth: number; // meters (+Z before rotation)
  height: number; // meters (+Y)
  locked: boolean;
  hidden: boolean;
  /** Door-only: hinge/open direction indicator, degrees. */
  openDeg?: number;
}

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
  x: number; // center, meters
  z: number;
  width: number; // meters (+X)
  depth: number; // meters (+Z)
  color: string; // hex
  locked: boolean;
  hidden: boolean;
}

export interface RoutePoint {
  x: number;
  z: number;
}

export interface Route {
  id: string;
  name: string;
  color: string;
  points: RoutePoint[];
  visible: boolean;
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
  classroom: AreaConfig;
  corridor: AreaConfig;
  tile: TileConfig;
  calibration: Calibration;
  zones: Zone[];
  objects: SceneObject[];
  routes: Route[];
  view: ViewName;
  layers: LayerVisibility;
}

let idCounter = 0;
export function uid(prefix = "id"): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

/** Default real-scale object dimensions (meters). */
export const OBJECT_DEFAULTS: Record<
  ObjectKind,
  { width: number; depth: number; height: number; label: string; color: string }
> = {
  computer: { width: 0.5, depth: 0.5, height: 0.4, label: "電腦", color: "#64748b" },
  door: { width: 0.9, depth: 0.12, height: 2.0, label: "門", color: "#a16207" },
  switch: { width: 0.12, depth: 0.05, height: 0.12, label: "電燈開關", color: "#eab308" },
  screen: { width: 2.0, depth: 0.1, height: 1.2, label: "投影幕", color: "#1d4ed8" },
  table: { width: 1.2, depth: 0.6, height: 0.74, label: "桌子", color: "#b08968" },
  chair: { width: 0.45, depth: 0.45, height: 0.9, label: "椅子", color: "#94a3b8" },
  mat: { width: 0.6, depth: 1.8, height: 0.05, label: "地墊", color: "#ef476f" },
  regTable: { width: 1.5, depth: 0.7, height: 0.74, label: "報到桌", color: "#0d9488" },
};

export const ZONE_DEFAULTS: Record<
  ZoneType,
  { label: string; color: string; width: number; depth: number }
> = {
  registration: { label: "報到區", color: "#38bdf8", width: 2.5, depth: 1.5 },
  life: { label: "生活組區", color: "#34d399", width: 2, depth: 2 },
  group: { label: "小組組別區", color: "#a78bfa", width: 3, depth: 3 },
  meditation: { label: "講師禪定區", color: "#f472b6", width: 2, depth: 2 },
  shoe: { label: "鞋子擺放區", color: "#fbbf24", width: 2, depth: 1 },
  backpack: { label: "背包放置區", color: "#fb923c", width: 2, depth: 1 },
};

export function createDefaultProject(): Project {
  return {
    version: PROJECT_VERSION,
    name: "未命名平面圖",
    classroom: {
      id: "classroom",
      name: "教室",
      length: 10,
      width: 8,
      x: 0,
      z: 0,
    },
    corridor: {
      id: "corridor",
      name: "走廊",
      length: 10,
      width: 2,
      x: 0,
      z: 8,
    },
    tile: {
      width: 0.6,
      depth: 0.6,
      originX: 0,
      originZ: 0,
      rotationDeg: 0,
      visible: true,
    },
    calibration: { referenceLength: null, note: "" },
    zones: [],
    objects: [],
    routes: [],
    view: "iso",
    layers: { areas: true, zones: true, objects: true, tiles: true, routes: true },
  };
}
