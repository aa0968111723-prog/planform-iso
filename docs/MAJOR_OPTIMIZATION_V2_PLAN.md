# Planform ISO — Major Optimization V2

## 0. 目的

這一階段不是再增加一批分散功能，而是把已經合併到 `main` 的能力收斂成一套真正能在活動現場使用的專業工具。

目前 `main` 已經包含：

- real-scale 場地與地磚
- semantic assets / Asset Catalog
- 自訂素材、GLB/GLTF、Img2ThreeJS adapter
- mobile-first workspace
- 俯視場佈、團隊檢視、動線視覺化
- Smart Layout
- Validation / Measure / Construction Plan
- Quick Agent Tool Layer + Preview/Commit/Undo
- Event Flow deterministic discrete-event simulation
- 報到／收費／引導／鞋子／背包／入座
- 場地掃描 review/calibration 流程

因此 V2 的唯一核心原則是：

> **底層更專業、模擬更可信、素材更精緻，但使用者需要做的事情更少。**

這不是 CAD、不是 Blender、不是遊戲引擎，也不是 AI 聊天室。

它是一個：

> **活動前快速建立場地 → 排場 → 模擬人流 → 找瓶頸 → AI 幫忙改善 → 給夥伴看懂並照著執行的現場工具。**

---

# 1. 產品成功標準

完成後，使用者應可只用手機完成以下流程：

1. 打開 Planform
2. 拍場地或載入既有場地
3. 確認幾個主要尺寸
4. 告訴系統「60 人、20 人現場繳費」
5. 系統建立／建議報到、收費、引導、鞋子、背包、入座站點
6. 顯示 A/B/C 配置
7. 播放 20 分鐘進場模擬
8. 直接看到哪裡塞住
9. 按「幫我改善」
10. 預覽 AI/Smart Optimizer 的改動
11. 套用後重跑模擬
12. 確認改善幅度
13. 匯出一張夥伴看得懂的場佈＋動線圖

整個流程不應要求使用者理解：

- mesh
- shader
- material node
- LOD
- event queue
- arrival distribution
- utilization formula
- tool calling
- JSON
- x/z 座標

進階資訊可以存在，但不能成為完成任務的必要條件。

---

# 2. 不重做已完成系統

禁止重寫：

- Asset Catalog 基礎
- local-first project persistence
- Three.js renderer 整體
- Undo/Redo 架構
- Event Flow engine 基礎
- Validation 基礎
- mobile bottom-sheet shell
- Smart Layout 基礎
- Tool Layer / Preview / Commit 基礎

本 PR 的實作必須以「深化、收斂、補缺口」為主。

---

# 3. P0 — 首頁與操作收斂

## 3.1 手機首屏只有四個主要行為

手機預設視圖保持 Canvas-first。

主要入口收斂為：

- `📷 掃描 / 場地`
- `🪑 場佈`
- `▶ 模擬`
- `✦ AI 幫我`

其他能力放入情境選單，不要同時常駐。

## 3.2 不要讓功能頁等於功能清單

例如「模擬」頁第一層不應顯示大量參數。

第一層只問：

- 今天幾個人？
- 多久內到？
- 有沒有人要現場繳費？
- 有幾個工作人員？

進階設定再展開。

## 3.3 任務導向，不是資料模型導向

UI 文案使用：

- 報到
- 收費
- 引導
- 入場
- 等候
- 地墊
- 工作人員

不要在一般模式顯示：

- ServiceStation
- ParticipantProfile
- FlowGraph
- serverCount
- routeNode

---

# 4. P0 — 報到／收費專用快速設定

新增真正可用的 `Registration Flow Wizard`。

## 4.1 預設模板

至少提供：

### A. 一般報到
入口 → 報到 → 入場

### B. 報到＋現場收費
入口 → 分流 → 已繳快速報到 / 未繳收費 → 入場

### C. 報到＋鞋子＋背包
入口 → 鞋子 → 報到 → 背包 → 入場

### D. 報到＋收費＋鞋子＋背包
入口 → 引導分流 → 報到/收費 → 鞋子 → 背包 → 入場

### E. 多組報到
入口 → 分組判定 → A/B/C 組報到 → 入場

## 4.2 使用者只填必要值

例如：

- 總人數：60
- 已繳：40
- 現場繳：20
- 抵達窗口：20 分鐘
- 報到人員：2
- 收費人員：1

系統自行建立 scenario draft。

## 4.3 可一鍵改成分流

提供：

- 同桌報到＋收費
- 報到／收費分桌
- 入口先分流
- 多桌平行報到

每次切換都重新模擬並顯示差異。

---

# 5. P0 — Simulation 2.0：結果必須能真的幫決策

現有 deterministic DES 保留。

V2 補足「可信度、可比較、可解釋」。

## 5.1 Seeded simulation

加入 seed，確保：

- 相同設定＋相同 seed 可重現
- 測試穩定
- A/B 比較公平

## 5.2 抵達模型

一般 UI 只顯示：

- 平均抵達
- 集中提早到
- 集中最後到
- 自訂

底層可映射 deterministic arrival schedule / seeded distribution。

## 5.3 服務時間

站點可有：

- 固定時間
- 快／中／慢 preset
- 自訂秒數

報到、收費、找零、資料確認應能不同。

## 5.4 分支與條件

至少支援：

- 已繳 / 未繳
- 有資料 / 缺資料
- 一般 / 特殊處理
- 不同小組

不要讓所有人強迫走同一條線。

## 5.5 重要輸出

模擬結束只突出：

- 最大等待人數
- 平均等待時間
- 最長等待時間
- 完成全部入場時間
- 最塞站點
- 工作人員利用率
- 動線交叉 / 空間瓶頸

不要第一層顯示一堆工程指標。

---

# 6. P0 — 場佈與模擬真正連動

現在不能只有「站點有 queue」，但站點擺哪裡都沒差。

V2 要讓位置真的影響模擬結果。

## 6.1 Station physical footprint

每個站點知道：

- 對應 asset / zone
- 服務面朝向
- 排隊面
- 工作人員站位
- 等候容量

## 6.2 Queue lane

建立簡單 Queue Lane：

- 起點
- 排隊方向
- 最大可排長度
- 每人占用間距

不做複雜 crowd physics。

## 6.3 Physical bottleneck

如果：

- queue 超出預留區
- queue 擋門
- queue 穿越另一主要動線
- 站點前方空間不足

Simulation Result 必須產生 spatial issue。

## 6.4 路線距離影響

Participant 在站點間移動要依 route/path distance 計算，而不是固定瞬移時間。

---

# 7. P0 — 視覺化人流升級

## 7.1 Marker 不只是裝飾

每個 marker 至少能呈現狀態：

- moving
- waiting
- being-served
- completed

## 7.2 Queue visualization

排隊時 marker 應形成可讀隊列，而不是疊在同一點。

## 7.3 Heatmap

新增輕量 heatmap：

- 走動密度
- 等候密度
- 壅塞密度

可在模擬後開啟。

## 7.4 Timeline scrub

模擬可：

- 播放
- 暫停
- 1× / 2× / 5×
- 拖曳時間軸
- 跳到最大壅塞時刻

## 7.5 Problem Focus

點問題：

> 「18:27 收費區最多排 11 人」

Canvas 自動 focus 該位置＋該時間。

---

# 8. P0 — Optimization Engine，不依賴 LLM

建立 `EventOptimizationEngine`。

它不是 AI 模型，而是 deterministic candidate search。

## 8.1 可調變數

候選可調：

- 報到桌位置
- 收費桌位置
- queue direction
- 入口分流位置
- 工作人員分配
- 同桌 / 分桌
- station capacity
- route selection

## 8.2 目標函數

至少考慮：

- 平均等待
- 最大排隊
- 全部完成時間
- 主要動線交叉
- 擋門
- 工作人員總數

## 8.3 給 3 個方案，不給 30 個

輸出：

### 最快
優先降低等待。

### 最省人
優先降低人力。

### 最順動線
優先降低交叉與壅塞。

## 8.4 顯示改善幅度

不要只寫「比較好」。

例如：

- 最大排隊 12 → 5 人
- 平均等待 4m20s → 1m50s
- 完成時間 28m → 21m

---

# 9. P0 — Quick Agent 2.0

Agent 的目標不是聊天，而是縮短操作。

## 9.1 入口仍然只有四個

- `📷 建素材`
- `🪑 幫我場佈`
- `▶ 幫我模擬`
- `✨ 幫我優化`

## 9.2 Context-aware

Agent 自動知道：

- 現在場地尺寸
- 門在哪裡
- 報到桌在哪裡
- 目前 scenario
- simulation result
- validation issues
- selected object / station

不要要求使用者重複描述畫面上已經存在的資訊。

## 9.3 短指令優先

必須可處理：

- 「模擬 60 人」
- 「20 個要現場繳費」
- 「報到跟收費分開」
- 「少一個人會怎樣」
- 「哪裡最塞」
- 「幫我改善」
- 「把收費移到右邊」
- 「入口不要堵住」

## 9.4 先本地解析

簡單指令先用 local parser / deterministic intent resolver。

只有自然語言真的需要時才呼叫 LLM provider。

## 9.5 AI 不直接寫 store

所有改動必須：

`intent → typed tool → staged state → validate → simulate → preview → commit`

## 9.6 Preview 必須視覺化

Preview 不只文字 diff。

Canvas 顯示：

- 原位置淡化
- 新位置 ghost
- 新 route
- 指標 before/after

按「套用」才 commit。

---

# 10. P1 — Agent 建議要有證據

例如 Agent 說：

> 建議把現場收費獨立成一桌。

旁邊必須附：

- 目前最大排隊：11
- 模擬後：5
- 平均等待：降低 42%

Agent 不可以只用語言猜「應該比較順」。

---

# 11. P0 — Asset Quality 2.0

專業素材不是「高面數」。

它應該是：

- 比例準
- 一眼可辨識
- 俯視清楚
- 材質一致
- 光影一致
- 行動裝置跑得動

## 11.1 Built-in asset visual standard

所有 built-in asset 要通過：

- 正確 real-scale bounding box
- 一致 local origin
- facing direction 標準化
- 俯視 silhouette 清楚
- reasonable bevel / rounded edges
- PBR material class
- plan symbol
- selection state

## 11.2 Material Library 2.0

至少建立：

- plastic
- painted-metal
- steel
- light-wood
- dark-wood
- fabric
- rubber/mat
- paper/sign
- screen/glass

不要讓每個 builder 自己亂設定 roughness。

## 11.3 Lighting profile

建立統一 studio/field lighting：

- neutral ambient
- soft directional
- contact shadow 或等價低成本效果

不要為炫技加入昂貴 postprocessing。

## 11.4 Quality modes

### Plan
俯視溝通，最低 GPU 成本。

### Standard
一般操作。

### Detail
單一物件近看或素材預覽。

系統依裝置與距離自動選，不要求使用者管理 LOD。

---

# 12. P0 — 自訂素材流程真正完成

## 12.1 五步內完成

1. 拍照 / 選照片
2. AI/系統辨識類型
3. 輸入或確認尺寸
4. 選用途
5. 建立

## 12.2 Proxy-first

照片上傳後幾秒內就要可以排場。

先建立 semantic proxy。

Img2ThreeJS 精緻化是後續 visual upgrade，不阻塞場佈。

## 12.3 Img2ThreeJS production adapter

Img2ThreeJS 仍然是 agent-side/offline reconstruction workflow。

禁止：

- browser eval generated code
- 直接執行未審核遠端 TS

建議流程：

`reference image → reconstruction job → generated factory source → build-time validation → render preview → approved artifact → catalog visual version`

## 12.4 Reconstruction status

素材卡顯示簡單狀態：

- 可使用
- 精緻化中
- 已完成
- 需要補照片

不要顯示 agent pipeline 技術細節。

## 12.5 多視角可選

如果單張照片信心低，可提示：

> 再拍側面會更準。

不是強制每次都多視角。

---

# 13. P1 — GLB/GLTF Production Pipeline

所有匯入素材必須：

1. parse
2. validate
3. remove unused
4. dedup
5. normalize scale/origin
6. calculate bounds
7. detect huge textures
8. optimize for web
9. generate thumbnail
10. generate top-view plan symbol/fallback

使用 glTF Transform 做可重現的處理。

不要破壞動畫或材質資訊，如果必須降級要明確記錄。

---

# 14. P0 — 場地掃描從 Mock 升級成真正 Provider Contract

目前 mock provider 可保留測試，但產品不能只停在 mock。

建立：

`VenueCaptureProvider`

輸入：

- 1–4 張照片
- optional known measurement

輸出：

- semantic detections
- confidence
- estimated orientation
- candidate dimensions
- reference relationships

## 14.1 不追求 photogrammetry

目標只是快速建立可編輯 Planform 場地。

AI 不需要生成完整 mesh 房間。

## 14.2 使用者確認是必要步驟

AI 偵測後顯示：

- 2 扇門
- 1 投影幕
- 6 張桌

低信心標「待確認」。

沒有確認不能默默寫進正式場景。

## 14.3 快速尺度校正

優先詢問：

- 地磚尺寸
- 門寬
- 已知牆長

一次校正後同步推算 candidate geometry。

---

# 15. P0 — 夥伴溝通輸出再升級

分享出去的不是「編輯器截圖」。

至少提供：

## 場佈總覽

- 區域
- 桌椅
- 地墊
- 門
- 投影幕

## 入場動線圖

- 起點
- 報到
- 收費
- 鞋子
- 背包
- 入座

## 工作人員圖

- 引導站位
- 報到人力
- 收費人力
- 工作人員 route

## 模擬結果圖

- 最大排隊站點
- 熱點
- 主要瓶頸
- 建議方案摘要

輸出必須適合直接丟 LINE。

---

# 16. P0 — 性能預算

專業化不能換來手機卡頓。

## 16.1 Frame budget

一般手機場景目標：

- idle：接近 60fps（裝置能力允許時）
- 模擬中：不應因 UI/marker 造成明顯卡死
- 大量地墊/椅子維持 instancing

## 16.2 Asset budget

建立 runtime guard：

- triangle count warning
- texture dimension warning
- texture memory estimate
- total loaded custom asset budget

一般使用者只看到：

> 「這個模型較重，已使用簡化版本。」

## 16.3 Lazy loading

Detail visual 不應在首頁全部預載。

## 16.4 Marker performance

大量 participant marker 使用 pooled/instanced rendering，不要每個 marker 建大量 DOM。

---

# 17. P0 — Reliability

## 17.1 Agent transaction

任一 multi-step action 失敗：

- live project 不得半套修改
- staged transaction rollback
- 錯誤用使用者可懂文字呈現

## 17.2 Simulation isolation

模擬不得修改正式 project geometry。

## 17.3 Asset failure fallback

自訂素材 visual 載入失敗時：

- semantic proxy 繼續工作
- 不白屏
- simulation/validation 不受影響

## 17.4 Provider failure fallback

AI/Vision/NVIDIA provider 不可用：

- 手動場佈可用
- Smart Layout 可用
- Simulation 可用
- Optimization Engine 可用

---

# 18. P1 — 專案資料模型收斂

不要因為每一支 PR 再堆一組平行 metadata。

檢查並收斂：

- Asset semantics
- Service station links
- Route links
- Scenario references
- visual source
- custom asset storage references

建立清楚 ID contract。

避免：

- object name 字串當 foreign key
- duplicate station copy
- route 和 station 各自儲存互相矛盾座標

---

# 19. P1 — 可觀測性（本地）

不需要雲端 analytics 才能 debug。

加入 dev-only diagnostics：

- renderer stats
- asset load failures
- simulation runtime
- optimization candidate count
- agent tool trace
- transaction rollback reason

Production UI 不顯示工程 log。

---

# 20. Agent Tool Layer 2.0

至少整理為以下群組。

## Read

- readVenue
- readLayout
- readScenario
- readSimulationResult
- readValidationIssues
- listAssets

## Layout

- createAsset
- moveAsset
- rotateAsset
- createZone
- createRoute
- createArray

## Event

- createServiceStation
- updateServiceStation
- configureScenario
- splitPaymentFlow
- assignStaff

## Simulation

- simulateScenario
- compareScenarios
- findBottlenecks

## Optimization

- generateLayoutCandidates
- optimizeEventFlow
- explainImprovement

## Visual

- focusObject
- focusIssue
- previewChanges

所有 write tool 都只能對 staged transaction 執行。

---

# 21. AI Provider Strategy

維持 provider abstraction。

可選：

- local deterministic parser
- NVIDIA NIM BYOK
- other OpenAI-compatible provider

V2 不要求租 GPU。

核心能力必須在沒有 LLM 時仍可完成。

AI 主要做：

- 自然語言理解
- tool selection
- 結果摘要
- 候選方案說明

AI 不做：

- 直接算 geometry truth
- 直接改 live state
- 取代 deterministic simulation

---

# 22. 專業模式與簡單模式

預設：`簡單模式`

只有必要控制。

可展開：`進階`

進階才顯示：

- station service time
- arrival profile
- validation thresholds
- precise measurement
- asset technical info

不能讓進階設定污染預設體驗。

---

# 23. Desktop 也要變簡單，不是只有手機

Desktop 不應因為空間大就塞滿面板。

維持：

- Canvas 為中心
- 任務式左側
- 情境式右側
- Agent 為 command/helper，不是永久聊天牆

---

# 24. 真實驗收案例 A：60 人＋20 現場繳費

場地：

- 1 個主要入口
- 1 個報到區
- 1 個鞋區
- 1 個背包區
- 地墊區

Scenario：

- 60 人
- 40 已繳
- 20 現場繳
- 20 分鐘抵達
- 報到 2 人
- 收費 1 人

必須比較：

### A
報到與收費同站

### B
報到／收費分流

### C
入口先分流＋分站

必須能清楚看出：

- 每個方案最大排隊
- 平均等待
- 完成時間
- spatial bottleneck
- 人力

Optimization 必須至少找到一個可量化改善方案。

---

# 25. 真實驗收案例 B：人力減少

在最佳方案上問：

> 「少一個工作人員會怎樣？」

Agent 必須：

1. 讀目前 scenario
2. 建 staged candidate
3. 重跑 simulation
4. 回傳 before/after
5. 不直接改正式 scenario

---

# 26. 真實驗收案例 C：照片新增收費桌

1. 手機拍一張真實折疊桌
2. 建立自訂素材
3. 輸入 180×60×74cm
4. 用途選收費
5. 立即以 proxy 放進場地
6. 可綁 ServiceStation
7. simulation 可以使用
8. Img2ThreeJS visual 完成後替換外觀
9. geometry footprint 不因 visual replacement 漂移

---

# 27. 真實驗收案例 D：場地掃描

1. 拍教室前後左右
2. provider 回傳候選
3. 顯示 confidence
4. 使用者確認門／投影幕／桌椅
5. 用 60cm 地磚校正
6. commit 可 Undo
7. 馬上進報到流程設定

---

# 28. Mobile viewport 驗收

至少：

- 360×800
- 390×844
- 412×915
- 430×932
- 480×960
- 768×1024 portrait

必須驗收：

- 首屏 Canvas 可見
- 模擬播放時 Canvas 不被 Sheet 蓋死
- Agent running 時可看場地變化
- timeline 可觸控
- problem focus 不被 keyboard/sheet 擋住
- landscape 不崩

---

# 29. Desktop 驗收

至少：

- 1280×720
- 1440×900
- 1920×1080

不能因 mobile-first 而失去有效工作空間。

---

# 30. 性能驗收

至少建立自動或可重現 benchmark：

### Layout
- 100 mats
- 100 chairs
- 20 custom assets

### Simulation
- 200 participants
- 8 stations
- branching flow

### Visual
- markers + route ribbons + zones + plan symbols

需要記錄：

- simulation compute time
- optimization compute time
- major render regression

不要訂不切實際的硬體無關 fps 絕對保證，但要防明顯 regression。

---

# 31. 測試要求

增加單元測試：

- seeded arrivals deterministic
- payment branch
- multi-server queue
- queue capacity/spatial overflow
- route distance
- optimization score
- transaction rollback
- asset visual fallback
- custom asset bounds stability
- scenario migration

增加整合測試：

- Wizard → simulate → optimize → preview → commit
- custom asset → station → simulate
- venue capture → confirm → scenario

---

# 32. 工程驗證

完成前必須通過：

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

不得以「既有測試通過」代替新功能驗收。

---

# 33. 不做

這一階段明確不做：

- Blender 級 3D editor
- CAD/BIM
- photogrammetry / NeRF 全場景重建
- 真實付款處理
- 金流 API
- 參與者姓名/個資資料庫
- 人臉辨識
- CCTV tracking
- heavy crowd physics
- 遊戲級人物動畫
- 24/7 GPU server
- 3D Marketplace
- 多人協作平台
- React Three Fiber rewrite

---

# 34. Definition of Done

不能只看程式碼或按鈕數量。

真正完成必須符合：

> 一個沒有學過 3D 軟體的人，可以拿手機到活動場地，快速建立或掃描場地，設定「今天幾人、多少人現場繳費、幾個工作人員」，看見報到／收費／引導的模擬，立刻知道哪裡塞，讓系統提出可量化改善方案，預覽後套用，最後把夥伴看得懂的場佈與動線圖分享出去。

同時：

> 素材可以精緻，但素材失敗不能影響場佈；AI 可以很強，但 AI 掛掉不能讓模擬失效；底層可以很深，但使用者不需要看見複雜度。

---

# 35. 實作順序

建議代理按以下順序做，避免 UI 先做完但 core 還是假的：

1. audit latest main
2. simulation seed / physical queue model
3. EventOptimizationEngine
4. scenario presets + Registration Flow Wizard
5. canvas queue / heatmap / timeline
6. Quick Agent 2.0 tool orchestration
7. visual Preview before/after
8. Asset Quality 2.0 / runtime budgets
9. custom asset production hardening
10. VenueCaptureProvider contract + real adapter boundary
11. exports
12. mobile/desktop polish
13. regression/performance tests
14. full acceptance scenarios

不要每做一個小函式就停下詢問。

遇到非必要設計選擇，優先採用：

- 現場實用
- 簡單 UX
- deterministic local core
- backward compatibility
- mobile performance
- graceful fallback

而不是擴大 scope。