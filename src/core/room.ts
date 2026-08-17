import type { TileConfig } from "./units";

/** A large area (classroom / corridor) at real scale, meters. */
export interface AreaConfig {
  name: string;
  /** Length along +X (meters). */
  length: number;
  /** Width along +Z (meters). */
  width: number;
  /** North-west corner position in world space (meters). */
  x: number;
  z: number;
}

/** Default demo layout: one classroom plus an adjoining corridor. */
export const DEFAULT_CLASSROOM: AreaConfig = {
  name: "教室 Classroom",
  length: 10,
  width: 8,
  x: 0,
  z: 0,
};

export const DEFAULT_CORRIDOR: AreaConfig = {
  name: "走廊 Corridor",
  length: 10,
  width: 2,
  x: 0,
  z: 8,
};

/** 60 x 60 cm tiles aligned to the classroom origin. */
export const DEFAULT_TILE: TileConfig = {
  width: 0.6,
  depth: 0.6,
  originX: 0,
  originZ: 0,
};
