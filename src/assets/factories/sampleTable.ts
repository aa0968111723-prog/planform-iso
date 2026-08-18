/**
 * Sample Img2ThreeJS-style factory fixture (in-process, not eval'd).
 */

import { BoxGeometry, Group, Mesh } from "three";
import type { GeneratedAssetFactory } from "../reconstruction";
import { materialFromPreset } from "../../scene/materials";

export const sampleTableFactory: GeneratedAssetFactory = {
  metadata: {
    name: "Sample Folding Table",
    source: "img2threejs",
    version: "fixture-1",
    forwardAxis: "+Z",
    unitHint: "m",
  },
  create() {
    const g = new Group();
    const top = new Mesh(new BoxGeometry(1.2, 0.04, 0.6), materialFromPreset("light-wood"));
    top.position.y = 0.72;
    g.add(top);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const leg = new Mesh(new BoxGeometry(0.04, 0.7, 0.04), materialFromPreset("painted-metal"));
      leg.position.set(sx * 0.52, 0.35, sz * 0.24);
      g.add(leg);
    }
    return g;
  },
};
