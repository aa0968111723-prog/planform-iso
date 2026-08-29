import { describe, expect, it } from "vitest";
import {
  classify,
  describeParse,
  EVENT_TYPE_CUES,
  extractSlots,
  INTENT_RULES,
  normalize,
  OBJECT_CUES,
  OBJECTIVE_CUES,
  parseRequest,
  RELATION_CUES,
  ZONE_CUES,
} from "../src/agent/intent";

describe("normalisation", () => {
  it("folds full-width characters", () => {
    expect(normalize("６０人")).toBe("60人");
    expect(normalize("３×３ 公尺")).toBe("3x3 公尺");
  });

  it("rewrites Chinese numerals as digits", () => {
    expect(normalize("六十人")).toBe("60人");
    expect(normalize("一百二十公分")).toBe("120公分");
    expect(normalize("十五張桌子")).toBe("15張桌子");
    expect(normalize("兩張桌子")).toBe("2張桌子");
  });

  it("normalises punctuation and the multiplication sign", () => {
    expect(normalize("報到，收費。")).toBe("報到,收費.");
    expect(normalize("180×60×74")).toBe("180x60x74");
  });

  it("leaves text with no numerals alone", () => {
    expect(normalize("把報到桌移到入口右側")).toBe("把報到桌移到入口右側");
  });
});

describe("cue tables are normalisation-safe", () => {
  /**
   * The trap this catches: a cue written as 「做一個」 can never fire, because
   * classify() runs on normalized text where 一 has already become 1. It fails
   * silently — the intent simply never scores, and no test notices.
   *
   * Rather than banning characters, this pulls the LITERAL alternatives out of
   * each cue regex and asserts that normalize() leaves them alone. That is the
   * exact property the cue needs, and it stays correct if normalize() changes.
   */
  function literals(re: RegExp): string[] {
    return re.source
      .split("|")
      .map((part) => part.replace(/^[(?:^]+|[)$]+$/g, ""))
      .filter((part) => part.length > 0 && !/[[\]{}()*+?.^$]/.test(part));
  }

  function checkTable(label: string, tables: readonly (readonly [string, RegExp])[]): void {
    for (const [name, re] of tables) {
      for (const lit of literals(re)) {
        expect(
          normalize(lit),
          `${label} ${name} 的「${lit}」在正規化後會變成「${normalize(lit)}」，永遠配不到`,
        ).toBe(lit);
      }
    }
  }

  it("every intent rule cue survives normalisation", () => {
    checkTable("intent", INTENT_RULES.flatMap((r) => r.groups.map((g) => [`${r.type}.${g.name}`, g.re] as const)));
  });

  it("every slot cue survives normalisation", () => {
    checkTable("slot", [
      ...EVENT_TYPE_CUES.map((c) => [`event:${c.type}`, c.re] as const),
      ...ZONE_CUES.map((c) => [`zone:${c.zone}`, c.re] as const),
      ...OBJECTIVE_CUES.map((c) => [`objective:${c.objective}`, c.re] as const),
      ...RELATION_CUES.map((c) => [`relation:${c.relation}`, c.re] as const),
      ...OBJECT_CUES.map((c) => [`object:${c.phrase}`, c.re] as const),
    ]);
  });

  it("leaves a single numeral character that is part of a word alone", () => {
    // 參 is the formal numeral 3 and 一 is 1, but 參與感 and 一起 are words. A
    // lone numeral only converts when a counter follows it.
    for (const word of ["參與感", "一起", "一直", "一定", "統一", "十分滿意", "第一"]) {
      expect(normalize(word), `${word} 不該被改寫`).toBe(word);
    }
  });

  it("converts an unambiguous compound wherever it appears", () => {
    // 八十 is eighty in any context, so it converts even without a counter.
    // 「百分之80」 is a harmless rewrite: no slot reads a percentage, and the
    // alternative rule would drop 「大約六十」 on the floor.
    expect(normalize("百分之八十")).toBe("百分之80");
    expect(normalize("大約六十")).toBe("大約60");
  });

  it("still converts a numeral that really is a quantity", () => {
    expect(normalize("六十人")).toBe("60人");
    expect(normalize("一公尺")).toBe("1公尺");
    expect(normalize("三種方案")).toBe("3種方案");
    expect(normalize("兩張桌子")).toBe("2張桌子");
    expect(normalize("一百二十公分")).toBe("120公分");
  });
});

describe("slot extraction", () => {
  const slots = (t: string) => extractSlots(normalize(t));

  it("reads a headcount, in digits or in characters", () => {
    expect(slots("排 60 人的茶會").participants?.value).toBe(60);
    expect(slots("排六十人的茶會").participants?.value).toBe(60);
    expect(slots("大約八十位參加者").participants?.value).toBe(80);
  });

  it("does not read a length as a headcount", () => {
    // 「留 1 公尺」 is not one person.
    expect(slots("走道留 1 公尺").participants).toBeUndefined();
  });

  it("reads the door clearance attached to the door, not any nearby number", () => {
    // The old keyword rule matched the literal phrase 「1 公尺」 and threw the
    // 1.2 away, so 「門口保留 1.2 公尺」 quietly became 1.
    const s = slots("入口先報到，門口保留 1.2 公尺");
    expect(s.doorClearance?.value).toBeCloseTo(1.2, 6);
  });

  it("converts centimetres to metres", () => {
    expect(slots("門前保留 120 公分").doorClearance?.value).toBeCloseTo(1.2, 6);
  });

  it("reads an aisle width in either phrasing", () => {
    expect(slots("走道至少 90 公分").aisleWidth?.value).toBeCloseTo(0.9, 6);
    expect(slots("兩邊各保留一公尺走道").aisleWidth?.value).toBeCloseTo(1.0, 6);
  });

  it("reads three-part dimensions in centimetres", () => {
    const d = slots("尺寸先用 180×60×74 公分").dimensions?.value;
    expect(d).toEqual({ width: 1.8, depth: 0.6, height: 0.74 });
  });

  it("reads a venue footprint as a venue, not as furniture", () => {
    // 「3x3 公尺攤位」 became a three-metre-wide desk when read as an object.
    const s = slots("把這個 3×3 公尺攤位改成互動配置");
    expect(s.venueSize?.value).toEqual({ length: 3, width: 3 });
    expect(s.dimensions).toBeUndefined();
  });

  it("classifies the event type", () => {
    expect(slots("禪學社茶會").eventType?.value).toBe("tea-gathering");
    expect(slots("靜坐共修").eventType?.value).toBe("meditation");
    expect(slots("園遊會擺攤").eventType?.value).toBe("booth");
    expect(slots("這學期的社課").eventType?.value).toBe("classroom");
  });

  it("collects required zones without duplicates", () => {
    const s = slots("入口先報到，報到之後收費，鞋子放旁邊，地墊放中央");
    const types = s.requiredZones.map((z) => z.value);
    expect(types).toContain("registration");
    expect(types).toContain("payment");
    expect(types).toContain("shoe");
    expect(types).toContain("meditation");
    expect(new Set(types).size).toBe(types.length);
  });

  it("collects objectives", () => {
    const s = slots("收費另外分流，門口保留 1.2 公尺，希望降低排隊");
    const objectives = s.objectives.map((o) => o.value);
    expect(objectives).toContain("separate-checkin-payment");
    expect(objectives).toContain("clear-doors");
    expect(objectives).toContain("reduce-crowding");
  });

  it("reads 「不能阻擋主要通道」 as an objective", () => {
    // The sentence said it and scheme A's own risk list admits it blocks the
    // aisle; without parsing it, A stayed eligible and could be recommended.
    const s2 = slots("把攤位改成適合互動的配置，不能阻擋主要通道");
    expect(s2.objectives.map((o) => o.value)).toContain("keep-aisle-clear");
  });

  it("keeps each object's relation inside its own clause", () => {
    // Reading relations over the whole sentence assigned both 右側 and 左側 to
    // both desks — the user sees two desks stacked on one side.
    const s = slots("把報到桌移到入口右側，收費桌移到左側");
    const reg = s.objectRefs.find((r) => r.phrase === "報到桌");
    const pay = s.objectRefs.find((r) => r.phrase === "收費桌");
    expect(reg?.relation).toBe("right");
    expect(pay?.relation).toBe("left");
  });

  it("reads a clearance stated in the object's own clause", () => {
    const s = slots("報到桌移到右側保留 1 公尺，收費桌移到左側");
    const reg = s.objectRefs.find((r) => r.phrase === "報到桌");
    expect(reg?.clearance).toBeCloseTo(1, 6);
  });

  it("leaves a clearance stated for the whole sentence on the aisle slot", () => {
    // 「兩邊各保留一公尺走道」 is one instruction about both desks, not a
    // property of whichever desk happened to be named in the same clause.
    const s = slots("把報到桌移到入口右側，收費桌移到左側，兩邊各保留一公尺走道");
    expect(s.aisleWidth?.value).toBeCloseTo(1, 6);
    expect(s.objectRefs.every((r) => r.clearance === undefined)).toBe(true);
  });

  it("reads furniture asked for by the piece", () => {
    const s2 = slots("幫我排一個 40 人的茶會，要三張長桌、兩個投影幕");
    const ids = s2.requiredAssets.map((a) => `${a.value.assetId}x${a.value.count}`);
    expect(ids).toContain("builtin:tablex3");
    expect(ids).toContain("builtin:screenx2");
  });

  it("does not read a clearance or a headcount as furniture", () => {
    // 「留 1 公尺」 and 「40 人」 both carry a number and a counter-ish word.
    const s2 = slots("排 40 人的茶會，門口保留 1.2 公尺");
    expect(s2.requiredAssets).toEqual([]);
  });

  it("keeps 報到桌 distinct from a plain 桌子", () => {
    // The cue table is ordered longest-phrase-first, so 「兩張報到桌」 must not
    // be read as two generic tables.
    const s2 = slots("要兩張報到桌");
    expect(s2.requiredAssets.length).toBe(1);
    expect(s2.requiredAssets[0].value.zone).toBe("registration");
  });

  it("tags a service desk with the zone it belongs to", () => {
    const s2 = slots("要一張收費桌");
    expect(s2.requiredAssets[0].value.zone).toBe("payment");
  });

  it("shows the requested furniture in the readback", () => {
    const p = parseRequest("幫我排一個 40 人的茶會，要三張長桌");
    expect(describeParse(p).join(" ")).toContain("builtin:table × 3");
  });

  it("reads how many alternatives were asked for", () => {
    expect(slots("提出三種方案").schemeCount?.value).toBe(3);
    expect(slots("提出兩種改善方案").schemeCount?.value).toBe(2);
  });

  it("keeps the evidence substring for every slot it fills", () => {
    const s = slots("排 60 人的茶會，門口保留 1.2 公尺");
    expect(s.participants!.evidence).toContain("60");
    expect(s.eventType!.evidence).toBe("茶會");
    expect(s.doorClearance!.evidence).toContain("1.2");
  });
});

describe("intent classification", () => {
  const intents = (t: string) => {
    const n = normalize(t);
    return classify(n, extractSlots(n)).map((i) => i.type);
  };

  it("scores on combinations, not on a single keyword", () => {
    // 「場」 alone is not a request to lay out a room.
    expect(intents("這個場地叫什麼")).not.toContain("design-layout");
    expect(intents("幫我排一個 60 人的茶會")).toContain("design-layout");
  });

  it("handles negation", () => {
    expect(intents("先不要模擬，只要排版")).not.toContain("simulate");
    expect(intents("排好之後模擬人流")).toContain("simulate");
  });

  it("recognises each planning intent", () => {
    expect(intents("幫我排一個 60 人的禪學社茶會")).toContain("design-layout");
    expect(intents("提出三種方案")).toContain("propose-alternatives");
    expect(intents("把報到桌移到入口右側")).toContain("move-objects");
    expect(intents("找出目前最塞的地方")).toContain("diagnose-bottleneck");
    expect(intents("模擬 60 人進場")).toContain("simulate");
    expect(intents("比較一下哪個好")).toContain("compare");
    expect(intents("建立一個桌子素材，尺寸 180x60x74 公分")).toContain("create-asset");
    expect(intents("幫我做一個六面骰子")).toContain("create-prop");
    expect(intents("產生一張工作人員看得懂的場佈圖")).toContain("export-deliverables");
    expect(intents("檢查一下有沒有問題")).toContain("inspect");
  });

  it("recognises the improvement phrasing partner mode uses", () => {
    expect(intents("幫我改善，把報到和收費分開，入口旁邊留 1 公尺不要擋門")).toContain("design-layout");
  });

  it("survives normalisation of 「推薦一個」", () => {
    expect(intents("模擬後推薦一個")).toContain("compare");
  });

  it("falls back to unknown rather than guessing", () => {
    expect(intents("今天天氣如何")).toEqual(["unknown"]);
  });

  it("returns the cues that fired, so a wrong reading is visible", () => {
    const n = normalize("幫我排一個 60 人的茶會");
    const scored = classify(n, extractSlots(n));
    expect(scored[0].matched.length).toBeGreaterThan(0);
    expect(scored[0].matched.join(" ")).toContain("action:");
  });
});

describe("parseRequest", () => {
  it("states its assumptions instead of hiding them", () => {
    const p = parseRequest("幫我排一個茶會");
    expect(p.assumptions.some((a) => a.includes("60 人"))).toBe(true);
    expect(p.assumptions.some((a) => a.includes("工作人員"))).toBe(true);
  });

  it("makes no assumption about something the sentence stated", () => {
    const p = parseRequest("幫我排一個 80 人的茶會，工作人員 6 人，門口保留 1.5 公尺");
    expect(p.slots.participants?.value).toBe(80);
    expect(p.slots.staffCount?.value).toBe(6);
    expect(p.assumptions.some((a) => a.includes("幾個人"))).toBe(false);
    expect(p.assumptions.some((a) => a.includes("工作人員"))).toBe(false);
    expect(p.assumptions.some((a) => a.includes("門口"))).toBe(false);
  });

  it("describes what it understood in readable lines", () => {
    const p = parseRequest("幫我排一個 60 人的禪學社茶會，門口保留 1.2 公尺");
    const lines = describeParse(p);
    expect(lines.join("\n")).toContain("人數：60");
    expect(lines.join("\n")).toContain("tea-gathering");
    expect(lines.join("\n")).toContain("1.2");
  });

  it("keeps the raw text untouched", () => {
    const raw = "幫我排一個 ６０ 人的茶會";
    expect(parseRequest(raw).raw).toBe(raw);
  });
});
