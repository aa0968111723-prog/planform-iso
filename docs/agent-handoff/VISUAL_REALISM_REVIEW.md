# PR #19 Visual Realism Review

更新：2026-08-24（Asia/Taipei）
範圍：`release/planform-1.0-rc`，PR #19；本輪不 merge。

## 結論

**PASS WITH NOTES**。Release P0「回首頁後 3D 白屏」與本輪確認的視覺 P1 均已修復；目前沒有已知 P0 / P1。剩餘項目是 P2 視覺精修、真機 production smoke，以及 E310 現場尺寸校正。

本輪不是把畫面換皮，而是把同一套實景語意貫穿 Project Home、編輯器、俯視、3D 與六張場刊圖：粉紅走廊、黃色導盲帶、米灰教室磁磚、深綠講台、連續綠色巧拼、教室內報到、左右鞋區、課桌椅背包區、講師禪定區與生活組區。

## Evidence gate

- 已逐張檢視 `D:\場務場刊E310` 的 11 張 E310 照片與 88 張活動照片；照片不得 commit。
- 精確檔名到設計決策的索引在 `docs/field-research/REFERENCE_MAPPING.md`。
- 照片支持「教室內報到、鞋沿巧拼側邊、背包放側邊課桌椅、連續綠色巧拼」。它們不支持走廊排隊鏈、入口收費桌或鞋架，因此 Golden Scene 不再呈現這些推測。
- 場地尺寸仍是照片推導起點，所有輸出保留「尺寸待現場校正」。

## 自審 gate

逐一檢視下列產物，結果皆可辨認為同一個 E310 禪學社場景：

| 產物 | 結果 |
|---|---|
| Project Home | 成熟品牌首頁、明確 CTA、活動卡片與 3D 預覽語言；手機單欄、平板雙欄、桌機三欄 |
| 一般編輯器 | 微立體教室、材質與功能區可辨；Home → Editor 往返不再白屏 |
| 俯視 | 教室／走廊拓撲、巧拼格線、功能區與物件保持一致 |
| 3D 場佈圖 | 紙面標題、微立體視角、講台／桌椅／地墊／走廊材質可辨 |
| 場佈總覽圖 | 30 人 Golden、70 片巧拼、雙鞋區、背包／報到／生活組位置可讀 |
| 夥伴觀看圖 | 起 → 報到 → 右鞋區 → 背包 → 後側通道 → 座區；編號置頂且不穿越巧拼 |

## Claude CLI review

依需求實際嘗試 Claude CLI：

```text
npx --yes @anthropic-ai/claude-code --version
2.1.241

Not logged in · Please run /login
ANTHROPIC_API_KEY is not set
```

因此本輪**沒有 Claude-authored review**，也不冒充已完成。阻斷是這台機器沒有 Claude 登入／API key；其餘自審與 Grok 盲測均照常完成。

## Grok blind test

Grok 只收到匿名檔名 `scene-a.png`、`scene-b.png`、`scene-c.png`，未提供 repo、文件、產品名稱或設計結論。它正確推斷：

- 場景是大學教室與走廊相連的 E310 類空間；
- 活動是約 30 人的禪修／冥想社課；
- 核心設施是綠色拼接巧拼；
- 流程是走廊入場、門口進教室、報到、背包／鞋子處理、再進座區。

原始 verdict：**PASS WITH NOTES**，0 P0。盲測提出的 P1 與處置如下：

| Finding | 處置 |
|---|---|
| 夥伴動線略過鞋區且穿越巧拼 | 已改為入口 → 報到 → 右鞋區 → 背包 → 後側通道 → 巧拼後緣 |
| 右側鞋／背包／生活組標籤溢出或截斷 | 已縮短標籤、夾限寬度，路線頁將編號最後繪製 |
| 3D 背包標籤截斷 | 已改為「背包｜課桌椅」並調整標籤寬度 |
| 講台和巧拼同綠、層次不足 | 講台改深綠並加黑色前緣 |
| 2D 看不出投影幕 | 加入前牆投影幕線與標籤 |
| 左右鞋區同色難分 | 左側黃、右側橘，名稱明確標左右 |
| 門鄰近服務區，動線可能混淆 | 30 人 Golden 已把主要流程收進教室，入口留出直接轉向報到的空間 |

修復後再目視確認，以上 P1 均關閉。剩餘 P2：3D 圖不畫個別座位方向、教室區名對比可再提高、程序式人物／布料／木材仍未達寫實渲染器等級；這些不阻擋本次 RC。

## 跨裝置與效能

新增 `e2e/visualRealism.spec.ts`，覆蓋 9 組：30 / 60 / 100 人 × phone 390×844 / tablet 834×1112 / desktop 1440×1000。

- 9 / 9 通過。
- 每組皆驗證 WebGL 有持續出幀、無水平溢出、無 console error / pageerror。
- 100 人沿用 InstancedMesh；陰影圖降為 512，避免軟體 WebGL 的不必要負擔。
- 這是桌面 Chromium / SwiftShader 的持續出幀 gate，不宣稱等同真機 FPS；真手機 GPU 與 production URL 仍需 smoke。

## Release assets

六張 Golden 圖已由 app 真實匯出並寫入 `docs/release-1.0/`：

- `e310-overview.png`
- `e310-3d.png`
- `e310-routes.png`
- `e310-mats.png`
- `e310-inventory.png`
- `e310-partner.png`

30 人是對照片最忠實的視覺 Golden；60 人保留為流程壓力測試，100 人保留為 crowd / rendering 壓力測試。

## Remaining gates

- E310 地磚、門寬、房間長寬仍需現場校正。
- Claude CLI 需使用者登入後補跑獨立審稿。
- production URL、PWA、離線與真手機觸控需在部署後 smoke。
- PR #19 保持 open，未 merge。
