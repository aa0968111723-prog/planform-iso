/**
 * §18 / §83 — the plan has to be readable in the default light theme.
 *
 * `TextLabel` always paints its own dark pill behind the text, so a label's
 * contrast is against that pill, never against the floor underneath it. An
 * E310-only override treated it as floor text and set the room and corridor
 * names to a dark slate, landing at 1.04:1 — invisible, on the venue the
 * release uses as its visual baseline.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { LABEL_PILL_RGBA, scenePalette } from "../src/core/theme";

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** The pill composited over whatever floor colour sits behind it. */
function pillOver(floor: [number, number, number]): [number, number, number] {
  const { r, g, b, a } = LABEL_PILL_RGBA;
  return [
    r * a + floor[0] * (1 - a),
    g * a + floor[1] * (1 - a),
    b * a + floor[2] * (1 - a),
  ];
}

function contrast(fg: [number, number, number], bg: [number, number, number]): number {
  const l1 = luminance(fg), l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** The floors a label can land on: E310's warm grey, plain white, dark theme. */
const FLOORS: [string, [number, number, number]][] = [
  ["E310 教室地板 #ddd9d0", hexRgb("#ddd9d0")],
  ["E310 走廊地板 #c99698", hexRgb("#c99698")],
  ["一般教室地板 #ffffff", [255, 255, 255]],
  ["深色主題地板 #334155", hexRgb("#334155")],
];

describe("area name labels stay readable on their own pill", () => {
  for (const theme of ["light", "dark"] as const) {
    const palette = scenePalette(theme);
    for (const [role, colour] of [
      ["教室", palette.areaLabelClassroom],
      ["走廊", palette.areaLabelCorridor],
    ] as const) {
      for (const [floorName, floor] of FLOORS) {
        it(`${theme} · ${role} on ${floorName}`, () => {
          const ratio = contrast(hexRgb(colour), pillOver(floor));
          // WCAG AA for large/bold text is 3:1; these are bold sprite labels.
          expect(ratio, `${role} label is ${ratio.toFixed(2)}:1 — unreadable`).toBeGreaterThan(3);
        });
      }
    }
  }

  it("no venue re-darkens the label text against its own dark pill", () => {
    const src = readFileSync(new URL("../src/scene/SceneManager.ts", import.meta.url), "utf8");
    const call = src.match(/label\.set\(area\.name,[^;]*;/)?.[0] ?? "";
    expect(call, "an area label colour was hard-coded again").not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});
