/**
 * Tamkang campus location helpers — search, map pins, navigation links.
 *
 * Building lat/lng are public directory coordinates (Wikidata / OSM). They
 * mark a 樓館位置, never an indoor room. Room codes are resolved in the
 * directory; they are not placed at invented indoor GPS.
 */

import {
  TKU_BUILDINGS,
  TKU_CAMPUSES,
  TKU_PLACES,
  buildingByCode,
  campusById,
  parseTkuRoomCode,
  placeById,
  type TkuBuilding,
  type TkuCampusId,
  type TkuCampusRef,
  type TkuPlace,
} from "./tkuCampus";

export const OSM_ATTRIBUTION = "© OpenStreetMap contributors";
export const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const BUILDING_PIN_KIND = "樓館位置" as const;
export const ENTRANCE_UNCONFIRMED = "入口待現場確認";
/** Consecutive OSM tile errors before the directory fallback replaces a blank map. */
export const MAP_TILE_ERROR_LIMIT = 4;

export function shouldShowMapFallback(tileErrors: number): boolean {
  return tileErrors >= MAP_TILE_ERROR_LIMIT;
}

export function campusRefsEqual(a: TkuCampusRef | undefined, b: TkuCampusRef | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.campusId === b.campusId
    && a.buildingCode === b.buildingCode
    && a.floor === b.floor
    && a.room === b.room
    && a.placeId === b.placeId;
}

export type DirectoryHitKind = "campus" | "building" | "place";

export interface DirectoryHit {
  kind: DirectoryHitKind;
  id: string;
  title: string;
  subtitle: string;
  campusId: TkuCampusId;
  buildingCode?: string;
  placeId?: string;
  floor?: number;
  room?: string;
}

export interface CampusCenter {
  campusId: Exclude<TkuCampusId, "cyber">;
  lat: number;
  lng: number;
  /** Honest label for the pin — campus location, not a surveyed door. */
  label: string;
  source: "buildings-centroid" | "published-building";
}

export interface BuildingMapMarker {
  code: string;
  name: string;
  lat: number;
  lng: number;
  campusId: TkuCampusId;
  pinLabel: string;
  isCurrent: boolean;
  weight: "primary" | "muted";
  /** Always 樓館位置 — never a room coordinate. */
  pinKind: typeof BUILDING_PIN_KIND;
}

export interface MapLabelPlacement {
  id: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  visible: boolean;
}

export interface ScreenLabel {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  priority: 0 | 1 | 2;
}

const PHYSICAL_CAMPUSES: Exclude<TkuCampusId, "cyber">[] = ["tamsui", "taipei", "lanyang"];

export function physicalCampuses(): Exclude<TkuCampusId, "cyber">[] {
  return [...PHYSICAL_CAMPUSES];
}

function buildingsWithCoords(campusId: TkuCampusId): TkuBuilding[] {
  return TKU_BUILDINGS.filter(
    (b) => b.campusId === campusId && typeof b.lat === "number" && typeof b.lng === "number",
  );
}

/** Public campus location from published building coordinates. Never invented. */
export function campusCenter(campusId: TkuCampusId): CampusCenter | null {
  if (campusId === "cyber") return null;
  const located = buildingsWithCoords(campusId);
  if (!located.length) return null;
  if (campusId === "taipei") {
    const d = located.find((b) => b.code === "D") ?? located[0];
    return {
      campusId,
      lat: d.lat!,
      lng: d.lng!,
      label: "臺北校園 · 樓館位置",
      source: "published-building",
    };
  }
  if (campusId === "lanyang") {
    const sa = located.find((b) => b.code === "SA") ?? located[0];
    return {
      campusId,
      lat: sa.lat!,
      lng: sa.lng!,
      label: "蘭陽校園 · 樓館位置",
      source: "published-building",
    };
  }
  const lat = located.reduce((s, b) => s + b.lat!, 0) / located.length;
  const lng = located.reduce((s, b) => s + b.lng!, 0) / located.length;
  return {
    campusId: "tamsui",
    lat,
    lng,
    label: "淡水校園 · 樓館位置",
    source: "buildings-centroid",
  };
}

export function campusRefFromPlace(place: TkuPlace): TkuCampusRef {
  const ref: TkuCampusRef = { campusId: place.campusId, placeId: place.id };
  if (place.buildingCode) ref.buildingCode = place.buildingCode;
  if (place.floor != null) ref.floor = place.floor;
  if (place.room) ref.room = place.room;
  return ref;
}

export function campusRefForVenuePreset(presetId: string | undefined): TkuCampusRef | undefined {
  if (!presetId) return undefined;
  if (presetId === "venue:tku-e310") {
    const place = placeById("E310");
    return place ? campusRefFromPlace(place) : { campusId: "tamsui", buildingCode: "E", floor: 3, room: "10", placeId: "E310" };
  }
  if (presetId === "venue:tku-e305") {
    const place = placeById("E305");
    return place ? campusRefFromPlace(place) : { campusId: "tamsui", buildingCode: "E", floor: 3, room: "05", placeId: "E305" };
  }
  if (presetId === "venue:tku-classroom") return { campusId: "tamsui" };
  if (presetId === "venue:tku-booth") return { campusId: "tamsui" };
  const exact = TKU_PLACES.find((p) => p.venuePresetId === presetId && p.kind !== "generic");
  return exact ? campusRefFromPlace(exact) : undefined;
}

export function resolveCampusRef(ref: TkuCampusRef | undefined, presetId?: string): TkuCampusRef {
  if (ref?.campusId) return ref;
  return campusRefForVenuePreset(presetId) ?? { campusId: "tamsui" };
}

export function formatFreshmanHeadline(ref: TkuCampusRef): string {
  const campus = campusById(ref.campusId);
  const building = ref.buildingCode ? buildingByCode(ref.buildingCode) : undefined;
  const place = ref.placeId ? placeById(ref.placeId) : undefined;
  const roomCode = roomCodeOf(ref, place);
  const floor = floorLabelOf(ref, place);
  return ["淡江大學", campus?.name, building?.name, roomCode, floor].filter(Boolean).join(" · ");
}

function roomCodeOf(ref: TkuCampusRef, place?: TkuPlace): string | null {
  if (place && /^[A-Z]{1,2}\d/.test(place.id)) return place.id;
  if (ref.buildingCode && ref.floor != null && ref.room) {
    return `${ref.buildingCode}${ref.floor}${ref.room}`;
  }
  return place?.name ?? null;
}

function floorLabelOf(ref: TkuCampusRef, place?: TkuPlace): string | null {
  const floor = ref.floor ?? place?.floor;
  if (floor == null) return null;
  return floor === 0 ? "B1" : `${floor}F`;
}

export function googleMapsUrl(lat: number, lng: number, query?: string): string {
  const q = query?.trim() ? encodeURIComponent(query.trim()) : `${lat},${lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

export function osmLocationUrl(lat: number, lng: number, zoom = 18): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=${zoom}/${lat}/${lng}`;
}

export function buildingNavQuery(building: TkuBuilding): string {
  const campus = campusById(building.campusId);
  return `淡江大學 ${campus?.name ?? ""} ${building.name}`.replace(/\s+/g, " ").trim();
}

/**
 * Map markers for one campus. Current activity building is primary; others
 * are muted. Buildings without public coordinates are omitted — they stay
 * in the directory, not as invented pins.
 */
export function buildingMarkersForCampus(
  campusId: TkuCampusId,
  currentBuildingCode?: string,
): BuildingMapMarker[] {
  return buildingsWithCoords(campusId).map((b) => {
    const isCurrent = !!currentBuildingCode && b.code === currentBuildingCode.toUpperCase();
    return {
      code: b.code,
      name: b.name,
      lat: b.lat!,
      lng: b.lng!,
      campusId: b.campusId,
      pinLabel: `${b.name.replace(/紀念|大樓|館$/, "") || b.name} ${b.code}`.trim(),
      isCurrent,
      weight: isCurrent ? "primary" : "muted",
      pinKind: BUILDING_PIN_KIND,
    };
  });
}

export function fitBoundsForMarkers(markers: BuildingMapMarker[]): {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
} | null {
  if (!markers.length) return null;
  const current = markers.filter((m) => m.isCurrent);
  const focus = current.length ? current : markers;
  let minLat = focus[0].lat, maxLat = focus[0].lat, minLng = focus[0].lng, maxLng = focus[0].lng;
  for (const m of focus) {
    minLat = Math.min(minLat, m.lat);
    maxLat = Math.max(maxLat, m.lat);
    minLng = Math.min(minLng, m.lng);
    maxLng = Math.max(maxLng, m.lng);
  }
  // A single building still needs a small pad so fitBounds has an area.
  if (maxLat - minLat < 0.0008) {
    minLat -= 0.0006;
    maxLat += 0.0006;
  }
  if (maxLng - minLng < 0.0008) {
    minLng -= 0.0006;
    maxLng += 0.0006;
  }
  return { minLat, maxLat, minLng, maxLng };
}

/**
 * Keep map labels from sitting on top of each other. Current-building labels
 * always win. Offsets are in the same pixel space as the input.
 */
export function placeNonOverlappingLabels(
  labels: readonly ScreenLabel[],
  maxVisible = 14,
): MapLabelPlacement[] {
  const ordered = labels
    .map((label, order) => ({ label, order }))
    .sort((a, b) => a.label.priority - b.label.priority || a.order - b.order);
  const accepted: { label: ScreenLabel; dx: number; dy: number }[] = [];
  const result: MapLabelPlacement[] = [];

  const overlaps = (a: ScreenLabel, ax: number, ay: number, b: ScreenLabel, bx: number, by: number) =>
    ax < bx + b.width && ax + a.width > bx && ay < by + b.height && ay + a.height > by;

  for (const { label } of ordered) {
    let placed = false;
    const offsets: Array<[number, number]> = [
      [0, 0], [0, -18], [16, -10], [-16, -10], [0, 18], [22, 8], [-22, 8], [0, -36],
    ];
    for (const [dx, dy] of offsets) {
      const x = label.x + dx;
      const y = label.y + dy;
      if (accepted.some((other) => overlaps(label, x, y, other.label, other.label.x + other.dx, other.label.y + other.dy))) {
        continue;
      }
      if (label.priority > 0 && accepted.length >= maxVisible) break;
      accepted.push({ label, dx, dy });
      result.push({ id: label.id, x: label.x, y: label.y, dx, dy, visible: true });
      placed = true;
      break;
    }
    if (!placed) {
      result.push({ id: label.id, x: label.x, y: label.y, dx: 0, dy: 0, visible: label.priority === 0 });
    }
  }
  return result;
}

function norm(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

/**
 * Search campuses, buildings and rooms. E305 and E310 are distinct hits.
 * Unknown room codes fall back to the building generic place, never a
 * fabricated room geometry.
 */
export function searchTkuDirectory(query: string, limit = 20): DirectoryHit[] {
  const q = query.trim();
  if (!q) return [];
  const n = norm(q);
  const hits: DirectoryHit[] = [];
  const seen = new Set<string>();
  const push = (hit: DirectoryHit) => {
    const key = `${hit.kind}:${hit.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push(hit);
  };

  const parsed = parseTkuRoomCode(q);
  if (parsed) {
    const exact = TKU_PLACES.find((p) => p.id.toUpperCase() === parsed.code);
    if (exact) {
      push(placeHit(exact, 0));
    } else {
      const building = buildingByCode(parsed.buildingCode);
      const generic = TKU_PLACES.find(
        (p) => p.kind === "generic" && p.buildingCode === parsed.buildingCode,
      ) ?? (building?.campusId === "taipei"
        ? placeById("taipei-generic")
        : building?.campusId === "lanyang"
          ? placeById("lanyang-generic")
          : placeById("tku-generic"));
      if (generic) {
        push({
          ...placeHit(generic, 1),
          id: parsed.code,
          title: parsed.code,
          subtitle: `${generic.name} · 未建檔室號，套用該棟起點`,
          floor: parsed.floor,
          room: parsed.room,
        });
      }
      if (building) push(buildingHit(building, 2));
    }
  }

  for (const campus of TKU_CAMPUSES) {
    if (campus.id === "cyber") continue;
    if (norm(campus.name).includes(n) || n.includes(norm(campus.name)) || norm(campus.nameEn).includes(n)) {
      push(campusHit(campus.id, campus.name));
    }
  }
  for (const b of TKU_BUILDINGS) {
    if (b.code.toLowerCase() === n || norm(b.name) === n) push(buildingHit(b, 0));
  }
  for (const p of TKU_PLACES) {
    if (p.id.toLowerCase() === n || norm(p.name) === n) push(placeHit(p, 0));
    if (p.aliases?.some((a) => norm(a) === n)) push(placeHit(p, 0));
  }
  if (n.length >= 1) {
    for (const b of TKU_BUILDINGS) {
      if (
        b.code.toLowerCase().includes(n)
        || norm(b.name).includes(n)
        || n.includes(norm(b.name))
        || b.aliases?.some((a) => norm(a).includes(n) || n.includes(norm(a)))
        || norm(b.nameEn).includes(n)
      ) {
        push(buildingHit(b, 1));
      }
    }
    for (const p of TKU_PLACES) {
      if (
        p.id.toLowerCase().includes(n)
        || norm(p.name).includes(n)
        || p.aliases?.some((a) => norm(a).includes(n) || n.includes(norm(a)))
      ) {
        push(placeHit(p, 1));
      }
    }
  }

  return hits.slice(0, limit);
}

function campusHit(id: TkuCampusId, name: string): DirectoryHit {
  return { kind: "campus", id, title: name, subtitle: "淡江大學校園", campusId: id };
}

function buildingHit(b: TkuBuilding, _rank: number): DirectoryHit {
  void _rank;
  const campus = campusById(b.campusId);
  const hasPin = typeof b.lat === "number" && typeof b.lng === "number";
  return {
    kind: "building",
    id: b.code,
    title: `${b.code} ${b.name}`,
    subtitle: hasPin
      ? `${campus?.name ?? ""} · ${BUILDING_PIN_KIND}`
      : `${campus?.name ?? ""} · 尚無公開樓館座標`,
    campusId: b.campusId,
    buildingCode: b.code,
  };
}

function placeHit(p: TkuPlace, _rank: number): DirectoryHit {
  void _rank;
  const b = p.buildingCode ? buildingByCode(p.buildingCode) : undefined;
  const floor = p.floor != null ? (p.floor === 0 ? "B1" : `${p.floor}F`) : null;
  const where = [campusById(p.campusId)?.name, b?.name, floor].filter(Boolean).join(" · ");
  return {
    kind: "place",
    id: p.id,
    title: p.name,
    subtitle: where || p.note,
    campusId: p.campusId,
    buildingCode: p.buildingCode,
    placeId: p.id,
    floor: p.floor,
    room: p.room,
  };
}

export function hitToCampusRef(hit: DirectoryHit): TkuCampusRef {
  const ref: TkuCampusRef = { campusId: hit.campusId };
  if (hit.buildingCode) ref.buildingCode = hit.buildingCode;
  if (hit.floor != null) ref.floor = hit.floor;
  if (hit.room) ref.room = hit.room;
  if (hit.placeId) ref.placeId = hit.placeId;
  else if (hit.kind === "place") ref.placeId = hit.id;
  return ref;
}

export function currentBuildingOf(ref: TkuCampusRef): TkuBuilding | undefined {
  return ref.buildingCode ? buildingByCode(ref.buildingCode) : undefined;
}

export function currentPlaceOf(ref: TkuCampusRef): TkuPlace | undefined {
  if (ref.placeId) return placeById(ref.placeId);
  if (ref.buildingCode && ref.floor != null && ref.room) {
    return placeById(`${ref.buildingCode}${ref.floor}${ref.room}`);
  }
  return undefined;
}

export function entranceStatus(_ref: TkuCampusRef): { confirmed: false; label: string } {
  void _ref;
  // No building entrance has been field-surveyed into this directory.
  return { confirmed: false, label: ENTRANCE_UNCONFIRMED };
}

export function buildingHasPublicCoords(code: string): boolean {
  const b = buildingByCode(code);
  return !!b && typeof b.lat === "number" && typeof b.lng === "number";
}
