import { describe, expect, it } from "vitest";
import {
  matArrayFootprint,
  matArrayOffsets,
  matPreviewCenters,
  zoneMatCapacity,
  type MatArraySpec,
} from "../src/core/mat";

const spec: MatArraySpec = {
  matWidth: 0.6,
  matDepth: 1.8,
  rows: 3,
  cols: 4,
  gapX: 0.1,
  gapZ: 0.1,
};

describe("mat array footprint", () => {
  it("counts mats and sums occupied size incl. gaps", () => {
    const fp = matArrayFootprint(spec);
    expect(fp.count).toBe(12);
    // 4 cols * 0.6 + 3 gaps * 0.1 = 2.4 + 0.3 = 2.7
    expect(fp.totalWidth).toBeCloseTo(2.7);
    // 3 rows * 1.8 + 2 gaps * 0.1 = 5.4 + 0.2 = 5.6
    expect(fp.totalDepth).toBeCloseTo(5.6);
  });

  it("produces one center offset per mat", () => {
    const offs = matArrayOffsets(spec);
    expect(offs).toHaveLength(12);
    // First mat center sits half a mat in from the origin.
    expect(offs[0]).toEqual({ x: 0.3, z: 0.9 });
  });
});

describe("mat preview placement", () => {
  it("translates offsets by the anchor with no rotation", () => {
    const centers = matPreviewCenters({ spec, rotationDeg: 0, anchorX: 1, anchorZ: 2, zoneId: null });
    expect(centers[0].x).toBeCloseTo(1.3);
    expect(centers[0].z).toBeCloseTo(2.9);
  });

  it("rotates the array about the anchor", () => {
    const centers = matPreviewCenters({
      spec: { ...spec, rows: 1, cols: 1 },
      rotationDeg: 90,
      anchorX: 0,
      anchorZ: 0,
      zoneId: null,
    });
    // offset (0.3, 0.9) rotated 90deg -> (-0.9, 0.3)
    expect(centers[0].x).toBeCloseTo(-0.9);
    expect(centers[0].z).toBeCloseTo(0.3);
  });
});

describe("zone mat capacity", () => {
  it("computes fit, capacity and clearance when it fits", () => {
    const cap = zoneMatCapacity(3, 6, spec);
    expect(cap.fits).toBe(true);
    // width: floor((3+0.1)/(0.6+0.1)) = floor(4.43) = 4
    expect(cap.maxCols).toBe(4);
    // depth: floor((6+0.1)/(1.8+0.1)) = floor(3.21) = 3
    expect(cap.maxRows).toBe(3);
    expect(cap.capacity).toBe(12);
    expect(cap.clearanceX).toBeCloseTo(0.3);
    expect(cap.clearanceZ).toBeCloseTo(0.4);
  });

  it("reports overflow when the requested layout exceeds the zone", () => {
    const cap = zoneMatCapacity(2, 3, spec);
    expect(cap.fits).toBe(false);
    expect(cap.overflowX).toBeCloseTo(0.7); // 2.7 - 2
    expect(cap.overflowZ).toBeCloseTo(2.6); // 5.6 - 3
  });
});
