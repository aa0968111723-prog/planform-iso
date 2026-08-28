# 我的專案（多專案系統）

一場活動 = 一份專案。新增一份專案永遠不會蓋掉另一份。

這份文件講的是三件事：詞彙、儲存結構，以及三個「順序即契約」的地方
（切換專案、隔離壞掉的資料、寫回索引）。實作在 `src/state/`，
畫面在 `src/ui/projectHome.ts`。

---

## 1. 三個名詞，不能互相取代

| 名詞 | 是什麼 | 存在哪 |
|---|---|---|
| **專案** | 一場活動的整個工作區：場地、地墊、物資、動線、區域、模擬情境 | `planform-iso:project:<id>` |
| **場佈（存過的排法）** | 同一個專案裡的不同排法 | `planform-iso:project:<id>:layouts` |
| **場地模板** | 只有場地幾何和固定設施，不含場佈 | `planform-iso:venues` |

以前只有「平面圖」一個詞，同時扮演專案和排法兩種角色 —— 這就是為什麼
Quick Start 會直接取代畫面上的東西。現在型別本身就把它們分開：
一個 `LayoutVariant` 存的時候會拿掉 `id` 和 `name`，讀回來時才從父專案
重新蓋上，所以一個排法永遠不可能長成第二個專案。

在畫面上：**版本** 這個詞留給 `更多 → 關於` 的建置編號，場佈就叫場佈。

---

## 2. 儲存結構

所有 key 只在 `src/state/projectStorage.ts` 出現一次，`src/`、`e2e/`、
`scripts/` 其他地方都不准再寫一次字面值。

```
planform-iso:projects:index              ProjectMeta[]，updatedAt 由新到舊
planform-iso:projects:index:backup       壞掉時隔離下來的原始 bytes
planform-iso:project:<id>                一份完整的 Project（這份專案的 autosave）
planform-iso:project:<id>:backup         壞掉時隔離下來的原始 bytes
planform-iso:project:<id>:layouts        這份專案存過的場佈
planform-iso:project:<id>:layouts:backup 壞掉時隔離下來的原始 bytes
planform-iso:active                      目前開著的專案 id
planform-iso:projects:migration          舊資料搬家的進度
planform-iso:boot                        "editor" | "home"（e2e 與匯圖腳本用）

舊 key（只讀，保留一個 release，不再寫入）：
planform-iso:autosave, :autosave-backup, :layouts, :layouts-backup
```

### 為什麼還留在 localStorage

實測：一份 E310 golden project 16.4 KiB，十份 164 KiB＝5 MiB 的 3.2%，
天花板約 55 份重量級專案，需求是 10 份。

搬去 IndexedDB 會讓每個讀取變成非同步、boot 變成非同步，而 `pagehide`
上那個同步的 `flushAutosave()` 會變成 fire-and-forget —— 為了一個用不到的
容量上限，換來一個真的會掉資料的視窗。所以不搬。

### index 只放「推導出來的」欄位

`ProjectMeta` 的每個欄位都是從 body 算出來的（名稱、場地、人數、日期），
沒有任何一個是只存在 index 裡的。body 永遠是唯一真相，index 是快取。

這件事是有代價才換來的：**我的專案這個畫面不會 parse 任何一份 body**。
一份壞掉的檔案因此只能弄壞它自己那張卡片，不會白屏整個列表。

---

## 3. 切換專案的順序

`ProjectSession.hydrate(id)`：

```
1. flush()                       ← 這一步就是全部的重點
2. repo.openProject(id)          ← 失敗就裝上 NULL_PERSISTENCE 並留在原地
3. store.setPersistence(...)     ← 一定在 loadProject 之前
4. activeId = id
5. store.loadProject(p, { undoBeforeLoad: false })
6. onProjectOpened → App.adoptProject
```

第 1 步 `flushAutosave()` 會**取消那個 400ms 的 timer**，並用「舊的」
persistence 把舊專案同步寫下去。

少了它會怎樣：切換之後那個過期的 timer 才 fire，它讀 `this.project` ——
那時候已經是新專案了 —— 然後透過「現在的」persistence 寫進新專案的 key。
看起來什麼事都沒發生，實際上舊專案最後 400 毫秒的編輯就這樣消失了，
而且沒有任何地方會報錯。

第 5 步的 `undoBeforeLoad: false` 會清掉 undo stack。這不是順手做的：
沒清的話，在 B 專案裡按 undo 會把 A 專案的狀態叫回來，然後自動存進 B 的
key —— 一個跨專案的無聲汙染。

---

## 4. 壞掉的資料：隔離，不刪除

`quarantine(primaryKey, backupKey)` 的四步順序是契約：

1. 原本就沒東西 → 什麼都不碰。
2. 備份已經存在 → 刪掉主 key，但**保留比較舊的那份備份**。
   新的一次損壞不可以蓋掉可能還救得回來的舊備份。
3. 備份寫入丟例外（配額滿）→ 主 key **原封不動**。
   硬碟滿了不可以變成「刪掉使用者唯一一份資料」的理由。
4. 只有備份成功寫入，才有資格刪掉主 key。

配合這個：

- **body 壞掉** → 只隔離那一支 key，卡片標成需要復原，⋯ 只提供
  「下載這份的原始資料」和「刪除」。其他專案完全不受影響。
- **index 壞掉** → 隔離後從磁碟上的 body 重建。重建**只會新增**，
  不會因為某個條目沒有 body 就把它刪掉 —— 沒有 body 正是「已被隔離」
  的樣子，刪掉它就等於丟掉那份備份的唯一線索。
- **排法壞掉** → 隔離後回傳 `{}`，而且不會把 `{}` 寫回去。

刪除專案時，tombstone 會把 body、backup、layouts、layouts:backup 四份
raw string 全部帶走，所以連「刪掉一張壞掉的卡片」都復原得回來。

---

## 5. 舊資料搬家

`runLegacyMigration()`，開機第一件事，永不丟例外，永不刪除舊 key。

- 舊的 `planform-iso:autosave` → 一份專案。
- 舊的 `planform-iso:layouts` 裡**每一個** entry → 各自一份專案。
  （搬家之前，Quick Start 本來就把它們當「已存的平面圖（直接載入整份
  場佈）」在用，所以它們本來就是專案。）
- 去重**只認完全相同的 body**。

最後那一條是刻意的。`saveNamedLayout` 以前會把名字同時寫進 layout 和
當下的專案，所以 autosave 和最後存的那個 layout 永遠同名、四個數量也
全部一樣，通常只差在物件的位置。用 name + 數量去判斷重複，會刪掉
使用者刻意存的那個存檔點，而且救不回來。多留一份重複的成本是 5 MiB 裡的
16 KiB；刪掉一份專案的成本是全部。不對稱，所以不確定就兩份都留。

進度每完成一項就寫一次（不是最後才寫一次），所以在第 8 項裡的第 3 項
失敗時，下次開機是從第 4 項接下去，而不是永遠卡住。

舊的三支 key 一份都不刪，留一個 release 當冷備份。`clearLegacyKeys()`
已經寫好但**沒有接到任何按鈕**，而且它拒絕在遷移未完成時執行，也永遠
不會刪掉 `:autosave-backup`（那是「損壞前的備份」的來源，不是舊資料）。

---

## 6. 我的專案這個畫面

模仿夥伴模式，不是模仿 Quick Start：`#app[data-screen="home"]` 一個屬性，
加上一段把編輯器 chrome `display:none` 的 CSS。因為它是常駐、可以再進來的
畫面，而 Quick Start 那種「自己把自己移除」的 overlay 不是這個形狀。

- Canvas 是 `display:none` 而不只是被蓋住：`SceneManager` 有一個常駐的
  animation loop，`App` 也把 pointer handler 綁在 canvas 上，只蓋一層
  overlay 會讓兩者都還活著。
- 欄數走既有的 `data-ws-mode`：手機 1 欄、平板 2 欄、桌機 3 欄（最寬 1100px）。
  **沒有新增任何 `@media` query**，`src/` 裡本來就一個都沒有。
- 任何寬度都不會出現 sidebar，也不會出現表格。
- z-index 35：在 topbar(25)、rails(18)、compact sheet(26)、夥伴模式(30/32)
  之上；在 toast(40) 之下（刪除後的「復原」要看得見）、wizard(50) 之下、
  menusheet(60) 之下（卡片的 ⋯ 要開得起來）。
- 在這個畫面按 Delete / `d` / 方向鍵不會有反應：專案還開著、autosave 還活著，
  沒有這個 guard 的話使用者會在看卡片的時候改到自己的場佈。

---

## 7. 測試

- `test/projectRepository.test.ts` — 兩份專案各自一支 key、壞掉一份不影響
  其他、備份不被覆蓋、配額滿時不刪原始 bytes、index 自我修復只新增、
  排法壞掉不清空、複製整份帶走、刪除還原 byte-identical、跨分頁 merge。
- `test/projectSession.test.ts` — 編輯 A → 切到 B → 切回 A 原封不動、
  刪掉正在編輯的專案不白屏也不寫回已刪除的 key、重新命名不會被 autosave
  改回去、載入其他排法前會先保留目前的、blocked storage 不丟例外。
- `test/legacyMigration.test.ts` — 舊資料各自變成專案、只有位置不同不算重複、
  跑第二次不會複製、中斷後接得下去、舊 key 全部還在。
- `e2e/projects.spec.ts` — 三個專案（含 E310 範例）來回切換不互相污染、
  reload 後都在、壞掉的 index 從 body 復原、Quick Start 不會問「要取代嗎」、
  第一次開 app 只會有一份、手機單欄／平板兩欄、刪除後的復原按得到、
  在我的專案按 Delete 不會動到專案。

---

## 8. 沒有做的事，以及為什麼

- **登入 / 雲端 DB / team backend** —— 明確不做。維持 local-first。
- **縮圖** —— P2。渲染縮圖需要在 Home 開一個離屏 canvas，而 Home 存在的
  理由之一就是不用碰 3D。
- **同一份專案在兩個分頁同時編輯** —— 仍然是 last-writer-wins，和搬家前
  一模一樣（`planform-iso:autosave` 本來就每 400ms 整份覆蓋）。跨分頁
  的「專案清單」不會互相蓋掉，因為 `flushIndex()` 每次都跟磁碟 merge。
- **複製時連 IndexedDB 的素材 blob 一起複製** —— blobId 是共用的。複製一份
  專案不應該讓自訂素材的儲存空間翻倍。
