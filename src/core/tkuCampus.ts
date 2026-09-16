/**
 * Tamkang University campus directory.
 *
 * This is a map *index*, not a surveyed floor plan. Room dimensions are not
 * here — those live on VenuePreset and stay labelled 待現場校正.
 *
 * Sources: docs/field-research/TKU_CAMPUS_MAP.md
 */

import {
  TKU_CAMPUSES as _CAMPUSES,
  TKU_COLLEGES as _COLLEGES,
  TKU_SG_FLOORS as _SG,
  TKU_LIBRARY_FLOORS as _LIB,
  TKU_TAIPEI_ROOM_CODES as _TP,
  TKU_BUILDINGS as _BUILDINGS,
  TKU_MAP_LINKS as _LINKS,
} from "./tkuCampusMeta";
import { TKU_PLACES as _PLACES } from "./tkuPlaces";

export type TkuCampusId = "tamsui" | "taipei" | "lanyang" | "cyber";

export type TkuBuildingKind =
  | "academic"
  | "admin"
  | "dorm"
  | "sport"
  | "landmark"
  | "service"
  | "campus"
  | "hall";

export type TkuPlaceKind = "classroom" | "office" | "plaza" | "hall" | "generic" | "outdoor";

export interface TkuCampus {
  id: TkuCampusId;
  name: string;
  nameEn: string;
  officialCode?: string;
  address?: string;
  phone?: string;
  fax?: string;
  url?: string;
  hectares?: number;
  note: string;
}

export interface TkuCollege {
  id: string;
  name: string;
  nameEn: string;
  campusId: TkuCampusId;
  buildingCodes: string[];
  note: string;
}

export interface TkuFloorUse {
  buildingCode: string;
  floor: number;
  label: string;
  note: string;
}

export interface TkuBuilding {
  code: string;
  name: string;
  nameEn: string;
  campusId: TkuCampusId;
  kind: TkuBuildingKind;
  aliases?: string[];
  note?: string;
  lat?: number;
  lng?: number;
  osmWay?: number;
}

export interface TkuPlace {
  id: string;
  campusId: TkuCampusId;
  buildingCode?: string;
  floor?: number;
  room?: string;
  name: string;
  kind: TkuPlaceKind;
  venuePresetId: string;
  aliases?: string[];
  clubUse?: "primary" | "frequent" | "office" | "outdoor" | "fallback";
  mentionCount?: number;
  publishedCapacity?: number;
  /**
   * Indoor entrance on the campus map. Unsurveyed doors stay `pending` —
   * the UI must say 「入口待現場確認」 instead of inventing a pin.
   */
  entranceStatus?: "surveyed" | "pending";
  entranceHint?: string;
  note: string;
}

export type TkuSearchKind = "campus" | "building" | "place";

export interface TkuSearchHit {
  kind: TkuSearchKind;
  id: string;
  title: string;
  subtitle: string;
  campusId: TkuCampusId;
  buildingCode?: string;
  placeId?: string;
  score: number;
}

export interface TkuMapLink {
  title: string;
  url: string;
  kind: "official" | "index" | "floorplan" | "photo";
  campusId?: TkuCampusId;
}

export interface TkuCampusRef {
  campusId: TkuCampusId;
  buildingCode?: string;
  floor?: number;
  room?: string;
  placeId?: string;
}

export const TKU_CAMPUSES = _CAMPUSES;
export const TKU_COLLEGES = _COLLEGES;
export const TKU_SG_FLOORS = _SG;
export const TKU_LIBRARY_FLOORS = _LIB;
export const TKU_TAIPEI_ROOM_CODES = _TP;
export const TKU_BUILDINGS = _BUILDINGS;
export const TKU_PLACES = _PLACES;
export const TKU_MAP_LINKS = _LINKS;

export function campusById(id: TkuCampusId): TkuCampus | undefined {
  return TKU_CAMPUSES.find((c) => c.id === id);
}

export function buildingByCode(code: string): TkuBuilding | undefined {
  const key = code.trim().toUpperCase();
  return TKU_BUILDINGS.find((b) => b.code === key);
}

export function placeById(id: string): TkuPlace | undefined {
  return TKU_PLACES.find((p) => p.id === id);
}

export function parseTkuRoomCode(raw: string): {
  code: string;
  buildingCode: string;
  floor: number;
  room: string;
} | null {
  const t = raw.trim().toUpperCase();
  const m = t.match(/^([A-Z]{1,2})(\d)(\d{2}[A-Z]?)$/);
  if (!m) return null;
  return { code: `${m[1]}${m[2]}${m[3]}`, buildingCode: m[1], floor: Number(m[2]), room: m[3] };
}

function norm(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

export function findTkuPlace(query: string): TkuPlace | null {
  const q = query.trim();
  if (!q) return null;
  const exact = TKU_PLACES.find((p) => p.id.toUpperCase() === q.toUpperCase());
  if (exact) return exact;

  const parsed = parseTkuRoomCode(q);
  if (parsed) {
    const byCode = TKU_PLACES.find((p) => p.id.toUpperCase() === parsed.code);
    if (byCode) return byCode;
    const building = buildingByCode(parsed.buildingCode);
    if (building?.campusId === "taipei") return placeById("taipei-generic") ?? null;
    if (building?.campusId === "lanyang") return placeById("lanyang-generic") ?? null;
    const buildingGeneric = TKU_PLACES.find(
      (p) => p.kind === "generic" && p.buildingCode === parsed.buildingCode,
    );
    if (buildingGeneric) return buildingGeneric;
    return placeById("tku-generic") ?? null;
  }

  const n = norm(q);
  for (const p of TKU_PLACES) {
    if (norm(p.name) === n) return p;
    if (p.aliases?.some((a) => norm(a) === n)) return p;
  }
  for (const p of TKU_PLACES) {
    if (p.aliases?.some((a) => n.includes(norm(a)) || norm(a).includes(n))) return p;
    if (n.includes(norm(p.name)) || norm(p.name).includes(n)) return p;
  }
  return null;
}

/**
 * Pick a place out of a whole sentence (「幫我排 E308 的 40 人社課」).
 * Room codes win; then the longest non-generic name / alias.
 */
export function findTkuPlaceInText(query: string): { place: TkuPlace; evidence: string } | null {
  const q = query.trim();
  if (!q) return null;

  const codes = q.match(/[A-Za-z]{1,2}\d\d{2}[A-Za-z]?/g) ?? [];
  for (const raw of codes) {
    const parsed = parseTkuRoomCode(raw);
    if (!parsed) continue;
    const exact = TKU_PLACES.find((p) => p.id.toUpperCase() === parsed.code);
    if (exact) return { place: exact, evidence: raw };
  }

  const named = [...TKU_PLACES].sort((a, b) => {
    const ga = a.kind === "generic" ? 1 : 0;
    const gb = b.kind === "generic" ? 1 : 0;
    if (ga !== gb) return ga - gb;
    return b.name.length - a.name.length;
  });
  const compact = q.replace(/\s+/g, "");
  for (const p of named) {
    const needles = [p.name, ...(p.aliases ?? [])];
    for (const needle of needles) {
      const nn = needle.replace(/\s+/g, "");
      if (nn.length < 2) continue;
      if (/^[A-Za-z0-9]+$/.test(nn) && nn.length < 4) continue;
      if (compact.includes(nn) || q.includes(needle)) {
        return { place: p, evidence: needle };
      }
    }
  }

  for (const raw of codes) {
    const hit = findTkuPlace(raw);
    if (hit) return { place: hit, evidence: raw };
  }
  return null;
}

export function featuredTkuPlaces(): TkuPlace[] {
  const order = ["E308", "E305", "E310", "SG320", "SG109", "scroll-plaza"];
  return order.map(placeById).filter((p): p is TkuPlace => !!p);
}

export function placesInBuilding(code: string): TkuPlace[] {
  return TKU_PLACES.filter((p) => p.buildingCode === code.toUpperCase());
}

export function buildingsByCampus(id: TkuCampusId): TkuBuilding[] {
  return TKU_BUILDINGS.filter((b) => b.campusId === id);
}

export function featuredTkuBuildings(): TkuBuilding[] {
  const order = ["E", "SG", "T", "I", "H", "HC", "B", "L", "FL", "U", "R", "M", "P", "GB", "Z", "CH", "D", "CL", "LH", "SA"];
  return order.map(buildingByCode).filter((b): b is TkuBuilding => !!b);
}

export function placesByCampus(id: TkuCampusId): TkuPlace[] {
  return TKU_PLACES.filter((p) => p.campusId === id);
}

export function placesWithPublishedCapacity(): TkuPlace[] {
  return TKU_PLACES.filter((p) => p.publishedCapacity != null);
}

export function formatPlaceLabel(place: TkuPlace): string {
  const b = place.buildingCode ? buildingByCode(place.buildingCode) : undefined;
  const where = [b?.name, place.floor != null ? `${place.floor}F` : null].filter(Boolean).join(" ");
  return where ? `${place.name}（${where}）` : place.name;
}

export function formatCampusLine(ref: TkuCampusRef): string {
  const campus = campusById(ref.campusId);
  const building = ref.buildingCode ? buildingByCode(ref.buildingCode) : undefined;
  const bits = [
    campus?.name,
    building ? `${building.code} ${building.name}` : ref.buildingCode,
    ref.floor != null ? `${ref.floor}F` : null,
    ref.room ? `室 ${ref.room}` : null,
  ].filter(Boolean);
  return bits.join(" · ");
}

function scoreNeedle(hay: string, needle: string): number {
  if (!needle) return 0;
  if (hay === needle) return 100;
  if (hay.startsWith(needle)) return 80;
  if (hay.includes(needle)) return 50;
  return 0;
}

/**
 * Search campuses, buildings and classrooms. Room codes win (E305 vs D305).
 * Building coordinates are never implied by a classroom hit.
 */
export function searchTkuDirectory(query: string): TkuSearchHit[] {
  const q = query.trim();
  if (!q) return [];
  const n = norm(q);
  const hits: TkuSearchHit[] = [];

  const parsed = parseTkuRoomCode(q);
  if (parsed) {
    const exact = TKU_PLACES.find((p) => p.id.toUpperCase() === parsed.code);
    if (exact) {
      hits.push(placeHit(exact, 200));
    } else {
      const fallback = findTkuPlace(parsed.code);
      if (fallback) hits.push(placeHit(fallback, 120));
    }
  }

  for (const campus of TKU_CAMPUSES) {
    if (campus.id === "cyber") continue;
    const s = Math.max(scoreNeedle(norm(campus.name), n), scoreNeedle(norm(campus.nameEn), n), scoreNeedle(campus.id, n));
    if (s) {
      hits.push({
        kind: "campus",
        id: `campus:${campus.id}`,
        title: campus.name,
        subtitle: campus.address ?? campus.note,
        campusId: campus.id,
        score: s + 10,
      });
    }
  }

  for (const b of TKU_BUILDINGS) {
    const needles = [b.code, b.name, b.nameEn, ...(b.aliases ?? [])];
    let s = 0;
    for (const needle of needles) s = Math.max(s, scoreNeedle(norm(needle), n));
    if (b.code.toUpperCase() === q.toUpperCase()) s = Math.max(s, 160);
    if (s) {
      hits.push({
        kind: "building",
        id: `b:${b.code}`,
        title: `${b.code} ${b.name}`,
        subtitle: campusById(b.campusId)?.name ?? "",
        campusId: b.campusId,
        buildingCode: b.code,
        score: s,
      });
    }
  }

  for (const p of TKU_PLACES) {
    if (hits.some((h) => h.kind === "place" && h.placeId === p.id)) continue;
    const needles = [p.id, p.name, ...(p.aliases ?? [])];
    let s = 0;
    for (const needle of needles) s = Math.max(s, scoreNeedle(norm(needle), n));
    if (s) hits.push(placeHit(p, s));
  }

  hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "zh-Hant"));
  const seen = new Set<string>();
  return hits.filter((h) => {
    if (seen.has(h.id)) return false;
    seen.add(h.id);
    return true;
  }).slice(0, 24);
}

function placeHit(p: TkuPlace, score: number): TkuSearchHit {
  const b = p.buildingCode ? buildingByCode(p.buildingCode) : undefined;
  const floor = p.floor != null ? `${p.floor}F` : null;
  return {
    kind: "place",
    id: `p:${p.id}`,
    title: p.id.match(/^[A-Z]{1,2}\d/) ? `${p.id} ${p.name.replace(p.id, "").trim()}`.trim() : p.name,
    subtitle: [campusById(p.campusId)?.name, b?.name, floor].filter(Boolean).join(" · "),
    campusId: p.campusId,
    buildingCode: p.buildingCode,
    placeId: p.id,
    score,
  };
}

export function uniquePlaceForVenuePreset(venuePresetId: string | undefined): TkuPlace | undefined {
  if (venuePresetId === "venue:tku-e310") return placeById("E310");
  if (venuePresetId === "venue:tku-e305") return placeById("E305");
  return undefined;
}

export function campusRefFromPlace(place: TkuPlace): TkuCampusRef {
  return {
    campusId: place.campusId,
    buildingCode: place.buildingCode,
    floor: place.floor,
    room: place.room,
    placeId: place.id,
  };
}
