# Planform ISO — Professional Asset Engine + Img2ThreeJS + Quick Agent UX

## 0. 產品方向

本階段把 Planform ISO 從「已有語意素材、但視覺仍偏工程型 procedural low-poly」推進成：

> **底層是專業場佈 / 模擬軟體，表面操作像拍照、拖拉、說一句話一樣簡單。**

本 PR 是規劃與實作契約，不直接把產品變成 CAD、Blender 或 3D Marketplace。

核心原則：

1. **素材更精緻、更專業，但操作更少。**
2. **俯視圖可辨識度與真實尺寸優先於高模炫技。**
3. **AI 負責理解意圖與調用工具；幾何、吸附、Validation、Simulation 仍由 Planform Core 計算。**
4. **自訂素材要能從照片 / GLB / GLTF 快速進入 Planform。**
5. **Img2ThreeJS 是「資產重建工作流」，不是瀏覽器 runtime 依賴。**
6. **既有 v3 專案、內建八種素材、ArrayGroup、Validation、Measure、PWA、Undo/Redo 不得破壞。**
7. **手機仍是 Canvas-first，不能為了專業功能重新塞滿面板。**

---

# 1. 現況與根因

目前 `src/core/assets.ts` 已有語意 AssetDefinition，包含：

- category
- placementType
- 真實尺寸
- presets
- defaultFacing
- elevation
- clearance
- color

但仍是固定 `ObjectKind`：

- computer
- door
- switch
- screen
- table
- chair
- mat
- regTable

目前 `src/scene/assets.ts` 的視覺主要由 BoxGeometry / 多段低多邊形 procedural geometry 組合。

這個架構適合 MVP，但若要做到：

- 真實活動場地自己的桌椅
- 收費桌 / 收費箱 / 指示牌 / 鞋架 / 置物櫃
- 使用者自己拍照建立素材
- GLB/GLTF 匯入
- 同一語意不同外觀
- 專業 PBR / LOD / plan symbol

就不能讓 `ObjectKind` 同時承擔「語意類型」與「模型外觀」。

本階段要把 **Semantic Asset** 與 **Visual Asset** 分離。

---

# 2. 不改變的既有核心

以下不得重做：

- 現有真實尺寸單位系統（內部 meters）
- SceneObject 基本 x/z/rotation/width/depth/height
- wall / floor / tabletop placement
- Door wall anchor / hinge / swing
- Tabletop parent
- ArrayGroup
- Measure
- Calibration
- SpatialHash / Validation
- Route
- Event-flow Simulation PR 的核心模型（若該 PR 已合併則直接整合，不重寫）
- Construction Plan
- JSON project backup
- Undo/Redo
- PWA / offline core
- Mobile Canvas-first workspace

本 PR 只在其上增加 Professional Asset Engine 與 Quick Agent。

---

# 3. Asset Architecture 2.0

## 3.1 語意與外觀分離

不要把固定 `ObjectKind` 直接等同模型。

新增兩層：

```text
SemanticAssetDefinition
        +
VisualAssetDefinition
```

例如同樣都是桌子：

- 一般折疊桌
- 木桌
- 報到桌
- 收費桌

對場佈 Core 來說仍然屬於 `table/service-desk` 類語意；但外觀完全不同。

## 3.2 建議資料模型

新增：

```ts
export type AssetSourceType =
  | "builtin-procedural"
  | "generated-procedural"
  | "glb"
  | "gltf"
  | "simple-proxy";

export type SemanticAssetType =
  | "door"
  | "switch"
  | "screen"
  | "table"
  | "chair"
  | "mat"
  | "computer"
  | "service-desk"
  | "storage"
  | "signage"
  | "queue-barrier"
  | "payment-equipment"
  | "other";

export interface AssetCatalogEntry {
  id: string;
  name: string;
  semanticType: SemanticAssetType;
  sourceType: AssetSourceType;
  category: "fixture" | "furniture" | "equipment" | "floor" | "service" | "custom";
  placementType: "floor" | "wall" | "tabletop";
  dimensions: { width: number; depth: number; height: number };
  defaultFacingDeg: number;
  clearanceFront: number;
  blocksFlow: boolean;
  serviceRole?: "checkin" | "payment" | "guidance" | "storage" | "none";
  visualRef: string;
  planSymbolRef?: string;
  thumbnailRef?: string;
  tags: string[];
  createdBy: "builtin" | "photo" | "import" | "agent";
  version: number;
}
```

實際命名可依現有架構調整，但概念必須成立。

## 3.3 SceneObject 相容策略

舊專案不得壞掉。

建議：

- 保留 `kind` 作為 backward-compatible semantic hint。
- 新增 optional `assetId`。
- 沒有 `assetId` 的 v3 SceneObject 自動映射到內建 Catalog Entry。
- 自訂素材以 `assetId` 決定外觀與進階語意。
- Project migration 升級至下一版時必須完整 roundtrip。

不要一次把所有舊 `kind` 移除。

---

# 4. Professional Visual Asset Layer

## 4.1 三個呈現品質層級

每個素材都應考慮三種用途，而不是只有一個模型：

### Plan
俯視 / 施工 / 分享模式。

優先：

- 清楚輪廓
- 朝向
- 文字 / icon
- 真實 footprint
- 快速渲染

### Standard
一般 3D 場佈編輯模式。

優先：

- 中等精緻
- 明確材質
- 合理 bevel / rounding
- 可辨識結構
- 手機流暢

### Detail
單件素材預覽或選取放大。

可以增加：

- 更細的材質差異
- 螺絲 / 邊框 / 把手 / 鉸鏈等 identity details
- 高品質陰影
- 更細 geometry

不要讓 Detail 模型在大量陣列中全部常駐。

## 4.2 Material Library

建立統一 MaterialPreset，而不是每個素材自行亂配材質。

至少：

- painted-metal
- brushed-metal
- plastic-matte
- plastic-gloss
- light-wood
- dark-wood
- fabric
- rubber
- paper/signage
- screen/glass
- mat/fabric-soft

每個 preset 至少控制：

- baseColor
- roughness
- metalness
- optional normal/texture

保持低飽和，顏色優先留給 Zone / Route / Selection / Warning。

## 4.3 Lighting

建立專業但輕量的場景 lighting preset：

- neutral environment light
- soft key / fill
- subtle contact shadow
- tone mapping 一致

不要用大量 dynamic lights。

## 4.4 Asset Quality Gate

每個新素材必須通過：

- 尺寸正確
- local origin 正確
- forward direction 正確
- footprint 正確
- plan symbol 可辨識
- selection bounds 正確
- mobile rendering 正常
- 沒有超大貼圖
- 沒有不必要 node / texture / geometry
- 100 個重複素材仍能合理使用

---

# 5. Img2ThreeJS Integration

## 5.1 定位

Img2ThreeJS 官方工作流是：

> reference image → procedural Three.js TypeScript factory

它是 reconstruction-by-code，不是 photogrammetry / mesh extraction。

因此適合 Planform 的：

- 桌子
- 椅子
- 收費箱
- 指示立牌
- 鞋櫃
- 置物架
- 報到設備
- 其他 hard-surface 場佈物件

不要把它定位成整間教室掃描器。

## 5.2 不得直接 bundle Img2ThreeJS 到 browser

Img2ThreeJS 是 agent / coding workflow，包含 Python 輔助與 vision review。

因此架構應是：

```text
Planform UI
   ↓
Create Custom Asset
   ↓
Asset Reconstruction Job Contract
   ↓
Img2ThreeJS-capable Agent / Local Worker
   ↓
Generated Three.js factory
   ↓
Planform Adapter + Quality Gate
   ↓
Asset Catalog
```

V1 不要求建立昂貴常駐 server。

只有一個使用者時，允許：

- local development agent
- Codex / Claude Code worker
- BYOK provider
- future optional server worker

## 5.3 Img2ThreeJS Adapter Contract

生成出的 factory 不可直接任意執行進產品。

需要 adapter / sandbox boundary。

至少要求輸出：

```ts
export interface GeneratedAssetFactory {
  metadata: {
    name: string;
    source: "img2threejs";
    version: string;
    forwardAxis: "+Z" | "-Z" | "+X" | "-X";
    unitHint?: "m" | "cm" | "unknown";
  };
  create(): THREE.Group;
}
```

再由 Planform：

- normalize scale
- normalize origin
- normalize forward axis
- calculate bounds
- attach selection proxy
- generate plan symbol
- generate thumbnail
- run performance gate

## 5.4 Photo → Asset UX

使用者只看到：

1. `＋ 新增自己的素材`
2. 拍照 / 上傳照片
3. AI 猜測名稱與類型
4. 輸入或確認真實尺寸
5. 選用途（一般 / 報到 / 收費 / 引導 / 收納 / 其他）
6. 建立

不要要求使用者理解：

- geometry
- shader
- mesh
- material node
- pivot
- bounding box

這些由系統處理。

## 5.5 快速 fallback

Img2ThreeJS reconstruction 可能需要時間。

因此照片匯入後立即建立：

**simple semantic proxy**

讓使用者馬上可以排場與模擬。

等精緻重建完成再替換 visual source。

重要：替換外觀不得改變：

- SceneObject position
- dimensions
- semantic role
- service station link
- routes
- simulation state

---

# 6. GLB / GLTF Import Pipeline

## 6.1 使用者操作

只需要：

`匯入 3D 素材`

選擇 `.glb` / `.gltf`。

然後 UI 只問：

- 名稱
- 真實尺寸（若無法可靠判定）
- 用途

## 6.2 glTF Transform

採用 `donmccurdy/glTF-Transform` 作為標準化 / optimization 工具。

使用：

- prune
- dedup
- resample（如有 animation）
- meshopt / Draco（依 runtime 相容性）
- texture resize
- WebP / optional KTX2

不要把第三方模型直接無限制塞進手機。

## 6.3 Import Gate

至少檢查：

- file size
- triangle / vertex complexity
- texture dimensions
- node count
- material count
- animation count
- bounding box
- malformed / unsupported extensions

對過大的模型：

- 顯示「需要最佳化」
- 自動最佳化或產生 lightweight proxy

不要讓一次 GLB 匯入拖垮整個 PWA。

---

# 7. Asset Storage

自訂素材包含 binary / image，不適合全部塞 localStorage。

新增 local-first asset storage：

- Project JSON 保存 asset references / metadata
- IndexedDB 保存 user asset blobs / thumbnails / source images（實作可用原生 IndexedDB 或薄封裝）
- export project 時需考慮 portable package / missing asset handling

V1 可以先支援：

- 本機自訂素材永久保存
- JSON 中保存 metadata/reference
- missing asset 有清楚 fallback

後續再做完整單檔 portable package，不要為此先導入 backend。

---

# 8. Plan Symbol Generator

所有素材，不論 procedural / Img2ThreeJS / GLB，都必須有俯視表示。

優先方式：

1. semantic-specific SVG / canvas symbol
2. runtime top-view silhouette
3. fallback bounding rectangle + direction marker

俯視模式必須比 3D 更容易辨識。

例如：

- 收費桌：桌面輪廓 + `$` / `收費`
- 報到桌：桌面輪廓 + `報到`
- 鞋櫃：格狀收納 icon
- 指示牌：方向箭頭
- 椅子：座面 + 朝向

不要把精緻 3D thumbnail 當 plan symbol。

---

# 9. Quick Agent UX

## 9.1 產品定位

不是 AI 聊天室。

是：

> **一句話 → Planform Tool Actions → Canvas Preview**

AI 必須優先「做事」而不是輸出長篇文字。

## 9.2 手機入口

保持單一輕入口：

`✦ AI 幫我`

打開 compact sheet，第一層最多：

- 📷 建立素材
- 🪑 幫我場佈
- ▶ 模擬活動
- ✨ 幫我優化

以及自然語言輸入框。

不得新增永久 Chat sidebar。

## 9.3 Agent Tool Layer

建立明確工具介面，不允許模型直接任意改 store JSON。

至少：

### Read
- getProjectSummary
- getVenueGeometry
- listAssets
- getSelection
- getZones
- getRoutes
- getValidationIssues
- getSimulationSummary（若 simulation 已存在）

### Asset
- createAssetFromCatalog
- createCustomAssetProxy
- requestAssetReconstruction
- importAsset
- updateAssetMetadata
- replaceAssetVisual

### Layout
- placeAsset
- moveAsset
- rotateAsset
- duplicateAsset
- createArray
- updateArray
- createZone
- updateZone

### Flow
- createRoute
- updateRoute
- createServiceStation
- updateServiceStation

### Analysis
- validateLayout
- measureGap
- simulateScenario
- compareScenarios

### Commit
- previewAgentChanges
- commitAgentChanges
- rollbackAgentChanges

## 9.4 Preview before commit

任何 Agent 造成的多步修改都先進 transient draft。

畫面顯示：

- 新增什麼
- 移動什麼
- 哪些 Validation 改善 / 變差
- Simulation 指標差異（若有）

最後：

- 套用
- 比較原本
- 取消

不得默默大量修改正式 Project state。

## 9.5 一次一句話的核心案例

必須支援：

- 「這張照片做成收費桌」
- 「這裡放兩個報到桌」
- 「報到跟收費分開」
- 「入口旁邊留 1 公尺，不要擋門」
- 「模擬 60 人進場」
- 「哪裡最塞？」
- 「幫我改善」
- 「少一個工作人員會怎樣？」
- 「把這個方案整理成給夥伴看的動線圖」

回答優先使用：

- canvas highlight
- chips
- action cards
- before/after metrics

文字保持短。

---

# 10. AI Provider Architecture

Quick Agent 不綁特定 provider。

建立 provider abstraction：

```ts
interface AgentProvider {
  complete(request: AgentRequest): Promise<AgentResponse>;
}
```

V1 可以支援：

- local mock/provider for deterministic tests
- NVIDIA NIM BYOK adapter
- future OpenAI / other provider adapter

核心布局、Validation、Simulation、Asset metadata 不得因 AI provider unavailable 而失效。

只有 AI 自然語言 / reconstruction 需要 provider。

---

# 11. NVIDIA 的位置

若接 NVIDIA，定位為可選 AI provider：

- natural-language intent parsing
- photo semantic analysis
- candidate plan explanation
- simulation result explanation

不要拿 LLM 做：

- collision math
- route geometry
- queue simulation
- exact object coordinates

幾何與 Simulation 仍交給 deterministic Core。

只有一個使用者時優先：

- BYOK
- free/developer endpoint where allowed
- zero fixed GPU server

不得因本 PR 導入 24/7 GPU infrastructure。

---

# 12. Quick Agent Intent Schema

不要讓 Agent 自由生成任意 JSON。

先建立有限 intent / action schema，例如：

```ts
type AgentIntent =
  | { type: "create-custom-asset"; sourceImageId: string; semanticHint?: string }
  | { type: "place-assets"; assetId: string; count: number; target?: SpatialTarget }
  | { type: "separate-service-flow"; services: ("checkin" | "payment")[] }
  | { type: "simulate"; participants: number; scenarioId?: string }
  | { type: "optimize-layout"; objectives: OptimizationObjective[] }
  | { type: "explain-bottleneck" }
  | { type: "prepare-team-view" };
```

LLM 只負責 intent / parameter extraction。

Tool executor 必須自己驗證：

- permission / action scope
- IDs
- dimensions
- bounds
- placement legality
- schema

---

# 13. Professional Asset Library UX

## 13.1 預設素材卡

手機卡片只顯示：

- thumbnail / plan icon
- 名稱
- 常用尺寸

點一下直接進 placement。

不要先開完整 inspector。

## 13.2 分類

建議：

- 常用
- 場地設施
- 桌椅
- 地墊
- 報到 / 收費
- 引導 / 標示
- 收納
- 我的素材

最近使用自動排在前面。

## 13.3 自訂素材

`我的素材`：

- 拍照建立
- 匯入 GLB/GLTF
- 複製既有素材做變體

修改尺寸 / 用途 / 名稱不需要重新生成模型。

---

# 14. 精緻內建素材優先清單

不先增加大量不相關種類。

先把活動最常用的做專業：

1. 門
2. 投影幕
3. 折疊桌 / 一般桌
4. 報到桌
5. 椅子
6. 地墊
7. 電腦
8. 電燈開關

然後新增與 Event Flow 強關聯的語意素材：

9. 收費桌（可由 table visual variant + service role 實作，不一定新增硬編碼 ObjectKind）
10. 收費箱 / payment equipment
11. 指示立牌
12. 排隊起點 / queue barrier
13. 鞋架 / 收納架

新增素材優先走 Catalog，而不是繼續無限擴充 ObjectKind union。

---

# 15. 3D Website / Open-source Reference Policy

可以研究 GitHub `3d-website` topic 與其他 Three.js projects，但遵守：

- 優先研究互動模式、材質、camera、loading、selection、asset pipeline
- 不直接複製不清楚授權的 3D 模型 / texture
- 每個第三方程式碼 / 模型先確認 license
- 不因某專案視覺漂亮就把 React/R3F 強行搬進目前 vanilla Three.js 架構
- 不把 portfolio-style 特效帶進 field tool

核心仍是目前 Three.js architecture。

每個外部來源若真正導入 production，必須記錄：

- repo/source
- license
- version/commit
- 用途
- 是否修改

---

# 16. Security

## Generated Code

Img2ThreeJS 產生 TypeScript code，因此不能對未驗證來源直接 `eval`。

V1：

- agent worker 生成後進 repo/build pipeline
- compile / lint / static review
- 只允許受控 imports
- 禁止 network / filesystem side effects in asset factory
- factory 必須是 pure-ish model construction

## User Files

- image / GLB 先在 local asset pipeline 處理
- 限制 MIME / file size
- 不執行 GLTF 外部 script
- external URI 要有明確處理策略

---

# 17. Performance Budget

不要追求「越高模越專業」。

建立自動 report：

- triangle count
- draw calls
- material count
- texture memory estimate
- asset binary size

至少提供：

`Standard / Mobile` 是否通過。

大量椅子 / 地墊仍優先 InstancedMesh / shared geometry。

對自訂模型可產生 simplified proxy，Simulation / Plan mode 不需要 detail mesh。

---

# 18. Offline / Failure UX

AI / reconstruction 失效時：

- 手動場佈仍可用
- Smart Layout / Validation / Simulation 仍可用
- 自訂照片至少可建立 simple proxy
- 已下載素材仍可用

顯示：

`精緻模型稍後產生，目前已可用簡化素材排場。`

不要把 AI 失敗變成整個功能失效。

---

# 19. Implementation Sequence

## Phase A — Asset Model Foundation

- Catalog model
- assetId backward compatibility
- migration
- visual source abstraction
- plan symbol abstraction
- IndexedDB asset blob store

## Phase B — Professional Built-ins

- material library
- lighting polish
- built-in asset refinement
- plan symbols
- selection/pick bounds
- Standard/Detail split where valuable

## Phase C — GLB/GLTF

- import
- inspect
- normalize
- optimization pipeline
- thumbnail
- plan symbol
- save local asset

## Phase D — Photo Custom Asset

- photo capture/upload
- semantic proxy immediately
- dimension confirmation
- service role
- reconstruction job contract
- Img2ThreeJS adapter
- visual replacement

## Phase E — Quick Agent

- tool registry
- intent schema
- provider abstraction
- preview/diff transaction
- compact mobile UX
- action cards

## Phase F — Event Simulation Integration

若 PR #9 已合併：

- service role ↔ service station
- agent can create / update stations
- simulation tools exposed to agent
- before/after simulation comparison

若 PR #9 尚未合併：

- 只定義 adapter contract
- 不複製 simulation core
- 之後 rebase / integrate

---

# 20. Tests

至少新增：

## Asset Catalog
- builtin mapping
- custom entry
- v3 project migration
- JSON roundtrip
- missing visual fallback

## Visual normalize
- bounds
- origin
- forward direction
- scale
- footprint

## Import
- valid GLB
- oversize asset warning
- invalid format rejection
- metadata persistence

## Img2ThreeJS adapter
- valid factory manifest
- invalid imports rejected
- normalize generated Group
- replacement keeps object spatial data

## Agent
- intent validation
- tool allowlist
- preview does not mutate committed project
- commit is undoable
- rollback restores state
- AI provider failure fallback

## Mobile
- Quick Agent sheet does not cover most Canvas
- create asset flow usable on 360×800 / 390×844 / 412×915
- selection / placement still works

---

# 21. Browser / Field Acceptance

完整驗收至少跑：

### Case A — 精緻內建素材
1. 開手機
2. 素材庫看到清楚 thumbnail / plan icon
3. 放報到桌、椅子、電腦
4. 3D 看起來專業，但俯視仍清楚
5. 100 椅子 / 地墊不造成明顯退化

### Case B — GLB
1. 匯入一個 GLB
2. 系統分析 / 最佳化
3. 確認尺寸
4. 指定為「收費設備 / 一般家具」
5. 保存成我的素材
6. 重新整理仍存在
7. 放到場地

### Case C — Photo → Custom Asset
1. 拍一張真實桌子
2. AI 建議「桌子」
3. 輸入 180×60×74 cm
4. 指定用途「收費」
5. simple proxy 立即可放置
6. reconstruction 完成後替換精緻 visual
7. 原場佈位置 / route / station 不變

### Case D — Quick Agent
使用者輸入：

`把這張照片做成收費桌，入口右邊放兩張，報到跟收費分開。`

Agent 必須：

- 建素材 proxy
- 建 / 放兩個 service desks
- 不擋門
- 產生 preview
- 顯示改動摘要
- 使用者確認後 commit
- Undo 可完整還原

如果 Simulation available：

再執行：

`模擬 60 人，20 個現場繳費，幫我改善。`

需能跑 simulation → 找瓶頸 → 提出場佈 / 人力 candidate → preview before apply。

---

# 22. Definition of Done

只有同時達成以下才算完成：

1. 素材系統不再綁死固定 procedural 外觀。
2. 現有八種內建素材視覺品質明顯專業化。
3. 俯視 plan symbol 清楚，不依賴高模才能辨識。
4. 可建立自訂素材。
5. 可匯入 GLB/GLTF 並做合理最佳化。
6. Photo → semantic proxy 流程可實際使用。
7. Img2ThreeJS 有明確可執行 adapter / reconstruction workflow，而不是文件上寫名字。
8. 精緻 reconstruction 尚未完成時，proxy 仍能立即排場。
9. Quick Agent 能透過 tool layer 真正操作 Planform，不直接亂寫 store。
10. Agent 多步修改有 Preview / Commit / Rollback / Undo。
11. 手機操作比目前更簡單，不新增永久大型 AI 面板。
12. AI unavailable 時核心場佈 / Validation / Simulation 仍可用。
13. lint / typecheck / tests / build 全部通過。
14. desktop / mobile smoke test 通過。
15. 舊 v3 projects 可升級且不遺失物件。

---

# 23. 明確不做

本階段不要：

- 不做 Blender 級 mesh editor
- 不做 CAD/BIM
- 不做完整 photogrammetry / NeRF
- 不做 3D Marketplace
- 不建立 24/7 GPU server
- 不做真實付款
- 不做人臉辨識
- 不做 CCTV tracking
- 不把 React Three Fiber 強行搬進現有 vanilla Three.js
- 不為了 Asset Engine 重寫整個 App
- 不讓 AI 自己計算精準 collision / coordinates
- 不移除現有 local-first 能力

---

# 24. 外部技術依據

## Img2ThreeJS

Repository:
`https://github.com/img2threejs/img2threejs`

定位：reference image → code-only procedural Three.js model / TypeScript `THREE.Group` factory。

License: Apache-2.0（實作時再次鎖定實際使用 commit / version）。

使用方式：作為 agent-side reconstruction workflow，而非 browser runtime library。

## glTF Transform

Repository:
`https://github.com/donmccurdy/glTF-Transform`

定位：glTF 2.0 JavaScript/TypeScript SDK，用於 read/edit/write/optimize GLB/GLTF。

License: MIT。

## GitHub 3D Website Topic

Reference discovery:
`https://github.com/topics/3d-website?o=desc&s=stars`

只作 UX / rendering / interaction 技術研究來源。任何真正導入的 repo / asset 都必須個別確認 license，不因 topic 收錄就視為可商用素材。

---

# 25. 最終產品原則

> **Professional underneath. Simple on top.**

使用者不需要學習：

- mesh
- material
- geometry
- LOD
- GLTF optimization
- agent tool calling
- discrete event simulation

使用者只需要：

- 拍一張
- 選一個
- 拖一下
- 說一句
- 看 Preview
- 按套用

底層可以很深，但 UI 必須越來越簡單。
