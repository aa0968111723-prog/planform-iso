# CURRENT_STATE（Claude Lead checkpoint）

更新：2026-08-21 04:0x（四個工作包全部合併；Grok Round 2 執行中）

## Git

- `D:\planform-iso`，branch `release/planform-1.0-rc`，HEAD `d59da67`
- 里程碑：WP-A E310（fbc568c）→ WP-B 空間模擬（8bbb2ee）→ 走廊化（5c82a49）→
  WP-C 場刊可讀性（67ebd03）→ WP-D UX/儲存（7725d5f）→ release 證據刷新（d59da67）
- main `86fe454`；PR #17 open；未 push（等 R2 結束一起推）

## 品質基線（最終 RC）

- unit **196/196** 綠；lint/typecheck/build 綠
- e2e **72/72** 綠（含新 production-bundle project：?e2e gate＋update banner surface）
- prodSmoke **15/15**（SW active、version.json、離線開機含專案、平板夥伴、七種匯出）
- docs/release-1.0 已換上最終 RC 的 E310 六圖＋手機/平板/桌機截圖

## WP-D review 中 Claude 修掉的問題（記錄）

1. e2e hook 被 gate 到 ?e2e-only → dev 恆開，70 條測試才跑得動
2. AI 捷徑 chip 被改名「打開◯◯」→ 恢復規格 §6 六個「幫我◯◯」名稱，誠實性改用跳轉 toast
3. ▶ 模擬 自動進即時播放（結果被藏、52 分鐘看不到數字）→ 結果先行；
   ▶ 播放走位 45 秒看完全程、播畢自動回結果；速度檔改 慢/正常/快
4. 夥伴模式 coverage 門檻 0.7→0.6（dock 計入 chrome 的誠實代價）；四步 flow 斷言同步

## 進行中

- [Grok] Round 2 零知識對抗測試（對 4173 最終 RC；八個使用者目標自由測；
  輸出 `_grok_round2/FINDINGS.md`）——task b28kty236

## R2 之後的收尾順序

1. R2 findings 分級：P0/P1 修（Codex 或 Claude 視規模）→ re-gate（verify+e2e）
2. push `release/planform-1.0-rc` → gh pr edit #17（內文草稿在 scratchpad pr17-body.md）
3. CURRENT_STATE 終版＋GROK_FINDINGS 補 R2 → 標記 PLANFORM_1_0_RELEASE_CANDIDATE_READY
4. **不 merge**——留給使用者
5. 使用者 merge 後：驗 production /version.json=main SHA、PWA 更新提示、線上 smoke

## 已知 non-blocking limitations（進 PR）

- E310 尺寸為照片推導起點，全部掛「待校正」；快速校正三路徑可 30 秒修正
- SW「有新版本」banner 的 e2e 驗的是 banner surface；真實 SW waiting 生命週期由
  workbox 行為＋prodSmoke 離線/啟用測試覆蓋
- ✦ AI 為本地確定性規則引擎（離線可用），非雲端 LLM；chips 誠實標示行為
- 場刊圖 4 個外觀 P2（標籤重疊/貼框/圖面比例/3D 深色）記錄於 LEAD_REVIEW_NOTES
