# Planform ISO — Field Precision, Mobile Usability & Validation Hardening

## 目的

PR #5 已經完成素材語意模型、Placement Mode、Array Group、Validation Center、Mobile Bottom Sheet、施工圖輸出等核心架構。本階段**不要重做素材系統、不要再大改整體 UI 架構**，而是把產品推進到「真的站在教室現場也能快速、精準、可靠操作」的狀態。

核心目標：

1. 現場量測與尺寸標註可真正使用
2. 手機單手／雙手操作穩定、不誤觸
3. Validation 從碰撞檢查升級成實際場佈安全檢查
4. 大量地墊／椅子時仍保持流暢
5. 匯出施工圖更接近工作人員可以直接照圖執行

---

# 1. Scope 原則

## 要做

- 現場 Measure Overlay
- 永久／暫時尺寸線
- 物件到牆／物件到物件／走道寬度量測
- 地磚格數與實際尺寸同步顯示
- 真正可操作的 Calibration Wizard
- 手機 gesture arbitration
- 手機 placement ergonomics
- 小物件選取改善
- Validation 規則強化
- Validation 效能最佳化
- Construction Plan 分層／分頁輸出
- 場佈素材數量清單
- Array Group 精準操作
- 舊專案相容與 migration
- 測試與 E2E smoke

## 不做

- 不新增舞台
- 不新增音響／麥克風
- 不新增檀香／三色光
- 不新增 AI
- 不新增登入／後端／雲端同步
- 不新增多人協作
- 不做 BIM / CAD 級牆體建模
- 不重做 PR #5 的素材 Registry
- 不重新設計整套 Desktop Workspace
- 不把既有 Bottom Nav / Bottom Sheet 推倒重做

---

# 2. Field Measurement 2.0

目前純函式量測能力已存在，本階段將它變成真正的 Canvas 工具。

## 2.1 Measure Mode

建立可進入／退出的 Measure Mode。

流程：

1. 點擊起點 A
2. 點擊終點 B
3. 畫面立即出現尺寸線
4. 顯示：
   - 公尺
   - 公分
   - X 向差值
   - Z 向差值
   - 約跨幾塊地磚
5. 可選擇「保留標註」或「清除」

## 2.2 Measurement Annotation model

新增獨立資料型別，不要把量測結果塞進 SceneObject：

- id
- type
- start
- end
- label
- locked
- visible
- style

建議 type：

- free-distance
- wall-clearance
- object-gap
- aisle-width

永久量測需進 Project state、JSON、Undo/Redo、migration。

暫時量測可以只存在 session state。

## 2.3 Snap for measurement

量測端點可吸附到：

- 地磚交點
- 地磚中心
- 物件 bounding box 邊緣
- 物件中心
- 牆面
- 門框

吸附時顯示小型 snap hint。

## 2.4 Object-to-wall

選取物件後提供：

- 最近牆距離
- 左牆距離
- 右牆距離
- 前牆距離
- 後牆距離

距離應考慮物件 footprint 邊界，不只是物件中心點。

## 2.5 Object-to-object gap

支援：

- 地墊 ↔ 地墊
- 椅子 ↔ 椅子
- 桌子 ↔ 桌子
- 任意兩物件

顯示最近邊界間距，不是中心點距離。

## 2.6 Aisle width

新增「走道寬度」量測。

使用者可點兩側物件／區域邊界，或由系統自動找兩個相對障礙邊界。

顯示：

- 實際寬度 cm
- 是否低於目前安全門檻

安全門檻預設值可設定，但不要假裝為法律標準。此處只做使用者自訂場佈規則。

---

# 3. Calibration Wizard

目前 calibration 主要是比較資料，本階段做成明確流程。

## 3.1 校正入口

在「場地」工作流中加入：

`現場校正`

## 3.2 Wizard

Step 1：選校正來源

- 一塊地磚
- 一段牆面
- 任意已知距離

Step 2：在畫布選兩個點

Step 3：輸入真實長度

例如：

`這段實際是 8.40 m`

Step 4：顯示比較

- 模型距離
- 實際距離
- 差異百分比
- 若套用比例，哪些資料會受影響

Step 5：明確選擇

- 只記錄校正結果
- 調整地磚尺寸
- 調整教室尺寸
- 取消

不要自動全域縮放而不告知使用者。

## 3.3 Safety

任何可能改變既有場佈位置的 calibration action：

- 必須可 Undo
- 必須有確認訊息
- 必須顯示影響範圍
- 不得 silently 改動所有物件

---

# 4. Mobile Gesture Hardening

目前手機已有 Bottom Nav / Bottom Sheet；這次專注手感與避免誤觸。

## 4.1 Gesture arbitration

明確定義：

- 單指點擊：選取
- 單指拖曳選中物件：移動
- 單指拖空白：若非 placement，依目前相機模式決定平移／旋轉
- 雙指 pinch：縮放
- 雙指 drag：平移
- 雙指 gesture 期間不得移動 SceneObject

需要建立 pointer state machine，不能只靠單一 pointerdown/move 判斷。

## 4.2 Drag threshold

手機 touch drag threshold 與 mouse 分開。

避免手指點一下素材卻被判斷成拖曳。

## 4.3 Ghost finger offset

Placement Mode 在手機上 ghost 不應完全藏在手指正下方。

提供合理 offset，讓使用者能看到：

- ghost
- snap 點
- legality 狀態
- 距離提示

## 4.4 Small target picking

門、開關、投影幕等薄型牆面物件，要有額外 pick proxy / hit area。

視覺尺寸不變，但觸控命中區可放大。

## 4.5 Context actions

手機選取後 bottom contextual toolbar 優先：

- 移動
- 旋轉
- 複製
- 尺寸
- 更多

刪除放在 More / danger 區域，避免誤按。

## 4.6 Undo ergonomics

Undo 必須在手機容易取得。

至少：

- contextual action 後顯示短暫 Undo snackbar，或
- 固定可見 Undo action

不要只藏在 More。

## 4.7 Sheet avoidance

Bottom Sheet 打開時：

- Canvas 可視範圍重新計算
- focus / zoom 不要把目標移到 Sheet 後面
- 點 Validation issue 定位時需避開 Sheet

---

# 5. Placement Precision

PR #5 已有 Placement Mode，本階段做精準化。

## 5.1 Live dimensions

Ghost placement 時可顯示：

- 距最近牆
- 所在地磚座標
- 與最近同類素材間距
- 是否在所屬 Zone 內

避免資訊過多；手機只顯示最關鍵 1–2 項。

## 5.2 Nudge

選取物件後提供小幅精調：

- ±1 cm
- ±5 cm
- 一格地磚
- 半格地磚

Desktop 可支援方向鍵；Mobile 可使用「精準移動」小面板。

## 5.3 Rotation precision

提供：

- 15°
- 45°
- 90°
- 自訂角度

牆面素材依 wall anchor 優先維持對齊。

## 5.4 Align / distribute

多選時提供：

- 對齊左／右／上／下
- 水平等距
- 垂直等距
- 對齊地磚線

不要破壞 Array Group；群組應以群組為單位操作，除非進入個別編輯。

---

# 6. Array Group Hardening

## 6.1 Persistent semantic group

保持 ArrayGroup，不回退成大量獨立 SceneObject。

## 6.2 Group editing

選取群組可快速調整：

- rows
- cols
- item size
- gap X
- gap Z
- rotation
- anchor

即時 ghost / preview 再 commit。

## 6.3 Numbering

地墊與椅子群組支援編號：

- A-01, A-02...
- 可設定起始方向
- 可設定 row-first / column-first

編號主要用於施工圖與 Field Info，不一定一直顯示在 3D。

## 6.4 Partial override

若實作成本合理，可允許個別 member 位置 override；否則本 PR 明確不做，改以「解除群組」處理。

不要做半套、不穩定 override。

---

# 7. Validation 2.0

現有 Validation 已有 bounds、overlap、door sweep、wall-off、computer parent、zone bounds、route cross。本階段在此基礎強化。

## 7.1 新規則

至少加入：

- aisle-too-narrow
- entrance-blocked
- registration-blocks-entry
- screen-view-blocked
- shoe-zone-blocks-route
- backpack-zone-blocks-route
- mat-too-close-to-wall（門檻可設定）
- primary-route-conflict

這些規則使用「可設定門檻」，不要宣稱為法規。

## 7.2 Rule settings

Validation Settings：

- 最低走道寬度
- 門前額外淨空
- 地墊距牆最低距離
- 是否檢查投影幕視線區
- 是否檢查功能區侵入主動線

保留合理 defaults，但可修改。

## 7.3 Severity

維持：

- Error
- Warning
- Info

但每個 Issue 增加：

- shortTitle
- message
- target(s)
- focus
- optional suggestedAction

## 7.4 Fix assist

Validation 不要自動亂改場佈。

可以提供安全的輔助動作：

- 定位
- 選取相關物件
- 開啟尺寸面板
- 開啟對應設定

只有非常明確的可逆操作才可提供「一鍵修正」。

---

# 8. Validation Performance

現有 O(n²) overlap 在大量地墊／椅子時需要改善。

## 8.1 Broad phase

建立 spatial hash / uniform grid。

只比較可能相交的近鄰。

## 8.2 Exact segment vs OBB

動線與家具碰撞不要再固定 12 點取樣。

實作真正 segment-vs-rotated-rect / OBB intersection。

## 8.3 Debounce / incremental validation

拖曳中的 Validation：

- 可以顯示 placement legality
- 完整 Validation 不必每個 pointermove 全量重跑

建議：

- transient drag 使用局部規則
- commit 後 debounce 完整 Validation

## 8.4 Performance target

至少驗證：

- 100 張地墊
- 100 張椅子
- 10+ zones
- 多條 routes

在一般手機仍可正常拖曳與檢查。

不要硬寫 FPS 保證數字，但需實測並回報。

---

# 9. Construction Plan 2.0

既有施工圖輸出保留，新增「用途導向輸出」。

## 9.1 Output presets

提供：

### 完整場佈圖
- 教室 / 走廊
- 地磚
- 區域
- 固定設施
- 家具
- 地墊
- 主要尺寸

### 地墊 / 座位圖
- 地墊或椅子編號
- 行列
- 間距
- 牆距
- 投影幕方向

### 動線圖
- 淡化家具
- 強調 Route
- 顯示入口、報到、鞋子、背包等重要區域

### 工作人員配置圖
- 功能區域
- 報到桌
- 重要設備
- 動線
- 簡單圖例

## 9.2 Page options

- A4
- A3
- landscape
- portrait

若瀏覽器 PNG canvas 無法真正表示紙張 DPI，可用邏輯尺寸 / ratio 呈現，不要宣稱精確印刷 DPI。

## 9.3 Dimension annotations

匯出可選：

- 教室總長寬
- 主要走道寬度
- 地墊群組占用尺寸
- 報到桌到門距離

不要把每個物件都標尺寸造成爆炸。

## 9.4 Inventory summary

匯出或旁邊提供素材數量：

- 椅子：xx
- 地墊：xx
- 桌子：xx
- 報到桌：xx
- 電腦：xx

ArrayGroup 必須正確計入 member 數量。

---

# 10. Field Info 2.0

Inspector 目前已有地磚與距牆資訊，本階段改善可讀性。

例如：

## 地墊 A-04

- 尺寸：60 × 180 cm
- 第 1 排 / 第 4 張
- 地磚：X7 / Z5
- 左牆：60 cm
- 前方間距：20 cm
- 所屬：小組 1
- 狀態：無衝突

## 門

- 寬：90 cm
- 牆面：教室南側
- 鉸鏈：左
- 開向：向外
- 開啟：90°
- Door sweep：無阻擋

Field Info 必須是人類可讀，不要只顯示 raw x/z。

---

# 11. UI/UX 原則

這支 PR 不再重新設計三欄 Desktop Workspace。

只做：

- 減少操作摩擦
- 增加 contextual controls
- 手機手勢穩定
- 精準工具按需顯示
- Validation / Measurement 更好理解

## Progressive disclosure

第一層只顯示常用設定。

精準 X/Z/rotation、raw dimensions、advanced validation 放進「進階」。

## Status feedback

每次重要操作要有可理解的 feedback：

- 已吸附牆面
- 已放到報到桌
- 超出區域 20cm
- 走道剩餘 75cm
- 已建立 30 張地墊

避免只有顏色變化。

---

# 12. State / Migration

若新增：

- measurementAnnotations
- validationSettings
- constructionExportSettings

必須：

- bump project version
- migration v2 → 新版本
- 舊資料缺欄位時補 defaults
- JSON roundtrip
- localStorage named layouts 可正常載入

不得破壞 PR #3 / #5 產生的舊專案。

---

# 13. Tests

至少補：

## Unit

- edge-to-edge distance
- wall clearance footprint
- aisle width
- measurement annotation serialization
- calibration compare/apply logic
- spatial hash candidate set
- segment-vs-rotated-rect
- new validation rules
- validation settings
- array numbering
- inventory count
- migration

## Integration / browser smoke

至少驗證：

1. 手機 viewport 開啟 App
2. Bottom Sheet 選素材
3. 放置地墊 / 椅子
4. pinch zoom 不會移動物件
5. 選小型開關仍容易點到
6. 建立量測
7. 固定尺寸線
8. 修改 ArrayGroup
9. Validation 找出窄走道
10. 點 Issue 能 focus
11. 匯出施工圖
12. refresh 後資料仍存在

---

# 14. Definition of Done

完整驗收流程：

1. 開啟既有 v2 專案，資料無損
2. 建立 / 調整教室尺寸與地磚
3. 手機使用雙指縮放與平移，不誤拖物件
4. 新增門、報到桌、電腦、地墊、椅子
5. 地墊 ArrayGroup 修改行列與間距
6. 量測地墊到牆距離
7. 量測地墊間距
8. 量測主要走道寬度
9. 將至少一條尺寸線保留在專案
10. Calibration Wizard 可以比較實際距離與模型距離
11. 設定最低走道門檻
12. Validation 找出窄走道／擋門／超界／重疊等問題
13. 點 Issue 自動選取並正確 focus，手機不被 Sheet 擋住
14. 大量 100 地墊 + 100 椅子時仍能正常使用
15. 匯出完整場佈圖
16. 匯出地墊 / 座位圖
17. 匯出動線圖
18. 素材數量統計正確
19. JSON export/import roundtrip 成功
20. PWA build / offline 不被破壞
21. lint / typecheck / tests / build 全部通過

---

# 15. 實作順序建議

優先依垂直切片完成，不要一次大改所有檔案：

## Phase A — Measurement foundation

- measurement model
- overlay
- edge distance
- field info
- tests

## Phase B — Mobile gesture hardening

- pointer state machine
- pinch/pan
- pick proxy
- sheet avoidance
- tests / manual browser validation

## Phase C — Validation 2.0

- settings
- aisle / entrance / route rules
- spatial hash
- segment vs OBB

## Phase D — Construction Plan 2.0

- output presets
- annotations
- inventory

## Phase E — Calibration & polish

- wizard
- persistence
- migration
- final mobile/desktop regression

---

# 16. 最終原則

這一階段不要用「新增更多功能」衡量成功。

真正的成功標準是：

> 使用者站在真實教室，只拿手機，就能精準量距離、依地磚排地墊、快速發現擋門或走道不足，最後把一張工作人員看得懂、可以直接照著排的圖交出去。

若最後只是多幾個按鈕、更多設定或再做一次視覺重構，即不符合本 PR 目標。
