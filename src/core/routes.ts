/**
 * Route presets — semantic flow types with a default colour + icon so a plan
 * communicates "who walks where" at a glance. Colours are defaults only; a
 * route's colour can still be edited.
 */

import type { RouteType } from "./model";

export interface RoutePreset {
  type: RouteType;
  label: string;
  color: string;
  icon: string;
}

export const ROUTE_PRESETS: RoutePreset[] = [
  { type: "entry", label: "入場動線", color: "#f97316", icon: "🚪" },
  { type: "registration", label: "報到動線", color: "#38bdf8", icon: "👋" },
  { type: "payment", label: "收費動線", color: "#facc15", icon: "💰" },
  { type: "shoe", label: "鞋子動線", color: "#fbbf24", icon: "👟" },
  { type: "backpack", label: "背包動線", color: "#fb923c", icon: "🎒" },
  { type: "seating", label: "入座動線", color: "#34d399", icon: "🧎" },
  { type: "group", label: "小組移動", color: "#a78bfa", icon: "👥" },
  { type: "staff", label: "工作人員動線", color: "#f43f5e", icon: "🦺" },
  { type: "custom", label: "自訂動線", color: "#22d3ee", icon: "➰" },
];

export function routePreset(type: RouteType): RoutePreset {
  return ROUTE_PRESETS.find((p) => p.type === type) ?? ROUTE_PRESETS[ROUTE_PRESETS.length - 1];
}

/** Common visual journey: 入場 → 報到 → 鞋子 → 背包 → 地墊. */
export const COMMON_ROUTE_CHAIN: RouteType[] = ["entry", "registration", "shoe", "backpack", "seating"];

export function zoneCenterForRoute(project: { zones: { type: string; x: number; z: number }[] }, type: RouteType): { x: number; z: number } | null {
  const zoneType =
    type === "entry" ? null
      : type === "registration" ? "registration"
        : type === "shoe" ? "shoe"
          : type === "backpack" ? "backpack"
            : type === "seating" ? "mats"
              : type === "staff" ? "staff"
                : null;
  if (!zoneType) return null;
  const zone = project.zones.find((z) => z.type === zoneType)
    ?? (zoneType === "mats" ? project.zones.find((z) => z.type === "group" || z.type === "meditation") : undefined);
  return zone ? { x: zone.x, z: zone.z } : null;
}
