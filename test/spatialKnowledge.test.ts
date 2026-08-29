import { describe, expect, it } from "vitest";
import {
  assertNoComplianceClaim,
  explainWithSources,
  FORBIDDEN_CLAIMS,
  KNOWLEDGE_BASE,
  knowledgeByCategory,
  knowledgeEntry,
  knowledgeForVenue,
  knowledgeValue,
  SAFETY_DISCLAIMER,
  type KnowledgeCategory,
} from "../src/core/spatialKnowledge";

const REQUIRED_CATEGORIES: KnowledgeCategory[] = [
  "venue-types", "classroom-layout", "booth-layout", "queue-design", "event-flow",
  "accessibility", "safety-warnings", "staff-operations", "meditation-event",
  "tea-event", "student-club-event", "campus-event", "furniture-dimensions",
  "visual-communication", "3d-asset-placement",
];

describe("knowledge record shape", () => {
  it("gives every entry the full set of fields", () => {
    for (const e of KNOWLEDGE_BASE) {
      expect(e.id, "缺少 id").toBeTruthy();
      expect(e.title, `${e.id} 缺少 title`).toBeTruthy();
      expect(e.category, `${e.id} 缺少 category`).toBeTruthy();
      expect(e.summary.length, `${e.id} 的 summary 太短`).toBeGreaterThan(10);
      expect(Array.isArray(e.rules), `${e.id} 缺少 rules`).toBe(true);
      expect(e.rules.length, `${e.id} 沒有任何 rule`).toBeGreaterThan(0);
      expect(Array.isArray(e.examples), `${e.id} 缺少 examples`).toBe(true);
      expect(e.examples.length, `${e.id} 沒有任何 example`).toBeGreaterThan(0);
      expect(["high", "medium", "low"], `${e.id} 的 confidence 不合法`).toContain(e.confidence);
      expect(e.sourceUrl, `${e.id} 缺少 sourceUrl`).toMatch(/^https?:\/\//);
      expect(e.sourceType, `${e.id} 缺少 sourceType`).toBeTruthy();
      expect(e.retrievedAt, `${e.id} 的 retrievedAt 格式錯誤`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.applicableVenueTypes.length, `${e.id} 沒有 applicableVenueTypes`).toBeGreaterThan(0);
      expect(Array.isArray(e.limitations), `${e.id} 缺少 limitations`).toBe(true);
      expect(e.limitations.length, `${e.id} 沒有寫下任何限制`).toBeGreaterThan(0);
      expect(typeof e.requiresHumanReview, `${e.id} 缺少 requiresHumanReview`).toBe("boolean");
    }
  });

  it("has unique ids", () => {
    const ids = KNOWLEDGE_BASE.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers every category the brief listed", () => {
    for (const c of REQUIRED_CATEGORIES) {
      expect(knowledgeByCategory(c).length, `沒有 ${c} 類的知識條目`).toBeGreaterThan(0);
    }
  });

  it("keeps a machine value in metres or a stated unit", () => {
    for (const e of KNOWLEDGE_BASE) {
      for (const r of e.rules) {
        if (r.value !== undefined) {
          expect(r.unit, `${e.id} 的規則有數值但沒有單位`).toBeTruthy();
          expect(Number.isFinite(r.value)).toBe(true);
        }
      }
    }
  });
});

describe("honesty rules", () => {
  it("never claims legal compliance anywhere in the table", () => {
    for (const e of KNOWLEDGE_BASE) {
      const blob = [e.title, e.summary, ...e.rules.map((r) => r.statement), ...e.examples, ...e.limitations].join(" ");
      expect(() => assertNoComplianceClaim(blob, e.id)).not.toThrow();
    }
  });

  it("the guard actually catches the phrases it lists", () => {
    for (const phrase of FORBIDDEN_CLAIMS) {
      expect(() => assertNoComplianceClaim(`這個配置${phrase}。`, "test")).toThrow();
    }
  });

  it("marks every regulated topic as needing human review", () => {
    // Fire, egress, accessibility and law are exactly the topics where a
    // confident answer from software is worse than no answer.
    const regulated = KNOWLEDGE_BASE.filter(
      (e) => e.category === "accessibility" || e.category === "safety-warnings",
    );
    expect(regulated.length).toBeGreaterThan(0);
    for (const e of regulated) {
      expect(e.requiresHumanReview, `${e.id} 涉及法規但沒有標記需要人工確認`).toBe(true);
    }
  });

  it("attaches the disclaimer whenever a cited entry needs review", () => {
    const withReview = explainWithSources("測試", ["accessibility-corridor-width"]);
    expect(withReview.disclaimer).toBe(SAFETY_DISCLAIMER);

    const without = explainWithSources("測試", ["furniture-banquet-table"]);
    expect(without.disclaimer).toBeNull();
  });

  it("records an unsourced figure as inferred and low confidence, not as fact", () => {
    // The research explicitly said it could not find manufacturer pages for
    // stacking chairs. Rounding that up to a fact is the failure this checks.
    const chairs = knowledgeEntry("furniture-stacking-chair")!;
    expect(chairs.sourceType).toBe("inferred");
    expect(chairs.confidence).toBe("low");
    expect(chairs.limitations.join(" ")).toContain("沒有直接來源");
  });

  it("every inferred entry is low confidence", () => {
    for (const e of KNOWLEDGE_BASE) {
      if (e.sourceType === "inferred") {
        expect(e.confidence, `${e.id} 是推論值但信心不是 low`).toBe("low");
      }
    }
  });

  it("records that floor seating has no published per-person figure", () => {
    const entry = knowledgeEntry("floor-seating-no-standard")!;
    expect(entry.summary).toContain("沒有對應的單一標準值");
    // And the capacity tool must therefore not offer an area coefficient for it.
    expect(knowledgeValue("calculateCapacity:floor-mat")).toBeNull();
  });
});

describe("lookup", () => {
  it("finds an entry by id and returns undefined otherwise", () => {
    expect(knowledgeEntry("queue-single-line")).toBeTruthy();
    expect(knowledgeEntry("does-not-exist")).toBeUndefined();
  });

  it("returns venue-specific entries plus the ones that apply anywhere", () => {
    const booth = knowledgeForVenue("outdoor-booth");
    expect(booth.some((e) => e.id === "booth-module-3x3")).toBe(true);
    expect(booth.some((e) => e.applicableVenueTypes.includes("any"))).toBe(true);
  });

  it("resolves the planner inputs the tools actually ask for", () => {
    for (const key of [
      "calculateCapacity:chairs-rows",
      "calculateCapacity:classroom-desks",
      "calculateCapacity:banquet-round",
      "calculateCapacity:standing",
      "checkAccessibilityWarnings",
      "checkDoorClearance",
    ]) {
      expect(knowledgeValue(key), `${key} 沒有對應的知識依據`).not.toBeNull();
    }
  });

  it("explainWithSources carries the url and retrieval date, not just a claim", () => {
    const e = explainWithSources("測試", ["event-area-per-person", "queue-single-line"]);
    expect(e.citations.length).toBe(2);
    for (const c of e.citations) {
      expect(c.sourceUrl).toMatch(/^https?:\/\//);
      expect(c.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(c.confidence).toBeTruthy();
    }
  });

  it("ignores an unknown citation id rather than inventing a source", () => {
    const e = explainWithSources("測試", ["nope", "queue-single-line"]);
    expect(e.citations.length).toBe(1);
  });
});
