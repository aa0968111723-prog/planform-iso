/**
 * Venue photographs as a *reference catalogue*, not a detector.
 *
 * Photos never invent geometry and never overwrite another room. Binding is
 * explicit: an E305 door-plate photograph belongs to E305, not E310. Anything
 * that has not been tied to a place is labelled 「照片場地尚未綁定」.
 *
 * This phase does not run AI recognition. Thumbnails are honest diagrams of
 * what the shot is *about* (door plate, screen, window AC), not the original
 * camera file.
 */

export type VenuePhotoStatus = "bound" | "unbound";
export type PhotoConfirmTag = "待現場確認";

export type PhotoFacility =
  | "教室門牌"
  | "窗型冷氣"
  | "投影幕"
  | "黑板"
  | "木製講桌"
  | "一體式課桌椅"
  | "窗戶"
  | "窗簾"
  | "走廊固定設施";

export interface VenuePhoto {
  id: string;
  /** Bound venue preset, or null when the shot is not attached to a room. */
  venuePresetId: string | null;
  placeId: string | null;
  title: string;
  /** Plain-language shooting direction, never a coordinate. */
  shootingDirection: string;
  visibleFacilities: PhotoFacility[];
  status: VenuePhotoStatus;
  confirmTag: PhotoConfirmTag;
  note: string;
  /** Diagram kind used to draw a labelled thumbnail. */
  diagram: "doorplate" | "ac" | "screen" | "blackboard" | "desks" | "corridor" | "unbound";
}

export const VENUE_PHOTOS: VenuePhoto[] = [
  {
    id: "photo:e305-doorplate",
    venuePresetId: "venue:tku-e305",
    placeId: "E305",
    title: "E305 教室門牌",
    shootingDirection: "走廊看向教室門",
    visibleFacilities: ["教室門牌", "走廊固定設施"],
    status: "bound",
    confirmTag: "待現場確認",
    note: "門牌清楚寫著 E305。這是 E305 的參考照片，不得套用到 E310。",
    diagram: "doorplate",
  },
  {
    id: "photo:e305-window-ac",
    venuePresetId: "venue:tku-e305",
    placeId: "E305",
    title: "E305 窗型冷氣標記",
    shootingDirection: "教室內看向側牆窗戶",
    visibleFacilities: ["窗型冷氣", "窗戶", "窗簾"],
    status: "bound",
    confirmTag: "待現場確認",
    note: "冷氣機身標記為 E305。只作為辨識這間教室，不當成量測。",
    diagram: "ac",
  },
  {
    id: "photo:e305-front",
    venuePresetId: "venue:tku-e305",
    placeId: "E305",
    title: "E305 前方講台與投影幕",
    shootingDirection: "從後側入口看向前方",
    visibleFacilities: ["投影幕", "黑板", "木製講桌"],
    status: "bound",
    confirmTag: "待現場確認",
    note: "用來辨識前方在哪一側。照片裡的距離不是實測尺寸。",
    diagram: "screen",
  },
  {
    id: "photo:e305-desks",
    venuePresetId: "venue:tku-e305",
    placeId: "E305",
    title: "E305 一體式課桌椅",
    shootingDirection: "教室內側牆",
    visibleFacilities: ["一體式課桌椅", "窗戶", "窗簾"],
    status: "bound",
    confirmTag: "待現場確認",
    note: "側牆課桌椅可當背包區的視覺參考。列數不當成長寬。",
    diagram: "desks",
  },
  {
    id: "photo:unbound-hallway",
    venuePresetId: null,
    placeId: null,
    title: "走廊現場照",
    shootingDirection: "拍攝方向待標",
    visibleFacilities: ["走廊固定設施"],
    status: "unbound",
    confirmTag: "待現場確認",
    note: "還沒對上教室代碼，所以不能當任何一間教室的平面依據。",
    diagram: "unbound",
  },
];

export function photosForVenue(venuePresetId: string | undefined | null): VenuePhoto[] {
  if (!venuePresetId) return [];
  return VENUE_PHOTOS.filter((p) => p.venuePresetId === venuePresetId);
}

export function photosForPlace(placeId: string | undefined | null): VenuePhoto[] {
  if (!placeId) return [];
  return VENUE_PHOTOS.filter((p) => p.placeId === placeId);
}

export function unboundPhotos(): VenuePhoto[] {
  return VENUE_PHOTOS.filter((p) => p.status === "unbound" || !p.venuePresetId);
}

export function photoBindingLabel(photo: VenuePhoto): string {
  if (photo.status === "unbound" || !photo.venuePresetId) return "照片場地尚未綁定";
  return photo.placeId ? `參考場地 ${photo.placeId}` : "已綁定場地";
}

/** Photos of one room must never be offered as evidence for another. */
export function photosWouldOverwrite(fromVenue: string, ontoVenue: string): boolean {
  if (fromVenue === ontoVenue) return false;
  return photosForVenue(fromVenue).length > 0;
}

export function photoThumbnailSvg(photo: VenuePhoto): string {
  const title = escapeXml(photo.title);
  const tag = photo.status === "unbound" ? "尚未綁定" : (photo.placeId ?? "參考");
  const body = diagramMarkup(photo.diagram, photo.placeId ?? "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" role="img" aria-label="${title}">
    <rect width="320" height="200" rx="16" fill="#eef4f1"/>
    <rect x="12" y="12" width="296" height="176" rx="12" fill="#f8fafc" stroke="#cbd5e1"/>
    ${body}
    <rect x="16" y="154" width="288" height="28" rx="8" fill="#0f172a"/>
    <text x="160" y="173" text-anchor="middle" font-size="13" font-family="sans-serif" fill="#f8fafc">${escapeXml(tag)} · ${photo.confirmTag}</text>
  </svg>`;
}

export function photoThumbnailDataUri(photo: VenuePhoto): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(photoThumbnailSvg(photo))}`;
}

function diagramMarkup(kind: VenuePhoto["diagram"], placeId: string): string {
  switch (kind) {
    case "doorplate":
      return `<rect x="118" y="48" width="84" height="78" rx="6" fill="#334155"/>
        <rect x="126" y="56" width="68" height="44" rx="4" fill="#f8fafc"/>
        <text x="160" y="84" text-anchor="middle" font-size="18" font-weight="700" font-family="sans-serif" fill="#0f172a">${escapeXml(placeId || "門牌")}</text>
        <text x="160" y="112" text-anchor="middle" font-size="11" font-family="sans-serif" fill="#e2e8f0">教室門</text>`;
    case "ac":
      return `<rect x="70" y="58" width="180" height="52" rx="8" fill="#64748b"/>
        <rect x="82" y="68" width="156" height="20" fill="#cbd5e1"/>
        <text x="160" y="128" text-anchor="middle" font-size="16" font-weight="700" font-family="sans-serif" fill="#0f172a">${escapeXml(placeId || "冷氣")}</text>`;
    case "screen":
      return `<rect x="48" y="40" width="224" height="18" rx="3" fill="#0f172a"/>
        <rect x="70" y="68" width="80" height="48" fill="#1e3a5f"/>
        <rect x="168" y="88" width="70" height="36" rx="4" fill="#92400e"/>
        <text x="160" y="140" text-anchor="middle" font-size="12" font-family="sans-serif" fill="#334155">前方 · 投影幕／黑板／講桌</text>`;
    case "blackboard":
      return `<rect x="50" y="44" width="220" height="70" rx="4" fill="#14532d"/>
        <text x="160" y="140" text-anchor="middle" font-size="12" font-family="sans-serif" fill="#334155">黑板</text>`;
    case "desks":
      return `<rect x="40" y="70" width="70" height="44" rx="4" fill="#94a3b8"/>
        <rect x="125" y="70" width="70" height="44" rx="4" fill="#94a3b8"/>
        <rect x="210" y="70" width="70" height="44" rx="4" fill="#94a3b8"/>
        <text x="160" y="140" text-anchor="middle" font-size="12" font-family="sans-serif" fill="#334155">一體式課桌椅</text>`;
    case "corridor":
      return `<rect x="30" y="80" width="260" height="36" fill="#e2e8f0"/>
        <text x="160" y="140" text-anchor="middle" font-size="12" font-family="sans-serif" fill="#334155">走廊</text>`;
    default:
      return `<text x="160" y="100" text-anchor="middle" font-size="16" font-family="sans-serif" fill="#64748b">尚未綁定場地</text>`;
  }
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
