# CURRENT_STATE（Claude Lead checkpoint）

更新：2026-08-21 02:0x（WP-C 已合併 `67ebd03`；WP-D 執行中 branch codex/ux-storage）

## 最新進度快照

- WP-C（場刊可讀性）親審通過＋branch e2e 70/70 → 已合併；4 個 P2 記錄於
  LEAD_REVIEW_NOTES（標籤重疊/生活組貼框/圖面縮小/3D 深色）——交 Grok R2 判定
- WP-D（UX/AI/模擬呈現/儲存安全 21 項）Codex 執行中；
  之後：重產截圖 → Grok R2（brief 在 scratchpad grok-round2-prompt.md）→ Release Gate

## Git

- `D:\planform-iso`，branch `release/planform-1.0-rc`，HEAD `5e657e0`
- 主要歷史：WP-A merge `fbc568c` → ops `551439e` → lead fixes `8295375` →
  走廊化報到收費 `5c82a49` → **WP-B merge `8bbb2ee`**（空間模擬）→ lint `4918a66` → 範例 2 人報到 `5e657e0`
- Codex worktree：`D:\planform-iso-codex` @ `codex/export-legibility`（WP-C 執行中）
- main `86fe454`；PR #17 open；一切未 push

## 目前品質基線

- unit 193/193 綠、verify 綠（RC HEAD 附近）；WP-B branch 曾全量 e2e 70/70 綠；
  RC merge 後全量 e2e 背景執行中（task bjadvtpau）
- Lead 實機驗收 WP-B：60 人範例 → 「平均等待 15 分 45 秒（每人真實等待）／最塞：報到」，
  headline 不再被走廊誤報蓋掉；zero pageerror
- Grok Round 1（`_grok_round1/FINDINGS.md`，本機 not committed）：0 P0／9 P1／5 P2，
  分級與派工見 docs/agent-handoff/GROK_FINDINGS.md
  - 已修：R1-2（精靈 E310 預設）、R1-5 擋門/走道（報到收費移走廊＋動態保留帶＋
    「範例通過自身驗證」測試）、R1-9 生活組貼外緣
  - WP-C 進行中：R1-6 匯出可讀性全項
  - WP-D 待派：R1-1 全域待校正 banner、R1-3 巧拼預覽/取代、R1-4 模擬呈現、
    R1-5 夥伴步驟排序、R1-7 AI 誠實、R1-8 手機場佈首屏、R1-9 巧拼格線、全部 P2

## 排程（下一步順序）

1. 等 RC 全量 e2e（bjadvtpau）與 Codex WP-C（be7nh4hny）
2. Review WP-C（我重跑六種場刊圖並目測）→ 合併
3. 派 WP-D（docs/e310/WP_D_UX_STORAGE_SPEC.md ＋ GROK_FINDINGS 的 WP-D 項）
4. WP-D 合併後：重建、重新產出 docs/release-1.0 全套截圖（場刊六種＋手機平板）
5. Grok Round 2（零知識、不得餵 R1 清單；含 30/100 人變體與校正流程實測）
6. 修 R2 blocker → Release Gate 全項核對 → push RC → 更新 PR #17 內文 → 交使用者 merge
7. merge 後：驗 production version.json = main SHA、PWA 更新、prod smoke

## 環境注意

- 4173 = 主 checkout preview（勿佔）；5173 = e2e dev server；Codex 用 4181
- `_grok_round1/`、`_lead/` 已 gitignore（原始截圖不入 repo）
- Codex sandbox 無法寫 worktree git index → 由 Claude 代 commit
- grok headless：用 bash 傳長 prompt（PowerShell 會把多行 -p 切壞）

## Claude 若被限額

1. 等 WP-C 完成後不 merge，留給 Claude review。
2. Grok 可先準備 Round 2 環境（不動 repo）。
3. Claude 回來：讀本檔 → git log 5e657e0..HEAD → review → 續排程。
