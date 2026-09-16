/**
 * Campus-map helpers that do not touch Leaflet.
 *
 * Public building coordinates are "樓館位置". Indoor room pins are never
 * invented. Label collision is solved in screen space so overlapping names
 * do not cover the current venue.
 */

import {
  TKU_BUILDINGS,
  buildingByCode,
  campusById,
  campusRefFromPlace,
  featuredTkuBuildings,
  formatFreshmanHeadline,
  googleMapsNavUrl,
  osmLocationUrl,
  placeById,
  type TkuBuilding,
  type TkuCampusId,
  type TkuPlace,
  type TkuSearchHit,
} from "./tkuCampus";

export const OSM_ATTRIBUTION = "© OpenStreetMap contributors";
export const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export type MapMarkerWeight = "current" | "related" | "dim";

export interface CampusMapView {
  campusId: TkuCampusId;
  lat: number;
  lng: number;
  zoom: number;
}

export interface CampusMapPin {
  code: string;
  name: string;
  lat: number;
  lng: number;
  campusId: TkuCampusId;
  weight: MapMarkerWeight;
  /** Always 樓館位置 — never a surveyed room pin. */
  pinKind: "building";
}

export interface MapLabelCandidate {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  priority: number;
}

export function campusMapView(campusId: TkuCampusId): CampusMapView | null {
  if (campusId === "cyber") return null;
  const campus = campusById(campusId);
  if (campus?.lat == null || campus.lng == null) return null;
  return {
    campusId,
    lat: campus.lat,
    lng: campus.lng,
    zoom: campus.defaultZoom ?? 16,
  };
}

export function buildingMapPin(
  building: TkuBuilding,
  currentCode?: string,
): CampusMapPin | null {
  if (building.lat == null || building.lng == null) return null;
  return {
    code: building.code,
    name: building.name,
    lat: building.lat,
    lng: building.lng,
    campusId: building.campusId,
    weight: markerWeight(building.code, currentCode),
    pinKind: "building",
  };
}

export function pinsForCampus(campusId: TkuCampusId, currentCode?: string): CampusMapPin[] {
  return TKU_BUILDINGS
    .filter((b) => b.campusId === campusId)
    .map((b) => buildingMapPin(b, currentCode))
    .filter((p): p is CampusMapPin => !!p);
}

export function markerWeight(code: string, currentCode?: string): MapMarkerWeight {
  if (currentCode && code === currentCode) return "current";
  if (featuredTkuBuildings().some((b) => b.code === code)) return "related";
  return "dim";
}

export function focusPinForPlace(place: TkuPlace): CampusMapPin | null {
  if (!place.buildingCode) return null;
  const building = buildingByCode(place.buildingCode);
  return building ? buildingMapPin(building, building.code) : null;
}

export function placeNavLinks(place: TkuPlace): { google: string; osm: string | null; query: string } {
  const building = place.buildingCode ? buildingByCode(place.buildingCode) : undefined;
  const campus = campusById(place.campusId);
  const query = [campus?.name, building?.name, place.name].filter(Boolean).join(" ");
  const lat = building?.lat ?? campus?.lat;
  const lng = building?.lng ?? campus?.lng;
  return {
    google: googleMapsNavUrl({ lat, lng, query }),
    osm: osmLocationUrl({ lat, lng }),
    query,
  };
}

export function buildingNavLinks(building: TkuBuilding): { google: string; osm: string | null; query: string } {
  const campus = campusById(building.campusId);
  const query = `${campus?.name ?? "淡江大學"} ${building.name}`;
  return {
    google: googleMapsNavUrl({ lat: building.lat, lng: building.lng, query }),
    osm: osmLocationUrl({ lat: building.lat, lng: building.lng }),
    query,
  };
}

/**
 * Greedy non-overlap: keep the current venue, then featured labels, then
 * drop anything that collides. Used both by the Leaflet overlay and the
 * offline schematic so the two surfaces agree.
 */
export function pickNonOverlappingMapLabels(
  candidates: readonly MapLabelCandidate[],
): Set<string> {
  const visible = new Set<string>();
  const accepted: MapLabelCandidate[] = [];
  const ordered = [...candidates].sort((a, b) => a.priority - b.priority);
  const overlaps = (a: MapLabelCandidate, b: MapLabelCandidate) =>
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  for (const candidate of ordered) {
    if (accepted.some((other) => overlaps(candidate, other))) continue;
    accepted.push(candidate);
    visible.add(candidate.id);
  }
  return visible;
}

export function entranceStatusText(place: TkuPlace): string {
  const hint = place.entranceHint ?? "入口方向依現場指示";
  if (place.entranceVerified) return hint;
  return `${hint}（入口待現場確認）`;
}

export function placeHeadline(place: TkuPlace): string {
  return formatFreshmanHeadline(campusRefFromPlace(place));
}

export function searchHitFocus(hit: TkuSearchHit): { campusId: TkuCampusId; buildingCode?: string; place?: TkuPlace } {
  const place = hit.placeId ? placeById(hit.placeId) : undefined;
  return {
    campusId: hit.campusId,
    buildingCode: hit.buildingCode,
    place,
  };
}
