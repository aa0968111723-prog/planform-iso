# 平面場 ISO · 3D 等角場佈工具

可安裝的手機／桌面 PWA（不上架 App Store / Google Play）。

## 功能

- 3D 等角視角場佈模擬（Three.js）
- 研討教室、論壇會議、空白場地模板
- 拖曳移動、旋轉、刪除、復原
- 相機：等角／左／右／正／俯
- 匯出 PNG、本機儲存
- 可「加到主畫面」當成 App 使用

## 本機開啟

直接用瀏覽器開 `index.html`，或：

```bash
python3 -m http.server 8080
# 開啟 http://localhost:8080
```

## 安裝到手機（不上商店）

1. 用手機瀏覽器開啟本站網址（需 HTTPS）
2. **Android Chrome**：選單 →「安裝應用程式」或「加到主畫面」
3. **iPhone Safari**：分享 →「加入主畫面」

安裝後會以全螢幕 App 方式開啟，資料存在本機。

## 技術

- 純前端、無後端
- Progressive Web App（manifest + Service Worker）
- Three.js 0.170（CDN，首次載入後可離線快取）
