# WP-D：UX 出口／AI 誠實／儲存安全

依 ux-flow + platform + viewport audit。

## P1 — UX

1. **AI 預覽 limbo**（quickAgentSheet.ts:145-153, App.ts:289-292）：close() 時若 preview
   仍 active → 視同「取消」rollback；並在 preview active 期間於畫布顯示常駐
   「預覽中：套用 / 取消」浮條（sheet 關掉也看得到）。
2. **放區域模式出口**（App.ts:513-517, 1454-1459）：setWorkflow / cancelPlacement / Escape
   都要清 session.zonePlace；armed 時顯示取消列（沿用 placebar 樣式「取消放置區域」）。
3. **幫我排場佈誠實化**（quickAgentSheet.ts:58-61）：改為跑真正的
   buildQuickStartProject 等效 layout（帶目前人數/需求，走 preview→套用），
   不再是「放兩個報到桌」。

## P1 — 儲存安全

4. **載入/匯入確認**（UI.ts:846, 751-753）：目前專案非空時 confirm（沿用 wizard 文案），
   並把 pre-load snapshot 推進 undo 或提供 undo chip。
5. **saveNamedLayout 防炸**（store.ts:203-226）：try/catch＋回傳 boolean＋失敗 toast。
6. **autosave 失敗常駐提示**（store.ts:141-146, main.ts:21-23）：失敗→常駐 banner
   （樣式同 update-banner）直到寫入成功；banner 附「匯出 JSON」一鍵逃生；
   成功後重置 latch。

## P2（全修）

- 檢查併入分享：底部/頂部主流程改四步（場地/場佈/動線/分享），檢查結果以
  常駐紅黃綠徽章＋分享頁 pre-export checklist 呈現（UI.ts:34-38）。
- 我的素材 section 預設收合、移到素材庫下方（UI.ts:450-454, customAssetFlow.ts:119）。
- agent 失敗卡 humanize（quickAgent.ts:87-89 過 TOOL_LABEL）。
- AI sheet 手機不自動 focus textarea（quickAgentSheet.ts:145-149）。
- route inspector 繼續繪製 → compact 收合 sheet（UI.ts:898 同 place mode）。
- matMode 切換被 venue 預設蓋掉：改成「venue 變更時才重設」（UI.ts smartLayoutSection）。
- SW 定期檢查更新：onRegisteredSW + 60min interval + visibilitychange（main.ts:47）。
- partner：dock 計入 desktop bottom inset（viewport.ts:127）；suggest promise 不復活
  sheet（partnerMode.ts:65-68）；離開還原原 view（App.ts:836-846）；
  角色 chips 360px 撕邊漸層提示；紅綠燈按鈕 ≥44px tap target。
- 損壞備份 toast 補位置提示＋下載後可清除。

## P1 — e2e production harness（viewport audit V1）

7. `window.planform` 測試鉤子改用 `?e2e` query flag 或 `VITE_E2E` 環境變數 gate
   （不再 DEV-only，main.ts:33-42），確保 PROD build 不外洩鉤子（旗標未帶時）。
8. playwright 加第二個 project：`npm run build && npm run preview -- --port 4180`
   驅動 production bundle；至少覆蓋：開站、golden 流程、**SW 更新 banner**
   （部署新 build 後出現「有新版本可以使用」→ 立即更新 → reload 後新版）。

## 驗收

- [ ] verify + e2e 綠（新行為含測試：preview 關閉回滾、zonePlace 出口、載入確認）
- [ ] 手機 viewport 手動腳本：AI 六 chip 各按一次→關 sheet→畫面必回一致狀態
- [ ] 主流程四步；檢查徽章可見；分享頁含檢查清單
