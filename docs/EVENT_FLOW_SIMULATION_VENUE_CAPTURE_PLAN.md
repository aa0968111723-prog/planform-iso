# Planform ISO — Event Flow Simulation + Venue Capture Plan

## 產品目標

把 Planform ISO 從「場佈編輯器」進一步變成真正能在活動前演練的 **活動現場流程模擬工具**。

核心問題不是只有「桌子擺哪裡」，而是：

- 報到桌放哪裡最順？
- 有現場收費時會不會形成瓶頸？
- 已繳費／未繳費是否需要分流？
- 引導員應該站在哪裡？
- 鞋子、背包、報到、入座的順序是否合理？
- 30／60／100 人陸續進場時，哪裡會塞住？
- 怎麼把結果用很直觀的圖交給夥伴？
- 能不能拍攝真實場地／素材，再快速轉成可編輯場佈？

本階段以 **實用、視覺化、手機可操作、本地演算法優先** 為原則。AI 是輔助，不得讓核心模擬依賴付費模型才能運作。

---

# 1. 與既有能力的關係

保留並直接重用目前 main 已有的：

- real-scale 場地
- 地磚與校正
- semantic assets
- zones
- routes
- placement / arrays
- measurement
- Validation 2.0
- Construction Plan
- mobile-first workspace
- local-first / PWA / Undo / JSON

不要重做上述系統。

本 PR 的新核心是：

1. Event Flow domain model
2. 報到／收費／引導服務站點
3. 本地離散事件／排隊模擬
4. 視覺化人流播放與瓶頸顯示
5. 方案比較與 AI 建議接口
6. 自訂素材
7. 照片／場地影像轉語意場佈的可確認流程

---

# 2. Event Flow Model

新增獨立於 SceneObject 的活動流程資料模型。

建議至少包含：

## EventScenario

- id / name
- participantCount
- arrivalProfile
- participantProfiles
- stations
- flowGraph
- simulationSettings

## FlowNode / ServiceStation

站點類型至少：

- entrance
- guide
- queue
- checkin
- payment
- shoe
- backpack
- seating
- group
- custom

ServiceStation 可關聯既有 Zone / SceneObject / Route，並記錄：

- staffCount
- parallelServers
- meanServiceSeconds
- optional variance
- queueCapacity
- throughput metadata
- station role

不要把「報到」或「收費」硬編成特殊 UI 邏輯，應以 station model 表達。

## ParticipantProfile

至少支援：

- 一般參加者
- 已繳費
- 現場繳費
- 工作人員／不排一般隊伍的角色

Profile 可以有不同 flow branch。

---

# 3. 報到＋收費流程

這是 V1 第一優先場景。

至少能建立：

`入口 → 引導 → 報到 → 收費(條件式) → 鞋子 → 背包 → 入場／入座`

分流範例：

- 已繳費：入口 → 報到核對 → 鞋子 → 背包 → 入座
- 未繳費：入口 → 報到 → 收費 → 鞋子 → 背包 → 入座

支援比較：

- 報到與收費同桌
- 報到／收費分桌
- 入口先分流
- 增加工作人員
- 調整桌子位置
- 改變站點順序

注意：本功能只模擬流程與時間，不做真實付款、金流、信用卡資料或個人財務資料處理。

---

# 4. Local Simulation Engine

核心模擬必須使用 TypeScript 本地執行，沒有 AI API 也能跑。

V1 使用簡單、可解釋、可重現的離散事件／排隊模型，不引入大型物理引擎。

至少模擬：

- participant arrival time
- route travel time
- station queue
- service start / finish
- parallel staff / servers
- branch by participant profile
- waypoint pause
- queue overflow / congestion
- total completion time

要求 deterministic seed，讓同樣設定能重現結果並比較 A/B 方案。

不要讓 LLM 自己算每個人的座標或排隊時間。

---

# 5. 空間與模擬連結

Simulation 不得脫離真實場佈。

ServiceStation 應能綁定：

- Zone
- SceneObject（例如報到桌）
- Route waypoint

Travel time 至少考慮 route length；若站點移動，模擬結果必須重新計算。

Validation 與 Simulation 要互通：

- route 穿障礙
- entrance blocked
- aisle too narrow
- zone / queue 超出可用空間
- flow crossing

空間不合法時，模擬需明確顯示限制，不能假裝結果可靠。

---

# 6. 視覺化模擬

新增 `▶ 模擬` 模式。

Canvas / Top View 上以簡單 marker 表示參加者，不做遊戲級人物動畫。

至少支援：

- play / pause / restart
- 速度 1× / 2× / 5×
- timeline
- participant markers 沿 Route 移動
- station queue visualization
- queue count badge
- congestion highlight
- flow direction arrows
- station busy / idle state

畫面應優先讓夥伴一眼看懂，不顯示大量工程數值。

建議狀態：

- 綠：順暢
- 黃：開始排隊
- 紅：明顯瓶頸

顏色需符合既有 design tokens，不硬寫散落 magic colors。

---

# 7. 模擬結果

每次模擬至少輸出：

- total participants completed
- average total journey time
- max queue per station
- average waiting time per station
- station utilization
- bottleneck station
- peak congestion time
- unfinished participants（若有）

一般使用者先看到摘要：

- 「最塞：收費」
- 「最大排隊：11 人」
- 「約 18:25–18:35 最忙」
- 「增加 1 位收費人員後可改善」

進階數據再展開。

---

# 8. Scenario Compare

至少支援 A / B 兩方案比較，理想為 A / B / C。

例如：

A. 報到＋收費同桌
B. 報到與收費分流
C. 入口先依付款狀態分流

比較畫面聚焦：

- 最大排隊
- 平均等待
- 完成時間
- 所需工作人員
- 空間／動線警告

提供一鍵套用候選場佈，但套用前必須 Preview / 可 Undo。

---

# 9. AI Agent Role

AI 不是核心模擬器。

AI 只做：

- 自然語言 → Scenario parameters
- 解讀模擬結果
- 產生候選方案
- 呼叫本地工具進行 simulation / validation / compare
- 提出可解釋的場佈與人力調整建議

工具契約建議：

- readLayout
- createScenario
- updateScenario
- bindStation
- runSimulation
- compareScenarios
- validateLayout
- moveStation
- changeStaffCount
- previewChanges
- applyChanges
- undoAgentChanges

所有幾何、碰撞、排隊、時間計算由 deterministic local core 完成。

模型 Provider 必須抽象化；可以接 NVIDIA NIM/BYOK，也可未來接其他模型。沒有 Provider 時，手動設定與本地模擬仍完整可用。

Agent 不得未確認直接大量改場佈。

---

# 10. AI UX

手機不要加入永久聊天 Sidebar。

主入口以：

`✨ AI 優化`

提供快速動作：

- 幫我模擬報到
- 有收費怎麼分流？
- 幫我找瓶頸
- 幫我比較兩種場佈

AI 回覆以方案卡、數字摘要、Canvas highlight 為主，文字保持簡短。

---

# 11. 自訂素材系統

在既有 Asset Registry 上加入 User Asset layer，不破壞內建 8 種核心素材。

自訂素材至少可：

- 上傳／拍攝照片
- 名稱
- 實際寬／深／高
- category
- placement surface
- plan symbol / thumbnail
- blocksRoute
- optional service role
- notes

例如自訂「收費桌」可以是：

- furniture / service-desk
- payment role
- 180 × 60 cm
- 可綁定 Payment Station

自訂素材必須能保存、重新使用、JSON/專案相容；圖片媒體不要因 localStorage 容量造成不穩，優先設計適合 PWA 的本地媒體儲存層（例如 IndexedDB），metadata 與 Project state 分離。

---

# 12. 素材視覺精緻化

優先提升「俯視辨識度」而不是高成本 3D 寫實。

內建與自訂素材在 Top View 應有：

- 清楚輪廓
- 朝向
- 大型易讀 label（可切換）
- role icon
- selected / simulation state

3D 仍維持輕量 procedural / low-poly，不引入重型模型市場或大量貼圖依賴。

---

# 13. Venue Capture / Photo Understanding

新增「📷 掃描場地」概念，但 V1 必須採 **AI 建議 → 使用者確認 → 才建立場佈**。

流程：

1. 使用者拍攝／上傳場地照片
2. Vision provider 回傳 semantic detections
3. 顯示偵測結果與 confidence
4. 使用者確認／刪除／改類型
5. 使用已知尺寸校正比例
6. 轉為 Planform 可編輯物件
7. 使用者最後確認 commit

優先偵測：

- door
- screen
- table
- chair
- tile/grid reference
- obvious obstacle
- corridor / room boundary（若可信）

禁止把單張照片推測成精準 3D geometry 後直接寫入專案。

---

# 14. Calibration for Capture

照片轉場佈至少要求一個可信尺寸參考，例如：

- 一塊已知尺寸地磚
- 一扇已知寬度的門
- 使用者手動畫兩點並輸入實際距離

AI 可以建議比例，但不得 silent scale。

任何低 confidence 的位置／尺寸必須明顯標示「待確認」。

---

# 15. 自訂素材照片理解

拍攝單一素材時，Vision 可以建議：

- 名稱
- category
- placement type
- 是否阻擋動線
- 是否可能是 service station

但真實尺寸若照片沒有尺度參考，不得假裝精準估算。

需要使用者輸入尺寸或提供尺度參考。

V1 不要求完整 photogrammetry / NeRF / 3D reconstruction。

---

# 16. Mobile-first 操作

在已合併的 mobile-first workspace 上延伸，不回退桌面縮小版。

手機第一層可以逐步收斂成：

- 📷 場地
- 🪑 場佈
- ▶ 模擬
- ✨ 優化

Simulation / AI / Capture 使用 bottom sheet，但播放時要讓 Canvas 保持主要可視區。

不要讓模擬參數一次全部攤開。

Quick Setup 只問：

- 預計人數
- 抵達時間範圍
- 是否現場收費
- 已繳／未繳比例
- 報到工作人員
- 收費工作人員

其他參數使用合理預設，放進進階設定。

---

# 17. 分享給夥伴

新增可視化輸出／檢視：

- 報到與引導流程圖
- 工作人員站位圖
- 動線圖
- 場佈總覽
- Simulation summary

夥伴檢視不應顯示 Inspector、debug data 或複雜模型參數。

目標是未使用過 Planform 的夥伴也能快速理解：

- 我站哪裡
- 參加者從哪裡來
- 接下來去哪
- 哪裡可能塞
- 有收費的人走哪條路

---

# 18. 隱私與資料原則

- Venue photos 預設 local-first
- 只有使用者明確啟用 Vision provider 時才上傳到 provider
- 不做人臉辨識
- 不建立參加者身分追蹤
- 模擬 participant 使用匿名虛擬 agent
- 不儲存信用卡／銀行／真實付款憑證
- 收費只做流程時間與分流模擬

---

# 19. 明確不做

本階段不要：

- 真實支付／金流串接
- 人臉辨識
- 參加者個資資料庫
- CCTV 即時追蹤
- 重型 crowd physics
- 遊戲級角色動畫
- BIM / CAD
- photorealistic digital twin
- NeRF / full photogrammetry
- 強迫使用 NVIDIA 或任何單一 AI provider
- 後端帳號／多人同步

---

# 20. 第一個完整驗收情境

建立以下 scenario 並真正跑通：

- 60 位參加者
- 40 位已繳費
- 20 位現場繳費
- 20 分鐘內陸續抵達
- 入口有引導
- 報到
- 現場收費
- 鞋子區
- 背包區
- 最後進入地墊／座位區

至少比較：

A. 報到＋收費同一站
B. 報到／收費分開

系統必須能視覺播放兩方案並顯示：

- 每站最大排隊
- 平均等待
- 最終完成時間
- 最主要瓶頸
- 哪個方案較順以及原因

再移動報到／收費桌或增加一位工作人員，重新模擬，結果應確實改變。

---

# 21. Venue Capture 驗收

至少能：

1. 上傳／拍攝一張場地照片
2. Provider 回傳幾個候選語意物件（可用 adapter mock 做自動測試，但產品流程不能是純 mock）
3. 使用者確認物件
4. 用已知距離校正
5. 建立可編輯 SceneObject
6. Undo

自訂素材至少能：

1. 拍攝／上傳照片
2. 建立名稱＋尺寸＋類型
3. 出現在素材庫
4. 放入場地
5. 綁定為 ServiceStation（若適用）
6. 重載後仍存在

---

# 22. 測試與效能

新增單元測試至少涵蓋：

- deterministic simulation
- arrivals
- branching paid / unpaid
- queueing
- multiple servers
- station utilization
- bottleneck detection
- scenario comparison
- station/layout binding
- migration / JSON roundtrip
- custom asset metadata

Browser smoke：

- desktop
- 360×800
- 390×844
- 412×915

至少驗證 100 個虛擬 participant 的模擬播放與結果計算仍可順暢操作；模擬計算不應在每一 animation frame 重跑完整模型。

完成前：

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`

全部通過。

---

# Definition of Done

這一階段完成後，使用者應能：

1. 用手機快速建立／確認真實場地
2. 建立報到、收費、引導、鞋子、背包、入座流程
3. 設定人數與少量必要參數
4. 按一次 `▶ 模擬`
5. 在平面圖直接看到人流、排隊與壅塞
6. 比較不同場佈／人力／分流方案
7. 讓 AI 幫忙解讀與提出候選方案，但沒有 AI 也能完整模擬
8. 拍自己的素材建立可重用自訂素材
9. 把清楚的動線／站位／瓶頸圖交給夥伴

核心判定：

**讓活動開始前就能看見「人真的進來之後會怎麼走、在哪裡塞、怎麼改會比較順」。**
