import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BOOTH_PROP_META, BOOTH_PROP_PRESETS, boothPropPreset, boothPropsByCategory } from "../src/core/boothPropPresets";
import { metersFromTrim } from "../src/core/printSpec";
import { propPreset } from "../src/core/propPresets";
import { describeRecipe, propFromRecipe } from "../src/core/propRecipe";
import { MATERIAL_PRESETS } from "../src/scene/materials";

describe("stall props and collateral", () => {
  it("covers the three things a stall is made of", () => {
    for (const c of ["文宣", "背景", "擺攤小物"]) {
      expect(boothPropsByCategory(c).length, c).toBeGreaterThan(0);
    }
  });

  it("gives every preset a provenance note, so a size is never unexplained", () => {
    for (const p of BOOTH_PROP_PRESETS) {
      const m = BOOTH_PROP_META[p.id];
      expect(m, `${p.id} 缺少 sizeNote/use`).toBeTruthy();
      expect(m.sizeNote.length, p.id).toBeGreaterThan(0);
      expect(m.use.length, p.id).toBeGreaterThan(0);
    }
  });

  it("uses only material finishes the renderer knows", () => {
    // An unknown finish falls back silently and the prop just looks wrong.
    for (const p of BOOTH_PROP_PRESETS) {
      for (const part of p.parts) {
        if (!part.finish) continue;
        expect(MATERIAL_PRESETS[part.finish as never], `${p.id}.${part.id}: ${part.finish}`).toBeTruthy();
      }
    }
  });

  it("keeps every part inside the prop's declared footprint", () => {
    for (const p of BOOTH_PROP_PRESETS) {
      for (const part of p.parts) {
        expect(part.size.width, `${p.id}.${part.id}`).toBeLessThanOrEqual(p.dimensions.width + 1e-6);
        expect(part.offset.y + part.size.height, `${p.id}.${part.id}`)
          .toBeLessThanOrEqual(p.dimensions.height + 1e-6);
      }
    }
  });

  it("resolves through the shared preset lookup", () => {
    // The Studio and the recipe layer must not need to know which file a
    // preset lives in.
    for (const p of BOOTH_PROP_PRESETS) {
      expect(propPreset(p.id), p.id).toBeTruthy();
    }
  });

  it("hands back a copy, never the shared object", () => {
    const a = boothPropPreset("prop_raffle_box")!;
    a.name = "改過了";
    expect(boothPropPreset("prop_raffle_box")!.name).toBe("抽獎箱");
  });
});

describe("printed props carry an order, not just a shape", () => {
  it("every 文宣 and 背景 preset has a print spec", () => {
    for (const p of BOOTH_PROP_PRESETS) {
      if (p.category === "文宣" || p.category === "背景") {
        expect(p.print, `${p.id} 是印刷品但沒有印刷規格`).toBeTruthy();
      }
    }
  });

  it("the 3D size matches the trim size it will be printed at", () => {
    // The whole point: a poster cannot be A2 on the order form and 60 cm on
    // the plan.
    for (const p of BOOTH_PROP_PRESETS) {
      if (!p.print) continue;
      const panel = metersFromTrim(p.print);
      const printable = p.parts[p.parts.length - 1];
      expect(printable.size.width, `${p.id} 寬度與印刷尺寸不符`).toBeCloseTo(panel.width, 5);
      expect(printable.size.height, `${p.id} 高度與印刷尺寸不符`).toBeCloseTo(panel.height, 5);
    }
  });

  it("a table item is not given a print spec it does not need", () => {
    for (const p of boothPropsByCategory("擺攤小物")) {
      expect(p.print, p.id).toBeUndefined();
    }
  });
});

describe("recipes for collateral", () => {
  const make = (r: Record<string, unknown>) => propFromRecipe(r as never, "p1");

  it("builds an A2 poster at A2, not at the preset's size", () => {
    const d = make({ name: "海報", kind: "海報", print: { standard: "A2" } });
    expect(d.print!.widthMm).toBe(420);
    expect(d.dimensions.width).toBeCloseTo(0.42, 3);
  });

  it("resizes down as well as up", () => {
    // A5 on an A2 preset used to keep the A2 footprint, because the width was
    // max()ed with the value it was replacing.
    const d = make({ name: "傳單", kind: "海報", print: { standard: "A5", quantity: 500, sides: 2 } });
    expect(d.dimensions.width).toBeCloseTo(0.148, 3);
    expect(d.print!.quantity).toBe(500);
    expect(d.print!.sides).toBe(2);
  });

  it("keeps a landscape standard landscape", () => {
    const d = make({ name: "布條", kind: "桌前布條" });
    expect(d.dimensions.width).toBeCloseTo(1.8, 3);
    expect(d.print!.orientation).toBe("landscape");
  });

  it("prints the words on the printable face, not the foot", () => {
    const d = make({ name: "展架", kind: "x展架", text: "淡江禪學社" });
    expect(d.parts[d.parts.length - 1].text).toBe("淡江禪學社");
    expect(d.parts[0].text).toBeUndefined();
  });

  it("accepts an explicit millimetre size with no standard", () => {
    const d = make({ name: "特殊尺寸", kind: "海報", print: { widthMm: 250, heightMm: 700 } });
    expect(d.print!.widthMm).toBe(250);
    expect(d.print!.standard).toBeUndefined();
    expect(d.dimensions.height).toBeCloseTo(0.7, 3);
  });

  it("ignores a print block with nothing usable in it rather than inventing a size", () => {
    const before = make({ name: "海報", kind: "海報" });
    const after = make({ name: "海報", kind: "海報", print: { quantity: 5 } });
    expect(after.dimensions).toEqual(before.dimensions);
  });

  it("rejects a material it does not recognise instead of passing it to a printer", () => {
    const d = make({ name: "海報", kind: "海報", print: { standard: "A3", material: "黃金" } });
    expect(d.print!.material).not.toBe("黃金");
  });

  it("clamps a silly size", () => {
    const d = make({ name: "海報", kind: "海報", print: { widthMm: 999999, heightMm: 1 } });
    expect(d.print!.widthMm).toBeLessThanOrEqual(5000);
    expect(d.print!.heightMm).toBeGreaterThanOrEqual(10);
  });

  it("describes a printed prop by its order, not by its box size", () => {
    const d = make({ name: "招生海報", kind: "海報", print: { standard: "A2", quantity: 30 } });
    const line = describeRecipe(d);
    expect(line).toContain("A2");
    expect(line).toContain("30 份");
  });

  it("describes a table item by what it is for, not as 裝飾用", () => {
    // A QR stand does a job; it just is not simulated.
    expect(describeRecipe(make({ name: "QR", kind: "qr立架" }))).toContain("掃碼");
    expect(describeRecipe(make({ name: "抽獎箱", kind: "抽獎箱" }))).toContain("抽獎");
  });

  it("still makes a plain box for an unknown kind", () => {
    const d = make({ name: "不明物", kind: "外星裝置" });
    expect(d.parts.length).toBe(1);
    expect(d.print).toBeUndefined();
  });
});

describe("no control characters in source", () => {
  it("never ships a literal backspace or similar in a regex", () => {
    // A generated `\b` became a real 0x08 byte, so a regex silently required
    // two backspace characters before it would match — it never matched, and
    // nothing failed. Bytes below 0x20 have no business in this source tree.
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx|css)$/.test(name)) continue;
        const text = readFileSync(full, "utf8");
        text.split("\n").forEach((raw, i) => {
          // A CRLF checkout leaves a trailing carriage return on every line;
          // that is the working tree's line ending, not a stray byte in a regex.
          const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
          if ([...line].some((c) => c.charCodeAt(0) < 32 && c !== "\t")) {
            offenders.push(`${full}:${i + 1}`);
          }
        });
      }
    };
    walk("src");
    expect(offenders).toEqual([]);
  });
});
