/**
 * Measurement + on-site field info + calibration comparison (pure math).
 */

import type { Project, SceneObject } from "./model";
import { areaBounds, nearestWallSnap } from "./placement";
import { formatTileRef, metersToCm, worldToTile, type TileConfig } from "./units";

export interface MeasureResult {
  meters: number;
  cm: number;
  tilesX: number;
  tilesZ: number;
  tilesDiagonal: number;
}

export function measure(
  a: { x: number; z: number },
  b: { x: number; z: number },
  tile: TileConfig,
): MeasureResult {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const meters = Math.hypot(dx, dz);
  return {
    meters,
    cm: metersToCm(meters),
    tilesX: Math.abs(dx) / tile.width,
    tilesZ: Math.abs(dz) / tile.depth,
    tilesDiagonal: meters / ((tile.width + tile.depth) / 2),
  };
}

export interface FieldInfo {
  tileRef: string;
  distToNearestWall: number; // meters
  distLeftWall: number; // from classroom min X
  distTopWall: number; // from classroom min Z
  zoneName: string | null;
  sizeCm: { w: number; d: number };
  facingDeg: number;
}

export function objectFieldInfo(obj: SceneObject, project: Project): FieldInfo {
  const ref = worldToTile(obj.x, obj.z, project.tile);
  const snap = nearestWallSnap(obj.x, obj.z, [project.classroom, project.corridor], 0);
  const cb = areaBounds(project.classroom);
  const zone = project.zones.find(
    (z) =>
      obj.x >= z.x - z.width / 2 &&
      obj.x <= z.x + z.width / 2 &&
      obj.z >= z.z - z.depth / 2 &&
      obj.z <= z.z + z.depth / 2,
  );
  return {
    tileRef: formatTileRef(ref),
    distToNearestWall: snap ? snap.distance : 0,
    distLeftWall: obj.x - cb.minX,
    distTopWall: obj.z - cb.minZ,
    zoneName: zone ? zone.name : null,
    sizeCm: { w: Math.round(metersToCm(obj.width)), d: Math.round(metersToCm(obj.depth)) },
    facingDeg: obj.rotationDeg,
  };
}

export interface CalibrationCompare {
  ratio: number; // actual / model
  deltaMeters: number;
  deltaPct: number;
  matches: boolean;
}

export function calibrationCompare(actual: number, model: number): CalibrationCompare {
  if (model <= 0) return { ratio: 1, deltaMeters: 0, deltaPct: 0, matches: true };
  const ratio = actual / model;
  const deltaMeters = actual - model;
  return {
    ratio,
    deltaMeters,
    deltaPct: (deltaMeters / model) * 100,
    matches: Math.abs(deltaMeters) < 0.005,
  };
}
