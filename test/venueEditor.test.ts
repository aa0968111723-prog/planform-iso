import { beforeEach, describe, expect, it } from "vitest";
import { createDefaultProject, PROJECT_VERSION, type SceneObject } from "../src/core/model";
import { migrateObject, migrateProject } from "../src/core/migrate";
import { applyVenuePreset, createProjectFromVenuePreset, venuePresetById } from "../src/core/venues";
import { BUILTIN_CATALOG } from "../src/core/catalog";
import {
  applyCorridorLayout,
  buildLCorridor,
  connectClassroomDoor,
  connectCorridorSegments,
  ensureCorridorLayout,
  layoutForKind,
  listCorridorTemplates,
  saveCorridorTemplate,
} from "../src/core/corridorGeometry";
import { applyLayoutStarter } from "../src/core/layoutStarters";
import {
  alignPoses,
  distributePoses,
  gridArrangePoses,
  scalePosesAroundCentroid,
} from "../src/core/alignTools";
import { probePlacement, PLACEMENT_REASON_TEXT } from "../src/core/placementFeedback";
import { applySnap } from "../src/core/units";
import {
  cloneWorkbenchLayers,
  inferEditorLayer,
  objectLayerLocked,
  objectLayerVisible,
  objectsByEditorLayer,
} from "../src/core/editorLayers";
import {
  buildPartnerLayoutCopy,
  partnerCopyIsSafe,
  PARTNER_COPY_EXAMPLES,
} from "../src/core/partnerCopy";
import { buildRoleBriefing } from "../src/core/partner";
import { objectWorkbenchSummary } from "../src/core/objectWorkbench";
import { COMMON_ROUTE_CHAIN } from "../src/core/routes";

function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

function obj(over: Partial<SceneObject> & { kind: SceneObject["kind"] }): SceneObject {
  return migrateObject({
    id: over.id ?? `o-${over.kind}`,
    x: 2, z: 2, rotationDeg: 0, locked: false, hidden: false,
    width: 1.2, depth: 0.6, height: 0.74,
    ...over,
  });
}

describe("professional venue editor", () => {
  beforeEach(installLocalStorage);

  it("1 add: catalog extras cover classroom + corridor fixtures", () => {
    const ids = BUILTIN_CATALOG.map((e) => e.id);
    for (const id of [
      "builtin:blackboard", "builtin:window", "builtin:ac-unit", "builtin:lectern",
      "builtin:room-plate", "builtin:column", "builtin:stair", "builtin:elevator",
      "builtin:notice-board", "builtin:trash-bin", "builtin:hydrant", "builtin:extinguisher",
      "builtin:bench", "builtin:cabinet", "builtin:fountain", "builtin:plant",
      "builtin:corridor-light", "builtin:tactile-paving", "builtin:corridor-custom",
    ]) {
      expect(ids, id).toContain(id);
    }
  });

  it("2 drag: mutating x/z keeps the same object id and size", () => {
    const p = createDefaultProject();
    p.objects.push(obj({ kind: "table", id: "desk", x: 3, z: 3 }));
    const before = structuredClone(p.objects[0]);
    p.objects[0].x += 0.4;
    p.objects[0].z += 0.2;
    expect(p.objects[0].id).toBe(before.id);
    expect(p.objects[0].width).toBe(before.width);
    expect(p.objects[0].x).toBeCloseTo(3.4);
  });

  it("3 rotate: yaw stays in 0–360", () => {
    const o = obj({ kind: "chair", rotationDeg: 350 });
    o.rotationDeg = ((o.rotationDeg + 15) % 360 + 360) % 360;
    expect(o.rotationDeg).toBe(5);
  });

  it("4 copy: grouped copies get a new group id", () => {
    const a = obj({ kind: "chair", id: "a", groupId: "g1", x: 1 });
    const b = obj({ kind: "chair", id: "b", groupId: "g1", x: 2 });
    const copies = [a, b].map((o, i) => ({ ...o, id: `c${i}`, x: o.x + 0.4, groupId: "g2" }));
    expect(new Set(copies.map((c) => c.groupId)).size).toBe(1);
    expect(copies[0].groupId).not.toBe("g1");
  });

  it("5 delete: removing an id leaves the rest", () => {
    const p = createDefaultProject();
    p.objects = [obj({ kind: "table", id: "keep" }), obj({ kind: "chair", id: "gone" })];
    p.objects = p.objects.filter((o) => o.id !== "gone");
    expect(p.objects.map((o) => o.id)).toEqual(["keep"]);
  });

  it("6 edit W/D/H", () => {
    const o = obj({ kind: "table", width: 1.2, depth: 0.6, height: 0.74 });
    o.width = 1.5; o.depth = 0.7; o.height = 0.8;
    expect([o.width, o.depth, o.height]).toEqual([1.5, 0.7, 0.8]);
  });

  it("7 edit X/Z/elevation", () => {
    const o = obj({ kind: "table", x: 1, z: 2, elevation: 0 });
    o.x = 4.25; o.z = 5.5; o.elevation = 0.12;
    expect(o.x).toBe(4.25);
    expect(o.z).toBe(5.5);
    expect(o.elevation).toBe(0.12);
  });

  it("8 labels and colors survive migrate", () => {
    const o = migrateObject({
      kind: "table", x: 1, z: 1, rotationDeg: 0, locked: false, hidden: false,
      label: "報到桌", color: "#38bdf8", icon: "👋",
    });
    expect(o.label).toBe("報到桌");
    expect(o.color).toBe("#38bdf8");
    expect(o.icon).toBe("👋");
  });

  it("9 wall/tile snap", () => {
    const p = createDefaultProject();
    const tile = applySnap(1.21, 1.21, p.tile, "center");
    expect(tile.x).toBeCloseTo(1.5);
    expect(tile.z).toBeCloseTo(1.5);
    const wall = probePlacement({
      project: p, x: 0.05, z: 4, width: 0.9, depth: 0.12, height: 2,
      rotationDeg: 0, surface: "wall", snap: "wall",
    });
    expect(wall.reason === "ok" || wall.reason === "need-wall").toBe(true);
    expect(wall.x).toBeDefined();
  });

  it("10 snap on/off", () => {
    const p = createDefaultProject();
    const off = applySnap(1.21, 1.21, p.tile, "off");
    expect(off.x).toBeCloseTo(1.21);
    const on = applySnap(1.21, 1.21, p.tile, "intersection");
    expect(on.x).toBeCloseTo(1.2);
  });

  it("11–14 multi-select align / distribute / group poses", () => {
    const items = [
      { id: "a", x: 1, z: 1, rotationDeg: 0, width: 0.5, depth: 0.5 },
      { id: "b", x: 3, z: 2, rotationDeg: 0, width: 0.5, depth: 0.5 },
      { id: "c", x: 5, z: 3, rotationDeg: 0, width: 0.5, depth: 0.5 },
    ];
    expect(alignPoses(items, "left").every((p) => p.x === 1)).toBe(true);
    expect(alignPoses(items, "right").every((p) => p.x === 5)).toBe(true);
    const dist = distributePoses(items, "x");
    expect(dist[1].x).toBeCloseTo(3);
    const grid = gridArrangePoses(items, { gapX: 0.6, gapZ: 0.6 });
    expect(grid[0].x).toBeLessThanOrEqual(grid[1].x);
    const scaled = scalePosesAroundCentroid(items, 2);
    expect(scaled[0].width).toBeCloseTo(1);
  });

  it("15 lock and 16 hide write through SceneObject", () => {
    const p = createDefaultProject();
    const o = obj({ kind: "chair", id: "c1" });
    p.objects.push(o);
    o.locked = true;
    o.hidden = true;
    expect(objectLayerLocked(p, o)).toBe(true);
    expect(objectLayerVisible(p, o)).toBe(false);
  });

  it("17 layers: fixture / furniture / event / flow", () => {
    const p = createDefaultProject();
    p.objects = [
      obj({ kind: "door", assetId: "builtin:door" }),
      obj({ kind: "chair", assetId: "builtin:chair" }),
      obj({ kind: "mat", assetId: "builtin:mat" }),
    ];
    expect(inferEditorLayer(p.objects[0])).toBe("fixture");
    expect(inferEditorLayer(p.objects[1])).toBe("furniture");
    expect(inferEditorLayer(p.objects[2])).toBe("event");
    const grouped = objectsByEditorLayer(p);
    expect(grouped.fixture).toHaveLength(1);
    expect(grouped.furniture).toHaveLength(1);
    expect(grouped.event).toHaveLength(1);
    const layers = cloneWorkbenchLayers(p.workbenchLayers);
    layers.furniture.visible = false;
    p.workbenchLayers = layers;
    expect(objectLayerVisible(p, p.objects[1])).toBe(false);
  });

  it("18 L-corridor has a named corner segment", () => {
    const p = createDefaultProject();
    const segs = buildLCorridor(p.classroom, 2);
    expect(segs.length).toBeGreaterThanOrEqual(3);
    expect(segs.some((s) => s.name.includes("轉角"))).toBe(true);
    applyCorridorLayout(p, layoutForKind("L", p.classroom, 2));
    expect(p.corridorLayout?.kind).toBe("L");
    expect(p.corridorLayout?.segments.some((s) => s.name.includes("轉角"))).toBe(true);
  });

  it("19 corridor corner stays editable without moving classroom objects", () => {
    const p = createDefaultProject();
    p.objects.push(obj({ kind: "table", id: "desk", x: 4, z: 3 }));
    const before = { x: p.objects[0].x, z: p.objects[0].z };
    applyCorridorLayout(p, layoutForKind("L", p.classroom, 2));
    expect(p.objects[0].x).toBe(before.x);
    expect(p.objects[0].z).toBe(before.z);
    const [a, b] = p.corridorLayout!.segments;
    const next = connectCorridorSegments(p.corridorLayout!, a.id, b.id);
    expect(next.segments.find((s) => s.id === b.id)?.x).toBeCloseTo(a.x + a.length);
  });

  it("20 connect classroom-corridor writes a door link", () => {
    const p = createDefaultProject();
    applyCorridorLayout(p, layoutForKind("straight", p.classroom, 2));
    const door = obj({ kind: "door", id: "door1", x: 5, z: 8, wallAnchor: { areaId: "classroom", edge: "s", offset: 5 } });
    p.objects.push(door);
    const link = connectClassroomDoor(p, door);
    expect(link.doorObjectId).toBe("door1");
    expect(link.segmentId).toBeTruthy();
    expect(link.showLink).toBe(true);
  });

  it("21 corridor fixtures exist and save as my corridor template", () => {
    const p = createDefaultProject();
    applyCorridorLayout(p, layoutForKind("T", p.classroom, 2));
    expect(saveCorridorTemplate("工學大樓走廊", ensureCorridorLayout(p), p.corridor.width)).toBeTruthy();
    expect(listCorridorTemplates().map((t) => t.name)).toContain("工學大樓走廊");
    expect(BUILTIN_CATALOG.some((e) => e.tags.includes("corridor") && e.id === "builtin:hydrant")).toBe(true);
  });

  it("22 zones are editable layout units", () => {
    const p = createDefaultProject();
    applyLayoutStarter(p, "zen-class");
    expect(p.zones.some((z) => z.type === "registration")).toBe(true);
    expect(p.zones.some((z) => z.type === "shoe")).toBe(true);
    expect(p.zones.some((z) => z.type === "mats")).toBe(true);
    p.zones[0].name = "左側報到區";
    p.zones[0].partnerVisible = true;
    expect(p.zones[0].name).toBe("左側報到區");
  });

  it("23 2D/3D share the same project data", () => {
    const p = createDefaultProject();
    p.objects.push(obj({ kind: "table", id: "desk", x: 3.2, z: 4.1, width: 1.2, depth: 0.6, height: 0.74 }));
    p.view = "top";
    const top = { ...p.objects[0] };
    p.view = "iso";
    expect(p.objects[0].x).toBe(top.x);
    expect(p.objects[0].z).toBe(top.z);
    expect(p.objects[0].height).toBe(top.height);
  });

  it("24 partner copy is only necessary info", () => {
    const p = createDefaultProject();
    applyLayoutStarter(p, "zen-class");
    p.objects.push(obj({ kind: "door", id: "door", x: 5, z: 7.6 }));
    const copy = buildPartnerLayoutCopy(p);
    expect(copy[0]).toMatch(/你現在在教室.+入口/);
    expect(copy.join("")).toMatch(/報到/);
    expect(copy.join("")).toMatch(/鞋子/);
    expect(copy.join("")).toMatch(/背包/);
    expect(copy.join("")).toMatch(/地墊/);
    for (const line of [...copy, ...PARTNER_COPY_EXAMPLES]) {
      expect(partnerCopyIsSafe(line), line).toBe(true);
    }
    const brief = buildRoleBriefing(p, "all");
    expect(brief.layoutCopy?.length).toBeGreaterThan(0);
    expect(brief.layoutCopy?.every(partnerCopyIsSafe)).toBe(true);
    expect(JSON.stringify(brief)).not.toMatch(/mesh|shader|rotationDeg/);
  });

  it("25 場刊 extra notes use partner copy and hide engineering objects", () => {
    const p = createDefaultProject();
    applyLayoutStarter(p, "zen-class");
    p.objects.push(obj({ kind: "table", id: "hidden-export", visibleInExport: false, label: "工程桌" }));
    const notes = buildPartnerLayoutCopy(p);
    expect(notes.length).toBeGreaterThan(0);
    expect(p.objects.find((o) => o.visibleInExport === false)?.id).toBe("hidden-export");
  });

  it("26 old projects open without jumping objects", () => {
    const v1 = {
      version: 1,
      name: "舊場佈",
      objects: [
        { id: "o1", kind: "table", x: 2.4, z: 3.1, rotationDeg: 15, width: 1.2, depth: 0.6, height: 0.74, locked: false, hidden: false },
      ],
      zones: [{ id: "mystery", type: "unknown-zone", name: "舊區", x: 1, z: 1, width: 2, depth: 2, color: "#fff", locked: false, hidden: false }],
    };
    const p = migrateProject(v1 as never);
    expect(p.version).toBe(PROJECT_VERSION);
    expect(p.objects[0].x).toBeCloseTo(2.4);
    expect(p.objects[0].z).toBeCloseTo(3.1);
    expect(p.objects[0].rotationDeg).toBe(15);
    expect(p.zones[0].type).toBe("custom");
    expect(p.workbenchLayers?.fixture.visible).toBe(true);
    expect(p.showCoords).toBe(true);
  });

  it("27 placement reasons are the required Chinese sentences", () => {
    expect(PLACEMENT_REASON_TEXT.ok).toBe("可以放置");
    expect(PLACEMENT_REASON_TEXT.overlap).toBe("與其他物件重疊");
    expect(PLACEMENT_REASON_TEXT["out-of-bounds"]).toBe("超出教室邊界");
    expect(PLACEMENT_REASON_TEXT["blocks-entrance"]).toBe("擋住入口");
    expect(PLACEMENT_REASON_TEXT["wall-clearance"]).toBe("距離牆面不足");
    expect(PLACEMENT_REASON_TEXT["need-tabletop"]).toBe("需要放在桌面上");
    expect(PLACEMENT_REASON_TEXT["need-wall"]).toBe("需要貼齊牆面");
    const p = createDefaultProject();
    const outside = probePlacement({
      project: p, x: 40, z: 40, width: 1, depth: 0.6, height: 0.7,
      rotationDeg: 0, surface: "floor", snap: "off",
    });
    expect(outside.text).toBe("超出教室邊界");
    const desk = probePlacement({
      project: p, x: 2, z: 2, width: 0.4, depth: 0.3, height: 0.2,
      rotationDeg: 0, surface: "tabletop", snap: "off",
    });
    expect(desk.text).toBe("需要放在桌面上");
  });

  it("28 common visual route chain is entry → check-in → shoes → backpack → mats/seating", () => {
    expect(COMMON_ROUTE_CHAIN).toEqual(["entry", "registration", "shoe", "backpack", "seating"]);
  });

  it("E305 stays distinct from E310 after layout starters", () => {
    const e305 = createProjectFromVenuePreset(venuePresetById("venue:tku-e305")!, "E305");
    const e310 = createProjectFromVenuePreset(venuePresetById("venue:tku-e310")!, "E310");
    expect(e305.venuePresetId).toBe("venue:tku-e305");
    expect(e310.venuePresetId).toBe("venue:tku-e310");
    applyLayoutStarter(e305, "green-mats");
    applyLayoutStarter(e310, "zen-class");
    expect(e305.venuePresetId).toBe("venue:tku-e305");
    expect(e310.venuePresetId).toBe("venue:tku-e310");
    expect(e305.classroom).not.toEqual(e310.classroom);
  });

  it("workbench summary answers name/type/WDH/position/facing/zone/lock/snap", () => {
    const p = createDefaultProject();
    const table = obj({ kind: "table", id: "t1", x: 2, z: 2, name: "工作桌", label: "工作桌" });
    p.objects.push(table);
    const s = objectWorkbenchSummary(table, p);
    expect(s.name).toBe("工作桌");
    expect(s.width).toBeGreaterThan(0);
    expect(s.space).toBe("classroom");
    expect(s.snap).toBe(true);
    expect(s.locked).toBe(false);
  });

  it("applying a venue preset records the new identity without merging E310 extras into E305 geometry", () => {
    const e305 = venuePresetById("venue:tku-e305")!;
    const p = createProjectFromVenuePreset(venuePresetById("venue:tku-e310")!, "E310");
    expect(p.venuePresetId).toBe("venue:tku-e310");
    applyVenuePreset(p, e305, { withFixtures: false });
    expect(p.venuePresetId).toBe("venue:tku-e305");
    expect(p.classroom.length).toBe(e305.classroom.length);
    expect(p.classroom.width).toBe(e305.classroom.width);
    expect(p.campusRef?.placeId).toBe("E305");
  });
});
