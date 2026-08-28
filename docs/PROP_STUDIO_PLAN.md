# Prop Studio — 實作計畫

3D 道具創作 × 互動物件 × 活動彩排。在 PR #19 上繼續，不開新 PR、不 merge、
不建第二套 3D engine、不變成 Blender。

## 怎麼來的

六個平行審計走過 §2 點名的每一個系統（catalog、scene 渲染、placement/model、
模擬綁定、UI 模式、GLB/agent/export），逐一以 file:line 驗證，其中的關鍵主張
（migration 白名單會丟欄位、top-level 未知 key 會存活）是**跑過程式碼**驗出來
的，不是讀出來的。這份計畫的每一個接縫都指向審計確認存在的程式碼。

## 一句話架構

**一個道具是一筆帶三個選填 payload 的定義——parts（3D）、anchors（站位）、
interaction（一個站台＋步驟片段）——而一個擺出去的道具就是一個普通的
`SceneObject`。** 沒有新的 instance 型別、沒有新引擎、沒有第二套 scene system。

## 核心決定（與理由）

### 1. Definition 存在 `Project.props`，不塞 catalogExtras

`migrateCatalogExtra` 是白名單重建（`migrate.ts:456-489`）：未知欄位在**下一次
載入就蒸發**，舊版 build 開檔重存也會剝掉（runtime 驗證過）。而 top-level 的
未知 key 經 `{...base, ...input}` spread 存活（同樣 runtime 驗證）。所以：

- `Project.props?: PropDefinition[]` — 新的選填 block，`PROJECT_VERSION` 不動，
  防禦式 migration，完全比照 `Project.interaction` 的前例。
- 每個 definition 同時產一筆**普通的** catalogExtras entry
  （`custom:prop_<uid>`、kind 收進原本八種、`visualRef: "prop:<id>"`）。
  舊版 build 看到的是一個可放置、可驗證、可匯出的灰盒素材——**優雅降級，
  不是壞檔**。這正是 booth catalog 已經在用的手法。

### 2. Instance = SceneObject，一個欄位都不加

x/z/rotationDeg/自訂尺寸/hidden 都已存在；`migrateObject` 也是白名單
（`migrate.ts:83-137`），加欄位就會被剝掉。識別完全靠 `assetId` 間接。

### 3. Assembly = 一個 definition、很多 parts

「骰子遊戲站」＝一個 definition，parts 是桌＋骰＋題目板＋立牌。整組移動＝
移動那一個 SceneObject；**anchors 跟著走是構造上的必然，不是要維護的性質**
（§16 免費）。「把既有道具組進來」＝把它的 parts 複製進新 definition。
不建立 scene-graph parent/child 系統——§88 的審查重點就是不要第二套 scene。

### 4. 模擬綁定 = 既有的 objectId 綁定

放置互動道具 → 在 `project.interaction` 插入一個 `objectId` 綁定的
`InteractionStation`（＋anchorId）＋步驟片段＋角色。`resolveTemplateBindings`
每次 run 前重算位置（`migrate.ts:426-441`）——**移動道具 → 模擬結果跟著變
（§94）就是既有機制**，只差 anchor 的旋轉 offset。複製道具＝第二個
SceneObject＝第二個站台；`staffRoleId` 共用時 `allocateStaff` 本來就不會
讓一個人同時服務兩站（§55 免費）。

骰子每一面的 圖片/名稱/題目/平均時間/下一步 = `InteractionOption` 的
label/prompt/extraSeconds/next——**flowPanel 已經在編輯這些**（§24 免費）。
引擎 `runInteraction` 零修改（§87）。

### 5. 視覺 = `prop:` visualRef ＋ 資料驅動的 part 編譯器

`resolveVisualGroup` 的 visualRef 前綴 dispatch 是既定擴充縫
（`visualRegistry.ts:70-105`）。新的 `buildPropGroup(def)`：
box/cylinder/sphere/plane 四種 primitive、`materialFromPreset` 的 11 個材質
preset 直接當外觀選單、文字走 CanvasTexture（label.ts 先例）、圖片從 IDB blob
非同步升級（同步先出顏色）。以 `prop:<id>@v<version>` 快取，**有淘汰**
（現有四個快取都不淘汰，但它們的 key 不可變；可編輯的 definition 不同）。

### 6. 誠實條款

- 圖片→3D 仍然沒有真的 provider：圖片只做 billboard/decal/貼面（§41 明說可以）。
- AI 幫我做 = agent 輸出 PropDefinition recipe → 既有的 draft→預覽→套用/取消
  →單筆 undoable commit 迴路（`quickAgent.ts:193-247`）。不產不可編輯黑盒。
- 秒數與人流一律標估計，照互動流程輪的規矩。

## 順路修掉的兩個既有 bug（審計抓到，與 Prop Studio 無關也該修）

1. **物件綁定的站台存一次檔就凍死**：`migrateInteractionStation` 把
   `objectId`/`zoneId` 剝掉（`migrate.ts:320-340`），所以綁定站台 reload 之後
   永遠停在存檔那一刻的座標，搬桌子模擬不再跟著。Anchors 依賴這條路，先修。
2. **GLB 視覺 reload 就變灰盒**：blob 只寫不讀（`getBlob` 零呼叫者）、
   `cacheGlbGroup` 只在匯入當下發生，重新整理後 `glb:` visualRef 永遠退回
   proxy box。補 rehydration pass（開專案掃 visualRef → getBlob → parse →
   cache）。§40 的 GLB 升級路建立在它之上。

## 不做的（§1、§99）

Vertex/UV/rig/shader graph/node editor 不出現在一般 UI；不做物理引擎、
動畫時間軸、骨架、scripting IDE、多人、VR/AR、marketplace；不做 50 種
primitive；LOD 不暴露 UI。

---

## 實作順序（每步獨立全綠；gate = lint + typecheck + test + build ＋
`eventFlowParity` / `boothMigrate` / `interactionMigrate` 三組守門員零改動）

**Step 0 — 兩個既有 bug 先修**（station objectId 白名單＋測試；GLB/blob
rehydration＋測試）。與新功能無關，先落地免得新東西蓋在壞地基上。

**Step 1 — Prop 模型與持久化**：`PropPart` / `PropAnchor` / `PropDefinition` /
`Project.props`；`migrateProps` 防禦式修復（壞一筆丟一筆，不炸整個專案 §77）；
`planHasContent` 補項（不補，「取代專案」會把道具當空白蓋掉）；
definition → catalogExtras entry 產生器。

**Step 2 — parts → 3D ＋ rehydration**：`scene/propVisual.ts` 編譯器（四種
primitive、材質 preset、文字、圖片）；`prop:` dispatch；版本化快取＋淘汰；
SceneManager rebuild 簽章納入 entry version（不納入，改定義不重繪）；
mesh 預算 ≤ 24（`adaptGeneratedFactory` 把 materialCount 算成 mesh 數，
超過直接 fail mobile）。

**Step 3 — 內建道具（純資料）**：`core/propPresets.ts` — 骰子、轉盤、立牌、
箱子、桌子、按鈕、互動螢幕、抽卡箱、拍照框、領取台；四個 golden assembly：
祝福箱（§65）、城市微光骰子站（§66）、快問快答台（§67）、轉盤遊戲站（§68）。
互動的每一個都帶 player/staff/queue/exit anchors 與 interaction 片段。

**Step 4 — 模擬綁定**：`instantiatePropInteraction` / `removePropInteraction`
（插入／清除站台＋步驟＋角色，id 重映射，清 dangling staffRoleId）；
`resolveStationPosition` 加旋轉 anchor offset；station 選填 `anchorId` 與
`queueDirectionDeg`（只在存在時讀——parity 安全）；放置／刪除／複製的 App
生命週期；§63 驗證（anchor 在牆內、clearance 不足、兩個互動站太近 §18）。

**Step 5 — Prop Studio UI**：`ui/propStudio.ts` 建造流程（類型→尺寸→外觀→
互動→儲存，§6-10）；「加零件」；anchor 編輯（設定互動模式才顯示 P/S/Q/→，
§15）；`state/propLibrary.ts`（照 templateLibrary 的形狀）；素材庫「我的道具」
分類；改這一個 vs 更新模板（§71）；手機 sheet 流程（§73）。

**Step 6 — 彩排、場刊、夥伴**：playback 選填的 per-frame 站台結果（教室無
分岔時不輸出→parity 安全）；骰子服務中旋轉、結果顯示（§25-26）；
`planSymbolForEntry` 開始讀 `planSymbolRef`（現在到處寫、沒人讀），
`plan:prop:<id>` 從 parts 畫俯視 footprint（§83-84）；夥伴模式 anchor 句子
（§85）。

**Step 7 — GLB 升級、AI recipe、匯入匯出**：GLB entry 掛 anchors＋interaction
（visual 留 glb:）；agent 新 intent＋tool＋executor case（`summarize()` 要擴，
否則 recipe commit 在預覽表裡隱形）；`.planform-prop.json` schema 驗證。

**Step 8 — Golden E2E、效能、審查**：§94/§95 兩條 e2e；50/100 props 效能
smoke；三輪審查（架構/UX/視覺——本機沒有已登入的 Claude CLI，由當前
session 以全新無脈絡 subagent 執行並如實標註 Claude-run，不冒充 CLI 輸出）；
Grok 盲測 ×3（§91-93，grok CLI 實測可用）；PR body（§104）；
tag `PLANFORM_PROP_STUDIO_READY`，**不 merge**（§105）。

## 風險清單（誠實版）

| 風險 | 處置 |
|---|---|
| 教室 parity fixture 被任何引擎改動波及 | 所有新輸出一律條件式（無 prop 內容→undefined），照 steps/staffLoad/funnel 前例；每步跑 parity |
| 舊版 build 開新檔 | definition 降級為灰盒素材（kind 在八種內）；`Project.props` 被舊版剝掉時，catalogExtras entry 與 SceneObject 仍在——場佈不壞，只失去互動 |
| 手機效能 | 一個 prop＝一個 Group；快取＋淘汰；mesh ≤24；圖片自寫 ≤1024px 降尺度（optimizeGltf 的 texture 步驟是 no-op） |
| 材質快取污染 | 貼圖材質以 blobId 入 key 或繞過共享快取；CanvasTexture 自行 dispose |
| 刪道具留下殭屍站台 | `removePropInteraction` 清 station＋steps＋role 指標；測試釘住 |
| 50 種道具的誘惑 | 內建 10＋4 個 golden；其餘靠自訂 |

## 進度

| Step | 狀態 | 備註 |
|---|---|---|
| 0. 既有 bug（station objectId／GLB rehydration） | ✅ | 9 條測試，4 個變異被擋下 |
| 1. 模型與持久化 | ⬜ | |
| 2. parts → 3D | ⬜ | |
| 3. 內建道具 | ⬜ | |
| 4. 模擬綁定 | ⬜ | |
| 5. Prop Studio UI | ⬜ | |
| 6. 彩排／場刊／夥伴 | ⬜ | |
| 7. GLB／AI／匯入匯出 | ⬜ | |
| 8. E2E／效能／審查／tag | ⬜ | |
