/**
 * Re-attach stored visuals when a project is opened.
 *
 * The import pipeline writes a GLB's bytes into IndexedDB and caches the
 * parsed Group — but only in the session that did the importing. Nothing ever
 * read the bytes back out (`getBlob` had zero callers), so after any reload
 * every `glb:` visualRef fell through to the grey proxy box, forever, while
 * the real model sat on disk. A user who imported their club's own 扭蛋機
 * watched it turn into a grey block the next morning.
 *
 * This pass runs on project open: for every catalog entry whose visual lives
 * in a blob and is not yet cached, load → normalize to the entry's own
 * dimensions → cache, then tell the caller which refs changed so the scene
 * can rebuild just those objects.
 *
 * The loader is injectable because GLTFLoader needs a browser; tests exercise
 * the orchestration (which blobs are fetched, what gets cached, how failures
 * are contained) with a fake loader.
 */

import type { Group } from "three";
import { getAssetBlobStore } from "./idbStore";
import { normalizeGroup } from "./normalize";
import { cacheGlbGroup, getCachedGlbGroup } from "../scene/visualRegistry";
import type { ProjectCatalogExtra } from "../core/model";

export interface RehydrateHooks {
  /** Parse GLB bytes into a Group. Defaults to the real GLTFLoader. */
  loadGlb?: (buffer: ArrayBuffer) => Promise<Group>;
}

async function defaultLoadGlb(buffer: ArrayBuffer): Promise<Group> {
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const gltf = await new GLTFLoader().parseAsync(buffer, "");
  return gltf.scene as Group;
}

/**
 * Load every blob-backed visual the given entries reference.
 *
 * Returns the visualRefs that were (re)cached. One broken blob must not stop
 * the rest: a corrupt model degrades that one entry back to its proxy box —
 * which is exactly what the user already saw before this pass existed.
 */
export async function rehydrateAssetVisuals(
  extras: readonly ProjectCatalogExtra[] | undefined,
  hooks: RehydrateHooks = {},
): Promise<string[]> {
  if (!extras?.length) return [];
  const load = hooks.loadGlb ?? defaultLoadGlb;
  const store = getAssetBlobStore();
  const refreshed: string[] = [];

  for (const entry of extras) {
    const ref = entry.visualRef;
    if (!ref || !(ref.startsWith("glb:") || ref.startsWith("gltf:"))) continue;
    if (getCachedGlbGroup(ref)) continue;
    const blobId = entry.blobIds?.glb;
    if (!blobId) continue;
    try {
      const record = await store.getBlob(blobId);
      if (!record) continue;
      const group = await load(record.data);
      const normalized = normalizeGroup(group, {
        targetDims: entry.dimensions,
        forwardAxis: "+Z",
      });
      cacheGlbGroup(ref, normalized.group);
      refreshed.push(ref);
    } catch {
      // Contained: this entry keeps its proxy box; the others still load.
    }
  }
  return refreshed;
}
