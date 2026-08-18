# 平面場 ISO · 3D 等角場佈工具

可安裝的手機／桌面 PWA（不上架 App Store / Google Play）。

## 功能

- 教室／走廊真實尺寸（1 單位 = 1 公尺）
- 可自訂地磚尺寸、原點與方向；交點／邊線／中心／半格吸附
- 現場比例校正
- 小區域（報到、生活組、小組、講師禪定、鞋子、背包）：半透明、可命名、縮放、鎖定、隱藏
- 物件：電腦、門、電燈開關、投影幕、桌子、椅子、地墊、報到桌
- 地墊模擬：先半透明預覽，顯示總數、占用尺寸、區域容量與超界／剩餘空間，再確認擺放
- 動線規劃：多節點折線、方向箭頭、可拖曳節點
- 相機：等角／俯視／正視／左視／右視；圖層可獨立顯示／隱藏
- 選取、拖曳、旋轉、複製、刪除、鎖定、隱藏、框選、復原／重做
- 本機自動儲存與具名平面圖、匯入／匯出 JSON、匯出俯視／動線 PNG
- 可「加到主畫面」當成 App 使用

## 本機開發

需要 Node.js 22+。

```bash
npm install
npm run dev       # 開發伺服器 http://localhost:5173
npm run build     # 產生正式版（含 PWA service worker）
npm run preview   # 預覽正式版
npm run test      # 單元測試（Vitest）
npm run lint      # ESLint
npm run typecheck # TypeScript 型別檢查
```

## 安裝到手機（不上商店）

1. 用手機瀏覽器開啟本站網址（需 HTTPS）
2. **Android Chrome**：選單 →「安裝應用程式」或「加到主畫面」
3. **iPhone Safari**：分享 →「加入主畫面」

安裝後會以全螢幕 App 方式開啟，資料存在本機。

## 技術

- 純前端、無後端、local-first（localStorage 自動儲存）
- Vite + TypeScript + Three.js
- Progressive Web App（manifest + Service Worker，`vite-plugin-pwa`）
- 相對路徑 base，可直接部署到 GitHub Pages 子路徑

完整規格見 [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md)。

## 專業素材與 Quick Agent（PR #11）

- **Asset Catalog**：語意與外觀分離；SceneObject 保留 `kind` 相容，並以 `assetId` 指向 Catalog。
- **自訂素材**：拍照建立簡化 proxy（可立即排場）／匯入 GLB（glTF Transform 最佳化）／本機 IndexedDB 存 binary。
- **Img2ThreeJS**：作為 agent-side reconstruction adapter（不 bundle、不 eval）；精緻模型完成後只替換 visual。
- **Quick Agent**：頂部 `✦ AI` → 建素材／幫我場佈／模擬活動／幫我優化。AI 只能透過 Tool Layer + Preview／套用／取消，並可 Undo。
- 活動模擬核心若尚未合併，Agent 會清楚回報不可用，場佈與 Validation 仍可離線使用。

詳見 [`docs/PROFESSIONAL_ASSET_ENGINE_QUICK_AGENT_PLAN.md`](docs/PROFESSIONAL_ASSET_ENGINE_QUICK_AGENT_PLAN.md)。
