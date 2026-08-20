/**
 * Venue presets — reusable room templates ("淡江教室模板" etc).
 *
 * A preset is data, not code: room rectangles + tile grid + wall fixtures.
 * Built-in presets are honest starting points, not surveyed floor plans —
 * every dimension stays editable and the note tells the user to calibrate
 * on site. User presets ("我的場地") are stored in localStorage, separate
 * from named layouts so deleting a layout never deletes a venue.
 */

import { BUILTIN_CATALOG } from "./catalog";
import {
  createDefaultProject,
  uid,
  type Project,
  type SceneObject,
  type TileConfig,
  type WallEdge,
} from "./model";
import { wallAnchorToPosition } from "./placement";

export interface VenueFixture {
  kind: "door" | "screen";
  areaId: "classroom" | "corridor";
  edge: WallEdge;
  /** Distance (meters) along the wall from its min corner to the fixture center. */
  offset: number;
  /** Override width along the wall (meters). */
  width?: number;
}

export interface VenueExtraObject {
  /** Catalog id; variants keep the legacy ObjectKind bucket (usually table). */
  assetId: string;
  x: number;
  z: number;
  rotationDeg?: number;
  locked?: boolean;
  surface?: "floor" | "wall" | "tabletop";
  elevation?: number;
  note?: string;
}

export interface VenueAreaSpec {
  name: string;
  length: number;
  width: number;
  x: number;
  z: number;
}

export interface VenuePreset {
  id: string;
  name: string;
  builtin: boolean;
  /** One-line plain-language description shown on the preset card. */
  note: string;
  classroom: VenueAreaSpec;
  corridor: VenueAreaSpec;
  tile: TileConfig;
  fixtures: VenueFixture[];
  extraObjects?: VenueExtraObject[];
}

/**
 * Built-in presets. The 淡江 template is a reasonable, editable starting
 * point (no surveyed dimensions exist in this project) — the note says so
 * and points at 現場校正.
 */
export const BUILTIN_VENUE_PRESETS: VenuePreset[] = [
  {
    id: "venue:tku-classroom",
    name: "淡江教室模板",
    builtin: true,
    note: "一般淡江教室的可修改起點：後門進、前方投影幕。到現場請用「現場校正」對一次尺寸。",
    classroom: { name: "教室", length: 10, width: 8, x: 0, z: 0 },
    corridor: { name: "走廊", length: 10, width: 2, x: 0, z: 8 },
    tile: { width: 0.6, depth: 0.6, originX: 0, originZ: 0, rotationDeg: 0, visible: true },
    fixtures: [
      // 後門開向走廊（教室 max-Z 牆），投影幕在前牆（min-Z）。
      { kind: "door", areaId: "classroom", edge: "s", offset: 8.6 },
      { kind: "screen", areaId: "classroom", edge: "n", offset: 5 },
    ],
  },
  {
    id: "venue:rect-classroom",
    name: "一般矩形教室",
    builtin: true,
    note: "空的矩形教室（無固定設施），適合先排場再補門和投影幕。",
    classroom: { name: "教室", length: 12, width: 9, x: 0, z: 0 },
    corridor: { name: "走廊", length: 12, width: 2, x: 0, z: 9 },
    tile: { width: 0.6, depth: 0.6, originX: 0, originZ: 0, rotationDeg: 0, visible: true },
    fixtures: [],
  },
  {
    id: "venue:blank",
    name: "空白自訂場地",
    builtin: true,
    note: "從頭自訂尺寸、地磚與設施。",
    classroom: { name: "場地", length: 10, width: 8, x: 0, z: 0 },
    corridor: { name: "走廊", length: 10, width: 2, x: 0, z: 8 },
    tile: { width: 0.6, depth: 0.6, originX: 0, originZ: 0, rotationDeg: 0, visible: true },
    fixtures: [],
  },
  {
    id: "venue:tku-e310",
    name: "E310＋走廊（待現場校正）",
    builtin: true,
    // 12 × 9 是從現場照片可數物件（桌椅列數、巧拼格數）推的起點，不是實測 —
    // 所有尺寸都掛「待校正」，到現場用地磚／門寬／已知牆距校正。
    note: "工學大樓 3F E310 起點模板；到現場用一塊地磚／門寬／已知牆距 30 秒校正。",
    classroom: { name: "教室", length: 12, width: 9, x: 0, z: 0 },
    corridor: { name: "走廊", length: 12, width: 2.4, x: 0, z: 9 },
    tile: { width: 0.6, depth: 0.6, originX: 0, originZ: 0, rotationDeg: 0, visible: true },
    fixtures: [
      { kind: "door", areaId: "classroom", edge: "s", offset: 8.6 },
      { kind: "screen", areaId: "classroom", edge: "n", offset: 6 },
    ],
    extraObjects: [
      {
        assetId: "builtin:stage-platform",
        x: 6,
        z: 0.6,
        locked: true,
        surface: "floor",
        note: "合理起點尺寸，待現場校正",
      },
      {
        assetId: "builtin:lectern",
        x: 4.6,
        z: 0.6,
        locked: false,
        surface: "floor",
        elevation: 0.18,
        note: "講台上的合理起點位置，待現場校正",
      },
    ],
  },
];

function catalogDims(id: string): { width: number; depth: number; height: number; elevation: number; assetId: string } {
  const entry = BUILTIN_CATALOG.find((e) => e.id === id);
  if (!entry) return { width: 1, depth: 0.1, height: 1, elevation: 0, assetId: id };
  return {
    width: entry.dimensions.width,
    depth: entry.dimensions.depth,
    height: entry.dimensions.height,
    elevation: entry.defaultElevation ?? 0,
    assetId: entry.id,
  };
}

function extraObjectToObject(extra: VenueExtraObject): SceneObject | null {
  const dims = catalogDims(extra.assetId);
  const entry = BUILTIN_CATALOG.find((e) => e.id === extra.assetId);
  if (!entry) return null;
  return {
    id: uid("obj"),
    kind: entry.kind,
    x: extra.x,
    z: extra.z,
    rotationDeg: extra.rotationDeg ?? entry.defaultFacingDeg,
    width: dims.width,
    depth: dims.depth,
    height: dims.height,
    locked: extra.locked ?? false,
    hidden: false,
    surface: extra.surface ?? "floor",
    elevation: extra.elevation ?? dims.elevation,
    note: extra.note,
    assetId: entry.id,
    serviceRole: entry.serviceRole,
  };
}

/** Build the SceneObject for one wall fixture of a preset. */
export function fixtureToObject(fixture: VenueFixture, project: Project): SceneObject | null {
  const areas = [project.classroom, project.corridor];
  const anchor = { areaId: fixture.areaId, edge: fixture.edge, offset: fixture.offset };
  const pos = wallAnchorToPosition(anchor, areas);
  if (!pos) return null;
  const dims = catalogDims(fixture.kind === "door" ? "builtin:door" : "builtin:screen");
  const obj: SceneObject = {
    id: uid(fixture.kind),
    kind: fixture.kind,
    x: pos.x,
    z: pos.z,
    rotationDeg: pos.rotationDeg,
    width: fixture.width ?? dims.width,
    depth: dims.depth,
    height: dims.height,
    locked: false,
    hidden: false,
    surface: "wall",
    elevation: dims.elevation,
    wallAnchor: anchor,
    assetId: dims.assetId,
  };
  if (fixture.kind === "door") {
    obj.hinge = "left";
    obj.openInward = true;
    obj.openDeg = 90;
  }
  return obj;
}

export interface ApplyVenueOptions {
  /** Add the preset's doors/screens (skipping kinds the project already has). */
  withFixtures?: boolean;
}

/** Apply a venue preset onto a project in place (room dims, tile, fixtures). */
export function applyVenuePreset(
  project: Project,
  preset: VenuePreset,
  options: ApplyVenueOptions = {},
): void {
  project.classroom = { id: "classroom", ...preset.classroom };
  project.corridor = { id: "corridor", ...preset.corridor };
  project.tile = { ...preset.tile };
  // Keep existing wall-anchored assets glued to the (resized/moved) walls,
  // clamping the along-wall offset so nothing falls off a shorter wall.
  const areas = [project.classroom, project.corridor];
  for (const o of project.objects) {
    if (!o.wallAnchor) continue;
    const area = areas.find((a) => a.id === o.wallAnchor!.areaId);
    if (area) {
      const wallLen = o.wallAnchor.edge === "n" || o.wallAnchor.edge === "s" ? area.length : area.width;
      const half = Math.min(o.width / 2, wallLen / 2);
      o.wallAnchor.offset = Math.min(Math.max(o.wallAnchor.offset, half), wallLen - half);
    }
    const pos = wallAnchorToPosition(o.wallAnchor, areas);
    if (pos) {
      o.x = pos.x;
      o.z = pos.z;
      o.rotationDeg = pos.rotationDeg;
    }
  }
  if (options.withFixtures !== false) {
    for (const fixture of preset.fixtures) {
      const already = project.objects.some((o) => o.kind === fixture.kind && !o.hidden);
      if (already) continue;
      const obj = fixtureToObject(fixture, project);
      if (obj) project.objects.push(obj);
    }
    for (const extra of preset.extraObjects ?? []) {
      const already = project.objects.some((o) => o.assetId === extra.assetId && !o.hidden);
      if (!already) {
        const obj = extraObjectToObject(extra);
        if (obj) project.objects.push(obj);
      }
    }
    const stage = project.objects.find((o) => o.assetId === "builtin:stage-platform" && !o.hidden);
    const lectern = project.objects.find((o) => o.assetId === "builtin:lectern" && !o.hidden);
    if (stage && lectern) lectern.parentId = stage.id;
  }
  project.venuePresetId = preset.id;
}

/** Fresh project from a preset (Quick Start path). */
export function createProjectFromVenuePreset(preset: VenuePreset, name?: string): Project {
  const project = createDefaultProject();
  if (name) project.name = name;
  applyVenuePreset(project, preset, { withFixtures: true });
  return project;
}

/** Extract the current room/tile/fixtures as a savable preset (儲存為我的場地). */
export function venuePresetFromProject(project: Project, name: string): VenuePreset {
  const fixtures: VenueFixture[] = [];
  for (const o of project.objects) {
    if ((o.kind === "door" || o.kind === "screen") && o.wallAnchor && !o.hidden) {
      fixtures.push({
        kind: o.kind,
        areaId: o.wallAnchor.areaId,
        edge: o.wallAnchor.edge,
        offset: o.wallAnchor.offset,
        width: o.width,
      });
    }
  }
  const classroom: VenueAreaSpec = {
    name: project.classroom.name,
    length: project.classroom.length,
    width: project.classroom.width,
    x: project.classroom.x,
    z: project.classroom.z,
  };
  const corridor: VenueAreaSpec = {
    name: project.corridor.name,
    length: project.corridor.length,
    width: project.corridor.width,
    x: project.corridor.x,
    z: project.corridor.z,
  };
  const extraObjects: VenueExtraObject[] = project.objects
    .filter((o) => (o.assetId === "builtin:stage-platform" || o.assetId === "builtin:lectern") && !o.hidden)
    .map((o) => ({
      assetId: o.assetId!, x: o.x, z: o.z, rotationDeg: o.rotationDeg,
      locked: o.locked, surface: o.surface, elevation: o.elevation, note: o.note,
    }));
  return {
    id: uid("venue"),
    name,
    builtin: false,
    note: "我的場地",
    classroom,
    corridor,
    tile: { ...project.tile },
    fixtures,
    extraObjects: extraObjects.length ? extraObjects : undefined,
  };
}

// --- user venue store (localStorage) --------------------------------------

const VENUES_KEY = "planform-iso:venues";

function safeStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function listUserVenuePresets(): VenuePreset[] {
  const ls = safeStorage();
  if (!ls) return [];
  try {
    const raw = ls.getItem(VENUES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is VenuePreset =>
        !!p && typeof p === "object" && typeof (p as VenuePreset).name === "string" &&
        !!(p as VenuePreset).classroom && !!(p as VenuePreset).tile,
    ).map((p) => ({ ...p, builtin: false, fixtures: Array.isArray(p.fixtures) ? p.fixtures : [], extraObjects: Array.isArray(p.extraObjects) ? p.extraObjects : [] }));
  } catch {
    return [];
  }
}

export function saveUserVenuePreset(preset: VenuePreset): boolean {
  const ls = safeStorage();
  if (!ls) return false;
  try {
    const all = listUserVenuePresets().filter((p) => p.id !== preset.id && p.name !== preset.name);
    all.push({ ...preset, builtin: false });
    ls.setItem(VENUES_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

export function deleteUserVenuePreset(id: string): void {
  const ls = safeStorage();
  if (!ls) return;
  try {
    const all = listUserVenuePresets().filter((p) => p.id !== id);
    ls.setItem(VENUES_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

export function allVenuePresets(): VenuePreset[] {
  return [...BUILTIN_VENUE_PRESETS, ...listUserVenuePresets()];
}

export function venuePresetById(id: string): VenuePreset | null {
  return allVenuePresets().find((p) => p.id === id) ?? null;
}
