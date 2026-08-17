# Planform ISO — Real Asset System & Field Placement UX

## 目的

將目前已可使用的 3D 場佈編輯器，從「不同尺寸與顏色的通用方塊」升級為真正可在教室現場使用的場佈工具。

這個階段不以新增更多物件種類為目標，而是讓現有素材具備：

- 清楚的素材分類與辨識
- 真實尺寸與常用尺寸預設
- 符合現場邏輯的放置規則
- 明確的 2D / 3D 外觀
- 智慧吸附與父子關係
- 空間衝突與安全距離提示
- 現場量測與定位資訊
- 手機上可快速完成實際擺放

## 現況問題

目前 ObjectKind 已經有電腦、門、電燈開關、投影幕、桌子、椅子、地墊、報到桌，也有真實公尺尺寸資料；但是 Three.js renderer 仍將所有物件以 BoxGeometry 呈現，因此不同素材主要靠顏色與尺寸辨認。

目前「加入物件」亦將所有物件放在同一層級，沒有區分固定設施、家具、設備、地面用品等語意。

因此使用者目前可以排，但仍容易出現：

- 電腦直接放在地上
- 電燈開關放在教室中央
- 門沒有真正吸附牆面與開門弧線
- 投影幕沒有朝向概念
- 桌椅與地墊只有幾何尺寸，沒有真實素材辨識
- 現場不知道應該從哪一塊地磚、哪一面牆開始擺
- 沒有清楚警告物件擋門、互相重疊、超出教室或侵入必要走道

本 PR 定義下一階段完整實作契約。

---

# 1. 素材分類系統

素材庫不再以單一「加入物件」區平鋪全部項目。

## 1.1 一級分類

### 空間
- 教室
- 走廊

### 功能區域
- 報到區
- 生活組區
- 小組組別區
- 講師禪定區
- 鞋子擺放區
- 背包放置區

### 固定設施
- 門
- 電燈開關
- 投影幕

### 家具
- 桌子
- 椅子
- 報到桌

### 設備
- 電腦

### 地面用品
- 地墊

### 動線
- 現有動線工具

## 1.2 素材卡

每張素材卡至少顯示：

- 圖示或小型 3D thumbnail
- 名稱
- 預設尺寸
- 放置類型：地面 / 牆面 / 桌面
- 常用尺寸預設數量

例如：

- 椅子 — 45 × 45 cm — 地面
- 門 — 90 × 210 cm — 牆面
- 電腦 — 50 × 25 cm — 桌面優先

## 1.3 搜尋與快速常用

第一版至少支援：

- 分類切換
- 最近使用
- 常用素材固定在前方

素材種類目前很少，不需要過度設計大型 DAM 或雲端資產庫。

---

# 2. 素材資料模型 2.0

將 ObjectKind 的固定 defaults 升級成 AssetDefinition registry。

每個 AssetDefinition 至少包含：

- id / kind
- label
- category
- defaultDimensions
- dimensionPresets
- placementSurface
- snapBehavior
- clearanceRules
- icon / thumbnail
- proceduralRenderer key
- allowCustomSize
- allowedParents
- defaultFacing

## 2.1 PlacementSurface

至少支援：

- floor
- wall
- tabletop
- floor-or-tabletop

## 2.2 SceneObject 擴充

建議加入：

- assetVersion
- parentObjectId?: string
- surface?: floor | wall | tabletop
- elevation: number
- wallAnchor?: { areaId, edge, offset }
- facingDeg
- presetId?: string
- note?: string

## 2.3 向下相容

PROJECT_VERSION 升級時必須提供 migration。

舊專案中的 SceneObject 不得消失或位置亂掉。

舊資料缺少 placement metadata 時，依 kind 推導合理預設。

---

# 3. 真實 3D 素材

不追求寫實遊戲品質，而是：

**Low-poly、真實比例、高辨識度、手機效能優先。**

第一階段優先使用 Three.js procedural geometry，不強制外部 GLB。

## 3.1 椅子

不可再是一個立方體。

至少由：

- 椅面
- 椅背
- 四腳或簡化支架

組成。

尺寸仍以 SceneObject 實際 width/depth/height 驅動。

## 3.2 桌子

至少：

- 桌板
- 桌腳

不同尺寸改變桌板真實比例，而不是整個模型不合理拉伸。

## 3.3 報到桌

基於桌子，但視覺上必須可立即與一般桌區分。

可加入簡單「報到」標牌或前板，不增加新的活動設備種類。

## 3.4 電腦

至少：

- 螢幕
- 支架
- 底座

不要以 50 × 50 × 40 cm 整塊方盒表示。

## 3.5 地墊

- 薄型圓角外觀
- 真實長寬厚度
- 保留大量排列效能
- 批量時可使用 InstancedMesh 或共享 geometry/material

## 3.6 門

至少顯示：

- 門框
- 門板
- 鉸鏈方向
- 開啟方向
- 俯視圖開門弧線

## 3.7 投影幕

至少：

- 上框
- 白色幕面
- 清楚朝向

## 3.8 電燈開關

以非常輕量的牆面小面板呈現。

3D 視圖看得到高度；俯視圖需有清楚圖示，不要求真實尺寸到肉眼難以辨識。

---

# 4. 放置模式 UX

點擊素材卡後，不應直接在固定座標生成物件。

改為：

1. 選素材
2. 進入 Placement Mode
3. 指標 / 手指下方顯示半透明 ghost preview
4. 自動尋找合法放置面
5. 顯示吸附結果與尺寸
6. 點擊 / 輕觸確認
7. 保持連續放置或退出

## 4.1 Ghost 狀態

- 綠色：合法
- 黃色：可放但有提醒
- 紅色：不合法或明顯衝突

不能只靠顏色；需同時提供文字 / icon 提示以支援可及性。

## 4.2 手機

手機放置模式必須能：

- 單指移動 ghost
- 點一下放置
- 旋轉快捷按鈕
- 切換吸附
- 取消

避免要求輸入 X / Z 才能放置。

---

# 5. 真實放置規則

## 5.1 門

門屬於 wall asset。

要求：

- 優先 / 強制吸附教室或走廊邊界
- 設定門寬
- 左鉸鏈 / 右鉸鏈
- 向內 / 向外
- 開啟角度
- 顯示 sweep clearance

門不應能在教室正中央被當作一般家具使用。

## 5.2 電燈開關

屬於 wall asset。

要求：

- 吸附牆面
- 記錄離地高度
- 預設高度可設定，例如 1.2 m
- 俯視圖以可讀 icon 表示

## 5.3 投影幕

屬於 wall / fixed asset。

要求：

- 壁面吸附
- 幕面朝向
- 寬度 preset + 自訂
- 俯視圖顯示觀看方向

第一版不需要真的模擬投影光束。

## 5.4 電腦

placementSurface = tabletop 優先。

當靠近桌子 / 報到桌時：

- 顯示「放置於此桌面」提示
- 自動建立 parentObjectId
- elevation 對齊桌面高度
- 桌子移動時電腦跟著移動

如需允許放地面，必須是明確 override，而不是預設。

## 5.5 桌子 / 椅子 / 報到桌 / 地墊

placementSurface = floor。

要求：

- 地磚吸附
- 物件邊緣 / 中心對齊
- 與牆面距離提示
- 批量排列時沿地磚方向工作

---

# 6. 尺寸預設與自訂

所有素材保留真實公尺資料，但 UI 優先用 cm 顯示日常尺寸。

## 6.1 桌子

至少提供常用 preset，例如：

- 120 × 60 cm
- 180 × 60 cm
- 180 × 75 cm
- 自訂

## 6.2 椅子

- 45 × 45 cm
- 50 × 50 cm
- 自訂

## 6.3 地墊

- 60 × 180 cm
- 60 × 120 cm
- 自訂

不得假設這些就是使用者實際地墊；所有 preset 都只是快捷值。

## 6.4 門

- 80 cm
- 90 cm
- 100 cm
- 自訂

門高可有預設但允許修改。

## 6.5 投影幕

以實際幕寬為主要場佈尺寸，若提供「100 吋 / 120 吋」等名稱，內部必須轉成明確實際寬高值，不可只存文字標籤。

---

# 7. 智慧吸附與空間關係

保留目前地磚：

- 自由
- 交點
- 邊線
- 中心
- 半格

並增加：

- 物件中心對齊
- 物件邊緣對齊
- 與牆平行
- 與鄰近桌椅等距
- wall anchor
- tabletop anchor

吸附必須可以暫時停用。

---

# 8. 真實場地檢查

建立 Validation / Field Check layer。

## 8.1 必要警告

至少檢查：

- 物件超出教室 / 走廊邊界
- 家具明顯互相重疊
- 地墊互相重疊
- 物件侵入門 opening / sweep 區
- 牆面素材脫離牆面
- 電腦 parent 桌不存在
- 動線穿越明顯實體障礙

## 8.2 警告不是硬性阻擋

除了明顯不合法 placement，可以允許 override。

實際場地有時會需要特殊配置，因此應顯示：

- 問題位置
- 問題原因
- 是否可忽略

## 8.3 場地檢查面板

顯示：

- 錯誤
- 警告
- 建議

點擊項目可以 zoom / focus 到對應物件。

---

# 9. 現場量測與定位

目前 calibration 只是 metadata；下一版要讓「真實可用」更完整。

## 9.1 尺規工具

新增 Measure Mode：

點 A → 點 B，顯示：

- 公尺
- 公分
- 跨幾塊地磚

可量：

- 兩物件距離
- 物件到牆距離
- 走道寬度
- 地墊列總長

## 9.2 地磚定位資訊

選取物件至少顯示：

- 所在地磚 row / column
- 距最近地磚邊線
- 距最近牆面
- 尺寸
- 朝向
- 所屬區域（若有）

例如：

「地墊 #12：第 4 排第 6 格，距左牆 60 cm，距前一墊 20 cm。」

## 9.3 現場校正

現場校正不應只存一個 referenceLength。

第一版可改為：

- 選擇校正類型：地磚 / 牆面
- 輸入實際值
- 顯示目前模型值與差異
- 提供「套用到地磚尺寸」或「更新教室尺寸」的明確操作

不可默默縮放整個場景造成既有配置失真。

---

# 10. 小區域與素材關係

小區域仍是用途標記，不是物理牆。

新增：

- SceneObject 可判定 currently inside 哪個 Zone
- 區域可顯示物件數量
- 地墊區可顯示地墊容量與目前使用量
- 報到區可快速 focus 報到桌與電腦

不要建立強制 rigid parent，因為物件可能跨區或區域會調整。

---

# 11. 俯視圖與 3D 的雙重表達

同一素材需要同時服務：

- 3D 等角視圖
- 現場施工用俯視圖

因此不是所有 3D 細節都要直接投射成俯視外觀。

## 11.1 俯視圖符號

固定設施應有清楚符號：

- 門：門板 + 開門弧
- 開關：牆邊 icon
- 投影幕：幕線 + facing marker
- 電腦：螢幕 icon

## 11.2 圖例

PNG 匯出可選擇加入簡易 legend：

- 區域色彩
- 動線色彩
- 特殊固定設施符號

避免工作人員拿到圖後不知道每個符號代表什麼。

---

# 12. 素材 UI 重構

目前 UI.ts 單檔責任過大，這階段若要實作素材系統，應拆分至少：

- AssetLibraryPanel
- AssetCard
- PlacementToolbar
- InspectorPanel
- ValidationPanel
- MeasureToolbar

但禁止為了架構漂亮而進行與功能無關的大規模 framework rewrite。

不要求改成 React / Vue。

---

# 13. 效能要求

3D 素材變精緻後仍需維持手機操作。

至少：

- 共用 geometry / material
- 地墊與大量相同椅子評估 InstancedMesh
- procedural geometry cache
- 避免每 frame 重建模型
- thumbnail 不建立完整第二套重型場景
- renderer pixel ratio 仍限制
- 選取 / validation 計算避免 O(n²) 無限制成長；目前規模可先用 spatial buckets / broad phase 簡化

---

# 14. 不在本 PR 規劃範圍

不要加入：

- 舞台
- 檀香
- 三色光
- 音響
- 麥克風
- AI 自動排場
- 後端
- 帳號
- 雲端同步
- 多人協作
- BIM / CAD 等級牆體編輯
- 寫實材質庫
- 線上 3D Marketplace

本階段只深化已確認的現有素材與實際場佈工作流。

---

# 15. 建議實作順序

## Phase A — Asset Registry + UI taxonomy

1. AssetDefinition registry
2. category / placement metadata
3. 新素材庫 UI
4. dimension presets
5. 舊 Project migration

## Phase B — Procedural 3D assets

1. 椅子
2. 桌子
3. 地墊
4. 報到桌
5. 電腦
6. 門
7. 投影幕
8. 開關

## Phase C — Placement rules

1. ghost placement
2. floor snap
3. wall snap
4. door hinge/swing
5. tabletop parenting
6. facing direction

## Phase D — Field validation

1. bounds
2. overlap
3. door sweep
4. parent integrity
5. route obstruction

## Phase E — Measurement / field UX

1. ruler
2. tile coordinates
3. wall clearance
4. calibration comparison
5. export legend

---

# 16. Definition of Done

這一階段實作完成後，使用者應能完成以下真實流程：

1. 開啟已建立的教室配置。
2. 在素材庫切換「固定設施」。
3. 選門，看到 ghost，吸附到教室牆面。
4. 設定 90 cm、左開、向外，俯視看到開門弧。
5. 選投影幕，吸附前牆並確認朝向。
6. 選開關，放在指定牆面並記錄高度。
7. 切到家具，放置實際尺寸桌椅。
8. 放報到桌。
9. 選電腦，拖到報到桌上，電腦自動吸附桌面並跟隨桌子移動。
10. 使用地墊 preset 或自訂尺寸進行陣列模擬。
11. 地墊與地磚對齊後確認放置。
12. 使用尺規量出地墊與牆、桌椅之間的距離。
13. 選任一物件可看到地磚座標、實際尺寸、距牆距離與所屬區域。
14. 開啟場地檢查，能看到門被擋、物件重疊、超出區域等問題。
15. 修正後檢查通過或只剩使用者明確忽略的提醒。
16. 匯出俯視 PNG 時，門、投影幕、開關、電腦與動線一眼可辨認。
17. 儲存、重開後 parent、wall anchor、尺寸、朝向與擺放關係全部保留。
18. 舊版 Project JSON 仍可正常載入。

若最後仍只是不同顏色的 BoxGeometry，或電腦 / 開關 / 門仍能像一般地面方塊隨意生成，即不符合此階段 Definition of Done。

---

# 17. 驗證要求

實作 PR 完成前至少應包含測試：

- AssetDefinition registry 完整性
- dimension preset / custom size
- v1 → v2 project migration
- wall snapping
- door hinge + sweep geometry calculation
- tabletop parent transform
- parent delete / detach behavior
- collision / overlap validation
- out-of-bounds validation
- measurement math
- tile coordinate formatting
- project save / load roundtrip
- JSON export / import roundtrip

並執行：

- npm run lint
- npm run typecheck
- npm run test
- npm run build

全部通過後才可視為實作完成。
