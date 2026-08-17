import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
} from "three";
import { tileCenterToWorld, type TileConfig, type TileRef } from "../core/units";

/**
 * Lightweight low-poly setup objects at real scale (meters).
 * Priority order per the plan: accurate scale first, polish last.
 */

interface BoxSpec {
  width: number; // meters along X
  depth: number; // meters along Z
  height: number; // meters along Y
  color: number;
}

const SPECS = {
  table: { width: 1.2, depth: 0.6, height: 0.74, color: 0xb08968 },
  chair: { width: 0.45, depth: 0.45, height: 0.9, color: 0x8d99ae },
  mat: { width: 0.6, depth: 1.8, height: 0.03, color: 0xef476f },
  screen: { width: 2.0, depth: 0.08, height: 1.2, color: 0x1d3557 },
} satisfies Record<string, BoxSpec>;

export type SetupObjectKind = keyof typeof SPECS;

function makeBox(spec: BoxSpec): Mesh {
  const geometry = new BoxGeometry(spec.width, spec.height, spec.depth);
  const material = new MeshStandardMaterial({
    color: spec.color,
    roughness: 0.85,
    metalness: 0.05,
  });
  const mesh = new Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Create a setup object whose footprint sits centered on a given tile,
 * resting on the floor (y = 0).
 */
export function createSetupObject(
  kind: SetupObjectKind,
  ref: TileRef,
  tile: TileConfig,
): Object3D {
  const spec = SPECS[kind];
  const group = new Group();
  group.name = `object:${kind}`;

  const mesh = makeBox(spec);
  mesh.position.y = spec.height / 2;
  group.add(mesh);

  const { x, z } = tileCenterToWorld(ref, tile);
  group.position.set(x, 0, z);
  return group;
}

export function objectFootprint(kind: SetupObjectKind): {
  width: number;
  depth: number;
} {
  const spec = SPECS[kind];
  return { width: spec.width, depth: spec.depth };
}
