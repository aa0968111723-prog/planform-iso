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
 *
 * A second rule was added after `.menuitem--active` was measured at 3.53:1:
 * a control tinted with the accent colour may not also take `var(--accent)` as
 * its text. `--accent` is a 3-series blue meant for borders and glyphs;
 * `--accent-text` exists precisely because text on an accent tint needs to be
 * darker, and it measures 5.12:1 on the same fill.
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

describe("accent-tinted controls use the darker accent for their text", () => {
  /**
   * The trap: `--accent` (#0284c7) reads fine on white but only 3.5:1 on the
   * accent tint those same rules paint behind it — under the 4.5:1 AA floor
   * for the 13 px / 600 labels these controls use. `--accent-text` (#0369a1)
   * is the same hue two steps darker and measures ~5:1 on that fill.
   *
   * Parsed as RULES, not lines: several of these declarations wrap, and a
   * line-based check both misses those and false-positives on the line after.
   */
  const rules = [...lightOnly(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m) => ({ selector: m[1].trim(), body: m[2] }))
    .filter((r) => /background(-color)?\s*:\s*rgba\(\s*56\s*,\s*189\s*,\s*248/.test(r.body));

  it("finds the accent-tinted rules at all, so this test cannot pass vacuously", () => {
    expect(rules.length).toBeGreaterThan(2);
  });

  it("none of them sets color: var(--accent)", () => {
    const offenders = rules
      // `border-color: var(--accent)` is legitimate and contains "color:" —
      // only a declaration that STARTS with color counts.
      .filter((r) => /(^|[;{\s])color\s*:\s*var\(--accent\)\s*[;}]/.test(r.body))
      .map((r) => r.selector);
    expect(offenders, offenders.join(" / ")).toEqual([]);
  });
});
