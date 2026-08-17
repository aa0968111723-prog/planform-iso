import { describe, expect, it } from "vitest";
import { createDefaultProject, type SceneObject } from "../src/core/model";
import { migrateObject } from "../src/core/migrate";
import { issueCounts, validateProject } from "../src/core/validation";

function obj(over: Partial<SceneObject> & { kind: SceneObject["kind"] }): SceneObject {
  return migrateObject({ x: 5, z: 4, rotationDeg: 0, locked: false, hidden: false, ...over });
}

describe("validation", () => {
  it("passes a clean empty classroom", () => {
    const p = createDefaultProject();
    expect(validateProject(p)).toHaveLength(0);
  });

  it("flags an out-of-bounds object", () => {
    const p = createDefaultProject();
    p.objects.push(obj({ kind: "table", x: 50, z: 50 }));
    const issues = validateProject(p);
    expect(issues.some((i) => i.code === "bounds")).toBe(true);
  });

  it("flags overlapping furniture", () => {
    const p = createDefaultProject();
    p.objects.push(obj({ kind: "table", x: 5, z: 4 }), obj({ kind: "table", x: 5.2, z: 4 }));
    expect(validateProject(p).some((i) => i.code === "overlap")).toBe(true);
  });

  it("flags an orphan computer and a wall asset off the wall", () => {
    const p = createDefaultProject();
    p.objects.push(obj({ kind: "computer", x: 5, z: 4, surface: "tabletop" }));
    p.objects.push(obj({ kind: "door", x: 5, z: 4 })); // middle of the room
    const issues = validateProject(p);
    expect(issues.some((i) => i.code === "orphan")).toBe(true);
    expect(issues.some((i) => i.code === "wall-off")).toBe(true);
  });

  it("flags a door blocked by furniture in its sweep", () => {
    const p = createDefaultProject();
    // Door on the north wall (z=0) centered at x=3.
    p.objects.push(obj({ kind: "door", x: 3, z: 0, surface: "wall", rotationDeg: 0, hinge: "left", openInward: true, openDeg: 90 }));
    // A table right in front of the leaf.
    p.objects.push(obj({ kind: "table", x: 2.6, z: 0.4, width: 0.6, depth: 0.6 }));
    expect(validateProject(p).some((i) => i.code === "door-sweep")).toBe(true);
  });

  it("counts issues by severity", () => {
    const p = createDefaultProject();
    p.objects.push(obj({ kind: "table", x: 50, z: 50 }));
    const counts = issueCounts(validateProject(p));
    expect(counts.error).toBeGreaterThanOrEqual(1);
  });
});
