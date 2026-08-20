# WP-C：場刊圖可讀性（Release P0 output）

目標：一張圖傳 LINE，夥伴用手機不縮放就能看懂。依 export audit 結果修。

## P1

1. **紙上配色**（planSymbol.ts:173,194-198）：drawPlanSymbolOverlay 加 theme
   （"paper" | "dark"）。paper：文字 #0f172a＋白 halo（strokeText），外框 #334155，
   fill alpha 提高到 ~0.8。縮圖（dark 底）維持原樣。報到桌/收費桌/鞋架/講台標籤
   必須在白底上清楚。
2. **字級地板**（constructionPlan.ts）：以「LINE fit-width ≈ 1080px 手機」為準：
   區域名 ≥20px、路線名/序號徽章 ≥18px、圖例/物資清單 ≥16px、地墊編號 ≥14px、
   scale bar/校正 footer ≥16px（邏輯 px，1400 頁寬）。徽章圓半徑同步放大。
   匯出後仍不得跑版（列印 A4 也要合理）。
3. **分組圖標題**（UI.ts:795-798）：四張任務圖傳 titleSuffix（報到組/收費組/引導組/生活組），
   標題呈現「工作人員配置圖 · 報到組」。
4. **3D 場佈圖**（SceneManager.ts:1032-1040）：離屏 renderer 固定 2560px、
   fitBounds(整個 classroom+corridor) 後截圖，再還原相機。不受使用者當下 zoom 影響。

## P2（全修）

- 頁面 fit bounds 納入可見 route points / objects / zones（constructionPlan.ts:141-147）。
- staff preset 也畫路線序號徽章（:386-405）。
- drawDoor 印「入口」文字 pill（至少 entry route 起點最近的門）（:465-477）。
- 物資清單 mini-plan 以 scale 解析度繪製（:291-303）。
- 物資清單截斷時印「還有 N 項未列出」（:274-287）。
- 圖例改用實際 catalog entries（顏色/名稱與畫面一致）（:549-575）。
- 動線圖以低 alpha 畫地墊/巧拼群組（:203-209 comment 已承諾）。
- 校正 footer 字級隨 #2 調整；區域名/路線名長字截斷或縮字避免壓線（:371,408）。

## 驗收

- [ ] verify 綠＋既有 export e2e 綠
- [ ] 產出六種圖各一張存 docs/release-1.0/（用 E310 golden scenario），
      模擬手機寬度檢視文字可讀（不縮放）
- [ ] 白底上所有桌面標籤肉眼可辨（對比 ≥ 4.5:1 目測）
- [ ] 四張分組圖標題含組名；3D 圖含完整教室＋走廊
