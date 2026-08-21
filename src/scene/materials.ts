/**
 * Shared MaterialPreset library — low-saturation field-tool materials.
 * Colors stay quiet so Zone / Route / Selection / Warning remain primary.
 */

import { MeshStandardMaterial } from "three";

export type MaterialPresetId =
  | "painted-metal"
  | "brushed-metal"
  | "plastic-matte"
  | "plastic-gloss"
  | "light-wood"
  | "dark-wood"
  | "fabric"
  | "rubber"
  | "paper"
  | "screen-glass"
  | "mat-soft";

export interface MaterialPreset {
  id: MaterialPresetId;
  baseColor: string;
  roughness: number;
  metalness: number;
}

export const MATERIAL_PRESETS: Record<MaterialPresetId, MaterialPreset> = {
  "painted-metal": { id: "painted-metal", baseColor: "#9aa3af", roughness: 0.55, metalness: 0.35 },
  "brushed-metal": { id: "brushed-metal", baseColor: "#8b949e", roughness: 0.4, metalness: 0.7 },
  "plastic-matte": { id: "plastic-matte", baseColor: "#d1d5db", roughness: 0.85, metalness: 0.02 },
  "plastic-gloss": { id: "plastic-gloss", baseColor: "#e5e7eb", roughness: 0.35, metalness: 0.05 },
  "light-wood": { id: "light-wood", baseColor: "#c8b6a6", roughness: 0.75, metalness: 0.0 },
  "dark-wood": { id: "dark-wood", baseColor: "#8b7355", roughness: 0.7, metalness: 0.0 },
  fabric: { id: "fabric", baseColor: "#a8b0bc", roughness: 0.95, metalness: 0.0 },
  rubber: { id: "rubber", baseColor: "#4b5563", roughness: 0.9, metalness: 0.0 },
  paper: { id: "paper", baseColor: "#f8fafc", roughness: 0.9, metalness: 0.0 },
  "screen-glass": { id: "screen-glass", baseColor: "#94a3b8", roughness: 0.2, metalness: 0.15 },
  "mat-soft": { id: "mat-soft", baseColor: "#5fa877", roughness: 0.98, metalness: 0.0 },
};

const cache = new Map<string, MeshStandardMaterial>();

function shadeHex(hex: string, amt: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const r = clamp((n >> 16) + amt);
  const g = clamp(((n >> 8) & 0xff) + amt);
  const b = clamp((n & 0xff) + amt);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** Cached MeshStandardMaterial for a preset, optionally tinted. */
export function materialFromPreset(
  presetId: MaterialPresetId,
  tint?: string,
  shade = 0,
): MeshStandardMaterial {
  const preset = MATERIAL_PRESETS[presetId];
  const color = shadeHex(tint ?? preset.baseColor, shade);
  const key = `${presetId}|${color}|${preset.roughness}|${preset.metalness}`;
  let m = cache.get(key);
  if (!m) {
    m = new MeshStandardMaterial({
      color,
      roughness: preset.roughness,
      metalness: preset.metalness,
    });
    cache.set(key, m);
  }
  return m;
}

export function clearMaterialCache(): void {
  for (const m of cache.values()) m.dispose();
  cache.clear();
}
