#!/usr/bin/env node
/**
 * Perplexity research CLI — build-time only, never bundled into the browser app.
 *
 * The API key is read from the PERPLEXITY_API_KEY environment variable and is
 * never written to disk, never logged and never committed. This script lives in
 * `scripts/` precisely so that Vite never sees it: the shipping app has no cloud
 * dependency and no credential (see docs/research/spatial-design/README.md).
 *
 * Usage:
 *   PERPLEXITY_API_KEY=... node scripts/research/pplx.mjs ask "question"
 *   PERPLEXITY_API_KEY=... node scripts/research/pplx.mjs batch questions.json out/
 *
 * Output is raw JSON (answer text + citations). Turning that into knowledge is a
 * separate, human/agent-reviewed step — a search summary is evidence, not truth.
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const API = "https://api.perplexity.ai/chat/completions";
const MODEL = process.env.PPLX_MODEL ?? "sonar-pro";

function requireKey() {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) {
    console.error("PERPLEXITY_API_KEY is not set. Export it in your shell; do not put it in a file.");
    process.exit(2);
  }
  return key;
}

/** One research question → answer text + the URLs it was based on. */
export async function ask(question, { model = MODEL, systemPrompt } = {}) {
  const key = requireKey();
  const body = {
    model,
    messages: [
      {
        role: "system",
        content:
          systemPrompt ??
          "You are a research assistant for a spatial event-planning tool. Prefer official documentation, " +
          "official GitHub repositories, standards bodies, government and university sources. State units " +
          "explicitly. When a figure is a common industry convention rather than a legal requirement, say so. " +
          "Never claim legal compliance. Answer in Traditional Chinese unless the question is about code APIs.",
      },
      { role: "user", content: question },
    ],
    temperature: 0.1,
  };
  const res = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Perplexity ${res.status}: ${text.slice(0, 500)}`);
  }
  const json = await res.json();
  return {
    question,
    model,
    retrievedAt: new Date().toISOString(),
    answer: json.choices?.[0]?.message?.content ?? "",
    // Perplexity has moved the citation field around between API versions; keep
    // whichever shape actually came back rather than assuming one.
    citations: json.citations ?? json.search_results?.map((r) => r.url) ?? [],
    searchResults: json.search_results ?? [],
    usage: json.usage ?? null,
  };
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "ask") {
    const out = await ask(rest.join(" "));
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  if (cmd === "batch") {
    const [specPath, outDir] = rest;
    if (!specPath || !outDir) {
      console.error("usage: batch <questions.json> <outDir>");
      process.exit(2);
    }
    const spec = JSON.parse(await readFile(specPath, "utf8"));
    await mkdir(outDir, { recursive: true });
    for (const item of spec) {
      const target = join(outDir, `${item.id}.json`);
      await mkdir(dirname(target), { recursive: true });
      process.stderr.write(`[pplx] ${item.id} … `);
      try {
        const out = await ask(item.question, item.model ? { model: item.model } : {});
        await writeFile(target, JSON.stringify({ ...item, ...out }, null, 2), "utf8");
        process.stderr.write(`ok (${out.citations.length} citations)\n`);
      } catch (e) {
        // A failed question is recorded as a failure, not silently skipped —
        // a missing topic must be visible in the research log.
        await writeFile(target, JSON.stringify({ ...item, error: String(e) }, null, 2), "utf8");
        process.stderr.write(`FAILED: ${e}\n`);
      }
    }
    return;
  }
  console.error("usage: pplx.mjs ask <question> | pplx.mjs batch <spec.json> <outDir>");
  process.exit(2);
}

if (process.argv[1] && process.argv[1].endsWith("pplx.mjs")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
