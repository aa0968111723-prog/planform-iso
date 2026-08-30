import { describe, expect, it } from "vitest";
import {
  TKU_BUILDINGS,
  TKU_CAMPUSES,
  TKU_COLLEGES,
  TKU_LIBRARY_FLOORS,
  TKU_MAP_LINKS,
  TKU_PLACES,
  TKU_SG_FLOORS,
  TKU_TAIPEI_ROOM_CODES,
  buildingByCode,
  featuredTkuPlaces,
  findTkuPlace,
  findTkuPlaceInText,
  formatCampusLine,
  parseTkuRoomCode,
  placesWithPublishedCapacity,
} from "../src/core/tkuCampus";
import { venuePresetById } from "../src/core/venues";

describe("Tamkang campus directory", () => {
  it("lists four campuses with the Tamsui street address", () => {
    expect(TKU_CAMPUSES.map((c) => c.id)).toEqual(["tamsui", "taipei", "lanyang", "cyber"]);
    expect(TKU_CAMPUSES[0].address).toMatch(/英專路\s*151/);
  });

  it("resolves published building codes", () => {
    expect(buildingByCode("E")?.name).toBe("工學大樓");
    expect(buildingByCode("SG")?.name).toBe("紹\u8b03紀念體育館");
    expect(buildingByCode("D")?.campusId).toBe("taipei");
    expect(buildingByCode("GB")?.name).toBe("藍白小鎮");
    expect(buildingByCode("SA")?.name).toBe("紹\u8b03紀念活動中心");
    expect(buildingByCode("SA")?.campusId).toBe("lanyang");
    expect(buildingByCode("ZF")?.name).toBe("淡江國際學園");
    expect(buildingByCode("CL")?.campusId).toBe("lanyang");
    expect(buildingByCode("N")?.name).toBe("紹\u8b03紀念游泳館");
    expect(TKU_BUILDINGS.every((b) => b.code && b.name && b.campusId)).toBe(true);
    expect(new Set(TKU_BUILDINGS.map((b) => b.code)).size).toBe(TKU_BUILDINGS.length);
    expect(TKU_BUILDINGS.length).toBeGreaterThanOrEqual(54);
  });

  it("parses classroom codes without inventing geometry", () => {
    expect(parseTkuRoomCode("E310")).toEqual({ code: "E310", buildingCode: "E", floor: 3, room: "10" });
    expect(parseTkuRoomCode("sg109")).toEqual({ code: "SG109", buildingCode: "SG", floor: 1, room: "09" });
    expect(parseTkuRoomCode("D305")).toEqual({ code: "D305", buildingCode: "D", floor: 3, room: "05" });
    expect(parseTkuRoomCode("HC310")).toEqual({ code: "HC310", buildingCode: "HC", floor: 3, room: "10" });
    expect(parseTkuRoomCode("B302A")).toEqual({ code: "B302A", buildingCode: "B", floor: 3, room: "02A" });
    expect(parseTkuRoomCode("教室")).toBeNull();
  });

  it("maps club-frequency rooms onto existing venue presets", () => {
    const e308 = findTkuPlace("E308")!;
    const e310 = findTkuPlace("E310")!;
    const office = findTkuPlace("社辦")!;
    const plaza = findTkuPlace("書卷廣場")!;
    expect(e308.mentionCount).toBe(101);
    expect(e310.venuePresetId).toBe("venue:tku-e310");
    expect(office.id).toBe("SG109");
    expect(plaza.id).toBe("scroll-plaza");
    for (const place of TKU_PLACES) {
      expect(venuePresetById(place.venuePresetId), place.id).not.toBeNull();
      expect(place.note).not.toMatch(/實測完成|已量過/);
    }
  });

  it("featured Quick Start places stay a short honest list", () => {
    expect(featuredTkuPlaces().map((p) => p.id)).toEqual([
      "E308", "E310", "SG320", "SG109", "scroll-plaza",
    ]);
  });

  it("points at official maps instead of copying them", () => {
    expect(TKU_MAP_LINKS.some((l) => l.url.includes("about.tku.edu.tw"))).toBe(true);
    expect(TKU_MAP_LINKS.some((l) => l.campusId === "lanyang")).toBe(true);
    expect(TKU_MAP_LINKS.every((l) => l.url.startsWith("http"))).toBe(true);
  });

  it("resolves landmark names used in briefs", () => {
    expect(findTkuPlace("圖書館")?.id).toBe("library");
    expect(findTkuPlace("藍白小鎮")?.id).toBe("blue-white-town");
    expect(findTkuPlace("蘭陽")?.id).toBe("lanyang-generic");
    expect(findTkuPlace("B616")?.id).toBe("b-generic");
    expect(findTkuPlace("CL101")?.id).toBe("lanyang-generic");
    expect(findTkuPlace("D401")?.publishedCapacity).toBe(90);
    expect(findTkuPlace("克難坡")?.id).toBe("knan-slope");
    expect(findTkuPlace("建邦國際會議廳")?.publishedCapacity).toBe(286);
    expect(findTkuPlace("CL408")?.id).toBe("CL408");
    expect(findTkuPlace("D304")?.publishedCapacity).toBe(48);
    expect(findTkuPlace("美食廣場")?.id).toBe("food-plaza");
    expect(findTkuPlace("有蓮")?.publishedCapacity).toBe(350);
    expect(findTkuPlace("文\u932b音樂廳")?.publishedCapacity).toBe(252);
    expect(findTkuPlace("文\u7e26音樂廳")?.id).toBe("carrie-chang-hall");
    expect(findTkuPlace("B302A")?.publishedCapacity).toBe(45);
    expect(findTkuPlace("宮燈大道")?.id).toBe("palace-avenue");
    expect(findTkuPlace("ED201")?.id).toBe("ed-generic");
    expect(findTkuPlace("花牆")?.id).toBe("flower-wall");
    expect(findTkuPlace("游泳館")?.id).toBe("natatorium");
    expect(findTkuPlace("D206")?.publishedCapacity).toBe(217);
    expect(findTkuPlace("黑天鵝")?.publishedCapacity).toBe(80);
    expect(findTkuPlace("D305")?.publishedCapacity).toBe(46);
    expect(findTkuPlace("D509")?.publishedCapacity).toBe(60);
    expect(findTkuPlace("軍刀戰鬥機")?.id).toBe("f100-sabre");
    expect(findTkuPlace("蘭陽克難坡")?.id).toBe("lanyang-slope");
    expect(findTkuPlace("龜山日出")?.id).toBe("turtle-island-view");
    expect(findTkuPlace("建軒")?.id).toBe("chien-hsuan");
    expect(findTkuPlace("文苑")?.id).toBe("wen-yuan");
    expect(findTkuPlace("覺軒會館")?.id).toBe("chueh-hsuan-house");
    expect(findTkuPlace("宮燈道")?.id).toBe("palace-avenue");
    expect(findTkuPlace("SG201")?.id).toBe("sg-generic");
    expect(findTkuPlace("CL439")?.publishedCapacity).toBe(100);
    expect(findTkuPlace("CL302")?.publishedCapacity).toBe(64);
    expect(findTkuPlace("CL506")?.publishedCapacity).toBe(32);
    expect(findTkuPlace("柔道室")?.publishedCapacity).toBe(100);
    expect(findTkuPlace("游泳池")?.publishedCapacity).toBe(200);
    expect(findTkuPlace("蘭陽戶外觀景平台")?.publishedCapacity).toBe(100);
  });

  it("keeps published capacities sourced from rental tables only", () => {
    const numbered = placesWithPublishedCapacity();
    expect(numbered.length).toBeGreaterThanOrEqual(20);
    expect(findTkuPlace("驚聲國際會議廳")?.publishedCapacity).toBe(175);
    expect(findTkuPlace("覺生國際會議廳")?.publishedCapacity).toBe(180);
    expect(findTkuPlace("鍾靈中正堂")?.publishedCapacity).toBe(200);
    expect(findTkuPlace("E680")?.publishedCapacity).toBe(44);
    expect(TKU_PLACES.some((p) => /實測完成|已量過/.test(p.note))).toBe(false);
  });

  it("keeps college homes and published floor uses without inventing geometry", () => {
    expect(TKU_COLLEGES.find((c) => c.id === "business")?.buildingCodes).toEqual(["B"]);
    expect(TKU_SG_FLOORS.some((f) => f.floor === 7 && /集會/.test(f.label))).toBe(true);
    expect(TKU_SG_FLOORS.some((f) => f.floor === 8)).toBe(true);
    expect(TKU_LIBRARY_FLOORS).toHaveLength(9);
    expect(TKU_TAIPEI_ROOM_CODES).toContain("D214");
    expect(TKU_TAIPEI_ROOM_CODES).toContain("D507");
    expect(TKU_CAMPUSES[0].officialCode).toBe("TS");
    expect(TKU_COLLEGES.find((c) => c.id === "health")?.campusId).toBe("lanyang");
    expect(TKU_PLACES.length).toBeGreaterThanOrEqual(100);
    expect(buildingByCode("XB")?.name).toBe("五虎崗新社辦");
    expect(buildingByCode("Z")?.aliases).toContain("文\u932b藝術中心");
    expect(buildingByCode("Z")?.aliases).toContain("文\u7e26藝術中心");
  });

  it("picks a place out of a brief without inventing a room", () => {
    expect(findTkuPlaceInText("幫我排 E308 的 40 人社課")?.place.id).toBe("E308");
    expect(findTkuPlaceInText("書卷廣場擺 9 攤")?.place.id).toBe("scroll-plaza");
    expect(findTkuPlaceInText("文\u932b音樂廳彩排")?.place.id).toBe("carrie-chang-hall");
    expect(findTkuPlaceInText("")).toBeNull();
  });

  it("formats a campus pin without claiming a survey", () => {
    expect(formatCampusLine({ campusId: "tamsui", buildingCode: "E", floor: 3, room: "10" }))
      .toBe("淡水校園 · E 工學大樓 · 3F · 室 10");
  });
});

// Agent venuePlace wiring lives on intent.ts when that slot exists.
// This catalogue test stays independent so gates can pass on directory data alone.
