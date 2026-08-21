# Reference Mapping — 每個 preset 的來源與可信度

依 `docs/field-research/REAL_REFERENCE_CONTRACT.md` §4 建立。

**用法**：對任何一個預設，都要能回答「這是參考哪張真實圖／哪份資料做的？」
若答案是「沒有依據」，該項就必須標 `estimated` 並掛「待校正／待確認」，不得宣稱為實測。

**Confidence 定義**
| 值 | 意思 |
|---|---|
| `verified` | 現場實測數字，有量測記錄 |
| `high` | 真實照片／社團文件可直接判讀（型態、顏色、相對位置、密度） |
| `medium` | 由真實流程推導的合理配置，非直接證據 |
| `estimated` | 合理起點，**必須**掛「待校正／待確認」 |
| `unknown` | 無依據，不得進 production 預設 |

> 本輪（Claude Lead，2026-08-21）在雲端容器執行，**無法讀取原始照片**。
> 標 `high` 者，其照片判讀由前一輪在使用者本機執行的 agent 完成並記錄於
> `docs/e310/E310_GOLDEN_SCENARIO.md` §1 與 commit `b54e78c`；本檔如實轉述，未再自行加碼。
> 詳見 `LOCAL_REFERENCE_AUDIT.md`。

---

## A. 場地（Venue）

| # | Item | 程式位置 | Source | Confidence | Used For | Needs Verification |
|---|---|---|---|---|---|---|
| V-01 | E310 教室 12 × 9 m | `src/core/venues.ts` `venue:tku-e310` | 空教室照可數桌椅列數／巧拼格數推導 | `estimated` | venue preset 起點 | **yes**（掛待校正） |
| V-02 | 走廊 12 × 2.4 m（貼教室後牆 z=9） | 同上 `corridor` | 走廊照（淡粉紅地磚，連 3F 開放廳） | `estimated` | 走廊流程場景 | **yes** |
| V-03 | 後門在教室後牆（`edge:"s"`, offset 8.6）通走廊 | 同上 `fixtures` | 照片：兩側窗牆 → 門只可能在前/後牆；後門確認通走廊 | `high`（位置關係）／`estimated`（offset） | 入場動線起點 | offset **yes** |
| V-04 | 前投影幕在前牆中央（`edge:"n"`, offset 6） | 同上 | 照片：前牆中央電動投影幕，兩側黑板 | `high` | 座區朝向基準 | 尺寸 yes |
| V-05 | 地磚 0.6 × 0.6 m | 同上 `tile` | 照片：方形地磚，尺寸不可判讀 | `estimated` | 網格與校正基準 | **yes**（「量一塊地磚」最快路徑） |
| V-06 | 講台平台 6.0 × 1.2 × 0.18 m 貼前牆置中、locked | `venues.ts` `extraObjects` + `catalog.ts` `builtin:stage-platform` | 照片：整條加高木製講台、墨綠桌面、高一階 | `high`（存在與型態）／`estimated`（尺寸） | 固定設施、座區前留空計算 | 尺寸 yes |
| V-07 | 講桌 0.6 × 0.45 × 1.1 m 在講台上 | `catalog.ts` `builtin:lectern` | 照片：講桌含 AV 控制 | `high`（存在）／`estimated`（尺寸） | 講師區 | 尺寸 yes |
| V-08 | 側投影幕 | **未進 preset** | 照片只見「側邊投影機」控制鍵，位置未確認 | `unknown` | — | 待現場確認才可加 |
| V-09 | 前牆側疑似另一門 | **未進 preset** | 照片不確定 | `unknown` | — | 待現場確認 |

**裁決**：V-08 / V-09 不得進 preset。`unknown` 不進 production 是本檔的硬規則。

---

## B. 地墊／巧拼（本 Release 最受檢視的一項）

| # | Item | 程式位置 | Source | Confidence | 說明 |
|---|---|---|---|---|---|
| M-01 | **顏色：綠色系** | `src/core/catalog.ts` `builtin:mat.color`、`src/scene/materials.ts` `mat-soft` | 活動實況照：**綠色巧拼**（`E310_GOLDEN_SCENARIO.md` §1.6） | `high` | ⚠️ **本輪修正**：原為 `#8b8fc7`（薰衣草紫），與照片證據矛盾。改為綠色系。 |
| M-02 | 規格 60 × 60 cm 拼接墊（`m6060`） | `catalog.ts` mat `presets` | 照片：約 60×60 拼接墊 | `high` | 非 60×180 個人墊 |
| M-03 | **整片座區**（field 模式，gap 0） | `src/core/smartLayout.ts` `generateFieldLayouts` | 照片：拼成一整片，蓋住教室中段 | `high` | 淡江系 preset 預設 field 模式 |
| M-04 | 朝向：面向投影幕（前牆） | `smartLayout.ts` `rotationDeg` / 座區生成 | 照片 | `high` | — |
| M-05 | 座距 0.9 m/人（密，A/B）；1.2 m（寬鬆，C） | `smartLayout.ts` `FIELD_PITCH_DENSE/SPACIOUS` | 照片密度實測（commit `b54e78c`） | `high` | 每人一格寬（0.6 m）× 深度 0.9 m |
| M-06 | 中央走道 ≥ 0.9 m（B 案） | `smartLayout.ts` 候選 B | 流程需求（進出座區） | `medium` | 照片未直接證明有固定走道 |
| M-07 | 講台前留走動帶（有講台時 1.2 m） | `smartLayout.ts` front reserve | 照片：講台與巧拼之間留一條走動帶 | `high` | — |
| M-08 | 門口留空 | `placement.ts` / `validation.ts` blocksFlow | 通行安全＋Grok R1-5「官方範例自己擋門」 | `medium` | — |
| M-09 | **小組（家族）排列** | **尚未實作** | 社團知識庫 §10.2：課後「凝聚分享」依家族分組座談 | `high`（流程存在） | 見 `TKU_ZEN_REAL_WORLD_REQUIREMENTS.md` R-06；本輪列為已知缺口 |

---

## C. 服務桌與設備

| # | Item | 程式位置 | Source | Confidence | Needs Verification |
|---|---|---|---|---|---|
| S-01 | 報到桌 1.5 × 0.7 × 0.74 m | `catalog.ts` `builtin:regTable` | 一般長桌尺寸；社課流程確有「社員報到」 | `estimated`（尺寸）／`high`（存在） | 尺寸 yes |
| S-02 | 報到桌位置＝**走廊**、桌面貼外牆面向走道 | `src/core/quickStart.ts` | 流程推導＋Grok R1-5（放教室內會擋門） | `medium` | 現場確認 |
| S-03 | 報到人力 2 人 | `quickStart.ts` / scenario stations | 社團實務（生活組編制），commit `5e657e0` | `medium` | yes |
| S-04 | 電腦 0.5 × 0.22 × 0.4 m 放報到桌上 | `catalog.ts` `builtin:computer` | 報到點名需求 | `estimated` | 是否真的用電腦點名 — **待確認** |
| S-05 | 收費桌 1.5 × 0.7 × 0.74 m | `catalog.ts` `builtin:payment-desk` | 社費存在（知識庫 §14 FAQ） | `estimated`（尺寸） | yes |
| S-06 | 收費箱 0.25 × 0.2 × 0.18 m（桌上） | `catalog.ts` `builtin:payment-box` | 現場收現金之合理配置 | `estimated` | 是否用收費箱／信封／表單 — **待確認** |
| S-07 | 鞋架 1.0 × 0.35 × 0.8 m × 2 | `catalog.ts` `builtin:shoe-rack` | 照片：脫鞋，鞋放巧拼區邊緣 → 鞋架為**推測的整理方式** | `medium`（照片顯示鞋子在地上，非架上） | **yes — 可能應為「鞋子區地面」而非鞋架** |
| S-08 | 排隊欄杆 1.0 × 0.15 × 0.95 m × 3 | `catalog.ts` `builtin:queue-barrier` | 走廊排隊之合理配置 | `estimated` | 社團是否真有欄杆 — **待確認** |
| S-09 | 指示立牌 0.4 × 0.3 × 1.4 m | `catalog.ts` `builtin:signage-stand` | 引導需求；美宣組確實製作文宣 | `medium` | 形式（立牌／A4 貼牆／手舉牌）**待確認** |
| S-10 | 背包區＝後牆長桌（1.5 m × 2） | `quickStart.ts` backpack zone | 照片：後方長桌一排，背包放桌上 | `high` | 長度 yes |
| S-11 | 鞋子區貼巧拼區靠門側邊緣 | `quickStart.ts` shoe zone | 照片 | `high` | — |
| S-12 | 生活組區在走廊外側、留通行道 | `quickStart.ts` life zone | 知識庫 §10.1：生活組＝報到點名／餐點／接待 | `medium` | — |
| S-13 | 講師區在講台前方中央磁磚帶 | `quickStart.ts` meditation zone | 照片：講師與主持站講台前磁磚地帶 | `high` | — |

**S-07 / S-08 是本檔標示最需要現場覆核的兩項**：照片顯示的是「鞋子放在巧拼區邊緣（地上）」，
產品目前提供鞋架；欄杆則完全沒有照片依據。兩者都保留為**可刪可換的一般物件**，
不是不可移除的固定設施，符合 preset-first / fully customizable。

---

## D. 動線與流程

| # | Item | 程式位置 | Source | Confidence |
|---|---|---|---|---|
| F-01 | 走廊 → 引導 → 排隊 → 報到 → 已繳/未繳分流 → 收費 → 鞋子 → 背包 → E310 → 入座 | `quickStart.ts` golden scenario stations | `REAL_REFERENCE_CONTRACT.md` §8 指定 | `verified`（合約指定） |
| F-02 | 60 人＝40 預繳／20 現場繳 | scenario profiles | 合約指定 | `verified` |
| F-03 | 20 分鐘陸續到達 | `simQuick.arrivalWindowSeconds` | 合約指定（產品原設 15 分，本輪對齊 20 分） | `verified` |
| F-04 | 入場動線不橫穿巧拼、止於走道口 | `routes.ts` / commit `8295375` | 照片＋通行常識 | `high` |
| F-05 | 社課完整流程（集合→場佈→禪定凝聚→報到→開場→師資 75 分→介紹→凝聚分享→場復） | **僅部分反映** | 知識庫 §8.1 | `high` |

---

## E. 場刊圖（Export）

| # | Item | 程式位置 | Source | Confidence |
|---|---|---|---|---|
| E-01 | 淺色紙面（`#f8fafc` / `#ffffff`） | `src/export/constructionPlan.ts` | 場刊＝紙本印刷品／LINE 圖 | `verified`（用途決定） |
| E-02 | 待校正 footer | 同上 | 誠實規則（`E310_GOLDEN_SCENARIO.md` §0） | `verified` |
| E-03 | 手機可讀版式 | commit `af63305` | Grok R1-6 / R2-4 | `verified` |
| E-04 | 編輯器視覺與場刊視覺**同一套語言** | **本輪修正** | 使用者要求：明亮／乾淨／像場刊圖 | — |

---

## F. 本輪（Claude Lead, 2026-08-21）依本檔做出的產品變更

| 變更 | 依據 | 條目 |
|---|---|---|
| 地墊顏色改為綠色系 | 照片證據（綠色巧拼）與程式（紫）矛盾 | M-01 |
| 預設 Light Visual Mode（編輯／模擬／夥伴／匯出同一套） | 使用者要求 + E-01/E-04 | E-04 |
| 模擬人流改為可辨識人形（圓頭＋身體） | 使用者要求「真的看到人」 | — |
| 到達窗預設 20 分鐘 | 合約 golden scenario | F-03 |

**未做（列為已知缺口，不假裝完成）**：
- M-09 小組／家族排列（凝聚分享）— 需要新的座區模式，屬產品方向新增，Release Freeze 內不做，
  已記入 `TKU_ZEN_REAL_WORLD_REQUIREMENTS.md` R-06 與 PR limitations。
- S-04 / S-06 / S-07 / S-08 / S-09 物資真實性覆核 — 需使用者提供採購／借用清單或照片。
