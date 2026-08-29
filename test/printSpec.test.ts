import { describe, expect, it } from "vitest";
import {
  artboardMm, describePrintSpec, metersFromTrim, naturalOrientation,
  PRINT_MATERIAL_LABEL, PRINT_STANDARDS, printStandard, specFromStandard,
} from "../src/core/printSpec";

describe("print standards", () => {
  it("has the ISO A series exactly right", () => {
    // ISO 216 is exact by definition; a wrong number here becomes a wrong
    // order, and nobody re-measures a poster before sending the file.
    const iso: Record<string, [number, number]> = {
      A6: [105, 148], A5: [148, 210], A4: [210, 297],
      A3: [297, 420], A2: [420, 594], A1: [594, 841],
    };
    for (const [id, [w, h]] of Object.entries(iso)) {
      const s = printStandard(id)!;
      expect([s.widthMm, s.heightMm], id).toEqual([w, h]);
      expect(s.authority, id).toBe("iso");
    }
  });

  it("marks market sizes as market, not as a standard", () => {
    // An X 展架 is 60 × 160 because that is what shops sell, not because a
    // standards body said so. Claiming otherwise overstates the source.
    for (const id of ["x-banner", "roll-up", "table-runner", "hanging-banner", "backdrop-24"]) {
      expect(printStandard(id)!.authority, id).toBe("market");
    }
  });

  it("gives every standard a material and a stated use", () => {
    for (const s of PRINT_STANDARDS) {
      expect(PRINT_MATERIAL_LABEL[s.defaultMaterial], s.id).toBeTruthy();
      expect(s.use.length, s.id).toBeGreaterThan(0);
      expect(s.widthMm, s.id).toBeGreaterThan(0);
      expect(s.heightMm, s.id).toBeGreaterThan(0);
    }
  });

  it("resolves case-insensitively", () => {
    expect(printStandard("a4")).toBeTruthy();
    expect(printStandard("X-BANNER")).toBeTruthy();
    expect(printStandard("nope")).toBeUndefined();
  });
});

describe("orientation is applied exactly once", () => {
  it("swaps a portrait standard when landscape is asked for", () => {
    const s = specFromStandard("A4", { orientation: "landscape" })!;
    expect([s.widthMm, s.heightMm]).toEqual([297, 210]);
  });

  it("leaves an already-landscape standard alone", () => {
    // 1800 × 600 is landscape as quoted. Swapping it again turned a table
    // runner into a 60 × 180 cm banner nobody ordered.
    const s = specFromStandard("table-runner")!;
    expect([s.widthMm, s.heightMm]).toEqual([1800, 600]);
    expect(s.orientation).toBe("landscape");
  });

  it("does not swap a second time in metersFromTrim", () => {
    const s = specFromStandard("table-runner")!;
    const m = metersFromTrim(s);
    expect(m.width).toBeCloseTo(1.8, 6);
    expect(m.height).toBeCloseTo(0.6, 6);
  });

  it("derives the natural orientation from the numbers", () => {
    expect(naturalOrientation(210, 297)).toBe("portrait");
    expect(naturalOrientation(1800, 600)).toBe("landscape");
  });
});

describe("the order line", () => {
  it("says everything a printer needs and nothing else", () => {
    const s = specFromStandard("A5", { quantity: 500, sides: 2 })!;
    const line = describePrintSpec(s);
    expect(line).toContain("A5");
    expect(line).toContain("148 × 210 mm");
    expect(line).toContain("銅版紙");
    expect(line).toContain("雙面");
    expect(line).toContain("500 份");
    expect(line).toContain("出血 3 mm");
  });

  it("omits bleed when there is none", () => {
    expect(describePrintSpec(specFromStandard("x-banner")!)).not.toContain("出血");
  });

  it("carries a finishing note through", () => {
    const s = specFromStandard("A3", { finishNote: "雙面上光" })!;
    expect(describePrintSpec(s)).toContain("雙面上光");
  });
});

describe("artboard", () => {
  it("adds bleed on every edge", () => {
    const s = specFromStandard("A4")!;
    expect(artboardMm(s)).toEqual({ widthMm: 216, heightMm: 303 });
  });

  it("equals the trim when bleed is zero", () => {
    const s = specFromStandard("roll-up")!;
    expect(artboardMm(s)).toEqual({ widthMm: 800, heightMm: 2000 });
  });

  it("uses the swapped numbers for a landscape order", () => {
    const s = specFromStandard("A4", { orientation: "landscape" })!;
    expect(artboardMm(s)).toEqual({ widthMm: 303, heightMm: 216 });
  });
});
