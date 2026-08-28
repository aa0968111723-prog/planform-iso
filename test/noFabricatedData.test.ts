/**
 * §71 — a production path must never present fabricated data as observed.
 *
 * 掃描場地 shipped wired to `MockVenueProvider`, which discards the photograph
 * and derives its "detections" from `imageName.length % 7`. Four of them were
 * `confirmed: true`, so confirming wrote a door, a screen, a table and a
 * 報到桌 at invented coordinates into the plan the setup team would follow.
 *
 * These tests exist so the mock cannot be wired back in by accident. They fail
 * loudly rather than letting a demo ship as a measurement.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MockVenueProvider } from "../src/assets/venueCapture";
import { venueCaptureAvailable } from "../src/ui/venueCapture";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

/**
 * Prose may name a mock — several module headers explain at length why one is
 * switched off. Code may not. So every check here runs against the source with
 * its comments removed.
 */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

describe("掃描場地 stays off until a real vision provider exists", () => {
  it("is not offered to the user", () => {
    expect(venueCaptureAvailable()).toBe(false);
  });

  it("the UI module neither imports nor instantiates the mock provider", () => {
    // Prose may name it — the module header explains at length why it is off.
    // Code may not.
    const src = read("../src/ui/venueCapture.ts")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(src, "a mock must never be the provider a user's photo is sent to")
      .not.toMatch(/MockVenueProvider/);
  });

  it("the editor only mounts the flow behind that switch", () => {
    const ui = read("../src/ui/UI.ts");
    const mounts = ui.match(/buildVenueCaptureFlow\(/g) ?? [];
    // One import reference plus one guarded call site; never an unguarded push.
    expect(ui).toMatch(/if \(venueCaptureAvailable\(\)\) body\.push\(buildVenueCaptureFlow/);
    expect(mounts.length).toBeLessThanOrEqual(1);
  });
});

describe("the mock is honest about being a mock", () => {
  it("really does ignore the photo — this is why it must not ship", async () => {
    const mock = new MockVenueProvider();
    const photoA = await mock.detect("E310_a.jpg", "data:image/jpeg;base64,AAAA");
    const photoB = await mock.detect("E310_b.jpg", "data:image/jpeg;base64,ZZZZ");
    // Same filename length, completely different image bytes → identical output.
    expect(JSON.stringify(photoB)).toBe(JSON.stringify(photoA));

    const renamed = await mock.detect("E310_a_second_visit.jpg", "data:image/jpeg;base64,AAAA");
    // Same image bytes, different name → different output.
    expect(JSON.stringify(renamed)).not.toBe(JSON.stringify(photoA));
  });

  it("would have written pre-confirmed objects straight into the plan", async () => {
    const detections = await new MockVenueProvider().detect("room.jpg", null);
    // Kept as a record of exactly what the user would have been shown, so the
    // cost of re-mounting it is legible to whoever reads this test.
    expect(detections.filter((d) => d.confirmed).length).toBeGreaterThan(0);
  });
});

describe("拍照建立 does not announce work it never did", () => {
  /**
   * The photo flow used to say 「精緻模型稍後產生」, run a 10 ms mock worker over
   * a procedurally-built box, and then say 「精緻模型已替換完成」. The photo bytes
   * were stored and never opened, and for every semantic type except a desk
   * the "replacement" was byte-identical to what was already on the canvas.
   *
   * The cost is not the missing feature — it is that the one signal telling a
   * volunteer an import worked was firing for work that never happened.
   */
  const src = stripComments(read("../src/ui/customAssetFlow.ts"));

  it("does not run the mock reconstruction worker", () => {
    expect(src, "a mock must never stand in for a reconstruction the user asked for")
      .not.toMatch(/MockReconstructionWorker|ReconstructionQueue/);
  });

  it("does not claim a refined model was produced", () => {
    expect(src).not.toMatch(/精緻模型已替換完成/);
    expect(src).not.toMatch(/精緻模型稍後產生/);
  });

  it("says what actually happened instead", () => {
    expect(src).toMatch(/依你輸入的尺寸建立素材/);
  });
});
