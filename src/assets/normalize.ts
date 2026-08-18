/**
 * Normalize imported / generated Groups: unit scale, floor origin, forward +Z.
 */

import { Box3, Group, Vector3 } from "three";

export type ForwardAxis = "+Z" | "-Z" | "+X" | "-X";

export interface NormalizeOptions {
  targetDims: { width: number; depth: number; height: number };
  forwardAxis?: ForwardAxis;
  /** If true, scale uniformly to fit the largest of width/depth/height. Default false = non-uniform fit. */
  uniformScale?: boolean;
}

export interface NormalizeResult {
  group: Group;
  bounds: { width: number; depth: number; height: number };
  scaleApplied: Vector3;
}

export function measureBounds(group: Group): { width: number; depth: number; height: number; box: Box3 } {
  group.updateMatrixWorld(true);
  const box = new Box3().setFromObject(group);
  const size = new Vector3();
  box.getSize(size);
  return { width: size.x, depth: size.z, height: size.y, box };
}

export function applyForwardAxis(group: Group, axis: ForwardAxis = "+Z"): void {
  switch (axis) {
    case "+Z":
      break;
    case "-Z":
      group.rotation.y = Math.PI;
      break;
    case "+X":
      group.rotation.y = -Math.PI / 2;
      break;
    case "-X":
      group.rotation.y = Math.PI / 2;
      break;
  }
  group.updateMatrixWorld(true);
}

/**
 * Scale group to target dims, place origin at floor center (y=0), face +Z.
 */
export function normalizeGroup(source: Group, opts: NormalizeOptions): NormalizeResult {
  const group = source.clone(true);
  applyForwardAxis(group, opts.forwardAxis ?? "+Z");

  let { width, depth, height } = measureBounds(group);
  // Avoid divide-by-zero for empty/degenerate meshes.
  width = Math.max(width, 1e-4);
  depth = Math.max(depth, 1e-4);
  height = Math.max(height, 1e-4);

  const sx = opts.targetDims.width / width;
  const sy = opts.targetDims.height / height;
  const sz = opts.targetDims.depth / depth;
  let scale: Vector3;
  if (opts.uniformScale) {
    const s = Math.min(sx, sy, sz);
    scale = new Vector3(s, s, s);
  } else {
    scale = new Vector3(sx, sy, sz);
  }
  group.scale.multiply(scale);
  group.updateMatrixWorld(true);

  // Re-center: XZ to center, Y so bottom sits on floor.
  const after = measureBounds(group);
  const center = new Vector3();
  after.box.getCenter(center);
  group.position.x -= center.x;
  group.position.z -= center.z;
  group.position.y -= after.box.min.y;
  group.updateMatrixWorld(true);

  const final = measureBounds(group);
  return {
    group,
    bounds: { width: final.width, depth: final.depth, height: final.height },
    scaleApplied: scale,
  };
}

export function footprintFromBounds(bounds: { width: number; depth: number; height: number }): {
  width: number;
  depth: number;
} {
  return { width: bounds.width, depth: bounds.depth };
}
