/**
 * Structured natural-language understanding for the planning agent.
 *
 * The old provider matched a handful of keywords with one regex per feature and
 * emitted a fixed tool list. That fails in the ways keyword matching always
 * fails: 「不要模擬」 fires the simulate rule, 「六十人」 finds no headcount,
 * 「門口保留 1.2 公尺」 is read as the phrase 「1 公尺」 and the 1.2 is thrown
 * away, and the parse is invisible so a wrong reading looks like a wrong answer.
 *
 * This module replaces that with three separate, separately testable stages:
 *
 *   1. `normalize`  — full-width to half-width, Chinese numerals to digits,
 *                     so the rest of the pipeline sees one shape of text.
 *   2. `extractSlots` — typed values with UNITS: headcount, metres, dimensions,
 *                     event type, required zones, objectives, spatial relations.
 *                     Every slot records the substring it came from, so the UI
 *                     can show the user what was actually understood.
 *   3. `classify`   — intents scored on COMBINATIONS of cues (a verb AND an
 *                     object AND the slots that intent needs), with negation
 *                     handled, rather than one keyword each.
 *
 * Planning (`planner.ts`) is a fourth stage and needs the project, because
 * 「把報到桌移到入口右側」 cannot become coordinates without knowing where the
 * entrance is. Keeping it separate is what lets parsing be tested with no
 * project and resolution be tested with fixtures.
 *
 * Nothing here calls a model. This is the offline path that must keep working
 * when no cloud provider is configured.
 */

import type { ZoneType } from "../core/model";
import type { EventType, LayoutObjective } from "../core/spatialPlanner";

/* ------------------------------------------------------------------ */
/* 1. Normalisation                                                    */
/* ------------------------------------------------------------------ */

const CJK_DIGIT: Record<string, number> = {
  〇: 0, 零: 0, 一: 1, 壹: 1, 二: 2, 貳: 2, 兩: 2, 三: 3, 參: 3, 四: 4, 肆: 4,
  五: 5, 伍: 5, 六: 6, 陸: 6, 七: 7, 柒: 7, 八: 8, 捌: 8, 九: 9, 玖: 9,
};

/** 六十 → 60, 一百二十 → 120, 十五 → 15, 兩 → 2. */
function cjkNumber(text: string): number | null {
  if (!text) return null;
  let total = 0;
  let section = 0;
  let current = 0;
  let sawAny = false;
  for (const ch of text) {
    if (ch in CJK_DIGIT) {
      current = CJK_DIGIT[ch];
      sawAny = true;
    } else if (ch === "十" || ch === "拾") {
      section += (current === 0 ? 1 : current) * 10;
      current = 0;
      sawAny = true;
    } else if (ch === "百" || ch === "佰") {
      section += (current === 0 ? 1 : current) * 100;
      current = 0;
      sawAny = true;
    } else if (ch === "千" || ch === "仟") {
      section += (current === 0 ? 1 : current) * 1000;
      current = 0;
      sawAny = true;
    } else if (ch === "萬") {
      total += (section + current) * 10000;
      section = 0;
      current = 0;
      sawAny = true;
    } else {
      return null;
    }
  }
  if (!sawAny) return null;
  return total + section + current;
}

const CJK_NUM_CHARS = "〇零一壹二貳兩三參四肆五伍六陸七柒八捌九玖十拾百佰千仟萬";

/**
 * Characters that mean "the thing before me was a quantity".
 *
 * Converting every Chinese numeral unconditionally is wrong in a way that is
 * easy to miss: 參與感 becomes 3與感 and 一起 becomes 1起, so a cue containing
 * either can never fire and the normalized text shown to the user is garbled.
 * Requiring a counter (or an unambiguous compound like 六十) keeps 「六十人」,
 * 「一公尺」 and 「三種方案」 working while leaving ordinary words alone.
 *
 * 次 / 遍 / 下 are deliberately NOT counters here: no slot needs them, and
 * leaving them out keeps 跑一次 / 走一遍 / 看一下 readable.
 */
const COUNTERS = "人位名張個件組排列面條邊桌把份種款公米尺坪";

/** 六十 / 一百二十 — a compound is a number whatever follows it. */
function isCompound(run: string): boolean {
  return run.length >= 2 && /[十拾百佰千仟萬]/.test(run);
}

/**
 * Fold full-width characters to ASCII and rewrite Chinese numerals as digits,
 * so a single numeric pattern can serve both 「60 人」 and 「六十人」.
 *
 * Every cue table in this file is written against the OUTPUT of this function.
 * `test/agentIntent.test.ts` extracts the literal alternatives out of each cue
 * regex and asserts `normalize(literal) === literal`, so a cue that this
 * function would rewrite fails the suite instead of silently never matching.
 */
export function normalize(input: string): string {
  let s = input
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(new RegExp(String.fromCharCode(0x3000), "g"), " ") // ideographic space
    .replace(/[，、]/g, ",")
    .replace(/[。；]/g, ".")
    .replace(/[×✕✖╳]/g, "x")
    .replace(/\s+/g, " ")
    .trim();

  // Runs are bounded to 8 characters so a sentence full of 一 cannot collapse
  // into one enormous number.
  s = s.replace(new RegExp(`[${CJK_NUM_CHARS}]{1,8}`, "g"), (run, offset: number, whole: string) => {
    const next = whole[offset + run.length] ?? "";
    // `"abc".includes("")` is true, so a numeral at the very end of the string
    // would count as "followed by a counter" and 統一 would become 統1.
    const followedByCounter = next !== "" && COUNTERS.includes(next);
    if (!isCompound(run) && !followedByCounter) return run;
    const n = cjkNumber(run);
    return n === null ? run : String(n);
  });
  return s;
}

/* ------------------------------------------------------------------ */
/* 2. Slots                                                            */
/* ------------------------------------------------------------------ */

export interface Slot<T> {
  value: T;
  /** The text this was read from, so the UI can show the user the reading. */
  evidence: string;
}

export type SpatialRelation =
  | "left" | "right" | "center" | "front" | "back"
  | "near-entrance" | "near-exit" | "along-wall";

export interface ObjectReference {
  /** What the user called it. */
  phrase: string;
  /** Which service role it maps to, when it maps to one. */
  serviceRole?: "checkin" | "payment" | "guidance" | "storage";
  /** Which zone type it maps to, when it maps to one. */
  zoneType?: ZoneType;
  /** Where the user wants it. */
  relation?: SpatialRelation;
  /** Clearance the user asked for around it, in metres. */
  clearance?: number;
}

export interface ExtractedSlots {
  participants?: Slot<number>;
  staffCount?: Slot<number>;
  eventType?: Slot<EventType>;
  /** Metres kept in front of doors. */
  doorClearance?: Slot<number>;
  /** Metres of aisle. */
  aisleWidth?: Slot<number>;
  /** Explicit width x depth (x height) in metres. */
  dimensions?: Slot<{ width: number; depth: number; height?: number }>;
  /** Venue footprint the user stated, e.g. 「3x3 公尺攤位」. */
  venueSize?: Slot<{ length: number; width: number }>;
  requiredZones: Slot<ZoneType>[];
  objectives: Slot<LayoutObjective>[];
  objectRefs: ObjectReference[];
  /** How many alternatives the user asked for. */
  schemeCount?: Slot<number>;
  /** Named audience, e.g. 淡江大學生. Kept for the rationale, not for maths. */
  audience?: Slot<string>;
  /** Furniture asked for by name and count: 「三張長桌」「兩個架子」. */
  requiredAssets: Slot<{ assetId: string; count: number; zone?: ZoneType }>[];
  /** A prop or piece of collateral to make: 「做一個 A2 海報」「桌前布條」. */
  propRequest?: Slot<{
    kind: string;
    text?: string;
    printStandard?: string;
    quantity?: number;
    sides?: 1 | 2;
  }>;
}

/** Metres for a number written with a unit. Returns null when there is no unit. */
function toMeters(value: number, unit: string): number | null {
  switch (unit) {
    case "公尺": case "米": case "m": case "M": return value;
    case "公分": case "厘米": case "釐米": case "cm": case "CM": return value / 100;
    case "毫米": case "mm": return value / 1000;
    default: return null;
  }
}

const UNIT = "(公尺|公分|厘米|釐米|毫米|米|mm|cm|m|CM|M)";
const NUM = "(\\d+(?:\\.\\d+)?)";

export const EVENT_TYPE_CUES: { re: RegExp; type: EventType }[] = [
  { re: /茶會|茶敘|品茶|奉茶/, type: "tea-gathering" },
  { re: /禪坐|靜坐|打坐|禪修|禪訓|共修/, type: "meditation" },
  { re: /攤位|擺攤|園遊會|市集|展攤/, type: "booth" },
  { re: /社課|上課|課程|教室排|研習/, type: "classroom" },
  { re: /演講|講座|分享會/, type: "lecture" },
  { re: /工作坊|體驗營|營隊/, type: "workshop" },
];

export const ZONE_CUES: { re: RegExp; zone: ZoneType }[] = [
  { re: /報到|簽到|check-?in/i, zone: "registration" },
  { re: /收費|繳費|付款|售票/, zone: "payment" },
  { re: /鞋子|鞋區|脫鞋|鞋架/, zone: "shoe" },
  { re: /背包|置物|寄物|包包/, zone: "backpack" },
  { re: /地墊|坐墊|墊子|禪坐區|靜坐區/, zone: "meditation" },
  { re: /小組|分組|討論區/, zone: "group" },
  { re: /生活|服務台|茶水/, zone: "life" },
];

/**
 * NOTE for every cue table below: these run against NORMALIZED text, where
 * Chinese numerals have already become digits. A pattern containing 一/兩/三
 * can therefore never match — 「推薦一個」 arrives as 「推薦1個」. Write digits.
 * test/intent.test.ts asserts that no cue regex contains a CJK numeral.
 */
export const OBJECTIVE_CUES: { re: RegExp; objective: LayoutObjective }[] = [
  { re: /不要擋門|不擋門|門口保留|門前|淨空|別擋住門/, objective: "clear-doors" },
  { re: /分流|分開|各自|另外(?:排|設|開)|分\s*\d*\s*(?:條|邊|桌)/, objective: "separate-checkin-payment" },
  { re: /最塞|壅塞|擁擠|人擠人|塞車|降低排隊|減少排隊|不要排太久/, objective: "reduce-crowding" },
  { re: /互動|體驗|停留|吸引|參與感/, objective: "increase-interaction" },
  { re: /好管理|方便管理|人力少|省人力|容易顧/, objective: "easy-to-staff" },
  { re: /坐更多|多坐|最多人|容納最多|塞更多人/, objective: "maximise-capacity" },
];

/**
 * Furniture the brief can ask for by the piece.
 *
 * Ordered longest-phrase-first so 「報到桌」 is not matched as 「桌」. The
 * counter is deliberately loose (張/個/台/組/支/把/座) because people do not
 * agree on measure words for furniture.
 */
/**
 * Props and collateral the agent can make, matched longest-phrase-first.
 *
 * These map onto `KIND_PRESETS` in `propRecipe.ts` — the recipe layer owns the
 * geometry, this table only has to recognise the words.
 */
export const PROP_KIND_CUES: { re: RegExp; kind: string }[] = [
  // 文宣 — the longest phrases first so 「A2 海報」 is not read as 「海報」
  { re: /x\s*展架|展架/i, kind: "x展架" },
  { re: /易拉寶|拉捲式|捲軸式/, kind: "易拉寶" },
  { re: /珍珠板立牌|珍珠板/, kind: "珍珠板立牌" },
  { re: /桌上立牌|桌牌|桌卡/, kind: "桌上立牌" },
  { re: /桌前布條|桌裙|桌圍/, kind: "桌前布條" },
  { re: /直式布條|布條|布幔/, kind: "直式布條" },
  { re: /海報|poster/i, kind: "海報" },
  { re: /傳單|dm|文宣單/i, kind: "海報" },
  // 背景
  { re: /大型?背景牆|大背景/, kind: "大背景" },
  { re: /合照背景|背景牆|背板|背景圖/, kind: "背景牆" },
  // 擺攤小物
  { re: /dm\s*架|傳單架|文宣架/i, kind: "傳單架" },
  { re: /名片架/, kind: "名片架" },
  { re: /抽獎箱|投票箱/, kind: "抽獎箱" },
  { re: /募款箱|隨喜箱/, kind: "募款箱" },
  { re: /試吃盤|樣品盤/, kind: "試吃盤" },
  { re: /qr\s*立?架|掃碼架/i, kind: "qr立架" },
  { re: /集章台|集章/, kind: "集章台" },
  { re: /獎品架|陳列架/, kind: "獎品架" },
  { re: /桌巾/, kind: "桌巾" },
];

export const COUNTABLE_ASSET_CUES: { re: RegExp; assetId: string; label: string; zone?: ZoneType }[] = [
  { re: /報到桌|簽到桌/, assetId: "builtin:regTable", label: "報到桌", zone: "registration" },
  { re: /收費桌|繳費桌|售票桌/, assetId: "builtin:regTable", label: "收費桌", zone: "payment" },
  { re: /長桌|折疊桌|會議桌|桌子|方桌/, assetId: "builtin:table", label: "桌子" },
  { re: /椅子|摺疊椅|凳子/, assetId: "builtin:chair", label: "椅子" },
  { re: /投影幕|布幕|螢幕/, assetId: "builtin:screen", label: "投影幕" },
  { re: /電腦|筆電/, assetId: "builtin:computer", label: "電腦" },
  { re: /地墊|坐墊|墊子/, assetId: "builtin:mat", label: "地墊" },
];

export const RELATION_CUES: { re: RegExp; relation: SpatialRelation }[] = [
  { re: /右(側|邊|方)/, relation: "right" },
  { re: /左(側|邊|方)/, relation: "left" },
  { re: /中央|正中|中間/, relation: "center" },
  { re: /前(方|面)|靠前/, relation: "front" },
  { re: /後(方|面)|靠後|最後面/, relation: "back" },
  { re: /入口|門口|進場處/, relation: "near-entrance" },
  { re: /出口|離場/, relation: "near-exit" },
  { re: /靠牆|貼牆|沿牆/, relation: "along-wall" },
];

export const OBJECT_CUES: { re: RegExp; phrase: string; serviceRole?: ObjectReference["serviceRole"]; zoneType?: ZoneType }[] = [
  { re: /報到桌|簽到桌/, phrase: "報到桌", serviceRole: "checkin", zoneType: "registration" },
  { re: /收費桌|繳費桌|售票桌/, phrase: "收費桌", serviceRole: "payment", zoneType: "payment" },
  { re: /引導(桌|台)|指引台/, phrase: "引導台", serviceRole: "guidance" },
  { re: /鞋架|鞋櫃/, phrase: "鞋架", zoneType: "shoe" },
  { re: /置物架|寄物櫃/, phrase: "置物架", zoneType: "backpack" },
  { re: /地墊|坐墊|墊子/, phrase: "地墊", zoneType: "meditation" },
];

/**
 * Which fragment of the sentence a clause belongs to. Splitting on commas
 * before reading relations is what stops 「報到桌移到右側，收費桌移到左側」
 * from assigning both sides to both desks.
 */
function clauses(text: string): string[] {
  return text.split(/[,.;]|然後|接著|最後|再/).map((c) => c.trim()).filter(Boolean);
}

export function extractSlots(normalized: string): ExtractedSlots {
  const slots: ExtractedSlots = { requiredZones: [], objectives: [], objectRefs: [], requiredAssets: [] };
  const t = normalized;

  // --- headcount. 「60 人」 but not 「1 公尺」 and not 「3 種方案」.
  const people = t.match(new RegExp(`${NUM}\\s*(?:位|名|人)(?![次個])`));
  if (people) slots.participants = { value: Math.round(Number(people[1])), evidence: people[0] };

  const staff = t.match(new RegExp(`(?:工作人員|人力|幹部|志工)\\s*${NUM}\\s*(?:位|名|人)?`));
  if (staff) slots.staffCount = { value: Math.round(Number(staff[1])), evidence: staff[0] };
  else {
    const staff2 = t.match(new RegExp(`${NUM}\\s*(?:位|名|人)\\s*(?:工作人員|人力|幹部|志工)`));
    if (staff2) slots.staffCount = { value: Math.round(Number(staff2[1])), evidence: staff2[0] };
  }

  // --- door clearance. Read the number NEXT TO the door phrase, so
  // 「門口保留 1.2 公尺」 keeps 1.2 rather than matching a bare 「1 公尺」.
  const door = t.match(new RegExp(`(?:門口|門前|入口|大門)\\s*(?:要)?(?:保留|預留|留|空出|淨空)?\\s*${NUM}\\s*${UNIT}`));
  if (door) {
    const m = toMeters(Number(door[1]), door[2]);
    if (m !== null) slots.doorClearance = { value: m, evidence: door[0] };
  }

  // --- aisle width, including the 「兩邊各保留一公尺走道」 shape.
  const aisle =
    t.match(new RegExp(`(?:走道|通道|走廊)\\s*(?:寬|寬度)?\\s*(?:至少|最少|保留|留)?\\s*${NUM}\\s*${UNIT}`)) ??
    t.match(new RegExp(`(?:各|每邊|\\d*邊各)?\\s*(?:保留|留|空出)\\s*${NUM}\\s*${UNIT}\\s*(?:的)?\\s*(?:走道|通道|走廊)`));
  if (aisle) {
    const m = toMeters(Number(aisle[1]), aisle[2]);
    if (m !== null) slots.aisleWidth = { value: m, evidence: aisle[0] };
  }

  // --- explicit dimensions: 180x60x74 公分 / 3x3 公尺
  const dim3 = t.match(new RegExp(`${NUM}\\s*x\\s*${NUM}\\s*x\\s*${NUM}\\s*${UNIT}`));
  if (dim3) {
    const u = dim3[4];
    const w = toMeters(Number(dim3[1]), u);
    const d = toMeters(Number(dim3[2]), u);
    const h = toMeters(Number(dim3[3]), u);
    if (w !== null && d !== null && h !== null) {
      slots.dimensions = { value: { width: w, depth: d, height: h }, evidence: dim3[0] };
    }
  } else {
    const dim2 = t.match(new RegExp(`${NUM}\\s*x\\s*${NUM}\\s*${UNIT}`));
    if (dim2) {
      const u = dim2[3];
      const w = toMeters(Number(dim2[1]), u);
      const d = toMeters(Number(dim2[2]), u);
      if (w !== null && d !== null) {
        // A 3x3 公尺 attached to 攤位/場地/教室 describes the VENUE, not an
        // object to place. Reading it as furniture produced a three-metre desk.
        if (/攤位|場地|教室|空間|區域/.test(t)) {
          slots.venueSize = { value: { length: w, width: d }, evidence: dim2[0] };
        } else {
          slots.dimensions = { value: { width: w, depth: d }, evidence: dim2[0] };
        }
      }
    }
  }

  // --- event type
  for (const { re, type } of EVENT_TYPE_CUES) {
    const m = t.match(re);
    if (m) {
      slots.eventType = { value: type, evidence: m[0] };
      break;
    }
  }

  // --- zones and objectives, deduplicated
  const seenZones = new Set<ZoneType>();
  for (const { re, zone } of ZONE_CUES) {
    const m = t.match(re);
    if (m && !seenZones.has(zone)) {
      seenZones.add(zone);
      slots.requiredZones.push({ value: zone, evidence: m[0] });
    }
  }
  const seenObj = new Set<LayoutObjective>();
  for (const { re, objective } of OBJECTIVE_CUES) {
    const m = t.match(re);
    if (m && !seenObj.has(objective)) {
      seenObj.add(objective);
      slots.objectives.push({ value: objective, evidence: m[0] });
    }
  }

  // --- object references with their own clause's relation and clearance
  for (const clause of clauses(t)) {
    for (const cue of OBJECT_CUES) {
      const m = clause.match(cue.re);
      if (!m) continue;
      const ref: ObjectReference = { phrase: cue.phrase };
      if (cue.serviceRole) ref.serviceRole = cue.serviceRole;
      if (cue.zoneType) ref.zoneType = cue.zoneType;
      for (const r of RELATION_CUES) {
        if (r.re.test(clause)) {
          ref.relation = r.relation;
          break;
        }
      }
      const c = clause.match(new RegExp(`(?:保留|留|空出|距離)\\s*${NUM}\\s*${UNIT}`));
      if (c) {
        const m2 = toMeters(Number(c[1]), c[2]);
        if (m2 !== null) ref.clearance = m2;
      }
      slots.objectRefs.push(ref);
    }
  }

  // --- how many alternatives
  const schemes = t.match(new RegExp(`${NUM}\\s*(?:種|個|款)[^,.;]{0,4}?(?:方案|做法|配置|排法|版本)`));
  if (schemes) slots.schemeCount = { value: Math.round(Number(schemes[1])), evidence: schemes[0] };

  // --- furniture asked for by the piece
  {
    const COUNTER = "(?:張|個|台|臺|組|支|把|座|件)";
    const seen = new Set<string>();
    for (const cue of COUNTABLE_ASSET_CUES) {
      // The count must sit immediately before the noun, so 「留 1 公尺，放三張
      // 長桌」 reads three tables and not one.
      const re = new RegExp(`${NUM}\\s*${COUNTER}\\s*(?:的)?\\s*(?:${cue.re.source})`);
      const m = t.match(re);
      if (!m) continue;
      const key = `${cue.assetId}:${cue.zone ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      slots.requiredAssets.push({
        value: {
          assetId: cue.assetId,
          count: Math.max(1, Math.round(Number(m[1]))),
          ...(cue.zone ? { zone: cue.zone } : {}),
        },
        evidence: m[0],
      });
    }
  }

  // --- a prop or piece of collateral to make
  {
    const makeVerb = /做|製作|建立|新增|設計|來(?:一|1)?[張個面塊]|生成|弄/;
    for (const cue of PROP_KIND_CUES) {
      const m = t.match(cue.re);
      if (!m) continue;
      // Only treat it as a request to MAKE something when the sentence says so;
      // 「海報放右邊」 is a placement instruction about a poster that exists.
      if (!makeVerb.test(t)) break;
      const value: NonNullable<ExtractedSlots["propRequest"]>["value"] = { kind: cue.kind };
      // Word boundaries written as an explicit class: a literal \b in a
      // generated string is a BACKSPACE, and this line spent a while silently
      // requiring two of them before an A5 would be recognised.
      const std = t.match(/(?:^|[^A-Za-z0-9])(A[1-6]|B2)(?![A-Za-z0-9])/i);
      if (std) value.printStandard = std[1].toUpperCase();
      const qty = t.match(new RegExp(`${NUM}\\s*(?:張|份|個|面|塊)`));
      if (qty) value.quantity = Math.max(1, Math.round(Number(qty[1])));
      if (/雙面/.test(t)) value.sides = 2;
      const quoted = t.match(/[「"']([^」"']{1,40})[」"']/);
      if (quoted) value.text = quoted[1];
      slots.propRequest = { value, evidence: m[0] };
      break;
    }
  }

  const audience = t.match(/(淡江大學(?:學)?生|大學生|新生|社員|同學|校友|老師)/);
  if (audience) slots.audience = { value: audience[1], evidence: audience[0] };

  return slots;
}

/* ------------------------------------------------------------------ */
/* 3. Intent classification                                            */
/* ------------------------------------------------------------------ */

export type PlanIntentType =
  | "design-layout"
  | "propose-alternatives"
  | "move-objects"
  | "diagnose-bottleneck"
  | "simulate"
  | "compare"
  | "create-asset"
  | "create-prop"
  | "export-deliverables"
  | "inspect"
  | "unknown";

export interface ScoredIntent {
  type: PlanIntentType;
  score: number;
  /** Which cues fired, so a wrong reading can be seen rather than guessed at. */
  matched: string[];
}

export interface IntentRule {
  type: PlanIntentType;
  /** Each group must contribute at least one match for the group's weight. */
  groups: { name: string; re: RegExp; weight: number }[];
  /** Extra weight when these slots are present. */
  slotBonus?: { has: (s: ExtractedSlots) => boolean; weight: number; name: string }[];
  threshold: number;
}

// 「幫我改善」 and 「優化一下」 are layout requests too — the partner-mode
// suggestion flow speaks exactly that way, and without them it parses as
// unknown and the assistant answers a question nobody asked.
const ACTION_DESIGN = /排|安排|規劃|設計|配置|佈置|布置|擺|做\d*個場|弄\d*個場|改善|優化|順一點|更好/;
const ACTION_CHANGE = /改成|調整|移到|搬到|換到|移動|挪到|放到/;
const ACTION_MAKE = /建立|做\d*個|做個|新增|生成|產生|弄\d*個|匯入/;

export const INTENT_RULES: IntentRule[] = [
  {
    type: "design-layout",
    groups: [
      { name: "action", re: ACTION_DESIGN, weight: 2 },
      { name: "subject", re: /場|活動|茶會|禪坐|靜坐|社課|攤位|教室|位置|配置|報到|收費|動線|走道|入口/, weight: 1 },
    ],
    slotBonus: [
      { name: "participants", has: (s) => !!s.participants, weight: 2 },
      { name: "eventType", has: (s) => !!s.eventType, weight: 1 },
      { name: "zones", has: (s) => s.requiredZones.length >= 2, weight: 1 },
    ],
    threshold: 4,
  },
  {
    type: "propose-alternatives",
    groups: [
      { name: "ask", re: /提出|給我|想要|來|列出/, weight: 1 },
      { name: "count", re: /\d+\s*(?:種|個|款)[^,.;]{0,4}?(?:方案|做法|配置|排法|版本)|幾種方案|不同方案|多種方案|方案比較/, weight: 3 },
    ],
    threshold: 3,
  },
  {
    type: "move-objects",
    groups: [
      { name: "action", re: ACTION_CHANGE, weight: 3 },
      { name: "target", re: /桌|架|區|墊|椅|物件|東西/, weight: 1 },
    ],
    slotBonus: [{ name: "objectRefs", has: (s) => s.objectRefs.length > 0, weight: 2 }],
    threshold: 4,
  },
  {
    type: "diagnose-bottleneck",
    groups: [
      { name: "cue", re: /最塞|哪裡塞|瓶頸|壅塞|擁擠|卡住|排最久|問題在哪/, weight: 4 },
    ],
    threshold: 4,
  },
  {
    type: "simulate",
    groups: [
      { name: "cue", re: /模擬|跑一次|人流|進場流程|走一遍|試跑/, weight: 3 },
    ],
    slotBonus: [{ name: "participants", has: (s) => !!s.participants, weight: 1 }],
    threshold: 3,
  },
  {
    type: "compare",
    groups: [{ name: "cue", re: /比較|哪個好|哪\s*\d*\s*個(?:好|比較)|推薦\s*\d*\s*個|選\s*\d*\s*個|對照/, weight: 3 }],
    threshold: 3,
  },
  {
    type: "create-asset",
    groups: [
      { name: "action", re: ACTION_MAKE, weight: 2 },
      { name: "subject", re: /素材|照片|相片|3d|模型|glb|gltf|桌子|椅子/i, weight: 2 },
    ],
    slotBonus: [{ name: "dimensions", has: (s) => !!s.dimensions, weight: 2 }],
    threshold: 4,
  },
  {
    type: "create-prop",
    groups: [
      { name: "action", re: ACTION_MAKE, weight: 2 },
      // Games AND the stall's own props and collateral. Without the second
      // half, 「做一張 A2 海報」 scored 2 against a threshold of 5 and fell
      // through to "unknown" — the slots had already read it correctly.
      {
        name: "subject",
        re: /骰子|轉盤|抽卡|道具|關卡|遊戲|海報|傳單|展架|易拉寶|布條|桌巾|立牌|背景牆|背景圖|背板|抽獎箱|募款箱|隨喜箱|名片架|文宣|dm|qr|集章|獎品架|陳列架|試吃盤|樣品盤/i,
        weight: 3,
      },
    ],
    slotBonus: [{ name: "propRequest", has: (s) => !!s.propRequest, weight: 2 }],
    threshold: 5,
  },
  {
    type: "export-deliverables",
    groups: [
      { name: "action", re: /產生|輸出|匯出|給我|印|做\d*張/, weight: 2 },
      { name: "subject", re: /場佈圖|施工圖|動線圖|物資清單|物資表|夥伴|工作人員看|平面圖|清單/, weight: 3 },
    ],
    threshold: 5,
  },
  {
    type: "inspect",
    groups: [
      { name: "cue", re: /檢查|看一下|有沒有問題|哪裡有錯|確認一下|驗證/, weight: 3 },
    ],
    threshold: 3,
  },
];

/** 「不要模擬」「先不要排」 must not fire the rule they mention. */
const NEGATION = /(?:不要|不用|別|先不|暫時不|不需要|沒有要)\s*$/;

function isNegated(text: string, matchIndex: number): boolean {
  const before = text.slice(Math.max(0, matchIndex - 6), matchIndex);
  return NEGATION.test(before);
}

export function classify(normalized: string, slots: ExtractedSlots): ScoredIntent[] {
  const out: ScoredIntent[] = [];
  for (const rule of INTENT_RULES) {
    let score = 0;
    const matched: string[] = [];
    let anyGroupMatched = false;
    for (const g of rule.groups) {
      const m = normalized.match(g.re);
      if (!m || m.index === undefined) continue;
      if (isNegated(normalized, m.index)) continue;
      score += g.weight;
      matched.push(`${g.name}:${m[0]}`);
      anyGroupMatched = true;
    }
    if (!anyGroupMatched) continue;
    for (const b of rule.slotBonus ?? []) {
      if (b.has(slots)) {
        score += b.weight;
        matched.push(`slot:${b.name}`);
      }
    }
    if (score >= rule.threshold) out.push({ type: rule.type, score, matched });
  }
  out.sort((a, b) => b.score - a.score);
  if (!out.length) out.push({ type: "unknown", score: 0, matched: [] });
  return out;
}

/* ------------------------------------------------------------------ */
/* Public parse                                                        */
/* ------------------------------------------------------------------ */

export interface ParsedRequest {
  raw: string;
  normalized: string;
  slots: ExtractedSlots;
  intents: ScoredIntent[];
  /**
   * Values the planner had to assume because the sentence did not say. Shown to
   * the user — an assumption they can see is a question they can answer; one
   * they cannot see is a wrong answer they have to debug.
   */
  assumptions: string[];
}

export function parseRequest(text: string): ParsedRequest {
  const normalized = normalize(text);
  const slots = extractSlots(normalized);
  const intents = classify(normalized, slots);
  const assumptions: string[] = [];

  const wantsLayout = intents.some(
    (i) => i.type === "design-layout" || i.type === "propose-alternatives",
  );
  if (wantsLayout) {
    if (!slots.participants) assumptions.push("沒有說幾個人，先用 60 人估算。");
    if (!slots.eventType) assumptions.push("沒有說活動類型，先當成茶會排。");
    if (!slots.staffCount) assumptions.push("沒有說工作人員數，先用 4 人估算。");
    if (!slots.doorClearance) assumptions.push("沒有說門口要留多少，先用 1.2 公尺。");
  }
  if (intents.some((i) => i.type === "simulate") && !slots.participants) {
    assumptions.push("模擬人數沒有指定，先用 60 人。");
  }

  return { raw: text, normalized, slots, intents, assumptions };
}

/** A short human-readable account of what was understood. */
export function describeParse(parsed: ParsedRequest): string[] {
  const lines: string[] = [];
  const s = parsed.slots;
  if (s.participants) lines.push(`人數：${s.participants.value}（讀自「${s.participants.evidence}」）`);
  if (s.staffCount) lines.push(`工作人員：${s.staffCount.value}`);
  if (s.eventType) lines.push(`活動類型：${s.eventType.value}（讀自「${s.eventType.evidence}」）`);
  if (s.doorClearance) lines.push(`門前保留：${s.doorClearance.value} 公尺`);
  if (s.aisleWidth) lines.push(`走道寬度：${s.aisleWidth.value} 公尺`);
  if (s.venueSize) lines.push(`場地尺寸：${s.venueSize.value.length} x ${s.venueSize.value.width} 公尺`);
  if (s.dimensions) {
    const d = s.dimensions.value;
    lines.push(`物件尺寸：${d.width} x ${d.depth}${d.height ? ` x ${d.height}` : ""} 公尺`);
  }
  if (s.requiredZones.length) lines.push(`區域：${s.requiredZones.map((z) => z.value).join("、")}`);
  if (s.objectives.length) lines.push(`目標：${s.objectives.map((o) => o.value).join("、")}`);
  if (s.schemeCount) lines.push(`方案數：${s.schemeCount.value}`);
  if (s.propRequest) {
    const v = s.propRequest.value;
    lines.push(
      `要做的東西：${v.kind}` +
      (v.printStandard ? `（${v.printStandard}）` : "") +
      (v.quantity ? ` × ${v.quantity}` : "") +
      (v.text ? `，印上「${v.text}」` : "") +
      `（讀自「${s.propRequest.evidence}」）`,
    );
  }
  for (const a of s.requiredAssets) {
    lines.push(`素材：${a.value.assetId} × ${a.value.count}（讀自「${a.evidence}」）`);
  }
  for (const r of s.objectRefs) {
    lines.push(
      `物件：${r.phrase}` +
      (r.relation ? ` → ${r.relation}` : "") +
      (r.clearance ? `（保留 ${r.clearance} 公尺）` : ""),
    );
  }
  return lines;
}
