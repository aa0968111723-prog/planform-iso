# 研究結論 → 程式碼

哪一條研究變成了哪一段程式。沒有變成程式的也列出來，並說明為什麼。

---

## 一、AI 操作 3D 編輯器的架構（題目 1、2、10、11）

**研究結論**：編輯器讓外部呼叫者操作場景時，一律走「命令 / 交易層」，
不讓呼叫者直接改場景圖。three.js editor 的 `editor/js/commands` 就是這個形狀：
每個編輯是一個 Command 物件，undo/redo 由 command stack 負責。
Agent tool calling 的官方指引則要求：參數用 JSON Schema、嚴格驗證、
失敗要回結構化錯誤而不是靜默成功、工具走 allowlist。

**變成什麼**：

| 結論 | 檔案 |
|---|---|
| 工具參數用宣告式 schema，未宣告的參數是錯誤 | [src/agent/toolSchema.ts](../../../src/agent/toolSchema.ts) |
| allowlist 由 schema 推導，不手抄第二份 | [src/agent/tools.ts](../../../src/agent/tools.ts) |
| 工具只操作 domain model，不碰 Three.js mesh | [src/agent/executor.ts](../../../src/agent/executor.ts) |
| draft / commit / rollback 是唯一的寫入路徑 | [src/agent/transaction.ts](../../../src/agent/transaction.ts) |
| 計畫文件之外的能力（專案庫、鏡頭、匯出）另外注入 | [src/agent/host.ts](../../../src/agent/host.ts) |

**特別記一筆**：研究說「失敗要回結構化錯誤而不是靜默成功」。
稽核當下的 `executor.ts` 有六個工具違反這條——`updateZone`、`updateRoute`、
`updateArray`、`updateAssetMetadata`、`createArray`、`measureGap` 都回
`{ ok: true, data: { skipped: true, note: "請用手動屬性面板（V1）" } }`。
使用者讀到的是「已完成」。這是這次改動裡最直接由研究驅動的修正。

---

## 二、排隊與人流（題目 5）

**研究結論**：

1. 多個服務窗口併成**一條共用隊伍**（M/M/c），平均等待低於同樣窗口數各排一條。
2. 使用率超過約 0.8 之後，等待時間對人力極度敏感。
3. 分流的效益取決於兩邊的**需求比例**，不是桌子數量。

**變成什麼**：

- `src/core/spatialPlanner.ts` 的 `SchemeParts.serviceModel`。
  方案 A（共用桌）用 `buildCheckinPaymentVariants().combined` 模擬：
  一條隊伍、服務時間相加。方案 B/C 用 `.separated`。
  **這條研究直接改掉一個會讓功能失去意義的錯誤**：原本 A 被當成
  「兩張剛好靠在一起的桌子」，A 和 B 的平均等待都是 131 秒，
  「比較方案」等於沒說話。
- 同檔的人力分配改成依 offered load（到達比例 × 平均服務秒數）。
  只有 1/3 的人現場繳費，平均分配會讓收費桌閒置、報到桌塞車，
  方案 B 就輸在排班而不是輸在配置。修正後 B 從 131 秒降到 76 秒，
  瓶頸從報到移到鞋子區。
- `explainBottleneck` 用 0.8 這個門檻決定要不要說
  「增加一名人力的效果會大於移動桌子」。
- 知識條目：`queue-single-line`、`queue-utilisation-cliff`、
  `queue-parallel-servers`、`checkin-payment-split`。

---

## 三、每人面積與容量（題目 3、6）

**研究結論**：劇院式 0.56–0.74 m²、教室式 0.74–0.93 m²、圓桌宴會 0.93–1.11 m²、
站立酒會 0.56–0.74 m²。**全部是活動產業慣例，不是法規。**
而「席地而坐」**沒有**被普遍引用的單一標準值。

**變成什麼**：

- `calculateCapacity` 工具有兩條路徑：
  - `mode: "floor-mat"` → `method: "geometry"`，直接數實際鋪設的墊格
    （每人約兩格 60×60），**不套面積係數**。
  - 其他模式 → `method: "area-per-person"`，係數來自
    `knowledgeValue("calculateCapacity:<mode>")`，回傳裡帶著來源網址。
- 知識條目 `floor-seating-no-standard` 記錄的是「查不到標準」，
  不是「標準不存在」。`test/spatialKnowledge.test.ts` 斷言
  `knowledgeValue("calculateCapacity:floor-mat")` 為 null——
  也就是程式層面不可能為席地而坐編一個係數出來。

---

## 四、家具尺寸（題目 7）

**研究結論**：6 呎折疊桌 183×76×74–76 公分（有製造商頁）；
zafu 直徑 36 公分、zabuton 76×71×8 公分（有製造商頁）；
標準瑜珈墊 173×61 公分。
**8 呎桌、60/72 吋圓桌、堆疊椅沒有取得製造商規格頁**——
研究回答自己標明是「基於常見設計標準與人體工學實務規格的推論」。

**變成什麼**：

- `furniture-banquet-table`（confidence: medium，manufacturer 來源）
- `furniture-meditation-cushion`（medium，manufacturer）
- `furniture-yoga-mat`（medium，industry-guide）
- `furniture-stacking-chair`：**`sourceType: "inferred"`、`confidence: "low"`**，
  `limitations` 寫明「這些數字沒有直接來源」。
  `test/spatialKnowledge.test.ts` 斷言「每個 inferred 條目都必須是 low confidence」。

台灣常見的方形巧拼地墊是 60×60 公分，與日式 zabuton 不同——
本工具預設用 60×60（`DEFAULT_SEAT` 的 mat），這一點寫在
`furniture-meditation-cushion` 的 limitations 裡。

---

## 五、安全、無障礙與法規（題目 14）

**研究結論（第一輪 + 第二輪追查）**：

第一輪只拿到二手整理，所以四條全部標為需要人工核對。第二輪針對這四條回頭追，
拿回三條的條文編號與原文：

- **204.2.2**：室內通路走廊寬度不得小於 120 公分，走廊中有開門時，
  扣除門扇開啟空間後仍不得小於 120 公分。
- **203.2.3**：室外通路淨寬不得小於 130 公分；202.4 所列獨棟或連棟建築物得為 90 公分以上。
- **A102.2.6**：輪椅 360 度迴轉所需空間直徑 150 公分；**受限制時亦可改用 T 型空間**，
  該空間須平整、堅固且坡度在 1/50 以下。
- **ADA §403.5.1**：無障礙通路淨寬下限 36 英吋（915 公釐），
  短區段（≤24 英吋）可縮減為 32 英吋。
- **NFPA 101 第 7 章**：7.3.1 算容留人數、7.3.2／7.3.3 乘容量係數。
  **兩輪都沒讀到原文**——正文付費且受版權保護。

**第一輪出貨了一個錯誤**：把 120 與 130 公分寫成同一條文的兩個數字。
它們是不同條文、不同適用情形（室內 vs 室外），第二輪才發現。

**變成什麼**：

- `checkAccessibilityWarnings` 的迴轉空間檢查改成**真的量圓**：
  圓心在門往室內一個半徑的位置，用 `pointToRectDist` 算物件旋轉矩形到圓心的
  最短距離。原本是「有沒有東西距離**門**小於直徑的一半」——錯的形狀放在錯的中心。
  牆掛物件不算地面障礙。
  警告文字另外註明「規範在空間受限時允許改用 T 型迴轉空間，本工具只檢查圓形，
  所以這個提醒比規範嚴格」——A102.2.6 明文允許 T 型，工具比規範嚴就要說出來。
- `checkAccessibilityWarnings` 與 `checkDoorClearance` 的回傳
  **一律帶 `disclaimer: SAFETY_DISCLAIMER`**，內容固定是：

  > 設計提醒，仍需依現場與專業規範確認。

- 知識條目與信心水準：
  - `accessibility-corridor-width`（**high**，204.2.2，室內）
  - `accessibility-outdoor-path-width`（**high**，203.2.3，室外，第二輪新增）
  - `accessibility-turning-space`（**high**，A102.2.6，含 T 型替代方案）
  - `accessibility-ada-route`（**high**，§403.5.1，第二輪新增）
  - `egress-not-a-single-number`（**維持 medium**，章節編號來自二手文獻）
  - `door-clearance`（medium，寫明 1.2 公尺是本工具的預設設計值而非法規要求）
- 六條全部 `requiresHumanReview: true`。
- **NFPA 那條沒有升成 high**，即使結論被大量二手文獻佐證。
  用二手佐證把信心升上去，正是這份研究一開始就說要避免的事；
  `test/researchSources.test.ts` 會斷言它不是 high。
- `FORBIDDEN_CLAIMS` 明文禁止「已符合所有法規」「已通過安全檢查」
  「一定可以使用」等字串，`test/spatialKnowledge.test.ts` 對整張表強制檢查，
  並反向驗證守衛真的抓得到那些字串。

**沒有變成程式的**：任何形式的容留人數計算、避難寬度計算、無障礙認證。
研究明確指出這些需要依建築用途、樓層與現場實測判定。本工具比對的是
模型上的數字，不是現場的完成面。

---

## 六、展場攤位（題目 4）

**研究結論**：攤位普遍以 3×3 公尺為模組；
攤位入口與排隊區不應溢出到主通道。

**變成什麼**：`src/core/boothLayout.ts` 的三種攤位策略，用 `boothCatalog.ts`
的真實家具（帳篷、攤位桌、塑膠凳、展示板、立旗）：

| 方案 | 做法 | `booth-entry-clear` 的代價 |
|---|---|---|
| A 正面開放 | 桌子橫在正面 | **排隊區在主通道上**（`queueContained: false`） |
| B 側面入口 | 桌子轉 90 度靠邊，正面留一半當入口 | 排隊區收在攤位內 |
| C 體驗優先 | 桌子退到最後，正面中間留給體驗 | 排隊區收在攤位內 |

`booth-entry-clear` 直接變成 `keep-aisle-clear` 這個硬性限制：
使用者說「不能阻擋主要通道」時，方案 A `eligible: false` 並寫出理由，
但仍列在比較表裡讓使用者自己判斷。

`booth-module-3x3` 變成 `boothFrame()` 的 3 公尺上限，以及
`EVENT_TYPE_CUES` 裡 `攤位|擺攤|園遊會|市集|展攤` → `eventType: "booth"`。

攤位的容量改用 `event-area-per-person` 的**站立**係數（0.65 m²/人）算訪客區面積，
不是座位數——攤位沒有座位。而且 capacity 的權重歸零：同時站 6 人 vs
一個下午來 40 人是類別錯誤。

**沒有變成程式的**：改變場地尺寸。
「把這個 3×3 公尺攤位改成…」會被解析成 `venueSize` slot，
但 planner 回報 `unresolved`：

> 你提到場地是 3 x 3 公尺，但改場地尺寸要走「場地校正」，Agent 不會自己改。

場地尺寸是校正資料，改它有現實後果（施工圖會照著印）。
這一條由 `test/agentPlanner.test.ts` 的第 2 句測試釘住。

---

## 七、淡江大學場地（題目 13）

**研究結論**：`spacerental.tku.edu.tw` 是官方「對外場地借用資訊網」；
借用流程、申請窗口、部分場地詳頁查得到。
**但全校沒有一份公開的容納人數／尺寸總表。**

**變成什麼**：

- 知識條目 `venue-tku-space-rental`、`venue-tku-sports-fee-table`。
- `limitations` 明寫「官方網站未逐間公開容納人數與尺寸」，
  以及「本工具不會替使用者判斷某場地是否可借」。
- `test/researchSources.test.ts` 斷言題目 13 確實引用到 `tku.edu.tw` 網域。

**沒有變成程式的**：任何場地資料庫。
既然官方沒有公開尺寸總表，內建一份就等於捏造。場地尺寸仍然需要
現場丈量或以校方個別公告為準。

---

## 八、手機 UX、glTF、local-first（題目 8、9、12）

這三題的結論**大部分已經在既有程式裡**，研究的作用是確認方向而不是改寫：

- 手機版工作區斷點與 canvas-first 契約已在 `src/core/viewport.ts`
  與 `src/ui/workspaceViewport.ts`。本次只補了
  `SceneManager.canvasWidth()` 與 `App.workspaceMode`，
  讓 `getViewportState` 能誠實回答「現在是手機還是桌機」。
- glTF 2.0 規範規定距離單位是公尺 → 知識條目 `asset-placement-real-scale`，
  對應既有的「1 Three.js 單位 = 1 公尺」契約。
- local-first / IndexedDB / StorageManager 的結論對應既有的
  `src/assets/idbStore.ts` 與 `src/state/projectRepository.ts`，本次未改。

---

## 九、開源授權（題目 15）

研究確認：three.js、Vite、Vitest、glTF-Transform、vite-plugin-pwa 皆為 **MIT**；
Playwright 為 **Apache-2.0**。都是寬鬆授權，可用於重新散布的 Web 應用程式，
主要義務是保留版權聲明與授權條文。

本專案 `package.json` 宣告 `"license": "MIT"`，與相依套件相容。
**這不是法律意見。** 研究回答自己也這樣標註。
本次沒有新增任何相依套件，所以授權面沒有變動。

---

## 研究之外：Perplexity CLI 的位置

`scripts/research/` 是 **build-time 工具**：

- `pplx.mjs` 讀 `PERPLEXITY_API_KEY` 環境變數，key 不進檔案、不進 log、不進 commit。
- `emit-docs.mjs` 由原始逐字稿產生 `sources.json`，由
  `src/core/spatialKnowledge.ts` 產生 `knowledge.json`。

Vite 不打包 `scripts/`。線上的網站沒有雲端 AI 依賴、沒有 API key，
`AgentProvider` 抽象保留，`MockProvider` 保留作為測試 fallback，
未設定任何 provider 時場佈、驗證、模擬與手動操作完全可用。
