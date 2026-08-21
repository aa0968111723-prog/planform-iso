# CURRENT_STATE（Claude Lead checkpoint）

更新：2026-08-21 11:1x

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
npm run test       ✅ 278 → 281（+38 多專案）
npm run build      ✅
npm run test:e2e   （執行中）
production smoke   ❌ 不可達
```

新測試：`test/projectRepository.test.ts`（35）、`test/storeRecovery.test.ts` +4、
`e2e/projects.spec.ts`（12）。最重要的一條是
**「a new project never replaces the one before it」**。

## 5. Review 時自己抓到並修掉的四個問題

詳見 `MULTI_PROJECT_REVIEW.md` §6：`metaFrom` spread 蓋掉推導人數、換場地後卡片顯示舊場地名、
兩個分頁同毫秒 id 撞號、e2e seed 用 bound function 導致 `addInitScript` 種不進去。

## 6. 待辦

1. e2e 全綠 → push `feat/multi-project` → 開 PR（#17 已 merge，不能重用）
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
