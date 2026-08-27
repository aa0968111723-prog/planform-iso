# Multi-Project System — 架構 Review

執行者：**Claude（Lead，本 session 自審）**。
規格 §18 要求「呼叫已安裝的 Claude CLI 做一次 review」——本容器內沒有安裝、也無法登入
任何外部 CLI（見 `CURRENT_STATE.md` §0），所以這份 review 由當前 Claude 直接執行並誠實標示，
**不冒充第三方 CLI 的輸出**。

Review 對象：`feat/multi-project` 分支相對 `main`（`5cfb4a4`）。

---

## 1. Project / Layout / VenuePreset 的概念有沒有混掉？

| 概念 | 定義 | 存在哪 | 誰擁有 |
|---|---|---|---|
| **VenuePreset** | 場地模板（尺寸、門、投影幕）。不是一場活動。 | `BUILTIN_VENUE_PRESETS` + `planform-iso:venues`（我的場地） | `core/venues.ts` |
| **Project** | 一場活動的完整工作空間。有 stable id。 | `planform-iso:projects:<id>` | `state/projectRepository.ts` |
| **Layout / Snapshot** | 同一個 Project 裡的某一版配置。 | `planform-iso:layouts`（沿用） | `state/store.ts` |

**改前的混淆點（已處理）**：舊 Quick Start 的「我的場地」步驟同時列出
「我的場地模板」與「已存的平面圖」，兩者點下去行為完全不同（一個重排、一個整份載入），
使用者無從分辨。

**處置**：
- 新建專案精靈的「我的場地」**只列 VenuePreset**，named layouts 完全移出這條路徑。
- 編輯器內 named layouts 的標題由「我的平面圖（本機儲存）」改為
  **「這個專案的版本（方案 A／方案 B／最後版）」**，講清楚它是 Project *內部*的版本。

**殘留（誠實記錄）**：named layouts 在儲存層仍是全域的（`planform-iso:layouts`，以名稱為 key），
不是 project-scoped。規格 §7 明講「如果暫時不值得做 project-scoped snapshots，
可以保留現有 named layout 相容能力，但 UI 不要把它叫成另一個專案」——本輪照這條走：
**改 UI 語意、不動儲存結構**。真正的 project-scoped snapshot 列為 1.1。

---

## 2. Migration 安全嗎？

| 風險 | 處置 | 測試 |
|---|---|---|
| 舊的單一 autosave 被無聲丟掉 | `migrateLegacyIfNeeded()` 把它變成一個真的 Project | `projectRepository.test.ts` ×6、`projects.spec.ts` ×1 |
| 舊 key 被刪掉、無法回頭 | **只讀不刪**。`planform-iso:autosave` 與 `:layouts` 原封不動 | 「never deletes the legacy keys」 |
| 重複匯入，每次開機都多一份 | `planform-iso:projects:migrated` 旗標 | 「runs once, not on every boot」 |
| 蓋掉已經存在的專案庫 | 只在 `entries.length === 0` 時匯入 | 「does not import on top of an existing library」 |
| 舊 blob 壞掉 → 匯入垃圾 | 解析失敗就**不匯入**，原 blob 留著 | 「leaves a corrupt legacy blob alone」 |
| 匯入時儲存空間滿 → 旗標已標、資料永遠回不來 | 失敗時**不標** migrated，下次可重試 | 「retries later if storage was full」 |

無名稱的舊檔會叫「我的舊場佈」；有名稱就沿用原名。**符合 §6。**

---

## 3. Storage 會不會遺失資料？

**先量再決定（§14 要求）**：E310 golden 60 人＝ 8.5 KB，空白 0.7 KB。
20 份完整 golden 專案總計 < 1 MB（unit test 實測），localStorage 5–10 MB 綽綽有餘。
二進位資產本來就在 IndexedDB（`blobIds`），JSON body 不會膨脹。
**結論：不引入 IndexedDB。** 這也直接滿足 §14「不要為這件事大改整個 app architecture」。

| 風險 | 處置 |
|---|---|
| 一個 project 壞掉害全部打不開 | body 各自一把 key；`openProject` 回報 `corrupt` 而非 throw；Project Home 照常進得去 |
| index 本身壞掉＝「你沒有任何專案」 | `readIndex` 失敗時掃描 body key **重建**清單 |
| index 裡有一列壞掉 | 過濾掉那一列，其餘照常顯示 |
| 壞掉的內容永遠拿不回來 | 原始 bytes 存進 `planform-iso:corrupt:<id>`，卡片上有「下載原始資料」 |
| 磁碟滿時假裝存成功 | `saveProject` 回傳 `false` → Store 的 `onStorageError` → 常駐 banner；`createProject` 直接 throw，不會留下指向空的卡片 |
| 刪除誤觸 | confirm ＋ 20 秒 Undo bar |
| 刪掉正在開的專案 → autosave 把它復活 | `onDeleted` → `app.detachProject()` 解除綁定 |
| 兩個分頁同時建立、id 撞號 | id 帶亂數尾碼（`prj_<time>_<seq>_<rand>`） |

**已知未解**：兩個分頁開**同一個** project 仍是最後寫入者勝——與 1.0 既有限制相同，
沒有因為多專案而變差。

---

## 4. UI 會不會太複雜？

Project Home 只有：標題、一顆 ＋ 新建專案、一排卡片。
卡片四個動作：開啟／重新命名／複製／刪除。**沒有** dashboard、篩選、排序、標籤、搜尋。

精靈從 2 步變 3 步（多了「命名」）。這是必要的——專案沒有名字就只能用
「未命名平面圖」互相區分，等於回到用 name 當 key 的老問題。
每一步都標了「第 N 步 / 共 3 步」，不會覺得沒完沒了。

**手機**：單欄卡片、無側欄、`＋ 新建專案` 常駐、動作列 36px 觸控高度。
平板兩欄、桌機三欄，純 grid 切換，沒有另一套版面。

---

## 5. 會不會破壞 PR #17 既有的 E310 workflow？

不會，但**流程入口變了**，這是刻意的：

| 之前 | 現在 |
|---|---|
| 開網站 → Quick Start →「E310 演講範例（60 人）」→ **覆蓋**現有場佈 | 我的專案 → ＋新建專案 → 命名 → E310 →「直接用 E310 演講範例」→ **新專案** |

E310 preset、golden scenario builder、巧拼 field、校正三路徑、模擬、場刊圖匯出
**完全沒有改動**——`buildE310GoldenProject` 一行都沒動。改的只是它的結果被放進哪裡。

`fieldEvidence.test.ts`（18 項證據守衛）與 `e310.test.ts` 全數照舊通過。

**一個行為變更值得記錄**：範例的內建名稱「E310 演講活動（範例）」現在會被使用者在
第一步輸入的專案名稱覆蓋。這是對的——使用者剛打的名字應該贏——golden flow 4 已改為
斷言使用者輸入的名稱。

---

## 6. 本次 review 找到並修掉的問題

兩個是我自己寫出來、review 時才抓到的：

1. **`metaFrom` 的 spread 順序**：`...input` 放在推導值之後，`input.participants` 為
   `undefined` 時會把推導出來的人數蓋掉 → 卡片永遠不顯示人數。單元測試抓到。
2. **換場地後卡片仍寫舊場地名**：`venueName` 是 denormalised 顯示欄位，`saveProject`
   原本只更新 `venuePresetId`，導致卡片顯示「E310」但專案已經換成空白場地。
3. **id 撞號**：原本 `prj_<time>_<seq>_<time%1000>`，兩個分頁同一毫秒都會拿到 seq=1。
   加上亂數尾碼。
4. **e2e helper 用 `new Function(...).bind()` 傳給 `addInitScript`**：Playwright 會把函式
   序列化，bound function 變成 `[native code]`，種子專案根本沒寫進去，
   導致 3 個 tablet 測試在 Project Home 覆蓋層上點擊逾時。改用正規的
   `addInitScript(fn, arg)`，並在 `openWorkspace` 加一道
   `waitForSelector(".projhome", { state: "hidden" })`——種子失敗要當場講清楚，
   而不是讓後面的點擊逾時。

---

## 7. 建議延後（不進本次 Release）

- **project-scoped snapshots**：把 named layouts 真正掛到 project 底下（§7 允許延後）
- **Thumbnail 產生**：欄位與渲染都已就緒，只差產圖。§13 明講若影響穩定性可延到 P2 ——
  產一張縮圖要跑一次 `renderConstructionPlan`，成本與時機（何時產、產幾次）需要另外評估，
  本輪不做，卡片以字符佔位。
- **eventDate 的 UI**：repository 已支援 `setEventDate`。卡片「活動日期」與
  分享 → 活動資訊 現在可以填；縮圖自動產圖仍未做。完整清單見
  `docs/PRODUCT_LIMITATIONS.md`。
