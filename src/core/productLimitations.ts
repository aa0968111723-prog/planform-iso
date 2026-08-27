/**
 * Product limitations that look finished (docs say 1.1, or a field exists
 * without a real entry) but are not a complete product feature.
 *
 * The About sheet and `docs/PRODUCT_LIMITATIONS.md` stay in lockstep with
 * this list. If you close one of these, delete it here first.
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

export const PRODUCT_LIMITATIONS: readonly ProductLimitation[] = [
  {
    id: "thumbnail",
    title: "專案縮圖不會自動產圖",
    kind: "field-only",
    summary: "卡片有縮圖位，有圖就會顯示；儲存後不會自動畫一張預覽。",
  },
  {
    id: "named-layouts",
    title: "「這個專案的版本」仍是全域名稱",
    kind: "doc-1.1",
    summary: "編輯器裡的方案 A／B 底層還是本機共用的 named layout，不是專案內版本。",
  },
  {
    id: "r06-family-seating",
    title: "家族／小組座談座位（R-06）",
    kind: "doc-1.1",
    summary: "社課後半段要拆成各家族圈，目前沒有這個座位模式。",
  },
  {
    id: "r07-av-position",
    title: "場務音控／控 PPT 位置（R-07）",
    kind: "doc-1.1",
    summary: "場務組在講台側的音控、控 PPT 位置還沒做成專屬區域。",
  },
  {
    id: "r08-name-badge",
    title: "名牌進物資（R-08）",
    kind: "doc-1.1",
    summary: "美宣組做的名牌不會自動出現在報到桌物資清單。可自己加物件。",
  },
  {
    id: "venue-scan-mock",
    title: "「掃描場地」偵測是假資料",
    kind: "runtime",
    summary: "流程在，但 MockVenueProvider 不會真的認照片裡的門桌。",
  },
  {
    id: "ai-offline-rules",
    title: "「✦ AI 幫我」不是雲端模型",
    kind: "runtime",
    summary: "離線規則／關鍵字。沒金鑰也能用，但不是真 LLM。",
  },
  {
    id: "v2-checkin-wizard",
    title: "V2 報到流程精靈還沒做",
    kind: "doc-1.1",
    summary: "規格有 A–E 模板與一鍵分流；模擬頁只問人數／繳費／人力。",
  },
  {
    id: "last-write-wins",
    title: "兩個分頁開同一份專案",
    kind: "runtime",
    summary: "沒有合併。後寫入的那一頁會蓋掉先寫的。",
  },
  {
    id: "production-unverified",
    title: "線上 production 尚未實測過關",
    kind: "runtime",
    summary: "文件寫 Zeabur 在雲端容器連不到；PWA 真機安裝／離線還沒在 production 過關。",
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
