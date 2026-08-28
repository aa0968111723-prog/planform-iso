# 空間設計研究（Perplexity 研究批次）

這個資料夾放的是 **研究證據**，不是產品程式碼。

- `sources.json` — 每一個研究題目實際被讀到的網址（310 筆，15 個題目）。
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

原始逐字回答（`.research-raw/`）**沒有進版控**：它有 168 KB，而且是搜尋摘要，不是結論。
進版控的是經過人工判讀、標好信心水準與來源的 `knowledge.json`。

## 來源品質分佈

| 類型 | 筆數 | 說明 |
|---|---:|---|
| `official-docs` | 84 | three.js / MDN / web.dev / Khronos / Anthropic / OpenAI / MCP 等官方文件 |
| `university` | 19 | `tku.edu.tw` 淡江大學官方頁面 |
| `official-standard` | 15 | Khronos、NFPA、W3C |
| `government` | 7 | `law.moj.gov.tw`、各級政府 PDF |
| `encyclopedia` | 1 | Wikipedia（排隊理論） |
| `secondary` | 184 | 產業文章、廠商頁、部落格 |

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
4. **大量原始搜尋結果不進前端 bundle。** 前端只帶 25 條精選知識條目；
   310 筆網址留在 `sources.json`（docs，不打包）。

## 已知的研究缺口

這些是研究**沒有**查到的，記在這裡比假裝查到重要：

- 淡江大學官方網站沒有一份涵蓋全校教室／會議室／學生活動中心的**容納人數或尺寸總表**。
  場地尺寸目前仍需現場丈量或以校方個別公告為準。
- 「席地而坐」沒有像劇院式／教室式那樣被普遍引用的每人面積標準值。
  因此本工具的地墊容量改用**實際幾何**計算，不套面積係數。
- NFPA 101 的 egress width 與 ADA accessible route 的條文原文未取得，
  只確認 NFPA 101 的疏散寬度是**依容留人數計算**、不是單一數字。
- 台灣《建築物無障礙設施設計規範》的輪椅迴轉空間條文原文未取得，
  150 公分是常見引用值，`confidence: "low"`，需以官方 PDF 核對。
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
