# 三段 Responsive Workspace + WorkspaceViewport / CanvasSafeRect

本文件說明 P0 Tablet + Mobile Workspace UX Rewrite 的架構。

## 問題

改版前只有一個 `max-width: 820px` 的 mobile breakpoint。結果 900–1100px 的
Android 平板被當成 Desktop：同時出現 300px Left Sidebar + 320px Right
Inspector + 會折成兩三排的 Topbar，Canvas 被壓成中間很窄的一條。

更根本的問題是：相機 fit / recenter / focus 都假設「整個 window 就是可見
Canvas」。即使版面修好，聚焦到的物件仍可能落在 Header 或 Bottom Sheet 底下。

## 三種 Workspace Mode

規則寫在 `src/core/viewport.ts`（純函式、可單元測試）：

| Mode | 寬度 | 版面 |
| --- | --- | --- |
| `phone` | ≤ 600px | Canvas-first + Bottom Nav + Bottom Sheet |
| `tablet` | 601–1199px | Canvas-first + 單列 Header + Bottom Nav + contextual Sheet / Selection Context Bar |
| `desktop` | ≥ 1200px | Left Panel + Canvas + Right Inspector |

`dockingPolicy(mode)` 是唯一的真相來源：

- `phone` / `tablet`：`dockLeft = false`、`dockRight = false` —— 平板永遠不會
  同時（或單獨）常駐左右 Sidebar；`singleRowHeader = true`；
  `autoOpenInspector = false`（選取不會自動打開完整 Inspector）。
- `desktop`：兩側 rail 都可常駐，Bottom Nav 消失。

Mode 由 `WorkspaceViewport` 量測後寫進 `#app[data-ws-mode]`，CSS 依此切換
**真正不同的版面**（docked rail ↔ bottom sheet），不是只用 `display: none`
把 Desktop 版面藏一部分。

## WorkspaceViewport / CanvasSafeRect

`#scene` 這張 canvas 永遠鋪滿整個 window，所有 chrome 都浮在它上面。因此
「使用者真正看得到的 canvas」是 canvas 的一個子矩形。`WorkspaceViewport`
（`src/ui/workspaceViewport.ts`）量測真實 DOM，導出三個矩形：

| 矩形 | 內容 | 用途 |
| --- | --- | --- |
| `baseRect` | canvas − 常駐 chrome（Header / Bottom Nav / docked rail） | Canvas 佔比（Definition of Done 的 70% 由此計算） |
| `safeRect` | `baseRect` − 已展開的 Bottom Sheet | 相機投影錨點（真正可見 Canvas rect） |
| `focusRect` | `safeRect` − 暫時性 Bar（Context / Placement / Measure / AI） | focus、fit、ghost 夾限的目標 |

分成三層是刻意的：Sheet 會真的遮住畫布，所以相機要重新錨定；但 Context Bar
這種一秒出現一秒消失的小 bar 不該讓相機跳動。

量測來源：`ResizeObserver` + `resize` / `orientationchange` /
`visualViewport` + sheet 的 `transitionstart` / `transitionend`（滑動不會改變
任何元素尺寸，`ResizeObserver` 不會觸發）。結果同時發佈成 CSS 變數
（`--ws-header-h`、`--ws-nav-h`、`--ws-safe-*`），讓 sheet 與 bar 依真實數字
定位。

## 相機以可見矩形為基準

`SceneManager` 不再假設 canvas 中心就是畫面中心：

- `applyProjection()` 建立**不對稱**的正交視錐，讓 NDC 原點落在 `safeRect`
  的中心而不是 canvas 中心。OrbitControls 只讀 `right - left` /
  `top - bottom`，所以 pan / pinch-zoom 仍然正確，且縮放中心就是可見區中心。
- 世界比例存成 `worldPerPx`，與任何矩形脫鉤。chrome 出現或消失只會重新錨定，
  永遠不會偷偷把平面圖縮放掉。
- `fitBounds()` 把內容的 8 個角投影到相機自己的座標軸上量測範圍，因此等角視角
  也能貼合 `focusRect`，不是用近似係數。
- `focusOn()`（Validation focus）、`focusObject()`、`focusSimulation()`、
  `setRouteFocus()` 全部把目標放到 `focusRect` 中心。
- `clampClientToVisible()` 讓觸控的 ghost finger offset 不會把預覽推到 Header
  底下或 Bottom Sheet 後面。
- 只有 **canvas 本身**改變（旋轉、視窗縮放、breakpoint）而使用者還沒動過相機時
  才會自動重新 fit；使用者一旦 pan/zoom（OrbitControls `start` 事件）就不再
  自動接管。

Pointer normalization 仍以 canvas rect 換算 NDC —— 這是正確的，因為 canvas
就是投影面；可見區的偏移已經包含在不對稱視錐裡，所以 raycast、`project()` 與
畫面完全一致。

## Compact 版面契約

- **Header 單列**：專案名稱 / Undo / Redo / compact View / AI / More。
  `flex-wrap: nowrap` + `overflow: hidden`，只有專案名稱會縮。
- **五種 View** 收進 compact View 選單，不常駐 Header。
- **名稱 / 置中 / 吸附 / 簡化 / 量測 / 校正 / 團隊檢視 / 重新命名** 收進 More sheet。
- **Bottom Nav**：場地 / 場佈 / 動線 / 檢查 / 分享。再點同一個分頁即收合回完整 Canvas。
- **Selection Context Bar**：名稱 / 尺寸 / 旋轉 / 複製 / 屬性。點「屬性」才開
  Inspector Sheet；此時再點任一 workflow 分頁或把 sheet 往下拖即可收合。
- **場地面板第一層**：教室尺寸 / 地磚 / 現場校正 / 固定設施。
  X / Z / 地磚原點 / 地磚旋轉 / 掃描場地收進「進階設定」。
- **素材庫**：category tab + compact grid，每個 category 自己捲動
  （compact 上限 30dvh），不會變成超長素材頁。選素材後自動收起 sheet 並進入
  placement。

Gesture arbitration（雙指即相機手勢、單指才拖物件）、ghost finger offset 與
pick 流程都維持原樣，只是加上可見矩形夾限。

## 驗收

- `test/viewport.test.ts`：breakpoint、docking policy、insets、safe rect、NDC
  錨點、10 個驗收 viewport 的 70% Canvas 佔比。
- `e2e/workspace.spec.ts`（Playwright，`npm run test:e2e`）：在真實瀏覽器逐一
  跑 360×800 / 390×844 / 412×915 / 600×960 / 768×1024 / 800×1280 / 962×1280 /
  1024×768 / 1180×820 / 1366×1024，檢查 mode、單列 Header、不得雙 rail、
  Canvas 佔比，以及
  場地 → 選素材 → 放置 → 選取 → Context Bar → 屬性 → 收合 的完整流程與相機錨定。

CI 之外的機器若沒有 Playwright 自帶瀏覽器，可用
`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chromium npm run test:e2e`。
