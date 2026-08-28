/**
 * The builder's live 3D preview (§44-45).
 *
 * A small stand-alone three.js viewer: same `buildPropGroup`, same materials,
 * four fixed camera buttons (斜角/正面/側面/俯視), rebuild on every edit. It is
 * a VIEWER over the same compiler the scene uses — not a second scene system:
 * no picking, no controls, no layers, no state of its own beyond the camera.
 *
 * Exists because configuring six face images without seeing the prop is
 * blind — the whole point of §9 is 「海報貼上去了沒」. The main scene cannot
 * serve here: while building, nothing is placed yet.
 *
 * Owns its renderer and MUST be disposed: SceneManager deliberately keeps one
 * WebGL context for the app, and leaking a second one per sheet-open is how
 * mobile browsers start dropping contexts.
 */

import {
  AmbientLight,
  Color,
  DirectionalLight,
  Group,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from "three";
import { buildPropGroup, disposePropGroup, type PropBuildContext } from "../scene/propVisual";
import type { PropDefinition } from "../core/model";

export type PreviewAngle = "iso" | "front" | "side" | "top";

export interface PropPreview {
  canvas: HTMLCanvasElement;
  /** Rebuild from the current definition — call after every edit. */
  update(def: PropDefinition, ctx?: PropBuildContext): void;
  setAngle(angle: PreviewAngle): void;
  dispose(): void;
}

export function createPropPreview(size = 260): PropPreview {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  canvas.className = "prop-preview";

  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(size, size, false);
  const scene = new Scene();
  scene.background = new Color("#eef2f7");
  scene.add(new AmbientLight("#ffffff", 0.75));
  const sun = new DirectionalLight("#ffffff", 1.1);
  sun.position.set(2.5, 4, 3);
  scene.add(sun);

  const camera = new PerspectiveCamera(40, 1, 0.05, 50);
  let current: Group | null = null;
  let radius = 1.6;
  let angle: PreviewAngle = "iso";

  const frame = () => {
    const y = radius * 0.45;
    switch (angle) {
      case "front": camera.position.set(0, y, radius * 1.5); break;
      case "side": camera.position.set(radius * 1.5, y, 0); break;
      case "top": camera.position.set(0.001, radius * 2.1, 0.001); break;
      case "iso":
      default: camera.position.set(radius, radius * 0.9, radius); break;
    }
    camera.lookAt(0, y * 0.6, 0);
    renderer.render(scene, camera);
  };

  return {
    canvas,
    update(def, ctx = {}) {
      // Every keystroke in the Studio rebuilds this. Without the dispose the
      // old build's geometries stayed on the GPU for the life of the session.
      if (current) { scene.remove(current); disposePropGroup(current); }
      current = buildPropGroup(def, ctx);
      scene.add(current);
      // Frame the prop by its declared bounds, not per-frame measuring.
      radius = Math.max(def.dimensions.width, def.dimensions.depth, def.dimensions.height, 0.3) * 1.4;
      frame();
    },
    setAngle(next) {
      angle = next;
      frame();
    },
    dispose() {
      // Geometries are per-build and must go with it; materials come from
      // shared caches and stay. Dropping the renderer releases the context.
      if (current) { scene.remove(current); disposePropGroup(current); }
      current = null;
      renderer.dispose();
    },
  };
}
