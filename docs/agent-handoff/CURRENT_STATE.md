# CURRENT_STATE（Claude Lead checkpoint）

更新：2026-08-21 08:0x · 環境已更換（見 §0）

## 0. ⚠ 環境變更 — 接手者必讀

本輪 Claude Lead **不是**在使用者的 Windows 機器上執行，而是在
**Claude Code on the web 的 Linux 雲端容器**（`/home/user/planform-iso`，ephemeral）。

以下三件事**在本環境內做不到**，且**沒有假裝做到**：

| 項目 | 實測結果 | 誰能解 |
|---|---|---|
| 本機真實照片／場刊圖盤點 | `D:\場務場刊E310`、Documents/Pictures/Downloads/Desktop 都不存在；`/mnt/user-data`、`/mnt/attach` 皆空；全機掃描只找到 repo 自己的匯出 PNG | 使用者在自己機器跑 `scripts/audit-local-references.ps1` |
| Production 實測 `planform-iso-k7d2.zeabur.app` | egress proxy 回 **403 CONNECT**，完全連不到 | 使用者放行網域，或本機跑 `node scripts/prodSmoke.mjs <url>` |
| Codex CLI / Grok CLI | 皆未安裝。npm registry 可通（codex 裝得起來但需互動式登入）；**`x.ai` 被擋，Grok 連下載都不行** | 使用者在本機安裝並登入 |

→ 本輪 Codex 與 Grok 的角色由 Claude 直接承擔，並在 `GROK_FINDINGS.md`
   Round 4 明確標為 **Claude-run pass**，不冒充 Grok 實測。
   **Production Gate 尚未通過。**

## 1. 狀態：PR #17 持續推進（不 merge）

branch `release/planform-1.0-rc`，base `main` @ `86fe454`。本輪 commits：

| commit | 內容 |
|---|---|
| `5af6883` | docs(field-research)：誠實盤點＋evidence mapping＋禪學社真實需求＋PS1 盤點腳本 |
| `fda1a6e` | feat(visual)：Light Visual Mode 預設＋模擬真人形＋巧拼改綠 |
| `d40cb7f` | docs(handoff)：記錄容器環境與三個阻斷 |
| `fa8df82` | fix(e310)：到達窗 20 分鐘＋物資清單寫真實物資名 |
| `9f2807b` | fix(ux)：幫我改善的 Before/After＋測試瀏覽器 UTF-8 locale |
| `7e03d7b` | fix(export)：場刊圖可讀性（標題最後畫、白色光暈、圖例補進手機版） |

## 2. Release Gate 逐項

| 要求 | 狀態 |
|---|---|
| 讀完四份指定文件與 PR #17 全部內容 | ✅ |
| `LOCAL_REFERENCE_AUDIT.md` | ✅ 誠實版（含「找不到」的明確聲明與可重現指令） |
| `REFERENCE_MAPPING.md` | ✅ V/M/S/F/E 全部標 source＋confidence |
| `TKU_ZEN_REAL_WORLD_REQUIREMENTS.md` | ✅ R-01..R-12 含未做項目 |
| 地墊真實性（顏色／規格／密度／朝向／走道／前留空） | ✅ 顏色改綠；其餘沿用照片推導值並在 MAPPING 標明 |
| 真實物資核對 | ✅ 已列表；S-04/06/07/08/09 標 `estimated`／`medium` 待現場覆核 |
| Light Visual Mode 預設、Dark 保留 | ✅ |
| Editor / Simulation / Partner / Export 同一套視覺語言 | ✅ 場景色＝匯出器紙面色；3D 匯出頁不再黑底 |
| 人流動畫真的看得到人 | ✅ 1.7 m 人形、InstancedMesh、依狀態上色、面向行進方向 |
| 30 / 60 / 100 人 | ✅ 三個 viewport 各跑過；60 人播放中同時最多 14 人 |
| 模擬結果人話四行＋進階收合 | ✅（既有）|
| ✦ 幫我改善 Preview→Validate→Simulate→Compare→Confirm→Commit | ✅ 既有鏈；本輪補上可見的 Before/After |
| 60 人＝40 已繳／20 現場繳／20 分鐘到達 | ✅ |
| 場刊圖手機可讀、可直接傳 LINE | ✅ 本輪大修（見 GROK_FINDINGS R4-1..R4-7） |
| ①②③ 步驟 | ✅ 夥伴觀看圖有 起→②③④⑤⑥→終 |
| E310 尺寸不謊稱實測 | ✅ 維持「待現場校正」＋三路 30 秒校正 |
| **Grok 盲測 production** | ❌ 環境不可達 |
| **Production SHA / PWA / offline 驗證** | ❌ 環境不可達 |

## 3. 品質基線（本地實跑，非引用）

```
npm run lint       ✅
npm run typecheck  ✅
npm run test       ✅ 239/239（原 196 + 新 43）
npm run build      ✅
npm run test:e2e   ✅ 72/72
```

新測試：`test/crowd.test.ts`（13）、`test/theme.test.ts`（10）、
`test/fieldEvidence.test.ts`（18）、`test/agent.test.ts` +2。
`fieldEvidence.test.ts` 把有證據支持的數值釘在 `REFERENCE_MAPPING` 條目上，
防止日後漂回 generic 預設。

⚠ **e2e 需要 UTF-8 locale**。Chromium 在 `LC_CTYPE=POSIX` 下會把中文匯出檔名
清成 `download`，導致三個 Golden Flow 假性失敗（在 `4d07c40` 同樣重現，
非本輪造成）。`playwright.config.ts` 現在以 `C.utf8` 啟動瀏覽器。

## 4. 待辦

1. 重產 `docs/release-1.0/` 場刊證據（淺色版）：
   `npm run build` → `PLANFORM_PREVIEW_URL=http://127.0.0.1:4173 node scripts/exportPlans.cjs`
2. 更新 PR #17 body
3. **使用者端**：跑 `audit-local-references.ps1`、放行 production 網域或本機跑 prodSmoke
4. **不 merge**

## 5. Known limitations（PR §17 同步）

- **R-06 家族／小組座談座位形態未實作**——社課真實流程課後會拆成各家族小組座談
  （知識庫 §8.1／§10.2），產品目前只表達「面向投影幕的整片座區」。
  屬新產品方向，Release Freeze 內不做，列 1.1。
- R-07 場務組音控／控 PPT 位置、R-08 名牌 未實作，同上。
- S-04/S-06/S-07/S-08/S-09（電腦、收費箱、鞋架、欄杆、立牌）真實性未覆核，
  已標 `estimated`／`medium`，且全部保持為可刪可換的一般物件。
- E310 尺寸仍為照片推導起點，維持「待現場校正」。
- 場刊圖尚存 P2：背包放置區標題會略蓋到左側鞋架小標。
- 前輪既有 P2 清單見 Round 3 尾表。

## 6. 環境備忘（供任何 agent 接手）

- Linux 容器、node 22；Chromium 在 `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
- 跑 e2e：`PLAYWRIGHT_CHROMIUM_EXECUTABLE=<上述路徑> CI=1 npx playwright test`
- egress proxy 白名單外一律 403：`registry.npmjs.org` 通，`x.ai`／zeabur 不通
- 4173 主 preview／5183 e2e dev／4180 e2e production
- production build 的 debug hook 需要 `?e2e` query flag 才會掛上 `window.planform`
- `▶ 模擬` 只算數字，動畫是另一顆 `▶ 播放走位`（`replaySimulation`）
