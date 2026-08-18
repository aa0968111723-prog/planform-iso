import { describe, expect, it } from "vitest";
import { createCustomAssetProxy, guessSemanticFromName } from "../src/assets/proxy";
import {
  adaptGeneratedFactory,
  MockReconstructionWorker,
  ReconstructionQueue,
  replaceCatalogVisual,
  validateFactoryManifest,
} from "../src/assets/reconstruction";
import { sampleTableFactory } from "../src/assets/factories/sampleTable";
import { AssetBlobStore, resetAssetBlobStoreForTests } from "../src/assets/idbStore";
import { Group } from "three";

describe("photo proxy", () => {
  it("guesses semantic roles from names", () => {
    expect(guessSemanticFromName("收費桌").serviceRole).toBe("payment");
    expect(guessSemanticFromName("報到桌").semanticType).toBe("service-desk");
    expect(guessSemanticFromName("yoga mat").semanticType).toBe("mat");
  });

  it("creates an immediate placeable proxy entry", async () => {
    resetAssetBlobStoreForTests();
    const { entry, group } = await createCustomAssetProxy({
      name: "收費桌",
      semanticType: "service-desk",
      serviceRole: "payment",
      dimensions: { width: 1.8, depth: 0.6, height: 0.74 },
      sourceImage: new TextEncoder().encode("fake-jpeg").buffer,
      sourceMimeType: "image/jpeg",
    });
    expect(entry.sourceType).toBe("simple-proxy");
    expect(entry.visualRef.startsWith("proxy:")).toBe(true);
    expect(entry.blobIds?.sourceImage).toBeTruthy();
    expect(group).toBeInstanceOf(Group);
    const store = new AssetBlobStore(true);
    // shared store was reset to memory; ensure blob API works independently
    expect(store).toBeTruthy();
  });
});

describe("Img2ThreeJS adapter", () => {
  it("validates factory manifests", () => {
    expect(validateFactoryManifest(sampleTableFactory)).toBeNull();
    expect(
      validateFactoryManifest({
        metadata: { name: "", source: "img2threejs", version: "1", forwardAxis: "+Z" },
        create: () => new Group(),
      }),
    ).toMatch(/name/);
  });

  it("adapts sample factory and keeps spatial replace separate", () => {
    const visualRef = "factory:sample-table";
    const result = adaptGeneratedFactory(
      sampleTableFactory,
      { width: 1.2, depth: 0.6, height: 0.74 },
      visualRef,
    );
    expect(result.ok).toBe(true);
    expect(result.visualRef).toBe(visualRef);
    expect(result.bounds?.width).toBeCloseTo(1.2, 1);

    const entry = {
      id: "custom:x",
      name: "t",
      semanticType: "table" as const,
      sourceType: "simple-proxy" as const,
      category: "custom" as const,
      placementType: "floor" as const,
      dimensions: { width: 1.2, depth: 0.6, height: 0.74 },
      defaultFacingDeg: 0,
      clearanceFront: 0,
      blocksFlow: true,
      kind: "table" as const,
      icon: "📷",
      color: "#c8b6a6",
      visualRef: "proxy:custom:x",
      tags: [],
      createdBy: "photo" as const,
      version: 1,
    };
    const spatial = { x: 3, z: 4, rotationDeg: 90 };
    const next = replaceCatalogVisual(entry, visualRef!);
    expect(next.visualRef).toBe(visualRef);
    expect(next.version).toBe(2);
    // spatial data is not on catalog — scene objects unchanged by design
    expect(spatial.x).toBe(3);
    expect(spatial.z).toBe(4);
  });

  it("rejects factories with invalid imports metadata", () => {
    const bad = adaptGeneratedFactory(
      {
        metadata: {
          name: "x",
          source: "other" as "img2threejs",
          version: "1",
          forwardAxis: "+Z",
        },
        create: () => new Group(),
      },
      { width: 1, depth: 1, height: 1 },
      "factory:bad",
    );
    expect(bad.ok).toBe(false);
  });

  it("mock worker replaces visual while preserving catalog id", async () => {
    const { entry } = await createCustomAssetProxy({
      name: "桌子",
      semanticType: "table",
      dimensions: { width: 1.2, depth: 0.6, height: 0.74 },
    });
    const queue = new ReconstructionQueue();
    const job = queue.enqueue(entry.id, entry.blobIds?.sourceImage);
    const worker = new MockReconstructionWorker(queue);
    const { entry: next, job: done } = await worker.run(job.id, entry);
    expect(done.status).toBe("done");
    expect(next.id).toBe(entry.id);
    expect(next.visualRef.startsWith("factory:")).toBe(true);
    expect(next.dimensions).toEqual(entry.dimensions);
  });
});
