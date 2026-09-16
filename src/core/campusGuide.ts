/**
 * Tamkang campus location helpers for the freshman map.
 *
 * This is an index over public campus / building coordinates, not a surveyed
 * indoor plan. Room codes never get a lat/lng. Building pins are labelled
 * 「樓館位置」; campus pins are 「校園位置」.
 */

import {
  TKU_BUILDINGS,
  TKU_CAMPUSES,
  buildingByCode,
  campusById,
  featuredTkuBuildings,
  findTkuPlace,
  parseTkuRoomCode,
  placeById,
  type TkuBuilding,
  type TkuCampus,
  type TkuCampusId,
  type TkuPlace,
} from "./tkuCampus";
import type { Project } from "./model";

export const PHYSICAL_CAMPUSES: TkuCampusId[] = ["tamsui", "taipei", "lanyang"];

export interface GeoPoint {
  lat: number;
  lng: number;
  /** Never "room" — we do not invent indoor coordinates. */
  precision: "campus" | "building";
  label: string;
}

/**
 * Campus-level anchors taken from published building coordinates
 * (Wikidata / OSM), not from a field survey.
 */
export const CAMPUS_ANCHORS: Record<Exclude<TkuCampusId, "cyber">, GeoPoint> = {
  tamsui: { lat: 25.1755, lng: 121.4504, precision: "campus", label: "校園位置" },
  taipei: { lat: 25.03111, lng: 121.52861, precision: "campus", label: "校園位置" },
  lanyang: { lat: 24.82278, lng: 121.72941, precision: "campus", label: "校園位置" },
};

export function campusAnchor(id: TkuCampusId): GeoPoint | null {
  if (id === "cyber") return null;
  return CAMPUS_ANCHORS[id];
}

export function buildingLocation(building: TkuBuilding): GeoPoint | null {
  if (building.lat == null || building.lng == null) return null;
  return {
    lat: building.lat,
    lng: building.lng,
    precision: "building",
    label: "樓館位置",
  };
}

export function googleMapsUrl(point: GeoPoint, name: string): string {
  const q = encodeURIComponent(`${point.lat},${point.lng} (${name})`);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

export function osmUrl(point: GeoPoint): string {
  const z = point.precision === "campus" ? 16 : 18;
  return `https://www.openstreetmap.org/?mlat=${point.lat}&mlon=${point.lng}#map=${z}/${point.lat}/${point.lng}`;
}

export interface DirectoryHit {
  kind: "campus" | "building" | "place";
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

export function searchTkuDirectory(query: string): DirectoryHit[] {
  const raw = query.trim();
  if (!raw) return [];
  const q = compact(raw);
  const hits: DirectoryHit[] = [];
  const seen = new Set<string>();
  const push = (hit: DirectoryHit) => {
    const key = `${hit.kind}:${hit.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push(hit);
  };

  for (const campus of TKU_CAMPUSES) {
    if (campus.id === "cyber") continue;
    const names = [campus.name, campus.nameEn, campus.officialCode ?? ""];
    if (names.some((n) => n && compact(n) === q)) {
      push({
        kind: "campus",
        id: campus.id,
        title: campus.name,
        subtitle: campus.address ?? campus.note,
        campusId: campus.id,
        score: 95,
      });
    } else if (names.some((n) => n && compact(n).includes(q))) {
      push({
        kind: "campus",
        id: campus.id,
        title: campus.name,
        subtitle: campus.address ?? campus.note,
        campusId: campus.id,
        score: 60,
      });
    }
  }

  const parsed = parseTkuRoomCode(raw);
  if (parsed) {
    const exact = findTkuPlace(parsed.code);
    if (exact && exact.id.toUpperCase() === parsed.code) {
      push(placeHit(exact, 100));
    } else if (exact) {
      push(placeHit(exact, 80));
    }
    const building = buildingByCode(parsed.buildingCode);
    if (building) push(buildingHit(building, 88));
  }

  for (const building of TKU_BUILDINGS) {
    const names = [building.code, building.name, building.nameEn, ...(building.aliases ?? [])];
    if (names.some((n) => compact(n) === q)) push(buildingHit(building, 90));
    else if (q.length >= 2 && names.some((n) => compact(n).includes(q) || q.includes(compact(n)))) {
      push(buildingHit(building, 55));
    }
  }

  const place = findTkuPlace(raw);
  if (place) push(placeHit(place, place.id.toUpperCase() === raw.toUpperCase() ? 100 : 70));

  hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "zh-Hant"));
  return hits.slice(0, 24);
}

function buildingHit(building: TkuBuilding, score: number): DirectoryHit {
  const campus = campusById(building.campusId);
  return {
    kind: "building",
    id: building.code,
    title: `${building.code} ${building.name}`,
    subtitle: campus?.name ?? "",
    campusId: building.campusId,
    buildingCode: building.code,
    score,
  };
}

function placeHit(place: TkuPlace, score: number): DirectoryHit {
  const building = place.buildingCode ? buildingByCode(place.buildingCode) : undefined;
  const where = [campusById(place.campusId)?.name, building?.name, place.floor != null ? `${place.floor}F` : null]
    .filter(Boolean)
    .join(" · ");
  return {
    kind: "place",
    id: place.id,
    title: place.name,
    subtitle: where,
    campusId: place.campusId,
    buildingCode: place.buildingCode,
    placeId: place.id,
    score,
  };
}

export function formatFreshmanHeadline(place: TkuPlace | null): string {
  if (!place) return "淡江大學";
  const campus = campusById(place.campusId);
  const building = place.buildingCode ? buildingByCode(place.buildingCode) : undefined;
  const room = place.buildingCode && place.floor != null && place.room
    ? `${place.buildingCode}${place.floor}${place.room}`
    : place.kind === "classroom" || place.kind === "office"
      ? place.name
      : null;
  const bits = [
    "淡江大學",
    campus?.name,
    building?.name,
    room,
    place.floor != null ? `${place.floor}F` : null,
  ].filter((bit, i, arr) => bit && arr.indexOf(bit) === i);
  return bits.join(" · ");
}

export interface EntranceHint {
  text: string;
  pending: boolean;
}

/**
 * Outdoor / corridor approach is not surveyed. Indoor door topology for E310
 * comes from photographs (rear door to the corridor) and is still not a GPS pin.
 */
export function entranceHint(place: TkuPlace | null): EntranceHint {
  if (!place) return { text: "入口待現場確認", pending: true };
  if (place.id === "E310") {
    return {
      text: "請從教室後側入口進入。樓館入口方位待現場確認。",
      pending: true,
    };
  }
  if (place.buildingCode === "B") {
    return { text: "商管大樓門口進去是 3 樓。教室入口待現場確認。", pending: true };
  }
  return { text: "入口待現場確認", pending: true };
}

export function resolveProjectPlace(project: Project): TkuPlace | null {
  if (project.placeId) {
    const named = placeById(project.placeId);
    if (named) return named;
  }
  if (project.venuePresetId === "venue:tku-e310") return placeById("E310") ?? null;
  if (project.venuePresetId === "venue:tku-e305") return placeById("E305") ?? null;
  return placeById("tku-generic") ?? null;
}

export interface MapPin {
  id: string;
  kind: "campus" | "building";
  campusId: TkuCampusId;
  buildingCode?: string;
  name: string;
  shortLabel: string;
  lat: number;
  lng: number;
  precision: "campus" | "building";
  weight: "active" | "related" | "muted";
  priority: 0 | 1 | 2;
}

export function campusMapPins(opts: {
  campusId: TkuCampusId;
  activeBuildingCode?: string;
}): MapPin[] {
  if (opts.campusId === "cyber") return [];
  const featured = new Set(featuredTkuBuildings().map((b) => b.code));
  const pins: MapPin[] = [];
  const anchor = campusAnchor(opts.campusId);
  if (anchor) {
    const campus = campusById(opts.campusId);
    pins.push({
      id: `campus:${opts.campusId}`,
      kind: "campus",
      campusId: opts.campusId,
      name: campus?.name ?? opts.campusId,
      shortLabel: campus?.name ?? "校園",
      lat: anchor.lat,
      lng: anchor.lng,
      precision: "campus",
      weight: opts.activeBuildingCode ? "muted" : "active",
      priority: opts.activeBuildingCode ? 2 : 0,
    });
  }
  for (const building of TKU_BUILDINGS.filter((b) => b.campusId === opts.campusId)) {
    const loc = buildingLocation(building);
    if (!loc) continue;
    const active = opts.activeBuildingCode === building.code;
    pins.push({
      id: `building:${building.code}`,
      kind: "building",
      campusId: building.campusId,
      buildingCode: building.code,
      name: building.name,
      shortLabel: `${building.code} ${building.name}`,
      lat: loc.lat,
      lng: loc.lng,
      precision: "building",
      weight: active ? "active" : featured.has(building.code) ? "related" : "muted",
      priority: active ? 0 : featured.has(building.code) ? 1 : 2,
    });
  }
  return pins;
}

export function campusBounds(id: TkuCampusId): { south: number; west: number; north: number; east: number } | null {
  const pins = campusMapPins({ campusId: id });
  if (!pins.length) {
    const anchor = campusAnchor(id);
    if (!anchor) return null;
    return {
      south: anchor.lat - 0.004,
      west: anchor.lng - 0.004,
      north: anchor.lat + 0.004,
      east: anchor.lng + 0.004,
    };
  }
  const lats = pins.map((p) => p.lat);
  const lngs = pins.map((p) => p.lng);
  const pad = id === "tamsui" ? 0.0018 : 0.0024;
  return {
    south: Math.min(...lats) - pad,
    west: Math.min(...lngs) - pad,
    north: Math.max(...lats) + pad,
    east: Math.max(...lngs) + pad,
  };
}

export function activeCampusOf(place: TkuPlace | null, fallback: TkuCampusId = "tamsui"): TkuCampusId {
  if (place && place.campusId !== "cyber") return place.campusId;
  return fallback;
}

export function buildingMissingLocation(code: string): boolean {
  const building = buildingByCode(code);
  return !!building && (building.lat == null || building.lng == null);
}

export function campusByPlace(place: TkuPlace | null): TkuCampus | undefined {
  return place ? campusById(place.campusId) : campusById("tamsui");
}
