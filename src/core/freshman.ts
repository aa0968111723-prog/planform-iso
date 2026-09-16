/**
 * Freshman-partner reading of a Tamkang classroom plan.
 *
 * Five sentences, no engineering vocabulary: where we are, how to the room,
 * how the room is laid out, where you stand, where to go next.
 */

import { buildingByCode, campusById, type TkuPlace } from "./tkuCampus";
import {
  entranceHint,
  formatFreshmanHeadline,
  resolveProjectPlace,
} from "./campusGuide";
import { photosForPlace, type VenuePhotoRef } from "./venuePhotos";
import type { Project, Zone, ZoneType } from "./model";

export type FreshmanLayer = "campus" | "building" | "classroom" | "indoor";
export type FreshmanInfoLayer = "essential" | "detail";
export type PartnerAudience = "crew" | "freshman";

export const FRESHMAN_LAYERS: { id: FreshmanLayer; label: string; icon: string }[] = [
  { id: "campus", label: "校園位置", icon: "🗺️" },
  { id: "building", label: "樓館位置", icon: "🏢" },
  { id: "classroom", label: "教室位置", icon: "🚪" },
  { id: "indoor", label: "室內場佈", icon: "🧩" },
];

/** Words a first-time freshman must never be shown. */
export const FRESHMAN_FORBIDDEN =
  /\b(latitude|longitude|mesh|shader|debug|inspector|rotationDeg|object\s*id)\b|\b[xz]\s*[:：]|吸附|原點|進階設定/i;

export interface FreshmanStep {
  index: number;
  text: string;
}

export interface FreshmanPathPoint {
  index: number;
  x: number;
  z: number;
  label: string;
}

export interface FreshmanBriefLine {
  icon: string;
  label: string;
  text: string;
}

export interface FreshmanGuide {
  place: TkuPlace | null;
  headline: string;
  whereWeAre: string;
  howToRoom: string;
  howLayout: string;
  youAreNow: string;
  nextStop: string;
  entrancePending: boolean;
  entranceText: string;
  youArePoint: { x: number; z: number } | null;
  nextPoint: { x: number; z: number; label: string } | null;
  path: FreshmanPathPoint[];
  screen: { x: number; z: number; width: number } | null;
  steps: FreshmanStep[];
  photos: VenuePhotoRef[];
  lines: string[];
}

const JOURNEY: { type: ZoneType | "entrance" | "mats"; name: string }[] = [
  { type: "entrance", name: "入口" },
  { type: "registration", name: "報到區" },
  { type: "shoe", name: "鞋子區" },
  { type: "backpack", name: "背包區" },
  { type: "mats", name: "地墊區" },
  { type: "meditation", name: "講師區" },
  { type: "life", name: "生活組區" },
];

function doorOf(project: Project): { x: number; z: number } | null {
  const door = project.objects.find((o) => o.kind === "door" && !o.hidden);
  if (door) return { x: door.x, z: door.z };
  const c = project.classroom;
  return { x: c.x + c.length / 2, z: c.z + c.width };
}

function sideOf(doorX: number, x: number): "左側" | "右側" | "前方" {
  if (Math.abs(x - doorX) < 0.6) return "前方";
  return x < doorX ? "左側" : "右側";
}

function zoneCenter(zone: Zone): { x: number; z: number } {
  return { x: zone.x, z: zone.z };
}

function hasMats(project: Project): boolean {
  return project.groups.some((g) => g.sourceKind === "mat" && !g.hidden)
    || project.objects.some((o) => o.kind === "mat" && !o.hidden);
}

function matCenter(project: Project): { x: number; z: number } | null {
  const groups = project.groups.filter((g) => g.sourceKind === "mat" && !g.hidden);
  if (groups.length) {
    const xs = groups.map((g) => g.anchorX + (g.cols * g.itemWidth + (g.cols - 1) * g.gapX) / 2);
    const zs = groups.map((g) => g.anchorZ + (g.rows * g.itemDepth + (g.rows - 1) * g.gapZ) / 2);
    return { x: xs.reduce((a, b) => a + b, 0) / xs.length, z: zs.reduce((a, b) => a + b, 0) / zs.length };
  }
  const mats = project.objects.filter((o) => o.kind === "mat" && !o.hidden);
  if (!mats.length) return null;
  return {
    x: mats.reduce((s, o) => s + o.x, 0) / mats.length,
    z: mats.reduce((s, o) => s + o.z, 0) / mats.length,
  };
}

function journeyStops(project: Project, door: { x: number; z: number }): {
  key: string;
  name: string;
  phrase: string;
  point: { x: number; z: number };
}[] {
  const stops: { key: string; name: string; phrase: string; point: { x: number; z: number } }[] = [];
  for (const step of JOURNEY) {
    if (step.type === "entrance") {
      stops.push({ key: "entrance", name: "入口", phrase: "教室後側入口", point: door });
      continue;
    }
    if (step.type === "mats") {
      if (!hasMats(project)) continue;
      const point = matCenter(project) ?? { x: project.classroom.x + project.classroom.length / 2, z: project.classroom.z + project.classroom.width / 2 };
      stops.push({ key: "mats", name: "地墊區", phrase: "中央青綠色地墊區", point });
      continue;
    }
    const zone = project.zones.find((z) => z.type === step.type && !z.hidden);
    if (!zone) continue;
    const side = sideOf(door.x, zone.x);
    const name = zone.name || step.name;
    const phrase = step.type === "registration"
      ? `${side}${name}`
      : step.type === "shoe" || step.type === "backpack"
        ? `${side}${name}`
        : name;
    stops.push({ key: zone.id, name, phrase, point: zoneCenter(zone) });
  }
  return stops;
}

export function buildFreshmanGuide(project: Project): FreshmanGuide {
  const place = resolveProjectPlace(project);
  const campus = place ? campusById(place.campusId) : campusById("tamsui");
  const building = place?.buildingCode ? buildingByCode(place.buildingCode) : undefined;
  const door = doorOf(project);
  const entrance = entranceHint(place);
  const stops = door ? journeyStops(project, door) : [];
  const next = stops.length > 1 ? stops[1] : null;
  const layoutBits = stops.filter((s) => s.key !== "entrance").map((s) => s.phrase);

  const whereWeAre = [campus?.name, building?.name].filter(Boolean).join(" · ") || "淡江大學";
  const roomLabel = place?.buildingCode && place.floor != null
    ? `${building?.name ?? place.buildingCode} ${place.floor}F`
    : building ? `${building.name}` : "教室";
  const howToRoom = `你現在要前往${roomLabel}`;
  const hasScreen = project.objects.some((o) => o.kind === "screen" && !o.hidden);
  const layoutParts = ["後側是入口", hasScreen ? "前方是投影幕" : null, ...layoutBits].filter(
    (part): part is string => !!part,
  );
  const howLayout = `教室${layoutParts.join("，")}。`;
  const youAreNow = "你在教室入口";
  const nextStop = next
    ? next.key === "shoe"
      ? `完成報到後，前往${next.phrase}`
      : next.key === "mats"
        ? "最後進入中央青綠色地墊區"
        : next.key === "entrance"
          ? entrance.text
          : `進入後先到${next.phrase}`
    : "依現場工作人員指示前進";
  const screenObj = project.objects.find((o) => o.kind === "screen" && !o.hidden);
  const path: FreshmanPathPoint[] = stops.map((stop, i) => ({
    index: i + 1,
    x: stop.point.x,
    z: stop.point.z,
    label: stop.name,
  }));

  const steps: FreshmanStep[] = [];
  if (stops[0]) steps.push({ index: 1, text: place?.id === "E310" ? "請從教室後側入口進入" : entrance.text });
  layoutBits.forEach((phrase, i) => {
    if (i === 0) steps.push({ index: steps.length + 1, text: `進入後先到${phrase}` });
    else if (phrase.includes("地墊")) steps.push({ index: steps.length + 1, text: "最後進入中央青綠色地墊區" });
    else if (phrase.includes("鞋子")) steps.push({ index: steps.length + 1, text: `完成報到後，前往${phrase}` });
    else steps.push({ index: steps.length + 1, text: `接著到${phrase}` });
  });

  const lines = [whereWeAre, howToRoom, howLayout, youAreNow, nextStop];

  return {
    place,
    headline: formatFreshmanHeadline(place),
    whereWeAre,
    howToRoom,
    howLayout,
    youAreNow,
    nextStop,
    entrancePending: entrance.pending,
    entranceText: entrance.text,
    youArePoint: door,
    nextPoint: next ? { ...next.point, label: next.name } : null,
    path,
    screen: screenObj ? { x: screenObj.x, z: screenObj.z, width: screenObj.width } : null,
    steps,
    photos: place ? photosForPlace(place.id) : [],
    lines,
  };
}

export function freshmanBriefLines(guide: FreshmanGuide, layer: FreshmanLayer): FreshmanBriefLine[] {
  const building = guide.place?.buildingCode ? buildingByCode(guide.place.buildingCode)?.name : undefined;
  const room = guide.place?.id && (guide.place.kind === "classroom" || guide.place.kind === "office")
    ? guide.place.id
    : "教室";
  const floor = guide.place?.floor != null ? `${guide.place.floor}F` : null;
  if (layer === "campus") {
    return [
      { icon: "📍", label: "我們在哪裡", text: guide.whereWeAre },
      { icon: "🏫", label: "怎麼走到教室", text: guide.howToRoom },
      { icon: "🗺️", label: "教室怎麼擺", text: "先在地圖上找到樓館，再進室內看場佈。" },
      { icon: "🧍", label: "我現在在哪裡", text: "你在校園位置圖" },
      { icon: "➡️", label: "下一步去哪裡", text: building ? `接著看${building}在哪裡` : "接著選樓館位置" },
    ];
  }
  if (layer === "building") {
    return [
      { icon: "📍", label: "我們在哪裡", text: building ? `我們在${building}` : guide.whereWeAre },
      { icon: "🏫", label: "怎麼走到教室", text: floor ? `教室在${floor}` : guide.howToRoom },
      { icon: "🏢", label: "教室怎麼擺", text: "樓館位置只標這棟樓，不是教室門口。" },
      { icon: "🧍", label: "我現在在哪裡", text: building ? `你在${building}附近` : "你在樓館位置" },
      { icon: "➡️", label: "下一步去哪裡", text: `接著找 ${room}${floor ? `（${floor}）` : ""}` },
    ];
  }
  if (layer === "classroom") {
    return [
      { icon: "📍", label: "我們在哪裡", text: [building, floor, room].filter(Boolean).join(" · ") || guide.whereWeAre },
      { icon: "🏫", label: "怎麼走到教室", text: `教室是 ${room}` },
      { icon: "🚪", label: "教室怎麼擺", text: guide.entranceText },
      { icon: "🧍", label: "我現在在哪裡", text: "你在教室門口外" },
      { icon: "➡️", label: "下一步去哪裡", text: "進入室內場佈，看進門後往哪裡走" },
    ];
  }
  return [
    { icon: "📍", label: "我們在哪裡", text: guide.whereWeAre },
    { icon: "🏫", label: "怎麼走到教室", text: guide.howToRoom },
    { icon: "🚪", label: "教室怎麼擺", text: guide.howLayout },
    { icon: "🧍", label: "我現在在哪裡", text: guide.youAreNow },
    { icon: "➡️", label: "下一步去哪裡", text: guide.nextStop },
  ];
}

export function freshmanCopyLeaks(guide: FreshmanGuide): string[] {
  const blob = [
    guide.headline, guide.whereWeAre, guide.howToRoom, guide.howLayout,
    guide.youAreNow, guide.nextStop, guide.entranceText,
    ...guide.steps.map((s) => s.text),
    ...FRESHMAN_LAYERS.flatMap((layer) => freshmanBriefLines(guide, layer.id).map((line) => `${line.label}：${line.text}`)),
  ].join("\n");
  const hits = blob.match(FRESHMAN_FORBIDDEN);
  return hits ? [...new Set(hits)] : [];
}
