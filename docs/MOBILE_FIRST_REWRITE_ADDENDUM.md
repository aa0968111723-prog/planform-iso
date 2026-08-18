# Planform ISO — Mobile-first Workspace Rewrite Addendum

> 本文件是 PR #6 `FIELD_PRECISION_MOBILE_VALIDATION_PLAN.md` 的 **P0 補充契約**。若原規格與本文件在手機 UX 上衝突，以本文件為準。

## 為什麼需要重做手機工作區

實機畫面已證明目前手機版雖然有 Bottom Nav / Bottom Sheet，但仍保留太多桌面工具列與完整 Inspector 表單，造成：

- 真正 Canvas 幾乎沒有可用高度
- Topbar 佔用 3–4 排控制
- Bottom Sheet 展開時覆蓋大部分場景
- 選取物件後 Inspector 幾乎變成整頁表單
- 精準移動方向鍵佔據大量空間
- 素材庫卡片過大，一次只能看到少量素材
- 使用者必須在「畫布 / 素材 / Inspector / 工具列」之間頻繁切換
- 視角、吸附、名稱、置中等桌面級控制長駐手機首屏

這不是 CSS 尺寸問題，而是手機資訊架構錯誤。

---

# P0 目標

手機寬度（<= 820px）下，預設狀態必須是：

1. **Canvas 是主角，至少佔可用畫面 70% 左右**
2. 頂部只有一列 Compact Header
3. 底部只有固定主導航
4. 素材、Inspector、設定都採用可收合 Sheet / Popover
5. 任何 Sheet 打開後都可以快速收回畫布
6. 選取物件不自動打開大型 Inspector
7. 常用操作 1–2 taps 完成
8. 進階精準參數不佔第一層畫面

Desktop / Tablet（足夠寬度）維持既有工作台，不要被手機重構破壞。

---

# 1. Mobile App Shell

## 1.1 Compact Header

手機頂部改成單列，高度約 48–56px（含 safe-area 另計）。

第一層只顯示：

- 專案名稱（可省略或截斷）
- Undo
- Redo
- View（單一入口）
- More

禁止在手機第一層常駐：

- 五個視角按鈕
- 名稱 toggle
- 置中
- Snap select
- Workflow tabs
- Layers
- Calibration controls

這些全部進二級 UI。

## 1.2 Bottom Navigation

保留 5 個入口，但語意固定：

- 場地
- 素材
- 動線
- 檢查
- 更多

Bottom Nav 只切工作流 / 開 Sheet，不承擔 Inspector。

再次點目前 active tab：收起 Sheet，回到純 Canvas。

## 1.3 Canvas-first state

App 啟動、Sheet 關閉、完成放置、完成屬性修改後，都應回到 Canvas-first。

Canvas 在沒有 Sheet 時必須使用 header 與 bottom nav 中間的完整可視區。

---

# 2. View / Snap / Display Settings

## 2.1 View Picker

手機不要顯示五顆視角按鈕。

Header 的 View 按鈕打開 compact popover / bottom mini-sheet：

- 等角
- 俯視
- 正視
- 左視
- 右視

選完立即關閉。

## 2.2 Snap Picker

Snap 不常駐 Header。

放到：

`更多 > 吸附`

或 Placement / Move context toolbar 的次級入口。

至少支援：

- 自由
- 交點
- 邊線
- 中心
- 半格

顯示目前狀態即可，不佔大量首屏空間。

## 2.3 Display settings

名稱、格線、區域、動線顯示等集中到：

`更多 > 顯示`

不要散落在主工具列。

---

# 3. Mobile Sheet Architecture

## 3.1 Three detents

Sheet 至少支援三段高度：

- collapsed：只露 handle / title（約 56–72px）
- half：大約 40–45vh
- full：大約 80–85vh

不要只有「完全關閉 / 62vh」兩種狀態。

## 3.2 Drag handle

Sheet 頂部有明確 drag handle。

支援：

- 向下 swipe 收合
- 點遮罩 / Canvas 收合（不與 placement 衝突）
- Android back 優先收 Sheet，而不是直接離開頁面

## 3.3 Sheet content owns scroll

只有 Sheet 內容捲動，不讓整頁與 Canvas 互搶 scroll。

## 3.4 Focus avoidance

Sheet 開啟後，SceneManager 的可視 viewport / focus safe rect 必須更新。

任何：

- focusOn
- validation 定位
- zoom-to-selection
- placement follow

都不得把目標放到 Sheet 後面。

---

# 4. 素材庫 Mobile Redesign

## 4.1 不要直接顯示所有分類長列表

手機素材庫第一層先顯示 Category chips / tabs：

- 區域
- 固定設施
- 家具
- 設備
- 地面用品
- 排列

一次只渲染目前分類。

## 4.2 Compact cards

目前卡片太高。手機卡片改成 compact asset cell：

- icon / 小預覽
- 名稱
- 尺寸（小字）

可用 3 columns（足夠寬時）或 2 columns compact grid。

不要每張卡片都重複「地面 / 牆面 / 桌面」長文字；改成小 badge / icon。

## 4.3 Search

搜尋框預設收合成搜尋 icon。

點擊才展開，避免永久佔高度。

## 4.4 Recent / Favorites

第一層加入「最近使用」區（例如最多 6 個），讓現場不必每次捲分類。

Favorites 可延後，但 Recent 應在本階段完成。

## 4.5 Selecting an asset

點素材後：

1. Sheet 立即收合
2. 進入 Placement Mode
3. Ghost 出現在手指上方 offset
4. 底部顯示輕量 placement toolbar
5. Canvas 保持最大可見範圍

---

# 5. Selection UX：禁止自動整頁 Inspector

## 5.1 Selection Context Bar

點選物件後，先只顯示 bottom context bar：

- 移動 / 精調
- 旋轉
- 複製
- 屬性
- 更多

不要立即把 Inspector 拉到 60% 高度。

## 5.2 Properties Sheet

只有點「屬性」才開 Inspector Sheet。

第一層只顯示最常用：

- 名稱 / 類型
- 常用尺寸 preset
- 尺寸
- 旋轉（若適用）
- 重要現場資訊

進階資料放在「進階」折疊。

## 5.3 Danger actions

刪除、解除群組、解除桌面關聯等危險操作放在：

`更多`

必要時二次確認。

不要像目前一樣在 Inspector 頂部常駐大顆「刪除」。

---

# 6. 精準移動 Mobile Redesign

目前四方向大按鈕佔據太多垂直空間，必須重做。

## 6.1 Nudge Sheet

點「精調」打開 compact mini-sheet：

上列：

`1cm | 5cm | 半格 | 一格`

下方方向鍵改成一個緊湊 3×3 D-pad 或四向 circular pad，整體高度不得超過約 160–200px。

## 6.2 Repeated press

長按方向鍵可連續 nudge，但需節流並可 Undo 成一個 transaction。

## 6.3 Direct drag remains primary

精調是 secondary tool，不能永久占 Inspector。

---

# 7. 手機 Placement Mode

## 7.1 Ghost finger offset

Ghost 預設在 touch point 上方約 48–72px（依視角做世界座標映射），讓手指不遮住物件。

## 7.2 Placement toolbar

只保留：

- 旋轉 / 換向
- 放下一個 / 連續模式狀態
- 完成

吸附模式與尺寸放入次級 More。

## 7.3 One-hand usage

重要按鈕優先位於螢幕下半部，避免常要求點擊頂端。

## 7.4 Auto-pan near edge

拖 / 放置 ghost 靠近 Canvas 邊緣時可有限度 auto-pan，避免必須先退出 placement 再移畫面。

需設速度上限避免失控。

---

# 8. Gesture State Machine（P0）

不能再只靠簡單 pointerdown/move。

至少有狀態：

- idle
- tapCandidate
- objectDrag
- canvasPan
- orbitRotate
- pinchZoom
- placement
- sheetInteraction
- measure

## 8.1 Rules

- 第一指 down 後先保持 tapCandidate
- 超過 touch threshold 才轉 drag
- 第二指加入後立即取消 objectDrag 候選，轉 gesture
- pinch / two-finger pan 期間 SceneObject 不得變動
- gesture 結束後不可觸發 accidental tap/place

## 8.2 Pointer capture

對 object drag / nudge / sheet gesture 正確使用 pointer capture 或明確 ownership。

## 8.3 Scroll vs scene

Sheet 內手勢不能傳到 SceneManager。

Canvas 手勢不能讓 body scroll。

---

# 9. Small Object Picking

門、投影幕、開關等牆面薄素材在手機很難點。

新增 invisible pick proxy：

- 至少 44 CSS px 等效 hit target（依投影估算）
- 不改真實模型尺寸
- proxy 僅參與 picking，不參與 validation/export

選中後可顯示 temporary selection halo / outline。

---

# 10. Mobile Inspector Content Density

禁止把 Desktop Inspector 原封不動放手機。

手機 Inspector 要有自己的 renderer / composition。

## Zone

第一層：

- 名稱
- 尺寸
- 快速精調入口

不要第一屏就顯示完整 D-pad。

## Door

第一層：

- 門寬 preset
- 左 / 右鉸鏈
- 內 / 外開
- 開啟角度 quick options

## Mat Array

第一層：

- rows × cols
- 水平 / 垂直間距
- 整體占用
- 編號摘要

## Computer

第一層：

- 所屬桌面
- 重新吸附 / 解除（放 More）

所有 raw X/Z/elevation / surface / metadata 放「進階」。

---

# 11. Mobile Validation UX

檢查頁第一層顯示：

- 錯誤數
- 警告數
- 建議數
- 最重要前 3–5 項

點問題：

1. Sheet 收至 collapsed
2. Camera focus 到問題
3. 高亮相關物件
4. 顯示 mini issue card

不要一邊定位一邊讓完整問題清單蓋住場景。

---

# 12. Mobile Measure UX

量測時 Canvas 必須保持可見。

流程：

- 進入 Measure
- Sheet 收合
- 點 A
- 點 B
- 結果以 floating chip 顯示
- 底部 mini toolbar：保留 / 重量 / 清除 / 完成

不要在量測過程開大型表單。

---

# 13. Keyboard / Browser Chrome / Safe Area

實機 Chrome / Android 必須處理：

- `100dvh` / visualViewport，不依賴固定 `100vh`
- 地址列出現 / 隱藏時不要讓 Bottom Nav 跳動
- 軟鍵盤出現時 Sheet 不得被遮住
- `env(safe-area-inset-*)`
- orientation change

使用 `window.visualViewport` 時要避免過度 layout thrash。

---

# 14. Responsive Breakpoints

不要只有單一 `max-width: 820px`。

至少概念上區分：

- compact phone: <= 480px
- phone / small tablet portrait: 481–820px
- tablet / desktop: > 820px

平板橫向可保留 desktop-style workspace；手機直向才用完整 mobile shell。

判斷可搭配 width + pointer/hover capability，而不是只看 user-agent。

---

# 15. Performance

手機 Sheet / UI 不得每次 pointermove rebuild 大片 DOM。

要求：

- Placement ghost move 不 rebuild Library/Inspector
- Selection drag 不 rebuild full side panels
- expensive validation debounce
- 量測 overlay 增量更新
- ResizeObserver / visualViewport listener throttle

---

# 16. Accessibility / Touch

- 最小 touch target 44×44 CSS px
- active / selected 狀態除了顏色，也有形狀 / icon / aria
- Sheet focus trap 僅在 full modal-like 狀態需要，half sheet 不應鎖死 Canvas
- `aria-expanded` / `aria-selected` / label 正確
- Android back 行為可預測

---

# 17. Acceptance Tests（必須實機尺寸驗收）

至少測以下 viewport：

- 360×800
- 390×844
- 412×915
- 480×960
- 768×1024 portrait
- 1024×768 landscape（應接近 tablet/desktop）

必須跑通：

1. 開站時 Canvas 清楚可見，不是工具列佔滿
2. 一次 tap「素材」即可開素材 Sheet
3. 兩次 tap 內可選到地墊並回到 Canvas placement
4. 放置地墊時手指不遮 ghost
5. 兩指縮放不會移動地墊
6. 拖動地墊後 Undo 可立即取得
7. 點選地墊不會自動開巨大 Inspector
8. 點「屬性」才開 Sheet
9. 修改尺寸後可單手關 Sheet 回 Canvas
10. 小型開關可可靠點選
11. 精調面板不超過半屏
12. 素材 Sheet 可拖曳 collapsed/half/full
13. 點 Validation issue 後場景目標不被 Sheet 遮住
14. Measure A/B 點擊時 Canvas 至少保留大部分高度
15. Chrome 地址列伸縮不造成 Bottom Nav 亂跳
16. Android back 先關 Sheet，再取消模式，再交給瀏覽器
17. 旋轉螢幕不遺失選取 / placement state
18. 手機完成：場地 → 素材 → 地墊陣列 → 動線 → 檢查 → 匯出

---

# 18. Non-goals

本手機重構仍然：

- 不新增新素材種類
- 不加 AI
- 不加後端 / 登入 / 雲端
- 不改 Desktop 已可用的三欄工作台核心
- 不追求 CAD 級工具密度

---

# Definition of Done

如果手機畫面仍然出現以下任一情況，即視為未完成：

- 頂部視角按鈕仍佔兩排以上
- 選取物件後 Inspector 自動覆蓋超過半個畫面
- 素材庫只能靠超長頁面捲動找素材
- Canvas 在主要工作狀態下低於約一半畫面
- 雙指縮放會誤拖物件
- Ghost 被手指遮住
- 點 Validation issue 後目標被 Sheet 蓋住
- 精準移動 D-pad 長駐 Inspector

最終標準：**手機不是桌面版縮小，而是 Canvas-first、context-first、one-hand-friendly 的現場場佈工具。**