/**
 * 擺攤小物與文宣 — the props a stall is actually made of.
 *
 * `propPresets.ts` covers the interactive game props (dice, spinner, card box).
 * This file covers everything else a club carries to a stall: the little
 * acrylic and cardboard things that sit on the table, the printed collateral,
 * and the backdrop.
 *
 * Two rules shape every entry here:
 *
 * 1. **Real sizes.** A5 is 148 × 210 mm because ISO 216 says so; an X 展架 is
 *    600 × 1600 mm because that is the product every shop in Taiwan sells. The
 *    3D size is DERIVED from the print size via `metersFromTrim`, so the plan
 *    and the order form cannot disagree.
 * 2. **Anything printed carries a print spec.** A poster that is only a white
 *    plane tells you where it stands and nothing about what to order. With the
 *    spec attached, the material list can produce a line a printer can quote
 *    from.
 *
 * Sizes for the non-printed items (acrylic stands, boxes, trays) are ordinary
 * commercial sizes and are marked as such in `sizeNote` — they are what a shop
 * sells, not a standard anybody publishes.
 */

import { metersFromTrim, specFromStandard, type PrintMaterial } from "./printSpec";
import type { PropDefinition, PropPart } from "./model";

/** Extra provenance the Studio and the material list can show. */
export interface BoothPropMeta {
  /** Where the physical size comes from, in one line. */
  sizeNote: string;
  /** What it is for, in the words a club would use. */
  use: string;
}

export const BOOTH_PROP_META: Record<string, BoothPropMeta> = {};

function meta(id: string, m: BoothPropMeta): void {
  BOOTH_PROP_META[id] = m;
}

function part(
  id: string,
  shape: PropPart["shape"],
  size: PropPart["size"],
  offset: PropPart["offset"],
  extra: Partial<PropPart> = {},
): PropPart {
  return { id, shape, size, offset, ...extra };
}

/* ------------------------------------------------------------------ */
/* 文宣 — printed collateral                                           */
/* ------------------------------------------------------------------ */

/**
 * A printed sheet on a stand.
 *
 * The panel's metres come from the trim size, so changing the standard changes
 * the 3D object and the order line together.
 */
function printedOnStand(
  id: string,
  name: string,
  standardId: string,
  opts: {
    icon: string;
    material?: PrintMaterial;
    orientation?: "portrait" | "landscape";
    /** Height of the foot the panel sits on, metres. 0 = leans on a table. */
    footHeight: number;
    footDepth: number;
    quantity?: number;
    panelColor?: string;
    text?: string;
    placement?: PropDefinition["placement"];
  },
): PropDefinition {
  const spec = specFromStandard(standardId, {
    ...(opts.material ? { material: opts.material } : {}),
    ...(opts.orientation ? { orientation: opts.orientation } : {}),
    quantity: opts.quantity ?? 1,
  })!;
  const panel = metersFromTrim(spec);
  const footH = opts.footHeight;
  // A sheet that leans on a wall or a table IS its own footprint. The first
  // cut padded every width by `w * 0.9 + 0.08`, which made an A2 poster report
  // 46 cm instead of 42 — a number that matches nothing you can order.
  const footWidth = footH > 0 ? panel.width + 0.06 : 0;
  const width = Math.max(panel.width, footWidth);
  const height = footH + panel.height;

  const parts: PropPart[] = [];
  if (footH > 0) {
    parts.push(part("foot", "box",
      { width: footWidth, depth: opts.footDepth, height: footH },
      { x: 0, y: 0, z: 0 },
      { color: "#475569", finish: "painted-metal" }));
  }
  parts.push(part("panel", "plane",
    { width: panel.width, depth: 0.004, height: panel.height },
    { x: 0, y: footH, z: 0 },
    {
      color: opts.panelColor ?? "#f8fafc",
      finish: "paper",
      ...(opts.text ? { text: opts.text } : {}),
    }));

  return {
    id,
    name,
    category: "文宣",
    dimensions: { width, depth: Math.max(opts.footDepth, 0.02), height },
    parts,
    anchors: [],
    icon: opts.icon,
    version: 1,
    source: id,
    print: spec,
    ...(opts.placement ? { placement: opts.placement } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* 擺攤小物 — the things on the table                                  */
/* ------------------------------------------------------------------ */

const SMALL_ITEM_COLOR = "#cbd5e1";

/** Acrylic and cardboard items. Sizes are common retail sizes, not standards. */
function tableItem(
  id: string,
  name: string,
  dims: { width: number; depth: number; height: number },
  parts: PropPart[],
  icon: string,
  extra: Partial<Pick<PropDefinition, "placement">> = {},
): PropDefinition {
  return {
    id,
    name,
    category: "擺攤小物",
    // Small stall kit lives on a desk unless the caller says otherwise
    // (桌巾 drapes from the floor up; 垃圾桶 stands on the ground).
    placement: extra.placement ?? "tabletop",
    dimensions: dims,
    parts,
    anchors: [],
    icon,
    version: 1,
    source: id,
  };
}

/** Compact but physical fallback for ordinary stall kit. */
function simpleItem(
  id: string,
  name: string,
  dims: { width: number; depth: number; height: number },
  icon: string,
  color: string,
  text?: string,
  placement: PropDefinition["placement"] = "tabletop",
): PropDefinition {
  return tableItem(id, name, dims, [
    part("body", "box", dims, { x: 0, y: 0, z: 0 }, { color, finish: "plastic-matte", ...(text ? { text } : {}) }),
  ], icon, { placement });
}

/* ------------------------------------------------------------------ */

export const BOOTH_PROP_PRESETS: readonly PropDefinition[] = [
  /* ---------------- 文宣 ---------------- */
  printedOnStand("prop_xbanner", "X 展架", "x-banner", {
    icon: "🪧", footHeight: 0.02, footDepth: 0.35, material: "pp-synthetic",
    text: "主視覺", panelColor: "#e0f2fe",
  }),
  printedOnStand("prop_rollup", "易拉寶", "roll-up", {
    icon: "🎗", footHeight: 0.06, footDepth: 0.28, material: "pp-synthetic",
    text: "社團介紹", panelColor: "#ede9fe",
  }),
  printedOnStand("prop_poster_a1", "A1 海報", "A1", {
    icon: "📄", footHeight: 0.0, footDepth: 0.02, material: "matte-paper",
    text: "海報",
  }),
  printedOnStand("prop_poster_a2", "A2 海報", "A2", {
    icon: "📄", footHeight: 0.0, footDepth: 0.02, material: "matte-paper",
    text: "海報",
  }),
  printedOnStand("prop_foamboard_standee", "珍珠板立牌", "standee-a1", {
    icon: "🧍", footHeight: 0.03, footDepth: 0.3, material: "foam-board",
    text: "立牌",
  }),
  printedOnStand("prop_table_tent_a5", "桌上立牌 A5", "A5", {
    icon: "🔺", footHeight: 0.0, footDepth: 0.08, material: "coated-paper",
    text: "說明", placement: "tabletop",
  }),
  printedOnStand("prop_table_runner", "桌前布條", "table-runner", {
    // 1800 × 600 is already landscape; the standard's numbers are as-ordered.
    icon: "🎀", footHeight: 0.0, footDepth: 0.01, material: "canvas",
    text: "社團名稱",
  }),
  printedOnStand("prop_hanging_banner", "直式布條", "hanging-banner", {
    icon: "🏳", footHeight: 0.0, footDepth: 0.01, material: "canvas",
    text: "布條",
  }),

  /* ---------------- 背景圖 ---------------- */
  {
    id: "prop_backdrop",
    name: "合照背景牆",
    category: "背景",
    // 240 × 240 cm on a truss frame. The frame is what stands it up; the
    // fabric is what gets printed.
    dimensions: { width: 2.4, depth: 0.6, height: 2.45 },
    parts: [
      part("leg-l", "box", { width: 0.06, depth: 0.6, height: 2.4 }, { x: -1.17, y: 0, z: 0 },
        { color: "#64748b", finish: "brushed-metal" }),
      part("leg-r", "box", { width: 0.06, depth: 0.6, height: 2.4 }, { x: 1.17, y: 0, z: 0 },
        { color: "#64748b", finish: "brushed-metal" }),
      part("crossbar", "box", { width: 2.4, depth: 0.06, height: 0.06 }, { x: 0, y: 2.39, z: 0 },
        { color: "#64748b", finish: "brushed-metal" }),
      part("fabric", "plane", { width: 2.4, depth: 0.006, height: 2.4 }, { x: 0, y: 0, z: 0.02 },
        { color: "#f1f5f9", finish: "fabric", text: "背景主視覺" }),
    ],
    anchors: [
      { id: "photo", role: "player", x: 0, z: 1.2 },
    ],
    icon: "🖼",
    version: 1,
    source: "prop_backdrop",
    print: specFromStandard("backdrop-24", { material: "fabric" })!,
    clearance: 1.5,
  },
  {
    id: "prop_backdrop_wide",
    name: "大型合照背景牆",
    category: "背景",
    dimensions: { width: 3.0, depth: 0.6, height: 2.55 },
    parts: [
      part("leg-l", "box", { width: 0.06, depth: 0.6, height: 2.5 }, { x: -1.47, y: 0, z: 0 },
        { color: "#64748b", finish: "brushed-metal" }),
      part("leg-r", "box", { width: 0.06, depth: 0.6, height: 2.5 }, { x: 1.47, y: 0, z: 0 },
        { color: "#64748b", finish: "brushed-metal" }),
      part("crossbar", "box", { width: 3.0, depth: 0.06, height: 0.06 }, { x: 0, y: 2.49, z: 0 },
        { color: "#64748b", finish: "brushed-metal" }),
      part("fabric", "plane", { width: 3.0, depth: 0.006, height: 2.5 }, { x: 0, y: 0, z: 0.02 },
        { color: "#f1f5f9", finish: "fabric", text: "背景主視覺" }),
    ],
    anchors: [{ id: "photo", role: "player", x: 0, z: 1.4 }],
    icon: "🖼",
    version: 1,
    source: "prop_backdrop_wide",
    print: specFromStandard("backdrop-30", { material: "fabric" })!,
    clearance: 1.8,
  },

  /* ---------------- 擺攤小物 ---------------- */
  tableItem("prop_flyer_stand", "壓克力 DM 架", { width: 0.24, depth: 0.14, height: 0.3 }, [
    part("back", "plane", { width: 0.23, depth: 0.004, height: 0.3 }, { x: 0, y: 0, z: -0.05 },
      { color: "#e2e8f0", finish: "plastic-gloss" }),
    part("tray", "box", { width: 0.23, depth: 0.12, height: 0.03 }, { x: 0, y: 0, z: 0.01 },
      { color: "#e2e8f0", finish: "plastic-gloss" }),
    part("front", "plane", { width: 0.23, depth: 0.004, height: 0.12 }, { x: 0, y: 0.03, z: 0.06 },
      { color: "#cbd5e1", finish: "plastic-gloss" }),
  ], "📚"),

  // 0.07 high, not 0.06: the cards stand 2 cm proud of a 5 cm body, so the
  // declared footprint has to reach 6.5 cm. A part sticking out of its own
  // prop is how a placed object's collision box stops matching what you see.
  tableItem("prop_card_holder", "名片架", { width: 0.1, depth: 0.07, height: 0.07 }, [
    part("body", "box", { width: 0.1, depth: 0.07, height: 0.05 }, { x: 0, y: 0, z: 0 },
      { color: SMALL_ITEM_COLOR, finish: "plastic-gloss" }),
    part("cards", "box", { width: 0.09, depth: 0.055, height: 0.02 }, { x: 0, y: 0.045, z: 0 },
      { color: "#f8fafc", finish: "paper" }),
  ], "🪪"),

  // The lid overhangs the body by 5 mm a side and the coin slot stands proud
  // of the lid — the declared footprint has to cover both, or a placed box
  // collides with things its own geometry is already touching.
  tableItem("prop_raffle_box", "抽獎箱", { width: 0.31, depth: 0.31, height: 0.33 }, [
    part("body", "box", { width: 0.3, depth: 0.3, height: 0.3 }, { x: 0, y: 0, z: 0 },
      { color: "#e2e8f0", finish: "plastic-gloss", text: "抽獎" }),
    part("lid", "box", { width: 0.31, depth: 0.31, height: 0.02 }, { x: 0, y: 0.3, z: 0 },
      { color: "#94a3b8", finish: "plastic-matte" }),
    part("slot", "box", { width: 0.12, depth: 0.02, height: 0.01 }, { x: 0, y: 0.315, z: 0 },
      { color: "#1e293b", finish: "plastic-matte" }),
  ], "🎁"),

  tableItem("prop_donation_box", "募款箱", { width: 0.22, depth: 0.18, height: 0.26 }, [
    part("body", "box", { width: 0.22, depth: 0.18, height: 0.24 }, { x: 0, y: 0, z: 0 },
      { color: "#fde68a", finish: "plastic-matte", text: "隨喜" }),
    part("slot", "box", { width: 0.1, depth: 0.015, height: 0.01 }, { x: 0, y: 0.245, z: 0 },
      { color: "#1e293b", finish: "plastic-matte" }),
  ], "💛"),

  tableItem("prop_sample_tray", "試吃／樣品盤", { width: 0.32, depth: 0.24, height: 0.04 }, [
    part("tray", "box", { width: 0.32, depth: 0.24, height: 0.025 }, { x: 0, y: 0, z: 0 },
      { color: "#f8fafc", finish: "plastic-gloss" }),
    part("rim", "box", { width: 0.32, depth: 0.24, height: 0.015 }, { x: 0, y: 0.025, z: 0 },
      { color: "#cbd5e1", finish: "plastic-gloss" }),
  ], "🍬"),

  tableItem("prop_qr_stand", "QR 立架", { width: 0.1, depth: 0.08, height: 0.165 }, [
    part("foot", "box", { width: 0.1, depth: 0.08, height: 0.012 }, { x: 0, y: 0, z: 0 },
      { color: "#475569", finish: "plastic-matte" }),
    part("panel", "plane", { width: 0.1, depth: 0.004, height: 0.15 }, { x: 0, y: 0.012, z: 0 },
      { color: "#ffffff", finish: "paper", text: "QR" }),
  ], "▩"),

  tableItem("prop_stamp_station", "集章台", { width: 0.2, depth: 0.16, height: 0.09 }, [
    part("pad", "box", { width: 0.2, depth: 0.16, height: 0.03 }, { x: 0, y: 0, z: 0 },
      { color: "#334155", finish: "plastic-matte" }),
    part("stamp", "cylinder", { width: 0.05, depth: 0.05, height: 0.06 }, { x: 0.05, y: 0.03, z: 0 },
      { color: "#ef4444", finish: "plastic-gloss" }),
  ], "🔖"),

  tableItem("prop_prize_shelf", "獎品陳列架", { width: 0.6, depth: 0.28, height: 0.45 }, [
    part("side-l", "box", { width: 0.02, depth: 0.28, height: 0.45 }, { x: -0.29, y: 0, z: 0 },
      { color: "#c8b6a6", finish: "light-wood" }),
    part("side-r", "box", { width: 0.02, depth: 0.28, height: 0.45 }, { x: 0.29, y: 0, z: 0 },
      { color: "#c8b6a6", finish: "light-wood" }),
    part("shelf-low", "box", { width: 0.56, depth: 0.28, height: 0.02 }, { x: 0, y: 0.15, z: 0 },
      { color: "#c8b6a6", finish: "light-wood" }),
    part("shelf-high", "box", { width: 0.56, depth: 0.28, height: 0.02 }, { x: 0, y: 0.32, z: 0 },
      { color: "#c8b6a6", finish: "light-wood" }),
  ], "🏆"),

  tableItem("prop_tablecloth", "桌巾", { width: 1.82, depth: 0.79, height: 0.75 }, [
    // Drapes over a 180 × 75 table: the top, plus the front skirt that carries
    // the club's name at eye level for anyone walking past.
    part("top", "box", { width: 1.82, depth: 0.78, height: 0.006 }, { x: 0, y: 0.744, z: 0 },
      { color: "#1e3a5f", finish: "fabric" }),
    part("skirt", "plane", { width: 1.82, depth: 0.006, height: 0.74 }, { x: 0, y: 0, z: 0.39 },
      { color: "#1e3a5f", finish: "fabric", text: "社團名稱" }),
  ], "🟦", { placement: "floor" }),

  tableItem("prop_nameplate", "名牌", { width: 0.2, depth: 0.06, height: 0.12 }, [
    part("foot", "box", { width: 0.2, depth: 0.06, height: 0.012 }, { x: 0, y: 0, z: 0 },
      { color: "#475569", finish: "plastic-matte" }),
    part("card", "plane", { width: 0.2, depth: 0.004, height: 0.1 }, { x: 0, y: 0.012, z: 0 },
      { color: "#f8fafc", finish: "paper", text: "名牌" }),
  ], "🏷"),

  tableItem("prop_pen_cup", "筆筒", { width: 0.08, depth: 0.08, height: 0.12 }, [
    part("cup", "cylinder", { width: 0.08, depth: 0.08, height: 0.1 }, { x: 0, y: 0, z: 0 },
      { color: "#94a3b8", finish: "plastic-matte" }),
    part("pen", "cylinder", { width: 0.012, depth: 0.012, height: 0.12 }, { x: 0.012, y: 0, z: 0 },
      { color: "#38bdf8", finish: "plastic-gloss" }),
  ], "✏"),

  tableItem("prop_cash_box", "零錢盒", { width: 0.22, depth: 0.14, height: 0.06 }, [
    part("body", "box", { width: 0.22, depth: 0.14, height: 0.05 }, { x: 0, y: 0, z: 0 },
      { color: "#334155", finish: "plastic-matte" }),
    part("lid", "box", { width: 0.22, depth: 0.14, height: 0.01 }, { x: 0, y: 0.05, z: 0 },
      { color: "#475569", finish: "plastic-matte" }),
  ], "🪙"),

  tableItem("prop_power_strip", "延長線盤", { width: 0.28, depth: 0.1, height: 0.055 }, [
    part("body", "box", { width: 0.28, depth: 0.1, height: 0.04 }, { x: 0, y: 0, z: 0 },
      { color: "#1e293b", finish: "plastic-matte" }),
    part("socket-a", "box", { width: 0.04, depth: 0.04, height: 0.015 }, { x: -0.07, y: 0.04, z: 0 },
      { color: "#94a3b8", finish: "plastic-gloss" }),
    part("socket-b", "box", { width: 0.04, depth: 0.04, height: 0.015 }, { x: 0, y: 0.04, z: 0 },
      { color: "#94a3b8", finish: "plastic-gloss" }),
    part("socket-c", "box", { width: 0.04, depth: 0.04, height: 0.015 }, { x: 0.07, y: 0.04, z: 0 },
      { color: "#94a3b8", finish: "plastic-gloss" }),
  ], "⚡"),

  tableItem("prop_table_flag", "桌旗", { width: 0.22, depth: 0.08, height: 0.28 }, [
    part("base", "box", { width: 0.08, depth: 0.08, height: 0.02 }, { x: 0, y: 0, z: 0 },
      { color: "#475569", finish: "plastic-matte" }),
    part("pole", "cylinder", { width: 0.012, depth: 0.012, height: 0.26 }, { x: 0, y: 0.02, z: 0 },
      { color: "#64748b", finish: "brushed-metal" }),
    part("flag", "plane", { width: 0.12, depth: 0.004, height: 0.08 }, { x: 0.05, y: 0.18, z: 0 },
      { color: "#e0f2fe", finish: "fabric", text: "社" }),
  ], "🚩"),

  tableItem("prop_document_tray", "文件盤", { width: 0.33, depth: 0.24, height: 0.05 }, [
    part("base", "box", { width: 0.33, depth: 0.24, height: 0.02 }, { x: 0, y: 0, z: 0 },
      { color: "#e2e8f0", finish: "plastic-matte" }),
    part("front", "box", { width: 0.33, depth: 0.012, height: 0.05 }, { x: 0, y: 0, z: 0.114 },
      { color: "#cbd5e1", finish: "plastic-matte" }),
  ], "📁"),

  // Activity tables need more than generic market hardware. These small items
  // are deliberately physical (a lip, a cup rim, a card stack) so organisers
  // can judge a real tabletop arrangement at high zoom without importing a
  // heavyweight model for every paper item.
  tableItem("prop_a4_flyers", "A4 傳單一疊", { width: 0.22, depth: 0.3, height: 0.025 }, [
    part("paper", "box", { width: 0.21, depth: 0.297, height: 0.018 }, { x: 0, y: 0, z: 0 }, { color: "#f8fafc", finish: "paper", text: "活動資訊" }),
    part("edge", "box", { width: 0.22, depth: 0.3, height: 0.007 }, { x: 0, y: 0.018, z: 0 }, { color: "#cbd5e1", finish: "paper" }),
  ], "📄"),
  tableItem("prop_trifold", "三折頁", { width: 0.3, depth: 0.08, height: 0.21 }, [
    part("leaflet", "plane", { width: 0.3, depth: 0.004, height: 0.21 }, { x: 0, y: 0, z: 0 }, { color: "#fef3c7", finish: "paper", text: "社團介紹" }),
    part("base", "box", { width: 0.3, depth: 0.08, height: 0.012 }, { x: 0, y: 0, z: 0 }, { color: "#94a3b8", finish: "plastic-matte" }),
  ], "📰"),
  tableItem("prop_tea_pot", "茶壺", { width: 0.18, depth: 0.18, height: 0.15 }, [
    part("body", "cylinder", { width: 0.14, depth: 0.14, height: 0.1 }, { x: 0, y: 0, z: 0 }, { color: "#8b5e3c", finish: "ceramic" }),
    part("lid", "cylinder", { width: 0.1, depth: 0.1, height: 0.025 }, { x: 0, y: 0.1, z: 0 }, { color: "#a46d42", finish: "ceramic" }),
    part("handle", "box", { width: 0.04, depth: 0.08, height: 0.08 }, { x: -0.08, y: 0.025, z: 0 }, { color: "#8b5e3c", finish: "ceramic" }),
    part("spout", "box", { width: 0.08, depth: 0.05, height: 0.04 }, { x: 0.09, y: 0.045, z: 0 }, { color: "#8b5e3c", finish: "ceramic" }),
  ], "🍵"),
  tableItem("prop_tea_cup", "茶杯", { width: 0.07, depth: 0.07, height: 0.055 }, [
    part("cup", "cylinder", { width: 0.065, depth: 0.065, height: 0.05 }, { x: 0, y: 0, z: 0 }, { color: "#f5f1e8", finish: "ceramic" }),
  ], "☕"),
  tableItem("prop_tea_tray", "茶盤", { width: 0.36, depth: 0.22, height: 0.03 }, [
    part("tray", "box", { width: 0.36, depth: 0.22, height: 0.02 }, { x: 0, y: 0, z: 0 }, { color: "#8a6545", finish: "dark-wood" }),
    part("inset", "box", { width: 0.31, depth: 0.17, height: 0.01 }, { x: 0, y: 0.02, z: 0 }, { color: "#b89063", finish: "light-wood" }),
  ], "🫖"),
  tableItem("prop_zen_card", "禪語卡", { width: 0.1, depth: 0.07, height: 0.004 }, [
    part("card", "box", { width: 0.1, depth: 0.07, height: 0.004 }, { x: 0, y: 0, z: 0 }, { color: "#fff7ed", finish: "paper", text: "安心" }),
  ], "🪷"),
  tableItem("prop_dice_tabletop", "桌上骰子", { width: 0.04, depth: 0.04, height: 0.04 }, [
    part("dice", "box", { width: 0.04, depth: 0.04, height: 0.04 }, { x: 0, y: 0, z: 0 }, { color: "#f8fafc", finish: "plastic-gloss", text: "•" }),
  ], "🎲"),
  tableItem("prop_turtle_card", "龜龜角色牌", { width: 0.16, depth: 0.08, height: 0.18 }, [
    part("foot", "box", { width: 0.1, depth: 0.08, height: 0.015 }, { x: 0, y: 0, z: 0 }, { color: "#64748b", finish: "plastic-matte" }),
    part("card", "plane", { width: 0.16, depth: 0.004, height: 0.16 }, { x: 0, y: 0.015, z: 0 }, { color: "#bbf7d0", finish: "paper", text: "龜龜" }),
  ], "🐢"),
  tableItem("prop_tablet", "平板", { width: 0.25, depth: 0.18, height: 0.015 }, [
    part("body", "box", { width: 0.25, depth: 0.18, height: 0.012 }, { x: 0, y: 0, z: 0 }, { color: "#334155", finish: "brushed-metal" }),
    part("screen", "box", { width: 0.22, depth: 0.15, height: 0.003 }, { x: 0, y: 0.012, z: 0 }, { color: "#bae6fd", finish: "screen-glass", text: "報名" }),
  ], "▣"),
  tableItem("prop_speaker", "小音箱", { width: 0.13, depth: 0.09, height: 0.08 }, [
    part("body", "box", { width: 0.13, depth: 0.09, height: 0.08 }, { x: 0, y: 0, z: 0 }, { color: "#1e293b", finish: "plastic-matte" }),
    part("cone", "cylinder", { width: 0.055, depth: 0.055, height: 0.01 }, { x: 0, y: 0.035, z: 0 }, { color: "#94a3b8", finish: "brushed-metal" }),
  ], "🔊"),

  // 社團攤位的一桌，通常不是只有一個 QR 牌。以下是能直接拖進桌面、
  // 以市售常見尺寸為起點的桌面套件；每個仍可在屬性中改為實際尺寸。
  tableItem("prop_mini_blackboard", "小黑板", { width: 0.22, depth: 0.1, height: 0.19 }, [
    part("board", "plane", { width: 0.22, depth: 0.006, height: 0.16 }, { x: 0, y: 0.025, z: 0 }, { color: "#1f2937", finish: "painted-metal", text: "今日活動" }),
    part("foot", "box", { width: 0.2, depth: 0.1, height: 0.025 }, { x: 0, y: 0, z: 0 }, { color: "#8a6545", finish: "light-wood" }),
  ], "▤"),
  tableItem("prop_price_card", "價格牌", { width: 0.12, depth: 0.06, height: 0.1 }, [
    part("card", "plane", { width: 0.12, depth: 0.004, height: 0.085 }, { x: 0, y: 0.012, z: 0 }, { color: "#fef3c7", finish: "paper", text: "$" }),
    part("foot", "box", { width: 0.1, depth: 0.06, height: 0.012 }, { x: 0, y: 0, z: 0 }, { color: "#a16207", finish: "light-wood" }),
  ], "💲"),
  tableItem("prop_opinion_box", "意見箱", { width: 0.2, depth: 0.16, height: 0.19 }, [
    part("box", "box", { width: 0.2, depth: 0.16, height: 0.17 }, { x: 0, y: 0, z: 0 }, { color: "#dbeafe", finish: "plastic-matte", text: "建議" }),
    part("slot", "box", { width: 0.09, depth: 0.015, height: 0.01 }, { x: 0, y: 0.17, z: 0 }, { color: "#1e293b", finish: "plastic-matte" }),
  ], "💬"),
  simpleItem("prop_phone", "手機", { width: 0.075, depth: 0.155, height: 0.01 }, "▯", "#334155", "報名"),
  simpleItem("prop_aroma", "香氛擴香", { width: 0.075, depth: 0.075, height: 0.12 }, "◌", "#d8b4fe"),
  tableItem("prop_buddha", "小佛像", { width: 0.12, depth: 0.1, height: 0.17 }, [
    part("base", "box", { width: 0.12, depth: 0.1, height: 0.025 }, { x: 0, y: 0, z: 0 }, { color: "#a16207", finish: "brushed-metal" }),
    part("figure", "sphere", { width: 0.09, depth: 0.09, height: 0.13 }, { x: 0, y: 0.025, z: 0 }, { color: "#d4a72c", finish: "brushed-metal" }),
  ], "🪷"),
  tableItem("prop_succulent", "小盆栽", { width: 0.11, depth: 0.11, height: 0.16 }, [
    part("pot", "cylinder", { width: 0.1, depth: 0.1, height: 0.07 }, { x: 0, y: 0, z: 0 }, { color: "#b45309", finish: "ceramic" }),
    part("leaf", "sphere", { width: 0.1, depth: 0.1, height: 0.1 }, { x: 0, y: 0.06, z: 0 }, { color: "#4d7c0f", finish: "plastic-matte" }),
  ], "🪴"),
  simpleItem("prop_zen_stones", "禪意石頭", { width: 0.14, depth: 0.09, height: 0.035 }, "●", "#64748b"),
  tableItem("prop_wood_sign", "木牌", { width: 0.18, depth: 0.07, height: 0.14 }, [
    part("panel", "plane", { width: 0.18, depth: 0.006, height: 0.12 }, { x: 0, y: 0.012, z: 0 }, { color: "#a16207", finish: "light-wood", text: "平安" }),
    part("foot", "box", { width: 0.16, depth: 0.07, height: 0.012 }, { x: 0, y: 0, z: 0 }, { color: "#78350f", finish: "dark-wood" }),
  ], "▥"),
  simpleItem("prop_wish_cards", "祈願卡一疊", { width: 0.1, depth: 0.15, height: 0.018 }, "♡", "#fce7f3", "祈願"),
  simpleItem("prop_color_pens", "彩色筆組", { width: 0.16, depth: 0.07, height: 0.025 }, "🖍", "#fda4af"),
  simpleItem("prop_stamp_cards", "集章卡", { width: 0.09, depth: 0.055, height: 0.01 }, "▦", "#fde68a", "集章"),
  simpleItem("prop_gift_bag", "小禮物袋", { width: 0.13, depth: 0.08, height: 0.16 }, "🎀", "#f9a8d4"),
  tableItem("prop_mascot", "吉祥物公仔", { width: 0.11, depth: 0.1, height: 0.16 }, [
    part("body", "sphere", { width: 0.1, depth: 0.1, height: 0.12 }, { x: 0, y: 0.02, z: 0 }, { color: "#86efac", finish: "plastic-gloss" }),
    part("base", "cylinder", { width: 0.11, depth: 0.11, height: 0.02 }, { x: 0, y: 0, z: 0 }, { color: "#64748b", finish: "plastic-matte" }),
  ], "🐢"),
  tableItem("prop_vase_flowers", "花瓶與花", { width: 0.12, depth: 0.12, height: 0.22 }, [
    part("vase", "cylinder", { width: 0.09, depth: 0.09, height: 0.12 }, { x: 0, y: 0, z: 0 }, { color: "#bae6fd", finish: "ceramic" }),
    part("flower", "sphere", { width: 0.12, depth: 0.12, height: 0.1 }, { x: 0, y: 0.12, z: 0 }, { color: "#f9a8d4", finish: "plastic-matte" }),
  ], "💐"),
  tableItem("prop_night_light", "小夜燈", { width: 0.09, depth: 0.09, height: 0.13 }, [
    part("base", "cylinder", { width: 0.09, depth: 0.09, height: 0.03 }, { x: 0, y: 0, z: 0 }, { color: "#475569", finish: "plastic-matte" }),
    part("shade", "sphere", { width: 0.08, depth: 0.08, height: 0.1 }, { x: 0, y: 0.03, z: 0 }, { color: "#fde68a", finish: "plastic-gloss" }),
  ], "💡"),
  simpleItem("prop_basket", "小籃子", { width: 0.22, depth: 0.16, height: 0.1 }, "🧺", "#b89063"),
  simpleItem("prop_storage_box", "收納盒", { width: 0.25, depth: 0.18, height: 0.1 }, "□", "#cbd5e1"),
  simpleItem("prop_string_lights", "燈串", { width: 0.35, depth: 0.04, height: 0.03 }, "✦", "#fde68a"),
  simpleItem("prop_balloon_cluster", "氣球組", { width: 0.2, depth: 0.15, height: 0.3 }, "●", "#f9a8d4", undefined, "floor"),
  simpleItem("prop_floor_cushion", "靜坐墊", { width: 0.45, depth: 0.45, height: 0.08 }, "◒", "#475569", undefined, "floor"),
  simpleItem("prop_cardboard_box", "紙箱", { width: 0.38, depth: 0.28, height: 0.26 }, "▣", "#c8b6a6", undefined, "floor"),

  tableItem("prop_trash_bin", "垃圾桶", { width: 0.32, depth: 0.32, height: 0.7 }, [
    part("body", "cylinder", { width: 0.3, depth: 0.3, height: 0.62 }, { x: 0, y: 0, z: 0 },
      { color: "#64748b", finish: "plastic-matte" }),
    part("rim", "cylinder", { width: 0.32, depth: 0.32, height: 0.04 }, { x: 0, y: 0.62, z: 0 },
      { color: "#475569", finish: "plastic-matte" }),
    part("liner", "cylinder", { width: 0.26, depth: 0.26, height: 0.04 }, { x: 0, y: 0.66, z: 0 },
      { color: "#1e293b", finish: "plastic-matte" }),
  ], "🗑", { placement: "floor" }),
];

meta("prop_xbanner", { sizeNote: "60 × 160 cm，市售 X 展架標準品", use: "攤位側邊主視覺" });
meta("prop_rollup", { sizeNote: "80 × 200 cm，市售易拉寶標準品", use: "攤位正面主視覺" });
meta("prop_poster_a1", { sizeNote: "ISO 216 A1，594 × 841 mm", use: "海報" });
meta("prop_poster_a2", { sizeNote: "ISO 216 A2，420 × 594 mm", use: "海報" });
meta("prop_foamboard_standee", { sizeNote: "A1 珍珠板裱板", use: "立牌" });
meta("prop_table_tent_a5", { sizeNote: "ISO 216 A5，148 × 210 mm", use: "桌上說明牌" });
meta("prop_table_runner", { sizeNote: "180 × 60 cm，配合 6 呎桌前緣", use: "掛在攤位桌前" });
meta("prop_hanging_banner", { sizeNote: "90 × 300 cm，市售直式布條", use: "懸掛式布條" });
meta("prop_backdrop", { sizeNote: "240 × 240 cm 桁架背板", use: "合照背景牆" });
meta("prop_backdrop_wide", { sizeNote: "300 × 250 cm 桁架背板", use: "大型合照背景牆" });
meta("prop_flyer_stand", { sizeNote: "A4 直式壓克力 DM 架，市售常見尺寸", use: "放傳單" });
meta("prop_card_holder", { sizeNote: "名片尺寸 91 × 55 mm 對應架", use: "放名片" });
meta("prop_raffle_box", { sizeNote: "30 cm 見方壓克力箱，市售常見尺寸", use: "抽獎、投票" });
meta("prop_donation_box", { sizeNote: "市售隨喜箱常見尺寸", use: "隨喜、募款" });
meta("prop_sample_tray", { sizeNote: "市售長方托盤常見尺寸", use: "試吃、樣品" });
meta("prop_qr_stand", { sizeNote: "市售小型壓克力立架", use: "掃碼加入、線上報名" });
meta("prop_stamp_station", { sizeNote: "市售印台與印章", use: "集章活動" });
meta("prop_prize_shelf", { sizeNote: "市售兩層小陳列架", use: "獎品陳列" });
meta("prop_tablecloth", { sizeNote: "配合 180 × 75 cm 折疊桌", use: "桌巾＋桌前主視覺" });
meta("prop_nameplate", { sizeNote: "20 × 10 cm 桌面名牌，市售常見尺寸", use: "報到桌／攤位工作人員名牌" });
meta("prop_pen_cup", { sizeNote: "市售圓形筆筒常見尺寸", use: "放筆、簽字筆" });
meta("prop_cash_box", { sizeNote: "市售小型零錢盒", use: "現場收費找零" });
meta("prop_power_strip", { sizeNote: "市售三孔延長線盤", use: "筆電、收費機電源" });
meta("prop_table_flag", { sizeNote: "市售小型桌旗座", use: "社團名／活動名" });
meta("prop_document_tray", { sizeNote: "A4 文件盤，市售常見尺寸", use: "報名表、問卷" });
meta("prop_a4_flyers", { sizeNote: "A4 210 × 297 mm；單張紙疊的示意厚度", use: "招生傳單" });
meta("prop_trifold", { sizeNote: "常見三折頁展開 300 × 210 mm", use: "社團介紹" });
meta("prop_tea_pot", { sizeNote: "以小型茶席茶壺為可調整示意尺寸", use: "茶會桌面" });
meta("prop_tea_cup", { sizeNote: "以小型茶杯為可調整示意尺寸", use: "茶會桌面" });
meta("prop_tea_tray", { sizeNote: "以桌上茶盤為可調整示意尺寸", use: "茶會桌面" });
meta("prop_zen_card", { sizeNote: "以名片尺寸禪語卡為預設", use: "互動／帶走卡片" });
meta("prop_dice_tabletop", { sizeNote: "以 4 cm 桌上骰子為預設", use: "互動遊戲" });
meta("prop_turtle_card", { sizeNote: "以 16 cm 桌上角色牌為預設", use: "活動辨識／互動" });
meta("prop_tablet", { sizeNote: "以 10 吋平板外觀尺寸為預設", use: "報名／展示" });
meta("prop_speaker", { sizeNote: "以小型藍牙音箱為預設", use: "活動聲音提示" });
meta("prop_trash_bin", { sizeNote: "市售小型垃圾桶常見尺寸", use: "攤位旁垃圾" });

// New tabletop kit uses conservative, common retail footprints. It is an
// editable starting point, never a claim that a particular club owns exactly
// this size; organisers can overwrite dimensions after on-site measurement.
for (const prop of BOOTH_PROP_PRESETS) {
  if (!BOOTH_PROP_META[prop.id]) {
    meta(prop.id, {
      sizeNote: "市售常見尺寸的可調整起點；請依實物量測後修改",
      use: `攤位桌面佈置：${prop.name}`,
    });
  }
}

const BY_ID = new Map(BOOTH_PROP_PRESETS.map((p) => [p.id, p]));

export function boothPropPreset(id: string): PropDefinition | undefined {
  const found = BY_ID.get(id);
  return found ? structuredClone(found) : undefined;
}

export function boothPropIds(): string[] {
  return BOOTH_PROP_PRESETS.map((p) => p.id);
}

/** Presets grouped the way the Studio's picker shows them. */
export function boothPropsByCategory(category: string): PropDefinition[] {
  return BOOTH_PROP_PRESETS.filter((p) => p.category === category).map((p) => structuredClone(p));
}
