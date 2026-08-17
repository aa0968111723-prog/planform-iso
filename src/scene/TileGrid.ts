import {
  BufferGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Object3D,
} from "three";
import type { AreaConfig } from "../core/room";
import type { TileConfig } from "../core/units";

/**
 * Renders floor-tile boundaries at true scale as thin line segments.
 * The grid is a positioning reference for real setup work, so it is drawn
 * from the configured tile size rather than a generic helper grid.
 */
export function createTileGrid(area: AreaConfig, tile: TileConfig): Object3D {
  const positions: number[] = [];

  const x0 = area.x;
  const z0 = area.z;
  const x1 = area.x + area.length;
  const z1 = area.z + area.width;

  for (let x = x0; x <= x1 + 1e-6; x += tile.width) {
    positions.push(x, 0, z0, x, 0, z1);
  }
  for (let z = z0; z <= z1 + 1e-6; z += tile.depth) {
    positions.push(x0, 0, z, x1, 0, z);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));

  const material = new LineBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.35,
  });

  const grid = new LineSegments(geometry, material);
  grid.position.y = 0.002; // avoid z-fighting with the floor
  grid.name = "tile-grid";
  return grid;
}
