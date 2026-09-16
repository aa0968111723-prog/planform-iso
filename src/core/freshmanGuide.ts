/**
 * Freshman-partner reading of a Tamkang classroom plan.
 *
 * A first-time visitor should understand, in a few seconds: which campus,
 * which building, which floor, which room, which door, and where to walk
 * after they enter. No coordinates, no mesh, no calibration numbers on the
 * first layer.
 */

import { assetDef } from "./assets";
import {
  ENTRANCE_UNCONFIRMED,
  currentPlaceOf,
  formatFreshmanHeadline,
  resolveCampusRef,
} from "./campusNav";
import { buildingByCode, campusById, type TkuCampusRef } from "./tkuCampus";
import type { Project, SceneObject, Zone, ZoneType } from "./model";
import { photosForPlace, photosForVenue, type VenuePhotoRef } from "./venuePhotos";

export type FreshmanLayer = "campus" | "building" | "classroom" | "layout";
export type FreshmanQuestion =
  | "where-we-are"
  | "how-to-room"
  | "how-room-laid"
  | "where-i-am"
  | "where-next";

export const FRESHMAN_QUESTIONS: { id: FreshmanQuestion; label: string; icon: string }[] = [
  { id: "where-we-are", label: "我們在哪裡", icon: "📍" },
  { id: "how-to-room", label: "怎麼走到教室", icon: "🚶" },
  { id: "how-room-laid", label: "教室怎麼擺", icon: "🗺️" },
  { id: "where-i-am", label: "我現在在哪裡", icon: "🧍" },
  { id: "where-next", label: "下一步去哪裡", icon: "➡️" },
];

export const FRESHMAN_LAYERS: { id: FreshmanLayer; label: string }[] = [
  { id: "campus", label: "校園位置" },
  { id: "building", label: "樓館位置" },
  { id: "classroom", label: "教室位置" },
  { id: "layout", label: "室內場佈" },
];

export type LayoutCalloutKind =
  | "entrance"
  | "screen"
  | "zone"
  | "mat"
  | "you"
  | "next"
  | "flow"
  | "measure";

export interface LayoutCallout {
  id: string;
  kind: LayoutCalloutKind;
  label: string;
  icon: string;
  x: number;
  z: number;
  layer: "first" | "second";
}

export interface FreshmanStop {
  id: string;
  label: string;
  sentence: string;
  x: number;
  z: number;
}

export interface FreshmanGuide {
  headline: string;
  campusName: string;
  buildingName: string | null;
  buildingCode: string | null;
  floorLabel: string | null;
  roomLabel: string | null;
  goToBuilding: string;
  enterHow: string;
  afterEnter: string;
  afterCheckin: string;
  lastStop: string;
  youAre: FreshmanStop;
  next: FreshmanStop | null;
  journey: FreshmanStop[];
  callouts: LayoutCallout[];
  photos: VenuePhotoRef[];
  entranceUnconfirmed: true;
  /** Short answers for the five freshman questions. */
  answers: Record<FreshmanQuestion, string>;
}

const ENGINEERING = /latitude|longitude|\blat\b|\blng\b|\bcm\b|公分|\bX\s*[:：]|\bZ\s*[:：]|mesh|shader|object id|debug|吸附|snap|Inspector|進階|原點|地磚|rotationDeg/i;

export function freshmanCampusRef(project: Project): TkuCampusRef {
  return resolveCampusRef(project.campusRef, project.venuePresetId);
}

export function doorOf(project: Project): SceneObject | undefined {
  return project.objects.find((o) => o.kind === "door" && !o.hidden);
}

export function screenOf(project: Project): SceneObject | undefined {
  return project.objects.find((o) => o.kind === "screen" && !o.hidden);
}

/**
 * Looking from the rear door toward the screen (typical TKU classroom:
 * door on the +Z / south wall, screen on the −Z / north wall). +X is right.
 */
function sideFromEntrance(
  x: number,
  doorX: number,
): "左側" | "右側" | "中央" {
  const dx = x - doorX;
  if (dx < -0.7) return "左側";
  if (dx > 0.7) return "右側";
  return "中央";
}

function zoneCenter(z: Zone): { x: number; z: number } {
  return { x: z.x, z: z.z };
}

function firstZone(project: Project, type: ZoneType): Zone | undefined {
  return project.zones.find((z) => z.type === type && !z.hidden);
}

function matCenter(project: Project): { x: number; z: number } | null {
  const g = project.groups.find((gr) => !gr.hidden);
  if (!g) return null;
  return {
    x: g.anchorX + (g.cols * g.itemWidth) / 2,
    z: g.anchorZ + (g.rows * g.itemDepth) / 2,
  };
}

function teacherPoint(project: Project): { x: number; z: number } | null {
  const zone = firstZone(project, "meditation");
  if (zone) return zoneCenter(zone);
  const lectern = project.objects.find((o) => o.assetId === "builtin:lectern" && !o.hidden);
  if (lectern) return { x: lectern.x, z: lectern.z };
  const screen = screenOf(project);
  if (screen) return { x: screen.x, z: screen.z + 0.8 };
  return null;
}

function lifePoint(project: Project): { x: number; z: number } | null {
  const zone = firstZone(project, "life");
  return zone ? zoneCenter(zone) : null;
}

export function indoorEntranceSentence(project: Project): string {
  const door = doorOf(project);
  const c = project.classroom;
  let side = "後側";
  if (door) {
    const alongSouth = Math.abs(door.z - (c.z + c.width)) < 0.6;
    const alongNorth = Math.abs(door.z - c.z) < 0.6;
    if (alongSouth) side = "後側";
    else if (alongNorth) side = "前方";
    else if (door.x - c.x < c.length / 2) side = "左側";
    else side = "右側";
  }
  return `請從教室${side}入口進入（${ENTRANCE_UNCONFIRMED}）`;
}

function journeyStops(project: Project): FreshmanStop[] {
  const door = doorOf(project);
  const c = project.classroom;
  const doorX = door?.x ?? c.x + c.length / 2;
  const doorZ = door?.z ?? c.z + c.width;
  const stops: FreshmanStop[] = [
    {
      id: "entrance",
      label: "入口",
      sentence: indoorEntranceSentence(project),
      x: doorX,
      z: doorZ,
    },
  ];
  const checkin = firstZone(project, "registration");
  if (checkin) {
    const side = sideFromEntrance(checkin.x, doorX);
    stops.push({
      id: "checkin",
      label: checkin.name || "報到區",
      sentence: `進入後先到${side}報到區`,
      x: checkin.x,
      z: checkin.z,
    });
  }
  const shoe = firstZone(project, "shoe");
  if (shoe) {
    const side = sideFromEntrance(shoe.x, doorX);
    stops.push({
      id: "shoe",
      label: shoe.name || "鞋子區",
      sentence: checkin ? `完成報到後，前往${side}鞋子區` : `進入後先到${side}鞋子區`,
      x: shoe.x,
      z: shoe.z,
    });
  }
  const pack = firstZone(project, "backpack");
  if (pack) {
    const side = sideFromEntrance(pack.x, doorX);
    stops.push({
      id: "backpack",
      label: pack.name || "背包區",
      sentence: `背包放到${side}背包區`,
      x: pack.x,
      z: pack.z,
    });
  }
  const mats = matCenter(project);
  if (mats) {
    stops.push({
      id: "mats",
      label: "地墊區",
      sentence: "最後進入中央青綠色地墊區",
      x: mats.x,
      z: mats.z,
    });
  }
  const teacher = teacherPoint(project);
  if (teacher) {
    stops.push({
      id: "teacher",
      label: "講師區",
      sentence: "講師在前方投影幕這一側",
      x: teacher.x,
      z: teacher.z,
    });
  }
  const life = lifePoint(project);
  if (life) {
    const side = sideFromEntrance(life.x, doorX);
    stops.push({
      id: "life",
      label: "生活組區",
      sentence: `工作人員在${side}生活組區`,
      x: life.x,
      z: life.z,
    });
  }
  return stops;
}

function callouts(project: Project, journey: FreshmanStop[], you: FreshmanStop, next: FreshmanStop | null): LayoutCallout[] {
  const items: LayoutCallout[] = [];
  const door = doorOf(project);
  if (door) {
    items.push({
      id: "entrance",
      kind: "entrance",
      label: "入口",
      icon: "🚪",
      x: door.x,
      z: door.z,
      layer: "first",
    });
  }
  const screen = screenOf(project);
  if (screen) {
    items.push({
      id: "screen",
      kind: "screen",
      label: "前方投影幕",
      icon: "🎬",
      x: screen.x,
      z: screen.z,
      layer: "first",
    });
  }
  for (const zone of project.zones.filter((z) => !z.hidden)) {
    items.push({
      id: `zone:${zone.id}`,
      kind: "zone",
      label: zone.name,
      icon: zone.icon || iconForZone(zone.type),
      x: zone.x,
      z: zone.z,
      layer: "first",
    });
  }
  const mats = matCenter(project);
  if (mats) {
    items.push({
      id: "mats",
      kind: "mat",
      label: "地墊區",
      icon: "🟩",
      x: mats.x,
      z: mats.z,
      layer: "first",
    });
    items.push({
      id: "aisle",
      kind: "flow",
      label: "中央走道",
      icon: "↕️",
      x: project.classroom.x + project.classroom.length / 2,
      z: mats.z,
      layer: "first",
    });
  }
  const staff = project.objects.find((o) => !!o.serviceRole && !o.hidden);
  if (staff) {
    items.push({
      id: "staff",
      kind: "zone",
      label: "工作人員",
      icon: "👤",
      x: staff.x,
      z: staff.z,
      layer: "first",
    });
  }
  journey.forEach((stop, i) => {
    if (stop.id === "entrance") return;
    items.push({
      id: `flow:${stop.id}`,
      kind: "flow",
      label: `${circled(i)} ${stop.label}`,
      icon: circled(i),
      x: stop.x,
      z: stop.z,
      layer: "first",
    });
  });
  items.push({
    id: "you",
    kind: "you",
    label: "你在這裡",
    icon: "🧍",
    x: you.x,
    z: you.z,
    layer: "first",
  });
  if (next) {
    items.push({
      id: "next",
      kind: "next",
      label: `下一站 ${next.label}`,
      icon: "➡️",
      x: next.x,
      z: next.z,
      layer: "first",
    });
  }
  const c = project.classroom;
  items.push({
    id: "measure-room",
    kind: "measure",
    label: `教室約 ${trimNum(c.length)}×${trimNum(c.width)} 公尺，待現場校正`,
    icon: "📏",
    x: c.x + c.length / 2,
    z: c.z + c.width / 2,
    layer: "second",
  });
  return items;
}

function iconForZone(type: ZoneType): string {
  switch (type) {
    case "registration": return "👋";
    case "shoe": return "👟";
    case "backpack": return "🎒";
    case "meditation": return "🧘";
    case "life": return "🧺";
    case "group": return "👥";
    case "payment": return "💰";
    default: return "📦";
  }
}

function circled(n: number): string {
  return n >= 1 && n <= 20 ? String.fromCharCode(0x245f + n) : String(n);
}

function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function youAreHereForQuestion(
  journey: FreshmanStop[],
  question: FreshmanQuestion,
): { you: FreshmanStop; next: FreshmanStop | null } {
  if (!journey.length) {
    const fallback = { id: "here", label: "這裡", sentence: "先看教室入口", x: 0, z: 0 };
    return { you: fallback, next: null };
  }
  if (question === "where-we-are" || question === "how-to-room") {
    return { you: journey[0], next: journey[1] ?? null };
  }
  if (question === "how-room-laid") {
    return { you: journey[0], next: journey[1] ?? null };
  }
  if (question === "where-i-am") {
    return { you: journey[0], next: journey[1] ?? null };
  }
  const you = journey[1] ?? journey[0];
  const idx = journey.findIndex((s) => s.id === you.id);
  return { you, next: journey[idx + 1] ?? null };
}

export function buildFreshmanGuide(
  project: Project,
  question: FreshmanQuestion = "where-i-am",
): FreshmanGuide {
  const ref = freshmanCampusRef(project);
  const campus = campusById(ref.campusId);
  const building = ref.buildingCode ? buildingByCode(ref.buildingCode) : undefined;
  const place = currentPlaceOf(ref);
  const floor = ref.floor ?? place?.floor;
  const floorLabel = floor == null ? null : floor === 0 ? "B1" : `${floor}F`;
  const roomLabel = place && /^[A-Z]{1,2}\d/.test(place.id)
    ? place.id
    : ref.buildingCode && floor != null && ref.room
      ? `${ref.buildingCode}${floor}${ref.room}`
      : place?.name ?? null;
  const headline = formatFreshmanHeadline(ref);
  const goToBuilding = building
    ? `你現在要前往${building.name}${floorLabel ? ` ${floorLabel}` : ""}`
    : `你現在要前往${campus?.name ?? "活動場地"}`;
  const journey = journeyStops(project);
  const { you, next } = youAreHereForQuestion(journey, question);
  const checkin = journey.find((s) => s.id === "checkin");
  const shoe = journey.find((s) => s.id === "shoe");
  const mats = journey.find((s) => s.id === "mats");
  const enterHow = indoorEntranceSentence(project);
  const afterEnter = checkin?.sentence ?? journey[1]?.sentence ?? "進入教室後依動線前進";
  const afterCheckin = shoe?.sentence ?? "完成報到後，依工作人員指示前進";
  const lastStop = mats?.sentence ?? journey[journey.length - 1]?.sentence ?? "依現場動線就位";
  const photos = [
    ...(project.venuePresetId ? photosForVenue(project.venuePresetId) : []),
    ...(place ? photosForPlace(place.id) : []),
  ].filter((p, i, all) => all.findIndex((x) => x.id === p.id) === i);

  const answers: Record<FreshmanQuestion, string> = {
    "where-we-are": headline,
    "how-to-room": `${goToBuilding}。${enterHow}`,
    "how-room-laid": "面對前方投影幕，入口在教室後側。地墊在中央，報到、鞋子與背包在兩側。",
    "where-i-am": `你在這裡：${you.label}`,
    "where-next": next ? `下一步：${next.sentence}` : "你已經到活動場地了",
  };

  return {
    headline,
    campusName: campus?.name ?? "淡江大學",
    buildingName: building?.name ?? null,
    buildingCode: building?.code ?? null,
    floorLabel,
    roomLabel,
    goToBuilding,
    enterHow,
    afterEnter,
    afterCheckin,
    lastStop,
    youAre: you,
    next,
    journey,
    callouts: callouts(project, journey, you, next),
    photos,
    entranceUnconfirmed: true,
    answers,
  };
}

export function freshmanFirstLayer(guide: FreshmanGuide): LayoutCallout[] {
  return guide.callouts.filter((c) => c.layer === "first");
}

export function freshmanSecondLayer(guide: FreshmanGuide): LayoutCallout[] {
  return guide.callouts.filter((c) => c.layer === "second");
}

/** Partner chrome for freshmen must not leak engineering vocabulary. */
export function freshmanTextIsPlain(text: string): boolean {
  return !ENGINEERING.test(text);
}

export function freshmanVisibleText(guide: FreshmanGuide, detailLayer: boolean): string {
  const parts = [
    guide.headline,
    guide.goToBuilding,
    guide.enterHow,
    guide.afterEnter,
    guide.afterCheckin,
    guide.lastStop,
    ...Object.values(guide.answers),
    ...freshmanFirstLayer(guide).map((c) => c.label),
  ];
  if (detailLayer) parts.push(...freshmanSecondLayer(guide).map((c) => c.label));
  return parts.join("\n");
}

export function objectPlainName(obj: SceneObject): string {
  return obj.label || obj.name || assetDef(obj.kind).displayName;
}

export function layerForQuestion(question: FreshmanQuestion): FreshmanLayer {
  switch (question) {
    case "where-we-are": return "campus";
    case "how-to-room": return "building";
    case "how-room-laid": return "layout";
    case "where-i-am": return "layout";
    case "where-next": return "layout";
  }
}
