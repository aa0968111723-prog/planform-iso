# 淡江大學校園地圖與場地目錄（地毯式）

這份文件是 Planform「淡江地圖」的完整公開目錄。
實作：`src/core/tkuCampus.ts`。幾何仍在 `src/core/venues.ts`。

**目錄不是實測平面圖。** 官方平面圖有版權，本專案只放連結。

## 誠實規則

- 樓館代碼、中英文名稱、地址、公開座標（Wikidata／OSM）、外借表容納人數：可以當真。
- 教室長寬、走廊寬、門寬、地磚邊長：沒有現場實測就不得標成實測。
- `publishedCapacity` 是學校場地外借表的人數，不是量過的面積。
- 蘭陽部分樓館沒有共筆單一字母代碼（建軒、文苑、建邦國際會議廳），目錄代號 `LX`／`LW`／`LH` **只供檢索，不是課表代碼**。
- 禪學社文件提及次數只用來排序 Quick Start。

## 四個校園

| id | 名稱 | 面積（公開） | 地址 | 電話 | 交通 |
|---|---|---|---|---|---|
| tamsui | 淡水校園 | 約 21.71 公頃 | 251301 新北市淡水區英專路 151 號 | (02) 2621-5656 | 捷運淡水站轉紅 27／紅 28；淡海輕軌淡江大學站 |
| taipei | 臺北校園 | 約 0.32 公頃 | 106302 臺北市大安區金華街 199 巷 5 號 | (02) 3393-3833 | 大安區金華街；樓館代碼 D |
| lanyang | 蘭陽校園 | 約 40.45 公頃 | 262308 宜蘭縣礁溪鄉林美村林尾路 180 號 | (03) 987-3088 | 礁溪／國道 5 號；教學樓代碼 CL |
| cyber | 網路校園 | 無實體 | — | — | https://cyber.tku.edu.tw |

來源：[認識淡江｜四個校園](https://about.tku.edu.tw/campus.html)、教育部大學校院名錄。

## 教室代碼

`樓館 + 樓層 + 室號`

| 例子 | 解析 |
|---|---|
| E310 | 工學大樓 3F 10 室 |
| SG109 | 體育館 1F 09 室（社辦） |
| D401 | 臺北校園 4F 01 室（外借表 90 人） |
| B616 | 商管大樓 6F 16 室（門口進去是 3 樓） |
| CL408 | 蘭陽建邦教學大樓 4F 08 室 |

未建檔代碼：先找該棟通用教室，再退回淡江／臺北／蘭陽通用起點。**不會捏造該室尺寸。**

## 樓館代碼 54

座標來自 Wikidata／OSM，**不是現場釘檀**。

詳見 `src/core/tkuCampus.ts` 的 `TKU_BUILDINGS`。淡水含教學行政、地標、運動、宿舍與警衛室；臺北為 D 館；蘭陽為 CL、SA、LH、LX、LW。

學院對照見 `TKU_COLLEGES`：商管 B、工學 E/G/K、文學 L、外語 FL、理學 S/C、國際事務 T、教育 ED。

SG 樓層用途與圖書館樓層見 `TKU_SG_FLOORS`、`TKU_LIBRARY_FLOORS`。
臺北試場教室代碼清單見 `TKU_TAIPEI_ROOM_CODES`。

## 可開場地

尺寸全部仍是起點。有 `publishedCapacity` 的，人數來自外借表。

### 禪學社常用（文件提及次數）

| 場地 | 次數 | 入口 |
|---|---|---|
| E308 | 101 | `venue:tku-e308` |
| SG109 社辦 | 100 | `venue:tku-sg109` |
| E310 | 54 | `venue:tku-e310` |
| SG320 | 27 | `venue:tku-sg320` |
| SG402／SG321／SG319／SG603／E301／E311 | 4–13 | 淡江一般教室 |
| 書卷廣場 | — | 3×3 帳篷起點 |
| 同舟廣場 | — | 綜大 1F 中庭 |

### 淡水地標／戶外

克難坡、驚聲銅像廣場、福園、李雙澤紀念碑、五虎碑、覺軒花園、牧羊草坪、海豚吉祥物里程碑、美食廣場、操場司令臺、藍白小鎮、五虎崗綜合球場、黑天鵝展示廳、驚聲國際會議廳、圖書館、海事博物館、校史館、活動中心、松濤／文鎘、SG7 集會場、SG4 羽球排球場。

### 臺北校園（外借表容納人數）

D207/D208 120、D211 81、D304 48、D305 40、D309 54、D310 50、D401/D501 90、D510 50、D509 64。
其他試場代碼輸入後落到「臺北校園教室」起點。

### 蘭陽

建邦國際會議廳 286 人、CL408／CL426／CL506、紹謃紀念活動中心。

## 官方連結

- [認識淡江｜四個校園](https://about.tku.edu.tw/campus.html)
- [總務處｜校園地圖下載](http://163.13.102.26:1745/Front/map/Archive.aspx?id=zVsBtC5G%2Bw0=)
- [淡江人共筆｜空間代碼](https://tku.miraheze.org/wiki/zh-Hant/淡江大學空間代碼)
- [Wikidata｜樓館座標與 OSM](https://www.wikidata.org/wiki/Wikidata:WikiProject_Taiwan/Tamkang_University/Reports)
- [臺北校園試場平面圖 PDF](https://adms.tku.edu.tw/File/Userfiles/0000000095/files/%E5%8F%B0%E5%8C%97%E6%A0%A1%E5%9C%92%E8%A9%A6%E5%A0%B4%E5%B9%B3%E9%9D%A2%E5%9C%96.pdf)
- [維基共享｜2025 淡水校園地圖照片](https://commons.wikimedia.org/wiki/File:Tamkang_University_Tamsui_Campus_Map_01.jpg)
- [臺北校園](https://tpcampus.tku.edu.tw/)／[蘭陽校園](https://www.lanyang.tku.edu.tw)
- [圖書館總館平面](https://www.lib.tku.edu.tw/FrontPointOfEntry.aspx?Sn=63)
- [對外場地借用](https://spacerental.tku.edu.tw/spaceflow.aspx)
- [淡江文化手冊 PDF](https://classic.tku.edu.tw/doc/TKU_culture.pdf)

## 產品裡怎麼用

1. 新建專案 → E310 實景＋淡江常用場地＋「看淡江校園地圖」
2. 地圖步驟依 `featuredTkuBuildings()` 列出活動常用樓館
3. `✦ AI 幫我` 能讀教室代碼與地名
4. 輸入未建檔代碼會落到該棟通用起點

尺寸要成真：現場量地磚、門寬、已知牆距。
