# Planform ISO — Mobile-first Workspace Rewrite

> 本規格來自 Android 實機畫面檢查。這不是小幅 CSS 調整，而是手機資訊架構 P0 重構。Desktop / 大型平板工作台維持既有架構，手機直向使用獨立的 Mobile App Shell。

## 實機問題

目前手機版的主要失敗點：

- Topbar 同時顯示標題、Undo/Redo、5 個視角、名稱、置中、Snap，佔掉多排高度。
- 開啟素材庫後 Bottom Sheet 直接蓋住大部分 Canvas，主要工作變成捲面板。
- 選取區域/物件後 Inspector 自動變成大型表單，Canvas 幾乎完全消失。
- 「旋轉 / 複製 / 鎖定 / 隱藏 / 刪除」與名稱、寬深、精準移動同時出現在第一層，資訊密度過高。
- 1cm / 5cm / 半格 / 一格與大 D-pad 長駐，占用大量高度。
- 素材庫把所有功能區與家具做成大型卡片長列表，找素材需要大量捲動。
- Bottom Nav 存在，但沒有真正把手機變成 Canvas-first workflow。

根因：**Desktop workspace 的 controls 與 Inspector composition 被縮到手機，而不是重新設計手機 interaction model。**

---

# P0 成功標準

手機直向預設狀態必須做到：

1. Canvas 是主角，未開 Sheet 時佔 header 與 bottom nav 中間的全部區域。
2. Header 永遠只有一列。
3. 選取物件不自動打開大型 Inspector。
4. 素材/屬性/檢查/更多都是可快速收回的 Sheet。
5. 常用任務 1–2 taps 可達。
6. 手機只顯示當下任務需要的 controls。
7. 進階精準資料按需展開，不長駐。
8. Android Chrome 地址列、鍵盤、旋轉螢幕不破版。

---

# 1. Mobile App Shell

## Header

手機只保留一列 48–56px compact header：

- 專案名稱 / 平面場 ISO（截斷）
- Undo
- Redo
- View
- More

禁止常駐：

- 5 個 View chips
- 名稱
- 置中
- Snap selector
- Desktop workflow tabs
- Layers

View 點下去再顯示 mini popover/sheet：等角 / 俯視 / 正視 / 左視 / 右視，選完立即關閉。

Snap 移入 More 或 placement/move secondary settings。

## Bottom Nav

固定：

- 場地
- 素材
- 動線
- 檢查
- 更多

再次點 active item：收起 Sheet，返回純 Canvas。

---

# 2. Sheet System

不要只有「關閉 / 62vh」兩種。

建立 3 detents：

- collapsed：約 56–72px，只露 handle + title
- half：約 40–45dvh
- full：約 80–85dvh

必須：

- 有 drag handle
- swipe down 收合
- Android back 先收 Sheet
- Sheet 內容自己 scroll
- Sheet gesture 不傳給 Three.js Canvas
- Canvas focus safe area 依 Sheet 高度更新

任何 focusOn / validation focus / zoom-to-selection 都不能把目標放在 Sheet 後面。

---

# 3. 素材庫重構

手機不要同時顯示全部分類的長列表。

第一層 category tabs/chips：

- 區域
- 固定設施
- 家具
- 設備
- 地面用品
- 排列

一次只顯示一個分類。

素材卡改 compact cell：

- icon / thumbnail
- 名稱
- 尺寸小字
- placement type 用小 badge/icon，不重複長文字

足夠寬時 3 欄，窄手機 2 欄。

搜尋預設只有 icon，需要時才展開。

加「最近使用」最多 6 個。

點素材後必須：

1. Sheet 立即收起
2. 進 Placement Mode
3. Ghost 移到手指上方 48–72px，不能被手指遮住
4. 顯示 compact placement toolbar
5. Canvas 恢復最大高度

---

# 4. Selection / Inspector

## 點選後只顯示 Context Bar

不要自動開 Inspector。

Context Bar：

- 精調
- 旋轉
- 複製
- 屬性
- 更多

刪除、解除群組、解除桌面關聯等危險操作放 More。

## Mobile Properties Sheet

只有點「屬性」才打開。

不能直接重用 Desktop Inspector 全量表單，需要 mobile-specific composition。

Zone 第一層：名稱、寬/深、精調入口。

Door 第一層：門寬 preset、鉸鏈、內外開、角度。

Mat Array 第一層：rows × cols、X/Z gap、總占用、編號摘要。

Computer 第一層：所屬桌面、重新吸附。

raw X/Z、elevation、surface、metadata 放進「進階」。

---

# 5. 精準移動重構

現在大 D-pad 長駐 Inspector 必須移除。

點「精調」才打開 mini-sheet。

上列：

`1cm | 5cm | 半格 | 一格`

下方使用 compact 3×3 D-pad / circular pad，總高度控制在約 160–200px。

長按方向可連續 nudge，但一次長按應合併成單一 Undo transaction。

直接拖曳仍是主操作，精調只做 secondary tool。

---

# 6. Placement Mobile UX

Placement toolbar 只留：

- 旋轉 / 換向
- 連續放置狀態
- 完成

尺寸與 Snap 放 secondary settings。

Ghost 要 finger offset。

靠近 Canvas 邊緣時可有限度 auto-pan，速度需有上限。

重要 action 優先放螢幕下半部，支援單手。

---

# 7. Gesture State Machine

手機必須建立明確 pointer/touch state machine：

- idle
- tapCandidate
- objectDrag
- canvasPan
- orbitRotate
- pinchZoom
- placement
- sheetInteraction
- measure

規則：

- 第一指先是 tapCandidate
- 超過 touch threshold 才轉 objectDrag/canvasPan
- 第二指加入立即取消 object drag candidate，轉 pinch/two-finger gesture
- pinch / two-finger pan 期間任何 SceneObject 不得移動
- gesture 結束不得觸發 accidental tap/place
- Sheet pointer ownership 與 Canvas ownership 必須分開

---

# 8. Small Object Picking

門、開關、投影幕等薄型牆面素材，手機觸控命中區需要 invisible pick proxy。

目標至少接近 44 CSS px 可點區域。

Proxy：

- 不改模型真實尺寸
- 不進 export
- 不進 collision/validation
- 只參與 picking

選取後顯示明確 selection halo/outline。

---

# 9. Validation Mobile UX

檢查頁第一層只顯示：

- Error count
- Warning count
- Info count
- 前 3–5 個最重要問題

點 issue：

1. Sheet 收到 collapsed
2. Camera focus
3. 高亮相關項目
4. 顯示 mini issue card

不能讓完整問題清單繼續蓋住目標。

---

# 10. Measure Mobile UX

進 Measure 後 Sheet 收起。

Canvas 上點 A/B，結果用 floating chip 顯示。

底部 mini toolbar：

- 保留
- 重量（重新量）
- 清除
- 完成

量測過程禁止打開大型表單。

---

# 11. Android / Dynamic Viewport

必須針對實機 Chrome：

- 使用 `100dvh` 或 visualViewport，不依賴固定 100vh
- 地址列伸縮時 Bottom Nav 不亂跳
- 軟鍵盤不能遮住表單
- safe-area inset
- orientation change
- visualViewport / ResizeObserver listener throttle

---

# 12. Responsive Strategy

至少區分：

- compact phone <= 480px
- phone / portrait small tablet 481–820px
- tablet / desktop > 820px

1024×768 橫向平板可使用 desktop-style workspace。

不要只靠 user-agent；可搭配 viewport + pointer/hover capability。

---

# 13. Performance

手機 pointermove / drag 時：

- 不 rebuild Library
- 不 rebuild full Inspector
- 不全量重跑 Validation
- placement ghost 做 incremental update
- Sheet layout observer 要 throttle

---

# 14. Acceptance Matrix

至少驗收：

- 360×800
- 390×844
- 412×915
- 480×960
- 768×1024 portrait
- 1024×768 landscape

必須通過：

1. 開站就看到大面積 Canvas，不是多排工具列。
2. Header 永遠單列。
3. 一 tap 素材開 Sheet。
4. 兩 taps 內選到地墊並回 Canvas Placement。
5. Ghost 不被手指遮住。
6. 雙指縮放不移動地墊。
7. 點選物件不自動開巨大 Inspector。
8. 點「屬性」才開 Sheet。
9. 屬性修改後能單手快速收回 Canvas。
10. 精調面板不超過半屏。
11. 小型開關/門可靠點選。
12. Sheet 可 collapsed/half/full。
13. Validation focus 不被 Sheet 遮住。
14. Measure 時 Canvas 保持大部分可見。
15. Android Chrome 地址列伸縮不破版。
16. Android back：先關 Sheet → 再取消模式 → 最後瀏覽器返回。
17. 螢幕旋轉不遺失專案與 selection 狀態。
18. 手機完整跑通：場地 → 素材 → 地墊/椅子 → 動線 → 檢查 → 匯出。

---

# Non-goals

- 不新增素材種類
- 不加 AI
- 不加後端/登入/雲端
- 不重做 Desktop 三欄工作台
- 不追求 CAD 工具密度

---

# Definition of Done

以下任一存在即 Fail：

- Header 的視角按鈕仍佔兩排以上
- 名稱/置中/Snap 長駐手機首屏
- 選取後 Inspector 自動覆蓋半屏以上
- 素材庫只能靠長距離捲動找素材
- Canvas 在主要狀態低於約一半畫面
- D-pad 長駐 Inspector
- 雙指縮放會誤拖物件
- Ghost 被手指遮住
- Validation focus 被 Sheet 蓋住

最終標準：**手機不是 Desktop 縮小版，而是 Canvas-first、context-first、one-hand-friendly 的現場場佈工具。**