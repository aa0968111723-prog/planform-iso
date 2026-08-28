/**
 * Resolve catalog visualRef → Three.js Group (procedural / proxy / registered factories).
 * GLB loading is async and cached separately via ensureGlbVisual.
 */

import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from "three";
import type { AssetCatalogEntry } from "../core/catalog";
import type { ObjectKind } from "../core/model";
import { buildPropGroup } from "./propVisual";
import type { PropDefinition } from "../core/model";
import { buildVisualGroup, type DoorParams, type VisualQuality } from "./assets";
import { materialFromPreset } from "./materials";

export type VisualFactory = () => Group;

const factoryRegistry = new Map<string, VisualFactory>();
const glbGroupCache = new Map<string, Group>();

export function registerVisualFactory(visualRef: string, factory: VisualFactory): void {
  factoryRegistry.set(visualRef, factory);
}

export function unregisterVisualFactory(visualRef: string): void {
  factoryRegistry.delete(visualRef);
}

export function cacheGlbGroup(visualRef: string, group: Group): void {
  glbGroupCache.set(visualRef, group);
}

export function getCachedGlbGroup(visualRef: string): Group | undefined {
  return glbGroupCache.get(visualRef);
}

export function buildProxyGroup(
  dims: { width: number; depth: number; height: number },
  color: string,
  label?: string,
): Group {
  const g = new Group();
  const mat = materialFromPreset("plastic-matte", color);
  const body = new Mesh(new BoxGeometry(dims.width, dims.height, dims.depth), mat);
  body.position.y = dims.height / 2;
  g.add(body);
  // slim facing marker
  const marker = new Mesh(
    new BoxGeometry(dims.width * 0.2, 0.02, 0.02),
    materialFromPreset("plastic-gloss", "#38bdf8"),
  );
  marker.position.set(0, dims.height + 0.02, dims.depth / 2);
  g.add(marker);
  if (label) g.name = label;
  return g;
}

export function buildMissingFallbackGroup(dims: { width: number; depth: number; height: number }): Group {
  const g = new Group();
  const mat = new MeshStandardMaterial({
    color: "#64748b",
    roughness: 0.9,
    metalness: 0,
    wireframe: false,
    transparent: true,
    opacity: 0.55,
  });
  const body = new Mesh(new BoxGeometry(dims.width, dims.height, dims.depth), mat);
  body.position.y = dims.height / 2;
  g.add(body);
  return g;
}

/**
 * Definitions the registry may draw, refreshed whenever the project changes.
 * A registry rather than a parameter because `resolveVisualGroup` is called
 * from the ghost, the library thumbnail and the scene, none of which have a
 * project to hand.
 */
const propRegistry = new Map<string, PropDefinition>();

export function registerPropVisuals(defs: readonly PropDefinition[] | undefined): void {
  propRegistry.clear();
  for (const def of defs ?? []) propRegistry.set(`prop:${def.id}`, def);
}

export function resolveVisualGroup(
  entry: AssetCatalogEntry | null | undefined,
  kind: ObjectKind,
  dims: { width: number; depth: number; height: number },
  door?: DoorParams,
  quality: VisualQuality = "standard",
): Group {
  if (!entry) {
    return buildVisualGroup(`proc:${kind}`, kind, dims, door, quality);
  }

  const ref = entry.visualRef;

  // A custom prop draws itself. Without this the placement ghost for every
  // prop was a generic kind box, so a person dragging a 骰子遊戲站 saw a plain
  // rectangle until the moment they let go.
  if (ref.startsWith("prop:")) {
    const def = propRegistry.get(ref);
    if (def) return buildPropGroup(def);
    return buildProxyGroup(dims, entry.color, entry.name);
  }

  if (ref.startsWith("factory:") || factoryRegistry.has(ref)) {
    const factory = factoryRegistry.get(ref);
    if (factory) {
      const built = factory();
      return built;
    }
  }

  if (ref.startsWith("glb:") || ref.startsWith("gltf:")) {
    const cached = glbGroupCache.get(ref);
    if (cached) return cached.clone(true);
    // Until async load finishes, show proxy.
    return buildProxyGroup(dims, entry.color, entry.name);
  }

  if (ref.startsWith("proxy:") || entry.sourceType === "simple-proxy") {
    if (ref === "proxy:missing") return buildMissingFallbackGroup(dims);
    return buildProxyGroup(dims, entry.color, entry.name);
  }

  // procedural builtins / variants
  return buildVisualGroup(ref, kind, dims, door, quality);
}
