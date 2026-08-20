# CURRENT_STATE（Claude Lead checkpoint）

更新：2026-08-20（Claude Lead session，Release 1.0 第二階段開工）

## Git

- 工作 repo：`D:\planform-iso`
- Branch：`release/planform-1.0-rc`（= origin，clean）
- RC HEAD：`4e2cd9f` fix(1.0): grok adversarial review — all 22 findings resolved
- main：`86fe454`（PR #16 merge）
- Release PR：**#17**（open，release/planform-1.0-rc → main，不自動 merge）

## Production

- URL：https://planform-iso-k7d2.zeabur.app（Zeabur，追 main）
- 已驗證：production bundle = main 世代（有夥伴模式字串、無 RC 的快速開始/立體/版本字串；
  /version.json 404 → RC 的 build info 尚未上線）
- Release Gate「Production 最新」需在使用者 merge PR #17 後重新驗證（version.json + PWA 更新）。

## 已完成（本 session）

- 環境：Node v26.3.0 / npm 11.16.0 / git 2.53 ✓
- Codex CLI 0.148.0 安裝＋已登入；Grok CLI 1.0.5 安裝＋已登入（headless 測通）
- RC branch `npm run verify` 全綠（lint/typecheck/unit/build）
- E310 現場照片（D:\場務場刊E310）＋活動實況照分析完成 → 拓撲事實入
  docs/e310/E310_GOLDEN_SCENARIO.md（照片含人臉不 commit）
- handoff 基礎設施：AGENT_PROTOCOL.md / GROK_FINDINGS.md / 本檔 / agent-supervisor.ps1
- 5-agent 平行 code audit（§6-§13 對照）已發起（workflow wemw5i2ze）

## 進行中

- [Codex] WP-A：E310 Golden Venue + 巧拼 field + 快速校正 + golden scenario
  （規格：docs/e310/E310_GOLDEN_SCENARIO.md；worktree `D:\planform-iso-codex`，
  branch `codex/e310-golden-venue`）
- [Claude] RC code audit 結果整合；Lead 親自 UX 審查（local preview + Browser）

## 尚未開始

- Grok Round 1（等 WP-A 整合後跑 A–Q 全流程）
- Codex 修 Round 1 P0/P1 → Claude review → Grok Round 2（零知識）
- 平台 viewport 實測（10 組尺寸）、匯出場刊圖人審、PR #17 內容更新
- Release Gate 全項核對

## 缺陷清單

- P0/P1：目前無 open（前輪 22 項已修）。等 audit workflow + Grok Round 1。

## 不可碰的檔案（單一寫入者規則）

- `docs/agent-handoff/**`：只有 Claude 寫
- Codex 只在自己 worktree/branch 動 code；Grok 不改產品 code

## 架構決策（本 session）

1. E310 講台/講桌走 catalog entry（kind="table" bucket），不動 ObjectKind。
2. 巧拼整片座區用既有 ArrayGroup（0.6×0.6, gap 0）表達；smartLayout 加 field 模式。
3. 活動照片顯示實際用法是巧拼 field＋後牆長桌背包區＋墊緣鞋區 → golden scenario 依此。
4. 未校正尺寸在 UI 與匯出 footer 都要標「待校正」——匯出誠實性是 Release 要求。
5. Grok Round 1 測 RC 本機 preview（production 還是舊 main，測了只會重複已修問題）；
   production 只做部署/PWA 煙霧測試，merge 後再全面驗。

## Claude 若被限額，下一步最明確的事

1. Codex 依 E310_GOLDEN_SCENARIO.md 完成 WP-A，跑滿驗收清單，commit 在 codex branch。
2. 不 merge PR #17。
3. Grok 可先對 production 做 PWA/部署煙霧測試，結果寫 scratch。
4. Claude 回來後：git log 4e2cd9f..HEAD → review WP-A diff → 決定 ACCEPT/FIX/REVERT。

## CLAUDE_PAUSED_AT / RETRY

（未暫停）
