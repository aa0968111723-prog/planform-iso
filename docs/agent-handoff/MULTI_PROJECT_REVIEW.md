# 多專案系統 — 審查與驗收紀錄

對象：`release/planform-1.0-rc`（多專案系統），對照 `origin/main` = `5cfb4a4`。

---

## 1. Claude CLI 對抗式審查

實際執行（不是自評）：

```bash
claude -p --allowed-tools "Read,Grep,Glob" < review-prompt.txt
```

要求它自己讀 `src/state/*`、`src/ui/projectHome.ts`、`src/ui/quickStart.ts`、
`src/main.ts`、`model.ts`/`migrate.ts` 的 v8 改動與 `style.css`，逐條驗證八項
需求並主動找 race condition、資料遺失路徑、白屏路徑與靜默失敗。

### 需求判定（審查者給的）

| # | 需求 | 判定 |
|---|------|------|
| 1 | 新專案不取代／覆蓋既有專案（含 Quick Start、匯入 JSON） | PASS |
| 2 | 主鍵是穩定 id，不是名字 | PASS |
| 3 | 每專案獨立 autosave；切換不遺失、不串 key | PASS |
| 4 | 舊資料（`:autosave` / `:layouts`）不遺失 | PASS |
| 5 | 一份損壞不牽連其他專案、不清空列表 | PASS（附一項 RISK） |
| 6 | 刪除可復原，且復原完整（含隔離的原始 bytes） | **FAIL** |
| 7 | 沒有登入 / 雲端 DB / 後端 | PASS |
| 8 | 沒有新增 `@media`，欄數走 `data-ws-mode` | PASS |

### 四個 finding，四個都修了

**🔴 高 — 連續刪兩個專案，第一個永久遺失。**
`tombstone` 是單一欄位。刪 A（磁碟 key 已清空，記憶體裡是唯一副本）之後、
還沒按復原就刪 B，`tombstone` 被覆蓋，A 的 bytes 隨 GC 消失。這是完全正常的
「順手清掉兩個舊專案」操作，而且沒有任何錯誤訊息。

修法：`tombstones` 改成陣列（上限 10，記憶體預算而非儲存預算），
`undoDelete(id?)` 依 id 還原，toast 的復原 chip 綁定「它自己那一次刪除」的 id。
新測試：`test/projectSession.test.ts`「連續刪兩個專案，兩個都還原得回來」。

**🟠 高 — boot 失敗時裝上 no-op sink，「自動儲存失敗」橫幅永遠不會出現。**
`bootstrap()` 的 catch 裝 `NULL_PERSISTENCE`，而它的 `saveProject` 是空函式、
永不 throw，所以 `Store` 的 latch 不會觸發。儲存空間被封鎖或已滿時，使用者會
在一個看起來完全正常的編輯器裡一直編輯，而每一次自動儲存都寫進一個什麼都不做
的函式。搬家之前 `localStorage.setItem` 會 throw、橫幅會出現 —— 這是這次改動
造成的退步。

而且我原本寫的測試斷言 `errors === 0`，等於把這個錯誤行為鎖了起來。

修法：新增 `UNAVAILABLE_PERSISTENCE`（每個寫入都 throw），只用在 boot 失敗
這條路徑；`NULL_PERSISTENCE` 仍然用在「沒有專案開著」（刪掉正在編輯的那份）
的情況，那裡靜靜丟掉寫入才是對的。測試改成斷言 `errors === 1`、`recovered === 0`。

**🟡 中 — 兩個分頁同時 flush index，其中一筆可能從清單消失。**
`flushIndex()` 的 read-modify-write 在純 localStorage 上做不到原子。兩個分頁的
`pagehide` 幾乎同時觸發時，慢的那個會用比較舊的快照覆蓋掉快的那個剛寫進去的
entry。body 還在磁碟上，但條目不見了，而 `rebuildFromDisk()` 只在 index 整體
為空時才觸發。

修法：新增 `ProjectRepository.reconcile()`，`bootstrap()` 每次載入呼叫一次
（不是 render 路徑），把「body 在磁碟上但 index 沒有」的專案接回來。這同時
也修好了「index 寫入失敗但 body 寫入成功」留下的孤兒。
新測試：「index 條目掉了但 body 還在時，開機會把它接回來」。

**🟢 低 — Quick Start 送出鈕沒有防連點。**
快速雙擊「建立場佈」時，第一次填滿 pristine 專案、第二次因為 id 已用掉而另外
建一份，使用者會多出一張沒要求的卡片。修法：`showQuickStart` 內加 in-flight guard。

審查者也明確指出「沒找到問題」的部分：id 唯一性、body 為準的方向、
quarantine 四步、rename/duplicate 兩條路徑、CSS 欄數切換。

---

## 2. Grok 盲測（§19）— **沒有執行，原因如下**

這個容器的出站代理擋掉 x.ai：

```
$ curl -sS https://api.x.ai/v1/models
curl: (56) CONNECT tunnel failed, response 403
$ curl -sS https://grok.com
curl: (56) CONNECT tunnel failed, response 403
```

環境裡也沒有 `XAI_API_KEY`。這一項**沒有做**，也不會假裝做過。

要在有網路的機器上補跑，盲測題目應該是（不要先給它結論）：

1. 開 app，把你看到的第一個畫面描述出來，然後想辦法建立兩場不同的活動。
2. 在第一場活動裡放幾個區域，切到第二場，再切回來。第一場的東西還在嗎？
3. 想辦法讓同一場活動有兩種不同排法，並在兩者之間切換。
4. 把其中一場活動刪掉，然後想辦法救回來。
5. 用 devtools 把 `planform-iso:project:<某個 id>` 的內容改成 `{壞掉的`，
   重新整理。哪些東西還能用？哪些不能？你能把原始資料拿出來嗎？
6. 在手機尺寸（390×844）重做 1–4。有沒有任何地方要橫向捲動、
   或是點不到的按鈕？

---

## 3. Release gate（§21）

在這個容器裡實際跑過的：

| 項目 | 結果 |
|---|---|
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run test`（Vitest） | PASS — 33 檔 286 測試 |
| `npm run build` | PASS |
| `npm run test:e2e`（Playwright，10 viewport + Golden Flows + 多專案） | PASS — 83 測試 |
| `node scripts/prodSmoke.mjs`（正式 bundle，本機 preview） | PASS — 15/15 |

prodSmoke 的 15 項包含「離線重新整理仍然開得起來，而且看得到專案」，
這一項同時驗證了每專案儲存在離線開機路徑上也成立。

已知的既有 flake：`Golden Flow 1` 在一次完整 suite 中失敗過一次，卡在
`helpers.ts` 的 `settle()` —— 它會先等 350ms 取一個「期望值」，再要求該值
維持 5 秒；當側欄正好在那 350ms 內還在動，期望值就取到了過渡中的位置。
之後三次完整執行（單獨、整個 golden.spec、整個 suite）都通過。這是 helper
本身的時序弱點，不是這次改動造成的，但也還沒修。

線上 smoke（`https://<zeabur>`）**沒有跑**：同一個代理也擋掉那個 host。
