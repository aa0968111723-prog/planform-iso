/**
 * Real-scale unit helpers.
 *
 * Internal convention (see docs/IMPLEMENTATION_PLAN.md):
 *   1 Three.js unit === 1 meter.
 *
 * All tile, object and room math flows through these helpers so the whole
 * project shares one coordinate system.
 */

export const CM_PER_METER = 100;

export function cmToMeters(cm: number): number {
  return cm / CM_PER_METER;
}

export function metersToCm(meters: number): number {
  return meters * CM_PER_METER;
}

/** A rectangular floor-tile definition, expressed in meters. */
export interface TileConfig {
  /** Tile width along +X, in meters. */
  width: number;
  /** Tile depth along +Z, in meters. */
  depth: number;
  /** Grid origin (meters). The corner of tile (col 0, row 0). */
  originX: number;
  originZ: number;
}

export interface TileRef {
  col: number;
  row: number;
}

/**
 * Convert a world position (meters) to the tile column/row that contains it.
 * Uses floor semantics so a point exactly on an edge belongs to the higher
 * tile, matching how a physical grid is read from its origin corner.
 */
export function worldToTile(
  x: number,
  z: number,
  tile: TileConfig,
): TileRef {
  return {
    col: Math.floor((x - tile.originX) / tile.width),
    row: Math.floor((z - tile.originZ) / tile.depth),
  };
}

/** World position (meters) of the *center* of a given tile. */
export function tileCenterToWorld(
  ref: TileRef,
  tile: TileConfig,
): { x: number; z: number } {
  return {
    x: tile.originX + (ref.col + 0.5) * tile.width,
    z: tile.originZ + (ref.row + 0.5) * tile.depth,
  };
}

/**
 * Snap a world coordinate to the nearest tile intersection (grid line
 * crossing). Returns meters.
 */
export function snapToTileIntersection(
  x: number,
  z: number,
  tile: TileConfig,
): { x: number; z: number } {
  return {
    x: tile.originX + Math.round((x - tile.originX) / tile.width) * tile.width,
    z: tile.originZ + Math.round((z - tile.originZ) / tile.depth) * tile.depth,
  };
}

/**
 * Snap to the nearest tile center. Returns meters.
 */
export function snapToTileCenter(
  x: number,
  z: number,
  tile: TileConfig,
): { x: number; z: number } {
  const ref = worldToTile(x, z, tile);
  return tileCenterToWorld(ref, tile);
}

/** How many tiles (fractional) a given real length spans along an axis. */
export function tilesSpanned(lengthMeters: number, tileSizeMeters: number): number {
  return lengthMeters / tileSizeMeters;
}

/** Snap to the nearest tile edge (nearest grid line on each axis independently). */
export function snapToTileEdge(
  x: number,
  z: number,
  tile: TileConfig,
): { x: number; z: number } {
  // Snap each coordinate to the nearest grid line (same as intersection).
  return snapToTileIntersection(x, z, tile);
}

/** Snap to the nearest half-tile position (grid lines and tile centers). */
export function snapToHalfTile(
  x: number,
  z: number,
  tile: TileConfig,
): { x: number; z: number } {
  const half = { width: tile.width / 2, depth: tile.depth / 2, originX: tile.originX, originZ: tile.originZ };
  return {
    x: half.originX + Math.round((x - half.originX) / half.width) * half.width,
    z: half.originZ + Math.round((z - half.originZ) / half.depth) * half.depth,
  };
}

export type SnapMode = "off" | "intersection" | "edge" | "center" | "half";

/** Apply the configured snap mode to a world position (meters). */
export function applySnap(
  x: number,
  z: number,
  tile: TileConfig,
  mode: SnapMode,
): { x: number; z: number } {
  switch (mode) {
    case "intersection":
      return snapToTileIntersection(x, z, tile);
    case "edge":
      return snapToTileEdge(x, z, tile);
    case "center":
      return snapToTileCenter(x, z, tile);
    case "half":
      return snapToHalfTile(x, z, tile);
    case "off":
    default:
      return { x, z };
  }
}

/** Human-readable tile reference like "第 3 列 / 第 2 排" (1-based). */
export function formatTileRef(ref: TileRef): string {
  return `第 ${ref.col + 1} 行 / 第 ${ref.row + 1} 列`;
}
