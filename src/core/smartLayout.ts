/**
 * SmartLayoutEngine — participant-driven mat layouts, pure TypeScript (no AI).
 * Given a headcount + mat size + aisle + available area, it proposes a few
 * candidate arrangements (balanced grid / central aisle / wide rows) as
 * ArrayGroup specs, with footprint and fit warnings.
 */

import type { Bounds } from "./placement";

export interface LayoutInput {
  participants: number;
  matWidth: number; // meters (+X)
  matDepth: number; // meters (+Z)
  gap: number; // gap between mats (meters)
  aisleWidth: number; // central aisle width (meters)
  bounds: Bounds; // usable area (already inset from walls if desired)
  rotationDeg?: number;
  /** "field" is a contiguous 0.6 × 0.6 mat field; default keeps legacy mats. */
  mode?: "individual" | "field";
}

export interface GroupSpec {
  rows: number;
  cols: number;
  itemWidth: number;
  itemDepth: number;
  gapX: number;
  gapZ: number;
  rotationDeg: number;
  anchorX: number;
  anchorZ: number;
}

export interface LayoutCandidate {
  id: string;
  label: string;
  groups: GroupSpec[];
  count: number;
  footprint: { width: number; depth: number };
  warnings: string[];
  fits: boolean;
  mode?: "individual" | "field";
  /** Seats represented by a field; one person occupies two 0.6 m cells. */
  capacity?: number;
}

function capacityAlong(avail: number, size: number, gap: number): number {
  if (size <= 0) return 0;
  return Math.max(0, Math.floor((avail + gap) / (size + gap) + 1e-9));
}

function blockWidth(cols: number, w: number, gap: number): number {
  return cols <= 0 ? 0 : cols * w + (cols - 1) * gap;
}
function blockDepth(rows: number, d: number, gap: number): number {
  return rows <= 0 ? 0 : rows * d + (rows - 1) * gap;
}

/** Generate up to 3 candidate mat layouts for the given headcount. */
export function generateLayouts(input: LayoutInput): LayoutCandidate[] {
  if (input.mode === "field") return generateFieldLayouts(input);
  const { participants: n, matWidth: w, matDepth: d, gap, aisleWidth, bounds } = input;
  const rot = input.rotationDeg ?? 0;
  const W = Math.max(0, bounds.maxX - bounds.minX);
  const D = Math.max(0, bounds.maxZ - bounds.minZ);
  const colsMax = capacityAlong(W, w, gap);
  const rowsMax = capacityAlong(D, d, gap);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const out: LayoutCandidate[] = [];
  if (n <= 0 || colsMax <= 0 || rowsMax <= 0) return out;

  const mk = (id: string, label: string, groups: GroupSpec[]): LayoutCandidate => {
    const count = groups.reduce((s, g) => s + g.rows * g.cols, 0);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const g of groups) {
      minX = Math.min(minX, g.anchorX); minZ = Math.min(minZ, g.anchorZ);
      maxX = Math.max(maxX, g.anchorX + blockWidth(g.cols, g.itemWidth, g.gapX));
      maxZ = Math.max(maxZ, g.anchorZ + blockDepth(g.rows, g.itemDepth, g.gapZ));
    }
    const footprint = { width: maxX - minX, depth: maxZ - minZ };
    const warnings: string[] = [];
    if (count < n) warnings.push(`只能排 ${count} 張，少於 ${n} 人`);
    const fits = footprint.width <= W + 1e-6 && footprint.depth <= D + 1e-6;
    if (!fits) warnings.push("超出可用區域");
    return { id, label, groups, count, footprint, warnings, fits };
  };

  const centeredAnchor = (cols: number, rows: number): { anchorX: number; anchorZ: number } => ({
    anchorX: cx - blockWidth(cols, w, gap) / 2,
    anchorZ: cz - blockDepth(rows, d, gap) / 2,
  });

  // Candidate 1 — balanced grid (roughly square in physical space).
  {
    const targetCols = Math.max(1, Math.min(colsMax, Math.round(Math.sqrt((n * d) / w))));
    const cols = Math.min(colsMax, targetCols);
    const rows = Math.min(rowsMax, Math.ceil(n / cols));
    const a = centeredAnchor(cols, rows);
    out.push(mk("balanced", `A 整齊排列 ${rows} × ${cols}`, [{ rows, cols, itemWidth: w, itemDepth: d, gapX: gap, gapZ: gap, rotationDeg: rot, ...a }]));
  }

  // Candidate 2 — central aisle (two blocks split by an aisle).
  {
    const sideW = (W - aisleWidth) / 2;
    const colsPerSide = capacityAlong(sideW, w, gap);
    if (colsPerSide >= 1) {
      const rows = Math.min(rowsMax, Math.ceil(n / (colsPerSide * 2)));
      const leftW = blockWidth(colsPerSide, w, gap);
      const totalW = leftW * 2 + aisleWidth;
      const startX = cx - totalW / 2;
      const anchorZ = cz - blockDepth(rows, d, gap) / 2;
      const g: Omit<GroupSpec, "anchorX"> = { rows, cols: colsPerSide, itemWidth: w, itemDepth: d, gapX: gap, gapZ: gap, rotationDeg: rot, anchorZ };
      out.push(mk("aisle", `B 中央走道 ${rows} × ${colsPerSide}＋${colsPerSide}（走道 ${Math.round(aisleWidth * 100)}cm）`, [
        { ...g, anchorX: startX },
        { ...g, anchorX: startX + leftW + aisleWidth },
      ]));
    }
  }

  // Candidate 3 — wide rows (fill width, fewer rows).
  {
    const cols = colsMax;
    const rows = Math.min(rowsMax, Math.ceil(n / cols));
    if (cols >= 1 && (out.length === 0 || rows !== out[0].groups[0].rows || cols !== out[0].groups[0].cols)) {
      const a = centeredAnchor(cols, rows);
      out.push(mk("wide", `C 較寬鬆 ${rows} × ${cols}`, [{ rows, cols, itemWidth: w, itemDepth: d, gapX: gap, gapZ: gap, rotationDeg: rot, ...a }]));
    }
  }

  return out;
}

/**
 * Generate contiguous 60 × 60 cm mat fields. The group footprint is kept on
 * the tile grid; capacity is reported as seats, not tile count. Seat pitch
 * follows the club's real usage (photo-verified): one person per 0.6 m column,
 * 0.9 m of field depth per row when packed, 1.2 m for the spacious option.
 */
const FIELD_PITCH_DENSE = 0.9;
const FIELD_PITCH_SPACIOUS = 1.2;

function generateFieldLayouts(input: LayoutInput): LayoutCandidate[] {
  const n = Math.max(0, Math.floor(input.participants));
  const tile = 0.6;
  const { bounds } = input;
  const W = Math.max(0, bounds.maxX - bounds.minX);
  const D = Math.max(0, bounds.maxZ - bounds.minZ);
  const colsMax = Math.floor((W + 1e-9) / tile);
  const rowsMax = Math.floor((D + 1e-9) / tile);
  if (n <= 0 || colsMax <= 0 || rowsMax < 2) return [];
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const rot = input.rotationDeg ?? 0;
  const seatsIn = (tileRows: number, cols: number, pitch: number) =>
    cols * Math.floor((tileRows * tile + 1e-9) / pitch);
  const rowsFor = (cols: number, people: number, pitch: number): number => {
    const neededDepth = Math.ceil(people / Math.max(1, cols)) * pitch;
    return Math.max(2, Math.min(rowsMax, Math.ceil(neededDepth / tile - 1e-9)));
  };
  const centered = (rows: number, cols: number) => ({
    anchorX: cx - (cols * tile) / 2,
    anchorZ: cz - (rows * tile) / 2,
  });
  const make = (id: string, base: string, groups: GroupSpec[], pitch: number, seatFraction = 1): LayoutCandidate => {
    // seatFraction < 1 means part of the (still continuous) field is left
    // deliberately unoccupied — a walking lane made of empty seats, not of
    // missing mats.
    const capacity = Math.floor(
      groups.reduce((sum, g) => sum + seatsIn(g.rows, g.cols, pitch), 0) * seatFraction,
    );
    const minX = Math.min(...groups.map((g) => g.anchorX));
    const minZ = Math.min(...groups.map((g) => g.anchorZ));
    const maxX = Math.max(...groups.map((g) => g.anchorX + g.cols * tile));
    const maxZ = Math.max(...groups.map((g) => g.anchorZ + g.rows * tile));
    const warnings: string[] = [];
    if (capacity < n) warnings.push(`塞不下 ${n} 人，建議減少人數或改用較大的教室`);
    const geometryFits = maxX <= bounds.maxX + 1e-6 && minX >= bounds.minX - 1e-6 && maxZ <= bounds.maxZ + 1e-6 && minZ >= bounds.minZ - 1e-6;
    if (!geometryFits) warnings.push("超出可用區域");
    return {
      id, label: `${base}（可坐 ${capacity} 人）`, groups, count: capacity, capacity, mode: "field",
      footprint: { width: maxX - minX, depth: maxZ - minZ },
      warnings, fits: geometryFits && capacity >= n,
    };
  };
  const group = (rows: number, cols: number, anchorX: number, anchorZ: number): GroupSpec => ({
    rows, cols, itemWidth: tile, itemDepth: tile, gapX: 0, gapZ: 0, rotationDeg: rot, anchorX, anchorZ,
  });
  const out: LayoutCandidate[] = [];

  // A — one centred field, favouring a compact rectangle.
  /*
   * A — 一整片，用滿可用寬度。
   *
   * 原本用 sqrt 求一個接近正方形的區塊，那在寬教室裡會過度保守：一間 12 m 寬的
   * 教室只鋪出 8 m 寬，白白少一排人，而且和實況不像。活動照片裡的墊區是**寬扁**
   * 的——佔房間寬度 55–65%，深度只有幾排（REFERENCE_MAPPING 一）。所以用寬度
   * 優先、排數由人數決定，坐得下時自然比留走道的 B 多。
   */
  const rowsA = rowsFor(colsMax, n, FIELD_PITCH_DENSE);
  const a = centered(rowsA, colsMax);
  out.push(make("field-balanced", "A 整片座區", [group(rowsA, colsMax, a.anchorX, a.anchorZ)], FIELD_PITCH_DENSE));

  /*
   * B — 中央走道，但**墊子不切開**。
   *
   * 這裡原本產生兩塊分開的墊區，中間空 0.9 m。實況照片顯示的不是這樣：墊子
   * 一路對接成一整片連續矩形，走道是靠「中間那一列不坐人」做出來的
   * （docs/field-research/REFERENCE_MAPPING.md 一、中央走道）。
   *
   * 差別不只是外觀。切成兩塊會把 0.9 m 的地板永遠讓給走道，在 12 × 9 這種
   * 尺寸下等於直接少一排人；留空位則是走道要用時就在、要坐人時也坐得下。
   * 所以 B 與 A 是同一片墊子，只有可坐人數不同。
   */
  const aisle = Math.max(0.9, input.aisleWidth);
  const aisleCols = Math.max(1, Math.round(aisle / tile));
  const colsB = colsMax;
  if (colsB > aisleCols + 1) {
    const seatCols = colsB - aisleCols;
    const rowsB = rowsFor(seatCols, n, FIELD_PITCH_DENSE);
    const b = centered(rowsB, colsB);
    out.push(make(
      "field-aisle",
      "B 中央留走道",
      [group(rowsB, colsB, b.anchorX, b.anchorZ)],
      FIELD_PITCH_DENSE,
      // 整片鋪好，但中間 aisleCols 格留著走路，不算進可坐人數。
      seatCols / colsB,
    ));
  }

  // C — same tiles, more space per person (larger seat pitch).
  const rowsC = rowsFor(colsMax, n, FIELD_PITCH_SPACIOUS);
  const c = centered(rowsC, colsMax);
  out.push(make("field-spacious", "C 寬鬆（每人空間加大）", [group(rowsC, colsMax, c.anchorX, c.anchorZ)], FIELD_PITCH_SPACIOUS));
  return out;
}
