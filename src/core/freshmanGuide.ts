/**
 * Freshman-partner copy and pins.
 *
 * A first-time visitor needs five sentences, in order, with no engineering
 * vocabulary: which campus, which building, which floor, which room, which
 * door, then where to walk once inside. Coordinates, mesh ids and centimetres
 * stay out of this module's public strings.
 */

import type { Project, Zone, ZoneType } from "./model";
import {
  buildingByCode,
  campusById,
  campusRefFromPlace,
  parseTkuRoomCode,
  placeById,
  uniquePlaceForVenuePreset,
  type TkuCampusId,
  type TkuCampusRef,
  type TkuPlace,
} from "./tkuCampus";
import { entranceCopy } from "./campusMap";
import { photosForPlace, photosForVenue } from "./venuePhotos";

export type FreshmanStage = "campus" | "building" | "classroom" | "layout";

export interface FreshmanMapFocus {
  campusId: TkuCampusId;
  buildingCode?: string;
  placeId?: string;
}

export const FRESHMAN_STAGES: { id: FreshmanStage; label: string; icon: string }[] = [
  { id: "campus", label: "校園", icon: "🗺️" },
  { id: "building", label: "樓館", icon: "🏫" },
  { id: "classroom", label: "教室", icon: "🚪" },
  { id: "layout", label: "場佈", icon: "🧩" },
];

export interface FreshmanHeadline {
  text: string;
  campusName: string;
  buildingName: string | null;
  roomCode: string | null;
  floorLabel: string | null;
}

export interface FreshmanPin {
  x: number;
  z: number;
  label: string;
}

export interface FreshmanLayoutPins {
  youAreHere: FreshmanPin;
  nextStop: FreshmanPin | null;
  entrance: FreshmanPin | null;
}

export interface FreshmanZoneHint {
  id: string;
  label: string;
  icon: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  color: string;
}

export interface FreshmanLayoutView {
  pins: FreshmanLayoutPins;
  path: { x: number; z: number; index: number }[];
  zones: FreshmanZoneHint[];
  screenBar: { x: number; z: number; width: number };
}

export interface FreshmanBriefing {
  headline: string;
  where: string;
  howToRoom: string;
  howLaidOut: string;
  youAre: string;
  next: string;
  steps: { index: number; text: string }[];
  photosNote: string | null;
  entrance: string;
}

export const FRESHMAN_ENGINEERING =
  /\b(x|z)\s*[:：]|latitude|longitude|mesh|shader|object id|debug|rotationDeg|吸附/i;

export function formatFreshmanHeadline(ref: TkuCampusRef | null | undefined): FreshmanHeadline {
  const campus = campusById(ref?.campusId ?? "tamsui");
  const building = ref?.buildingCode ? buildingByCode(ref.buildingCode) : undefined;
  const roomCode = roomCodeFromRef(ref);
  const floorLabel = ref?.floor != null ? `${ref.floor}F` : null;
  const bits = ["淡江大學", campus?.name, building?.name, roomCode, floorLabel].filter(Boolean);
  return {
    text: bits.join(" · "),
    campusName: campus?.name ?? "淡水校園",
    buildingName: building?.name ?? null,
    roomCode,
    floorLabel,
  };
}

function roomCodeFromRef(ref: TkuCampusRef | null | undefined): string | null {
  if (!ref) return null;
  if (ref.placeId && parseTkuRoomCode(ref.placeId)) return ref.placeId.toUpperCase();
  if (ref.buildingCode && ref.floor != null && ref.room) {
    return `${ref.buildingCode}${ref.floor}${ref.room}`;
  }
  return null;
}

export function resolveProjectCampusRef(project: Pick<Project, "campusRef" | "venuePresetId">): TkuCampusRef {
  if (project.campusRef?.campusId) return project.campusRef;
  const fromVenue = uniquePlaceForVenuePreset(project.venuePresetId);
  if (fromVenue) return campusRefFromPlace(fromVenue);
  return { campusId: "tamsui" };
}

export function projectPlace(project: Pick<Project, "campusRef" | "venuePresetId">): TkuPlace | undefined {
  const ref = resolveProjectCampusRef(project);
  if (ref.placeId) return placeById(ref.placeId);
  return uniquePlaceForVenuePreset(project.venuePresetId);
}

export function freshmanBriefing(project: Project, stepIndex = 0): FreshmanBriefing {
  const ref = resolveProjectCampusRef(project);
  const head = formatFreshmanHeadline(ref);
  const building = head.buildingName ?? "活動樓館";
  const floor = head.floorLabel ?? "活動樓層";
  const room = head.roomCode ?? "教室";
  const place = projectPlace(project);
  const entrance = entranceCopy(place);
  const journey = freshmanJourney(project);
  const i = clampStep(stepIndex, journey.length);
  const here = journey[i];
  const next = journey[i + 1] ?? null;

  const where = `活動在${head.campusName}，請走到${building}`;
  const howToRoom = `你現在要前往${building} ${floor}，教室是${room}`;
  const howLaidOut = layoutSentence();
  const youAre = here ? `你現在在「${here.name}」` : "你現在在教室入口";
  const nextText = next ? next.prompt : "進教室後跟著場上的編號走";

  const steps = [
    { index: 1, text: `你現在要前往${building} ${floor}` },
    { index: 2, text: `請從${doorPhrase(entrance)}進入` },
    ...journey.slice(1).map((stop, idx) => ({
      index: idx + 3,
      text: stop.prompt,
    })),
  ];

  const photos = photosForVenue(project.venuePresetId).concat(photosForPlace(place?.id));
  const photosNote = photos.length
    ? "現場照片只幫忙認教室，尺寸仍待現場確認。"
    : null;

  const briefing: FreshmanBriefing = {
    headline: head.text,
    where,
    howToRoom,
    howLaidOut,
    youAre,
    next: nextText,
    steps,
    photosNote,
    entrance,
  };
  assertPlain(briefing);
  return briefing;
}

export interface FreshmanStop {
  id: string;
  name: string;
  prompt: string;
  x: number;
  z: number;
}

export function freshmanJourney(project: Project): FreshmanStop[] {
  const sketch = schematicLayout(project);
  const door = project.objects.find((o) => o.kind === "door" && !o.hidden);
  const checkin = zoneOf(project, "registration");
  const shoes = nearestZone(project, "shoe", door?.x ?? checkin?.x ?? sketch.entrance.x);
  const backpack = zoneOf(project, "backpack");
  const mats = matCenter(project) ?? sketch.mats;
  const teacher = zoneOf(project, "meditation");
  const life = zoneOf(project, "life");

  const entrance: FreshmanStop = {
    id: "entrance",
    name: "教室入口",
    prompt: "請從教室後側入口進入",
    x: door?.x ?? sketch.entrance.x,
    z: door?.z ?? sketch.entrance.z,
  };

  const stops: FreshmanStop[] = [entrance];
  const checkinPt = checkin ?? sketch.checkin;
  stops.push({
    id: "checkin",
    name: checkin?.name || "報到區",
    prompt: `進入後先到${sideOf(project, checkinPt.x)}報到區`,
    x: checkinPt.x,
    z: checkinPt.z,
  });
  const shoePt = shoes ?? sketch.shoe;
  stops.push({
    id: "shoe",
    name: shoes?.name || "鞋子區",
    prompt: `完成報到後，前往${sideOf(project, shoePt.x)}鞋子區`,
    x: shoePt.x,
    z: shoePt.z,
  });
  const bagPt = backpack ?? sketch.backpack;
  stops.push({
    id: "backpack",
    name: backpack?.name || "背包區",
    prompt: `背包放到${sideOf(project, bagPt.x)}背包區`,
    x: bagPt.x,
    z: bagPt.z,
  });
  stops.push({
    id: "mats",
    name: "地墊區",
    prompt: "最後進入中央青綠色地墊區",
    x: mats.x,
    z: mats.z,
  });
  const teacherPt = teacher ?? sketch.teacher;
  stops.push({
    id: "teacher",
    name: teacher?.name || "講師區",
    prompt: "前方是講師區",
    x: teacherPt.x,
    z: teacherPt.z,
  });
  const lifePt = life ?? sketch.life;
  stops.push({
    id: "life",
    name: life?.name || "生活組區",
    prompt: "工作人員在生活組區",
    x: lifePt.x,
    z: lifePt.z,
  });
  return stops;
}

export function freshmanLayoutPins(project: Project, stepIndex = 0): FreshmanLayoutPins {
  const journey = freshmanJourney(project);
  const i = clampStep(stepIndex, journey.length);
  const here = journey[i] ?? journey[0];
  const next = journey[i + 1] ?? null;
  return {
    youAreHere: { x: here.x, z: here.z, label: "你在這裡" },
    nextStop: next ? { x: next.x, z: next.z, label: `下一站 ${next.name}` } : null,
    entrance: journey[0] ? { x: journey[0].x, z: journey[0].z, label: "入口" } : null,
  };
}

export function freshmanLayoutView(project: Project, stepIndex = 0): FreshmanLayoutView {
  const pins = freshmanLayoutPins(project, stepIndex);
  const journey = freshmanJourney(project);
  const i = clampStep(stepIndex, journey.length);
  const path = journey.slice(0, Math.min(journey.length, i + 2)).map((stop, index) => ({
    x: stop.x,
    z: stop.z,
    index: index + 1,
  }));
  return {
    pins,
    path,
    zones: freshmanZoneHints(project),
    screenBar: {
      x: project.classroom.x + project.classroom.length / 2,
      z: project.classroom.z + 0.12,
      width: Math.min(project.classroom.length * 0.72, 8),
    },
  };
}

function schematicLayout(project: Project): Record<"entrance" | "checkin" | "shoe" | "backpack" | "mats" | "teacher" | "life", { x: number; z: number }> {
  const c = project.classroom;
  return {
    entrance: { x: c.x + c.length * 0.82, z: c.z + c.width - 0.25 },
    checkin: { x: c.x + c.length * 0.22, z: c.z + c.width - 1.15 },
    shoe: { x: c.x + c.length * 0.84, z: c.z + c.width * 0.62 },
    backpack: { x: c.x + c.length * 0.88, z: c.z + c.width * 0.42 },
    mats: { x: c.x + c.length / 2, z: c.z + c.width * 0.48 },
    teacher: { x: c.x + c.length / 2, z: c.z + 1.05 },
    life: { x: c.x + c.length * 0.18, z: c.z + 1.2 },
  };
}

function freshmanZoneHints(project: Project): FreshmanZoneHint[] {
  const sketch = schematicLayout(project);
  const field = project.groups.find((g) => g.sourceKind === "mat");
  const checkin = zoneOf(project, "registration");
  const shoes = project.zones.filter((z) => z.type === "shoe" && !z.hidden);
  const backpack = zoneOf(project, "backpack");
  const teacher = zoneOf(project, "meditation");
  const life = zoneOf(project, "life");
  const hints: FreshmanZoneHint[] = [];
  const push = (id: string, label: string, icon: string, color: string, pt: { x: number; z: number }, w: number, d: number) => {
    hints.push({ id, label, icon, x: pt.x, z: pt.z, width: w, depth: d, color });
  };
  push("checkin", "報到區", "✋", "#38bdf8", checkin ?? sketch.checkin, checkin?.width ?? 1.6, checkin?.depth ?? 0.9);
  if (shoes.length) {
    for (const z of shoes) {
      push(z.id, z.name || "鞋子區", "👟", "#eab308", z, z.width, z.depth);
    }
  } else {
    push("shoe", "鞋子區", "👟", "#eab308", sketch.shoe, 0.8, 2.2);
  }
  push("backpack", "背包區", "🎒", "#fb7185", backpack ?? sketch.backpack, backpack?.width ?? 1.1, backpack?.depth ?? 2.4);
  if (field) {
    push("mats", "地墊區", "", "#14b8a6", {
      x: field.anchorX + (field.cols * field.itemWidth) / 2,
      z: field.anchorZ + (field.rows * field.itemDepth) / 2,
    }, field.cols * field.itemWidth, field.rows * field.itemDepth);
  } else {
    push("mats", "地墊區", "", "#14b8a6", sketch.mats, project.classroom.length * 0.42, project.classroom.width * 0.36);
  }
  push("teacher", "講師區", "🎤", "#a78bfa", teacher ?? sketch.teacher, teacher?.width ?? 2.4, teacher?.depth ?? 1.1);
  push("life", "生活組區", "🧺", "#f97316", life ?? sketch.life, life?.width ?? 1.4, life?.depth ?? 1.1);
  return hints;
}

export function freshmanStageCopy(stage: FreshmanStage, project: Project): string {
  const b = freshmanBriefing(project, 0);
  if (stage === "campus") return b.where;
  if (stage === "building") return b.howToRoom;
  if (stage === "classroom") return `${b.howToRoom}。${b.entrance}`;
  return b.howLaidOut;
}

function layoutSentence(): string {
  return "教室怎麼擺：前方是投影幕，入口附近是報到區，兩側是鞋子與背包，中間是青綠色地墊";
}

function zoneOf(project: Project, type: ZoneType): Zone | undefined {
  return project.zones.find((z) => z.type === type && !z.hidden);
}

function nearestZone(project: Project, type: ZoneType, x: number): Zone | undefined {
  const zones = project.zones.filter((z) => z.type === type && !z.hidden);
  if (!zones.length) return undefined;
  return zones.reduce((best, z) => Math.abs(z.x - x) < Math.abs(best.x - x) ? z : best);
}

function matCenter(project: Project): { x: number; z: number } | null {
  const field = project.groups.find((g) => g.sourceKind === "mat");
  if (field) {
    return {
      x: field.anchorX + (field.cols * field.itemWidth) / 2,
      z: field.anchorZ + (field.rows * field.itemDepth) / 2,
    };
  }
  const mat = project.objects.find((o) => o.kind === "mat" && !o.hidden);
  return mat ? { x: mat.x, z: mat.z } : null;
}

/**
 * From the rear door looking toward the screen (smaller Z), left is smaller X.
 */
function sideOf(project: Project, x: number): string {
  const mid = project.classroom.x + project.classroom.length / 2;
  if (Math.abs(x - mid) < 0.6) return "中間的";
  return x < mid ? "左側" : "右側";
}

function doorPhrase(entrance: string): string {
  const hint = entrance.replace(" · 入口待現場確認", "").replace("入口待現場確認", "").trim();
  if (!hint) return "教室後側入口";
  return hint.includes("入口") ? hint : `${hint}入口`;
}

function clampStep(i: number, n: number): number {
  if (n <= 0) return 0;
  return Math.min(n - 1, Math.max(0, i));
}

function assertPlain(b: FreshmanBriefing): void {
  const text = [
    b.headline, b.where, b.howToRoom, b.howLaidOut, b.youAre, b.next, b.entrance,
    ...b.steps.map((s) => s.text),
  ].join(" ");
  if (FRESHMAN_ENGINEERING.test(text)) {
    throw new Error("freshman copy leaked engineering vocabulary");
  }
}
