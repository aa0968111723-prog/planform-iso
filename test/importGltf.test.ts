import { describe, expect, it } from "vitest";
import { evaluateQuality, emptyMetrics, MOBILE_LIMITS } from "../src/assets/qualityGate";
import { validateGltfFile } from "../src/assets/importGltf";

describe("quality gate", () => {
  it("passes modest metrics on mobile", () => {
    const report = evaluateQuality({
      ...emptyMetrics(500_000),
      triangleCount: 12_000,
      materialCount: 4,
      textureCount: 2,
      maxTextureDim: 512,
      nodeCount: 20,
      drawCallEstimate: 4,
    });
    expect(report.passMobile).toBe(true);
    expect(report.warnings).toHaveLength(0);
  });

  it("warns when over mobile limits", () => {
    const report = evaluateQuality({
      ...emptyMetrics(MOBILE_LIMITS.maxBytes + 1),
      triangleCount: MOBILE_LIMITS.maxTriangles + 10,
      materialCount: 2,
      textureCount: 1,
      maxTextureDim: 4096,
      nodeCount: 10,
      drawCallEstimate: 2,
    });
    expect(report.passMobile).toBe(false);
    expect(report.warnings.length).toBeGreaterThan(0);
  });
});

describe("import validation", () => {
  it("rejects bad extensions and empty/oversize files", () => {
    expect(validateGltfFile("a.obj", 100)).toMatch(/不支援/);
    expect(validateGltfFile("a.glb", 0)).toMatch(/空/);
    expect(validateGltfFile("a.glb", 40 * 1024 * 1024)).toMatch(/過大/);
    expect(validateGltfFile("chair.glb", 1024)).toBeNull();
  });
});
