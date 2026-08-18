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
