# Prop Studio — 實作計畫（v2，經三方對抗審查修訂）

3D 道具創作 × 互動物件 × 活動彩排。在 PR #19 上繼續，不開新 PR、不 merge、
不建第二套 3D engine、不變成 Blender。

## 怎麼來的

1. 六個平行審計走過 §2 點名的每一個系統，關鍵主張（migration 白名單丟欄位、
   top-level 未知 key 存活）是 **runtime 驗出來**的。
2. v1 計畫交給三個對抗審查（架構／UX／誠實），三方都判 SOUND_WITH_FIXES，
   抓到五個真的設計洞。這一版把每一個都變成明確決定。審查也抓到 v1 引用了
   一個錯的行號區間（quickAgent.ts 108 行，不是 193-247）——教訓收下：
   **這份文件裡的每個 file:line 都要在動工當下重驗，不要信文件**。

## 一句話架構

**一個道具是一筆帶三個選填 payload 的定義——parts（3D）、anchors（站位）、
interaction（站台＋步驟片段）——擺出去的道具就是普通的 `SceneObject`，
互動就是普通的 `InteractionStation`＋steps。** 沒有新 instance 型別、沒有新引擎、
沒有第二套 scene system。`runInteraction` **數字不動**（playback 可以長新欄位，
它被 parity fixture 排除；「零修改」是 v1 的錯誤說法，已更正）。

## 核心決定

### 1. Definition 存在 `Project.props`，鏡射一筆 catalogExtras entry

理由同 v1（白名單 runtime 驗證）。**鏡射是嚴格單向產生**：每次 definition
編輯都從 definition 重新產 entry 並 bump `entry.version`，絕不手改 entry——
否則名稱／尺寸在兩份持久化之間漂移。一條 guard test 釘住。

舊版 build 圓桌測試（誠實審查實測）：`Project.props` **存活**舊版 round trip
（top-level spread）；真正掉的是站台綁定——舊版的 `migrateInteractionStation`
白名單會剝掉 `objectId`，站台**留在原座標繼續跑**（比消失更糟）。對策：
站台 id 用決定性的 `prop_<objectId>`，新版 migration 加一個 re-bind pass：
`prop_` 開頭且無 objectId 的站台，若同名物件存在就重新綁回。

### 2. Instance = SceneObject；anchors 每站一份、由 definition 播種

station 帶選填 `anchorOffset {x,z}`／`queueDirectionDeg`（**與欄位同一個
commit 進 migration 白名單＋round-trip 測試**——objectId 那個 bug 的同型）。
放置時從 definition 的 anchors 播種到 station 上；之後屬於那一站——兩份同一
定義的複製品可以各自面對不同的牆（§4 的 localOverrides 就是這個）。
`resolveStationPosition` 加「物件中心＋依 rotationDeg 旋轉的 offset」，
**嚴格以欄位存在為閘**：欄位不在→回傳逐位相同的 {x,z}；parity 與這個改動
同一個 commit 跑。

### 3. 流程接線契約（架構審查抓到的洞，這是整案最重要的一段）

`next: undefined` = 下一列，所以「插入片段」沒有接線規則就會做出
**到不了的骰子站**（現有 preset 都以 `next:null` 結尾）或
**每個人都被迫玩**（booth 鏈以 fall-through 結尾）。契約：

- 片段封口：片段最後一步**明寫 `next: null`**；片段內部所有連結**明寫
  重映射後的 id**，絕不依賴列順序。
- 進入點：插入時產一個 ask-step「要不要玩◯◯？」（兩選項 chance，跳過率
  可編輯），並把**當時所有的終點**（明寫 null 的步驟＋最後一列的 fall-through）
  改指 ask；ask 的「玩」指向片段第一步、「路過」指向**插入前那些終點原本
  指向的地方**（= null）。第二個道具插入時同樣改寫（此時終點含前一個片段的
  尾與 skip），得到 booth 式的順序遊訪＋每站跳過率。
- `removePropInteraction`：把指向 ask 的指標改回 ask 的 skip 目標，再刪
  片段步驟＋站台＋角色（無人用時）——**恢復插入前的語意**，不是裸刪列。
- 複製道具（§55）＝完整再插入一次（自己的 ask＋步驟＋站台）；兩站可共用
  `staffRoleId`。**誠實記載**：`allocateStaff` 是靜態分配——一個人顧兩站
  ＝第二站 0 人、停擺並由 staffLoad 點名，這滿足 §55 的字面要求
  （不能同時服務兩人），但不是輪流服務。測試釘住這個語意。

### 4. Bootstrap：放互動道具時專案還沒有流程

- 有 scenarios（教室）：先 `templateFromScenario`（逐位相同，有測試），
  再插入；toast 明說「已展開成步驟列表」。canvas 一放就靜默改變模擬分頁
  的形態——所以**不靜默**，說出來，而且 `discardFlow` 可逆。
- 全新專案：從預設骨架建 template（audience 60 人／60 分鐘 uniform、
  單一 segment、固定 seed），toast announce。

### 5. 骰子面板：一份活資料，絕不兩個編輯器（UX 審查抓到的洞）

v1 說「§24 免費」是**錯的**——flowPanel 只編 label/weight/extraSeconds，
option 沒有圖片/顏色欄位。決定：

- `InteractionOption` 加選填 `color?`／`imageBlobId?`（migrateOption 白名單
  同 commit 跟上）。面的六個屬性（圖/色/名/題/秒/下一步）全部住在 option 上
  ——**一筆記錄**驅動 3D 面、面板、結果顯示、連動。
- **放置之後，`project.interaction` 是唯一活資料**（definition 的片段只是
  種子——booth 前例：booth block 凍結、interaction 勝出）。3D 骰面從綁定
  station 的 chance options 現場取（SceneManager 已拿得到 interaction）。
  Prop Studio 的面表編輯器與 flowPanel 的 chanceRows 編的是**同一份**
  project.interaction；面數 chips 擴到 2/4/6/8/10/12。
- part 加 `facesFromOptions?: boolean`：骰／轉盤 part 的面材質由綁定站台的
  options 導出。

### 6. 零件與 anchor 的定位：數字優先（§73 是硬需求）

- 零件：offset 以 cm 數字輸入＋關係吸附「放在◯◯上面／前面／旁邊」
  （§46-47：Z 永遠不用手打——「上面」自動算高度）。v1 不做 3D 拖零件
  （文件明說），組裝防穿插 = 同軸重疊警告（§48 不做 CAD solid）。
- anchor：方位 chips（前／後／左／右）＋距離 cm；進 station 的
  anchorOffset。canvas 拖 anchor 留給後續（誠實記載）。

### 7. Builder 預覽：一個小型獨立 three 檢視器（§44-45）

`renderToDataURL` 是 2560px 全景匯出，不是預覽迴圈；沒有預覽的六面貼圖
編輯是瞎子摸象（§9 的核心時刻就是「海報貼上去了沒」）。做一個 ~100 行的
檢視器：小 canvas、同一個 `buildPropGroup`、同一套材質、Top/Front/Side/斜角
四顆鈕、編輯即重建、**有 dispose**。它是 viewer，不是第二套 scene system。

### 8. Prop 連動（§31-32，誠實審查抓到被整個漏掉）

最小誠實形：display/screen part 帶 `showsResultOf?: "self" | stationId`
——彩排時顯示該站最新骰出的選項（吃 Step 6 的 per-frame 站台結果，
rendering-only，引擎不動）。「按鈕啟動轉盤」這類**控制**連動 v1 不做，
PR body 明說。

### 9. Interaction Zone（§17）＝ definition 的 `interactionZone?: number`

視覺（設定互動時畫圈）＋驗證（§18 兩站圈圈重疊警告、圈與禁區重疊）。
模擬本來就把人走到站台——zone 不改引擎行為，文件明說。

### 10. §39／§71 的版本語意

專案裡的 definition 就是快照。裝置庫（我的道具）另存。庫更新後專案顯示
「保留目前版本／更新到新版」；「只改這一個」= fork（新 id＋新 entry＋
該 SceneObject 改指），站台綁 objectId 不受影響。

### 11. 誠實條款（含這輪不做的）

- 圖片→3D 沒有 provider：圖片只做貼面/billboard（§41 允許）。
- AI 幫我做 = agent 輸出 recipe → 既有 draft→預覽→套用/取消 迴路
  （quickAgent.ts + transaction.ts + executor.ts，行號動工時重驗）。
  `summarize()` 要擴，否則 recipe 在預覽表隱形。
- **不做（明列，Step 8 審查對照）**：控制型連動（按鈕→轉盤）、§56 道具
  故障開關、canvas 拖 anchor/零件、3D 真字體（文字=貼面）、輪流服務的
  staff 共用。每一項在 PR body 出現。
- 秒數與人流一律標估計。

## 效能契約（Step 2 就定，不是 Step 8 才發現）

- 一個 prop 編譯成**一個 Group**；典型 ≤12 mesh（booth 既有規範），
  硬上限 24（quality gate 的 mobile 天花板）；同材質靜態 parts 合併。
- 快取：`Map<propId, {version, group}>`，寫入時汰舊版——**不是** LRU
  機關（審查判 overbuilt，砍掉）。
- §80 的真實載形是「10 互動道具＋100 人」——e2e smoke 用這個，不只 50/100
  靜態道具。
- §82：手機 quality 降級沿用現有 `quality` 參數通道。

## 實作順序（每步獨立全綠；gate = lint+typecheck+test+build＋
`eventFlowParity`/`boothMigrate`/`interactionMigrate` 零改動）

**Step 0 — ✅ 已完成**（commit `8f0d395`）：station objectId/zoneId/
serviceVariance 白名單＋GLB rehydration＋scene sig 納入 entry.version。

**Step 1 — 模型與持久化**：PropPart/PropAnchor/PropDefinition/`Project.props`；
`InteractionOption.color/imageBlobId`；station `anchorOffset/queueDirectionDeg`
（白名單同 commit）；`migrateProps` 防禦式（壞一筆丟一筆 §77）；
`planHasContent` 補項；definition→entry 單向產生器＋drift guard test；
`prop_<objectId>` re-bind pass。

**Step 2 — parts → 3D ＋ 預覽器**：`scene/propVisual.ts`（box/cylinder/
sphere/plane、材質 preset、文字 CanvasTexture、圖片 blob 貼面、
facesFromOptions、mesh 合併與預算）；`prop:` dispatch **插在 proxy 分支
之前**；id@version 快取；`ui/propPreview.ts` 檢視器（四視角、dispose）。

**Step 3 — 內建道具（純資料）**：骰子、轉盤、立牌、箱子、桌子、按鈕、
互動螢幕、抽卡箱（20 張=20 選項 chance）、拍照框、領取台；
**§50 巧拼地墊 PropDefinition**（真實厚度／拼接感；場地大陣列仍走
ArrayGroup instancing，效能理由明載）；四個 golden assembly（§65-68）。

**Step 4 — 模擬綁定（接線契約落地）**：`instantiatePropInteraction`／
`removePropInteraction`（含終點改寫與復原）；bootstrap 兩型；
`resolveStationPosition` anchor offset（嚴格欄位閘＋同 commit parity）；
queueDirectionDeg → queuePlacement（只在存在時讀）；複製＝再插入；
§63 驗證（anchor 在牆外/牆內、clearance、§18 zone 重疊、queue 溢出提示）；
§55 靜態分配語意測試。

**Step 5 — Prop Studio UI**：建造流程（類型→尺寸→外觀→互動→儲存）；
面表編輯器（= 活的 project.interaction options）；加零件（數字＋關係吸附）；
anchor chips；「從選取的物件建立組合道具」（§93：吸收 parts＋anchors＋
片段、刪原件、重插）；`state/propLibrary.ts`；素材庫「我的道具」；
§71 fork／§39 更新；**undo/autosave = definition 住在 project.props，
store mutate 免費獲得**（草稿=未放置的 definition 也在 props 裡，刷新不掉
§76）。

**Step 6 — 彩排、場刊、夥伴**：per-frame 站台結果（教室無分岔→不輸出）；
骰子服務中旋轉→settle 到結果面（§25 deterministic）；§26 選中站台顯示
目前結果／已互動時間（person 級顯示 step 名——誠實近似，記載）；
§57 離開＝完成者朝 exit anchor 漂移（rendering-only，不加時間）；
§31 顯示連動；`planSymbolForEntry` **只對 `plan:prop:` 前綴**讀
planSymbolRef（其餘不動 §96）；夥伴模式 anchor 句子（§85）。

**Step 7 — GLB 升級、AI recipe、匯入匯出**：GLB entry 掛 prop payload
（visual 留 glb:）；agent intent/tool/executor case＋summarize() 擴充；
`.planform-prop.json` schema 驗證匯入匯出。

**Step 8 — Golden E2E、效能、審查**：§94/§95 e2e；「10 互動＋100 人」
smoke；三輪審查（架構/UX/視覺；本機無已登入 Claude CLI，由全新無脈絡
subagent 執行，PR body 一行如實揭露）；Grok 盲測 §91/§92/§93；PR body；
tag `PLANFORM_PROP_STUDIO_READY`；**不 merge**。

## 風險清單

| 風險 | 處置 |
|---|---|
| parity fixture | 引擎輸出一律條件式；anchor 解析嚴格欄位閘；每個觸引擎的 commit 單獨跑 parity |
| 舊版 build round trip | props 存活；站台綁定被剝→`prop_<objectId>` re-bind pass；測試模擬舊版白名單 |
| 兩份持久化漂移 | entry 嚴格由 definition 單向產生＋guard test |
| 手機效能 | 效能契約前置；≤12 typical mesh；合併；10互動+100人 smoke |
| 刪道具殭屍站台 | remove 含終點復原；測試釘住 |
| 兩個編輯器編同一份資料 | 放置後只有 project.interaction 是活的；面表與 chanceRows 同源 |
| 到不了的片段 | 接線契約＋「每個 preset 插入後可達性」測試（走 stepAfter 全圖） |

## 進度

| Step | 狀態 | 備註 |
|---|---|---|
| 0. 既有 bug 修復 | ✅ | `8f0d395`，9 測試、4 變異被擋 |
| 1. 模型與持久化 | ✅ | 11 測試、9 變異全擋 |
| 2. parts → 3D ＋ 預覽器 | ✅ | 11 測試、5 變異全擋 |
| 3. 內建道具＋地墊 | ✅ | 15 筆定義（10＋地墊＋4 golden）、12 條性質測試 |
| 4. 模擬綁定（接線契約） | ✅ | 20 測試、8 變異全擋；parity 零改動 |
| 5. Prop Studio UI＋群組 | ✅ | studio overlay（預設種子、零件/互動/錨點編輯、autosave 草稿）、我的道具裝置庫、§71 fork、§93 群組吸收；live 瀏覽器煙霧測試全過 |
| 6. 彩排／場刊／夥伴／連動 | 🟡 | 引擎 per-frame 站台結果、§25 減速落面、§31 顯示連動、§57 離場漂移、§96 場刊前綴閘、§85/§26 純函式＋28 測試、19/20 變異被擋（1 個等價）；§26/§85 的 UI 面板與 §32 Studio 選擇器待接 |
| 7. GLB／AI／匯入匯出 | ⬜ | |
| 8. E2E／效能／審查／tag | ⬜ | |
