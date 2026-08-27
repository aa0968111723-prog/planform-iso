/**
 * Visual theme — one palette shared by the editor canvas, simulation, Partner
 * Mode and the exported 場刊圖.
 *
 * Planform is used standing in a bright classroom, and its most important
 * output is a printed / LINE-shared plan on white paper. So **light is the
 * default**: the canvas is meant to look like the plan you are about to send,
 * not like a dark IDE. Dark mode stays available for anyone who prefers it,
 * but it is no longer the primary look.
 *
 * The scene colours below are deliberately the same values the construction
 * plan exporter paints with (`src/export/constructionPlan.ts`) — white
 * classroom, light-slate corridor, slate outlines — so what you edit and what
 * you send read as the same drawing.
 */

export type ThemeName = "light" | "dark";

export const DEFAULT_THEME: ThemeName = "light";

/**
 * The club's 巧拼, measured — not chosen.
 *
 * Sampled from six of the club's own event photographs
 * (`LINE_ALBUM_20251016_260530_{1,10,20,30,57,80}.jpg`, ~90 000 mat pixels):
 * median `#29bcaa`, seam/shadow `#179483`, highlight `#52cbba`.
 * See docs/field-research/REFERENCE_MAPPING.md row M-01.
 *
 * Honest limit: this is the colour of the mats *as photographed under E310's
 * fluorescent lighting*, not a colorimeter reading of the material. It is a
 * far better basis than taste, and it is what the plan should print.
 *
 * ONE constant on purpose. The scene said `#4fb89a` while the exported 場刊圖
 * said `#3f8f71`, so the plan you edited and the plan you sent to LINE were
 * different colours — exactly what this module's header promises never happens.
 */
export const MAT_COLORS = {
  /** Field colour. */
  base: "#29bcaa",
  /** Seam between two interlocking pieces, and the shaded side of a piece. */
  seam: "#179483",
  /** A piece catching the light. */
  light: "#52cbba",
  /** A piece in shade — the low end of the piece-to-piece variation. */
  dark: "#1d9e8e",
  /** Outline weight for the exported plan. */
  outline: "#12776a",
} as const;

export const THEME_STORAGE_KEY = "planform.theme";

export interface ScenePalette {
  /** Canvas clear colour. */
  background: number;
  floorClassroom: number;
  floorCorridor: number;
  wallClassroom: number;
  wallCorridor: number;
  areaLabelClassroom: string;
  areaLabelCorridor: string;
  /** Veil drawn over the plan when one route is focused. */
  focusVeil: number;
  focusVeilOpacity: number;
  /** Colour of the ①②③ digits drawn on route step discs. */
  stepNumber: string;
}

/**
 * Paper-like light palette. Matches the exporter: page #f8fafc, classroom
 * #ffffff, secondary area #f1f5f9, ink #334155.
 */
const LIGHT: ScenePalette = {
  background: 0xe9eef5,
  floorClassroom: 0xffffff,
  floorCorridor: 0xf1f5f9,
  wallClassroom: 0x334155,
  wallCorridor: 0x64748b,
  areaLabelClassroom: "#f8fafc",
  areaLabelCorridor: "#e0f2fe",
  focusVeil: 0xffffff,
  focusVeilOpacity: 0.66,
  stepNumber: "#0b1120",
};

/** The original dark canvas, kept for anyone who prefers it. */
const DARK: ScenePalette = {
  background: 0x0b1120,
  floorClassroom: 0x334155,
  floorCorridor: 0x172033,
  wallClassroom: 0xf8fafc,
  wallCorridor: 0x7dd3fc,
  areaLabelClassroom: "#e2e8f0",
  areaLabelCorridor: "#bae6fd",
  focusVeil: 0x0b1120,
  focusVeilOpacity: 0.62,
  stepNumber: "#0b1120",
};

export const SCENE_PALETTE: Record<ThemeName, ScenePalette> = { light: LIGHT, dark: DARK };

export function scenePalette(theme: ThemeName): ScenePalette {
  return SCENE_PALETTE[theme] ?? LIGHT;
}

/**
 * The 場刊圖 is a paper document. Its 3D page is always drawn on the light
 * palette so the exported set is one consistent artifact even if the editor
 * happens to be in dark mode — the previous build baked a near-black
 * background into that page while every other page was white.
 */
export const EXPORT_PALETTE: ScenePalette = LIGHT;

export function isThemeName(value: unknown): value is ThemeName {
  return value === "light" || value === "dark";
}

/** Stored preference, or the light default when nothing valid is stored. */
export function loadTheme(): ThemeName {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_THEME;
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeName(raw) ? raw : DEFAULT_THEME;
  } catch {
    // Private mode / blocked storage must not stop the app from painting.
    return DEFAULT_THEME;
  }
}

export function saveTheme(theme: ThemeName): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* preference is a convenience; losing it is not an error worth surfacing */
  }
}

export function otherTheme(theme: ThemeName): ThemeName {
  return theme === "light" ? "dark" : "light";
}

/** Stamp the theme on the document root so the CSS tokens switch. */
export function applyThemeToDocument(theme: ThemeName): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.style.colorScheme = theme;
}
