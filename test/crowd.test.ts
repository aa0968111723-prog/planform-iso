import { describe, expect, it } from "vitest";
import { InstancedMesh, Matrix4, Vector3 } from "three";
import { SimCrowd } from "../src/scene/crowd";

function meshes(crowd: SimCrowd): InstancedMesh[] {
  return crowd.group.children.filter((c): c is InstancedMesh => c instanceof InstancedMesh);
}

function instancePosition(mesh: InstancedMesh, index: number): Vector3 {
  const m = new Matrix4();
  mesh.getMatrixAt(index, m);
  return new Vector3().setFromMatrixPosition(m);
}

describe("SimCrowd", () => {
  it("draws nothing before playback starts", () => {
    const crowd = new SimCrowd();
    crowd.update([]);
    expect(crowd.group.visible).toBe(false);
    crowd.dispose();
  });

  it("draws a body and a head per participant — a figure, not a dot", () => {
    const crowd = new SimCrowd();
    crowd.update([
      { id: 1, x: 1, z: 2, state: "traveling" },
      { id: 2, x: 3, z: 4, state: "queued" },
    ]);
    const parts = meshes(crowd);
    expect(parts).toHaveLength(2); // body + head
    for (const mesh of parts) expect(mesh.count).toBe(2);
    expect(crowd.group.visible).toBe(true);
    crowd.dispose();
  });

  it("stacks the head above the body at human scale", () => {
    const crowd = new SimCrowd();
    crowd.update([{ id: 1, x: 0, z: 0, state: "traveling" }]);
    const [body, head] = meshes(crowd);
    const bodyPos = instancePosition(body, 0);
    const headPos = instancePosition(head, 0);
    expect(headPos.y).toBeGreaterThan(bodyPos.y);
    // Total height should read as a real person (~1.7 m), not a 28 cm cube.
    expect(headPos.y).toBeGreaterThan(1.4);
    expect(headPos.y).toBeLessThan(1.9);
    crowd.dispose();
  });

  it("places figures at their simulated ground position", () => {
    const crowd = new SimCrowd();
    crowd.update([{ id: 7, x: 4.5, z: -2.25, state: "serving" }]);
    const [body] = meshes(crowd);
    const pos = instancePosition(body, 0);
    expect(pos.x).toBeCloseTo(4.5, 6);
    expect(pos.z).toBeCloseTo(-2.25, 6);
    crowd.dispose();
  });

  it("reuses the same instanced meshes across frames instead of reallocating", () => {
    const crowd = new SimCrowd();
    crowd.update([{ id: 1, x: 0, z: 0 }]);
    const first = meshes(crowd);
    for (let f = 0; f < 30; f++) crowd.update([{ id: 1, x: f * 0.1, z: 0 }]);
    const later = meshes(crowd);
    expect(later[0]).toBe(first[0]);
    expect(later[1]).toBe(first[1]);
    crowd.dispose();
  });

  it("grows capacity for a 100-person stress run", () => {
    const crowd = new SimCrowd();
    const people = Array.from({ length: 100 }, (_, i) => ({ id: i, x: i * 0.2, z: 0 }));
    crowd.update(people);
    for (const mesh of meshes(crowd)) {
      expect(mesh.count).toBe(100);
      expect(mesh.instanceMatrix.count).toBeGreaterThanOrEqual(100);
    }
    crowd.dispose();
  });

  it("shrinks the drawn count when people finish, without reallocating", () => {
    const crowd = new SimCrowd();
    crowd.update(Array.from({ length: 40 }, (_, i) => ({ id: i, x: i, z: 0 })));
    const before = meshes(crowd)[0];
    crowd.update([{ id: 0, x: 0, z: 0 }]);
    const after = meshes(crowd)[0];
    expect(after).toBe(before);
    expect(after.count).toBe(1);
    crowd.dispose();
  });

  it("turns each figure to face the way it is walking", () => {
    const crowd = new SimCrowd();
    // First frame has no history, so heading stays at the default.
    crowd.update([{ id: 1, x: 0, z: 0 }]);
    // Walking towards +X should yield a +90° yaw (mesh forward is +Z).
    crowd.update([{ id: 1, x: 1, z: 0 }]);
    const [body] = meshes(crowd);
    const m = new Matrix4();
    body.getMatrixAt(0, m);
    const forward = new Vector3(0, 0, 1).applyMatrix4(
      new Matrix4().extractRotation(m),
    );
    expect(forward.x).toBeCloseTo(1, 5);
    expect(forward.z).toBeCloseTo(0, 5);
    crowd.dispose();
  });

  it("keeps the last heading while a person stands still in a queue", () => {
    const crowd = new SimCrowd();
    crowd.update([{ id: 1, x: 0, z: 0 }]);
    crowd.update([{ id: 1, x: 0, z: 1 }]); // walking towards +Z
    const [body] = meshes(crowd);
    const moving = new Matrix4();
    body.getMatrixAt(0, moving);
    // Now the person queues: no movement at all.
    crowd.update([{ id: 1, x: 0, z: 1, state: "queued" }]);
    const stopped = new Matrix4();
    body.getMatrixAt(0, stopped);
    const a = new Vector3(0, 0, 1).applyMatrix4(new Matrix4().extractRotation(moving));
    const b = new Vector3(0, 0, 1).applyMatrix4(new Matrix4().extractRotation(stopped));
    expect(b.x).toBeCloseTo(a.x, 6);
    expect(b.z).toBeCloseTo(a.z, 6);
    crowd.dispose();
  });

  it("colours by state so queueing reads differently from moving", () => {
    const crowd = new SimCrowd();
    crowd.update([
      { id: 1, x: 0, z: 0, state: "traveling" },
      { id: 2, x: 1, z: 0, state: "queued" },
      { id: 3, x: 2, z: 0, state: "serving" },
    ]);
    const [body] = meshes(crowd);
    expect(body.instanceColor).toBeTruthy();
    const colors = body.instanceColor!.array;
    const rgb = (i: number) => [colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]].join(",");
    expect(rgb(0)).not.toBe(rgb(1));
    expect(rgb(1)).not.toBe(rgb(2));
    crowd.dispose();
  });

  it("falls back to the index when the engine gives no participant id", () => {
    const crowd = new SimCrowd();
    expect(() => crowd.update([{ x: 0, z: 0 }, { x: 1, z: 1 }])).not.toThrow();
    expect(meshes(crowd)[0].count).toBe(2);
    crowd.dispose();
  });

  it("clears everything when playback stops", () => {
    const crowd = new SimCrowd();
    crowd.update([{ id: 1, x: 0, z: 0 }]);
    crowd.update(undefined);
    expect(crowd.group.visible).toBe(false);
    expect(meshes(crowd)[0].count).toBe(0);
    crowd.dispose();
  });
});
