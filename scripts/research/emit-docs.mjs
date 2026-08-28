#!/usr/bin/env node
/**
 * Emit the shipped research artefacts from the two sources of truth:
 *   - the raw Perplexity transcripts (citations → sources.json)
 *   - src/core/spatialKnowledge.ts (curated entries → knowledge.json)
 *
 * Generating knowledge.json rather than hand-writing it is deliberate: a
 * hand-copy drifts, and a knowledge file that disagrees with the code the app
 * actually runs is worse than no file at all.
 *
 * Usage: node scripts/research/emit-docs.mjs <rawDir>
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const OUT = "docs/research/spatial-design";

async function main() {
  const rawDir = process.argv[2] ?? ".research-raw";

  // --- sources.json -------------------------------------------------
  const files = (await readdir(rawDir)).filter((f) => f.endsWith(".json")).sort();
  const topics = [];
  for (const f of files) {
    const j = JSON.parse(await readFile(join(rawDir, f), "utf8"));
    topics.push({
      id: j.id,
      topic: j.topic,
      question: j.question,
      model: j.model ?? null,
      retrievedAt: j.retrievedAt ?? null,
      error: j.error ?? null,
      sources: (j.searchResults ?? []).map((r) => ({
        url: r.url,
        title: r.title ?? null,
        date: r.date ?? null,
        sourceType: classify(r.url),
      })),
    });
  }
  await writeFile(
    join(OUT, "sources.json"),
    JSON.stringify(
      {
        generatedBy: "scripts/research/emit-docs.mjs",
        tool: "Perplexity API (sonar-pro) via scripts/research/pplx.mjs",
        note:
          "These are the pages the research pass consulted. A citation here means 'this URL was returned and read', " +
          "NOT 'this claim is verified'. Verified conclusions live in knowledge.json with their own confidence field.",
        topicCount: topics.length,
        topics,
      },
      null,
      2,
    ),
    "utf8",
  );

  // --- knowledge.json ----------------------------------------------
  const mod = await import(pathToFileURL(join(process.cwd(), "src/core/spatialKnowledge.ts")).href);
  await writeFile(
    join(OUT, "knowledge.json"),
    JSON.stringify(
      {
        generatedBy: "scripts/research/emit-docs.mjs from src/core/spatialKnowledge.ts",
        note: "Generated. Edit the TypeScript module, not this file.",
        safetyDisclaimer: mod.SAFETY_DISCLAIMER,
        forbiddenClaims: mod.FORBIDDEN_CLAIMS,
        entryCount: mod.KNOWLEDGE_BASE.length,
        entries: mod.KNOWLEDGE_BASE,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`sources.json: ${topics.length} topics, ${topics.reduce((n, t) => n + t.sources.length, 0)} urls`);
  console.log(`knowledge.json: ${mod.KNOWLEDGE_BASE.length} entries`);
}

function classify(url) {
  const u = String(url);
  if (/law\.moj\.gov\.tw|\.gov\.tw|gazette\.nat\.gov\.tw|ada\.gov/.test(u)) return "government";
  if (/tku\.edu\.tw/.test(u)) return "university";
  if (/khronos\.org|nfpa\.org|w3\.org|whatwg\.org/.test(u)) return "official-standard";
  if (/threejs\.org|github\.com|developer\.mozilla\.org|web\.dev|docs\.anthropic\.com|platform\.openai\.com|modelcontextprotocol\.io|gltf-transform\.dev|vite\.dev|vitest\.dev|playwright\.dev|developer\.apple\.com|m3\.material\.io/.test(u)) return "official-docs";
  if (/wikipedia\.org/.test(u)) return "encyclopedia";
  return "secondary";
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
