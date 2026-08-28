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
import type { InteractionOption, PropDefinition } from "./model";

export interface PropRecipe {
  name: string;
  /** A preset to start from. Unknown or missing falls back to a plain box. */
  kind?: string;
  dimensions?: { width: number; depth: number; height: number };
  color?: string;
  faces?: { label: string; color?: string; prompt?: string }[];
  interactive?: boolean;
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

  // 「做一個裝飾用的」 — an explicit no turns the game off; a prop with no
  // preset interaction stays decorative either way.
  if (recipe.interactive === false && def.interaction) {
    def = { ...def, interaction: undefined };
  }

  return def;
}

/** One sentence describing what a recipe will produce, for the preview card. */
export function describeRecipe(def: PropDefinition): string {
  const cm = (m: number) => Math.round(m * 100);
  const size = `${cm(def.dimensions.width)}×${cm(def.dimensions.depth)}×${cm(def.dimensions.height)} cm`;
  const faces = def.interaction?.steps
    .find((s) => s.branch?.kind === "chance")?.branch;
  const count = faces?.kind === "chance" ? faces.options.length : 0;
  return count
    ? `${def.name}：${size}，${count} 個面，放下去就能彩排`
    : `${def.name}：${size}，裝飾用（沒有互動）`;
}
