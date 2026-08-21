# 本機真實參考資料盤點（LOCAL REFERENCE AUDIT）

依 `docs/field-research/REAL_REFERENCE_CONTRACT.md` §3 執行。

- 執行者：Claude（Lead）
- 執行時間：2026-08-21
- 執行環境：**Claude Code on the web — Linux 雲端容器**（`/home/user/planform-iso`，ephemeral）
- 對象 branch：`release/planform-1.0-rc`（PR #17）

---

## 0. 一句話結論（必讀）

> **本次盤點在雲端容器執行，容器內「找不到任何使用者本機的真實照片、場刊圖、場佈圖或活動 JSON」。
> 因此本輪不新增任何宣稱「照片實測」的新數字。**
> 既有以照片推導的內容（E310 拓撲、巧拼綠色、0.9 m 座距）**來自前一輪在使用者 Windows 機器
> （`D:\planform-iso` / `D:\場務場刊E310`）上執行的 agent**，本檔如實標記其來源與可信度，
> 並提供 `scripts/audit-local-references.ps1` 讓使用者在自己的機器上補完真正的第一手盤點。

**沒有做的事（誠實聲明）**：沒有讀到原始照片、沒有量測照片、沒有據此產生新的「真實尺寸」。

---

## 1. 執行環境事實

| 項目 | 實際狀況 | 影響 |
|---|---|---|
| 作業系統 | Linux（容器），非使用者的 Windows | `D:\` 磁碟不存在 |
| 家目錄 | `/root`、`/home/user` | 無 `Documents` / `Pictures` / `Downloads` / `Desktop` |
| 掛載點 | `/mnt/user-data/working`（空）、`/mnt/attach`（空） | 使用者未附加任何檔案 |
| repo 來源 | 容器啟動時 fresh clone | 只有已 commit 的內容 |
| `D:\場務場刊E310` | **不存在於本環境** | 空教室照與活動實況照無法讀取 |

前一輪的 `docs/agent-handoff/CURRENT_STATE.md` 明確記載工作目錄為 `D:\planform-iso`，
`docs/e310/E310_GOLDEN_SCENARIO.md` §1 明確記載照片位於 `D:\場務場刊E310`。
兩者都在使用者本機，**不在本容器**。

---

## 2. 實際執行的搜尋（可重現）

### 2.1 圖檔／文件掃描

```bash
for d in /home /root /mnt /media /srv /opt /data /workspace; do
  find "$d" -maxdepth 6 \
    \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.webp' \
       -o -iname '*.pdf' -o -iname '*.glb' -o -iname '*.gltf' \) \
    -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/.cache/*' 2>/dev/null
done
```

### 2.2 關鍵詞掃描

```bash
grep -rIl -e 'E310' -e '淡江' -e '禪學社' -e '場刊' -e '場佈' \
  /home /root /mnt/user-data /mnt/attach 2>/dev/null
```

### 2.3 合約要求的安全邊界（已遵守）

- **未**讀取 `.env`、`.aws`、`.ssh`、`.gitconfig` 憑證、token、private key、瀏覽器 credential store。
- **未**進入與本專案無關的私人文件；掃描僅比對副檔名與上述關鍵詞，命中才進一步檢視。
- 命中的 `~/.claude/projects/*.jsonl`（本次工作階段自己的對話記錄）與 python `idna` 套件屬誤中，未採用。

---

## 3. 盤點結果

### 3.1 找到的檔案（全部屬於 repo 自身輸出，非使用者原始素材）

| 路徑 | 類型 | 是否為真實現場素材 | 用途 |
|---|---|---|---|
| `docs/release-1.0/e310-overview.png` | 匯出場刊圖 | ❌ 本工具產生 | RC evidence |
| `docs/release-1.0/e310-routes.png` | 匯出場刊圖 | ❌ 本工具產生 | RC evidence |
| `docs/release-1.0/e310-mats.png` | 匯出場刊圖 | ❌ 本工具產生 | RC evidence |
| `docs/release-1.0/e310-3d.png` | 匯出場刊圖 | ❌ 本工具產生 | RC evidence |
| `docs/release-1.0/e310-inventory.png` | 匯出物資清單 | ❌ 本工具產生 | RC evidence |
| `docs/release-1.0/e310-partner.png` | 夥伴圖 | ❌ 本工具產生 | RC evidence |
| `docs/release-1.0/phone-*.png`、`tablet-partner.png`、`desktop-share.png` | 裝置截圖 | ❌ 本工具產生 | RC evidence |
| `public/icons/icon-192.png`、`icon-512.png` | PWA icon | ❌ | 產品資產 |

> 這些是**產品輸出**，不是**現場證據**。用它們回頭驗證自己，等於自我證明，不算 reference。

### 3.2 找到的文字型真實參考（有效，優先序 2 與 5）

| 來源 | 優先序 | 內容 | 可信度 |
|---|---|---|---|
| `docs/e310/E310_GOLDEN_SCENARIO.md` §1 | 2（repo 既有） | E310 拓撲 7 項（講台／投影幕／窗牆／後門通走廊／地磚／綠色巧拼整片／後方長桌背包） | **照片推導**（前輪 agent 讀過原圖）；本輪無法覆核 |
| `git log b54e78c` | 2（repo 既有） | 座距 0.9 m/人（密）、1.2 m（寬鬆）標註為 photo-verified | 同上 |
| `tku-zen-leadership` 技能知識庫 | 5（公開／社團自有） | 社課流程、幹部分組、家族制、凝聚分享、歷年教室、社費 | **文件級可信**，非現場尺寸 |

### 3.3 沒找到的（必須補）

- 空教室照片、活動實況照片（`D:\場務場刊E310`）
- 歷年場刊圖／場佈圖原稿
- 過往活動 JSON／專案存檔
- E310 任何實測尺寸

---

## 4. 使用者端補完程序（在你的 Windows 機器執行）

repo 已附 `scripts/audit-local-references.ps1`。在 `D:\planform-iso` 執行：

```powershell
pwsh -File scripts\audit-local-references.ps1 -OutFile docs\field-research\LOCAL_REFERENCE_AUDIT.local.md
```

腳本行為（與本合約 §3 一致）：

- 掃描 `Documents` / `Pictures` / `Downloads` / `Desktop` / `D:\場務場刊E310` / repo 上層專案資料夾
- 只比對 `.jpg .jpeg .png .webp .pdf .json .md .txt .csv .glb .gltf`
- 只列**檔名／路徑／大小／修改時間**，**不讀內容、不上傳、不 commit 照片**
- **硬性排除** `.env`、`*credential*`、`*token*`、`*secret*`、`id_rsa*`、`*.pfx`、`*.key`、
  `AppData`、`.git`、`node_modules`
- 輸出 `*.local.md`（已被 `.gitignore` 排除，含人臉的照片路徑不會進 repo）

拿到清單後，把**結論**（不是照片）填進 `REFERENCE_MAPPING.md`，例如
「E310 門寬 = 88 cm，量自 2026-03-11 社課照片 IMG_0421」。

---

## 5. 本輪據此做的決定（Lead 裁決）

1. **不新增任何「真實尺寸」宣稱。** E310 維持「待現場校正」，footer 待校正字樣保留。
2. **可以修正的是「與既有照片證據矛盾」的地方** — 這不需要重看照片，repo 文字證據已足夠：
   - `E310_GOLDEN_SCENARIO.md` §1 寫明巧拼是**綠色**，但 `catalog.ts` 的地墊色是
     `#8b8fc7`（紫）。→ 依證據修正為綠色系。（見 `REFERENCE_MAPPING.md` M-01）
3. **可以補的是「真實流程」** — 來自社團知識庫的社課流程、家族制與凝聚分享，
   是文件級可信的公開／社團自有資訊，寫入 `TKU_ZEN_REAL_WORLD_REQUIREMENTS.md`。
4. **不做的**：不靠想像補 E310 幾何、不把估計標成實測、不用 generic office kit 取代真實物資。

---

## 6. Confidence 總表

| 資料類別 | Confidence | 依據 |
|---|---|---|
| E310 拓撲（門在後牆通走廊、前牆講台＋投影幕、兩側窗牆） | `high` | 前輪照片推導，repo 文件記載 |
| E310 尺寸 12 × 9 m、走廊 2.4 m | `estimated` | 照片可數物件推導，**未實測** |
| 地磚 0.6 × 0.6 m | `estimated` | 待「量一塊地磚」校正 |
| 巧拼 60 × 60、整片座區、朝投影幕 | `high` | 照片推導 |
| 巧拼**綠色** | `high` | 照片推導（本輪據此修正產品） |
| 座距 0.9 m/人（密）／1.2 m（寬鬆） | `high` | 照片推導 |
| 鞋子在巧拼區邊緣靠入口側 | `high` | 照片推導 |
| 後方長桌＝背包區 | `high` | 照片推導 |
| 社課流程、家族／凝聚分享、生活組職掌 | `high` | 社團知識庫（社團自有文件整理） |
| 報到／收費在走廊 | `medium` | 產品決策＋流程合理性，非照片 |
| 講師區在講台前磁磚帶 | `high` | 照片推導 |
| 電腦、收費箱、鞋架、欄杆、指示立牌之**確切型號與數量** | `estimated` | 未見清單，僅合理配置 |

---

## 7. 未解與下一步

- [ ] 使用者執行 `audit-local-references.ps1`，回填真實檔案清單
- [ ] E310 現場量測：一塊地磚／門寬／已知牆距（30 秒三路徑已在產品內）
- [ ] 若有歷年場刊圖原稿，比對本工具輸出的版面與符號是否「像同一份東西」
- [ ] 若有活動物資採購／借用清單，覆核 catalog 的鞋架／欄杆／立牌數量假設
