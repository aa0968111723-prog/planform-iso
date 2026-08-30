import { describe, expect, it } from "vitest";
import type { AreaConfig, SceneObject } from "../src/core/model";
import {
  clampPointToAreas,
  doorSweep,
  facingVec,
  findParentTable,
  nearestWallSnap,
  pointInDoorSweep,
  pointInRect,
  rectsOverlap,
  wallAnchorToPosition,
} from "../src/core/placement";

const classroom: AreaConfig = { id: "classroom", name: "教室", length: 10, width: 8, x: 0, z: 0 };
const corridor: AreaConfig = { id: "corridor", name: "走廊", length: 10, width: 2, x: 0, z: 8 };

describe("a tap that misses the room still lands in the venue", () => {
  it("keeps a point that is already inside", () => {
    const p = clampPointToAreas(5, 4, [classroom, corridor]);
    expect(p).toEqual({ x: 5, z: 4, clamped: false });
  });

  it("snaps a void tap onto the nearest room edge, not a silent no-op", () => {
    const p = clampPointToAreas(5, -2, [classroom, corridor]);
    expect(p.clamped).toBe(true);
    expect(p.x).toBeCloseTo(5);
    expect(p.z).toBeCloseTo(0);
  });

  it("prefers the closer of classroom and corridor", () => {
    const p = clampPointToAreas(5, 12, [classroom, corridor]);
    expect(p.clamped).toBe(true);
    expect(p.z).toBeCloseTo(10);
  });
});

describe("facing vector", () => {
  it("maps yaw to a direction (sin, cos)", () => {
    expect(facingVec(0).z).toBeCloseTo(1);
    expect(facingVec(90).x).toBeCloseTo(1);
    expect(facingVec(180).z).toBeCloseTo(-1);
  });
});

describe("wall snapping", () => {
  it("snaps a point near the top wall to that wall, facing inward", () => {
    const snap = nearestWallSnap(3, 0.2, [classroom], 0.9);
    expect(snap).not.toBeNull();
    expect(snap!.edge).toBe("n");
    expect(snap!.z).toBeCloseTo(0);
    expect(snap!.rotationDeg).toBe(0);
  });

  it("snaps near the left wall and keeps the object within the wall", () => {
    const snap = nearestWallSnap(0.1, 4, [classroom], 0.9);
    expect(snap!.edge).toBe("w");
    expect(snap!.x).toBeCloseTo(0);
    expect(snap!.rotationDeg).toBe(90);
  });

  it("round-trips a wall anchor back to a position", () => {
    const snap = nearestWallSnap(3, 0.2, [classroom], 0.9)!;
    const pos = wallAnchorToPosition({ areaId: "classroom", edge: snap.edge, offset: snap.offset }, [classroom])!;
    expect(pos.x).toBeCloseTo(snap.x);
    expect(pos.z).toBeCloseTo(snap.z);
    expect(pos.rotationDeg).toBe(snap.rotationDeg);
  });
});

describe("rect footprint", () => {
  it("point-in-rect respects rotation", () => {
    expect(pointInRect(0.2, 0.2, 0, 0, 1, 0.5, 0)).toBe(true);
    expect(pointInRect(0.7, 0.2, 0, 0, 1, 0.5, 0)).toBe(false); // outside half-width 0.5
    // Rotated 90°: width (1) now lies along Z, depth (0.5) along X.
    expect(pointInRect(0.2, 0.45, 0, 0, 1, 0.5, 90)).toBe(true);
    expect(pointInRect(0.45, 0.2, 0, 0, 1, 0.5, 90)).toBe(false);
  });

  it("detects overlapping rectangles", () => {
    expect(rectsOverlap({ cx: 0, cz: 0, w: 1, d: 1, rot: 0 }, { cx: 0.5, cz: 0, w: 1, d: 1, rot: 0 })).toBe(true);
    expect(rectsOverlap({ cx: 0, cz: 0, w: 1, d: 1, rot: 0 }, { cx: 2, cz: 0, w: 1, d: 1, rot: 0 })).toBe(false);
  });
});

describe("door sweep", () => {
  const door: SceneObject = {
    id: "d", kind: "door", x: 3, z: 0, rotationDeg: 0, width: 0.9, depth: 0.12, height: 2,
    locked: false, hidden: false, surface: "wall", elevation: 0, hinge: "left", openInward: true, openDeg: 90,
  };

  it("computes a hinge at one jamb and a radius of the leaf width", () => {
    const s = doorSweep(door);
    expect(s.radius).toBeCloseTo(0.9);
    // Hinge is offset half the width along the wall from the center.
    expect(Math.abs(s.hingeX - door.x)).toBeCloseTo(0.45);
    expect(s.hingeZ).toBeCloseTo(0);
  });

  it("flags a point inside the swing and clears one outside", () => {
    const s = doorSweep(door);
    // Just inside the room in front of the leaf.
    expect(pointInDoorSweep(s.hingeX, 0.3, s)).toBe(true);
    // Far away.
    expect(pointInDoorSweep(9, 7, s)).toBe(false);
  });
});

describe("tabletop parenting", () => {
  it("finds a table under a point", () => {
    const table: SceneObject = {
      id: "t1", kind: "table", x: 2, z: 2, rotationDeg: 0, width: 1.2, depth: 0.6, height: 0.74,
      locked: false, hidden: false, surface: "floor", elevation: 0,
    };
    const allowed = new Set(["table", "regTable"]);
    expect(findParentTable(2, 2, [table], allowed)?.id).toBe("t1");
    expect(findParentTable(8, 8, [table], allowed)).toBeNull();
  });
});
