/**
 * Product limitations that look finished but are not a complete product
 * feature. Closed items are deleted from this list.
 *
 * The About sheet and `docs/PRODUCT_LIMITATIONS.md` stay in lockstep.
 */

export type LimitationKind = "doc-1.1" | "field-only" | "runtime";

export interface ProductLimitation {
  id: string;
  title: string;
  kind: LimitationKind;
  /** One-line copy for 更多 → 已知限制. */
  summary: string;
}

export const LIMITATION_KIND_LABEL: Record<LimitationKind, string> = {
  "doc-1.1": "1.1 待辦",
  "field-only": "只有欄位",
  runtime: "現況限制",
};

/**
 * Product-side 1.1 / field-only / mock gaps are closed.
 * The leftover is an environment fact: this cloud box cannot reach Zeabur.
 */
export const PRODUCT_LIMITATIONS: readonly ProductLimitation[] = [
  {
    id: "production-unverified",
    title: "線上 Zeabur 主機本環境連不到",
    kind: "runtime",
    summary: "本機 production preview 的 PWA 離線／加到主畫面已接上。遠端 Zeabur 需部署後在瀏覽器確認。",
  },
];

/** Accept YYYY-MM-DD, or empty to clear. Invalid input returns null. */
export function normalizeEventDate(raw: string | undefined): string | undefined | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const [y, m, d] = trimmed.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return trimmed;
}
