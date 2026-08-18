/**
 * Browser-side glTF optimization via @gltf-transform (prune / dedup / texture resize).
 * Loaded dynamically so the main bundle stays lean until import is used.
 */

import { emptyMetrics, evaluateQuality, type QualityMetrics, type QualityReport } from "./qualityGate";

export interface OptimizeGltfResult {
  buffer: ArrayBuffer;
  report: QualityReport;
  optimized: boolean;
}

async function loadTransform() {
  const core = await import("@gltf-transform/core");
  const functions = await import("@gltf-transform/functions");
  return { core, functions };
}

function metricsFromDocument(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  document: any,
  byteLength: number,
): QualityMetrics {
  let triangleCount = 0;
  let vertexCount = 0;
  let maxTextureDim = 0;
  let textureCount = 0;
  const root = document.getRoot();
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (pos) vertexCount += pos.getCount();
      const indices = prim.getIndices();
      if (indices) triangleCount += Math.floor(indices.getCount() / 3);
      else if (pos) triangleCount += Math.floor(pos.getCount() / 3);
    }
  }
  for (const tex of root.listTextures()) {
    textureCount += 1;
    const img = tex.getImage();
    // Best-effort: encoded size hint only; dimension may be unavailable without decode.
    if (img && img.byteLength) {
      // Prefer getSize when present
      const size = typeof tex.getSize === "function" ? tex.getSize() : null;
      if (size) maxTextureDim = Math.max(maxTextureDim, size[0], size[1]);
    }
  }
  return {
    triangleCount,
    vertexCount,
    materialCount: root.listMaterials().length,
    textureCount,
    maxTextureDim,
    nodeCount: root.listNodes().length,
    byteLength,
    drawCallEstimate: root.listMeshes().reduce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (n: number, m: any) => n + m.listPrimitives().length,
      0,
    ),
  };
}

export async function optimizeGltfBuffer(
  input: ArrayBuffer,
  opts: { maxTextureSize?: number } = {},
): Promise<OptimizeGltfResult> {
  const maxTextureSize = opts.maxTextureSize ?? 1024;
  const { core, functions } = await loadTransform();
  const io = new core.NodeIO();
  const document = await io.readBinary(new Uint8Array(input));

  await document.transform(
    functions.dedup(),
    functions.prune(),
  );
  // Note: textureCompress needs a native encoder (sharp/etc). V1 keeps prune/dedup
  // in-browser; oversized textures are flagged by the quality gate instead.
  void maxTextureSize;

  const out = await io.writeBinary(document);
  // writeBinary may return Uint8Array
  const bytes = out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const metrics = metricsFromDocument(document, buffer.byteLength);
  const report = evaluateQuality(metrics);
  return { buffer, report, optimized: true };
}

export async function inspectGltfBuffer(input: ArrayBuffer): Promise<QualityReport> {
  try {
    const { core } = await loadTransform();
    const io = new core.NodeIO();
    const document = await io.readBinary(new Uint8Array(input));
    return evaluateQuality(metricsFromDocument(document, input.byteLength));
  } catch {
    return evaluateQuality({ ...emptyMetrics(input.byteLength), triangleCount: 0 });
  }
}
