/**
 * Lightweight professional lighting for the orthographic field scene.
 * Neutral ambient + soft key/fill; consistent tone mapping; no dynamic lights.
 */

import {
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  Scene,
  WebGLRenderer,
  ACESFilmicToneMapping,
  SRGBColorSpace,
} from "three";

export interface SceneLighting {
  dispose(): void;
}

export function applyRendererLook(renderer: WebGLRenderer): void {
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
}

export function installStudioLighting(scene: Scene): SceneLighting {
  const hemi = new HemisphereLight(0xe8eef7, 0x3a4458, 0.55);
  hemi.position.set(0, 20, 0);
  scene.add(hemi);

  const ambient = new AmbientLight(0xffffff, 0.28);
  scene.add(ambient);

  const key = new DirectionalLight(0xfff6e8, 0.85);
  key.position.set(8, 16, 6);
  scene.add(key);

  const fill = new DirectionalLight(0xdbeafe, 0.32);
  fill.position.set(-7, 10, -5);
  scene.add(fill);

  const rim = new DirectionalLight(0xffffff, 0.12);
  rim.position.set(0, 8, -10);
  scene.add(rim);

  return {
    dispose() {
      scene.remove(hemi, ambient, key, fill, rim);
      hemi.dispose();
      ambient.dispose();
      key.dispose();
      fill.dispose();
      rim.dispose();
    },
  };
}
