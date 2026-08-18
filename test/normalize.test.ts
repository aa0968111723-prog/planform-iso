import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from "three";
import { measureBounds, normalizeGroup } from "../src/assets/normalize";

function boxGroup(w: number, h: number, d: number, y = h / 2): Group {
  const g = new Group();
  const m = new Mesh(new BoxGeometry(w, h, d), new MeshStandardMaterial());
  m.position.y = y;
  g.add(m);
  return g;
}

describe("normalizeGroup", () => {
  it("scales to target dims and puts origin on the floor center", () => {
    const src = boxGroup(2, 2, 2);
    const { group, bounds, scaleApplied } = normalizeGroup(src, {
      targetDims: { width: 1.2, depth: 0.6, height: 0.74 },
    });
    expect(scaleApplied.x).toBeCloseTo(0.6, 3);
    expect(scaleApplied.z).toBeCloseTo(0.3, 3);
    expect(bounds.width).toBeCloseTo(1.2, 2);
    expect(bounds.depth).toBeCloseTo(0.6, 2);
    expect(bounds.height).toBeCloseTo(0.74, 2);

    const after = measureBounds(group);
    expect(after.box.min.y).toBeCloseTo(0, 3);
    const cx = (after.box.min.x + after.box.max.x) / 2;
    const cz = (after.box.min.z + after.box.max.z) / 2;
    expect(cx).toBeCloseTo(0, 3);
    expect(cz).toBeCloseTo(0, 3);
  });

  it("supports uniform scale", () => {
    const src = boxGroup(2, 1, 1);
    const { bounds } = normalizeGroup(src, {
      targetDims: { width: 1, depth: 1, height: 1 },
      uniformScale: true,
    });
    // Uniform uses min scale = 0.5 → 1 x 0.5 x 0.5
    expect(bounds.width).toBeCloseTo(1, 2);
    expect(bounds.height).toBeCloseTo(0.5, 2);
    expect(bounds.depth).toBeCloseTo(0.5, 2);
  });

  it("rotates -Z forward to +Z", () => {
    const src = boxGroup(1, 1, 2);
    const { group } = normalizeGroup(src, {
      targetDims: { width: 1, depth: 2, height: 1 },
      forwardAxis: "-Z",
    });
    expect(Math.abs(group.rotation.y)).toBeCloseTo(Math.PI, 5);
  });
});
