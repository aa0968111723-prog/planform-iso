import { describe, expect, it } from "vitest";
import {
  LIMITATION_KIND_LABEL,
  PRODUCT_LIMITATIONS,
  normalizeEventDate,
} from "../src/core/productLimitations";

describe("PRODUCT_LIMITATIONS", () => {
  it("lists every documented 1.1 / field-only / runtime gap once", () => {
    const ids = PRODUCT_LIMITATIONS.map((item) => item.id);
    expect(ids).toEqual([
      "thumbnail",
      "named-layouts",
      "r06-family-seating",
      "r07-av-position",
      "r08-name-badge",
      "venue-scan-mock",
      "ai-offline-rules",
      "v2-checkin-wizard",
      "last-write-wins",
      "production-unverified",
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of PRODUCT_LIMITATIONS) {
      expect(item.title.length).toBeGreaterThan(4);
      expect(item.summary.length).toBeGreaterThan(8);
      expect(LIMITATION_KIND_LABEL[item.kind]).toBeTruthy();
    }
  });
});

describe("normalizeEventDate", () => {
  it("accepts YYYY-MM-DD and treats blank as clear", () => {
    expect(normalizeEventDate("2026-09-24")).toBe("2026-09-24");
    expect(normalizeEventDate("  ")).toBeUndefined();
    expect(normalizeEventDate(undefined)).toBeUndefined();
  });

  it("rejects non-dates and impossible calendar days", () => {
    expect(normalizeEventDate("9/24")).toBeNull();
    expect(normalizeEventDate("2026-13-01")).toBeNull();
    expect(normalizeEventDate("2026-02-31")).toBeNull();
  });
});
