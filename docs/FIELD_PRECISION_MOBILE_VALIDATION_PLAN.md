# Planform ISO — Field Precision, Mobile Usability & Validation Hardening

> **重要：手機 UX 已由實機截圖證明存在結構性問題。手機相關實作必須同時遵守 [`MOBILE_FIRST_REWRITE_ADDENDUM.md`](./MOBILE_FIRST_REWRITE_ADDENDUM.md)。若本文件原本的「不推倒 Bottom Nav / Bottom Sheet」等描述與補充契約衝突，以 Mobile-first Addendum 為準。**

## 目的

PR #5 已經完成素材語意模型、Placement Mode、Array Group、Validation Center、Mobile Bottom Sheet、施工圖輸出等核心架構。本階段不要重做素材 Registry 或 Desktop Workspace，但**允許且要求重構手機 App Shell、Topbar、Sheet、Inspector composition 與 gesture ownership**，把產品推進到「真的站在教室現場也能快速、精準、可靠操作」的狀態。

核心目標：

1. 現場量測與尺寸標註可真正使用
2. 手機必須改成 Canvas-first、單手友善、不誤觸
3. Validation 從碰撞檢查升級成實際場佈安全檢查
4. 大量地墊／椅子時仍保持流暢
5. 匯出施工圖更接近工作人員可以直接照圖執行

完整手機重構規格：[`docs/MOBILE_FIRST_REWRITE_ADDENDUM.md`](./MOBILE_FIRST_REWRITE_ADDENDUM.md)

---

# 1. Scope 原則

## 要做

- 現場 Measure Overlay
- 永久／暫時尺寸線
- 物件到牆／物件到物件／走道寬度量測
- 地磚格數與實際尺寸同步顯示
- 真正可操作的 Calibration Wizard
- **Mobile App Shell Rewrite：單列 Header、Canvas-first、可收合多段 Sheet、context toolbar**
- 手機 gesture arbitration
- 手機 placement ergonomics
- 小物件選取改善
- **Mobile Inspector 專用 composition，不得直接沿用 Desktop Inspector 長表單**
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
- 不重新設計 Desktop Workspace 核心

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

# 4. Mobile-first Workspace Rewrite（P0）

本章的詳細、具體、可驗收規格全部位於：

[`docs/MOBILE_FIRST_REWRITE_ADDENDUM.md`](./MOBILE_FIRST_REWRITE_ADDENDUM.md)

以下只列最核心的不可退讓條件：

- 手機預設 Canvas-first；主要工作狀態 Canvas 必須佔大部分可視畫面
- 頂部只能單列 Compact Header，不得常駐五個視角＋名稱＋置中＋Snap
- Bottom Nav 再點 active tab 可收起 Sheet 回 Canvas
- Sheet 必須至少支援 collapsed / half / full 三段高度
- 點選物件後只出現 context bar，不得自動開巨大 Inspector
- Properties 需使用 Mobile 專用 composition
- 精準移動 D-pad 只在 mini-sheet 出現，不得長駐 Inspector
- 素材庫以分類切換＋compact grid 呈現，不得是一條超長清單
- 點素材後 Sheet 立即收起、進 Placement、Ghost 有 finger offset
- 兩指縮放／平移期間 SceneObject 不得移動
- 小型牆面素材需 pick proxy
- Validation issue 定位後 Sheet 自動收合，目標不可被遮住
- Measure 過程保持 Canvas 可見
- 使用 dynamic viewport / visualViewport 正確處理 Android Chrome 地址列、鍵盤、safe-area
- Desktop / 大型平板不要被這次手機重構破壞

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

Desktop 可支援方向鍵；Mobile 必須使用 compact mini-sheet / D-pad，不得像目前長表單一樣常駐。

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

## 8.1 Broad phase

建立 spatial hash / uniform grid。

只比較可能相交的近鄰。

## 8.2 Exact segment vs OBB

動線與家具碰撞不要再固定取樣。

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

---

# 9. Construction Plan 2.0

既有施工圖輸出繼續強化：

- 完整場佈圖
- 地墊／座位圖
- 動線圖
- 工作人員配置圖
- A4 / A3
- portrait / landscape
- 主要尺寸標註
- 地墊與座位編號
- 素材數量清單
- 圖例與比例尺

輸出不得包含：selection outline、ghost、editor chrome。

---

# 10. 相容性

必須保留：

- JSON import / export
- local-first autosave
- named layouts
- Undo / Redo
- PWA / offline
- views
- tile snapping
- zones
- routes
- placement
- ArrayGroup
- v1 / v2 migration

手機 UI state 可以是 session-only，不要污染 Project JSON。

---

# 11. Testing / Acceptance

除了 core tests，必須做 mobile viewport / browser smoke。

至少驗收：

- 360×800
- 390×844
- 412×915
- 480×960
- 768×1024 portrait
- 1024×768 landscape

手機完整流程：

1. 開站 Canvas 清楚可見
2. 場地設定
3. 開素材 Sheet
4. 兩次 tap 內選地墊並回 Canvas
5. Placement ghost 不被手遮住
6. 放地墊
7. 雙指縮放不誤拖
8. 選物件只出現 context bar
9. 開 Properties 修改尺寸
10. 收合 Sheet 回 Canvas
11. 精調 1cm / 5cm
12. 建立 Array Group
13. 畫動線
14. Measure 走道
15. Validation 定位問題且不被 Sheet 遮住
16. Undo 容易取得
17. 匯出施工圖
18. Chrome 地址列 / orientation / Android back 行為正常

---

# Definition of Done

真正驗收標準是：

使用者站在真實教室，只拿手機，就能依地磚精準排場、量走道與牆距、避免手勢誤觸、發現擋門／窄走道／超界問題，最後匯出工作人員能直接照著排的配置圖；同時舊專案、JSON、local-first、Undo/Redo、PWA 不被破壞。

**若手機仍然像桌面版縮小、頂部工具列佔多排、Inspector 自動蓋半屏以上、素材庫必須長距離捲動、Canvas 在主要狀態只剩少量空間，即視為 PR 未完成。**