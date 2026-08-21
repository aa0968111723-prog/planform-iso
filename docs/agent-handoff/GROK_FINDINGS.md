# Grok Adversarial Findings（持續累積）

規則：每個 finding 標 P0（blocker）/ P1（serious）/ P2（polish），附重現步驟、預期、實際、建議修法。
Grok 原始輸出落在 repo 外 scratch；由 Claude 整理進本檔並派工 Codex。

## 歷史

- 2026-08-20 之前：第一代對抗審查（22 findings，見 `_review_grok.md`）——已於 commit `4e2cd9f` 全數修復。

## Round 1（2026-08-21，RC 551439e + E310，完整報告：`_grok_round1/FINDINGS.md`）

結論：**0 P0、9 P1、5 P2；全程零 console error／pageerror**。F5 與重開專案都能復原。

| # | 級 | 摘要 | 派工 |
|---|---|------|------|
| R1-1 | P1 | 待校正 banner 只在場地面板，其他工作流看不到 | WP-D |
| R1-2 | P1 | 精靈 E310 預設 30 人、未勾收費/講師/生活組 | ✅ Claude 已修（wizard venue-aware 預設） |
| R1-3 | P1 | 巧拼 A/B/C 無視覺預覽；套用疊在既有座區上（96→192 片） | WP-D（預覽卡縮圖＋套用取代舊 mat 群組） |
| R1-4 | P1 | 模擬結果與「模擬中 0 秒 0 人」並列；畫布無小人；手機結果被捲走；入口埋在動線頁底 | WP-D（呈現層；引擎 playback WP-B 已重做） |
| R1-5 | P1 | 夥伴步驟第 8 步走回「走廊排隊」；底欄文案錯；官方範例自己觸發「擋門/走道過窄」；390 生活組 chip 被切 | 擋門/走道 ✅ Claude 修（報到收費移走廊）；步驟排序/文案/chips → WP-D |
| R1-6 | P1 | 場刊手機端座位編號不可讀、3D 圖上 1/3 有效下 2/3 黑、分享列表首屏只見 5 鈕、圖例入場動線重複 | WP-C |
| R1-7 | P1 | AI「幫我排場佈」仍放兩張報到桌；Validation 英文；捷徑 chip 未說明；手機關閉鈕被底欄裁切 | WP-D |
| R1-8 | P1 | 手機場佈首屏是「我的素材 GLB」表單，報到桌要捲才看到 | WP-D |
| R1-9 | P1 | 編輯器巧拼只是實心紫塊（無格線）、右塊缺標籤；生活組區視覺上像在走廊外（實為邊界對比不足＋填滿走廊深度） | 格線/標籤 → WP-D；生活組縮深貼外緣 ✅ Claude 修 |
| R1-10 | P2 | 「立體」視角幾乎是俯視 | WP-D |
| R1-11 | P2 | 現場校正不是三顆一層人話按鈕；離開場地頁校正模式殘留 | WP-D |
| R1-12 | P2 | 桌機標題不顯示活動名；手機 undo/⋯ <44px | WP-D |
| R1-13 | P2 | production /version.json 404（舊 main，merge 後解） | merge 後驗證 |
| R1-14 | P2 | 動線列表「刪除」比「完成繪製」顯眼；畫布留白多易點出教室 | WP-D |

## Round 2（2026-08-21，RC 7725d5f，零知識重測；完整報告：`_grok_round2/FINDINGS.md`）

結論：**0 P0、9 P1、4 P2；console/pageerror 全程 0**。折磨測試（亂點/F5/雙 tab）不壞不丟。
總評：「紙上可以交差，不建議只靠這份圖上場」——校正不生效與人數不同步是關鍵。

| # | 級 | 摘要 | 處置 |
|---|---|------|------|
| R2-1 | P1 | 範例巧拼是實心紫塊；排地墊欄 30／「尚未產生方案」誤導 | 同步/文案 ✅ Claude（f54398a）；編輯器格線 → WP-E #1 |
| R2-2 | P1 | 校正「套用」看似無效：record 誤清已知距離徽章、面板重建清輸入、2% 變化無回饋 | ✅ Claude：record 不再標 room、toast 帶具體數字、面板顯示現值＋各項狀態 |
| R2-3 | P1 | 手機：banner 斷字、夥伴模式藏 ⋯ 兩層、預設立體看不懂 | ✅ Claude：詞間換行、分享頁一級夥伴入口、compact 預設俯視 |
| R2-4 | P1 | 場刊 390 寬不可讀；座位圖≈總覽；物資缺鞋架/欄杆；下載無預覽 | 範例補物資 ✅ Claude；手機版式/座位圖差異化 → WP-E #2/#3 |
| R2-5 | P1 | 「檢查通過」綠燈與「待校正」並存 | ✅ Claude：未校正必為黃燈「尺寸待校正」＋分享清單同步 |
| R2-6 | P1 | 空白場地沒牆沒門；「✓ 已校正」假話；放置可穿牆；模擬人數不同步 | 文案/夾限/同步 ✅ Claude；牆線與門 → WP-E #6 |
| R2-7 | P1 | 播放走位「0 秒 0 人」但紅框 21/24 | ✅ Claude：simTime 連續時鐘（兩輪共同病根）、tick 上限隨速度 |
| R2-8 | P1 | 引導組被綁鞋子區；生活組切不過去；「全部」沒站點句 | → WP-E #5 |
| R2-9 | P1 | AI 用 30 人方案排 60 人活動 | ✅ Claude：人數單一來源（scenario→session→panel/AI） |
| R2-10 | P2 | E310 俯視像斜視 | 觀察（相機重心疑似未正交切換）；Grok R3 追 |
| R2-11 | P2 | 標籤互蓋、入口名切字 | → WP-E #4 |
| R2-12 | P2 | 雙 tab 共用一份 autosave | 記錄為 known limitation（PR 列明） |
| R2-13 | P2 | 分享頁點一張後按鈕列收合 | 待重現（open attr 恆真，疑捲動誤判）；R3 追 |

## Round 3（2026-08-21，RC 6c08d72，修復驗證輪；完整報告：`_grok_round3/FINDINGS.md`）

**11/13 FIXED、1 STILL-BROKEN、0 新 P0、console/pageerror 全 0。**
Grok 總評：「敢拿這份當施工討論稿和現場校正工具。」
實測亮點：量 58cm 地磚／88cm 門真的改模型與面板；範例開場即見格線＋「已排好 96 片／可坐 64」；
報到 2 人力 → 38 分 31 秒收完、瓶頸轉收費——數字可拿去排班。

本輪新問題與處置（全部已修，commit `1c67a0f`）：

| 級 | 問題 | 修法 |
|---|---|------|
| P1 | 「套用到教室長」無兩點量測時把 120cm 當教室全長（教室變 1.2m） | 無有效量測即拒絕＋提示；只保留等比縮放 |
| P1 | 生活組被派到講師禪定區（zoneTypes 含 meditation 被 find 先撞） | life 只綁 life zone |
| P2 | 播放中左欄凍在「0 秒 0 人」 | 播放迴圈 5Hz 同步面板 |
| P2 | 模擬預設報到人力 1（範例是 2 人編制） | simQuick 由 scenario stations 種入人力 |
| P2 | 地磚顯示 57.99999999 | metersToCm 去浮點塵 |

Round 3 剩餘未修 P2（列 PR limitations）：編輯器巧拼標籤與區名重疊、3D 圖無手機版、
「全部」流程第 8 步文案繞回走廊排隊、分享頁綠點與待校正黃點並存語意。

---

## Round 4（2026-08-21，RC `9f2807b`）— **Claude-run pass，不是 Grok 實測**

### 誠實聲明（先讀這段）

本輪**沒有 Grok**。原因是環境，不是選擇：

| 想做的事 | 實測結果 |
|---|---|
| 安裝 Grok CLI（`irm https://x.ai/cli/install.ps1`） | `x.ai` 被 egress proxy 擋掉（CONNECT 403），**連下載都不行** |
| 盲測 `planform-iso-k7d2.zeabur.app` | 同樣 CONNECT 403，**production 完全不可達** |
| Codex CLI 實作 | npm registry 通、裝得起來，但需要互動式登入，**使用者未登入** |

所以本輪由 **Claude 兼任實作與對抗檢查**，方法是：用 Playwright 驅動
**`dist/` 的 `vite preview`（production build，與部署同一份產物）**，
以第一次使用者身分走完 E310 golden flow，在 phone / tablet / desktop 三種
viewport 各跑一次，並**實際打開匯出的 PNG 用眼睛看**。

這**不能取代** Grok 對 production URL 的盲測。Production Gate 仍未通過，見
`CURRENT_STATE.md` §0。

### 方法

- 產物：`dist/` → `vite preview :4173`（`?e2e` 開 debug hook）
- 路徑：清空 localStorage → 精靈第一屏 → 點「⚡ E310 演講範例（60 人）」
  → 檢查專案 → 版面量測 → 30/60/100 人模擬（`startSimulation` 後 `replaySimulation`）
  → 五種場刊圖各出手機版與 A4 → 夥伴模式 → 深色切換 → reload
- 三個 viewport：390×844 / 820×1180 / 1366×900
- 證據：截圖與 PNG 留在工作目錄（未 commit）

### 先修掉的是「檢查工具自己的 bug」

第一輪跑出 20 個 finding，逐一查證後**其中 17 個是 harness 誤判**，不是產品缺陷：

| 誤判 | 真相 |
|---|---|
| 「E310 範例沒有巧拼座區」 | 我猜了一個不存在的 `app.applyE310Golden()`，範例根本沒被套用 |
| 「手機/平板同時出現左右兩個側欄」 | 我的可見性判斷漏了垂直邊界，收合的 sheet 被當成展開 |
| 「模擬畫面上從頭到尾沒有人」 | `▶ 模擬` 只算數字，動畫是另一顆 `▶ 播放走位`；我沒按第二顆 |

修正 harness 後重跑，這三類全部消失。**未經查證的 finding 不列入本表。**

### 查證後確認的真實缺陷（全部已修）

| # | 級 | 問題 | 證據 | 修法 |
|---|---|---|---|---|
| R4-1 | P1 | 場刊圖上「報到區」「收費區」標題被切掉一半 | 手機版 PNG 目視 | 區塊底色與區塊標題拆成兩個 pass，標題最後畫（在傢俱、群組、動線之後） |
| R4-2 | P1 | 標題被綠色入場動線穿過就糊掉 | 同上 | 所有圖面文字加白色光暈描邊 |
| R4-3 | P1 | 「生活組區」標籤被切在圖框外 | 物資清單圖縮圖 | 標籤統一走同一個避讓登記表，並夾在圖框內 |
| R4-4 | P1 | 手機版場刊約 40% 版面全白，圖浮在中間；且手機版完全沒有圖例 | 手機版 PNG | 圖改為上對齊，空出來的版面拿來畫圖例 |
| R4-5 | P1 | 鞋架在場刊上顯示為灰色「收納」方塊 | 場佈總覽圖 | storage 符號改用 catalog 名稱（鞋架） |
| R4-6 | P2 | 「電腦」字級固定 9px，任何頁面尺寸都看不清，還會壓到區名 | 場佈總覽圖 | 字級隨頁面，並納入避讓 |
| R4-7 | P1 | 物資清單把整片巧拼列成「▫ 地墊 96」 | 物資清單圖 | 解析 catalog 與實際尺寸 → 「🧩 地墊（巧拼 60 × 60 cm）× 96」 |
| R4-8 | P1 | 模擬的人是 0.28 m 方塊，且每人每幀重新配置 mesh | 程式碼＋播放截圖 | 1.7 m 人形（圓頭＋膠囊身體）、兩個重複使用的 InstancedMesh、依狀態上色、面向行進方向 |
| R4-9 | P1 | 編輯器是深色，場刊是白紙，兩套視覺 | 全域 | Light Visual Mode 成為預設，場景色＝匯出器紙面色；Dark 保留為選項 |
| R4-10 | P1 | 3D 場刊頁烤死深藍底，和同一份場刊其他白底頁不一致 | `docs/release-1.0/e310-3d.png` | 3D 匯出永遠用紙面色，與編輯器主題無關 |
| R4-11 | P1 | 巧拼在程式三處都是薰衣草紫，照片證據是綠色 | `E310_GOLDEN_SCENARIO` §1.6 | catalog／3D 材質／場刊符號全改綠 |
| R4-12 | P2 | 「✦ 幫我改善」按下「套用」前看不到 before/after | 程式碼 | 預覽區顯示「改變前 → 改變後」表（數字本來就算好了，只是藏在一句話裡） |
| R4-13 | P1 | 三個 Golden Flow e2e 在 POSIX locale 下必失敗 | 在 `4d07c40` 重現，非本輪造成 | Chromium 在非 UTF-8 locale 會把中文檔名清成 `download`；改為以 `C.utf8` 啟動瀏覽器，不弱化斷言 |

### 本輪實測數字（E310 範例，60 人，報到 2 人力）

播放中畫面上同時最多 **14 人**，狀態涵蓋 traveling / queued / serving，時鐘連續前進。

```
最多排隊：13 人
平均等待：3 分 49 秒
最塞：現場收費
全部完成：約 38 分 31 秒
走廊溢出：2 人
```

三個 viewport 全程 **console error 0、pageerror 0**。

### 仍然沒被驗證的（不要當成通過）

- **production URL 本身**（SHA、PWA 安裝、離線、真手機觸控）
- Grok 的獨立盲測觀點——本輪是實作者自己檢查自己，天生有盲點
- 真實現場：E310 尺寸、社團實際物資清單

---

## Round 5（2026-08-21，RC `8e67335`）— Codex review bot 的兩則未結 thread

PR #17 上 `chatgpt-codex-connector` 留了兩則 P2，先逐項查證再處置——**不照單全收**。

| # | 級 | Bot 指控 | 查證結果 | 處置 |
|---|---|---|---|---|
| R5-1 | P2 | 「平均等待」是各站 `avgWaitSeconds` 的未加權平均，沒去的站算 0，數字會失真 | **指控不成立（已被修過）**：`eventFlow.ts` 的 `avgWaitSeconds = totalWaitSeconds / agents.length`，是每人平均；`simPanel` 用的也是這個頂層值，不是站點平均。thread 本身被標 outdated | 補 3 個 unit test 永久釘住（含一個反向斷言：站點未加權平均必須**不等於**它，否則守衛失效） |
| R5-2 | P2 | armed 的區域放置只有成功落地才清除，切換工作流／Escape／取消路徑都不會清，之後點畫布會突然冒出區域 | **大部分不成立、一小段成立**：`cancelPlacement()` 有清、`setWorkflow()` 會呼叫它、Escape 也會、而且畫面上有「取消放置區域」按鈕。**但** `newRoute()` / `newRoutePreset()` / `editRoute()` / `startMeasure()` / `startCalibration()` 直接改 `session.mode`，沒清 `zonePlace`；而 click chain 裡 `zonePlace` 排在 route point 之前 → **舉起區域後開始畫動線，第一下點擊會掉一個區域而不是動線點** | 新增 `enterMode()`：進入繪製／量測模式一律先解除 armed 區域。兩個 e2e 守住 |

**先證明測試抓得到**：把 `enterMode` 的清除拿掉重跑，e2e 如預期失敗（`Received: "registration"`），
放回去才綠。沒有寫一個永遠會過的測試。

Gate：lint ✅ typecheck ✅ unit **242/242** ✅ build ✅ e2e ✅
