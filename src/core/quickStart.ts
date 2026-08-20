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
    kind: "regTable",
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
  const near = (dx: number, dz: number, type: ZoneType): Zone => {
    const d = ZONE_DEFAULTS[type];
    return makeZone(type, inX(entry.x + dx, d.width / 2), inZ(backWallZ + dz, d.depth / 2));
  };

  // Zones cluster around the entrance so 報到 → 鞋子 → 背包 reads as one path.
  if (needs.checkin) {
    const zone = near(-1.8, -1.2, "registration");
    project.zones.push(zone);
    project.objects.push(deskObject("builtin:regTable", zone.x, zone.z, 180));
  }
  if (needs.payment) {
    const zone = near(0.6, -1.2, "payment");
    project.zones.push(zone);
    project.objects.push(deskObject("builtin:payment-desk", zone.x, zone.z, 180));
  }
  if (needs.shoe) project.zones.push(near(2.6, -0.8, "shoe"));
  if (needs.backpack) {
    const d = ZONE_DEFAULTS.backpack;
    project.zones.push(makeZone("backpack", inX(c.x + d.width / 2 + 0.3, d.width / 2), inZ(backWallZ - 0.8, d.depth / 2)));
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
    const matArea = {
      minX: bounds.minX + inset,
      maxX: bounds.maxX - inset,
      minZ: bounds.minZ + 1.2,
      maxZ: bounds.maxZ - 2.2, // keep the entrance strip free for zones
    };
    const candidates = generateLayouts({
      participants: config.participants,
      matWidth: 0.6,
      matDepth: 1.8,
      gap: 0.1,
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

  // Starter entry route: door → check-in → toward the mats.
  const routeStops: { x: number; z: number }[] = [{ x: entry.x, z: inZ(backWallZ - 0.4, 0) }];
  const checkinZone = project.zones.find((z) => z.type === "registration");
  if (checkinZone) routeStops.push({ x: checkinZone.x, z: checkinZone.z });
  const shoeZone = project.zones.find((z) => z.type === "shoe");
  if (shoeZone) routeStops.push({ x: shoeZone.x, z: shoeZone.z });
  routeStops.push({ x: c.x + c.length / 2, z: c.z + c.width / 2 });
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
  return project;
}
