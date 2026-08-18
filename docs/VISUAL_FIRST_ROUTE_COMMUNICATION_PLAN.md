# Planform ISO — Visual-first Layout & Route Communication Plan

## 產品定位

Planform ISO 的核心不是做成複雜 CAD / 3D 編輯器，而是：

> **讓活動夥伴快速看懂場佈怎麼擺、動線怎麼走，並能用手機快速查看與操作。**

本階段優先順序：

1. 視覺理解速度
2. 動線與區域可讀性
3. 手機現場可用性
4. 快速場佈
5. 可直接分享給夥伴的輸出

技術精細度、專業參數與 3D 寫實度都排在上述目標之後。

---

## 與既有 PR 的關係

- PR #5：素材 / Placement / Array / Validation 基礎，保留。
- PR #7：Measure / Validation 2.0 / Construction Plan 2.0，保留。
- PR #8：Mobile-first workspace rewrite，**手機 shell、Bottom Sheet、Context Bar、gesture 等由 PR #8 負責**。

本 PR 不與 #8 搶手機 shell；本 PR 定義的是「手機重構完成後，產品要呈現什麼內容與工作流」。

若 #8 尚未合併，實作本規格時應先 rebase / 對齊 #8，避免重複修改 mobile shell。

---

# 1. 主工作流簡化

一般使用者第一層只保留三個主要任務：

- **場地**：教室、走廊、門、投影幕、地磚、尺寸 / 校正
- **場佈**：功能區、桌椅、報到桌、電腦、地墊 / 排列
- **動線**：入場、報到、鞋子、背包、入座、小組移動、工作人員、自訂

Validation、Measure、Share/Export 保留，但降為輔助層，不與三個主工作流搶首屏。

---

# 2. 俯視圖優先

- 新專案與一般檢視預設以 **Top / Plan View** 為主。
- 3D 等角視圖保留為「3D 示意」，不是主要閱讀方式。
- 俯視圖必須比 3D 更清楚呈現：門、開門弧、投影幕朝向、桌椅方向、地墊編號、區域、動線。

---

# 3. 團隊 / 夥伴檢視模式

新增一個可快速切換的「夥伴檢視」：

- 隱藏 Inspector、選取框、Ghost、編輯節點、Debug 資訊
- 自動切俯視
- 顯示活動 / 平面名稱
- 顯示區域大標籤
- 顯示主要素材
- 顯示動線與圖例
- 可一鍵聚焦某一條動線或某一個工作分區

目標：沒用過 Planform 的夥伴也能在 5–10 秒內看懂。

---

# 4. Route Visual 2.0

動線從一般 polyline 升級為核心視覺元素。

每條 Route 至少支援：

- routeType
- name
- color
- start marker
- end marker
- 明顯粗線
- 方向箭頭
- waypoint / step 編號
- visible
- emphasis / focus

Route preset：

- entry
- registration
- shoes
- backpack
- seating
- group
- staff
- custom

預設色 / icon 可依類型給值，但使用者可修改。

---

# 5. 動線焦點模式

點一條動線後：

- 強調該 Route
- 保留相關門、區域與必要素材
- 其他家具 / 區域降低 opacity
- 顯示步驟順序，例如：`①入口 → ②鞋子 → ③報到 → ④背包 → ⑤地墊區`

此模式同時用於：

- 現場說明
- 手機查看
- 團隊分享
- 動線匯出圖

---

# 6. 區域視覺化

Zone 不只是一塊半透明矩形。

每個區域至少要有：

- 大名稱
- 短用途 icon / symbol
- 清楚邊界
- 半透明底色
- 可選 capacity / 人數

區域層在「夥伴檢視」中必須比一般家具更容易辨識。

---

# 7. 素材圖解化

優先改善 **Plan View representation**，不要把工時都花在 3D 寫實。

- 地墊：真實比例矩形，可顯示編號
- 椅子：可辨識座位方向
- 桌子：簡潔桌面輪廓
- 報到桌：有「報到」語意
- 電腦：桌面設備符號
- 門：門洞 + 門片 + 開門弧
- 投影幕：幕面 + 朝向
- 開關：清楚牆面符號

---

# 8. 地墊快速排列器

把 ArrayGroup 能力包成一般人看得懂的快速流程。

輸入：

- 人數
- 每排張數或自動
- 地墊尺寸
- X / Z 間距
- 是否中央走道
- 走道寬度
- 朝向（例如投影幕）

即時顯示：

- rows × cols
- 實際數量
- 占用尺寸
- 主要走道寬度
- 是否超界 / 擋門 / 違反目前 Validation settings

確認後才套用。

---

# 9. Smart Layout Engine（本地、無 AI 也能用）

建立純 TypeScript 的候選場佈引擎。

Input 至少：

- participants
- item / mat dimensions
- minAisle
- facing target
- reserved zones
- door clearance
- room bounds

Output：

- 2–3 個 candidate layouts
- rows / cols
- footprint
- aisle result
- warnings
- validation summary

所有幾何與場佈運算由 Planform Core 負責，不依賴 LLM。

---

# 10. 簡單動線模擬

新增 `▶ 模擬動線`，目的是溝通，不是做遊戲或高精度 crowd simulation。

V1：

- marker / 簡單人形沿 Route waypoint 移動
- 單人 / 小組 / 連續進場
- 固定基本速度
- 可設定生成間隔
- waypoint 可短暫停留
- 可暫停 / 重播 / 重設

需顯示簡單壅塞提示：

- marker 在局部過度集中
- Route 經過過窄走道
- Route 與另一主要 Route 明顯交叉

不要加入重型物理引擎。

---

# 11. Route ↔ Zone 語意關聯

Route 可選擇：

- startZone / startAnchor
- endZone / endAnchor
- waypoint zones

當相關 Zone 被大幅移動時，提示使用者重新檢查 / 調整 Route，不要 silently 當作仍然合理。

---

# 12. 夥伴任務圖

在既有 Construction Plan 基礎上新增「分享給夥伴」導向的 preset：

- 場佈總覽
- 動線圖
- 地墊 / 座位圖
- 報到組圖
- 引導組圖
- 生活組 / 工作人員圖

各 preset 只保留相關內容，其他元素淡化或隱藏。

例如「引導組圖」優先顯示：入口、鞋子、背包、座位、相關 Route。

---

# 13. Share-first 文案

一般 UI 第一層使用「分享 / 給夥伴」，不要用工程語氣主導。

優先 action：

- 場佈總覽
- 動線圖
- 地墊圖
- 工作分區圖
- 3D 示意

JSON 備份保留，但放到進階 / 更多。

---

# 14. 一鍵簡化顯示

提供 `簡化顯示`：

- 隱藏次要尺寸
- 淡化非必要家具
- 隱藏小型設備（視情境）
- 強調 Zone + Route + 入口 / 門

目的是快速拿手機給夥伴看，不需要先手動開關很多 layers。

---

# 15. AI Agent 預留，但不是本 PR 的必要依賴

未來 AI Agent 只做：

- 自然語言理解
- 呼叫 Smart Layout / Route / Validation tools
- 產生候選方案與解釋

不要讓 LLM 負責精確幾何計算。

本 PR 的 Smart Layout、Route Simulation、Visual Focus 必須在沒有 AI API 時完整可用。

---

# 16. 不做

- 不做 CAD / BIM 化
- 不加大量專業參數到第一層
- 不加舞台、音響、麥克風、檀香、三色光
- 不做重型 crowd physics
- 不為了視覺化重寫 Three.js 核心
- 不破壞 local-first / PWA / offline / Undo / JSON / migration
- 不重新實作 PR #8 已負責的 mobile shell

---

# 17. Definition of Done

使用真實活動場佈流程驗收：

1. 打開專案首先能清楚看到俯視場地
2. 建立 / 載入教室、門、投影幕、區域
3. 輸入 30 人，快速得到 2–3 個地墊候選配置
4. 選一個方案套用
5. 建立「入口 → 鞋子 → 報到 → 背包 → 入座」動線
6. 路線有清楚箭頭、起終點與步驟
7. 可只聚焦該動線，其餘內容淡化
8. 可播放簡單 route simulation
9. 若出現過窄 / 交叉 / 壅塞風險，要能被看見
10. 切換夥伴檢視後，不懂編輯器的人仍能快速理解
11. 可匯出場佈總覽、動線圖、地墊圖與至少一種工作分區圖
12. Desktop 不 regression；手機整合 PR #8 的 Canvas-first 工作區
13. lint / typecheck / test / build 全通過

最終判定原則：

> **視覺理解速度 > 功能數量**
>
> **現場實用 > 技術炫技**
>
> **動線與場佈溝通 > 3D 建模複雜度**
