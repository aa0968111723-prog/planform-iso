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
  /** Public campus pin — a campus location, never an indoor room. */
  lat?: number;
  lng?: number;
  defaultZoom?: number;
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
  /** Plain-language door hint. Unverified until surveyed on site. */
  entranceHint?: string;
  /** False or missing → UI must say 入口待現場確認. */
  entranceVerified?: boolean;
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

/** Freshman headline: 淡江大學 · 淡水校園 · 工學大樓 · E310 · 3F */
export function formatFreshmanHeadline(ref: TkuCampusRef): string {
  const campus = campusById(ref.campusId);
  const building = ref.buildingCode ? buildingByCode(ref.buildingCode) : undefined;
  const room = ref.room
    ? (ref.buildingCode ? `${ref.buildingCode}${ref.floor ?? ""}${ref.room}` : ref.room)
    : ref.placeId && /^[A-Z]{1,2}\d/.test(ref.placeId)
      ? ref.placeId
      : null;
  const bits = [
    "淡江大學",
    campus?.name,
    building?.name,
    room,
    ref.floor != null ? `${ref.floor}F` : null,
  ].filter(Boolean);
  return bits.join(" · ");
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

function compact(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

/**
 * Ranked directory search for the campus map. Room codes win over fuzzy
 * names so 「E305」 never lands on E310 or 臺北 D305.
 */
export function searchTkuDirectory(query: string, limit = 12): TkuSearchHit[] {
  const q = query.trim();
  if (!q) return [];
  const hits: TkuSearchHit[] = [];
  const parsed = parseTkuRoomCode(q);
  if (parsed) {
    const exact = TKU_PLACES.find((p) => p.id.toUpperCase() === parsed.code);
    if (exact) {
      const building = exact.buildingCode ? buildingByCode(exact.buildingCode) : undefined;
      hits.push({
        kind: "place",
        id: exact.id,
        title: exact.name,
        subtitle: formatCampusLine({
          campusId: exact.campusId,
          buildingCode: exact.buildingCode,
          floor: exact.floor,
          room: exact.room,
          placeId: exact.id,
        }),
        campusId: exact.campusId,
        buildingCode: exact.buildingCode,
        placeId: exact.id,
        score: 100,
      });
      if (building) {
        hits.push({
          kind: "building",
          id: building.code,
          title: `${building.code} ${building.name}`,
          subtitle: campusById(building.campusId)?.name ?? building.nameEn,
          campusId: building.campusId,
          buildingCode: building.code,
          score: 80,
        });
      }
    } else {
      const building = buildingByCode(parsed.buildingCode);
      const place = findTkuPlace(parsed.code);
      if (place) {
        hits.push({
          kind: "place",
          id: place.id,
          title: `${parsed.code} → ${place.name}`,
          subtitle: place.kind === "generic"
            ? `${formatCampusLine({ campusId: place.campusId, buildingCode: place.buildingCode, floor: parsed.floor, room: parsed.room })}（未建檔教室，套用該棟起點）`
            : formatCampusLine({ campusId: place.campusId, buildingCode: place.buildingCode, floor: place.floor, room: place.room, placeId: place.id }),
          campusId: place.campusId,
          buildingCode: place.buildingCode ?? parsed.buildingCode,
          placeId: place.id,
          score: 90,
        });
      }
      if (building) {
        hits.push({
          kind: "building",
          id: building.code,
          title: `${building.code} ${building.name}`,
          subtitle: `${parsed.code} 在這棟樓的 ${parsed.floor}F`,
          campusId: building.campusId,
          buildingCode: building.code,
          score: 70,
        });
      }
    }
  }

  const n = compact(q);
  for (const campus of TKU_CAMPUSES) {
    if (campus.id === "cyber") continue;
    const names = [campus.name, campus.nameEn, campus.officialCode ?? ""];
    if (names.some((name) => compact(name) && (compact(name) === n || compact(name).includes(n) || n.includes(compact(name))))) {
      hits.push({
        kind: "campus",
        id: campus.id,
        title: campus.name,
        subtitle: campus.address ?? campus.note,
        campusId: campus.id,
        score: compact(campus.name) === n ? 95 : 60,
      });
    }
  }

  for (const building of TKU_BUILDINGS) {
    const names = [building.code, building.name, building.nameEn, ...(building.aliases ?? [])];
    const exactCode = building.code === q.trim().toUpperCase();
    const matched = names.some((name) => {
      const nn = compact(name);
      if (!nn) return false;
      return nn === n || nn.includes(n) || n.includes(nn);
    });
    if (!matched) continue;
    hits.push({
      kind: "building",
      id: building.code,
      title: `${building.code} ${building.name}`,
      subtitle: campusById(building.campusId)?.name ?? building.nameEn,
      campusId: building.campusId,
      buildingCode: building.code,
      score: exactCode ? 92 : n.length >= 2 ? 55 : 20,
    });
  }

  for (const place of TKU_PLACES) {
    const names = [place.id, place.name, ...(place.aliases ?? [])];
    const exactId = place.id.toUpperCase() === q.trim().toUpperCase();
    const matched = names.some((name) => {
      const nn = compact(name);
      if (nn.length < 2) return false;
      return nn === n || (n.length >= 2 && (nn.includes(n) || n.includes(nn)));
    });
    if (!matched) continue;
    hits.push({
      kind: "place",
      id: place.id,
      title: place.name,
      subtitle: formatCampusLine({
        campusId: place.campusId,
        buildingCode: place.buildingCode,
        floor: place.floor,
        room: place.room,
        placeId: place.id,
      }),
      campusId: place.campusId,
      buildingCode: place.buildingCode,
      placeId: place.id,
      score: exactId ? 98 : 50,
    });
  }

  const seen = new Set<string>();
  return hits
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "zh-Hant"))
    .filter((hit) => {
      const key = `${hit.kind}:${hit.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

export function placeFromVenuePreset(venuePresetId: string | undefined): TkuPlace | undefined {
  if (!venuePresetId) return undefined;
  if (venuePresetId === "venue:tku-e305") return placeById("E305");
  if (venuePresetId === "venue:tku-e310") return placeById("E310");
  // Shared templates (淡江教室模板、戶外攤位) belong to many places; do not
  // guess a room just because the preset id matches.
  const unique = TKU_PLACES.filter((p) => p.venuePresetId === venuePresetId && p.kind !== "generic");
  return unique.length === 1 ? unique[0] : undefined;
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

export function googleMapsNavUrl(opts: { lat?: number; lng?: number; query: string }): string {
  if (opts.lat != null && opts.lng != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${opts.lat},${opts.lng}&travelmode=walking`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(opts.query)}`;
}

export function osmLocationUrl(opts: { lat?: number; lng?: number }): string | null {
  if (opts.lat == null || opts.lng == null) return null;
  return `https://www.openstreetmap.org/?mlat=${opts.lat}&mlon=${opts.lng}#map=18/${opts.lat}/${opts.lng}`;
}

export function physicalCampuses(): TkuCampus[] {
  return TKU_CAMPUSES.filter((c) => c.id !== "cyber");
}
