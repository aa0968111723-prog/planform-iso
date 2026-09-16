/**
 * Venue photo references — thumbnails and captions, not computer vision.
 *
 * Photos never invent a room, never overwrite another venue, and never claim
 * a measurement. Binding is explicit: E305 photos stay on E305; unbound
 * photos are labelled 照片場地尚未綁定.
 */

export type PhotoBindingStatus = "bound" | "unbound" | "pending-site-confirm";

export type PhotoDirection =
  | "走廊看教室門"
  | "教室內看前方"
  | "教室內看後方入口"
  | "教室內看側窗"
  | "走廊"
  | "未標示";

export interface VenuePhotoRef {
  id: string;
  /** Human title, e.g. 「E305 門牌」. */
  title: string;
  /** Bound venue preset, or null when the room is not identified. */
  venuePresetId: string | null;
  placeId: string | null;
  direction: PhotoDirection;
  visibleFacilities: string[];
  status: PhotoBindingStatus;
  /** Honest caption. Never "this is a surveyed plan". */
  note: string;
  /** Optional local thumbnail (data URL or blob id). Built-ins ship without bytes. */
  thumbnailRef?: string | null;
}

export const UNBOUND_PHOTO_LABEL = "照片場地尚未綁定";

/**
 * Built-in field-photo index. Bytes are not in the repository; captions record
 * what the provided photographs show so E305 cannot be silently treated as E310.
 */
export const BUILTIN_VENUE_PHOTOS: VenuePhotoRef[] = [
  {
    id: "photo:e305-doorplate",
    title: "E305 教室門牌",
    venuePresetId: "venue:tku-e305",
    placeId: "E305",
    direction: "走廊看教室門",
    visibleFacilities: ["教室門牌 E305", "教室門"],
    status: "pending-site-confirm",
    note: "現場照片清楚出現 E305 門牌。只作為 E305 辨識參考，不得套用到 E310。入口待現場確認。",
    thumbnailRef: null,
  },
  {
    id: "photo:e305-ac",
    title: "E305 窗型冷氣標記",
    venuePresetId: "venue:tku-e305",
    placeId: "E305",
    direction: "教室內看側窗",
    visibleFacilities: ["窗型冷氣", "E305 冷氣標記", "窗戶", "窗簾"],
    status: "pending-site-confirm",
    note: "冷氣標記為 E305。用來確認這間教室，不是量測來源。",
    thumbnailRef: null,
  },
  {
    id: "photo:e305-front",
    title: "E305 前方講台",
    venuePresetId: "venue:tku-e305",
    placeId: "E305",
    direction: "教室內看前方",
    visibleFacilities: ["投影幕", "黑板", "木製講桌"],
    status: "pending-site-confirm",
    note: "可見前方投影幕、黑板與木製講桌。尺寸待現場校正。",
    thumbnailRef: null,
  },
  {
    id: "photo:e305-desks",
    title: "E305 課桌椅與窗戶",
    venuePresetId: "venue:tku-e305",
    placeId: "E305",
    direction: "教室內看側窗",
    visibleFacilities: ["一體式課桌椅", "窗戶", "窗簾", "窗型冷氣"],
    status: "pending-site-confirm",
    note: "教室原有一體式課桌椅與側窗。不得把照片中的房間尺寸當成精確測量。",
    thumbnailRef: null,
  },
  {
    id: "photo:e305-corridor",
    title: "E305 外側走廊",
    venuePresetId: "venue:tku-e305",
    placeId: "E305",
    direction: "走廊",
    visibleFacilities: ["走廊固定設施", "教室門"],
    status: "pending-site-confirm",
    note: "走廊設施僅供辨識方向。不是 E310 走廊實測。",
    thumbnailRef: null,
  },
  {
    id: "photo:unbound-unidentified",
    title: "尚未確認的教室照片",
    venuePresetId: null,
    placeId: null,
    direction: "未標示",
    visibleFacilities: [],
    status: "unbound",
    note: UNBOUND_PHOTO_LABEL,
    thumbnailRef: null,
  },
];

export function photosForVenue(venuePresetId: string): VenuePhotoRef[] {
  return BUILTIN_VENUE_PHOTOS.filter((p) => p.venuePresetId === venuePresetId);
}

export function photosForPlace(placeId: string): VenuePhotoRef[] {
  return BUILTIN_VENUE_PHOTOS.filter((p) => p.placeId === placeId);
}

export function unboundPhotos(): VenuePhotoRef[] {
  return BUILTIN_VENUE_PHOTOS.filter((p) => p.status === "unbound" || !p.venuePresetId);
}

export function photoBindingLabel(photo: VenuePhotoRef): string {
  if (photo.status === "unbound" || !photo.venuePresetId) return UNBOUND_PHOTO_LABEL;
  if (photo.status === "pending-site-confirm") return "待現場確認";
  return photo.placeId ?? photo.venuePresetId;
}

/** Guard: E305 photographic evidence must never be read as E310. */
export function photosCannotAliasVenues(a: string, b: string): boolean {
  const photosA = photosForVenue(a);
  const photosB = photosForVenue(b);
  if (!photosA.length || !photosB.length) return true;
  return photosA.every((p) => p.venuePresetId !== b) && photosB.every((p) => p.venuePresetId !== a);
}
