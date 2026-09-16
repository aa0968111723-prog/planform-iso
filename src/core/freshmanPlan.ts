/**
 * Indoor freshman plan — a top-down reading of the room, not a survey.
 *
 * Front (projector) is at the top of the plot; the door is at the bottom.
 * Coordinates are percentages of the plot so the overlay can scale. Indoor
 * lat/lng are never invented.
 */

import type { Project, SceneObject, Zone } from "./model";
import { pickNonOverlappingMapLabels } from "./campusMap";
import { freshmanZoneTitle, type FreshmanGuide } from "./freshman";

export type FreshmanPlanKind =
  | "corridor"
  | "room"
  | "mat"
  | "aisle"
  | "zone"
  | "door"
  | "screen"
  | "staff"
  | "here"
  | "next";

export interface FreshmanPlanBox {
  id: string;
  kind: FreshmanPlanKind;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  icon?: string;
  zoneType?: string;
}

export interface FreshmanPlanLabel {
  id: string;
  x: number;
  y: number;
  text: string;
  tone: "here" | "next" | "zone" | "door" | "front" | "detail";
}

export interface FreshmanPlanArrow {
  from: { x: number; y: number };
  to: { x: number; y: number };
  index: number;
}

export interface FreshmanPlanView {
  boxes: FreshmanPlanBox[];
  labels: FreshmanPlanLabel[];
  arrows: FreshmanPlanArrow[];
  detailLine: string | null;
  frontCaption: string;
  entryCaption: string;
}

const PAD = 6;

function plotOf(project: Project): { minX: number; minZ: number; spanX: number; spanZ: number } {
  const { classroom: c, corridor: k } = project;
  const minX = Math.min(c.x, k.x);
  const minZ = Math.min(c.z, k.z);
  const maxX = Math.max(c.x + c.length, k.x + k.length);
  const maxZ = Math.max(c.z + c.width, k.z + k.width);
  return {
    minX,
    minZ,
    spanX: Math.max(maxX - minX, 0.5),
    spanZ: Math.max(maxZ - minZ, 0.5),
  };
}

function toPlot(project: Project, x: number, z: number): { x: number; y: number } {
  const p = plotOf(project);
  return {
    x: PAD + ((x - p.minX) / p.spanX) * (100 - PAD * 2),
    y: PAD + ((z - p.minZ) / p.spanZ) * (100 - PAD * 2),
  };
}

function toSize(project: Project, w: number, d: number): { w: number; h: number } {
  const p = plotOf(project);
  return {
    w: (w / p.spanX) * (100 - PAD * 2),
    h: (d / p.spanZ) * (100 - PAD * 2),
  };
}

function boxFromRect(
  project: Project,
  id: string,
  kind: FreshmanPlanKind,
  x: number,
  z: number,
  w: number,
  d: number,
  label: string,
  extra?: Partial<FreshmanPlanBox>,
): FreshmanPlanBox {
  const origin = toPlot(project, x, z);
  const size = toSize(project, w, d);
  return { id, kind, x: origin.x, y: origin.y, w: size.w, h: size.h, label, ...extra };
}

function zoneIcon(type: Zone["type"]): string {
  switch (type) {
    case "registration": return "👋";
    case "shoe": return "👟";
    case "backpack": return "🎒";
    case "meditation": return "🎤";
    case "life": return "🧺";
    case "payment": return "💰";
    default: return "📍";
  }
}

export function layoutFreshmanPlan(
  project: Project,
  guide: FreshmanGuide,
  detail = false,
): FreshmanPlanView {
  const c = project.classroom;
  const k = project.corridor;
  const boxes: FreshmanPlanBox[] = [];
  const labels: FreshmanPlanLabel[] = [];
  const arrows: FreshmanPlanArrow[] = [];

  boxes.push(boxFromRect(project, "corridor", "corridor", k.x, k.z, k.length, k.width, "走廊"));
  boxes.push(boxFromRect(project, "room", "room", c.x, c.z, c.length, c.width, "教室"));

  const field = project.groups.find((g) => g.sourceKind === "mat" && !g.hidden);
  if (field) {
    const w = field.cols * field.itemWidth;
    const d = field.rows * field.itemDepth;
    boxes.push(boxFromRect(project, "mats", "mat", field.anchorX, field.anchorZ, w, d, "地墊區"));
    const aisleW = Math.min(1.1, Math.max(0.6, w * 0.18));
    boxes.push(boxFromRect(
      project,
      "aisle",
      "aisle",
      field.anchorX + w / 2 - aisleW / 2,
      field.anchorZ,
      aisleW,
      d,
      "中央走道",
    ));
  }

  for (const zone of project.zones.filter((z) => !z.hidden)) {
    const title = freshmanZoneTitle(zone.type, zone.name);
    boxes.push(boxFromRect(
      project,
      `zone:${zone.id}`,
      "zone",
      zone.x - zone.width / 2,
      zone.z - zone.depth / 2,
      zone.width,
      zone.depth,
      title,
      { icon: zone.icon || zoneIcon(zone.type), zoneType: zone.type },
    ));
  }

  const door = project.objects.find((o) => o.kind === "door" && !o.hidden);
  if (door) {
    const size = toSize(project, Math.max(door.width, 0.9), 0.45);
    const origin = toPlot(project, door.x - Math.max(door.width, 0.9) / 2, door.z - 0.15);
    boxes.push({
      id: "door",
      kind: "door",
      x: origin.x,
      y: origin.y,
      w: size.w,
      h: size.h,
      label: "入口",
      icon: "🚪",
    });
  }

  const screen = project.objects.find((o) => o.kind === "screen" && !o.hidden);
  if (screen) {
    const size = toSize(project, Math.max(screen.width, c.length * 0.45), 0.28);
    const origin = toPlot(project, screen.x - Math.max(screen.width, c.length * 0.45) / 2, c.z);
    boxes.push({
      id: "screen",
      kind: "screen",
      x: origin.x,
      y: origin.y,
      w: size.w,
      h: Math.max(size.h, 2.2),
      label: "投影幕",
    });
  }

  const staff = project.objects.find((o) =>
    !o.hidden && (o.serviceRole === "checkin" || o.serviceRole === "guidance" || o.assetId === "builtin:lectern"),
  ) as SceneObject | undefined;
  if (staff) {
    const origin = toPlot(project, staff.x, staff.z);
    boxes.push({
      id: "staff",
      kind: "staff",
      x: origin.x - 3,
      y: origin.y - 3,
      w: 6,
      h: 6,
      label: "工作人員",
      icon: "🦺",
    });
  }

  const here = guide.stops[guide.stopIndex];
  const next = guide.stops[guide.stopIndex + 1];
  if (here) {
    const p = toPlot(project, here.x, here.z);
    boxes.push({
      id: "here",
      kind: "here",
      x: p.x - 4,
      y: p.y - 4,
      w: 8,
      h: 8,
      label: "你在這裡",
    });
  }
  if (next) {
    const p = toPlot(project, next.x, next.z);
    boxes.push({
      id: "next",
      kind: "next",
      x: p.x - 3.5,
      y: p.y - 3.5,
      w: 7,
      h: 7,
      label: `下一步：${next.title}`,
    });
  }

  for (let i = 0; i < guide.stops.length - 1; i++) {
    arrows.push({
      from: toPlot(project, guide.stops[i].x, guide.stops[i].z),
      to: toPlot(project, guide.stops[i + 1].x, guide.stops[i + 1].z),
      index: i + 1,
    });
  }

  const rawLabels: (FreshmanPlanLabel & { width: number; height: number; priority: number })[] = [];
  const pushLabel = (
    id: string,
    x: number,
    y: number,
    text: string,
    tone: FreshmanPlanLabel["tone"],
    priority: number,
    width: number,
  ) => {
    rawLabels.push({ id, x, y, text, tone, width, height: 16, priority });
  };

  // Zone / mat names sit inside their boxes. Overlay pills are only
  // you-are-here and next so they never fight the door or zone titles.
  if (here) {
    const p = toPlot(project, here.x, here.z);
    pushLabel("here", p.x, Math.min(94, p.y + 12), "你在這裡", "here", 0, 76);
  }
  if (next) {
    const p = toPlot(project, next.x, next.z);
    pushLabel("next", p.x, Math.max(8, p.y - 12), `下一步：${next.title}`, "next", 0, 100);
  }
  for (const arrow of arrows) {
    const mx = (arrow.from.x + arrow.to.x) / 2;
    const my = (arrow.from.y + arrow.to.y) / 2;
    rawLabels.push({
      id: `num:${arrow.index}`,
      x: mx,
      y: my,
      text: "",
      tone: "detail",
      width: 16,
      height: 16,
      priority: 0,
    });
  }

  const visible = pickNonOverlappingMapLabels(rawLabels.map((l) => ({
    id: l.id,
    x: l.x - l.width / 2,
    y: l.y - 8,
    width: l.width,
    height: l.height,
    priority: l.priority,
  })));
  for (const label of rawLabels) {
    if (!label.text) continue;
    if (visible.has(label.id)) {
      labels.push({ id: label.id, x: label.x, y: label.y, text: label.text, tone: label.tone });
    }
  }

  return {
    boxes,
    labels,
    arrows,
    detailLine: detail
      ? `教室約 ${c.length} × ${c.width} 公尺（待現場校正）`
      : null,
    frontCaption: "前方（投影幕）",
    entryCaption: guide.entranceText,
  };
}
