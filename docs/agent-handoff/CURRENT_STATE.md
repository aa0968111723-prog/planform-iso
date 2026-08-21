# CURRENT_STATE（Claude Lead checkpoint）

更新：2026-08-21 07:3x · 環境已更換（見 §0）

## 0. ⚠ 環境變更 — 接手者必讀

本輪 Claude Lead **不是**在使用者的 Windows 機器上執行，而是在
**Claude Code on the web 的 Linux 雲端容器**（`/home/user/planform-iso`，ephemeral）。

因此以下三件事**在本環境內做不到**，且**沒有假裝做到**：

| 項目 | 狀況 | 誰能解 |
|---|---|---|
| 本機真實照片／場刊圖盤點 | `D:\場務場刊E310`、Documents/Pictures/Downloads/Desktop 都不存在；`/mnt/user-data`、`/mnt/attach` 皆空 | 使用者在自己機器跑 `scripts/audit-local-references.ps1` |
| Production 實測 `planform-iso-k7d2.zeabur.app` | egress proxy 回 **403 CONNECT**，完全連不到 | 使用者放行網域，或在本機跑 `node scripts/prodSmoke.mjs <url>` |
| Codex CLI / Grok CLI | 未安裝。npm registry 通，但 codex 需互動式登入；**x.ai 被 egress 擋掉**，Grok 連裝都裝不了 | 使用者在本機安裝並登入 |

→ 本輪 Codex 與 Grok 的角色由 Claude 直接承擔（實作＋自我對抗檢查），
   並在 `GROK_FINDINGS.md` 明確標示為 **Claude-run pass**，不冒充 Grok 實測。

## 1. 狀態：PR #17 持續推進中（不 merge）

- branch `release/planform-1.0-rc`，PR #17 open，base `main` @ `86fe454`
- 本輪新增 commits：
  - `5af6883` docs(field-research)：誠實盤點＋evidence mapping＋禪學社真實需求＋PS1 盤點腳本
  - `fda1a6e` feat(visual)：Light Visual Mode 預設＋模擬真人形＋巧拼改綠

## 2. 本輪處理的 Release Gate 項目

| 要求 | 狀態 |
|---|---|
| 讀完 REAL_REFERENCE_CONTRACT / E310_GOLDEN_SCENARIO / CURRENT_STATE / GROK_FINDINGS / PR #17 | ✅ |
| `docs/field-research/LOCAL_REFERENCE_AUDIT.md` | ✅ 誠實版（含「找不到」的明確聲明） |
| `docs/field-research/REFERENCE_MAPPING.md` | ✅ 每個 preset 標 source/confidence |
| `docs/field-research/TKU_ZEN_REAL_WORLD_REQUIREMENTS.md` | ✅ R-01..R-12，含未做項目 |
| 地墊真實性（顏色） | ✅ 紫 `#8b8fc7` → 綠 `#5fa877`（catalog／3D 材質／場刊符號三處） |
| Light Visual Mode 預設 | ✅ `src/core/theme.ts`；Dark 保留在 更多→畫布 |
| Editor/Simulation/Partner/Export 同一套視覺語言 | ✅ 場景色＝匯出器紙面色；3D 匯出頁不再是黑底 |
| 人流動畫看得到人 | ✅ 1.7m 人形（圓頭＋膠囊身體）、InstancedMesh、依 state 上色、面向行進方向 |
| 到達窗 20 分鐘 | ⏳ 未做（見 §4） |
| Grok 盲測 production | ❌ 環境不可達（見 §0） |
| Production SHA 驗證 | ❌ 環境不可達（見 §0） |

## 3. 品質基線（本地實跑，非引用）

```
npm run lint       ✅
npm run typecheck  ✅
npm run test       ✅ 233/233（原 196 + 新 37）
npm run build      ✅ precache 1173 KiB
npm run test:e2e   ⏳ 執行中（task bfg3swgan）
```

新測試檔：`test/crowd.test.ts`（13）、`test/theme.test.ts`（10）、`test/fieldEvidence.test.ts`（14）。
`fieldEvidence.test.ts` 把「有證據支持的數值」釘在 REFERENCE_MAPPING 的條目上，防止日後漂回 generic 預設。

## 4. 待辦（依序）

1. [執行中] e2e 全量
2. 到達窗預設 15 → 20 分鐘（合約 golden scenario 指定 60 人／20 分鐘）
3. Claude 自我對抗檢查（Playwright 驅動本地 production build，涵蓋手機／平板／PWA／
   60 人與 100 人模擬／場刊匯出）→ 寫入 GROK_FINDINGS 標為 Claude-run
4. 更新 PR #17 body（真實 reference audit／defects／fixes／gate 結果／環境限制）
5. **不 merge**

## 5. Known limitations（PR §17 同步）

沿用前輪清單，另加本輪：

- **R-06 家族／小組座談座位形態未實作**——社課真實流程課後會拆成各家族小組，
  產品目前只表達「面向投影幕的整片座區」。屬新產品方向，Release Freeze 內不做，列 1.1。
- R-07 場務組音控／控 PPT 位置、R-08 名牌 未實作，同上。
- S-04/S-06/S-07/S-08/S-09（電腦、收費箱、鞋架、欄杆、立牌）**真實性未經覆核**，
  已在 REFERENCE_MAPPING 標 `estimated`／`medium`，且全部保持為可刪可換的一般物件。
- E310 尺寸仍為照片推導起點，維持「待現場校正」＋30 秒三路校正。

## 6. 環境備忘（供任何 agent 接手）

- 本容器：Linux、node 22、Chromium 在 `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
  （跑 e2e：`PLAYWRIGHT_CHROMIUM_EXECUTABLE=<上述路徑> CI=1 npx playwright test`）
- egress proxy 白名單外的網域一律 403；`registry.npmjs.org` 可通，`x.ai`／zeabur 不通
- 4173 主 preview／5183 e2e dev／4180 e2e production
- 場刊重產：`npm run build` 後 `PLANFORM_PREVIEW_URL=http://localhost:4173 node scripts/exportPlans.cjs`
