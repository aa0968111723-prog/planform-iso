import { describe, expect, it } from "vitest";
import {
  applySnap,
  cmToMeters,
  formatTileRef,
  metersToCm,
  snapToHalfTile,
  snapToTileCenter,
  snapToTileIntersection,
  tileCenterToWorld,
  tilesSpanned,
  worldToTile,
  type TileConfig,
} from "../src/core/units";

const TILE: TileConfig = { width: 0.6, depth: 0.6, originX: 0, originZ: 0 };

describe("unit conversion", () => {
  it("converts cm to meters and back", () => {
    expect(cmToMeters(60)).toBeCloseTo(0.6);
    expect(metersToCm(0.6)).toBeCloseTo(60);
  });
});

describe("tile coordinate conversion", () => {
  it("maps world positions to the containing tile", () => {
    expect(worldToTile(0.1, 0.1, TILE)).toEqual({ col: 0, row: 0 });
    expect(worldToTile(0.7, 1.3, TILE)).toEqual({ col: 1, row: 2 });
  });

  it("respects a shifted grid origin", () => {
    const shifted: TileConfig = { ...TILE, originX: 1, originZ: 1 };
    expect(worldToTile(1.1, 1.1, shifted)).toEqual({ col: 0, row: 0 });
    expect(worldToTile(0.5, 0.5, shifted)).toEqual({ col: -1, row: -1 });
  });

  it("returns tile centers as world coordinates", () => {
    const a = tileCenterToWorld({ col: 0, row: 0 }, TILE);
    expect(a.x).toBeCloseTo(0.3);
    expect(a.z).toBeCloseTo(0.3);
    const b = tileCenterToWorld({ col: 2, row: 1 }, TILE);
    expect(b.x).toBeCloseTo(1.5);
    expect(b.z).toBeCloseTo(0.9);
  });
});

describe("snapping modes", () => {
  it("snaps to the nearest tile intersection", () => {
    // 0.4m is closer to the intersection at 0.6m than the one at 0m.
    const near = snapToTileIntersection(0.4, 0.4, TILE);
    expect(near.x).toBeCloseTo(0.6);
    expect(near.z).toBeCloseTo(0.6);
    // 0.05m rounds down to the origin intersection.
    const origin = snapToTileIntersection(0.05, 0.05, TILE);
    expect(origin.x).toBeCloseTo(0);
    expect(origin.z).toBeCloseTo(0);
  });

  it("snaps to the nearest tile center", () => {
    const a = snapToTileCenter(0.1, 0.1, TILE);
    expect(a.x).toBeCloseTo(0.3);
    expect(a.z).toBeCloseTo(0.3);
    const b = snapToTileCenter(0.7, 0.7, TILE);
    expect(b.x).toBeCloseTo(0.9);
    expect(b.z).toBeCloseTo(0.9);
  });
});

describe("tile spans", () => {
  it("computes how many tiles a real length spans", () => {
    expect(tilesSpanned(1.8, 0.6)).toBeCloseTo(3);
    expect(tilesSpanned(0.9, 0.6)).toBeCloseTo(1.5);
  });
});

describe("half-tile snapping", () => {
  it("snaps to half-tile increments", () => {
    const r = snapToHalfTile(0.44, 0.16, TILE);
    expect(r.x).toBeCloseTo(0.3);
    expect(r.z).toBeCloseTo(0.3);
  });
});

describe("applySnap dispatch", () => {
  it("passes through when off", () => {
    expect(applySnap(0.37, 0.52, TILE, "off")).toEqual({ x: 0.37, z: 0.52 });
  });
  it("routes to the selected mode", () => {
    expect(applySnap(0.1, 0.1, TILE, "center")).toEqual(snapToTileCenter(0.1, 0.1, TILE));
    expect(applySnap(0.4, 0.4, TILE, "intersection")).toEqual(
      snapToTileIntersection(0.4, 0.4, TILE),
    );
  });
});

describe("tile ref formatting", () => {
  it("is 1-based and human readable", () => {
    expect(formatTileRef({ col: 0, row: 0 })).toContain("第 1 行");
    expect(formatTileRef({ col: 2, row: 3 })).toContain("第 4 列");
  });
});
