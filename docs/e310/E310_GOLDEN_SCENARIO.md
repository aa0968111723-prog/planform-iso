# E310 + 走廊 Golden Venue／Golden Scenario 規格（WP-A）

目標：讓「淡江大學 E310 教室＋教室外走廊」成為正式 Release 的黃金場景。
Preset-first, fully customizable：預設一鍵可用，所有東西仍可改、可存成自己的模板。

## 0. 誠實規則（不可違反）

- 本專案**沒有**經現場確認的 E310 實測尺寸。所有預設數字都是「合理起點」。
- Preset 名稱固定為 **「E310＋走廊（待現場校正）」**；卡片與場地資訊都要出現「待校正」徽章。
- 未校正時，匯出的場刊圖 footer 必須帶「尺寸待現場校正」字樣（校正後消失）。
- 禁止把估計值標成實測。禁止捏造「真實 E310 數字」。

## 1. 現場已確認的拓撲事實（照片依據，非尺寸）

依 `D:\場務場刊E310` 空教室照片與活動實況照（含人臉，**不得**commit 進 repo）：

1. 教室前牆：整條**加高講台**（木製、墨綠桌面、高一階），上有**講桌**（含 AV 控制）與活動時的**明心輪圓盤**；前牆中央**電動投影幕**，兩側黑板。
2. 另有「側邊投影機」控制鍵——側投影幕存在但位置未確認（列入待校正清單，不進 preset fixtures）。
3. 教室兩側為窗牆（窗簾、窗型冷氣）→ 門只會在前/後牆。
4. **後門通往走廊**；走廊為淡粉紅地磚，連接 3F 開放廳（有置物櫃）。前牆側疑似另有一門（待現場確認，不進 preset）。
5. 教室地面為方形地磚（尺寸待校正；校正流程以「量一塊地磚」為最快路徑）。
6. 活動實際佈置（golden scenario 的目標畫面）：
   - **綠色巧拼（約 60×60 拼接墊）拼成一整片座區**，蓋住教室中段，朝投影幕；
     不是一張張 60×180 個人墊。
   - 參加者脫鞋、**鞋子放在巧拼區邊緣**（靠入口側）。
   - **後方長桌一排＝背包/水壺區**（背包放桌上，不是地上一塊區）。
   - 講師與主持站在講台前的磁磚地帶（講台與巧拼之間留一條走動帶）。

## 2. Venue Preset：`venue:tku-e310`

加入 `BUILTIN_VENUE_PRESETS`（src/core/venues.ts）：

- id `venue:tku-e310`，name **「E310＋走廊（待現場校正）」**，builtin
- note：一句話說明「工學大樓 3F E310 起點模板；到現場用一塊地磚/門寬/已知牆距 30 秒校正」
- classroom：`教室` 10 × 8（與現有淡江模板一致的誠實起點）
- corridor：`走廊` 10 × 2，位於教室後牆側（z = classroom.width）
- tile：0.6 × 0.6（待校正）
- fixtures：
  - 後門 door → classroom edge "s"（通走廊），offset 靠一端（沿用 8.6 風格）
  - 前投影幕 screen → edge "n" 中央（offset 5）
- **講台（新）**：preset 需要能放「非 door/screen 的固定物」。做法二選一（Codex 決定，擇簡）：
  a. `VenueFixture` 擴充 `kind: "platform" | "lectern"`（仍映射到 catalog entry / ObjectKind "table"），或
  b. `VenuePreset` 加 `extraObjects`: 依 catalog id + 位置生成 SceneObject。
  講台預設：6.0 × 1.2 × h 0.18，貼前牆（min-Z），置中，`locked: true`。
  講桌預設：0.6 × 0.45 × h 1.1，在講台上靠一端（surface floor、elevation 0.18 或平放講台旁，擇簡且視覺合理）。

## 3. Catalog 新條目（照 `builtin:payment-desk` 模式，kind 走 "table"，不動 ObjectKind）

1. `builtin:stage-platform` 講台平台 — semanticType "other"/storage 擇一，category "fixture"，
   6.0×1.2×0.18，blocksFlow: true，icon 🟩，proc + plan symbol（矩形＋斜紋即可）。
2. `builtin:lectern` 講桌 — 0.6×0.45×1.1，blocksFlow: true，icon 🎤。
3. mat entry 加 preset `m6060`「巧拼 60 × 60」（60×60×4cm）。
4.（P2，可選）`builtin:mind-wheel` 明心輪立牌 — signage 類，icon 🎯。

## 4. 巧拼「整片座區」模式（§8 地墊 UX 核心）

現況 `generateLayouts`（src/core/smartLayout.ts）排 0.6×1.8 個人墊。需求：

- 支援 **field 模式**：一片 rows×cols 的 0.6×0.6 巧拼 ArrayGroup（gap 0）。
- 人數 → 座位配置：每人佔 1 格寬（0.6m）× 2 格深（1.2m）緊湊；寬鬆檔每人 0.9m × 1.5m。
- 三個候選佈局維持既有 UX（視覺預覽、一鍵套用）：
  - A 整齊：單一大片，置中，朝投影幕
  - B 中央走道：兩片，中間留 ≥0.9m 走道
  - C 寬鬆：加大人均間距
- field 尺寸對齊 0.6 網格；容量顯示「可坐 N 人」；不足時明確說「塞不下，建議…」。
- 巧拼場不得與講台/桌子/區域重疊；避開任何 blocksFlow 物件與講台前 0.6m 走動帶。
- Quick Start 的 60/40/30/20 人都要能一鍵產生合理結果（unit test 驗證）。
- 淡江系 preset（tku-classroom、tku-e310）預設用巧拼 field；其他場地維持個人墊預設，
  UI 給「巧拼整片 / 個人墊」切換（一層、人話）。

## 5. Quick Start / 區域行為調整

- `QuickStartNeeds` 加 `life`（生活組區）；E310 golden 預設勾。
- backpack：改為「後牆長桌區」——zone 內沿後牆放 2 張 1.8×0.6 長桌（桌上即背包區），
  位置在門的另一端，不与報到/收費/鞋子鏈重疊。
- shoe：預設貼巧拼區靠門側邊緣（照片行為），保持可拖。
- 講師區（meditation）：放講台前方中央（講台下方磁磚帶），非教室中央。

## 6. Golden Scenario 一鍵範例

「更多/快速開始」內提供 **「E310 演講範例（60 人）」** 一鍵：

- venue = tku-e310，activity 名「E310 演講活動（範例）」
- 60 人；EventScenario：40 prepaid / 20 pay-on-site（profiles 已有 "prepaid"/"pay-on-site"）
- 到達窗預設 15 分鐘、front-loaded
- stations：entrance(走廊端)→guide(走廊)→queue(走廊沿牆)→checkin(報到桌)→
  payment(收費桌，僅 pay-on-site 分支)→shoe→backpack(長桌)→seating(巧拼區)
- 報到桌上放電腦、收費桌上放收費箱（既有 tabletop 機制）
- 入場動線 route：走廊起點 → 門 → 報到 → 鞋 → 座區前緣（不橫穿巧拼）
- 全部生成物皆一般可編輯實體。

## 7. 快速校正（現場 30 秒）

入口：選 E310 後頂部「待校正」banner → 「現場校正」。三個一層選項（人話）：

1. **量一塊地磚**：輸入實測邊長 cm → 更新 tile.width/depth。
2. **量門寬**：輸入 cm → 更新該 door 物件 width。
3. **量已知距離**：在圖上點兩點（沿用 measure snap）＋輸入實測 → 顯示差異（calibrationCompare），
   一鍵把教室長/寬按比例套用（套用前顯示 before→after 數字，可復原）。

- 校正狀態記在 project（例：`calibration.confirmed: { tile?: boolean; door?: boolean; room?: boolean }`，
  migrate 向後相容，不炸舊存檔）。
- 三項各自完成後對應「待校正」徽章消失；全部完成 → 匯出 footer 不再帶待校正字樣。

## 8. 驗收（Codex 完成 batch 的 Definition of Done）

- [ ] `npm run verify`（lint+typecheck+unit+build）綠
- [ ] `npm run test:e2e` 全綠（含新 golden E310 spec）
- [ ] Unit：E310 preset 幾何（門在後牆通走廊、講台貼前牆不重疊巧拼、
      60/40/30/20 人巧拼 field 全在教室內且避開講台與桌子）
- [ ] Unit：校正三路徑各自更新正確欄位並清除徽章
- [ ] E2E：一鍵 golden scenario → 模擬 → 匯出場刊圖（PNG 產出含走廊、無待校正誤標）
- [ ] 不改 ObjectKind enum、不動 docs/agent-handoff/**、不大規模 unrelated rewrite
- [ ] 全部 UI 文案人話、繁中，無工程術語

## 9. 禁止

- 只改 CSS 假裝修好、只加 TODO、mock 資料進 production 路徑
- 建第二套 core、換框架、不可逆 migration
- 把估計尺寸標成實測
