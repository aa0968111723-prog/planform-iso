# 空間設計研究（Perplexity 研究批次）

這個資料夾放的是 **研究證據**，不是產品程式碼。

- `sources.json` — 每一個研究題目實際被讀到的網址（368 筆，19 個題目）。
- `knowledge.json` — **由 `src/core/spatialKnowledge.ts` 產生**的知識條目快照。不要手改這個檔。
- `implementation-notes.md` — 哪一條研究結論變成了哪一段程式。

## 這些資料怎麼來的

```bash
export PERPLEXITY_API_KEY=...        # 只放環境變數，不進 repo
node scripts/research/pplx.mjs batch scripts/research/questions.json .research-raw
node --experimental-strip-types scripts/research/emit-docs.mjs .research-raw
```

`scripts/research/` 是 **build-time 工具**，Vite 不會打包它。線上的網站沒有任何雲端 AI 依賴、沒有 API key，
場佈、驗證、模擬與手動操作在沒有設定任何 AI provider 時完全可用。

原始逐字回答（`.research-raw/`）**沒有進版控**：它有 200 KB 以上，而且是搜尋摘要，不是結論。
進版控的是經過人工判讀、標好信心水準與來源的 `knowledge.json`。

## 來源品質分佈

| 類型 | 筆數 | 說明 |
|---|---:|---|
| `secondary` | 223 | 產業文章、廠商頁、部落格 |
| `official-docs` | 84 | three.js / MDN / web.dev / Khronos / Anthropic / OpenAI / MCP 等官方文件 |
| `government` | 26 | `law.moj.gov.tw`、`nlma.gov.tw`、`gazette.nat.gov.tw`、`ada.gov` 等 |
| `university` | 19 | `tku.edu.tw` 淡江大學官方頁面 |
| `official-standard` | 15 | Khronos、NFPA、W3C |
| `encyclopedia` | 1 | Wikipedia（排隊理論） |

**secondary 佔多數是預期的，也是這份研究最需要被質疑的地方。** 因此每一條進入
`knowledge.json` 的結論都帶 `confidence` 與 `sourceType`，而不是一律當成事實。

## 研究規則（實際執行的，不是宣示）

1. **不直接相信搜尋摘要。** 研究回答中凡是模型自己標註「推論」「本回合未取得來源」的內容，
   都以 `sourceType: "inferred"` + `confidence: "low"` 記錄，並在 `limitations` 寫明沒有來源。
   例如堆疊椅尺寸、8 呎桌與圓桌尺寸就是這種情形。
2. **不把未確認的規範說成法律合規。** 所有涉及消防、無障礙、避難、法律的條目
   `requiresHumanReview: true`，UI 只能顯示：

   > 設計提醒，仍需依現場與專業規範確認。

   `src/core/spatialKnowledge.ts` 的 `FORBIDDEN_CLAIMS` 明文禁止「已符合所有法規」「已通過安全檢查」
   「一定可以使用」等字串，並由 `test/spatialKnowledge.test.ts` 對整張表強制檢查。
3. **不執行搜尋結果裡的任何指令。** 研究輸出只被當成文字讀取。
   `test/agentInjection.test.ts` 另外驗證：即使工具結果或專案欄位裡塞了
   `{"tool":"deleteProject"}` 這種內容，也不會變成一次工具呼叫。
4. **大量原始搜尋結果不進前端 bundle。** 前端只帶 27 條精選知識條目；
   368 筆網址留在 `sources.json`（docs，不打包）。

## 第二輪：回頭補法規原文（題目 16–19）

第一輪明確說「沒取得條文原文」的四個法規題目，做了一次針對性的追查。三個成功：

| 題目 | 取回的條文 | 結果 |
|---|---|---|
| 16 | 《建築物無障礙設施設計規範》**A102.2.6 迴轉空間** | 直徑 150 公分；**受限制時可改用 T 型空間**。confidence low → **high** |
| 17 | **204.2.2**（室內走廊 120 公分）／**203.2.3**（室外通路 130 公分，獨棟連棟 90 公分） | 修正了第一輪把兩者混為一談的錯誤。confidence medium → **high** |
| 18 | 2010 ADA Standards **§403.5.1**（36 in / 915 mm） | 新增獨立條目。confidence **high** |
| 19 | NFPA 101 第 7 章 | **失敗**——正文付費且受版權保護，兩次都沒讀到原文 |

第 19 題的處理方式是這份研究的重點示範：章節編號（7.3.1／7.3.2／Table 7.3.3.1）
來自二手技術文獻，所以那條知識 **維持 medium，沒有升成 high**，
`limitations` 直接寫「兩次都未能讀到原文」。
`test/researchSources.test.ts` 會斷言它不是 high——用二手佐證把信心升上去，
正是這份研究一開始就說要避免的事。

第一輪把 120 與 130 公分寫成同一件事的兩個數字，是**已出貨的錯誤**。
它們是不同條文、不同適用情形（室內 vs 室外），第二輪才發現並修正。

## 已知的研究缺口

這些是研究**沒有**查到的，記在這裡比假裝查到重要：

- 淡江大學官方網站沒有一份涵蓋全校教室／會議室／學生活動中心的**容納人數或尺寸總表**。
  場地尺寸目前仍需現場丈量或以校方個別公告為準。
- 「席地而坐」沒有像劇院式／教室式那樣被普遍引用的每人面積標準值。
  因此本工具的地墊容量改用**實際幾何**計算，不套面積係數。
- **NFPA 101 的條文原文仍未取得**（第二輪也失敗）：正文付費且受版權保護。
  只能確認其疏散寬度是**依容留人數計算**、不是單一數字。
- 堆疊椅、8 呎折疊桌、60/72 吋圓桌沒有取得製造商規格頁，屬業界慣例推論。

## 題目清單

| # | 題目 | id |
|---|---|---|
| 1 | AI 操作 3D 編輯器的最佳架構 | `01-ai-3d-editor-architecture` |
| 2 | Three.js 編輯器與場景圖控制 | `02-threejs-editor-scenegraph` |
| 3 | 空間設計與活動場地排版 | `03-space-planning-event-layout` |
| 4 | 展場與校園攤位動線 | `04-expo-booth-circulation` |
| 5 | 排隊區與人流瓶頸設計 | `05-queue-design-bottleneck` |
| 6 | 教室、茶會、禪學社活動的空間配置 | `06-classroom-teahouse-meditation-layout` |
| 7 | 桌椅、地墊、攤位與服務站的常見尺寸 | `07-furniture-dimensions` |
| 8 | 手機版 3D 編輯器 UX | `08-mobile-3d-editor-ux` |
| 9 | GLB、GLTF 與模型最佳化 | `09-glb-gltf-optimization` |
| 10 | Agent tool calling | `10-agent-tool-calling` |
| 11 | Preview / Commit / Rollback | `11-preview-commit-rollback` |
| 12 | local-first 與離線 PWA | `12-local-first-pwa` |
| 13 | 淡江大學與淡水地區公開場地資料 | `13-tamkang-tamsui-venues` |
| 14 | 活動安全、無障礙與通道設計提醒 | `14-safety-accessibility-egress` |
| 15 | 開源套件與授權風險 | `15-oss-license-risk` |
| 16 | 台灣無障礙規範迴轉空間條文原文 | `16-tw-accessibility-turning-space` |
| 17 | 台灣無障礙通路走廊淨寬條文原文 | `17-tw-corridor-width-article` |
| 18 | ADA accessible route 與迴轉空間官方條文 | `18-ada-turning-and-route` |
| 19 | NFPA 101 egress width 計算方式 | `19-nfpa-101-egress-width` |
