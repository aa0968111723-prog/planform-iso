/**
 * Venue photographs as *reference cards*, not measurements and not AI.
 *
 * A photo can name the room on the door, the direction it was taken from,
 * and which fixtures are visible. It must not overwrite another room's
 * template, invent indoor coordinates, or claim the pixels were surveyed.
 */

export type VenuePhotoBinding = "bound" | "unbound";

export interface VenuePhotoRef {
  id: string;
  title: string;
  /** Bound Tamkang place id, or null when the photo is not yet tied to a room. */
  placeId: string | null;
  venuePresetId: string | null;
  /** Plain-language shooting direction, e.g. 走廊看向教室門. */
  direction: string;
  visibleFixtures: string[];
  pendingFieldConfirm: boolean;
  binding: VenuePhotoBinding;
  /** Optional local/public path. Absent → UI shows a labelled card, not a fake image. */
  src?: string;
}

export const VENUE_PHOTOS: VenuePhotoRef[] = [
  {
    id: "photo:e305-door",
    title: "E305 門牌",
    placeId: "E305",
    venuePresetId: "venue:tku-e305",
    direction: "走廊看向教室門",
    visibleFixtures: ["教室門牌 E305", "教室門", "走廊固定設施"],
    pendingFieldConfirm: true,
    binding: "bound",
  },
  {
    id: "photo:e305-ac",
    title: "E305 冷氣標記",
    placeId: "E305",
    venuePresetId: "venue:tku-e305",
    direction: "教室內看向側牆",
    visibleFixtures: ["窗型冷氣 E305 標記", "窗戶", "窗簾"],
    pendingFieldConfirm: true,
    binding: "bound",
  },
  {
    id: "photo:e305-front",
    title: "E305 前方",
    placeId: "E305",
    venuePresetId: "venue:tku-e305",
    direction: "從後側入口看向前方",
    visibleFixtures: ["投影幕", "黑板", "木製講桌"],
    pendingFieldConfirm: true,
    binding: "bound",
  },
  {
    id: "photo:e305-seats",
    title: "E305 課桌椅",
    placeId: "E305",
    venuePresetId: "venue:tku-e305",
    direction: "從前方看向座位區",
    visibleFixtures: ["一體式課桌椅", "窗戶", "窗簾"],
    pendingFieldConfirm: true,
    binding: "bound",
  },
  {
    id: "photo:unbound-corridor",
    title: "工學大樓走廊（尚未綁定）",
    placeId: null,
    venuePresetId: null,
    direction: "走廊方向待確認",
    visibleFixtures: ["走廊", "教室門"],
    pendingFieldConfirm: true,
    binding: "unbound",
  },
];

export function venuePhotosForPlace(placeId: string): VenuePhotoRef[] {
  return VENUE_PHOTOS.filter((p) => p.placeId === placeId);
}

export function venuePhotosForPreset(venuePresetId: string): VenuePhotoRef[] {
  return VENUE_PHOTOS.filter((p) => p.venuePresetId === venuePresetId);
}

export function unboundVenuePhotos(): VenuePhotoRef[] {
  return VENUE_PHOTOS.filter((p) => p.binding === "unbound" || p.placeId == null);
}

export function photoBindingLabel(photo: VenuePhotoRef): string {
  if (photo.binding === "unbound" || !photo.placeId) return "照片場地尚未綁定";
  return photo.pendingFieldConfirm ? "待現場確認" : photo.placeId;
}
