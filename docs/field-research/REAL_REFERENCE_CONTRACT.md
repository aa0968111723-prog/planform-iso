# Planform 1.0 真實參考資料契約

本文件是 Release Candidate PR #17 的正式驗收補充。目的不是增加新產品方向，而是確保 E310、走廊、地墊、物資、區域、動線與場刊圖都以真實資料為依據，而不是 generic classroom imagination。

## 1. 最終原則

Planform 1.0 必須符合：

- 淡江大學教室與 E310＋外側走廊的真實情境
- 淡江禪學社實際活動流程與物資
- 使用者本機既有照片、場刊圖、場佈圖、素材、專案資料
- Preset-first, fully customizable：預設非常方便，但所有預設都可修改、複製、重新命名與儲存為「我的場地／我的素材」

不得用 generic office/classroom kit 取代真實使用需求。

## 2. 資料來源優先順序

1. 本機既有專案／活動資料（最高優先）
2. Repository 既有資料
3. 使用者過去保存的場刊圖、場佈圖、照片、JSON、素材與輸出
4. 公開淡江大學資料
5. 公開淡江禪學社相關資訊
6. 最後才允許合理估計，而且必須標示「待確認／待校正」

若本機已有真實資料，不得跳過資料直接自行假設。

## 3. 本機資料盤點

Lead Agent 在修改 presets/assets 前必須先盤點合理的專案與活動資料位置，例如 repository、專案工作資料夾、Documents、Pictures、Downloads、Desktop 中與淡江／禪學社／E310／場刊直接相關的資料。

可檢查：`.jpg` `.jpeg` `.png` `.webp` `.pdf` `.json` `.md` `.txt` `.csv` `.glb` `.gltf`。

重點關鍵詞：E310、淡江、禪學社、社課、茶會、演講、場刊、場佈、地墊、報到、收費、鞋子、背包、生活組、講師、小組。

禁止無限制掃描無關私人資料；禁止讀取 `.env`、密碼、token、private key、瀏覽器 credential store 或無關私人文件。

盤點結果應整理為：

- `docs/field-research/LOCAL_REFERENCE_AUDIT.md`
- `docs/field-research/REFERENCE_MAPPING.md`

## 4. Evidence / Confidence

每個高頻 preset 或重要場地資訊應能追溯來源，至少記錄：

| Item | Source | Confidence | Used For | Needs Verification |
|---|---|---|---|---|
| E310 門位置 | 現場照片／圖面 | verified/high/... | venue preset | yes/no |
| 地墊外觀與排列 | 社課照片 | high | mat preset | yes/no |
| 報到桌配置 | 活動照片／場刊 | high | service preset | yes/no |

Confidence 建議：`verified` / `high` / `medium` / `estimated` / `unknown`。

沒有可信資料的尺寸不得宣稱為「真實精確尺寸」。E310 若未實測，必須維持「待現場校正」。

## 5. 必須依真實圖檢查的高頻內容

至少：

- 地墊／巧拼：尺寸感、顏色、密度、朝向、中央走道、講師前方留空、門口留空
- 桌子、椅子
- 報到桌、收費桌、電腦
- 鞋子區、背包區
- 生活組區、講師區、小組區
- 門、投影幕
- 指示牌／文宣（若真實資料顯示高頻使用）

目標不是 photorealistic，而是「一眼看得出這是我們真的會用的東西」。

## 6. 淡江禪學社真實需求研究

若本機資料不足，可用公開可信資料補足，但研究只服務產品決策，不做泛化介紹。

應回答：

- 社課／茶會／演講／迎新常見場佈是什麼
- 報到、收費、引導、鞋子、背包、入座如何發生
- 哪些物資／區域／動線是高頻
- 場刊圖與夥伴模式最需要讓人一眼看到什麼

整理為：`docs/field-research/TKU_ZEN_REAL_WORLD_REQUIREMENTS.md`。

## 7. 三 AI 分工

### Claude — Lead / Product & Architecture

- 先讀本機與 repo 參考資料，再決定 presets
- 統整真實需求與 Evidence Mapping
- 防止產品偏離淡江禪學社現場用途
- Review Codex 實作與 Grok findings
- 最終 Release Authority

### Codex — Implementation Engineer

- 依 reference/evidence 實作 venue、assets、zones、routes、export
- 不得用 generic mock 取代已有真實參考
- 補 unit/E2E/regression tests

### Grok — Adversarial Field Tester

- 用 E310＋走廊真實流程盲測
- 專門檢查：「像不像我們真的會擺？」「夥伴拿到圖看不看得懂？」
- generic、不符合真實物資或流程的結果要列 defect

## 8. E310 Golden Scenario Gate

至少用以下流程驗收：

走廊 → 引導 → 排隊 → 報到 → 已繳／未繳分流 → 收費 → 鞋子 → 背包 → E310 → 地墊入座。

同時檢查：地墊、報到／收費桌、電腦、鞋子／背包、生活組、講師、小組、門、投影幕、動線與場刊圖是否符合真實參考。

## 9. 場刊圖 Gate

輸出的 E310＋走廊場刊圖必須：

- 能直接傳 LINE 給夥伴
- 中文清楚、區域／動線／物資一眼可辨認
- 不出現 editor/debug/ghost/selection
- 地墊與物資配置與 Evidence Mapping 一致
- 未校正資訊誠實標示，不把估計偽裝成實測

## 10. Release 判定

除了功能與測試通過，Claude 最後必須回答：

> 「這些地墊、物資、區域、動線與場刊圖，看起來是否真的像淡江禪學社會在 E310 使用的場佈？」

若答案不是肯定的，就不算完成。繼續以真實資料修正，不再新增產品方向。
