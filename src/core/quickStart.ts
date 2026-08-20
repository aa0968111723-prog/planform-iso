/**
 * Quick Start — turn "今天要排什麼？" answers into a ready-to-edit project.
 *
 * Pure functions only: pick a venue preset, tick what the event needs, give a
 * head count, and get back a Project with zones, desks, mats and a starter
 * route already placed. Everything it creates is a normal editable entity —
 * this is a starting point, never a locked template.
 */

import { areaBounds } from "./placement";
import { BUILTIN_CATALOG } from "./catalog";
import { generateLayouts } from "./smartLayout";
import {
  uid,
  ZONE_DEFAULTS,
  type Project,
  type EventScenario,
  type ServiceStation,
  type SceneObject,
  type Zone,
  type ZoneType,
} from "./model";
import { routePreset } from "./routes";
import { createProjectFromVenuePreset, type VenuePreset } from "./venues";

export interface QuickStartNeeds {
  mats: boolean;
  checkin: boolean;
  payment: boolean;
  life?: boolean;
  shoe: boolean;
  backpack: boolean;
  teacher: boolean;
  groups: boolean;
  staffRoute: boolean;
}

export interface QuickStartConfig {
  venue: VenuePreset;
  eventName: string;
  participants: number;
  needs: QuickStartNeeds;
  /** Keep a central aisle when laying mats (default true). */
  centralAisle: boolean;
}

export const DEFAULT_NEEDS: QuickStartNeeds = {
  mats: true,
  checkin: true,
  payment: false,
  life: false,
  shoe: true,
  backpack: true,
  teacher: false,
  groups: false,
  staffRoute: false,
};

function makeZone(type: ZoneType, x: number, z: number): Zone {
  const d = ZONE_DEFAULTS[type];
  return {
    id: uid("zone"),
    type,
    name: d.label,
    x,
    z,
    width: d.width,
    depth: d.depth,
    color: d.color,
    locked: false,
    hidden: false,
    icon: d.icon,
    capacity: null,
  };
}

function deskObject(assetId: "builtin:regTable" | "builtin:payment-desk", x: number, z: number, rotationDeg: number): SceneObject {
  const entry = BUILTIN_CATALOG.find((e) => e.id === assetId)!;
  return {
    id: uid("obj"),
    kind: entry.kind,
    x,
    z,
    rotationDeg,
    width: entry.dimensions.width,
    depth: entry.dimensions.depth,
    height: entry.dimensions.height,
    locked: false,
    hidden: false,
    surface: "floor",
    elevation: 0,
    assetId,
    serviceRole: entry.serviceRole,
  };
}

function tableObject(x: number, z: number): SceneObject {
  const entry = BUILTIN_CATALOG.find((e) => e.id === "builtin:table")!;
  return {
    id: uid("obj"), kind: entry.kind, x, z, rotationDeg: 0,
    width: 1.8, depth: 0.6, height: entry.dimensions.height,
    locked: false, hidden: false, surface: "floor", elevation: 0,
    assetId: entry.id, note: "桌上放背包／水壺",
  };
}

function tabletopObject(assetId: "builtin:computer" | "builtin:payment-box", parent: SceneObject): SceneObject {
  const entry = BUILTIN_CATALOG.find((e) => e.id === assetId)!;
  return {
    id: uid("obj"), kind: entry.kind, x: parent.x, z: parent.z, rotationDeg: 0,
    width: entry.dimensions.width, depth: entry.dimensions.depth, height: entry.dimensions.height,
    locked: false, hidden: false, surface: "tabletop", elevation: entry.defaultElevation ?? parent.height,
    parentId: parent.id, assetId: entry.id, serviceRole: entry.serviceRole,
  };
}

/**
 * Where the people come in: the door's position, or the corridor-side wall
 * center when no door exists yet.
 */
function entranceOf(project: Project): { x: number; z: number } {
  const door = project.objects.find((o) => o.kind === "door" && !o.hidden);
  if (door) return { x: door.x, z: door.z };
  const c = project.classroom;
  return { x: c.x + c.length / 2, z: c.z + c.width };
}

export function buildQuickStartProject(config: QuickStartConfig): Project {
  const project = createProjectFromVenuePreset(config.venue, config.eventName || "未命名活動");
  const c = project.classroom;
  const entry = entranceOf(project);
  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
  const inX = (x: number, halfW: number) => clamp(x, c.x + halfW + 0.2, c.x + c.length - halfW - 0.2);
  const inZ = (z: number, halfD: number) => clamp(z, c.z + halfD + 0.2, c.z + c.width - halfD - 0.2);
  const needs = config.needs;
  const backWallZ = c.z + c.width; // entrance side (door faces the corridor)

  // Entrance-side zones form one non-overlapping chain along the back wall,
  // starting at the door and walking toward the room interior (−X):
  // 報到 → 收費 → 鞋子 → 背包, rear edges aligned 0.35 m off the wall.
  const chain: ZoneType[] = [];
  if (needs.checkin) chain.push("registration");
  if (needs.payment) chain.push("payment");
  if (needs.shoe) chain.push("shoe");
  if (needs.backpack) chain.push("backpack");
  let cursor = Math.min(entry.x + 1.2, c.x + c.length - 0.2);
  for (const type of chain) {
    const d = ZONE_DEFAULTS[type];
    const centerX = inX(cursor - d.width / 2, d.width / 2);
    const centerZ = inZ(backWallZ - 0.35 - d.depth / 2, d.depth / 2);
    const zone = makeZone(type, centerX, centerZ);
    project.zones.push(zone);
    if (type === "registration") project.objects.push(deskObject("builtin:regTable", zone.x, zone.z, 0));
    if (type === "payment") project.objects.push(deskObject("builtin:payment-desk", zone.x, zone.z, 0));
    cursor = centerX - d.width / 2 - 0.3;
  }
  if (needs.teacher) {
    const d = ZONE_DEFAULTS.meditation;
    const platform = project.objects.find((o) => o.assetId === "builtin:stage-platform");
    const platformFront = platform ? platform.z + platform.depth / 2 : c.z + 1.2;
    project.zones.push(makeZone("meditation", c.x + c.length / 2, inZ(platformFront + d.depth / 2 + 0.25, d.depth / 2)));
  }
  if (needs.life) {
    const d = ZONE_DEFAULTS.life;
    const lifeZ = project.venuePresetId === "venue:tku-e310"
      ? project.corridor.z + project.corridor.width / 2
      : inZ(backWallZ - d.depth / 2 - 0.35, d.depth / 2);
    project.zones.push(makeZone("life", inX(c.x + c.length - d.width / 2 - 0.5, d.width / 2), lifeZ));
  }
  if (needs.groups) {
    const d = ZONE_DEFAULTS.group;
    project.zones.push(makeZone("group", inX(c.x + c.length - d.width / 2 - 0.5, d.width / 2), c.z + c.width / 2));
  }

  // Mats face the front (screen side, min-Z), leaving room near the entrance.
  if (needs.mats && config.participants > 0) {
    const bounds = areaBounds(c);
    const inset = 0.4;
    // Reserve a strip for the entrance-side zones, and a deeper front strip
    // only when a teacher zone actually needs the stage area.
    const entranceReserve = needs.checkin || needs.payment || needs.shoe || needs.backpack ? 1.9 : 0.6;
    const frontReserve = needs.teacher ? 3.7 : inset;
    // A group-work zone lives along the +X side — keep the mats clear of it.
    const sideReserve = needs.groups ? ZONE_DEFAULTS.group.width + 1.0 : inset;
    const matArea = {
      minX: bounds.minX + inset,
      maxX: bounds.maxX - sideReserve,
      minZ: bounds.minZ + frontReserve,
      maxZ: bounds.maxZ - entranceReserve,
    };
    // 禪學社的地墊習慣直向、一排排相黏（gap 0）；走道另外留。
    const candidates = generateLayouts({
      participants: config.participants,
      matWidth: 0.6,
      matDepth: 1.8,
      gap: 0,
      aisleWidth: 0.9,
      bounds: matArea,
      mode: project.venuePresetId === "venue:tku-classroom" || project.venuePresetId === "venue:tku-e310" ? "field" : "individual",
    });
    const preferred =
      (config.centralAisle ? candidates.find((cand) => cand.id === "aisle" || cand.id === "field-aisle") : null) ??
      candidates.find((cand) => cand.fits) ??
      candidates[0];
    if (preferred) {
      preferred.groups.forEach((g, i) => {
        project.groups.push({
          id: uid("grp"),
          name: `地墊區 ${preferred.groups.length > 1 ? String.fromCharCode(65 + i) : ""}`.trim() || "地墊區",
          sourceKind: "mat",
          rows: g.rows,
          cols: g.cols,
          itemWidth: g.itemWidth,
          itemDepth: g.itemDepth,
          itemHeight: 0.04,
          gapX: g.gapX,
          gapZ: g.gapZ,
          rotationDeg: g.rotationDeg,
          anchorX: g.anchorX,
          anchorZ: g.anchorZ,
          locked: false,
          hidden: false,
          numberPrefix: preferred.groups.length > 1 ? String.fromCharCode(65 + i) : "M",
          numberOrder: "row",
          numberStart: "nw",
        });
      });
    }
  }

  if (project.venuePresetId === "venue:tku-e310" && needs.backpack) {
    const bag = project.zones.find((z) => z.type === "backpack");
    if (bag) {
      const x = clamp(bag.x, c.x + 1.9, c.x + c.length - 1.9);
      project.objects.push(tableObject(x - 1.0, backWallZ - 0.3));
      project.objects.push(tableObject(x + 1.0, backWallZ - 0.3));
    }
  }

  // Starter entry route: door → check-in → shoe → to the front edge of the
  // seating area (never straight across the mats).
  const routeStops: { x: number; z: number }[] = [{ x: entry.x, z: inZ(backWallZ - 0.4, 0) }];
  const checkinZone = project.zones.find((z) => z.type === "registration");
  if (checkinZone) routeStops.push({ x: checkinZone.x, z: checkinZone.z });
  const shoeZone = project.zones.find((z) => z.type === "shoe");
  if (shoeZone) routeStops.push({ x: shoeZone.x, z: shoeZone.z });
  const seatingEdgeZ = needs.mats
    ? c.z + c.width - ((needs.checkin || needs.payment || needs.shoe || needs.backpack ? 1.9 : 0.6) + 0.4)
    : c.z + c.width / 2;
  routeStops.push({ x: c.x + c.length / 2, z: inZ(seatingEdgeZ, 0) });
  if (routeStops.length >= 2) {
    const preset = routePreset("entry");
    project.routes.push({
      id: uid("route"),
      name: preset.label,
      color: preset.color,
      points: routeStops,
      visible: true,
      type: "entry",
    });
  }
  if (needs.staffRoute) {
    const preset = routePreset("staff");
    project.routes.push({
      id: uid("route"),
      name: preset.label,
      color: preset.color,
      points: [
        { x: c.x + 0.8, z: c.z + c.width - 0.8 },
        { x: c.x + 0.8, z: c.z + 0.8 },
        { x: c.x + c.length - 0.8, z: c.z + 0.8 },
      ],
      visible: true,
      type: "staff",
    });
  }

  project.description = `${config.participants} 人`;
  // Open in the 3D isometric view so the result reads as a real room, not a
  // flat diagram; 俯視 stays one tap away in 視角.
  project.view = "iso";
  return project;
}

/** A deterministic, editable E310 release example used by Quick Start and tests. */
export function buildE310GoldenProject(venue: VenuePreset): Project {
  const project = buildQuickStartProject({
    venue,
    eventName: "E310 演講活動（範例）",
    participants: 60,
    needs: {
      mats: true, checkin: true, payment: true, life: true,
      shoe: true, backpack: true, teacher: true, groups: false, staffRoute: false,
    },
    centralAisle: true,
  });
  const corr = project.corridor;
  const door = project.objects.find((o) => o.kind === "door");
  const zone = (type: string) => project.zones.find((z) => z.type === type);
  const station = (type: ServiceStation["type"], name: string, x: number, z: number, extra: Partial<ServiceStation> = {}): ServiceStation => ({
    id: uid("stn"), type, name, x, z, staffCount: 1, parallelServers: 1,
    meanServiceSeconds: type === "payment" ? 60 : type === "checkin" ? 45 : 15,
    queueCapacity: 80, ...extra,
  });
  const entrance = station("entrance", "走廊入口", corr.x + 0.6, corr.z + corr.width / 2);
  const guide = station("guide", "走廊引導", corr.x + 2.3, corr.z + 0.4);
  const queue = station("queue", "走廊排隊", corr.x + 4.5, corr.z + 0.4);
  const checkinZone = zone("registration")!;
  const paymentZone = zone("payment")!;
  const shoeZone = zone("shoe")!;
  const backpackZone = zone("backpack")!;
  const field = project.groups[0];
  const seatingPosition = field
    ? { x: field.anchorX + field.cols * field.itemWidth / 2, z: field.anchorZ + field.rows * field.itemDepth / 2 }
    : { x: project.classroom.x + project.classroom.length / 2, z: project.classroom.z + 4 };
  const checkinObj = project.objects.find((o) => o.serviceRole === "checkin");
  const paymentObj = project.objects.find((o) => o.serviceRole === "payment");
  if (checkinObj) project.objects.push(tabletopObject("builtin:computer", checkinObj));
  if (paymentObj) project.objects.push(tabletopObject("builtin:payment-box", paymentObj));
  const stations: ServiceStation[] = [
    entrance, guide, queue,
    station("checkin", "報到", checkinObj?.x ?? checkinZone.x, checkinObj?.z ?? checkinZone.z, { objectId: checkinObj?.id, zoneId: checkinZone.id }),
    station("payment", "現場收費", paymentObj?.x ?? paymentZone.x, paymentObj?.z ?? paymentZone.z, { objectId: paymentObj?.id, zoneId: paymentZone.id }),
    station("shoe", "鞋子", shoeZone.x, shoeZone.z, { zoneId: shoeZone.id }),
    station("backpack", "後牆長桌", backpackZone.x, backpackZone.z, { zoneId: backpackZone.id }),
    station("seating", "巧拼座區", seatingPosition.x, seatingPosition.z),
  ];
  const ids = (types: ServiceStation["type"][]) => types.map((t) => stations.find((s) => s.type === t)!.id);
  const prepaid = ids(["entrance", "guide", "queue", "checkin", "shoe", "backpack", "seating"]);
  const onsite = ids(["entrance", "guide", "queue", "checkin", "payment", "shoe", "backpack", "seating"]);
  const scenario: EventScenario = {
    id: uid("scn"), name: "E310 演講範例（60 人）", participantCount: 60,
    arrivalWindowSeconds: 900, arrivalProfile: "front-loaded",
    profiles: [
      { id: "prepaid", ratio: 40 / 60, branch: prepaid },
      { id: "pay-on-site", ratio: 20 / 60, branch: onsite },
    ],
    stations, seed: 310, settings: { speedMetersPerSecond: 1.0 },
  };
  project.scenarios = [scenario];
  project.activeScenarioId = scenario.id;
  const routePoints = [
    { x: entrance.x, z: entrance.z },
    { x: guide.x, z: guide.z },
    { x: queue.x, z: queue.z },
    { x: door?.x ?? project.classroom.x + project.classroom.length - 1.4, z: door?.z ?? project.classroom.z + project.classroom.width },
    { x: checkinZone.x, z: checkinZone.z },
    { x: shoeZone.x, z: shoeZone.z },
    { x: seatingPosition.x, z: Math.max(project.classroom.z + 3.7, seatingPosition.z - (field?.rows ?? 2) * 0.6 / 2) },
  ];
  project.routes = [{ id: uid("route"), name: "E310 入場動線", color: "#22c55e", points: routePoints, visible: true, type: "entry" }];
  project.description = "60 人｜40 人預繳／20 人現場繳費｜15 分鐘到達窗";
  return project;
}
