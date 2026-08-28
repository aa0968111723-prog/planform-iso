/**
 * The UX contract, pinned as text.
 *
 * These assert on STRINGS, which is unusual and deliberate. Every defect here
 * was found by two reviewers — one Claude-run walkthrough and one Grok blind
 * test — who were given the task 「按開始彩排」 and independently stalled at
 * the same place: the app promises 彩排 in its own hint text and then offers
 * 模擬 / 演練一次 / 再跑一次 / 播放走位 and never that word. Wording that a
 * person navigates by is behaviour, so it gets a test.
 *
 * The rest are silent data losses and one spec section number that reached the
 * screen.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PROP_PRESETS, propPreset } from "../src/core/propPresets";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const FLOW_PANEL = read("src/ui/flowPanel.ts");
const PROP_STUDIO = read("src/ui/propStudio.ts");
const UI = read("src/ui/UI.ts");
const INSPECTOR = read("src/ui/inspector.ts");
const ALL_UI = [FLOW_PANEL, PROP_STUDIO, UI, INSPECTOR].join("\n");

describe("the app offers the word it promises", () => {
  it("彩排 is on a button, not only in a hint", () => {
    expect(FLOW_PANEL).toContain("▶ 開始彩排");
    expect(FLOW_PANEL).toContain("▶ 再彩排一次");
  });

  it("the four old names for one action are gone from the buttons", () => {
    // 模擬 survives as a NAV label and inside prose; what must not come back is
    // a button offering a different word for the thing the hint calls 彩排.
    expect(FLOW_PANEL).not.toContain('"▶ 演練一次"');
    expect(FLOW_PANEL).not.toContain('"▶ 再跑一次"');
    expect(FLOW_PANEL).not.toContain('"▶ 模擬"');
    expect(FLOW_PANEL).not.toContain('"▶ 播放走位"');
  });

  it("the hint that promises 彩排 still does", () => {
    expect(UI).toContain("放進場地就能彩排");
  });
});

describe("nothing on screen is written for the engineer", () => {
  it("no spec section number reaches a label", () => {
    // 「站位（§14）」 was printed as a subhead in the builder.
    const onScreen = [...ALL_UI.matchAll(/text:\s*"([^"]*)"/g)].map((m) => m[1]);
    const leaked = onScreen.filter((t) => /§\s*\d/.test(t));
    expect(leaked, "spec references belong in comments").toEqual([]);
  });

  it("no 3D jargon reaches a label (§1)", () => {
    const onScreen = [...ALL_UI.matchAll(/text:\s*"([^"]*)"/g)].map((m) => m[1]);
    const jargon = /vertex|頂點|mesh|網格|\bUV\b|shader|著色器|node editor|節點編輯|rig\b|骨架|facesFromOptions|quaternion|四元數/i;
    expect(onScreen.filter((t) => jargon.test(t))).toEqual([]);
  });

  it("labels are not truncated words", () => {
    // 「多花秒」 read like a word had been cut off.
    expect(ALL_UI).not.toContain('"多花秒"');
    expect(ALL_UI).toContain("多花幾秒");
  });
});

describe("the face table is the same table in both panels", () => {
  it("both offer the same face counts", () => {
    const counts = (src: string) => {
      const m = src.match(/\[2, 4, 6, 8[^\]]*\]/);
      return m ? m[0] : "";
    };
    expect(counts(PROP_STUDIO)).toBe("[2, 4, 6, 8, 10, 12]");
    expect(counts(FLOW_PANEL), "a 12-face prop must not look broken here")
      .toBe("[2, 4, 6, 8, 10, 12]");
  });

  it("the question survives placement — the panel can still edit it", () => {
    // After placement the flow panel IS the live record. Without a 題目 field
    // there, a question typed in the builder could never be corrected.
    expect(FLOW_PANEL).toContain('textField("題目"');
    expect(PROP_STUDIO).toContain('"題目"');
  });
});

describe("nothing is thrown away without asking", () => {
  it("swapping preset chips asks first", () => {
    expect(PROP_STUDIO).toContain("hasTypedContent()");
    expect(PROP_STUDIO).toMatch(/會清掉你目前打的內容/);
  });

  it("shrinking the face count asks when questions would go", () => {
    expect(PROP_STUDIO).toMatch(/已經寫了題目/);
  });

  it("a distance typed before a direction is chosen still places the person", () => {
    // The field used to accept the number and return silently.
    expect(PROP_STUDIO).toContain("if (!a) { place(0, Math.max(0.2, v / 100)); return; }");
  });
});

describe("a hand-built prop can do what a preset can", () => {
  it("the builder exposes the faces toggle in plain words", () => {
    // Without a control, only preset parts ever carried it — so the DIY dice
    // the panel invites you to build came out permanently blank.
    expect(PROP_STUDIO).toContain("要顯示各個面");
    expect(PROP_STUDIO).toContain("part.facesFromOptions");
  });
});

describe("an assembly says what is inside it", () => {
  it("the four golden props name their parts", () => {
    for (const id of ["prop_dicestation", "prop_quizstation", "prop_spinnerstation", "prop_blessingbox"]) {
      const def = propPreset(id)!;
      expect(def.name, id).toMatch(/（.+＋.+）/);
    }
  });

  it("the chip list a person picks from carries those names", () => {
    const names = PROP_PRESETS.map((p) => p.name);
    expect(names.some((n) => n.startsWith("骰子遊戲站"))).toBe(true);
    // …and the bare dice is still separately available.
    expect(names).toContain("大型骰子");
  });
});
