/**
 * Imported models must come back after a reload.
 *
 * The import pipeline stored the GLB bytes in IndexedDB and cached the parsed
 * Group — in that session only. `getBlob` had zero callers: after any reload,
 * every `glb:` visualRef fell through to the grey proxy box forever while the
 * real model sat on disk. A user who imported their club's 扭蛋機 watched it
 * turn into a grey block the next morning, with no error and no way back short
 * of re-importing the file.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { Group, Mesh, BoxGeometry } from "three";
import { rehydrateAssetVisuals } from "../src/assets/rehydrate";
import { getAssetBlobStore } from "../src/assets/idbStore";
import { cacheGlbGroup, getCachedGlbGroup } from "../src/scene/visualRegistry";
import type { ProjectCatalogExtra } from "../src/core/model";

function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}
beforeEach(() => installLocalStorage());
installLocalStorage();

function entry(id: string, over: Partial<ProjectCatalogExtra> = {}): ProjectCatalogExtra {
  return {
    id: `custom:${id}`,
    name: id,
    semanticType: "other",
    sourceType: "glb",
    category: "custom",
    placementType: "floor",
    dimensions: { width: 1, depth: 1, height: 1 },
    defaultFacingDeg: 0,
    clearanceFront: 0,
    blocksFlow: false,
    kind: "table",
    icon: "📦",
    color: "#94a3b8",
    visualRef: `glb:custom:${id}`,
    tags: [],
    createdBy: "import",
    version: 1,
    blobIds: { glb: `glb_${id}` },
    ...over,
  } as ProjectCatalogExtra;
}

/** A fake loader standing in for GLTFLoader (which needs a browser). */
function fakeModel(): Group {
  const g = new Group();
  const mesh = new Mesh(new BoxGeometry(2, 2, 2));
  mesh.position.y = 1;
  g.add(mesh);
  return g;
}

describe("blob-backed visuals reload", () => {
  it("an uncached glb entry is loaded from its blob and cached", async () => {
    const e = entry("machine1");
    await getAssetBlobStore().putBlob("glb_machine1", new ArrayBuffer(16), { kind: "glb", mimeType: "model/gltf-binary" });
    expect(getCachedGlbGroup(e.visualRef)).toBeUndefined();

    const loaded: string[] = [];
    const refs = await rehydrateAssetVisuals([e], {
      loadGlb: async () => { loaded.push("yes"); return fakeModel(); },
    });

    expect(refs).toEqual([e.visualRef]);
    expect(loaded).toHaveLength(1);
    expect(getCachedGlbGroup(e.visualRef)).toBeDefined();
  });

  it("the reloaded model is normalized to the entry's own dimensions", async () => {
    const e = entry("machine2", { dimensions: { width: 0.8, depth: 0.5, height: 1.6 } });
    await getAssetBlobStore().putBlob("glb_machine2", new ArrayBuffer(16), { kind: "glb", mimeType: "model/gltf-binary" });
    await rehydrateAssetVisuals([e], { loadGlb: async () => fakeModel() });
    const group = getCachedGlbGroup(e.visualRef)!;
    // The fake model is a 2×2×2 cube; after normalization it must measure the
    // entry's dimensions, or the scene draws it at import-file scale.
    const { Box3, Vector3 } = await import("three");
    const size = new Box3().setFromObject(group).getSize(new Vector3());
    expect(size.y).toBeCloseTo(1.6, 3);
  });

  it("an already-cached ref is not loaded twice", async () => {
    const e = entry("machine3");
    cacheGlbGroup(e.visualRef, fakeModel());
    let loads = 0;
    const refs = await rehydrateAssetVisuals([e], {
      loadGlb: async () => { loads += 1; return fakeModel(); },
    });
    expect(loads).toBe(0);
    expect(refs).toEqual([]);
  });

  it("one corrupt blob does not stop the others", async () => {
    const bad = entry("bad1");
    const good = entry("good1");
    await getAssetBlobStore().putBlob("glb_bad1", new ArrayBuffer(4), { kind: "glb", mimeType: "model/gltf-binary" });
    await getAssetBlobStore().putBlob("glb_good1", new ArrayBuffer(16), { kind: "glb", mimeType: "model/gltf-binary" });
    const refs = await rehydrateAssetVisuals([bad, good], {
      loadGlb: async (buf) => {
        if (buf.byteLength === 4) throw new Error("corrupt");
        return fakeModel();
      },
    });
    // The corrupt one keeps its proxy box — exactly what the user saw before
    // this pass existed — and the good one comes back.
    expect(refs).toEqual([good.visualRef]);
  });

  it("entries with no blob or a foreign visualRef are left alone", async () => {
    const procedural = entry("proc1", { visualRef: "proc:table", blobIds: undefined });
    const missingBlob = entry("nofile", { blobIds: undefined });
    let loads = 0;
    const refs = await rehydrateAssetVisuals([procedural, missingBlob], {
      loadGlb: async () => { loads += 1; return fakeModel(); },
    });
    expect(loads).toBe(0);
    expect(refs).toEqual([]);
  });
});
