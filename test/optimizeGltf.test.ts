import { describe, expect, it } from "vitest";
import { Document, NodeIO } from "@gltf-transform/core";
import { optimizeGltfBuffer, inspectGltfBuffer } from "../src/assets/optimizeGltf";

async function makeTinyGlb(): Promise<ArrayBuffer> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const position = doc
    .createAccessor()
    .setType("VEC3")
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    .setBuffer(buffer);
  const indices = doc
    .createAccessor()
    .setType("SCALAR")
    .setArray(new Uint16Array([0, 1, 2]))
    .setBuffer(buffer);
  const prim = doc.createPrimitive().setAttribute("POSITION", position).setIndices(indices);
  const mesh = doc.createMesh("tri").addPrimitive(prim);
  const node = doc.createNode("n").setMesh(mesh);
  doc.createScene("s").addChild(node);
  const io = new NodeIO();
  const bin = await io.writeBinary(doc);
  const bytes = bin instanceof Uint8Array ? bin : new Uint8Array(bin as ArrayBuffer);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

describe("gltf optimize / inspect", () => {
  it("inspects and optimizes a tiny glb", async () => {
    const glb = await makeTinyGlb();
    const before = await inspectGltfBuffer(glb);
    expect(before.triangleCount).toBeGreaterThan(0);

    const { buffer, report, optimized } = await optimizeGltfBuffer(glb, { maxTextureSize: 512 });
    expect(optimized).toBe(true);
    expect(buffer.byteLength).toBeGreaterThan(0);
    expect(report.passStandard).toBe(true);
  });
});
