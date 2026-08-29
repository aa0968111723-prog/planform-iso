/**
 * Print specifications for 文宣 — the collateral a stall actually orders.
 *
 * A poster in this tool used to be a white plane 0.6 m wide. That is enough to
 * see where it stands and useless for everything else, because the question a
 * club actually has to answer is 「要印幾張、什麼尺寸、什麼材質、送印檔多大」.
 * A 3D box cannot answer that; a print spec can.
 *
 * So a prop that represents something printed carries BOTH:
 *
 * - the 3D size in metres, for the layout and the collision checks, and
 * - the trim size in **millimetres** plus substrate and quantity, for the
 *   order.
 *
 * The two are derived from one another (`metersFromTrim`), so a prop cannot
 * end up 60 cm wide on the plan and A3 on the order form.
 *
 * Millimetres are deliberate. Every printer in Taiwan quotes in mm, ISO paper
 * is defined in mm, and rounding A4 to "0.21 m" then back loses the 297.
 */

/** Substrates a club actually orders, with the words a printer will recognise. */
export type PrintMaterial =
  | "coated-paper"      // 銅版紙 — flyers, posters
  | "matte-paper"       // 雪銅紙 / 模造紙
  | "sticker"           // 貼紙
  | "pp-synthetic"      // PP 合成紙 — waterproof, indoor banners
  | "canvas"            // 帆布 — outdoor banners
  | "foam-board"        // 珍珠板 / 保麗龍板 — standees, rigid boards
  | "acrylic"           // 壓克力 — table stands, sign holders
  | "fabric"            // 布幔 — backdrops
  | "corrugated";       // 瓦楞紙板

export const PRINT_MATERIAL_LABEL: Record<PrintMaterial, string> = {
  "coated-paper": "銅版紙",
  "matte-paper": "雪銅紙",
  sticker: "貼紙",
  "pp-synthetic": "PP 合成紙",
  canvas: "帆布",
  "foam-board": "珍珠板",
  acrylic: "壓克力",
  fabric: "布幔",
  corrugated: "瓦楞紙板",
};

export type PrintOrientation = "portrait" | "landscape";

export interface PrintSpec {
  /** Trim width in millimetres — the number you give the printer. */
  widthMm: number;
  /** Trim height in millimetres. */
  heightMm: number;
  /** Standard name when it is one: A4, A3, X 展架…. Free-form otherwise. */
  standard?: string;
  orientation: PrintOrientation;
  /** 單面 or 雙面. */
  sides: 1 | 2;
  material: PrintMaterial;
  /** How many to order. */
  quantity: number;
  /**
   * Bleed in millimetres, per edge. 3 mm is the usual ask for sheet-fed work;
   * large-format banners are commonly 0 because they are trimmed on the roll.
   */
  bleedMm: number;
  /** A note that has to travel to the printer: 上光, 打孔, 含背膠…. */
  finishNote?: string;
}

/**
 * The sizes a student club actually orders.
 *
 * ISO A series is exact by definition. The banner and standee sizes are the
 * de-facto Taiwanese market sizes — an X 展架 is 60 × 160 cm everywhere, and a
 * 易拉寶 is 80 × 200 cm; those are product sizes, not a standards body's.
 */
export interface PrintStandard {
  id: string;
  label: string;
  widthMm: number;
  heightMm: number;
  /** ISO-defined, or a market convention? Stated because it changes trust. */
  authority: "iso" | "market";
  defaultMaterial: PrintMaterial;
  defaultBleedMm: number;
  /** What this is normally for, in the words a club would use. */
  use: string;
}

export const PRINT_STANDARDS: readonly PrintStandard[] = [
  // --- ISO 216 A series. Exact, by definition.
  { id: "A6", label: "A6", widthMm: 105, heightMm: 148, authority: "iso", defaultMaterial: "coated-paper", defaultBleedMm: 3, use: "桌上小卡、集章卡" },
  { id: "A5", label: "A5", widthMm: 148, heightMm: 210, authority: "iso", defaultMaterial: "coated-paper", defaultBleedMm: 3, use: "傳單、桌上立牌" },
  { id: "A4", label: "A4", widthMm: 210, heightMm: 297, authority: "iso", defaultMaterial: "coated-paper", defaultBleedMm: 3, use: "傳單、報名表、桌牌" },
  { id: "A3", label: "A3", widthMm: 297, heightMm: 420, authority: "iso", defaultMaterial: "coated-paper", defaultBleedMm: 3, use: "小海報、流程說明" },
  { id: "A2", label: "A2", widthMm: 420, heightMm: 594, authority: "iso", defaultMaterial: "matte-paper", defaultBleedMm: 3, use: "海報" },
  { id: "A1", label: "A1", widthMm: 594, heightMm: 841, authority: "iso", defaultMaterial: "matte-paper", defaultBleedMm: 3, use: "大海報" },
  { id: "B2", label: "B2", widthMm: 500, heightMm: 707, authority: "iso", defaultMaterial: "matte-paper", defaultBleedMm: 3, use: "海報（B 系列）" },

  // --- Market product sizes. Not a standards body; this is what shops sell.
  { id: "x-banner", label: "X 展架", widthMm: 600, heightMm: 1600, authority: "market", defaultMaterial: "pp-synthetic", defaultBleedMm: 0, use: "攤位側邊立牌" },
  { id: "roll-up", label: "易拉寶", widthMm: 800, heightMm: 2000, authority: "market", defaultMaterial: "pp-synthetic", defaultBleedMm: 0, use: "攤位主視覺" },
  { id: "table-runner", label: "桌前布條", widthMm: 1800, heightMm: 600, authority: "market", defaultMaterial: "canvas", defaultBleedMm: 0, use: "掛在攤位桌前" },
  { id: "hanging-banner", label: "直式布條", widthMm: 900, heightMm: 3000, authority: "market", defaultMaterial: "canvas", defaultBleedMm: 0, use: "懸掛式布條" },
  { id: "backdrop-24", label: "背景板 240×240", widthMm: 2400, heightMm: 2400, authority: "market", defaultMaterial: "fabric", defaultBleedMm: 0, use: "合照背景牆" },
  { id: "backdrop-30", label: "背景板 300×250", widthMm: 3000, heightMm: 2500, authority: "market", defaultMaterial: "fabric", defaultBleedMm: 0, use: "大型合照背景牆" },
  { id: "standee-a1", label: "A1 立牌", widthMm: 594, heightMm: 841, authority: "iso", defaultMaterial: "foam-board", defaultBleedMm: 3, use: "珍珠板立牌" },
];

const BY_ID = new Map(PRINT_STANDARDS.map((s) => [s.id.toLowerCase(), s]));

export function printStandard(id: string): PrintStandard | undefined {
  return BY_ID.get(id.toLowerCase());
}

/** Which way up a size naturally reads. */
export function naturalOrientation(widthMm: number, heightMm: number): PrintOrientation {
  return widthMm > heightMm ? "landscape" : "portrait";
}

/**
 * Trim size → the 3D plane's metres.
 *
 * `widthMm` and `heightMm` are ALWAYS the as-ordered dimensions — what you
 * would write on the order form. This function therefore does not swap
 * anything; `orientation` is descriptive.
 *
 * The first cut swapped here as well as in `specFromStandard`, which turned a
 * 180 × 60 cm table runner into a 60 × 180 cm one: rotating twice is the same
 * as not rotating, except the numbers disagree about which happened. One
 * source of truth, applied once, at the point the standard is resolved.
 */
export function metersFromTrim(spec: Pick<PrintSpec, "widthMm" | "heightMm">): {
  width: number;
  height: number;
} {
  return { width: spec.widthMm / 1000, height: spec.heightMm / 1000 };
}

/**
 * Build a full spec from a standard, with the caller's overrides.
 *
 * Asking for an orientation the standard does not naturally have swaps its
 * numbers exactly once — A4 landscape becomes 297 × 210, and a table runner
 * that is already landscape stays 1800 × 600.
 */
export function specFromStandard(
  standardId: string,
  over: Partial<Omit<PrintSpec, "widthMm" | "heightMm" | "standard">> = {},
): PrintSpec | null {
  const std = printStandard(standardId);
  if (!std) return null;
  const natural = naturalOrientation(std.widthMm, std.heightMm);
  const want = over.orientation ?? natural;
  const swap = want !== natural;
  return {
    widthMm: swap ? std.heightMm : std.widthMm,
    heightMm: swap ? std.widthMm : std.heightMm,
    standard: std.label,
    orientation: want,
    sides: over.sides ?? 1,
    material: over.material ?? std.defaultMaterial,
    quantity: over.quantity ?? 1,
    bleedMm: over.bleedMm ?? std.defaultBleedMm,
    ...(over.finishNote ? { finishNote: over.finishNote } : {}),
  };
}

/**
 * The line a printer can quote from.
 *
 * Deliberately one string: it goes into the material list, the construction
 * plan footer and the clipboard, and three different renderings of the same
 * order is three chances to send the wrong one.
 */
export function describePrintSpec(spec: PrintSpec): string {
  const size = spec.standard
    ? `${spec.standard}（${spec.widthMm} × ${spec.heightMm} mm）`
    : `${spec.widthMm} × ${spec.heightMm} mm`;
  const parts = [
    size,
    spec.orientation === "landscape" ? "橫式" : "直式",
    PRINT_MATERIAL_LABEL[spec.material],
    spec.sides === 2 ? "雙面" : "單面",
    `${spec.quantity} 份`,
  ];
  if (spec.bleedMm > 0) parts.push(`出血 ${spec.bleedMm} mm`);
  if (spec.finishNote) parts.push(spec.finishNote);
  return parts.join(" · ");
}

/**
 * The artwork canvas a designer needs, in millimetres — trim plus bleed on
 * every edge. Getting this wrong is the single most common reason a file comes
 * back from the printer.
 */
export function artboardMm(spec: PrintSpec): { widthMm: number; heightMm: number } {
  return {
    widthMm: spec.widthMm + spec.bleedMm * 2,
    heightMm: spec.heightMm + spec.bleedMm * 2,
  };
}
