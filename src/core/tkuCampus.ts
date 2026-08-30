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
  note: string;
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

export function featuredTkuPlaces(): TkuPlace[] {
  const order = ["E308", "E310", "SG320", "SG109", "scroll-plaza"];
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
