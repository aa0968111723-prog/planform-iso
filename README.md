# 平面場 ISO · 活動場佈（Planform 1.0）

> 快速製作活動場刊圖 / 場佈圖 / 動線圖，
> 讓夥伴清楚知道東西放哪裡、人怎麼走、自己負責哪裡。

可安裝的手機／平板／桌面 PWA（不上架商店）。為淡江大學教室、
禪學社社課／茶會／演講／新生活動的真實現場而做：報到、收費、引導、
鞋子、背包、入座、地墊與工作人員配置。

**Preset-first, fully customizable** — 預設非常方便，但一切仍可自訂。

## 一般使用（不用懂 CAD / 3D / 工程參數）

1. **快速開始**：今天要排什麼？→ 選「淡江教室模板」／我之前的場地／空白場地
2. 勾需求（地墊、報到、收費、鞋子區、背包區…）＋ 輸入人數 → **建立場佈**
3. 直接在畫布上拖曳調整；「排地墊」選 20/30/40/60 人一鍵出 A/B/C 方案
4. 畫動線：選 入場/報到/收費/鞋子/背包/入座 → 在畫布上點一點 → 完成
5. **分享**：場佈總覽圖 / 動線圖 / 地墊座位圖 / 工作分區圖 / 物資清單圖 /
   夥伴觀看圖 — 手機直接開分享傳 LINE
6. **夥伴模式**：給夥伴的唯讀視圖（全部/報到組/收費組/引導組/生活組），
   10 秒看懂自己站哪、人從哪來、下一步去哪，一鍵存成圖

## 功能總覽

- 淡江教室 / 一般矩形 / 空白 場地模板 ＋「儲存為我的場地」
- 教室／走廊真實尺寸（1 單位 = 1 公尺）、地磚吸附、現場校正
- 常用物資庫（地墊/桌椅/報到桌/收費桌/投影幕/鞋架/指示牌…）＋
  我的素材（拍照建立 proxy、匯入 GLB/GLTF）
- 區域（報到/收費/鞋子/背包/生活組/講師/小組/自訂）：點畫面放置
- 排地墊：人數 → A／B／C，或「家族圈」拆成各家族座區，看圖套用
- 動線：畫布點選節點、粗箭頭、①②③、起點/終點
- **活動流程模擬（本地 DES）**：人數/現場繳費/人力/到齊時間，加上 A–E 報到精靈與一鍵分流 →
  最多排隊、平均等待、最塞的站、全部完成時間 → ✦ 幫我改善
- ✦ AI 幫我：排場佈/排地墊/畫動線/檢查/改善/夥伴圖 — 一律先預覽再套用。
  沒金鑰用離線規則；更多 → 雲端 AI 可貼 OpenAI 相容金鑰
- 檢查中心：超界/重疊/擋門/走道過窄/視線 等規則（門檻在進階可調）
- 三段 Responsive Workspace（手機 ≤600 / 平板 601–1199 / 桌機 ≥1200），
  Canvas-first、單列 Header、Bottom Sheet
- 本機自動儲存（含損壞自動備援）、專案內版本快照、JSON 匯入匯出
- PWA：本機／preview 可離線；更多 → 加到主畫面；有新版本時提示更新
- 兩個分頁開同一份專案：較新的寫入不會被默默蓋掉
- 剩下的環境限制：[`docs/PRODUCT_LIMITATIONS.md`](docs/PRODUCT_LIMITATIONS.md)

## 本機開發

需要 Node.js 22+。

```bash
npm install
npm run dev       # 開發伺服器 http://localhost:5173
npm run build     # 產生正式版（含 PWA service worker 與 version.json）
npm run preview   # 預覽正式版
npm run test      # 單元測試（Vitest）
npm run test:e2e  # 瀏覽器測試（Playwright，含 10 viewport + Golden Flows）
npm run lint      # ESLint
npm run typecheck # TypeScript 型別檢查
npm run verify    # lint + typecheck + test + build 一次跑完
```

## 部署

`main` 推送後由 GitHub Actions 建置並發佈到 GitHub Pages
（`.github/workflows/deploy.yml`；相對路徑 base，子路徑可直接運作）。
也可將 `dist/` 部署到任何靜態主機（Zeabur 等）。

## 安裝到手機（不上商店）

1. 用手機瀏覽器開啟本站網址（需 HTTPS）
2. **Android Chrome**：選單 →「安裝應用程式」或「加到主畫面」
3. **iPhone Safari**：分享 →「加入主畫面」

## 技術

- 純前端、無後端、local-first（localStorage 自動儲存 + IndexedDB 素材）
- Vite + TypeScript + Three.js；Progressive Web App（`vite-plugin-pwa`）
- 完整規格：[`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md)、
  Workspace 架構：[`docs/RESPONSIVE_WORKSPACE.md`](docs/RESPONSIVE_WORKSPACE.md)、
  夥伴模式：[`docs/PARTNER_MODE.md`](docs/PARTNER_MODE.md)
