/**
 * A recipe → a PropDefinition.
 *
 * §35's 「AI 幫我做一個道具」 without letting a model near the project. The
 * agent emits a RECIPE — a name, a kind, a size, a colour, and for a game the
 * faces and what is written on them. This turns that into a definition using
 * the same presets and the same builders the Studio uses, so an AI-made prop
 * and a hand-made one are the same kind of object and land in the same
 * draft → 預覽 → 套用/取消 loop.
 *
 * Deliberately NOT here: geometry from a prompt, image→3D, or anything that
 * would make an AI prop unopenable in the Studio. A recipe can only ask for
 * things a person could have built by hand, which is what keeps 「AI 幫我做」
 * an accelerator rather than a separate, unmaintainable path.
 */

import { propPreset } from "./propPresets";
import { BOOTH_PROP_META } from "./boothPropPresets";
import { describePrintSpec, metersFromTrim, specFromStandard, type PrintSpec } from "./printSpec";
import type { InteractionOption, PropDefinition } from "./model";

export interface PropRecipe {
  name: string;
  /** A preset to start from. Unknown or missing falls back to a plain box. */
  kind?: string;
  dimensions?: { width: number; depth: number; height: number };
  color?: string;
  faces?: { label: string; color?: string; prompt?: string }[];
  interactive?: boolean;
  /**
   * Words to print on the prop's main face — a poster headline, the club name
   * on a table runner, 「掃我報名」 on a QR stand.
   *
   * Applied to the LAST part, which for every printed preset here is the
   * printable panel; the foot and the frame come first. Painted as a texture,
   * not 3D type, exactly like the existing `PropPart.text`.
   */
  text?: string;
  /** An image blob already in the asset store, painted on the same face. */
  imageBlobId?: string;
  /**
   * Order this at a real print size.
   *
   * A standard id (`A4`, `x-banner`, `backdrop-24`…) resizes the 3D panel to
   * the trim size AND attaches the order line. Giving a size on the plan and a
   * different size to the printer is the failure this prevents.
   */
  print?: {
    standard?: string;
    widthMm?: number;
    heightMm?: number;
    orientation?: "portrait" | "landscape";
    sides?: 1 | 2;
    material?: string;
    quantity?: number;
    finishNote?: string;
  };
}

/** Recipe words → preset ids. Everything else becomes a plain box. */
const KIND_PRESETS: Record<string, string> = {
  dice: "prop_dice",
  骰子: "prop_dice",
  spinner: "prop_spinner",
  轉盤: "prop_spinner",
  cardbox: "prop_cardbox",
  抽卡箱: "prop_cardbox",
  box: "prop_box",
  箱子: "prop_box",
  table: "prop_table",
  桌子: "prop_table",
  screen: "prop_screen",
  螢幕: "prop_screen",
  sign: "prop_standee",
  立牌: "prop_standee",
  button: "prop_button",
  按鈕: "prop_button",

  // --- 文宣 -------------------------------------------------------------
  poster: "prop_poster_a2",
  海報: "prop_poster_a2",
  a1海報: "prop_poster_a1",
  a2海報: "prop_poster_a2",
  xbanner: "prop_xbanner",
  x展架: "prop_xbanner",
  展架: "prop_xbanner",
  rollup: "prop_rollup",
  易拉寶: "prop_rollup",
  拉捲式: "prop_rollup",
  standee: "prop_foamboard_standee",
  珍珠板立牌: "prop_foamboard_standee",
  桌牌: "prop_table_tent_a5",
  桌上立牌: "prop_table_tent_a5",
  桌前布條: "prop_table_runner",
  桌裙: "prop_table_runner",
  布條: "prop_hanging_banner",
  直式布條: "prop_hanging_banner",

  // --- 背景 -------------------------------------------------------------
  backdrop: "prop_backdrop",
  背景: "prop_backdrop",
  背景牆: "prop_backdrop",
  背板: "prop_backdrop",
  合照背景: "prop_backdrop",
  大背景: "prop_backdrop_wide",

  // --- 擺攤小物 ---------------------------------------------------------
  傳單架: "prop_flyer_stand",
  dm架: "prop_flyer_stand",
  文宣架: "prop_flyer_stand",
  名片架: "prop_card_holder",
  抽獎箱: "prop_raffle_box",
  投票箱: "prop_raffle_box",
  募款箱: "prop_donation_box",
  隨喜箱: "prop_donation_box",
  試吃盤: "prop_sample_tray",
  樣品盤: "prop_sample_tray",
  qr立架: "prop_qr_stand",
  qr架: "prop_qr_stand",
  集章台: "prop_stamp_station",
  獎品架: "prop_prize_shelf",
  陳列架: "prop_prize_shelf",
  桌巾: "prop_tablecloth",
  名牌: "prop_nameplate",
  名牌架: "prop_nameplate",
  筆筒: "prop_pen_cup",
  零錢盒: "prop_cash_box",
  收銀盒: "prop_cash_box",
  延長線: "prop_power_strip",
  延長線盤: "prop_power_strip",
  桌旗: "prop_table_flag",
  文件盤: "prop_document_tray",
  資料盤: "prop_document_tray",
  垃圾桶: "prop_trash_bin",
};

const DEFAULT_FACE_COLORS = ["#38bdf8", "#34d399", "#fbbf24", "#f472b6", "#a78bfa", "#fb923c"];

function plainBox(name: string): PropDefinition {
  return {
    id: "prop_recipe",
    name,
    category: "互動",
    dimensions: { width: 0.6, depth: 0.6, height: 0.6 },
    parts: [{
      id: "body", shape: "box",
      size: { width: 0.6, depth: 0.6, height: 0.6 },
      offset: { x: 0, y: 0, z: 0 },
      color: "#8fb4c9", finish: "plastic-matte",
    }],
    anchors: [],
    icon: "▦",
    version: 1,
    source: "agent",
  };
}

/** Scale a definition's parts and anchors to new outer dimensions. */
function scaleTo(def: PropDefinition, dims: { width: number; depth: number; height: number }): PropDefinition {
  const sx = dims.width / def.dimensions.width;
  const sy = dims.height / def.dimensions.height;
  const sz = dims.depth / def.dimensions.depth;
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(sz)) return def;
  return {
    ...def,
    dimensions: { ...dims },
    parts: def.parts.map((p) => ({
      ...p,
      size: { width: p.size.width * sx, depth: p.size.depth * sz, height: p.size.height * sy },
      offset: { x: p.offset.x * sx, y: p.offset.y * sy, z: p.offset.z * sz },
    })),
    anchors: def.anchors.map((a) => ({ ...a, x: a.x * sx, z: a.z * sz })),
  };
}

/**
 * Build a definition from a recipe. Pure, total, and never throws: an
 * unrecognised kind is a plain box, a silly size is clamped, and a game with
 * no faces keeps whatever the preset had.
 */
export function propFromRecipe(recipe: PropRecipe, id: string): PropDefinition {
  const presetId = recipe.kind ? KIND_PRESETS[recipe.kind.toLowerCase()] ?? KIND_PRESETS[recipe.kind] : undefined;
  const base = (presetId && propPreset(presetId)) || plainBox(recipe.name);

  // `source` becomes "agent" so the Studio shows where it came from, which
  // loses the preset id — and with it the preset's use note. Keep it.
  const basePresetId = base.source;
  let def: PropDefinition = { ...base, id, name: recipe.name || base.name, source: "agent", version: 1 };

  if (recipe.dimensions) {
    const clamp = (v: number, min: number, max: number) =>
      Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min;
    def = scaleTo(def, {
      width: clamp(recipe.dimensions.width, 0.05, 6),
      depth: clamp(recipe.dimensions.depth, 0.05, 6),
      height: clamp(recipe.dimensions.height, 0.05, 4),
    });
  }

  if (recipe.color) {
    def = { ...def, parts: def.parts.map((p, i) => (i === 0 ? { ...p, color: recipe.color } : p)) };
  }

  // Faces replace the game's options, one record per face — the same record
  // the 3D face, the panel row and the result display all read.
  if (recipe.faces?.length && def.interaction) {
    const options: InteractionOption[] = recipe.faces.map((f, i) => ({
      id: `f${i + 1}`,
      label: f.label || `第 ${i + 1} 面`,
      weight: 1,
      color: f.color ?? DEFAULT_FACE_COLORS[i % DEFAULT_FACE_COLORS.length],
      ...(f.prompt ? { prompt: f.prompt } : {}),
    }));
    def = {
      ...def,
      interaction: {
        ...def.interaction,
        steps: def.interaction.steps.map((st) => (st.branch?.kind === "chance"
          ? { ...st, branch: { ...st.branch, options } }
          : st)),
      },
    };
  }

  // --- printed collateral ------------------------------------------------
  // The print spec is applied BEFORE text so the panel is already the right
  // shape when the words land on it, and AFTER `dimensions` so an explicit
  // print size wins over a hand-typed one — asking for A3 and getting a
  // 60 cm plane is the exact mismatch this whole block exists to prevent.
  if (recipe.print) {
    def = applyPrint(def, recipe.print);
  }

  // Words and artwork go on the LAST part: every printed preset here builds
  // foot-then-panel, so the panel is last. A prop with one part gets it there.
  if (recipe.text || recipe.imageBlobId) {
    const lastIndex = def.parts.length - 1;
    def = {
      ...def,
      parts: def.parts.map((p, i) => (i === lastIndex
        ? {
          ...p,
          ...(recipe.text ? { text: recipe.text } : {}),
          ...(recipe.imageBlobId ? { imageBlobId: recipe.imageBlobId } : {}),
        }
        : p)),
    };
  }

  // 「做一個裝飾用的」 — an explicit no turns the game off; a prop with no
  // preset interaction stays decorative either way.
  if (recipe.interactive === false && def.interaction) {
    def = { ...def, interaction: undefined };
  }

  // Carried so `describeRecipe` can still name what the thing is for. Not part
  // of PropDefinition: it is provenance for the preview card, not plan data.
  return basePresetId ? Object.assign(def, { basePresetId }) : def;
}

const PRINT_MATERIALS = new Set([
  "coated-paper", "matte-paper", "sticker", "pp-synthetic", "canvas",
  "foam-board", "acrylic", "fabric", "corrugated",
]);

/**
 * Attach an order line and resize the printable panel to match it.
 *
 * The panel is the last part by construction. Its metres come from the trim
 * size, and the definition's overall footprint grows with it, so a poster that
 * says A1 on the order form occupies A1 on the plan.
 */
function applyPrint(def: PropDefinition, want: NonNullable<PropRecipe["print"]>): PropDefinition {
  const fromStandard = want.standard ? specFromStandard(want.standard) : null;
  const widthMm = want.widthMm ?? fromStandard?.widthMm;
  const heightMm = want.heightMm ?? fromStandard?.heightMm;
  // Nothing usable to print at: leave the definition exactly as it was rather
  // than inventing a size.
  if (!widthMm || !heightMm || widthMm <= 0 || heightMm <= 0) return def;

  const material = want.material && PRINT_MATERIALS.has(want.material)
    ? want.material
    : fromStandard?.material ?? def.print?.material ?? "coated-paper";

  const spec: NonNullable<PropDefinition["print"]> = {
    widthMm: Math.round(Math.min(5000, Math.max(10, widthMm))),
    heightMm: Math.round(Math.min(5000, Math.max(10, heightMm))),
    ...(fromStandard?.standard ? { standard: fromStandard.standard } : {}),
    orientation: want.orientation ?? fromStandard?.orientation ?? "portrait",
    sides: want.sides === 2 ? 2 : 1,
    material,
    quantity: Math.round(Math.min(10000, Math.max(1, want.quantity ?? def.print?.quantity ?? 1))),
    bleedMm: fromStandard?.bleedMm ?? def.print?.bleedMm ?? 3,
    ...(want.finishNote ? { finishNote: want.finishNote } : {}),
  };

  const panel = metersFromTrim(spec);
  const lastIndex = def.parts.length - 1;
  const foot = lastIndex > 0 ? def.parts[0] : null;
  // The foot scales with the panel: an A5 card on an A1 poster's foot is not a
  // thing you can buy, and leaving the old foot behind is what made an A5
  // flyer report a 46 cm footprint — the A2 preset's width, kept by a max().
  // The foot keeps its 6 cm overhang at the new panel width, rather than being
  // scaled by a ratio that compounds every time the size changes.
  const footScale = foot ? (panel.width + 0.06) / foot.size.width : 1;
  const parts = def.parts.map((p, i) => {
    if (i === lastIndex) {
      return { ...p, size: { ...p.size, width: panel.width, height: panel.height } };
    }
    return {
      ...p,
      size: { ...p.size, width: p.size.width * footScale },
    };
  });

  // The footprint is DERIVED, never maxed with the value it is replacing:
  // taking the larger of old and new means a smaller print can never shrink
  // the object, and the plan then reserves space for a poster nobody ordered.
  const footHeight = foot ? def.parts[lastIndex].offset.y : 0;
  const width = foot ? Math.max(panel.width, foot.size.width * footScale) : panel.width;
  return {
    ...def,
    parts,
    dimensions: {
      width,
      depth: def.dimensions.depth,
      height: footHeight + panel.height,
    },
    print: spec,
  };
}

/** One sentence describing what a recipe will produce, for the preview card. */
export function describeRecipe(def: PropDefinition): string {
  const cm = (m: number) => Math.round(m * 100);
  const size = `${cm(def.dimensions.width)}×${cm(def.dimensions.depth)}×${cm(def.dimensions.height)} cm`;
  const faces = def.interaction?.steps
    .find((s) => s.branch?.kind === "chance")?.branch;
  const count = faces?.kind === "chance" ? faces.options.length : 0;
  // A printed prop's headline fact is the ORDER, not the box size: the club
  // has to send something to a printer, and 「60 公分寬」 is not something a
  // printer can quote from.
  if (def.print) {
    return `${def.name}：${describePrintSpec(def.print as PrintSpec)}`;
  }
  if (count) return `${def.name}：${size}，${count} 個面，放下去就能彩排`;
  // 「裝飾用」 is wrong for a QR stand or a raffle box: they do a job, they
  // just are not simulated. Say what it is for when the preset knows.
  const use = presetUse(def);
  return use
    ? `${def.name}：${size}，${use}`
    : `${def.name}：${size}，裝飾用（沒有互動）`;
}

/**
 * What a prop is for, when it came from a stall preset.
 *
 * Matched on the parts signature rather than `source`, because a recipe-built
 * prop reports `source: "agent"` — it genuinely did come from the agent, and
 * overwriting that to keep a lookup working would trade a true field for a
 * convenient one.
 */
function presetUse(def: PropDefinition): string | undefined {
  const direct = def.source ? BOOTH_PROP_META[def.source]?.use : undefined;
  if (direct) return direct;
  const tagged = (def as { basePresetId?: string }).basePresetId;
  return tagged ? BOOTH_PROP_META[tagged]?.use : undefined;
}
