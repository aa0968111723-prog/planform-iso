/**
 * Spatial design knowledge base.
 *
 * Every entry is a CURATED summary with its source attached. The raw research
 * transcripts are not shipped — they live in `docs/research/spatial-design/`
 * and never enter the browser bundle. What ships is the conclusion, the rule it
 * implies, and the URL a user can check it against.
 *
 * Three rules this file exists to enforce:
 *
 * 1. **Nothing here claims legal compliance.** Where an entry touches fire
 *    safety, egress, accessibility or law, `requiresHumanReview` is true and the
 *    UI must render `SAFETY_DISCLAIMER` alongside it. `assertNoComplianceClaim`
 *    is unit-tested against the whole table so a future edit cannot quietly
 *    introduce 「已符合法規」.
 * 2. **Confidence is stated, not implied.** Research that could not find an
 *    official figure is recorded as `sourceType: "inferred"` with
 *    `confidence: "low"` rather than being rounded up into a fact.
 * 3. **A number without a source does not belong here.** `sourceUrl` is
 *    required; entries the research could not source say so in `limitations`.
 *
 * Retrieval dates are the date the research batch ran (2026-08-28/29). A page
 * can change after that; that is what `retrievedAt` is for.
 */

export type KnowledgeCategory =
  | "venue-types"
  | "classroom-layout"
  | "booth-layout"
  | "queue-design"
  | "event-flow"
  | "accessibility"
  | "safety-warnings"
  | "staff-operations"
  | "meditation-event"
  | "tea-event"
  | "student-club-event"
  | "campus-event"
  | "furniture-dimensions"
  | "visual-communication"
  | "3d-asset-placement";

export type SourceType =
  | "official-standard"
  | "government"
  | "university"
  | "official-docs"
  | "industry-guide"
  | "manufacturer"
  | "academic"
  | "encyclopedia"
  /** No source found; a conventional value recorded as such, never as fact. */
  | "inferred";

export type Confidence = "high" | "medium" | "low";

export type VenueType =
  | "classroom"
  | "hall"
  | "corridor"
  | "outdoor-booth"
  | "activity-centre"
  | "any";

export interface KnowledgeRule {
  /** What the rule constrains, in words the planner and the user share. */
  statement: string;
  /** Machine-usable value where one exists. Metres, seconds or a ratio. */
  value?: number;
  unit?: "m" | "m2-per-person" | "seconds" | "ratio" | "count";
  /** Which planner input this rule can legitimately drive. */
  appliesTo?: string;
}

export interface KnowledgeEntry {
  id: string;
  title: string;
  category: KnowledgeCategory;
  summary: string;
  rules: KnowledgeRule[];
  examples: string[];
  confidence: Confidence;
  sourceUrl: string;
  sourceType: SourceType;
  /** ISO date the source was consulted. */
  retrievedAt: string;
  applicableVenueTypes: VenueType[];
  /** What this entry does NOT establish. Never empty for a regulated topic. */
  limitations: string[];
  /** True whenever acting on this needs a qualified human to sign off. */
  requiresHumanReview: boolean;
}

/**
 * The only sentence this product is allowed to say about a regulated topic.
 * Anything stronger would be a compliance claim the software cannot support.
 */
export const SAFETY_DISCLAIMER = "設計提醒，仍需依現場與專業規範確認。";

/** Phrases a knowledge entry may never contain. Enforced by test. */
export const FORBIDDEN_CLAIMS: readonly string[] = [
  "已符合所有法規",
  "已符合法規",
  "已通過安全檢查",
  "一定可以使用",
  "保證合規",
  "完全合法",
];

const R = "2026-08-29";
/** The targeted follow-up pass that recovered the primary regulation articles. */
const R2 = "2026-08-29";

export const KNOWLEDGE_BASE: readonly KnowledgeEntry[] = [
  /* ---------------- venue types ---------------- */
  {
    id: "venue-tku-space-rental",
    title: "淡江大學對外場地借用資訊網",
    category: "venue-types",
    summary:
      "淡江大學設有官方「對外場地借用資訊網」，由總務處事務整備組維護，是查詢校內外場地借用的正式入口。" +
      "站上可查到借用流程、申請窗口與部分場地詳頁；但全校並沒有一份統一公開的容納人數／尺寸總表。",
    rules: [
      { statement: "校外單位借用需先送計畫書確認時段，再於借用日前 10 日內正式函送申請。" },
      { statement: "教室借用走 OA 系統；臨時借用另有紙本與臨櫃流程。" },
    ],
    examples: [
      "要辦社課前，先到 spacerental.tku.edu.tw 查該場地是否開放外借與聯絡窗口。",
      "場地尺寸若站上查不到，必須自行到現場丈量後再開始排版。",
    ],
    confidence: "high",
    sourceUrl: "https://spacerental.tku.edu.tw/",
    sourceType: "university",
    retrievedAt: R,
    applicableVenueTypes: ["classroom", "hall", "activity-centre"],
    limitations: [
      "官方網站未逐間公開會議室、教室與學生活動中心的容納人數與尺寸。",
      "本工具不會替使用者判斷某場地是否可借；借用資格與時段以校方公告為準。",
    ],
    requiresHumanReview: false,
  },
  {
    id: "venue-tku-sports-fee-table",
    title: "淡江大學淡水校園場地及設備器材借用收費一覽表",
    category: "campus-event",
    summary:
      "體育事務處公開淡水校園各類場地與設備器材的借用維護費一覽表（PDF），是目前查得到、少數逐項列出場地名稱的官方文件。",
    rules: [{ statement: "運動場地借用有線上登記與收費／維護費規定，依公告版本為準。" }],
    examples: ["辦戶外活動要用到運動場地時，先查該學年度的收費一覽表確認費用與時段。"],
    confidence: "medium",
    sourceUrl:
      "https://www.sports.tku.edu.tw/wp-content/uploads/2025/07/%E6%B7%A1%E6%B0%B4%E6%A0%A1%E5%9C%92_114%E5%90%84%E9%A1%9E%E5%A0%B4%E5%9C%B0%E5%8F%8A%E8%A8%AD%E5%82%99%E5%99%A8%E6%9D%90%E5%80%9F%E7%94%A8%E7%B6%AD%E8%AD%B7%E8%B2%BB%E6%94%B6%E8%B2%BB%E4%B8%80%E8%A6%BD%E8%A1%A8.pdf",
    sourceType: "university",
    retrievedAt: R,
    applicableVenueTypes: ["activity-centre", "hall"],
    limitations: [
      "收費表逐年修訂，連結指向特定學年度版本，使用前需確認最新公告。",
      "此表列的是費用，不是場地尺寸或容納人數。",
    ],
    requiresHumanReview: false,
  },

  /* ---------------- capacity / area ---------------- */
  {
    id: "event-area-per-person",
    title: "各種座位方式的每人面積慣例值",
    category: "event-flow",
    summary:
      "活動產業常用的每人面積估算區間：劇院式 0.56–0.74 m²、教室式 0.74–0.93 m²、圓桌宴會 0.93–1.11 m²、" +
      "站立酒會 0.56–0.74 m²。這些是容量估算的業界慣例，不是法定面積標準。",
    rules: [
      { statement: "劇院式每人面積", value: 0.65, unit: "m2-per-person", appliesTo: "calculateCapacity:chairs-rows" },
      { statement: "教室式每人面積", value: 0.85, unit: "m2-per-person", appliesTo: "calculateCapacity:classroom-desks" },
      { statement: "圓桌宴會每人面積", value: 1.0, unit: "m2-per-person", appliesTo: "calculateCapacity:banquet-round" },
      { statement: "站立酒會每人面積", value: 0.65, unit: "m2-per-person", appliesTo: "calculateCapacity:standing" },
    ],
    examples: ["80 m² 的教室以教室式估算，約可容納 90 人上下，實際還要扣掉服務桌與走道。"],
    confidence: "medium",
    sourceUrl: "https://spaces.townhall.co.uk/how-much-event-space-do-you-need/",
    sourceType: "industry-guide",
    retrievedAt: R,
    applicableVenueTypes: ["classroom", "hall"],
    limitations: [
      "這些是英國活動產業的慣例值，不是台灣法規，也不是消防容留人數。",
      "席地而坐（floor seating）沒有被普遍引用的單一標準值，本工具改用實際座墊幾何計算。",
      "估算未扣除舞台、服務桌、器材與無障礙空間。",
    ],
    requiresHumanReview: false,
  },
  {
    id: "floor-seating-no-standard",
    title: "席地而坐沒有通行的每人面積標準",
    category: "meditation-event",
    summary:
      "查詢公開的活動空間規劃指南後，theatre／classroom／banquet／reception 都有常被引用的每人面積區間，" +
      "但「席地而坐」沒有對應的單一標準值。因此本工具的地墊容量不用面積係數推估，而是直接由座墊幾何與座位間距計算。",
    rules: [
      { statement: "地墊容量以實際鋪設的墊格與每人座位間距計算，不套用面積係數。" },
    ],
    examples: ["禪坐活動排 60 人時，看的是墊區排得下幾列幾行，而不是「面積除以 0.8」。"],
    confidence: "high",
    sourceUrl: "https://spaces.townhall.co.uk/how-much-event-space-do-you-need/",
    sourceType: "industry-guide",
    retrievedAt: R,
    applicableVenueTypes: ["classroom", "hall"],
    limitations: ["這條記錄的是「查不到標準」，不是「標準不存在」。"],
    requiresHumanReview: false,
  },

  /* ---------------- queue ---------------- */
  {
    id: "queue-single-line",
    title: "單一共用隊伍優於多條平行隊伍",
    category: "queue-design",
    summary:
      "排隊理論中，把多個服務窗口併成一條共用隊伍（M/M/c），平均等待時間會低於同樣窗口數各排一條（多個 M/M/1）。" +
      "原因是共用隊伍不會出現「一條空著、另一條在排」的浪費。",
    rules: [
      { statement: "同樣人力下，一條共用隊伍的平均等待低於多條各自排隊。" },
      { statement: "服務窗口併池後，人力調度彈性提高。" },
    ],
    examples: [
      "報到與收費共用一張桌、由 4 名工作人員輪流服務，通常比分成兩桌各 2 人更快。",
      "本工具的方案 A 就是這種模型；模擬結果會直接顯示差異。",
    ],
    confidence: "high",
    sourceUrl: "https://en.wikipedia.org/wiki/M/M/c_queue",
    sourceType: "encyclopedia",
    retrievedAt: R,
    applicableVenueTypes: ["any"],
    limitations: [
      "前提是所有窗口都能處理所有業務；若收費需要專人或專門設備則不成立。",
      "共用隊伍需要現場動線與指標配合，否則人會自己排成多條。",
    ],
    requiresHumanReview: false,
  },
  {
    id: "queue-utilisation-cliff",
    title: "使用率超過約 80% 後等待時間急遽上升",
    category: "queue-design",
    summary:
      "排隊系統的等待時間對使用率（到達率÷服務能力）是非線性的：使用率接近 1 時等待時間趨近無限大。" +
      "實務上使用率超過大約 0.8 就會明顯感受到排隊變長。",
    rules: [
      { statement: "服務站使用率建議控制在 0.8 以下", value: 0.8, unit: "ratio", appliesTo: "explainBottleneck" },
    ],
    examples: [
      "報到桌使用率 0.95 時，多加一名人力帶來的改善會遠大於把桌子往前移。",
      "模擬報表中的 utilization 欄位就是這個值。",
    ],
    confidence: "high",
    sourceUrl: "https://en.wikipedia.org/wiki/M/M/c_queue",
    sourceType: "encyclopedia",
    retrievedAt: R,
    applicableVenueTypes: ["any"],
    limitations: [
      "0.8 是實務經驗門檻，不是理論上的臨界點；不同容忍度的活動可以不同。",
      "本工具的模擬使用隨機服務時間，單次結果會有波動。",
    ],
    requiresHumanReview: false,
  },
  {
    id: "queue-parallel-servers",
    title: "分流的效益取決於需求比例，不是桌子數量",
    category: "queue-design",
    summary:
      "把報到與收費分成兩桌，只有在兩邊需求相近時才有效。若只有三分之一的人需要繳費，" +
      "平均分配人力會讓收費桌閒置、報到桌塞車。人力應依「到達比例 × 服務時間」的負載分配。",
    rules: [
      { statement: "站點人力依 offered load（到達比例 × 平均服務秒數）分配，而非平均分配。" },
    ],
    examples: [
      "60 人中 20 人現場繳費：報到負載 1.0×45 秒、收費負載 0.33×60 秒，人力比約 7:3。",
      "本工具的模擬會自動照這個比例排班，讓方案比較不受排班失誤影響。",
    ],
    confidence: "high",
    sourceUrl: "https://en.wikipedia.org/wiki/Queueing_theory",
    sourceType: "encyclopedia",
    retrievedAt: R,
    applicableVenueTypes: ["any"],
    limitations: ["實際排班還受工作人員能力、輪替與休息影響，本工具不模擬這些。"],
    requiresHumanReview: false,
  },
  {
    id: "checkin-payment-split",
    title: "報到與收費分流的適用時機",
    category: "event-flow",
    summary:
      "分流的價值在於「已繳費的人不必等在繳費的人後面」。當現場繳費比例高、或繳費耗時明顯長於報到時，" +
      "分流才會贏；比例低時反而是共用桌較快。",
    rules: [
      { statement: "現場繳費比例高或繳費時間明顯較長時，優先考慮分流。" },
    ],
    examples: ["茶會若多數人已線上付款，共用一張桌通常比較順。"],
    confidence: "medium",
    sourceUrl: "https://en.wikipedia.org/wiki/M/M/c_queue",
    sourceType: "encyclopedia",
    retrievedAt: R,
    applicableVenueTypes: ["classroom", "hall", "outdoor-booth"],
    limitations: ["這是從排隊模型推得的一般結論，不是特定活動的實測數據。"],
    requiresHumanReview: false,
  },

  /* ---------------- accessibility / safety ---------------- */
  {
    id: "accessibility-corridor-width",
    title: "無障礙通路走廊淨寬（台灣，室內 204.2.2）",
    category: "accessibility",
    summary:
      "《建築物無障礙設施設計規範》第 204.2.2 條規定**室內**通路走廊寬度不得小於 120 公分，" +
      "且走廊中有開門時，扣除門扇開啟空間後仍不得小於 120 公分。" +
      "這是本工具比對走道寬度時採用的依據。",
    rules: [
      { statement: "室內無障礙通路走廊淨寬下限（204.2.2）", value: 1.2, unit: "m", appliesTo: "checkAccessibilityWarnings" },
      { statement: "門扇開啟後仍須維持的淨寬（204.2.2）", value: 1.2, unit: "m", appliesTo: "checkDoorClearance" },
    ],
    examples: ["排走道時，把最小走道寬度設成 1.2 公尺，可以先排除明顯過窄的室內配置。"],
    confidence: "high",
    sourceUrl: "https://www.nlma.gov.tw/filesys/file/chinese/dept/br2/br1011225-2.pdf",
    sourceType: "government",
    retrievedAt: R2,
    applicableVenueTypes: ["classroom", "hall", "corridor", "activity-centre"],
    limitations: [
      "這是**室內**通路的條文。室外通路是另一條（203.2.3，見 accessibility-outdoor-path-width），兩者數值不同，不可互相套用。",
      "法規條文有適用條件（建築用途、樓層、新建或既有），本工具不判斷適用性。",
      "本工具只比對模型上的數字，不代表現場完成面尺寸符合規範。",
    ],
    requiresHumanReview: true,
  },
  {
    id: "accessibility-outdoor-path-width",
    title: "無障礙室外通路淨寬（台灣，203.2.3）",
    category: "accessibility",
    summary:
      "第 203.2.3 條規定**室外**通路淨寬不得小於 130 公分；" +
      "但第 202.4 所列的獨棟或連棟建築物，其通路淨寬得為 90 公分以上。" +
      "130 與 120 是不同條文、不同適用情形，常被混為一談。",
    rules: [
      { statement: "室外無障礙通路淨寬下限（203.2.3）", value: 1.3, unit: "m" },
      { statement: "獨棟或連棟建築物的例外下限（202.4）", value: 0.9, unit: "m" },
    ],
    examples: ["戶外擺攤的通路要用 130 公分估算，不是室內的 120 公分。"],
    confidence: "high",
    sourceUrl: "https://www.nlma.gov.tw/uploads/files/a5fc1f6258d7a0d88ce06afde8c68128.pdf",
    sourceType: "government",
    retrievedAt: R2,
    applicableVenueTypes: ["outdoor-booth", "corridor"],
    limitations: [
      "例外條件由 202.4 界定，本工具不判斷某個建築物屬不屬於該類。",
      "本工具只比對模型上的數字，不代表現場完成面尺寸符合規範。",
    ],
    requiresHumanReview: true,
  },
  {
    id: "accessibility-turning-space",
    title: "輪椅迴轉空間（台灣 A102.2.6）",
    category: "accessibility",
    summary:
      "《建築物無障礙設施設計規範》A102.2.6 規定，輪椅使用者作 360 度迴轉所需空間的直徑為 150 公分。" +
      "**受限制時亦可改用 T 型空間迴轉**，該空間須平整、堅固且坡度在 1/50 以下。" +
      "另 404.1 就昇降機出入口另訂不得小於直徑 1.5 公尺的淨空間。",
    rules: [
      { statement: "輪椅 360 度迴轉空間直徑（A102.2.6）", value: 1.5, unit: "m", appliesTo: "checkAccessibilityWarnings" },
      { statement: "空間受限時可改用 T 型迴轉空間，不是只有圓形一種解法。" },
    ],
    examples: [
      "報到桌前若要能讓輪椅轉向，桌前應保留直徑 1.5 公尺的淨空。",
      "空間不足時，T 型迴轉是規範明列的替代方案——工具報「沒有 150 公分圓」不等於不合規。",
    ],
    confidence: "high",
    sourceUrl: "https://www.nlma.gov.tw/filesys/file/chinese/dept/br2/br1011225-2.pdf",
    sourceType: "government",
    retrievedAt: R2,
    applicableVenueTypes: ["any"],
    limitations: [
      "本工具只檢查圓形迴轉空間，**不檢查 T 型替代方案**，所以它的警告會比規範嚴格。",
      "坡度、地面平整度與堅固程度本工具完全不檢查。",
      "本工具不做無障礙認證，也不判斷任何配置是否通過查驗。",
    ],
    requiresHumanReview: true,
  },
  {
    id: "accessibility-ada-route",
    title: "ADA 無障礙通路淨寬與迴轉空間（美國）",
    category: "accessibility",
    summary:
      "2010 ADA Standards §403.5.1 規定無障礙通路淨寬下限為 36 英吋（915 公釐）；" +
      "在長度不超過 24 英吋的區段可縮減為 32 英吋，但兩段之間須有至少 48 英吋長、36 英吋寬的區段。" +
      "§304 另訂迴轉空間。ADA 與台灣規範是兩套獨立體系，不可互相取代。",
    rules: [
      { statement: "ADA 無障礙通路淨寬下限（403.5.1）", value: 0.915, unit: "m" },
      { statement: "短區段縮減下限（403.5.1 例外）", value: 0.815, unit: "m" },
    ],
    examples: ["跨國活動或引用英文資料時，注意 36 英吋（0.915 m）與台灣的 120 公分不同。"],
    confidence: "high",
    sourceUrl: "https://www.ada.gov/assets/pdfs/2010-design-standards.pdf",
    sourceType: "official-standard",
    retrievedAt: R2,
    applicableVenueTypes: ["any"],
    limitations: [
      "ADA 適用於美國，對台灣的活動沒有法律效力，本工具不依它做任何判斷。",
      "本工具的走道檢查採用台灣的 120 公分，不是 ADA 的 36 英吋。",
    ],
    requiresHumanReview: true,
  },
  {
    id: "egress-not-a-single-number",
    title: "避難寬度不是單一數字",
    category: "safety-warnings",
    summary:
      "NFPA 101 的避難寬度在第 7 章：7.3.1 先依「每人占用面積」算出容留人數（Table 7.3.1.2），" +
      "7.3.2／7.3.3 再乘上每人所需寬度的容量係數（Table 7.3.3.1），樓梯與水平構件係數不同。" +
      "也就是說它是**依人數計算的變數**，不是單一固定寬度。" +
      "台灣的避難層出入口同樣與建築用途、樓梯總寬、門扇開啟方向一併判定。",
    rules: [
      { statement: "避難寬度＝所服務人數 × 容量係數，先算人數再算寬度。" },
      { statement: "本工具不做容留人數計算，也不做避難寬度計算。" },
    ],
    examples: ["工具會提醒「門前有物件」，但不會告訴你這扇門的避難寬度是否足夠。"],
    // NOT "high": the follow-up pass reached only secondary technical write-ups
    // for this one, because NFPA 101's text is paywalled. The structural claim
    // (occupant-load based, not a fixed width) is well corroborated; the exact
    // section numbers are not first-hand.
    confidence: "medium",
    sourceUrl: "https://www.nfpa.org/codes-and-standards/all-codes-and-standards/list-of-codes-and-standards/detail?code=101",
    sourceType: "official-standard",
    retrievedAt: R2,
    applicableVenueTypes: ["any"],
    limitations: [
      "NFPA 101 正文受版權保護且需付費取得，研究兩次都未能讀到原文。",
      "章節編號（7.3.1／7.3.2／Table 7.3.3.1）來自二手技術文獻，非一手核對，引用前請查該版本正文。",
      "係數依用途、是否設置自動灑水與語音警報而異。",
      "消防與避難規劃必須由合格專業人員依現況判定。",
    ],
    requiresHumanReview: true,
  },
  {
    id: "door-clearance",
    title: "門前淨空",
    category: "safety-warnings",
    summary:
      "門前與門扇開啟弧線內不應放置物件。本工具會檢查門的開啟範圍是否被家具擋住，" +
      "並可依設定的門前保留距離把物件推開。這是設計檢查，不是避難查驗。",
    rules: [
      { statement: "門前建議保留距離（可調整）", value: 1.2, unit: "m", appliesTo: "checkDoorClearance" },
      { statement: "門扇開啟弧線內不得有家具。" },
    ],
    examples: ["「門口保留 1.2 公尺」會被轉成 doorClearance 參數，直接影響服務桌的位置。"],
    confidence: "medium",
    sourceUrl: "https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0070115",
    sourceType: "government",
    retrievedAt: R,
    applicableVenueTypes: ["any"],
    limitations: [
      "1.2 公尺是本工具的預設設計值，不是特定法規對此場地的要求。",
      "現場的門寬、開啟方向與避難路徑需由專業人員確認。",
    ],
    requiresHumanReview: true,
  },
  {
    id: "circulation-aisle-width",
    title: "走道寬度與人流",
    category: "event-flow",
    summary:
      "走道寬度決定同時能有多少人並行通過。單向通過約需 0.6 公尺，兩人交會約需 1.2 公尺；" +
      "需要輪椅通行時應參考無障礙通路的規定。",
    rules: [
      { statement: "座位區之間的走道建議最小寬度", value: 0.9, unit: "m", appliesTo: "generateLayoutCandidates" },
      { statement: "主要通道建議寬度（可兩人交會）", value: 1.2, unit: "m", appliesTo: "generateLayoutCandidates" },
    ],
    examples: ["方案 C 把主通道拉到 1.2 公尺以上，換取較低的擁擠度。"],
    confidence: "medium",
    sourceUrl: "https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0070115",
    sourceType: "government",
    retrievedAt: R,
    applicableVenueTypes: ["classroom", "hall", "outdoor-booth"],
    limitations: [
      "0.6／1.2 公尺是人體工學慣例，不是此場地的法定走道寬度。",
      "避難用的走道寬度另有規定，需由專業人員判定。",
    ],
    requiresHumanReview: true,
  },

  /* ---------------- booth ---------------- */
  {
    id: "booth-module-3x3",
    title: "展場攤位的標準模組",
    category: "booth-layout",
    summary:
      "展覽攤位普遍以 3 公尺 × 3 公尺為一個標準模組（部分展場使用 2m × 3m 或 3m × 2m）。" +
      "攤位是否開放邊數（單面開放、轉角、島型）會直接改變參觀者能從哪裡進入。",
    rules: [
      { statement: "標準攤位模組邊長", value: 3, unit: "m", appliesTo: "generateLayoutCandidates" },
      { statement: "攤位入口不應正對主通道的行進方向，避免堵住通道。" },
    ],
    examples: ["3×3 攤位把桌子擺在側邊而非正前方，人才進得來。"],
    confidence: "medium",
    sourceUrl: "https://www.ufi.org/",
    sourceType: "industry-guide",
    retrievedAt: R,
    applicableVenueTypes: ["outdoor-booth"],
    limitations: [
      "各展場的攤位規格與通道寬度以該展場的參展手冊為準。",
      "校園攤位常不照展場模組，以現場劃位為準。",
    ],
    requiresHumanReview: false,
  },
  {
    id: "booth-entry-clear",
    title: "攤位入口不可阻擋主通道",
    category: "booth-layout",
    summary:
      "攤位的排隊區若溢出到主通道，會同時影響自己的參觀者與整條走道。設計時應把排隊區收在攤位內側，" +
      "或沿攤位邊緣折返，而不是往通道方向延伸。",
    rules: [
      { statement: "排隊區規劃在攤位範圍內，不往主通道延伸。" },
      { statement: "攤位入口與主通道之間保留緩衝，避免人停在通道上。" },
    ],
    examples: ["校園擺攤時，把體驗桌往內退 0.5 公尺，排隊的人就不會站在走道中央。"],
    confidence: "medium",
    sourceUrl: "https://www.ufi.org/",
    sourceType: "industry-guide",
    retrievedAt: R,
    applicableVenueTypes: ["outdoor-booth"],
    limitations: ["本工具的攤位檢查是幾何檢查，不代表主辦單位的擺攤規定。"],
    requiresHumanReview: false,
  },

  /* ---------------- furniture ---------------- */
  {
    id: "furniture-banquet-table",
    title: "長方形宴會／折疊桌常見尺寸",
    category: "furniture-dimensions",
    summary:
      "6 呎折疊宴會桌常見規格約 183 公分 × 76 公分 × 高 74–76 公分；8 呎款通常同寬同高、長度加長到約 244 公分。" +
      "報到桌實務上多半就是這種標準折疊桌加桌裙。",
    rules: [
      { statement: "6 呎折疊桌長", value: 1.83, unit: "m" },
      { statement: "折疊桌深", value: 0.76, unit: "m" },
      { statement: "折疊桌高", value: 0.75, unit: "m" },
    ],
    examples: ["把報到桌的尺寸設成 180×60×74 公分是合理的近似；實際租借前請確認廠商規格。"],
    confidence: "medium",
    sourceUrl:
      "https://expodirect.co.uk/product/6ft-rectangular-banqueting-table-183cm-heavy-duty-folding-event-table-eventpro-series",
    sourceType: "manufacturer",
    retrievedAt: R,
    applicableVenueTypes: ["any"],
    limitations: [
      "8 呎桌與圓桌的尺寸在研究中未取得直接的製造商頁面，屬業界慣例推論。",
      "不同品牌的高度在 74–76 公分之間有差異。",
    ],
    requiresHumanReview: false,
  },
  {
    id: "furniture-stacking-chair",
    title: "堆疊椅常見尺寸（推論值）",
    category: "furniture-dimensions",
    summary:
      "研究過程未取得堆疊椅的製造商規格頁。依一般會議／宴會椅的人體工學慣例，" +
      "座寬約 43–51 公分、深約 51–61 公分、座面高約 43–46 公分、椅背高約 81–91 公分。",
    rules: [
      { statement: "堆疊椅寬（推論）", value: 0.45, unit: "m" },
      { statement: "堆疊椅深（推論）", value: 0.55, unit: "m" },
    ],
    examples: ["排椅子時先用 45×55 公分估算，實際租借後再校正。"],
    confidence: "low",
    sourceUrl: "https://www.staples.com/buy/6-ft-tables-rectangle-0atz00a",
    sourceType: "inferred",
    retrievedAt: R,
    applicableVenueTypes: ["classroom", "hall"],
    limitations: [
      "這些數字沒有直接來源，是從人體工學慣例推得，僅供初步估算。",
      "來源連結是同批研究中最接近的家具通路頁，並非椅子的規格頁。",
    ],
    requiresHumanReview: false,
  },
  {
    id: "furniture-meditation-cushion",
    title: "禪坐坐墊（zafu / zabuton）常見尺寸",
    category: "meditation-event",
    summary:
      "圓形坐墊 zafu 常見規格約直徑 36 公分、高 18 公分；下方的方墊 zabuton 常見約 76–91 公分 × 71 公分 × 厚 8 公分。" +
      "以 zabuton 估算，每人約佔 0.7–0.9 公尺見方。",
    rules: [
      { statement: "zafu 直徑", value: 0.36, unit: "m" },
      { statement: "zabuton 寬", value: 0.76, unit: "m" },
      { statement: "zabuton 深", value: 0.71, unit: "m" },
    ],
    examples: ["禪學社茶會若每人一組 zafu + zabuton，座位間距抓 0.9 公尺較貼近實況。"],
    confidence: "medium",
    sourceUrl: "https://www.sagemeditation.com/zafu-and-zabuton-meditation-cushion-set/",
    sourceType: "manufacturer",
    retrievedAt: R,
    applicableVenueTypes: ["classroom", "hall"],
    limitations: [
      "不同品牌提供中／大／加大尺寸，範圍約 63–91 公分長、58–79 公分寬。",
      "台灣常見的方形巧拼地墊為 60×60 公分，與日式 zabuton 不同，本工具預設用 60×60。",
    ],
    requiresHumanReview: false,
  },
  {
    id: "furniture-yoga-mat",
    title: "標準瑜珈墊尺寸",
    category: "furniture-dimensions",
    summary: "市售標準瑜珈墊最常見為 173 公分 × 61 公分（68in × 24in），成人款長度多在 173–183 公分之間。",
    rules: [
      { statement: "瑜珈墊長", value: 1.73, unit: "m" },
      { statement: "瑜珈墊寬", value: 0.61, unit: "m" },
    ],
    examples: ["需要躺臥的活動用瑜珈墊估算，每人佔位比坐墊大很多。"],
    confidence: "medium",
    sourceUrl: "https://htsyoga.com/yoga-mat-size-chart-standard-vs-long-vs-extra-wide-by-height/",
    sourceType: "industry-guide",
    retrievedAt: R,
    applicableVenueTypes: ["classroom", "hall"],
    limitations: ["來源為瑜珈用品資訊網站，非標準機構。"],
    requiresHumanReview: false,
  },

  /* ---------------- classroom / tea / club ---------------- */
  {
    id: "classroom-row-spacing",
    title: "教室排列的行距與走道",
    category: "classroom-layout",
    summary:
      "教室式配置的每人面積慣例為 0.74–0.93 m²，含桌面與走動空間。排列時要同時滿足「排得下」與「走得過」，" +
      "後者由走道寬度而非面積決定。",
    rules: [
      { statement: "教室式每人面積", value: 0.85, unit: "m2-per-person" },
      { statement: "座位排之間仍須維持最小走道寬度", value: 0.9, unit: "m" },
    ],
    examples: ["面積算得下 90 人，但走道被壓到 0.5 公尺時，這個配置實際上不能用。"],
    confidence: "medium",
    sourceUrl: "https://jigsawconferences.co.uk/articles/venue-capacity-calculation-guide-uk-corporate-events",
    sourceType: "industry-guide",
    retrievedAt: R,
    applicableVenueTypes: ["classroom"],
    limitations: ["英國活動產業慣例值，非台灣教室設計標準。"],
    requiresHumanReview: false,
  },
  {
    id: "tea-event-flow",
    title: "茶會的動線與服務配置",
    category: "tea-event",
    summary:
      "茶會屬於站立／半座位的社交型活動，每人面積慣例接近站立酒會（0.56–0.74 m²）。" +
      "動線上的關鍵是報到與取用區不要重疊，否則剛進門的人和正在取茶的人會互相卡住。",
    rules: [
      { statement: "報到區與取用區分開設置，避免動線交叉。" },
      { statement: "站立社交每人面積", value: 0.65, unit: "m2-per-person" },
    ],
    examples: ["期初茶會把報到桌放門內側、茶點桌放另一側，人不會擠在同一處。"],
    confidence: "medium",
    sourceUrl: "https://spaces.townhall.co.uk/how-much-event-space-do-you-need/",
    sourceType: "industry-guide",
    retrievedAt: R,
    applicableVenueTypes: ["classroom", "hall", "activity-centre"],
    limitations: ["席地而坐的茶會不適用站立酒會的面積係數。"],
    requiresHumanReview: false,
  },
  {
    id: "student-club-staffing",
    title: "學生社團活動的人力現實",
    category: "student-club-event",
    summary:
      "社團活動的工作人員通常同時兼多個角色，且會在活動開始後被拉去做別的事。" +
      "設計時應假設「同時在崗的人力」少於「名單上的人力」，並優先選擇人力需求較低的方案。",
    rules: [
      { statement: "方案評分納入人力可行性：需要的服務桌數不應超過同時在崗人數。" },
    ],
    examples: ["名單上 6 人但同時只有 3 人在崗時，需要兩張桌的分流方案風險較高。"],
    confidence: "low",
    sourceUrl: "https://spacerental.tku.edu.tw/",
    sourceType: "inferred",
    retrievedAt: R,
    applicableVenueTypes: ["classroom", "activity-centre", "outdoor-booth"],
    limitations: [
      "這是從活動營運常識推得的設計原則，沒有量化來源。",
      "本工具只用它來調整評分權重，不會據此宣稱任何方案可行。",
    ],
    requiresHumanReview: false,
  },
  {
    id: "staff-operations-guidance",
    title: "分流需要現場引導才會成立",
    category: "staff-operations",
    summary:
      "把隊伍分成兩條、或把入口與出口分開，都需要指標或引導人員；沒有引導時人會自己走回最近的一條。" +
      "任何依賴分流的方案都應同時規劃引導。",
    rules: [{ statement: "採用分流方案時，同時需要指標或引導人力。" }],
    examples: ["方案 B 的風險欄位固定會提醒需要引導。"],
    confidence: "low",
    sourceUrl: "https://en.wikipedia.org/wiki/Queueing_theory",
    sourceType: "inferred",
    retrievedAt: R,
    applicableVenueTypes: ["any"],
    limitations: ["營運經驗法則，沒有量化來源。"],
    requiresHumanReview: false,
  },

  /* ---------------- visual comms / 3D ---------------- */
  {
    id: "visual-plan-legibility",
    title: "工作人員看得懂的場佈圖",
    category: "visual-communication",
    summary:
      "施工／場佈圖的用途是讓現場的人照著擺，因此需要：可辨識的俯視符號、實際尺寸標註、編號，" +
      "以及一份對應的物資清單。3D 透視圖適合溝通感覺，不適合現場對位。",
    rules: [
      { statement: "現場用圖以俯視圖為主，並標註尺寸與編號。" },
      { statement: "場佈圖需搭配物資清單，數量才對得起來。" },
    ],
    examples: ["匯出「施工圖」加「物資清單」給場佈組，比丟一張 3D 截圖有用。"],
    confidence: "low",
    sourceUrl: "https://www.mattersofgathering.com/post/essential-floor-plan-guidelines-for-a-successful-event",
    sourceType: "industry-guide",
    retrievedAt: R,
    applicableVenueTypes: ["any"],
    limitations: ["為活動產業的實務建議，非製圖標準。"],
    requiresHumanReview: false,
  },
  {
    id: "asset-placement-real-scale",
    title: "3D 素材必須以真實尺寸放置",
    category: "3d-asset-placement",
    summary:
      "本工具的 1 個 Three.js 單位等於 1 公尺。素材匯入時若沒有換算單位，" +
      "碰撞、走道與容量計算全部會錯。glTF 2.0 規範規定距離單位為公尺，匯入時應據此檢查。",
    rules: [
      { statement: "glTF 的距離單位為公尺，匯入時不得縮放成任意尺寸。" },
      { statement: "素材的語意尺寸與視覺模型分開儲存，換模型不改尺寸。" },
    ],
    examples: ["匯入一張桌子的 GLB 後，先確認長寬高是 1.8×0.6×0.74 而不是 180×60×74。"],
    confidence: "high",
    sourceUrl: "https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html",
    sourceType: "official-standard",
    retrievedAt: R,
    applicableVenueTypes: ["any"],
    limitations: ["規範規定單位，但不保證第三方模型有照做；仍需人工確認。"],
    requiresHumanReview: false,
  },
];

/* ------------------------------------------------------------------ */
/* Lookup helpers                                                      */
/* ------------------------------------------------------------------ */

const BY_ID = new Map(KNOWLEDGE_BASE.map((e) => [e.id, e]));

export function knowledgeEntry(id: string): KnowledgeEntry | undefined {
  return BY_ID.get(id);
}

export function knowledgeByCategory(category: KnowledgeCategory): KnowledgeEntry[] {
  return KNOWLEDGE_BASE.filter((e) => e.category === category);
}

export function knowledgeForVenue(venue: VenueType): KnowledgeEntry[] {
  return KNOWLEDGE_BASE.filter(
    (e) => e.applicableVenueTypes.includes(venue) || e.applicableVenueTypes.includes("any"),
  );
}

/** The first rule with a machine value for the given planner input. */
export function knowledgeValue(appliesTo: string): { value: number; unit: string; entry: KnowledgeEntry } | null {
  for (const entry of KNOWLEDGE_BASE) {
    for (const rule of entry.rules) {
      if (rule.appliesTo === appliesTo && rule.value !== undefined && rule.unit) {
        return { value: rule.value, unit: rule.unit, entry };
      }
    }
  }
  return null;
}

export interface CitedExplanation {
  text: string;
  citations: { id: string; title: string; sourceUrl: string; retrievedAt: string; confidence: Confidence }[];
  /** Present exactly when at least one cited entry needs human review. */
  disclaimer: string | null;
}

/**
 * Turn a list of knowledge ids into an explanation the UI can render with its
 * sources. The disclaimer is attached by the data, not by the caller
 * remembering to add it.
 */
export function explainWithSources(text: string, ids: readonly string[]): CitedExplanation {
  const entries = ids.map((i) => BY_ID.get(i)).filter((e): e is KnowledgeEntry => !!e);
  return {
    text,
    citations: entries.map((e) => ({
      id: e.id,
      title: e.title,
      sourceUrl: e.sourceUrl,
      retrievedAt: e.retrievedAt,
      confidence: e.confidence,
    })),
    disclaimer: entries.some((e) => e.requiresHumanReview) ? SAFETY_DISCLAIMER : null,
  };
}

/**
 * Throws when any entry makes a compliance claim. Called from the knowledge
 * test; exported so a future UI that composes text can reuse the same check.
 */
export function assertNoComplianceClaim(text: string, where: string): void {
  for (const phrase of FORBIDDEN_CLAIMS) {
    if (text.includes(phrase)) {
      throw new Error(`${where} 含有不得出現的合規宣稱：「${phrase}」`);
    }
  }
}
