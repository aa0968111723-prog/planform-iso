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
    project.zones.push(makeZone("meditation", c.x + c.length / 2, inZ(c.z + d.depth / 2 + 0.5, d.depth / 2)));
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
    const frontReserve = needs.teacher ? 3.0 : inset;
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
    });
    const preferred =
      (config.centralAisle ? candidates.find((cand) => cand.id === "aisle") : null) ??
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
