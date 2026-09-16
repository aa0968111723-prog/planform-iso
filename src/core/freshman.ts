/**
 * Freshman-partner reading of a Tamkang plan.
 *
 * A first-time visitor has five questions: which campus, which building,
 * which floor and room, which door, and where to walk after they step in.
 * Coordinates, mesh ids and calibration notes stay out of this layer.
 */

import {
  buildingByCode,
  campusById,
  campusRefFromPlace,
  formatFreshmanHeadline,
  placeById,
  placeFromVenuePreset,
  type TkuCampusRef,
  type TkuPlace,
} from "./tkuCampus";
import { entranceStatusText } from "./campusMap";
import type { Project, SceneObject, Zone, ZoneType } from "./model";

export type FreshmanLayer = "campus" | "building" | "classroom" | "indoor";
export type FreshmanAudience = "staff" | "freshman";

export const FRESHMAN_LAYERS: { id: FreshmanLayer; label: string; icon: string }[] = [
  { id: "campus", label: "校園位置", icon: "🗺️" },
  { id: "building", label: "樓館位置", icon: "🏢" },
  { id: "classroom", label: "教室位置", icon: "🚪" },
  { id: "indoor", label: "室內場佈", icon: "🧩" },
];

export interface FreshmanStop {
  id: string;
  title: string;
  text: string;
  x: number;
  z: number;
}

export interface FreshmanGuide {
  headline: string;
  campusName: string;
  buildingName: string | null;
  floorLabel: string | null;
  roomLabel: string | null;
  whereWeAre: string;
  howToClassroom: string;
  howClassroomLooks: string;
  youAreHere: string;
  nextStop: string | null;
  entranceText: string;
  steps: { index: number; text: string }[];
  stops: FreshmanStop[];
  stopIndex: number;
  place: TkuPlace | null;
  ref: TkuCampusRef;
}

const ENGINEERING = /latitude|longitude|\blat\b|\blng\b|mesh|shader|object id|objectid|debug|rotationDeg|\bx\s*[:：]|\bz\s*[:：]/i;

export function freshmanZoneTitle(type: ZoneType, fallback: string): string {
  switch (type) {
    case "registration": return "報到區";
    case "shoe": return "鞋子區";
    case "backpack": return "背包區";
    case "meditation": return "講師區";
    case "life": return "生活組區";
    case "payment": return "收費區";
    case "group": return "小組區";
    default: return fallback.replace(/擺放|放置/g, "").replace(/禪定/, "") || fallback;
  }
}

export function freshmanPlaceForProject(project: Project): TkuPlace | null {
  if (project.placeId) return placeById(project.placeId) ?? null;
  return placeFromVenuePreset(project.venuePresetId) ?? null;
}

export function freshmanRefForProject(project: Project): TkuCampusRef {
  const place = freshmanPlaceForProject(project);
  if (place) return campusRefFromPlace(place);
  return { campusId: "tamsui" };
}

export function layerCopy(layer: FreshmanLayer, guide: FreshmanGuide): string {
  switch (layer) {
    case "campus":
      return `活動在${guide.campusName}`;
    case "building":
      return guide.buildingName
        ? `你現在要前往${guide.buildingName}${guide.floorLabel ? ` ${guide.floorLabel}` : ""}`
        : `活動在${guide.campusName}`;
    case "classroom":
      return guide.roomLabel
        ? `${guide.buildingName ?? "這棟樓"} ${guide.floorLabel ?? ""} · ${guide.roomLabel}`.replace(/\s+/g, " ").trim()
        : guide.howToClassroom;
    case "indoor":
      return guide.howClassroomLooks;
  }
}

function zoneOf(project: Project, type: ZoneType): Zone | undefined {
  return project.zones.find((z) => z.type === type && !z.hidden);
}

function doorOf(project: Project): SceneObject | undefined {
  return project.objects.find((o) => o.kind === "door" && !o.hidden);
}

function screenOf(project: Project): SceneObject | undefined {
  return project.objects.find((o) => o.kind === "screen" && !o.hidden);
}

function matCenter(project: Project): { x: number; z: number } | null {
  const field = project.groups.find((g) => g.sourceKind === "mat" && !g.hidden);
  if (field) {
    return {
      x: field.anchorX + (field.cols * field.itemWidth) / 2,
      z: field.anchorZ + (field.rows * field.itemDepth) / 2,
    };
  }
  const mat = project.objects.find((o) => o.kind === "mat" && !o.hidden);
  return mat ? { x: mat.x, z: mat.z } : null;
}

function shoeZone(project: Project, door: SceneObject | undefined): Zone | undefined {
  const shoes = project.zones.filter((z) => z.type === "shoe" && !z.hidden);
  if (!shoes.length) return undefined;
  if (shoes.length === 1) return shoes[0];
  const named = shoes.find((z) => /右/.test(z.name));
  if (named) return named;
  if (!door) return shoes[0];
  return shoes.reduce((best, z) => (Math.abs(z.x - door.x) < Math.abs(best.x - door.x) ? z : best));
}

export function freshmanStops(project: Project): FreshmanStop[] {
  const door = doorOf(project);
  const checkin = zoneOf(project, "registration");
  const shoe = shoeZone(project, door);
  const bag = zoneOf(project, "backpack");
  const mats = matCenter(project);
  const teacher = zoneOf(project, "meditation");
  const life = zoneOf(project, "life");
  const c = project.classroom;
  const stops: FreshmanStop[] = [];

  const entry = door
    ? { x: door.x, z: door.z }
    : { x: c.x + c.length / 2, z: c.z + c.width };
  stops.push({
    id: "entrance",
    title: "教室入口",
    text: "請從教室後側入口進入",
    x: entry.x,
    z: entry.z,
  });
  if (checkin) {
    stops.push({
      id: "checkin",
      title: freshmanZoneTitle("registration", checkin.name),
      text: "進入後先到左側報到區",
      x: checkin.x,
      z: checkin.z,
    });
  }
  if (shoe) {
    stops.push({
      id: "shoe",
      title: freshmanZoneTitle("shoe", shoe.name),
      text: "完成報到後，前往右側鞋子區",
      x: shoe.x,
      z: shoe.z,
    });
  }
  if (bag) {
    stops.push({
      id: "backpack",
      title: freshmanZoneTitle("backpack", bag.name),
      text: "背包放到側邊課桌椅",
      x: bag.x,
      z: bag.z,
    });
  }
  if (mats) {
    stops.push({
      id: "mats",
      title: "地墊區",
      text: "最後進入中央青綠色地墊區",
      x: mats.x,
      z: mats.z,
    });
  }
  if (teacher) {
    stops.push({
      id: "teacher",
      title: freshmanZoneTitle("meditation", teacher.name),
      text: "前方是講師與投影幕",
      x: teacher.x,
      z: teacher.z,
    });
  }
  if (life) {
    stops.push({
      id: "life",
      title: freshmanZoneTitle("life", life.name),
      text: "生活組與工作人員在側邊",
      x: life.x,
      z: life.z,
    });
  }
  return stops;
}

export function buildFreshmanGuide(project: Project, stopIndex = 0): FreshmanGuide {
  const place = freshmanPlaceForProject(project);
  const ref = freshmanRefForProject(project);
  const campus = campusById(ref.campusId);
  const building = ref.buildingCode ? buildingByCode(ref.buildingCode) : undefined;
  const roomLabel = place && place.kind === "classroom"
    ? place.id
    : ref.buildingCode && ref.floor != null && ref.room
      ? `${ref.buildingCode}${ref.floor}${ref.room}`
      : null;
  const floorLabel = ref.floor != null ? `${ref.floor}F` : null;
  const stops = freshmanStops(project);
  const clamped = Math.max(0, Math.min(stopIndex, Math.max(0, stops.length - 1)));
  const here = stops[clamped];
  const next = stops[clamped + 1] ?? null;
  const door = doorOf(project);
  const screen = screenOf(project);
  const hasMats = !!matCenter(project);

  const whereWeAre = campus
    ? building
      ? `活動在${campus.name}，請到${building.name}`
      : `活動在${campus.name}`
    : "活動在淡江大學";

  const howToClassroom = roomLabel
    ? `你現在要前往${building?.name ?? "教室"} ${floorLabel ?? ""} · ${roomLabel}`.replace(/\s+/g, " ").trim()
    : building
      ? `你現在要前往${building.name}`
      : whereWeAre;

  const looks: string[] = [];
  if (door) looks.push("後側有入口");
  if (screen) looks.push("前方是投影幕");
  if (hasMats) looks.push("中央是青綠色地墊，中間留走道");
  if (zoneOf(project, "registration")) looks.push("報到在左側");
  if (zoneOf(project, "shoe")) looks.push("鞋子在墊邊");
  const howClassroomLooks = looks.length
    ? `教室怎麼擺：${looks.join("，")}`
    : "教室場佈還沒排完，先進教室後依現場指示。";

  const entranceText = place
    ? entranceStatusText(place)
    : door
      ? "請從教室後側入口進入（入口待現場確認）"
      : "入口待現場確認";

  const steps = stops.map((stop, i) => ({ index: i + 1, text: stop.text }));
  if (!steps.length) {
    steps.push({ index: 1, text: "依現場工作人員指示進入教室" });
  }

  return {
    headline: formatFreshmanHeadline(ref),
    campusName: campus?.name ?? "淡江大學",
    buildingName: building?.name ?? null,
    floorLabel,
    roomLabel,
    whereWeAre,
    howToClassroom,
    howClassroomLooks,
    youAreHere: here ? `你在這裡：${here.title}` : "你在這裡：教室入口",
    nextStop: next ? next.text : "就位後依現場指示坐下",
    entranceText,
    steps,
    stops,
    stopIndex: clamped,
    place,
    ref,
  };
}

export function freshmanGuideHasEngineering(text: string): boolean {
  return ENGINEERING.test(text);
}

export function freshmanPlainTexts(guide: FreshmanGuide): string[] {
  return [
    guide.headline,
    guide.whereWeAre,
    guide.howToClassroom,
    guide.howClassroomLooks,
    guide.youAreHere,
    guide.nextStop ?? "",
    guide.entranceText,
    ...guide.steps.map((s) => s.text),
  ];
}
