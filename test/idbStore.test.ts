import { describe, expect, it } from "vitest";
import { AssetBlobStore } from "../src/assets/idbStore";

describe("AssetBlobStore (memory backend)", () => {
  it("puts, gets, lists, and deletes blobs", async () => {
    const store = new AssetBlobStore(true);
    const data = new TextEncoder().encode("hello-asset").buffer;
    const rec = await store.putBlob("blob_1", data, { kind: "sourceImage", mimeType: "image/jpeg" });
    expect(rec.byteLength).toBe(data.byteLength);
    expect(rec.mimeType).toBe("image/jpeg");

    const got = await store.getBlob("blob_1");
    expect(got?.id).toBe("blob_1");
    expect(new TextDecoder().decode(got!.data)).toBe("hello-asset");

    expect(await store.listKeys()).toContain("blob_1");
    expect(await store.deleteBlob("blob_1")).toBe(true);
    expect(await store.getBlob("blob_1")).toBeUndefined();
  });

  it("clears all keys", async () => {
    const store = new AssetBlobStore(true);
    await store.putBlob("a", new ArrayBuffer(4), { kind: "glb", mimeType: "model/gltf-binary" });
    await store.putBlob("b", new ArrayBuffer(8), { kind: "thumbnail", mimeType: "image/png" });
    await store.clear();
    expect(await store.listKeys()).toEqual([]);
  });
});
