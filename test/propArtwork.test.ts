import { beforeEach, describe, expect, it } from "vitest";
import { getAssetBlobStore, resetAssetBlobStoreForTests } from "../src/assets/idbStore";

/**
 * `PropPart.imageBlobId` was documented as "image blob painted on the front
 * face", the plane branch tested for it — and then painted the text and
 * dropped the image. The field existed, the check existed, and nothing ever
 * loaded an image.
 *
 * These run in the node environment, so three.js meshes are not built here;
 * what is pinned is the loading contract the renderer depends on.
 */

describe("artwork loading contract", () => {
  beforeEach(() => resetAssetBlobStoreForTests());

  it("stores and returns the bytes a face will be painted with", async () => {
    const store = getAssetBlobStore();
    const bytes = new Uint8Array([137, 80, 78, 71]).buffer; // PNG magic
    await store.putBlob("img_test", bytes, { kind: "sourceImage", mimeType: "image/png" });
    const rec = await store.getBlob("img_test");
    expect(rec).toBeTruthy();
    expect(rec!.mimeType).toBe("image/png");
    expect(rec!.byteLength).toBe(4);
  });

  it("returns undefined for a blob that is not there", async () => {
    // The renderer must keep its painted fallback in this case: a backdrop
    // with no artwork yet should look blank, not disappear.
    expect(await getAssetBlobStore().getBlob("img_missing")).toBeUndefined();
  });

  it("keeps the id the proxy flow writes, so a prop can find it", async () => {
    // `createCustomAssetProxy` stores under `img_${entryId}` and records it on
    // `entry.blobIds.sourceImage`; setPropArtwork reads it back from there.
    const store = getAssetBlobStore();
    await store.putBlob("img_custom_abc", new Uint8Array([1]).buffer, {
      kind: "sourceImage", mimeType: "image/jpeg",
    });
    expect(await store.listKeys()).toContain("img_custom_abc");
  });
});
