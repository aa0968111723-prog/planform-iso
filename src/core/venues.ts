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
import { BOOTH_ZONE_ROLES, boothCatalogEntry, boothCatalogExtras } from "./boothCatalog";
import { createBoothStations, defaultBoothParams } from "./boothCatalog";
import { interactionPreset } from "./interactionPresets";
import {
  createDefaultProject,
  uid,
  type BoothScenarioId,
  type BoothZoneRole,
  type Project,
  type RoutePoint,
  type RouteType,
  type SceneObject,
  type TileConfig,
  type ViewName,
  type WallEdge,
  type Zone,
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
  /** Override the catalog default size (meters) — booth estimates differ per pitch. */
  width?: number;
  depth?: number;
  height?: number;
  /** Sit this on top of the (single) object placed from that assetId. */
  parentAssetId?: string;
}

/** A semantic booth area seeded by a template (工作人員區, 排隊區, 入口 …). */
export interface VenueZoneSpec {
  role: BoothZoneRole;
  x: number;
  z: number;
  width: number;
  depth: number;
  capacity?: number;
}

/** A pre-drawn flow line seeded by a template. */
export interface VenueRouteSpec {
  name: string;
  type: RouteType;
  color: string;
  boothRole?: "visitor" | "staff";
  points: RoutePoint[];
}

/**
 * Booth payload of a venue template. Present only on outdoor booth presets;
 * everything it seeds lives in optional project fields, so a project built
 * from it still opens in a build that knows nothing about booths.
 */
export interface VenueBoothSpec {
  zones: VenueZoneSpec[];
  routes: VenueRouteSpec[];
  scenarioId: BoothScenarioId;
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
  /** Outdoor booth template payload (zones / routes / simulation stations). */
  booth?: VenueBoothSpec;
  /** Validation overrides this venue needs (e.g. no projector outdoors). */
  validationOverrides?: Partial<Project["validationSettings"]>;
  /** Calibration note shown until the plan is measured on site. */
  calibrationNote?: string;
  /** Camera a fresh project from this venue opens in. */
  defaultView?: ViewName;
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
    note: "空的矩形教室，先放好一扇後門，再自行補上其他設施。",
    classroom: { name: "教室", length: 12, width: 9, x: 0, z: 0 },
    corridor: { name: "走廊", length: 12, width: 2, x: 0, z: 9 },
    tile: { width: 0.6, depth: 0.6, originX: 0, originZ: 0, rotationDeg: 0, visible: true },
    fixtures: [
      { kind: "door", areaId: "classroom", edge: "s", offset: 10.6 },
    ],
  },
  {
    id: "venue:blank",
    name: "空白自訂場地",
    builtin: true,
    note: "從頭自訂尺寸、地磚與設施；先附一扇後門方便看出入口。",
    classroom: { name: "場地", length: 10, width: 8, x: 0, z: 0 },
    corridor: { name: "走廊", length: 10, width: 2, x: 0, z: 8 },
    tile: { width: 0.6, depth: 0.6, originX: 0, originZ: 0, rotationDeg: 0, visible: true },
    fixtures: [
      { kind: "door", areaId: "classroom", edge: "s", offset: 8.6 },
    ],
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
  {
    id: "venue:tku-booth",
    name: "戶外攤位（3×3 帳篷）",
    builtin: true,
    // Every number below is read off the reference photos by counting things
    // whose size is standard (a folding tent, a paving tile) — none of it is a
    // site survey. The 攤位範圍 in particular is an assumption: tent + 2 m of
    // working space on each side.
    note: "戶外擺攤起點模板：3×3 帳篷、攤位桌、展示板與互動區。尺寸為可修改的估計值，到現場請用「現場校正」對一次。",
    classroom: { name: "攤位範圍", length: 7, width: 7, x: 0, z: 0 },
    corridor: { name: "石磚走道", length: 9, width: 2.4, x: -1, z: 7 },
    tile: { width: 0.6, depth: 0.6, originX: 0, originZ: 0, rotationDeg: 0, visible: true },
    // Outdoors: no doors, no projector screen.
    fixtures: [],
    validationOverrides: { checkScreenView: false },
    calibrationNote: "尺寸為照片推估的起點，待現場校正",
    // A tent is the thing you are checking; a top view of one is a white
    // rectangle. Open the booth in 立體 and let the user switch to 俯視.
    defaultView: "iso",
    extraObjects: [
      // +Z faces the visitors and the paved path; the tent's back (small Z) is grass.
      { assetId: "custom:booth-tent", x: 3.5, z: 3.0, note: "估計 3×3m，高 2.5m，待現場校正" },
      { assetId: "custom:tent-leg", x: 2.05, z: 1.55 },
      { assetId: "custom:tent-leg", x: 4.95, z: 1.55 },
      { assetId: "custom:tent-leg", x: 2.05, z: 4.45 },
      { assetId: "custom:tent-leg", x: 4.95, z: 4.45 },
      { assetId: "custom:banner", x: 3.5, z: 1.75, elevation: 1.85, note: "空白表面，文字之後再放" },
      { assetId: "custom:booth-table", x: 3.5, z: 4.2 },
      // Staff sit behind the table (small Z), visitors stand in front of it.
      { assetId: "custom:red-stool", x: 2.75, z: 3.55 },
      { assetId: "custom:red-stool", x: 3.35, z: 3.55 },
      { assetId: "custom:red-stool", x: 3.95, z: 3.55 },
      { assetId: "custom:red-stool", x: 4.55, z: 3.55 },
      { assetId: "custom:red-chair", x: 2.15, z: 3.2, rotationDeg: 25 },
      { assetId: "custom:red-stool", x: 2.9, z: 5.25 },
      { assetId: "custom:red-stool", x: 3.9, z: 5.25 },
      { assetId: "custom:display-board", x: 5.85, z: 4.5, rotationDeg: -22, note: "空白表面，可替換貼圖" },
      { assetId: "custom:blank-standee", x: 0.15, z: 6.15, note: "入口指示，空白表面" },
      { assetId: "builtin:signage-stand", x: 7.3, z: 6.15, note: "出口指示" },
      { assetId: "custom:flyer-tray", x: 3.05, z: 4.2, surface: "tabletop", elevation: 0.74, parentAssetId: "custom:booth-table" },
      { assetId: "custom:table-prop", x: 4.15, z: 4.15, surface: "tabletop", elevation: 0.74, parentAssetId: "custom:booth-table" },
      { assetId: "custom:token-disc", x: 3.75, z: 4.05, surface: "tabletop", elevation: 0.74, parentAssetId: "custom:booth-table" },
      // 巧拼 for the 靜心 corner — the builtin mat defaults to 60 × 180, so the
      // 60 × 60 square is set explicitly here.
      { assetId: "builtin:mat", x: 2.3, z: 2.15, width: 0.6, depth: 0.6, height: 0.04 },
      { assetId: "builtin:mat", x: 2.95, z: 2.15, width: 0.6, depth: 0.6, height: 0.04 },
      { assetId: "builtin:mat", x: 2.3, z: 2.8, width: 0.6, depth: 0.6, height: 0.04 },
      { assetId: "builtin:mat", x: 2.95, z: 2.8, width: 0.6, depth: 0.6, height: 0.04 },
      // Not ours — locked, and only here so the plan shows what the crowd walks around.
      { assetId: "custom:neighbor-booth", x: 8.7, z: 3.0, locked: true, note: "假設位置，僅作阻擋物" },
    ],
    booth: {
      scenarioId: "normal",
      zones: [
        { role: "staff", x: 3.5, z: 3.5, width: 3.0, depth: 1.5, capacity: 6 },
        { role: "visitor", x: 3.5, z: 5.0, width: 3.6, depth: 1.1, capacity: 8 },
        { role: "queue", x: 3.5, z: 6.15, width: 3.2, depth: 1.0, capacity: 8 },
        { role: "interact", x: 5.9, z: 5.8, width: 1.9, depth: 1.6, capacity: 5 },
        { role: "calm", x: 2.62, z: 2.5, width: 1.7, depth: 1.5, capacity: 4 },
        { role: "entry", x: 1.0, z: 6.6, width: 1.2, depth: 0.9 },
        { role: "exit", x: 6.4, z: 6.6, width: 1.2, depth: 0.9 },
      ],
      routes: [
        {
          name: "訪客進入", type: "entry", color: "#f97316", boothRole: "visitor",
          points: [{ x: 0.9, z: 7.9 }, { x: 1.1, z: 6.6 }, { x: 3.4, z: 6.1 }],
        },
        {
          name: "看展示板 → 排隊", type: "custom", color: "#22d3ee", boothRole: "visitor",
          points: [{ x: 5.5, z: 5.5 }, { x: 5.4, z: 5.0 }, { x: 4.2, z: 6.0 }, { x: 3.5, z: 6.1 }],
        },
        {
          name: "互動 → 離開", type: "custom", color: "#a78bfa", boothRole: "visitor",
          points: [{ x: 3.5, z: 4.85 }, { x: 5.9, z: 5.85 }, { x: 6.4, z: 6.6 }, { x: 7.4, z: 7.9 }],
        },
        {
          name: "工作人員動線", type: "staff", color: "#f43f5e", boothRole: "staff",
          points: [{ x: 1.6, z: 3.0 }, { x: 2.6, z: 3.5 }, { x: 4.6, z: 3.5 }],
        },
      ],
    },
  },
];

export function boothVenuePreset(): VenuePreset {
  return BUILTIN_VENUE_PRESETS.find((p) => p.id === "venue:tku-booth")!;
}

/** Resolve a preset asset id against the builtin catalog, then the booth one. */
function presetEntry(id: string) {
  return BUILTIN_CATALOG.find((e) => e.id === id) ?? boothCatalogEntry(id);
}

function catalogDims(id: string): { width: number; depth: number; height: number; elevation: number; assetId: string } {
  const entry = presetEntry(id);
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
  const entry = presetEntry(extra.assetId);
  if (!entry) return null;
  return {
    id: uid("obj"),
    kind: entry.kind,
    x: extra.x,
    z: extra.z,
    rotationDeg: extra.rotationDeg ?? entry.defaultFacingDeg,
    width: extra.width ?? dims.width,
    depth: extra.depth ?? dims.depth,
    height: extra.height ?? dims.height,
    locked: extra.locked ?? false,
    hidden: false,
    surface: extra.surface ?? "floor",
    elevation: extra.elevation ?? (extra.surface && extra.surface !== "floor" ? dims.elevation : 0),
    note: extra.note,
    assetId: entry.id,
    serviceRole: entry.serviceRole,
  };
}

function zoneFromSpec(spec: VenueZoneSpec): Zone {
  const role = BOOTH_ZONE_ROLES[spec.role];
  return {
    id: uid("zone"),
    // The booth roles have no ZoneType of their own on purpose: "custom" is
    // what an older build understands, and `boothRole` carries the meaning.
    type: "custom",
    boothRole: spec.role,
    name: role.label,
    x: spec.x,
    z: spec.z,
    width: spec.width,
    depth: spec.depth,
    color: role.color,
    locked: false,
    hidden: false,
    icon: role.icon,
    capacity: spec.capacity ?? null,
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
    // Skip-if-present is decided against what the project had BEFORE this
    // pass: a template that places four tent legs must place all four or
    // none, and testing the growing list would stop after the first.
    const alreadyPresent = new Set(
      project.objects.filter((o) => !o.hidden && o.assetId).map((o) => o.assetId!),
    );
    for (const extra of preset.extraObjects ?? []) {
      if (alreadyPresent.has(extra.assetId)) continue;
      const obj = extraObjectToObject(extra);
      if (!obj) continue;
      project.objects.push(obj);
      if (extra.parentAssetId) {
        const host = project.objects.find((o) => o.assetId === extra.parentAssetId && !o.hidden);
        if (host) obj.parentId = host.id;
      }
    }
    const stage = project.objects.find((o) => o.assetId === "builtin:stage-platform" && !o.hidden);
    const lectern = project.objects.find((o) => o.assetId === "builtin:lectern" && !o.hidden);
    if (stage && lectern) lectern.parentId = stage.id;
    if (preset.booth) applyBoothTemplate(project, preset.booth);
  }
  if (preset.validationOverrides) {
    project.validationSettings = { ...project.validationSettings, ...preset.validationOverrides };
  }
  if (preset.calibrationNote) project.calibration.note = preset.calibrationNote;
  project.venuePresetId = preset.id;
}

/**
 * Seed the booth-only parts of a template: the custom asset entries, the
 * semantic zones, the pre-drawn flows and the simulation stations. Each part
 * is only added when the project does not already have its own — re-applying
 * the template must never wipe zones or routes the user has edited.
 */
function applyBoothTemplate(project: Project, spec: VenueBoothSpec): void {
  const extras = [...(project.catalogExtras ?? [])];
  for (const entry of boothCatalogExtras()) {
    if (!extras.some((e) => e.id === entry.id)) extras.push(entry);
  }
  project.catalogExtras = extras;

  for (const zoneSpec of spec.zones) {
    if (project.zones.some((z) => z.boothRole === zoneSpec.role && !z.hidden)) continue;
    project.zones.push(zoneFromSpec(zoneSpec));
  }
  for (const routeSpec of spec.routes) {
    if (project.routes.some((r) => r.name === routeSpec.name)) continue;
    project.routes.push({
      id: uid("route"),
      name: routeSpec.name,
      color: routeSpec.color,
      points: routeSpec.points.map((p) => ({ ...p })),
      visible: true,
      type: routeSpec.type,
      boothRole: routeSpec.boothRole,
    });
  }
  if (!project.booth || project.booth.stations.length === 0) {
    project.booth = {
      stations: createBoothStations(),
      scenarioId: spec.scenarioId,
      params: defaultBoothParams(spec.scenarioId),
    };
  }
  // Two blocks on purpose. `booth` keeps a build that predates the step list
  // able to open this plan and run the flow it knows; `interaction` is the
  // club's actual activity, and it wins wherever both exist.
  if (!project.interaction) {
    project.interaction = interactionPreset("preset:ok-bandage") ?? undefined;
  }
}

/** Fresh project from a preset (Quick Start path). */
export function createProjectFromVenuePreset(preset: VenuePreset, name?: string): Project {
  const project = createDefaultProject();
  if (name) project.name = name;
  applyVenuePreset(project, preset, { withFixtures: true });
  // Only on a NEW project: applying a template to an existing plan must not
  // yank the camera out from under whoever is working in it.
  if (preset.defaultView) project.view = preset.defaultView;
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
  // Venue-defining props travel with the venue: the raised platform and
  // lectern in a classroom, the tent and its furniture on a booth pitch.
  const extraObjects: VenueExtraObject[] = project.objects
    .filter((o) => !o.hidden && !!o.assetId)
    .filter((o) =>
      o.assetId === "builtin:stage-platform"
      || o.assetId === "builtin:lectern"
      || !!boothCatalogEntry(o.assetId!))
    .map((o) => ({
      assetId: o.assetId!, x: o.x, z: o.z, rotationDeg: o.rotationDeg,
      locked: o.locked, surface: o.surface, elevation: o.elevation, note: o.note,
      width: o.width, depth: o.depth, height: o.height,
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
    // Carry the booth marker (not the zones or flows — those are 場佈, not 場地)
    // so re-applying this venue re-registers the booth asset entries.
    booth: project.booth
      ? { zones: [], routes: [], scenarioId: project.booth.scenarioId }
      : undefined,
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
