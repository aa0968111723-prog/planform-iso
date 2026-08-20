# CURRENT_STATE（Claude Lead checkpoint）

更新：2026-08-21 00:4x（Claude Lead；WP-A 已整合，WP-B 進行中）

## Git

- 工作 repo：`D:\planform-iso`，branch `release/planform-1.0-rc`
- RC HEAD：`551439e`（= WP-A merge `fbc568c` + ops fixes）
- main：`86fe454`；Release PR：#17（open，不自動 merge）
- Codex worktree：`D:\planform-iso-codex`，branch `codex/sim-spatial`（基於 551439e）
- 尚未 push：RC 新 commits（5c6b712…551439e）與 codex branches 都只在本機

## Production

- https://planform-iso-k7d2.zeabur.app = 舊 main（86fe454 世代）；merge PR #17 後才會更新
- 已加 gitSha env fallback（ZEABUR_GIT_COMMIT_SHA 等）→ merge 後驗 /version.json

## 已完成

1. Phase 0：CLI 環境（Codex 0.148.0 已登入、Grok 1.0.5 已登入、Node 26/npm 11/git 2.53）
2. 五路 code audit（§6–§13）：2 P0（模擬非空間、平均等待統計錯）＋16 P1＋20+ P2
   → 工單化為 docs/e310/WP_B/C/D spec
3. **WP-A E310 Golden Venue 完成並合併**（Codex 實作＋Claude review fixes）：
   - venue:tku-e310（12×9 誠實起點、後門走廊、講台+講桌、待校正徽章）
   - 巧拼 field 模式（座距 0.9m 實照密度／C 寬鬆 1.2m）、A/B/C 視覺候選
   - 三路快速校正（地磚/門寬/已知距離）＋匯出 footer 誠實標示
   - 一鍵「E310 演講範例（60 人）」：40/20 分支、走廊 station 鏈、入場動線
   - unit 179+ 綠；e2e 70/70 綠（Golden Flow 4 新增）
4. ops：vite gitSha env fallback、prodSmoke 版本比對修正

## 進行中

- [Codex] WP-B 模擬誠實化＋空間化（docs/e310/WP_B_SIMULATION_SPEC.md，
  branch codex/sim-spatial，背景執行）
- [Claude] RC 全量 gates 重跑（背景）；完成後放 Grok Round 1
- 本機 preview：http://localhost:4173（vite preview，serve D:\planform-iso\dist）

## 待辦（順序）

1. Grok Round 1（A–Q 全流程，對 localhost:4173 RC build；production 只查 PWA）
   → findings 進 docs/agent-handoff/GROK_FINDINGS.md
2. WP-B review → 整合
3. WP-C 匯出可讀性（spec 已備）→ WP-D UX/儲存安全（spec 已備）
4. deploy.yml 改造（Pages 降級 staging / CI 加 e2e+smoke）——Claude 自己做
5. e2e prod-bundle harness（V1 finding：VITE_E2E flag + preview project + SW update spec）
6. Grok Round 2（零知識）→ 修 → Release Gate 全項核對 → 更新 PR #17 內容
7. 六種場刊圖用 E310 golden 重新輸出存 docs/release-1.0/＋手機/平板截圖

## 重要架構決策（新增）

6. E310 12×9 為照片推導起點（桌椅列數/巧拼格數），非實測——一切仍掛待校正。
7. 巧拼座距：緊湊 0.9m/人（活動照片實測密度）、寬鬆 1.2m/人；容量誠實顯示。
8. Grok round 1 測 RC preview 而非 production（production 落後一版，測了徒增噪音）。

## 三 AI 狀態

Claude=Lead（active）；Codex=WP-B running；Grok=idle 待 Round 1。
使用者的活動實況照（含人臉）僅本機參照，不入 repo。

## Claude 若被限額，下一步最明確的事

1. 等 Codex WP-B 完成 → 不 merge，等 Claude review。
2. Grok 可先跑 Round 1（brief 在 scratchpad grok-round1-prompt.md，對 4173）。
3. Claude 回來：git log 551439e..HEAD → review WP-B → 依 CURRENT_STATE 待辦續跑。
