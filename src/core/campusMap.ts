/**
 * Campus-map geometry that stays independent of Leaflet.
 *
 * Markers, label collision, fit targets and external navigation URLs live
 * here so a freshman view can still list 淡水／臺北／蘭陽 when tiles fail,
 * and so tests can prove labels do not overlap without spinning up a map.
 *
 * Building lat/lng are published 樓館位置. They are never treated as a room
 * pin or an indoor entrance survey.
 */

import {
  TKU_BUILDINGS,
  buildingByCode,
  campusById,
  parseTkuRoomCode,
  type TkuBuilding,
  type TkuCampusId,
  type TkuCampusRef,
  type TkuPlace,
} from "./tkuCampus";

export const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
export const OSM_ATTRIBUTION_TEXT = "© OpenStreetMap";

export const PHYSICAL_CAMPUSES: TkuCampusId[] = ["tamsui", "taipei", "lanyang"];

export interface MapMarker {
  id: string;
  kind: "campus" | "building";
  campusId: TkuCampusId;
  buildingCode?: string;
  name: string;
  codeLabel: string;
  lat: number;
  lng: number;
  /** Always 「樓館位置」 for a building pin — never a room coordinate. */
  locationKind: "樓館位置" | "校園位置";
  active: boolean;
  featured: boolean;
}

export interface MapLabelBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  priority: 0 | 1 | 2;
}

export interface PlacedMapLabel {
  id: string;
  x: number;
  y: number;
  hidden: boolean;
}

/** Public campus centres derived from published building coordinates only. */
export function campusCenter(id: TkuCampusId): { lat: number; lng: number } | null {
  if (id === "cyber") return null;
  const pts = TKU_BUILDINGS.filter((b) => b.campusId === id && hasCoords(b));
  if (!pts.length) return null;
  const lat = pts.reduce((s, b) => s + b.lat!, 0) / pts.length;
  const lng = pts.reduce((s, b) => s + b.lng!, 0) / pts.length;
  return { lat, lng };
}

export function hasCoords(b: Pick<TkuBuilding, "lat" | "lng">): boolean {
  return typeof b.lat === "number" && typeof b.lng === "number";
}

export function googleMapsUrl(lat: number, lng: number, label?: string): string {
  const q = label ? encodeURIComponent(label) : `${lat},${lng}`;
  return `https://www.google.com/maps?q=${lat},${lng}(${q})`;
}

export function osmUrl(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
}

export function buildingLocationCaption(): string {
  return "樓館位置";
}

export function mapMarkersForCampus(
  campusId: TkuCampusId,
  active?: { buildingCode?: string; placeId?: string },
): MapMarker[] {
  const featured = new Set(["E", "SG", "T", "I", "H", "HC", "B", "L", "FL", "U", "R", "M", "D", "CL", "LH", "SA"]);
  const activeCode = active?.buildingCode?.toUpperCase();
  const out: MapMarker[] = [];
  for (const b of TKU_BUILDINGS) {
    if (b.campusId !== campusId || !hasCoords(b)) continue;
    out.push({
      id: `b:${b.code}`,
      kind: "building",
      campusId: b.campusId,
      buildingCode: b.code,
      name: b.name,
      codeLabel: b.code,
      lat: b.lat!,
      lng: b.lng!,
      locationKind: "樓館位置",
      active: activeCode === b.code,
      featured: featured.has(b.code) || activeCode === b.code,
    });
  }
  return out;
}

/**
 * Keep labels off each other. Active (P0) labels never hide. Others shift a
 * few steps, then drop if they still collide. Pixel space, not lat/lng, so
 * the test does not need a map library.
 */
export function layoutMapLabels(
  boxes: readonly MapLabelBox[],
  viewport: { width: number; height: number },
  maxVisible = 14,
): PlacedMapLabel[] {
  const placed: PlacedMapLabel[] = [];
  const accepted: { x: number; y: number; width: number; height: number }[] = [];
  const ordered = boxes
    .map((b, order) => ({ b, order }))
    .sort((a, b) => a.b.priority - b.b.priority || a.order - b.order);

  const collides = (rect: { x: number; y: number; width: number; height: number }) =>
    accepted.some((o) =>
      rect.x < o.x + o.width && rect.x + rect.width > o.x
      && rect.y < o.y + o.height && rect.y + rect.height > o.y);

  for (const { b } of ordered) {
    const shifts = [0, -22, 22, -44, 44, 28, -28];
    let chosen: { x: number; y: number } | null = null;
    for (const dy of shifts) {
      for (const dx of [0, 18, -18, 32, -32]) {
        const x = clamp(b.x + dx, 4, Math.max(4, viewport.width - b.width - 4));
        const y = clamp(b.y + dy, 4, Math.max(4, viewport.height - b.height - 4));
        const rect = { x, y, width: b.width, height: b.height };
        if (!collides(rect)) {
          chosen = { x, y };
          break;
        }
      }
      if (chosen) break;
    }
    const keep = b.priority === 0 || (chosen && accepted.length < maxVisible);
    if (chosen && keep) {
      placed.push({ id: b.id, x: chosen.x, y: chosen.y, hidden: false });
      accepted.push({ x: chosen.x, y: chosen.y, width: b.width, height: b.height });
    } else {
      placed.push({ id: b.id, x: b.x, y: b.y, hidden: b.priority !== 0 });
      if (b.priority === 0) {
        accepted.push({ x: b.x, y: b.y, width: b.width, height: b.height });
      }
    }
  }
  return placed;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function zoomForStage(stage: "campus" | "building" | "classroom"): number {
  if (stage === "campus") return 16;
  if (stage === "building") return 18;
  return 19;
}

export function fitTarget(
  campusId: TkuCampusId,
  buildingCode?: string,
): { lat: number; lng: number; zoom: number } | null {
  if (buildingCode) {
    const b = buildingByCode(buildingCode);
    if (b && hasCoords(b) && b.campusId === campusId) {
      return { lat: b.lat!, lng: b.lng!, zoom: 18 };
    }
  }
  const c = campusCenter(campusId);
  return c ? { ...c, zoom: 16 } : null;
}

export function defaultCampusId(ref?: TkuCampusRef | null): TkuCampusId {
  const id = ref?.campusId;
  if (id && id !== "cyber") return id;
  return "tamsui";
}

export function entranceCopy(place: TkuPlace | null | undefined): string {
  if (!place) return "入口待現場確認";
  if (place.entranceStatus === "surveyed" && place.entranceHint) return place.entranceHint;
  if (place.entranceHint) return `${place.entranceHint} · 入口待現場確認`;
  return "入口待現場確認";
}

export function classroomCodeOf(place: TkuPlace): string | null {
  if (parseTkuRoomCode(place.id)) return place.id;
  if (place.buildingCode && place.floor != null && place.room) {
    return `${place.buildingCode}${place.floor}${place.room}`;
  }
  return null;
}

export function campusDisplayName(id: TkuCampusId): string {
  return campusById(id)?.name ?? id;
}
