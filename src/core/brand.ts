/**
 * PLANFORM product identity — one place every surface reads from.
 *
 * Browser title, PWA, app header, Project Home and 場刊 chrome must agree.
 * 「平面場 ISO」 is a historical repository name, not the public product name.
 */

export const BRAND = {
  /** Latin wordmark, always uppercase. */
  name: "PLANFORM",
  /** PWA short_name. */
  shortName: "Planform",
  /** Full product title used as the browser / PWA name. */
  title: "PLANFORM｜活動空間彩排",
  /** One-line Chinese description. */
  description: "活動空間彩排工具",
  tagline: "先排好，再上場。",
} as const;

export type Brand = typeof BRAND;
