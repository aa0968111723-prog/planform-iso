/** Campuses, colleges, buildings, official map links. Geometry is not stored here. */
import type { TkuBuilding, TkuCampus, TkuCollege, TkuFloorUse, TkuMapLink } from "./tkuCampus";

export const TKU_CAMPUSES: TkuCampus[] = [
  {
    id: "tamsui", name: "淡水校園", nameEn: "Tamsui Campus", officialCode: "TS",
    address: "251301 新北市淡水區英專路 151 號", phone: "(02) 2621-5656", fax: "(02) 2622-3204",
    url: "https://www.tku.edu.tw", hectares: 21.71,
    note: "主校園。捷運淡水站轉紅 27／紅 28；淡海輕軌淡江大學站。",
  },
  {
    id: "taipei", name: "臺北校園", nameEn: "Taipei Campus", officialCode: "TP",
    address: "106302 臺北市大安區金華街 199 巷 5 號", phone: "(02) 3393-3833",
    url: "https://tpcampus.tku.edu.tw/", hectares: 0.32,
    note: "樓館代碼 D。教室代碼與公開容納人數出自試場平面圖與外借表，長寬未實測。",
  },
  {
    id: "lanyang", name: "蘭陽校園", nameEn: "Lanyang Campus", officialCode: "LY",
    address: "262308 宜蘭縣礁溪鄉林美村林尾路 180 號", phone: "(03) 987-3088", fax: "(03) 987-3066",
    url: "https://www.lanyang.tku.edu.tw", hectares: 40.45,
    note: "教學以建邦教學大樓（CL）為主。沒有現場照片，只用通用矩形。",
  },
  {
    id: "cyber", name: "網路校園", nameEn: "Cyber Campus", url: "https://cyber.tku.edu.tw",
    note: "沒有實體場地。",
  },
];
