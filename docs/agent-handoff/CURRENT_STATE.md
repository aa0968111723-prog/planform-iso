# CURRENT_STATE（Claude Lead checkpoint）

更新：2026-08-29

## 擺攤小物、文宣與背景圖（分支 `feat/booth-props-and-print`）

`src/core/printSpec.ts` 是印刷規格的唯一來源；`src/core/boothPropPresets.ts`
是 19 個 preset（文宣／背景／擺攤小物）。三件事接手前要知道：

1. **印刷品的公尺是從公釐推導的**，不是各自維護。改尺寸只改 `PrintSpec`，
   3D 面板會跟著變。`test/boothProps.test.ts` 斷言兩者一致。
2. **方向只在 `specFromStandard` 轉一次。** `metersFromTrim` 不轉。
   兩邊都轉的話 180×60 的桌前布條會變成 60×180——轉兩次等於沒轉，
   只是數字互相打架。
3. **`test/boothProps.test.ts` 有一條控制字元守衛。** 產生程式碼時寫的
   `` 曾經在原始碼裡變成真的 backspace（0x08），regex 因此永遠不 match
   而且完全不報錯（A5 讀不到）。那條測試掃描整個 `src`，任何低於 0x20 的
   字元（tab 與行尾 CR 除外）直接失敗。**不要為了方便把它關掉。**

送印清單在 `printOrderLines()`，只算實際放進場的道具。

4. **`PropPart.imageBlobId` 以前是假的。** 註解說會畫在正面、plane 分支也
   檢查了它，然後畫 text——場景層根本沒有任何地方讀 blob store。
   現在 `propVisual.ts` 的 `artworkTexture()` 會非同步載入並換上 map，
   讀不到就保留彩繪文字。改這一段時記得：**場景圖是同步建的，
   載圖是非同步的**，所以一定是「先建 fallback、再換 map」。
   `setPropArtwork` 工具會 bump 版本號，不 bump 的話已放在場上的道具
   不會重建。

## 最新一輪：完整空間規劃 Agent（分支 `feat/full-planform-spatial-agent`，未 merge）

從 `origin/main` 開的分支。四件事：

1. **Perplexity 研究 15 題、310 個來源** → `docs/research/spatial-design/`。
   `sources.json` 記錄每題實際讀到的網址與來源分級；`knowledge.json` 由
   `src/core/spatialKnowledge.ts` 產生（不要手改）。研究**沒查到**什麼寫在
   README 裡，那部分比查到的重要。
2. **`src/core/spatialPlanner.ts`** — A/B/C 三種策略的排版引擎。每個方案都用
   `validateProject` 與 `runDiscreteEvent` 量測，跟手動編輯同一套。
3. **Agent 工具層從 33 個名字變成 76 個實作**。原本六個工具回 `ok: true`
   卻什麼都沒做（`updateZone` / `updateRoute` / `updateArray` /
   `updateAssetMetadata` / `createArray` / `measureGap`）。
4. **自然語言拆成四段**：normalize → extractSlots → classify →
   planFromRequest。前三段不需要專案，可獨立測試。

### 接手的人要知道的四件事

1. **明講的要求是限制條件，不是權重。** 使用者說「收費另外分流」時，
   共用桌方案 `eligible: false`，不能被推薦也不能被 `RECOMMENDED_SCHEME`
   選中。加權只能在都符合要求的選項之間排序。這一條是自我審查抓到的——
   在那之前引擎會推薦一張共用桌給剛說要分流的人。
2. **只有一個地方決定要套用哪個方案。** planner 曾經有自己的
   「目標→方案」對照表，跟引擎的實測推薦打架，使用者會同時讀到
   「推薦 C」和被套用的 B。那張表已經刪掉。
3. **cue regex 跑的是正規化後的文字。** 寫「推薦一個」永遠配不到，因為
   「一」已經變成「1」。`test/agentIntent.test.ts` 會把每條 cue 的字面選項
   抽出來斷言 `normalize(literal) === literal`。
4. **`test/agentExecutor.test.ts` 最後一條斷言是覆蓋率檢查**：
   TOOL_SPECS 裡任何沒被測試呼叫過的工具都會讓測試失敗。加工具就要加測試。

### 這一輪的 gate 狀態

| Gate | 結果 |
|---|---|
| lint / typecheck / build | PASS |
| `npm run test` | 982 tests / 78 files PASS |
| `npm run test:e2e` | 137 tests PASS（12.1 分鐘） |
| 既有 723 個測試 | 零回歸，未修改任何既有 fixture |

### 第二輪補的四件事

1. **`requiredAssets`**——第五節列的「需要的素材」原本只做了座位，
   被我誤標成「已知限制」。那是把未完成的需求重新貼標籤。現在會解析
   「要三張長桌」並在方案佔完空間後放進剩餘空間，放不下就報數量。
2. **排隊區與工作人員站位**畫出來了。空間本來就保留（serviceBand），
   只是沒畫。用 `type: "custom"`，不新增 ZoneType（那等於改資料格式）。
3. **迴轉空間改成真的量圓**。原本是「距離門小於直徑一半」——錯的形狀
   放在錯的中心。新增 `pointToRectDist`。
4. **回頭追法規原文**（研究題目 16–19）。三條升到 high，
   修正了一個已出貨的錯誤（120 與 130 公分是不同條文），
   NFPA 刻意維持 medium 因為原文付費讀不到。
5. **攤位排版**（`src/core/boothLayout.ts`）。三種策略用真實攤位家具；
   容量改用站立係數且 capacity 權重歸零（同時站 6 人 vs 一下午來 40 人
   是類別錯誤）；「不能阻擋主要通道」成為硬性限制。

### 接手時最容易誤解的一點（補充）

**攤位不是小房間。** `buildersFor(b)` 依 `eventType` 分流到兩組完全不同的
builder。改室內邏輯不會影響攤位，反之亦然。攤位方案沒有 groups（座位陣列）
是刻意的，不是漏掉。


## 最新一輪：通用互動流程系統（PR #19，未 merge）

**環境**：使用者的 Windows 機器，`D:\planform-iso`。本機檔案讀得到
（`D:\柏能資料\02_Club_淡大禪學社\`），Playwright 跑得動，dev server 跑得動。
`grok` CLI 1.0.5 可執行；`claude` CLI 可執行但未登入，**沒有冒充它的輸出**。

### 這一輪做完的事

`docs/INTERACTION_FLOW_PLAN.md` 的 8 個 Step 全部完成：

| Step | 內容 |
|---|---|
| 1 | parity fixture 先進版（`test/fixtures/e310-des.json`，六組跑法） |
| 2 | `model.ts` 的互動型別 |
| 3 | `interactionCompile.ts` 編譯器（純函式） |
| 4 | `runInteraction` 引擎；`runDiscreteEvent` 變四行包裝，**fixture 零改動** |
| 5 | `templateFromBooth` / `migrateInteraction` / `interactionPresets.ts`（心情 OK 蹦） |
| 6 | `flowPanel.ts` 一個面板取代兩個；**刪掉 `boothFlow.ts` / `boothSimPanel.ts` / `simPanel.ts`** |
| 7 | 場刊「互動流程」一頁 ＋ `state/templateLibrary.ts` |
| 8 | 教室的「改成我自己的流程」＋ AI adapter 走互動流程 |

### 現在的 gate 狀態

| Gate | 結果 |
|---|---|
| lint / typecheck / build | PASS |
| `npm run test` | 527 tests / 53 files PASS |
| Playwright（全部，含 production project） | 119 PASS / 0 FAIL |
| parity fixture | 零改動通過 |
| 變異測試 | 新行為 26 個變異全部被擋下 |

### 接手的人要知道的三件事

1. **`boothFlow.ts` 不存在了。** 攤位的資料（站台型別、dwell、skip rate、
   preset）搬到 `core/boothCatalog.ts`，語意逐字不變。`project.booth` 區塊
   仍會寫進檔案、仍會被舊版 build 讀，但**新程式碼不再讀它跑模擬**——
   `project.interaction` 一旦存在就永遠勝出。
2. **parity fixture 是這個重構的憲法。** `test/eventFlowParity.test.ts` 一旦
   變紅，就是教室的數字動了。**改 fixture 之前先確定你知道為什麼**，並在
   commit message 寫清楚；「測試失敗」不是理由。
3. **心情 OK 蹦的內容有出處，時間沒有。** 流程／題目／選項／16 句金句取自
   社團自己的企劃書（`淡大擺攤區`，2026-02-14）；每一步的秒數與人流是估計值，
   寫在 template 的 `note` 裡，面板與場刊都會印出來。**不要把它們當成量過的。**

### 稽核清單重驗（2026-08-28 下午）

原稽核的 19 P1 / 23 P2 / 11 P3 **全部拿去對照今天的樹重驗過**（九組平行 + 一個
用真 Chromium 跑重現的 critic）。結果：

| | 已修好 | 仍成立 | 架構不存在／不成立 |
|---|---|---|---|
| P1 | 9 | 10（**已全數修掉**） | 0 |
| P2＋P3 | 10 | 21（修 6 條，其餘刻意留著） | 3 |

**接手的人最需要知道的一條：**「重驗」不是形式。19 條 P1 裡有 9 條已經不成立，
而 critic 又找出兩條驗證者用「這個 repo 沒有 DOM 測試環境」帶過、實際上在
Chromium 裡一秒就能重現的。**先重現，再修。**

留著沒修的 15 條 P2/P3，每一條的理由與風險（特別是「會不會動到
`test/fixtures/e310-des.json`」）都記在 PR #19 的討論與這一輪的 commit message 裡。
其中一條是**看過算圖之後決定不修**的：背包該放在課桌椅上，抬高之後變成穿過椅子，
因為 `buildZoneProps` 只知道 zone 矩形。理由寫在該處程式碼註解。

### 兩個這一輪學到的操作教訓

1. **e2e 跑的時候不要改 `src/`。** dev server 會 HMR，Playwright 會拿到
   「Execution context was destroyed」——看起來像是真的失敗。這一輪踩了兩次。
2. **變異測試會騙人，如果測試沒對準機制。** 排隊夾限與車道繞回兩條修正，
   單獨拿掉任何一條測試都還是綠的（另一條蓋掉了）。要分別找出每一條**唯一**
   會咬到的幾何（靠牆的站台 / 走廊口），測試才算數。

### 還沒做的

- 真手機 GPU／觸控 smoke（需要實機）
- production URL 與 PWA 驗證（需要部署環境）
- Claude CLI 獨立審稿（本機未登入）
- 稽核剩下的 P2 / P3（清單在 scratchpad `audit.json`，非阻擋項）

---

# 以下為 2026-08-21 的紀錄（多專案系統那一輪），保留備查

# CURRENT_STATE（Claude Lead checkpoint）
更新：2026-08-21 12:1x

## 0. ⚠ 環境 — 接手者必讀

本輪 Claude Lead 在 **Claude Code on the web 的 Linux 雲端容器**執行
（`/home/user/planform-iso`，ephemeral），**不是**使用者的 Windows 機器。

以下在本環境內做不到，且**沒有假裝做到**：

| 項目 | 實測結果 | 誰能解 |
|---|---|---|
| 本機真實照片／場刊圖盤點 | `D:\場務場刊E310`、Documents/Pictures/Downloads/Desktop 都不存在；全機掃描只找到 repo 自己的匯出 PNG | 使用者跑 `scripts/audit-local-references.ps1` |
| Production 實測 `planform-iso-k7d2.zeabur.app` | egress proxy 回 **403 CONNECT**，完全連不到 | 使用者放行網域，或本機跑 `node scripts/prodSmoke.mjs https://planform-iso-k7d2.zeabur.app` |
| Codex CLI / Grok CLI / Claude CLI | 皆未安裝。npm registry 可通（codex 裝得起來但需互動式登入）；**`x.ai` 被擋，Grok 連下載都不行** | 使用者在本機安裝並登入 |

→ Codex／Grok／Claude-CLI 的角色由當前 Claude 直接承擔，並在
   `GROK_FINDINGS.md`（Round 4）與 `MULTI_PROJECT_REVIEW.md` 明確標為
   **Claude-run**，不冒充第三方工具的輸出。

## 1. Release 1.0 已 merge

- **PR #17 已於 2026-08-21 09:49Z 由使用者本人 merge**（`merged_by: aa0968111723-prog`）。
  head `6d93c78` → main `5cfb4a4`，52 commits / 95 files。
- 一個 merged PR 不能再接新 commit，所以後續工作走新分支。
- **Production Gate 仍未通過**（環境不可達，見 §0）。merge 後 Zeabur 會自動部署 main，
  請開 `/version.json` 確認 `commit = 5cfb4a4926af6f3902d8d42bf5ad2252710bfae8`。

## 2. 目前工作：Release P0「真正的多專案系統」

- 分支 `feat/multi-project`，base `main` @ `5cfb4a4`
- 起因：使用者檢查後指出 Quick Start 仍是 **replace current plan**，
  Store 仍是 single active project + 一把全域 autosave —— 不算真正的新建專案系統。

### 架構決定（不重寫既有 core）

| 層 | 職責 |
|---|---|
| `core/*`（geometry / simulation / assets / export） | **完全沒動** |
| `state/store.ts` | 仍然只管「現在正在編輯的那一份」，多了 `bindProject` / `openBoundProject` |
| `state/projectRepository.ts`（新） | 多專案：id、metadata、active pointer、migration、recovery |
| `ui/projectHome.ts`（新） | 我的專案（卡片式，1／2／3 欄） |
| `ui/quickStart.ts` | 從「覆蓋式 Quick Start」改為「新建專案精靈」（命名 → 場地 → 需求） |

### Storage（先 audit 再決定，依 §14）

實測大小：E310 golden 60 人 **8.5 KB**、quickStart 4.5 KB、空白 0.7 KB。
20 份完整 golden 專案 < 1 MB（unit test 實測），localStorage 5–10 MB 夠用；
二進位資產本來就在 IndexedDB（`blobIds`）。**結論：不引入 IndexedDB。**

```
planform-iso:projects:index     卡片 metadata
planform-iso:projects:<id>      一份場佈
planform-iso:active-project     要 resume 哪一個
planform-iso:autosave           舊版（只讀不刪）
planform-iso:layouts            舊版 named layouts（保留）
```

一個 body 一把 key，是「A 的存檔不可能蓋到 B」的實體保證，不是口頭承諾。

## 3. 規格逐項（使用者 §1–§21）

| # | 要求 | 狀態 |
|---|---|---|
| 1 | Project Home 我的專案／＋新建專案／卡片 | ✅ |
| 2 | 新建專案：名稱 → 場地 → 需求 → 建立專案 | ✅ 三步，每步標「第 N 步／共 3 步」 |
| 3 | stable unique project id，不用 name 當 key | ✅ `prj_<time>_<seq>_<rand>` |
| 4 | ProjectRepository（list/create/open/save/rename/duplicate/delete/recent） | ✅ |
| 5 | per-project autosave | ✅ 一 body 一 key |
| 6 | 舊資料不能消失 | ✅ 舊 autosave → 專案；舊 key **只讀不刪** |
| 7 | Named Layouts 與 Projects 分清楚 | ✅ UI 語意改為「這個專案的版本」；儲存層沿用（§7 允許） |
| 8 | 編輯器永遠能回專案首頁 | ✅ `← 我的專案` 在手機／平板／桌機 topbar 都在，點擊先 flush |
| 9 | 新建專案入口永遠存在 | ✅ Home 常駐 ＋ 更多 →「＋ 新建專案」（不覆蓋目前 project） |
| 10 | 刪除安全 | ✅ confirm ＋ 20 秒 Undo；刪掉正在開的會 detach，不白屏 |
| 11 | 複製專案 | ✅ 整份複製，改完不影響原本 |
| 12 | Template 與 Project 分離 | ✅ VenuePreset 只在「我的場地」出現 |
| 13 | Thumbnail | ⏸ 欄位與渲染就緒，**產圖延後**（§13 允許，避免影響穩定性） |
| 14 | local-first，先 audit 再決定 | ✅ 見上，維持 localStorage |
| 15 | Project Recovery | ✅ 一份壞掉不影響其他；卡片顯示「這份專案需要復原」＋可下載原始資料 |
| 16 | E310 驗收（A/B/C 三專案獨立、reload、reopen） | ✅ `e2e/projects.spec.ts` |
| 17 | 手機／平板 Project Home | ✅ 1／2／3 欄，無 sidebar |
| 18 | Claude Review | ✅ `MULTI_PROJECT_REVIEW.md`（**Claude 自審**，CLI 不可用） |
| 19 | Grok Blind Test | ❌ 環境不可達（§0） |
| 20 | Tests | ✅ 見 §4 |
| 21 | Release Gate | 見 §4 |

## 4. 品質基線（本地實跑）

```
npm run lint       ✅
npm run typecheck  ✅
npm run test       ✅ 286/286（242 + 44 多專案）
npm run build      ✅
npm run test:e2e   ✅ 89/89（74 + 15）
prodSmoke（本機 preview）✅ 16/16
prodSmoke（zeabur）      ❌ 網域不可達
```

⚠ **prodSmoke 本機是跑得動的，別再當成「不可達」跳過。**
CI 的 `gates` job 用的是 `node scripts/prodSmoke.mjs http://localhost:4173`，
只有指向 zeabur 的那一次才受 egress 影響。本容器跑法：

```
npm run build
npx vite preview --port 4173 --strictPort &
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
  node scripts/prodSmoke.mjs http://localhost:4173
```

我第一次推 PR #18 就是因為漏跑它而讓 CI 紅了一次（`73b664a`）——
`prodSmoke` 還在點舊精靈的「淡江教室模板」第一步。已於 `14a6053` 修好。

新測試：`test/projectRepository.test.ts`（35）、`test/storeRecovery.test.ts` +4、
`e2e/projects.spec.ts`（12）。最重要的一條是
**「a new project never replaces the one before it」**。

## 5. Review 時自己抓到並修掉的四個問題

詳見 `MULTI_PROJECT_REVIEW.md` §6：`metaFrom` spread 蓋掉推導人數、換場地後卡片顯示舊場地名、
兩個分頁同毫秒 id 撞號、e2e seed 用 bound function 導致 `addInitScript` 種不進去。

## 6. 待辦

1. ~~e2e 全綠 → push → 開 PR~~ 完成：**PR #18**（draft），head `14a6053`
2. **使用者端**：`audit-local-references.ps1`、放行 production 網域或本機跑 prodSmoke、
   Grok/Codex CLI 登入
3. 1.1 候選：project-scoped snapshots、thumbnail 產生、eventDate 的 UI、
   R-06 家族／小組座談座位形態

## 7. 環境備忘

- Linux 容器、node 22；Chromium 在 `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
- 跑 e2e：`PLAYWRIGHT_CHROMIUM_EXECUTABLE=<上述路徑> CI=1 npx playwright test`
  （**先確認 5183／4180 沒被佔**，`CI=1` 會拒絕重用既有 server）
- egress proxy 白名單外一律 403：`registry.npmjs.org` 通，`x.ai`／zeabur 不通
- production build 的 debug hook 需要 `?e2e` query flag 才會掛上 `window.planform`
- e2e helper：`openWorkspace` 會種一個專案直接進編輯器；`openProjectHome` 從空的專案庫開始

## 8. 2026-08-23：#18 已 merge，#19 的處置與後續修補

- **PR #18 已於 2026-08-23 21:23:39Z 由使用者本人 merge**（main = `654d039`）。
  merge 前 21:23:15Z 先把 draft 拿掉；CodeRabbit 因此從
  `Review skipped: draft pull request` 變成
  `Review skipped: manual review required for this OSS repository`
  （這個 repo 星數 < 10，不會自動 review，要留言手動觸發）。

- **PR #19 是另一個 session（`session_016yiNyVEh37ZM98thZ7iQ7y`）在
  `release/planform-1.0-rc` 上做的同一份規格**，#18 merge 之後對 main 產生衝突：
  14 個檔案，其中 5 個是 **add/add**（`src/state/projectRepository.ts`、
  `src/ui/projectHome.ts`、`e2e/projects.spec.ts`、`test/projectRepository.test.ts`、
  `docs/agent-handoff/MULTI_PROJECT_REVIEW.md`）。
  這不是一般的 conflict —— 是**同一個子系統的兩套實作**（`planform-iso:projects:<id>`
  對上 `planform-iso:project:{id}`，兩套 migration、兩個 Project Home）。
  「解衝突」在這裡等於「選一套」，不是把兩邊縫起來。

### #19 的 8 個 review finding，逐條對 main 驗證

| # | #19 的說法 | 對 main 成立？ |
|---|---|---|
| 1 | 連刪兩個，第一個永久遺失 | ✅ **成立** — `projectHome.ts` 只有一個 `lastDeleted` 槽 |
| 6 | AI 預覽跨專案套用 | ✅ **成立** — 已用 e2e 實測看到預覽列出現在下一個專案的編輯器上 |
| 7 | `hasContent` 漏了 measurements／scenarios | ✅ 成立（較輕）— 只有尺寸線的專案不會跳確認 |
| 2 | boot 失敗時儲存橫幅不出現 | ❌ 不成立 — main 每次寫入失敗都會 `onStorageError` |
| 3 | 兩分頁 flush index 互蓋 | ❌ 不成立 — main 每次寫前都重讀 index |
| 4 | 精靈送出鈕沒防連點 | ❌ 不成立 — `overlay.remove()` 先執行 ＋ `.quickstart` 存在就不再開 |
| 5 | `autoKeepName()` 撞名覆蓋 | ❌ N/A — main 沒有載入前自動存檔這條路徑 |
| 8 | 從 Home 開啟時鏡頭框錯 | ❌ N/A — main 開啟專案時根本不重新框 |

→ 成立的三條已修在 `claude/planform-1-0-rc-release-8iph8h`，
   兩條資料遺失級的都附 e2e，並**實測「拿掉修法就會紅」**。

### 順手修掉的既有 flake

`e2e/helpers.ts` 的 `settle()`：舊版在 350ms 取一次「期望位置」再等面板回到那個值。
若當下面板還在動，取到的是它經過、之後再也不會回去的中間值 → 5 秒超時。
完整跑一輪時 `Golden Flow 1` 就是這樣紅的（#19 也記錄到同一條）。
改成**連續兩次讀值相同**才算穩定。

### 本輪品質基線（本容器實跑）

```
lint ✅  typecheck ✅  test ✅ 290/290  build ✅
e2e ✅ 91/91   prodSmoke（本機 preview）✅ 16/16
```
