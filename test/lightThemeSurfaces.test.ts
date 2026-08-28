/**
 * §18 — 一般使用者預設是明亮模式.
 *
 * Two surfaces shipped with a hard-coded near-black fill outside the dark-theme
 * block: `.readout` (the block that carries every simulation number) and
 * `.comparerow` (the before/after comparison). In the default light theme they
 * rendered as black slabs inside white panels — the single loudest "engineering
 * demo" tell in the editor.
 *
 * The rule this guards is narrow on purpose: a *background* may not be a
 * hard-coded dark colour outside the dark-theme block. Borders, shadows and
 * scrims legitimately are dark in both themes.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

/** The stylesheet with every `[data-theme="dark"]` block removed. */
function lightOnly(source: string): string {
  const out: string[] = [];
  let depth = 0;
  let skipping = false;
  for (const line of source.split(/\r?\n/)) {
    if (!skipping && /\[data-theme="dark"\]/.test(line) && line.includes("{")) {
      skipping = true;
      depth = 0;
    }
    if (skipping) {
      depth += (line.match(/\{/g) ?? []).length;
      depth -= (line.match(/\}/g) ?? []).length;
      if (depth <= 0) skipping = false;
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Near-black fills that would swallow a light panel. */
const DARK_FILL = /background(-color)?\s*:\s*[^;]*(rgba?\(\s*(0|1|2|3|15|30)\s*,\s*(0|6|23|41)\s*,\s*(0|23|42|59)\s*|#0[0-9a-f]{5}\b|#1e293b\b|#0f172a\b)/gi;

describe("the light theme has no hard-coded dark slabs", () => {
  it("no rule outside the dark block paints a near-black background", () => {
    const original = css.split(/\r?\n/);
    const offenders = lightOnly(css)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => {
        DARK_FILL.lastIndex = 0;
        return DARK_FILL.test(line) && !line.startsWith("*") && !line.startsWith("/*");
      })
      // Mapped back to the real file: the stripped copy has different line
      // numbers, and a bare "line 462" sends the reader to the wrong rule.
      .map((line) => ({ line, n: original.findIndex((l) => l.trim() === line) + 1 }))
      // The update banner is a deliberate dark notification toast that sets its
      // own light text; it is not a panel surface.
      .filter(({ n }) => !isInsideRule(css, n, ".update-banner"));
    expect(offenders.map((o) => `style.css:${o.n}  ${o.line}`)).toEqual([]);
  });

  it("the two that were broken now use a theme token", () => {
    for (const selector of [".readout", ".comparerow"]) {
      const rule = ruleFor(css, selector);
      expect(rule, `${selector} vanished`).toBeTruthy();
      expect(rule, `${selector} must take its fill from a token`).toMatch(/background:\s*var\(--/);
    }
  });
});

function ruleFor(source: string, selector: string): string | null {
  const i = source.indexOf(`\n${selector} {`);
  if (i < 0) return null;
  const end = source.indexOf("}", i);
  return source.slice(i, end);
}

function isInsideRule(source: string, lineNumber: number, selector: string): boolean {
  const lines = source.split(/\r?\n/);
  for (let i = lineNumber - 1; i >= 0; i--) {
    if (lines[i].includes("}")) return false;
    if (lines[i].trim().startsWith(selector)) return true;
  }
  return false;
}
