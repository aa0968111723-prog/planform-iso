import { describe, expect, it } from "vitest";
import {
  MockVenueProvider,
  applyVenueCalibration,
  createVenueSession,
  detectionsToObjects,
} from "../src/assets/venueCapture";
import { createDefaultProject } from "../src/core/model";

describe("venue capture", () => {
  it("mock provider returns reviewable detections", async () => {
    const p = new MockVenueProvider();
    const dets = await p.detect("room.jpg", null);
    expect(dets.length).toBeGreaterThanOrEqual(4);
    expect(dets.some((d) => d.kind === "door")).toBe(true);
    expect(dets.some((d) => d.needsReview || d.confidence < 0.6)).toBe(true);
  });

  it("refuses commit without calibration", async () => {
    const dets = await new MockVenueProvider().detect("a.png", null);
    const session = createVenueSession("a.png", null, dets.map((d) => ({ ...d, confirmed: true })));
    const { objects, skipped } = detectionsToObjects(session, createDefaultProject());
    expect(objects).toHaveLength(0);
    expect(skipped[0]).toMatch(/校正/);
  });

  it("commits confirmed objects after calibration and supports skip of tile-hint", async () => {
    const dets = await new MockVenueProvider().detect("hall.png", null);
    let session = createVenueSession(
      "hall.png",
      null,
      dets.map((d) => ({ ...d, confirmed: d.kind !== "chair" })),
    );
    session = applyVenueCalibration(session, 3.0);
    expect(session.scale).toBeGreaterThan(0);
    const project = createDefaultProject();
    const { objects, skipped } = detectionsToObjects(session, project);
    expect(objects.length).toBeGreaterThanOrEqual(3);
    expect(objects.every((o) => o.note?.includes("掃描") || o.note?.includes("待確認"))).toBe(true);
    expect(skipped.some((s) => s.includes("參考"))).toBe(true);
    // Chair was not confirmed
    expect(objects.every((o) => o.kind !== "chair")).toBe(true);
  });
});
