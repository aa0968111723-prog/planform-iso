/**
 * First-layer product path.
 *
 * A volunteer only needs to understand:
 *   我的專案 → 場地 → 場佈 → 動線／互動 → 彩排 → 分享
 *
 * Engineering terms (Props / DES / Catalog / Provider / Mesh / JSON /
 * Simulation Seed) stay out of this list. `check` is not a first-layer tab —
 * it lives at the top of 分享 as the pre-export checklist.
 */

export const FIRST_LAYER_PATH = [
  "我的專案",
  "場地",
  "場佈",
  "動線／互動",
  "彩排",
  "分享",
] as const;

export const PRIMARY_WORKFLOWS = [
  { id: "site", label: "場地", icon: "▦" },
  { id: "layout", label: "場佈", icon: "▤" },
  { id: "route", label: "動線／互動", icon: "↝" },
  { id: "sim", label: "彩排", icon: "▶" },
  { id: "export", label: "分享", icon: "↗" },
] as const;

export type PrimaryWorkflowId = (typeof PRIMARY_WORKFLOWS)[number]["id"];

export const WORKFLOW_LABELS: Record<string, string> = {
  site: "場地",
  layout: "場佈",
  route: "動線／互動",
  sim: "彩排",
  check: "檢查",
  export: "分享",
};
