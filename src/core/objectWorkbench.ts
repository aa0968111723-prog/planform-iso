/**
 * Selection workbench model — what the context bar and properties panel show
 * immediately after a tap, without opening a vague 「屬性」 dump.
 */

import { assetDef } from "./assets";
import { catalogFromProject } from "./migrate";
import { metersToCm } from "./units";
import { objectFieldInfo } from "./measure";
import { inferEditorLayer } from "./editorLayers";
import type { EditorLayerId, Project, SceneObject, Zone } from "./model";

export interface ObjectWorkbenchSummary {
  id: string;
  name: string;
  type: string;
  icon: string;
  color: string;
  width: number;
  depth: number;
  height: number;
  x: number;
  z: number;
  elevation: number;
  facing: number;
  zoneName: string | null;
  space: "classroom" | "corridor" | "outside";
  locked: boolean;
  hidden: boolean;
  snap: boolean;
  blocksCirculation: boolean;
  layer: EditorLayerId;
  wallWest: number;
  wallNorth: number;
  wallEast: number;
  wallSouth: number;
  nearestGap: number | null;
}

export function objectDisplayName(obj: SceneObject, project: Project): string {
  if (obj.label && obj.label.trim()) return obj.label.trim();
  if (obj.name && obj.name.trim()) return obj.name.trim();
  const catalog = catalogFromProject(project);
  const entry = catalog.resolve(obj.assetId, obj.kind);
  return entry.name || assetDef(obj.kind).displayName;
}

export function objectWorkbenchSummary(obj: SceneObject, project: Project): ObjectWorkbenchSummary {
  const catalog = catalogFromProject(project);
  const entry = catalog.resolve(obj.assetId, obj.kind);
  const info = objectFieldInfo(obj, project);
  const c = project.classroom;
  const k = project.corridor;
  const inRoom = (a: { x: number; z: number; length: number; width: number }) =>
    obj.x >= a.x && obj.x <= a.x + a.length && obj.z >= a.z && obj.z <= a.z + a.width;
  const space = inRoom(c) ? "classroom" : inRoom(k) ? "corridor" : "outside";
  return {
    id: obj.id,
    name: objectDisplayName(obj, project),
    type: entry.name,
    icon: obj.icon ?? entry.icon,
    color: obj.color ?? entry.color,
    width: obj.width,
    depth: obj.depth,
    height: obj.height,
    x: obj.x,
    z: obj.z,
    elevation: obj.elevation,
    facing: obj.rotationDeg,
    zoneName: info.zoneName,
    space,
    locked: obj.locked,
    hidden: obj.hidden,
    snap: obj.snapEnabled !== false,
    blocksCirculation: obj.blocksCirculation ?? entry.blocksFlow,
    layer: inferEditorLayer(obj),
    wallWest: info.wall.west,
    wallNorth: info.wall.north,
    wallEast: info.wall.east,
    wallSouth: info.wall.south,
    nearestGap: info.nearestSameKindGap,
  };
}

export function formatSize(obj: Pick<SceneObject, "width" | "depth" | "height">, unit: "m" | "cm"): string {
  if (unit === "m") {
    return `${obj.width.toFixed(2)}×${obj.depth.toFixed(2)}×${obj.height.toFixed(2)} m`;
  }
  return `${Math.round(metersToCm(obj.width))}×${Math.round(metersToCm(obj.depth))}×${Math.round(metersToCm(obj.height))} cm`;
}

export function facingLabel(deg: number): string {
  const d = ((Math.round(deg) % 360) + 360) % 360;
  if (d === 0) return "朝教室前方（+Z）";
  if (d === 90) return "朝右側（+X）";
  if (d === 180) return "朝教室後方（−Z）";
  if (d === 270) return "朝左側（−X）";
  return `朝 ${d}°`;
}

export function zoneWorkbenchSummary(zone: Zone): { name: string; type: string; size: string } {
  return {
    name: zone.name,
    type: ZONE_TYPE_LABEL[zone.type] ?? zone.type,
    size: `${zone.width.toFixed(1)}×${zone.depth.toFixed(1)} m`,
  };
}

const ZONE_TYPE_LABEL: Record<string, string> = {
  registration: "報到", payment: "收費", life: "生活組", group: "小組",
  meditation: "講師", shoe: "鞋子", backpack: "背包", mats: "地墊",
  staff: "工作人員", wait: "新生等候", custom: "自訂",
};

export const SIZE_PRESETS_M = [
  { id: "keep", label: "目前尺寸" },
  { id: "60", label: "60×60 cm", width: 0.6, depth: 0.6 },
  { id: "12060", label: "120×60 cm", width: 1.2, depth: 0.6 },
  { id: "18060", label: "180×60 cm", width: 1.8, depth: 0.6 },
  { id: "15070", label: "150×70 cm", width: 1.5, depth: 0.7 },
] as const;
