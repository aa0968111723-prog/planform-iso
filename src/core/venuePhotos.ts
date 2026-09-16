/**
 * Field photographs are venue *references*, not measurements and not AI labels.
 *
 * Actual JPEGs with faces stay off this repository. Each entry is a thumbnail
 * schematic plus the notes a freshman needs: which room, which way the camera
 * faced, what fixtures are visible, and whether the photo is bound yet.
 */

export type VenuePhotoStatus = "bound" | "unbound" | "pending-site-check";

export interface VenuePhotoRef {
  id: string;
  /** Bound room id, or null when the photo is not attached to a venue. */
  placeId: string | null;
  /** Bound venue preset, or null. Never reuse an E305 photo on E310. */
  venuePresetId: string | null;
  title: string;
  capturedToward: string;
  visibleFixtures: string[];
  status: VenuePhotoStatus;
  note: string;
  /** Schematic thumbnail (SVG data URI). Not the original photograph. */
  thumbnail: string;
}

function svgThumb(bg: string, title: string, sub: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160" role="img" aria-label="${title}">
  <rect width="240" height="160" fill="${bg}"/>
  <rect x="12" y="12" width="216" height="136" rx="10" fill="none" stroke="#0f172a" stroke-width="2" opacity="0.35"/>
  <text x="120" y="74" text-anchor="middle" fill="#0f172a" font-size="20" font-family="system-ui,sans-serif">${title}</text>
  <text x="120" y="100" text-anchor="middle" fill="#334155" font-size="12" font-family="system-ui,sans-serif">${sub}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const VENUE_PHOTO_REFS: VenuePhotoRef[] = [
  {
    id: "photo:e305-doorplate",
    placeId: "E305",
    venuePresetId: "venue:tku-e305",
    title: "E305 門牌",
    capturedToward: "走廊看向教室門",
    visibleFixtures: ["教室門牌 E305", "教室門"],
    status: "pending-site-check",
    note: "門牌清楚標示 E305，不能當成 E310。入口動線待現場確認。",
    thumbnail: svgThumb("#dbeafe", "E305 門牌", "走廊方向 · 待現場確認"),
  },
  {
    id: "photo:e305-ac",
    placeId: "E305",
    venuePresetId: "venue:tku-e305",
    title: "E305 窗型冷氣",
    capturedToward: "教室側牆／窗戶",
    visibleFixtures: ["窗型冷氣", "E305 冷氣標記", "窗戶", "窗簾"],
    status: "pending-site-check",
    note: "冷氣標記為 E305。窗戶與窗簾可辨識空間，不是尺寸依據。",
    thumbnail: svgThumb("#e0f2fe", "窗型冷氣", "側牆方向 · 待現場確認"),
  },
  {
    id: "photo:e305-front",
    placeId: "E305",
    venuePresetId: "venue:tku-e305",
    title: "E305 前方",
    capturedToward: "教室後方看向講台",
    visibleFixtures: ["投影幕", "黑板", "木製講桌", "一體式課桌椅"],
    status: "pending-site-check",
    note: "可見前方投影幕、黑板與木製講桌。照片不是實測平面圖。",
    thumbnail: svgThumb("#ecfdf5", "前方講台", "看向投影幕 · 待現場確認"),
  },
  {
    id: "photo:unbound-classroom",
    placeId: null,
    venuePresetId: null,
    title: "未綁定教室照片",
    capturedToward: "拍攝方向未標",
    visibleFixtures: ["走廊固定設施"],
    status: "unbound",
    note: "照片場地尚未綁定。在確認門牌之前，不會套到 E305 或 E310。",
    thumbnail: svgThumb("#f1f5f9", "尚未綁定", "照片場地尚未綁定"),
  },
];

export function photosForPlace(placeId: string): VenuePhotoRef[] {
  return VENUE_PHOTO_REFS.filter((p) => p.placeId === placeId);
}

export function photosForVenue(venuePresetId: string): VenuePhotoRef[] {
  return VENUE_PHOTO_REFS.filter((p) => p.venuePresetId === venuePresetId);
}

export function unboundPhotos(): VenuePhotoRef[] {
  return VENUE_PHOTO_REFS.filter((p) => p.status === "unbound" || !p.placeId);
}

export function photoBindingLabel(photo: VenuePhotoRef): string {
  if (photo.status === "unbound" || !photo.placeId) return "照片場地尚未綁定";
  if (photo.status === "pending-site-check") return "待現場確認";
  return photo.placeId;
}

/** Guard: E305 photographs must never be offered as E310 evidence. */
export function photosLeakAcrossVenues(): string[] {
  const leaks: string[] = [];
  for (const photo of VENUE_PHOTO_REFS) {
    if (photo.placeId === "E305" && photo.venuePresetId === "venue:tku-e310") {
      leaks.push(photo.id);
    }
    if (photo.placeId === "E310" && photo.venuePresetId === "venue:tku-e305") {
      leaks.push(photo.id);
    }
    if (photo.venuePresetId === "venue:tku-e310" && /E305/.test(photo.title + photo.note)) {
      leaks.push(photo.id);
    }
  }
  return leaks;
}
