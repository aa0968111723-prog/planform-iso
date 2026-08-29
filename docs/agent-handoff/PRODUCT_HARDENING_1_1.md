# PLANFORM 1.1 — Product Hardening / Defect Zero Contract

## 0. Scope

本輪先停止 Feature Expansion。

不要再新增新的產品方向，直到目前網站在桌面、平板、手機都達到正式產品品質。

本文件把「缺陷」定義為：

- 功能宣稱成功但實際沒有作用
- UI 能操作但資料沒有保存／reload 後消失
- 編輯器與匯出結果不一致
- 場景、互動、模擬與實際資料脫節
- 錯誤／容量不足／損壞資料時會靜默失敗
- 手機／平板主要流程無法完成
- 視覺層級讓第一次使用者找不到主要操作
- 使用未校正資料卻顯示成真實精確值
- 測試沒有涵蓋真實組合路徑而產生假綠燈

「尚未實作的新能力」不是 defect；不要把所有未來想法塞進這一輪。

---

## 1. Current baseline

基線 branch：`main`

建立本文件時 main head：`26d839569b850f45aa4d897b92b5460e61bcfb91`

目前主要能力已包含：

- 多專案
- 場地／場佈／動線
- E310 與走廊 Golden Scenario
- Prop Studio / 自訂道具
- 通用互動流程
- 攤位排版與人流
- 文宣、背景牆、貼圖與印刷規格
- 夥伴模式
- 場刊輸出
- PWA / offline / version.json

因此這一輪的核心不是「再加功能」，而是把現有能力全部串好、驗真、變成熟。

---

## 2. P0 — 假成功 / 沒真的作用 Audit

全站逐一驗證：

> 操作 → state 真的改變 → 畫面真的改變 → autosave → reload → reopen → export 仍正確

至少覆蓋：

- 建立／修改／刪除 Project
- 切換 Project
- 快速開始
- 上傳素材
- 圖片貼到 Prop／海報／背景牆
- Prop Studio 修改已放置道具
- 儲存我的道具
- GLB/GLTF 匯入
- 場地校正
- 地墊排列
- 區域／動線
- 互動流程
- 彩排／模擬
- AI 預覽 → 套用 → Undo
- 分享／PNG／物資清單／送印清單

任何 `ok: true`、toast 成功、按鈕完成，如果真實 state / render / export 沒改，都列 P0/P1。

---

## 3. P0 — Data durability

重新跑：

- rapid project switch
- pagehide / reload
- browser reopen
- duplicate / rename / delete / undo
- storage quota full
- corrupt project
- corrupt prop
- legacy migration
- multi-tab index merge
- AI preview crossing projects

要求：

- 不靜默遺失
- 一份損壞不拖垮其它份
- 儲存失敗一定有人話提示
- primary / backup / quarantine 邏輯不會先刪唯一副本

---

## 4. P0 — Production / PWA

每次候選 Release 必須驗：

- GitHub main SHA
- CI run
- `/version.json`
- Zeabur 實際 commit
- service worker update
- stale cache
- offline boot
- installed PWA update

Production 不能只靠 localhost 綠燈。

---

## 5. P1 — UI/UX consolidation

正常使用只需要理解：

> 我的專案 → 場地 → 場佈 → 動線／互動 → 彩排 → 分享

優先處理：

- Project Home 第一分鐘體驗
- 新建專案三步內完成
- 空狀態
- Loading
- Error
- Storage full
- Offline
- PWA update
- Prop Studio 第一分鐘體驗
- 工作流程 Sheet / Bottom Nav
- 手機 Back 行為
- Tablet Canvas coverage

禁止把工程名詞移到第一層。

---

## 6. P1 — Visual realism

目前功能多，但視覺品質必須與功能量匹配。

優先：

- 禪學社地墊真實感
- E310 / 走廊空間層次
- 攤位場景
- 桌椅與小物接觸地面感
- 材質 roughness / lighting / contact shadow
- 道具不是 generic gray box
- 圖片貼圖不失真、不被材質底色染髒
- labels 不重疊
- queue / people / staff 一眼可辨

所有真實度判斷優先依本機／使用者實際資料；沒有資料標 `estimated / 待校正`。

---

## 7. P1 — Mat realism

地墊是核心品牌場景物件。

驗：

- 真實顏色
- 泡棉／巧拼材質
- 厚度
- 拼接感
- 排列方向
- 中央走道
- 講師留白
- 門口留白
- top-down / 3D / export 三邊一致

若看起來仍像 generic colored square，視為 Visual Gate 未通過。

---

## 8. P1 — Booth simulation parity

攤位方案比較不能拿室內報到模型假裝成攤位結果。

確認：

- passers-by
- stop / skip
- join
- dwell
- balk
- queue containment
- interaction station capacity
- staff capacity
- placement / queue lane 對結果有實際影響

如果 `booth` 模式的 UI 顯示攤位專屬語意，但核心仍走錯模型，列 P1。

---

## 9. P1 — Prop Studio hardening

驗：

- definition ↔ placed instance 同步規則
- 已放置道具編輯真的生效
- 我的道具版本不靜默覆蓋較新版本
- artwork blob lifetime
- texture cache / failure cache
- ImageBitmap / Texture dispose
- preview WebGL context cleanup
- group transform / rotation
- anchors 跟隨 transform
- hidden prop 不瞬移
- reload 後 catalog extras 可重建
- export 能看到 custom prop

---

## 10. P1 — 3D performance / memory

壓力測：

- 100 mats
- 100 chairs
- 50 props
- 10 interactive props
- 100 active participants
- multiple high-resolution artwork textures
- rapid project switching

觀察：

- FPS / frame time
- JS heap
- WebGL texture / geometry / material growth
- old project resources 是否釋放
- repeated scene rebuild 是否累積

禁止為了 3D 質感讓一般手機不可用。

---

## 11. P1 — Export is a product, not a screenshot

PNG / 場刊圖：

- 無 editor chrome
- 無 selection
- 無 anchors
- 無 debug
- 中文不切字
- labels 避讓
- route / step readable
- custom props visible
- artwork visible
- mat color matches editor
- LINE 手機預覽仍看得懂

送印資訊：

- 尺寸來源誠實
- mm / meters 單向推導
- quantity follows actual placed items/order settings
- resize does not distort support structure unexpectedly

---

## 12. P1 — Real-device acceptance

至少手動／browser device pass：

Phone:
- 360×800
- 390×844
- 412×915

Tablet:
- 768×1024
- 800×1280
- 1024×768

Desktop:
- 1366×900

每個 viewport 實際走：

- Project Home
- new project
- place object
- upload image
- create/edit prop
- route
- rehearsal
- export/share

不得只測元素存在。

---

## 13. P2 — Brand polish

依 `docs/brand/BRAND_SYSTEM.md`：

- 統一 PLANFORM 命名
- 空狀態、錯誤狀態、更新提示一致
- iconography 一致
- spacing / typography hierarchy
- micro motion
- project card / sheet / toolbar polish
- PWA metadata / browser title / app header 一致

P2 不得阻塞 P0/P1 修復。

---

## 14. Adversarial review loop

Codex = Lead / implementation / integration

Claude CLI = architecture / UX / visual reviewer

Grok CLI = first-time-user / realism / field tester

循環：

> Grok 找問題 → Codex 重現 → Codex 修 → Tests → Claude review → Grok 重測

AI finding 必須重現；不能看到 AI 說有問題就直接改。

---

## 15. Test gate

每個候選 commit：

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e
```

再跑 production bundle smoke。

關鍵 defect test 必須做 mutation check：把修正暫時拿掉時測試真的會紅。

---

## 16. Release definition

只有當下面問題都能回答 YES，才可標 Release Ready：

1. 每個主要按鈕都真的改到資料與畫面嗎？
2. Reload / reopen 後資料都還在嗎？
3. 手機和平板能完成主要流程嗎？
4. 地墊、場景、道具看起來像真實活動，而不是 prototype 嗎？
5. 攤位與教室模擬使用正確模型嗎？
6. 場刊圖可以直接傳給夥伴嗎？
7. PWA 更新不會讓使用者卡在舊版嗎？
8. 一份壞資料不會害其它專案嗎？
9. Production SHA 與 main 一致嗎？
10. PLANFORM 品牌在 Browser / PWA / App / Export 的說法一致嗎？

沒有全部通過，不要宣稱「所有缺陷已補完」。
