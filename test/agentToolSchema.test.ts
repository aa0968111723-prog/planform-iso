import { describe, expect, it } from "vitest";
import { TOOL_SPECS, toolNames, toolSpec, validateToolArgs } from "../src/agent/toolSchema";
import { AGENT_TOOL_ALLOWLIST, isAllowedTool } from "../src/agent/tools";

/**
 * The schema is the contract between the provider, the executor and the tests.
 * These check the contract itself, not any one tool's behaviour.
 */

describe("tool table", () => {
  it("declares every tool exactly once", () => {
    const names = toolNames();
    expect(new Set(names).size).toBe(names.length);
  });

  it("is the single source of the allowlist", () => {
    // Two hand-maintained lists is how a tool becomes callable-but-unvalidated.
    expect(AGENT_TOOL_ALLOWLIST.size).toBe(TOOL_SPECS.length);
    for (const spec of TOOL_SPECS) expect(isAllowedTool(spec.name)).toBe(true);
  });

  it("covers every category the product promises", () => {
    const categories = new Set(TOOL_SPECS.map((s) => s.category));
    for (const c of ["read", "object", "array", "zone-route", "spatial", "project", "view", "meta"]) {
      expect(categories.has(c as never)).toBe(true);
    }
  });

  it("gives every tool a summary and every parameter a description", () => {
    for (const spec of TOOL_SPECS) {
      expect(spec.summary.length, `${spec.name} 缺少說明`).toBeGreaterThan(0);
      for (const [key, param] of Object.entries(spec.params)) {
        expect(param.description.length, `${spec.name}.${key} 缺少說明`).toBeGreaterThan(0);
        if (param.type === "enum") {
          expect(param.values?.length, `${spec.name}.${key} 是列舉但沒有值`).toBeGreaterThan(0);
        }
        if (param.type === "object[]") {
          expect(param.itemShape, `${spec.name}.${key} 是物件陣列但沒有 itemShape`).toBeTruthy();
        }
      }
    }
  });

  it("bounds every numeric parameter", () => {
    // An unbounded number reaches the geometry and becomes a desk 10^9 metres
    // wide, or a participant count that hangs the simulator.
    for (const spec of TOOL_SPECS) {
      for (const [key, param] of Object.entries(spec.params)) {
        if (param.type !== "number") continue;
        expect(param.min, `${spec.name}.${key} 沒有下限`).toBeTypeOf("number");
        expect(param.max, `${spec.name}.${key} 沒有上限`).toBeTypeOf("number");
      }
    }
  });

  it("caps every string and array so an argument cannot carry a payload", () => {
    for (const spec of TOOL_SPECS) {
      for (const [key, param] of Object.entries(spec.params)) {
        if (param.type === "string") {
          expect(param.maxLength, `${spec.name}.${key} 字串沒有長度上限`).toBeTypeOf("number");
        }
        if (param.type === "string[]" || param.type === "object[]") {
          expect(param.maxItems, `${spec.name}.${key} 陣列沒有數量上限`).toBeTypeOf("number");
        }
      }
    }
  });

  it("marks the tools that reach outside the plan document", () => {
    // Project and view actions are not undone by rolling back a preview, so
    // they must be declared as needing a host.
    const mustNeedHost = ["createProject", "openProject", "deleteProject", "focusObject", "fitScene", "exportPlanImage"];
    for (const name of mustNeedHost) {
      expect(toolSpec(name)?.needsHost, `${name} 應該標記 needsHost`).toBe(true);
    }
    // exportMaterialList is pure data and must keep working headless.
    expect(toolSpec("exportMaterialList")?.needsHost).toBeFalsy();
  });
});

describe("argument validation", () => {
  it("rejects an unknown tool", () => {
    const r = validateToolArgs("mutateStoreJson", {});
    expect(r.ok).toBe(false);
  });

  it("rejects a parameter the tool never declared", () => {
    // This is the property that makes "hand me the whole project" inexpressible.
    const r = validateToolArgs("moveAsset", { objectId: "a", x: 1, z: 1, objects: [{ id: "evil" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("objects");
  });

  it("rejects a raw Project blob outright", () => {
    const r = validateToolArgs("getProjectSummary", {
      version: 8, id: "p", name: "x", objects: [], zones: [],
    });
    expect(r.ok).toBe(false);
  });

  it("requires required parameters", () => {
    expect(validateToolArgs("moveAsset", { objectId: "a", x: 1 }).ok).toBe(false);
    expect(validateToolArgs("moveAsset", { objectId: "a", x: 1, z: 2 }).ok).toBe(true);
  });

  it("treats a missing args object as missing required parameters", () => {
    expect(validateToolArgs("moveAsset", undefined).ok).toBe(false);
    expect(validateToolArgs("getZones", undefined).ok).toBe(true);
  });

  it("enforces numeric range instead of clamping", () => {
    // Clamping silently would tell the user the plan seats 5000 people when
    // they asked for 500000.
    const tooMany = validateToolArgs("simulateScenario", { participants: 500000 });
    expect(tooMany.ok).toBe(false);
    const negative = validateToolArgs("resizeAsset", { objectId: "a", width: -1 });
    expect(negative.ok).toBe(false);
  });

  it("enforces integers where a fraction is meaningless", () => {
    expect(validateToolArgs("createArray", { rows: 2.5, cols: 3 }).ok).toBe(false);
    expect(validateToolArgs("createArray", { rows: 2, cols: 3 }).ok).toBe(true);
  });

  it("enforces enum membership", () => {
    expect(validateToolArgs("setView", { view: "isometric" }).ok).toBe(false);
    expect(validateToolArgs("setView", { view: "iso" }).ok).toBe(true);
  });

  it("enforces enum membership inside string arrays", () => {
    expect(validateToolArgs("generateLayoutCandidates", { zones: ["registration", "nope"] }).ok).toBe(false);
    expect(validateToolArgs("generateLayoutCandidates", { zones: ["registration", "payment"] }).ok).toBe(true);
  });

  it("accepts the requiredAssets shape and rejects a malformed one", () => {
    const ok = validateToolArgs("generateLayoutCandidates", {
      requiredAssets: [{ assetId: "builtin:table", count: 3, zone: "registration" }],
    });
    expect(ok.ok).toBe(true);
    // count is required
    expect(validateToolArgs("generateLayoutCandidates", {
      requiredAssets: [{ assetId: "builtin:table" }],
    }).ok).toBe(false);
    // zone must be a real zone type
    expect(validateToolArgs("generateLayoutCandidates", {
      requiredAssets: [{ assetId: "builtin:table", count: 1, zone: "nowhere" }],
    }).ok).toBe(false);
    // and a fractional count is meaningless
    expect(validateToolArgs("generateLayoutCandidates", {
      requiredAssets: [{ assetId: "builtin:table", count: 1.5 }],
    }).ok).toBe(false);
  });

  it("validates the shape of object arrays", () => {
    expect(validateToolArgs("createRoute", { points: [{ x: 1, z: 1 }, { x: 2, z: 2 }] }).ok).toBe(true);
    expect(validateToolArgs("createRoute", { points: [{ x: 1 }] }).ok).toBe(false);
    expect(validateToolArgs("createRoute", { points: [{ x: 1, z: 1, evil: "y" }] }).ok).toBe(false);
  });

  it("caps array length", () => {
    const many = Array.from({ length: 300 }, (_, i) => `o${i}`);
    expect(validateToolArgs("alignObjects", { objectIds: many, edge: "left" }).ok).toBe(false);
  });

  it("caps string length", () => {
    expect(validateToolArgs("createZone", { type: "registration", name: "x".repeat(500) }).ok).toBe(false);
  });

  it("returns only the declared keys", () => {
    const r = validateToolArgs("moveAsset", { objectId: "a", x: 1.5, z: -2 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.args).sort()).toEqual(["objectId", "x", "z"]);
  });

  it("rejects NaN and Infinity", () => {
    expect(validateToolArgs("moveAsset", { objectId: "a", x: NaN, z: 0 }).ok).toBe(false);
    expect(validateToolArgs("moveAsset", { objectId: "a", x: Infinity, z: 0 }).ok).toBe(false);
  });
});
