import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KNOWLEDGE_BASE, SAFETY_DISCLAIMER, FORBIDDEN_CLAIMS } from "../src/core/spatialKnowledge";

/**
 * The shipped research artefacts have to keep their shape, because they are the
 * only reason a user can check a number the tool told them. A knowledge entry
 * whose source drifts away from the research log is a citation to nothing.
 */

const SOURCES = JSON.parse(readFileSync("docs/research/spatial-design/sources.json", "utf8")) as {
  tool: string;
  note: string;
  topicCount: number;
  topics: {
    id: string;
    topic: string;
    question: string;
    retrievedAt: string | null;
    error: string | null;
    sources: { url: string; title: string | null; sourceType: string }[];
  }[];
};

const KNOWLEDGE_JSON = JSON.parse(readFileSync("docs/research/spatial-design/knowledge.json", "utf8")) as {
  safetyDisclaimer: string;
  forbiddenClaims: string[];
  entryCount: number;
  entries: { id: string; sourceUrl: string; requiresHumanReview: boolean }[];
};

describe("sources.json", () => {
  it("covers all fifteen research topics", () => {
    expect(SOURCES.topicCount).toBe(15);
    expect(SOURCES.topics.length).toBe(15);
    expect(new Set(SOURCES.topics.map((t) => t.id)).size).toBe(15);
  });

  it("records no failed topic silently", () => {
    // A topic that errored must still appear, with its error, so a gap in the
    // research is visible rather than absent.
    for (const t of SOURCES.topics) {
      if (t.error) {
        expect(t.error.length).toBeGreaterThan(0);
      } else {
        expect(t.sources.length, `${t.id} 沒有任何來源`).toBeGreaterThan(0);
      }
    }
  });

  it("gives every topic a question and a retrieval timestamp", () => {
    for (const t of SOURCES.topics) {
      expect(t.question.length, `${t.id} 缺少 question`).toBeGreaterThan(10);
      expect(t.topic.length, `${t.id} 缺少 topic`).toBeGreaterThan(0);
      if (!t.error) {
        expect(t.retrievedAt, `${t.id} 缺少 retrievedAt`).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }
    }
  });

  it("gives every source a url and a classified type", () => {
    const allowed = new Set([
      "government", "university", "official-standard", "official-docs", "encyclopedia", "secondary",
    ]);
    for (const t of SOURCES.topics) {
      for (const s of t.sources) {
        expect(s.url, `${t.id} 有來源缺少網址`).toMatch(/^https?:\/\//);
        expect(allowed.has(s.sourceType), `${t.id} 的 ${s.url} 分類不明：${s.sourceType}`).toBe(true);
      }
    }
  });

  it("says plainly that a citation is not a verified claim", () => {
    // The single most important sentence in the file: these are pages that were
    // read, not facts that were established.
    expect(SOURCES.note).toContain("NOT");
    expect(SOURCES.note.toLowerCase()).toContain("verified");
  });

  it("actually reached official sources for the regulated and campus topics", () => {
    const byId = new Map(SOURCES.topics.map((t) => [t.id, t]));
    const tku = byId.get("13-tamkang-tamsui-venues")!;
    expect(tku.sources.some((s) => s.url.includes("tku.edu.tw")), "淡江題目沒有引用到官方網域").toBe(true);

    const law = byId.get("14-safety-accessibility-egress")!;
    expect(
      law.sources.some((s) => s.sourceType === "government" || s.sourceType === "official-standard"),
      "法規題目沒有引用到政府或標準來源",
    ).toBe(true);
  });
});

describe("knowledge.json stays in step with the code", () => {
  it("is generated from the module, not hand-written", () => {
    expect(KNOWLEDGE_JSON.entryCount).toBe(KNOWLEDGE_BASE.length);
    expect(KNOWLEDGE_JSON.entries.map((e) => e.id)).toEqual(KNOWLEDGE_BASE.map((e) => e.id));
  });

  it("carries the same disclaimer and the same forbidden phrases", () => {
    expect(KNOWLEDGE_JSON.safetyDisclaimer).toBe(SAFETY_DISCLAIMER);
    expect(KNOWLEDGE_JSON.forbiddenClaims).toEqual([...FORBIDDEN_CLAIMS]);
  });

  it("agrees with the module on which entries need human review", () => {
    const inCode = new Map(KNOWLEDGE_BASE.map((e) => [e.id, e.requiresHumanReview]));
    for (const e of KNOWLEDGE_JSON.entries) {
      expect(e.requiresHumanReview, `${e.id} 的 requiresHumanReview 與程式碼不一致`).toBe(inCode.get(e.id));
    }
  });
});

describe("knowledge citations point at pages the research actually read", () => {
  it("every knowledge source host appears in the research log", () => {
    // Not a per-URL match: a curated entry may cite a canonical page (a law
    // index, a spec registry) rather than the exact result row. The host must
    // still be one the research reached, or the citation is decoration.
    const hosts = new Set<string>();
    for (const t of SOURCES.topics) {
      for (const s of t.sources) {
        try { hosts.add(new URL(s.url).hostname.replace(/^www\./, "")); } catch { /* skip */ }
      }
    }
    // Canonical references the curation chose deliberately.
    const allowedCanonical = new Set([
      "en.wikipedia.org",   // queueing theory
      "registry.khronos.org", // glTF 2.0 spec
      "nfpa.org",           // NFPA 101 landing page
      "ufi.org",            // exhibition industry body
    ]);
    for (const e of KNOWLEDGE_BASE) {
      const host = new URL(e.sourceUrl).hostname.replace(/^www\./, "");
      expect(
        hosts.has(host) || allowedCanonical.has(host),
        `${e.id} 的來源 ${host} 不在研究紀錄中，也不在允許的權威來源清單`,
      ).toBe(true);
    }
  });
});
