/**
 * Editable classroom layout starting points. They never lock objects and they
 * never rewrite E305 vs E310 venue identity (`venuePresetId` stays put).
 */

import { uid, ZONE_DEFAULTS, type Project, type SceneObject, type Zone, type ZoneType } from "./model";
import { AssetCatalog } from "./catalog";

export type LayoutStarterId =
  | "empty"
  | "desks"
  | "zen-class"
  | "green-mats"
  | "tea"
  | "lecture"
  | "small-group"
  | "custom";

export const LAYOUT_STARTERS: { id: LayoutStarterId; label: string; hint: string }[] = [
  { id: "empty", label: "空白教室", hint: "只保留門與投影幕等固定設施" },
  { id: "desks", label: "課桌椅", hint: "一般上課排列，可再改" },
  { id: "zen-class", label: "禪學社社課", hint: "報到、鞋子、背包、中央巧拼" },
  { id: "green-mats", label: "青綠色地墊", hint: "教室中段鋪巧拼" },
  { id: "tea", label: "茶會", hint: "前方講師、側邊茶水、中央地墊" },
  { id: "lecture", label: "演講", hint: "講桌面向座位" },
  { id: "small-group", label: "小組活動", hint: "分組區域＋中央走道" },
  { id: "custom", label: "自訂", hint: "從目前場佈繼續改" },
];

function isFixture(o: SceneObject): boolean {
  return o.kind === "door" || o.kind === "switch" || o.kind === "screen"
    || o.assetId === "builtin:blackboard" || o.assetId === "builtin:window"
    || o.assetId === "builtin:ac-unit" || o.assetId === "builtin:lectern"
    || o.assetId === "builtin:stage-platform"
    || (o.wallAnchor?.areaId === "classroom");
}

function isCorridorObject(o: SceneObject): boolean {
  return o.wallAnchor?.areaId === "corridor" || (o.assetId ?? "").includes("corridor");
}

function makeZone(type: ZoneType, x: number, z: number, over: Partial<Zone> = {}): Zone {
  const d = ZONE_DEFAULTS[type];
  return {
    id: uid("zone"), type, name: d.label, x, z, width: d.width, depth: d.depth,
    color: d.color, locked: false, hidden: false, icon: d.icon, capacity: null,
    partnerVisible: true, height: 0.02, rotationDeg: 0, ...over,
  };
}

function catalogObject(assetId: string, x: number, z: number, rotationDeg = 0): SceneObject | null {
  const entry = new AssetCatalog().get(assetId);
  if (!entry) return null;
  return {
    id: uid("obj"),
    kind: entry.kind,
    x, z, rotationDeg,
    width: entry.dimensions.width,
    depth: entry.dimensions.depth,
    height: entry.dimensions.height,
    locked: false, hidden: false,
    surface: entry.placementType,
    elevation: entry.defaultElevation ?? 0,
    assetId,
    serviceRole: entry.serviceRole,
    snapEnabled: true,
    collisionEnabled: entry.blocksFlow,
    blocksCirculation: entry.blocksFlow,
    visibleInEdit: true,
    visibleInPartner: entry.category === "service" || entry.kind === "door" || entry.kind === "screen" || entry.kind === "mat",
    visibleInExport: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    originalSize: { ...entry.dimensions },
  };
}

function clearMovable(project: Project): void {
  project.objects = project.objects.filter((o) => isFixture(o) || isCorridorObject(o));
  project.zones = [];
  project.groups = project.groups.filter(() => false);
}

export function applyLayoutStarter(project: Project, id: LayoutStarterId): void {
  if (id === "custom") return;
  const c = project.classroom;
  const cx = c.x + c.length / 2;
  const cz = c.z + c.width / 2;
  const venueId = project.venuePresetId;

  if (id === "empty") {
    clearMovable(project);
    project.venuePresetId = venueId;
    return;
  }

  if (id === "desks") {
    clearMovable(project);
    const desk = new AssetCatalog().get("builtin:table");
    const chair = new AssetCatalog().get("builtin:chair");
    const cols = Math.max(3, Math.floor((c.length - 1.6) / 1.5));
    const rows = Math.max(2, Math.floor((c.width - 2.4) / 1.4));
    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < cols; col++) {
        const x = c.x + 1.2 + col * 1.5;
        const z = c.z + 2.0 + r * 1.4;
        const t = catalogObject("builtin:table", x, z, 0);
        if (t && desk) project.objects.push(t);
        const ch = catalogObject("builtin:chair", x, z + 0.55, 180);
        if (ch && chair) project.objects.push(ch);
      }
    }
    project.venuePresetId = venueId;
    return;
  }

  if (id === "green-mats") {
    clearMovable(project);
    project.zones.push(makeZone("mats", cx, cz, { width: Math.min(6, c.length - 2), depth: Math.min(4, c.width - 2.5) }));
    project.venuePresetId = venueId;
    return;
  }

  if (id === "zen-class" || id === "tea") {
    clearMovable(project);
    project.zones.push(
      makeZone("registration", c.x + 2.0, c.z + c.width - 1.2),
      makeZone("shoe", c.x + 2.2, cz, { width: 1.2, depth: 3 }),
      makeZone("shoe", c.x + c.length - 2.2, cz, { width: 1.2, depth: 3 }),
      makeZone("backpack", c.x + c.length - 1.4, c.z + 2.2),
      makeZone("mats", cx, cz + 0.4, { width: Math.min(5.5, c.length - 3), depth: Math.min(3.2, c.width - 3) }),
      makeZone("meditation", cx, c.z + 1.3),
    );
    if (id === "tea") project.zones.push(makeZone("life", c.x + 1.6, c.z + 1.8));
    const desk = catalogObject("builtin:regTable", c.x + 2.0, c.z + c.width - 1.2, 0);
    if (desk) { desk.serviceRole = "checkin"; project.objects.push(desk); }
    project.venuePresetId = venueId;
    return;
  }

  if (id === "lecture") {
    clearMovable(project);
    const lectern = catalogObject("builtin:lectern", cx, c.z + 1.1, 0);
    if (lectern) project.objects.push(lectern);
    project.zones.push(makeZone("meditation", cx, c.z + 1.3, { name: "講師區" }));
    const cols = Math.max(3, Math.floor((c.length - 1.6) / 0.7));
    const rows = Math.max(3, Math.floor((c.width - 3) / 0.7));
    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < cols; col++) {
        const ch = catalogObject("builtin:chair", c.x + 1.2 + col * 0.7, c.z + 2.6 + r * 0.7, 180);
        if (ch) project.objects.push(ch);
      }
    }
    project.venuePresetId = venueId;
    return;
  }

  if (id === "small-group") {
    clearMovable(project);
    project.zones.push(
      makeZone("group", c.x + 2.4, c.z + 2.6, { name: "小組 A" }),
      makeZone("group", c.x + c.length - 2.4, c.z + 2.6, { name: "小組 B" }),
      makeZone("group", c.x + 2.4, c.z + c.width - 2.4, { name: "小組 C" }),
      makeZone("group", c.x + c.length - 2.4, c.z + c.width - 2.4, { name: "小組 D" }),
      makeZone("staff", cx, cz, { name: "工作人員" }),
    );
    project.venuePresetId = venueId;
  }
}
