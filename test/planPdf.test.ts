import { describe, expect, it } from "vitest";
import { buildPlanPdf } from "../src/export/exporters";

describe("plan PDF export", () => {
  it("creates a one-page PDF that embeds the rendered plan image", () => {
    // The byte content only needs to exercise PDF assembly; browser canvas is
    // responsible for generating a valid JPEG before this function is called.
    const jpeg = "data:image/jpeg;base64,/9j/2Q==";
    const bytes = buildPlanPdf(jpeg, 1400, 990);
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/Type /Page");
    expect(text).toContain("/Subtype /Image");
    expect(text).toContain("/Filter /DCTDecode");
    expect(text).toContain("%%EOF");
  });
});
