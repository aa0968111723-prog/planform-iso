/**
 * Lightweight professional lighting for the orthographic field scene.
 * Neutral ambient + one soft shadow-casting key and two fill lights.
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
  const hemi = new HemisphereLight(0xf3f7f2, 0x59645f, 0.58);
  hemi.position.set(0, 20, 0);
  scene.add(hemi);

  const ambient = new AmbientLight(0xffffff, 0.3);
  scene.add(ambient);

  const key = new DirectionalLight(0xfff4df, 1.05);
  key.position.set(8, 17, 7);
  key.castShadow = true;
  // 512 keeps the contact shadow readable at plan scale without turning a
  // 1440px software-rendered desktop canvas into a GPU benchmark.
  key.shadow.mapSize.set(512, 512);
  key.shadow.camera.left = -18;
  key.shadow.camera.right = 18;
  key.shadow.camera.top = 18;
  key.shadow.camera.bottom = -18;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 42;
  key.shadow.bias = -0.00018;
  key.shadow.normalBias = 0.025;
  scene.add(key);

  const fill = new DirectionalLight(0xd9f0ea, 0.3);
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
