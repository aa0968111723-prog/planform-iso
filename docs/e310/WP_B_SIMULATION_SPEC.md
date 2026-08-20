# WP-B：模擬誠實化＋空間化（P0）

依 2026-08-20 五路 code audit（sim 域）結果。目標：讓 ▶ 模擬 的輸出真的回應場佈幾何，
且每個人話數字統計正確。規格 §9（人話輸入輸出）已達成，不要動它的外觀。

## P0-1 headline 統計錯誤（先修，最小 diff）

- `simPanel.ts:103-106` 與 `rehearsal.ts:129-138`：「平均等待」= 各站平均的平均，低估 5–10 倍。
- 改為**每人實際等待**：Σ agent.waitAccum / participantCount（engine 已有 waitAccum，
  加進 SimulationResult 聚合）。進階表維持各站數字。
- 「最多排隊」同步檢查：應為任一時刻全場最大同時排隊人數（若目前是各站峰值取 max，可留，
  但 label 要對得上）。

## P0-2 空間耦合（本批核心）

模擬必須至少吃這些幾何（§10）：

1. **行走路徑**：站到站的移動改沿 entry route polyline（有 route 時），無 route 才退回直線。
   走廊→門→教室的距離因此真實。
2. **門 = 通過點**：把「門」建為 throughput 節點（綁實際 door 物件；寬 <0.9m 通過率下降），
   agent 進教室必經門節點；門被物件擋住（doorFrontClearance 侵入）→ 通過率大減並回報。
3. **排隊佔地**：隊伍沿 queue lane（站點朝向反方向或走廊軸向）以 0.5 m/人 展開；
   隊尾超出走廊/可用空間 → 標記「走廊塞住」bottleneck，並在 playback 視覺化
   （agent 沿隊伍線排開，不再全部疊在同一點；移動沿 route，不穿牆）。
4. `最塞` 從此可能回答：某站、**門前**、或**走廊**。

不要做成 CFD/群體模擬——保持 DES + 幾何約束層，deterministic、可測。

## P1 修正

- **A/B 偏頗**（eventFlow.ts:614-679）：A 同桌 = 共用桌 servers = checkinStaff+paymentStaff，
  預繳者只收 checkin 時間（雙站同位、零移動）；B 分桌用使用者實際的收費桌位置
  （找 serviceRole=payment 物件/區域），不再憑空 +2.5m。
- **C 走廊預分流**：新增第三 variant——走廊兩條 lane（預繳/現場）各自 guide+queue，
  三案比較卡（A/B/C）＋人話結論。30/60/100 人 × A/B/C 的 unit test 矩陣，
  並斷言已知合理性（例：預繳比例高時 A 不應永遠輸）。
- **站點座標凍結**（App.ts:1054-1096）：每次 ▶ 模擬 / simulatePlan 前依 objectId/zoneId
  重新解析 station x/z（物件被刪則退回 zone、再退回原值）；simulatePlan 必須用傳入
  project 重建 scenario（partner before/after 才會真的不同）。
- **自助站容量**（migrate.ts:253-264）：shoe/backpack/seating 改高並行（parallelServers
  隨 zone 面積，例：每 0.5 m² 一席，上限 12）或纯延遲；guide/entrance 容量跟人力輸入。
- 比較結果不覆寫主 readout（App.ts:1158）：variant 數字只留在比較卡。

## P2（順手修）

- 現場繳費人數改精確分配（round(ratio×N) 人，非逐人抽樣）。
- 到達模式一鍵切換：「陸續到 / 快開始才到」→ uniform / front-loaded。
- 內部跑 5 seeds 取中位數再下 A/B/C 結論（UI 不露 seed）。
- queueCapacity：實作（滿了溢到走廊 → 觸發空間 bottleneck）或刪除欄位＋tool 參數。

## 驗收

- [ ] `npm run verify` 綠；新行為都有 unit test
- [ ] E310 golden scenario：把報到桌搬到門正前方 → 重按 ▶ 模擬 → 結果變差且「最塞」指向門前
- [ ] 走廊寬 1.2m vs 2.4m → 同 scenario 結果可辨差異
- [ ] 60 人 40/20：headline 平均等待 = 每人平均（unit test 用手算小例驗證）
- [ ] A/B/C 三案卡片出現且用人話下結論；「差不多」只在真的差不多時出現
- [ ] playback：不穿牆、隊伍排開、門前堵塞可見
- [ ] 不改 §9 的第一層輸入輸出外觀；工程術語仍只在 進階
