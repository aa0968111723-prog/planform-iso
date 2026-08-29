import { describe, expect, it } from "vitest";
import { migrateProject } from "../src/core/migrate";
import { PROJECT_VERSION, type Project } from "../src/core/model";
import { LocalPlannerProvider } from "../src/agent/provider";
import { QuickAgent } from "../src/agent/quickAgent";
import { Store } from "../src/state/store";
import { generateLayoutSchemes } from "../src/core/spatialPlanner";
import { validateToolArgs } from "../src/agent/toolSchema";

/**
 * The agent must work on plans that predate it.
 *
 * A v1 file has no zones array, no scenarios, no catalogExtras and no props.
 * Every new tool reaches for at least one of those, so "the planner crashed on
 * my old file" is the obvious way this feature breaks a user who has been here
 * longest.
 */

/** The oldest shape this product ever wrote: geometry and objects, nothing else. */
function v1Blob(): Partial<Project> {
  return {
    version: 1,
    name: "2024 期初茶會",
    classroom: { id: "classroom", name: "教室", length: 10, width: 8, x: 0, z: 0 },
    corridor: { id: "corridor", name: "走廊", length: 10, width: 2, x: 0, z: 8 },
    objects: [
      {
        id: "old-door", kind: "door", x: 5, z: 8, rotationDeg: 0,
        width: 0.9, depth: 0.1, height: 2, locked: false, hidden: false,
      },
      {
        id: "old-table", kind: "regTable", x: 3, z: 6, rotationDeg: 0,
        width: 1.5, depth: 0.7, height: 0.74, locked: false, hidden: false,
      },
    ] as Project["objects"],
  };
}

describe("a v1 file survives the agent", () => {
  it("migrates to the current version with every block the tools need", () => {
    const p = migrateProject(v1Blob());
    expect(p.version).toBe(PROJECT_VERSION);
    expect(Array.isArray(p.zones)).toBe(true);
    expect(Array.isArray(p.routes)).toBe(true);
    expect(Array.isArray(p.groups)).toBe(true);
    expect(Array.isArray(p.measurements)).toBe(true);
    expect(Array.isArray(p.scenarios)).toBe(true);
    expect(p.validationSettings).toBeTruthy();
    expect(p.layers).toBeTruthy();
    expect(p.id).toBeTruthy();
  });

  it("keeps the objects it had, untouched", () => {
    const p = migrateProject(v1Blob());
    expect(p.objects.map((o) => o.id).sort()).toEqual(["old-door", "old-table"]);
    const table = p.objects.find((o) => o.id === "old-table")!;
    expect(table.x).toBe(3);
    expect(table.width).toBe(1.5);
  });

  it("plans a layout without crashing on the missing blocks", () => {
    const p = migrateProject(v1Blob());
    const r = generateLayoutSchemes(p, { participants: 30, staffCount: 3 });
    expect(r.schemes.length).toBe(3);
    for (const s of r.schemes) {
      expect(s.simulation, `${s.id} 無法模擬`).not.toBeNull();
    }
  });

  it("runs a full natural-language request end to end", async () => {
    const store = new Store(migrateProject(v1Blob()));
    const agent = new QuickAgent(store, new LocalPlannerProvider());
    const r = await agent.run({ text: "幫我排一個 30 人的茶會，門口保留 1.2 公尺，最後模擬人流" });
    const failures = r.toolResults.filter((x) => !x.ok);
    expect(failures, failures.map((f) => `${f.tool}: ${f.error}`).join("; ")).toEqual([]);
    expect(r.previewActive).toBe(true);
    // Still nothing committed.
    expect(store.getState().objects.map((o) => o.id).sort()).toEqual(["old-door", "old-table"]);
  });

  it("commits and undoes cleanly", async () => {
    const store = new Store(migrateProject(v1Blob()));
    const agent = new QuickAgent(store, new LocalPlannerProvider());
    await agent.run({ text: "幫我排一個 30 人的茶會" });
    agent.commit();

    const after = store.getState();
    // Object COUNT is a bad proxy for "something happened": the old desk is
    // replaced by the scheme's desk, so a v1 file with one door and one desk
    // still has two objects afterwards. Seats are the real evidence.
    expect(after.groups.length).toBeGreaterThan(0);
    expect(after.zones.length).toBeGreaterThan(0);
    expect(after.objects.some((o) => o.id === "old-table")).toBe(false);
    expect(after.objects.some((o) => o.kind === "door")).toBe(true);

    store.undo();
    expect(store.getState().objects.map((o) => o.id).sort()).toEqual(["old-door", "old-table"]);
    expect(store.getState().groups.length).toBe(0);
  });

  it("does not add optional blocks a v1 file never had unless a tool needed them", () => {
    // props and interaction stay absent, so an older build can still read the
    // file back. Adding them unconditionally would degrade the file for no gain.
    const p = migrateProject(v1Blob());
    expect(p.props).toBeUndefined();
    expect(p.interaction).toBeUndefined();
  });
});

describe("the agent does not widen the data contract", () => {
  it("no tool accepts a version field", () => {
    // A tool that could set `version` could migrate a file backwards.
    expect(validateToolArgs("updateZone", { zoneId: "z", version: 1 }).ok).toBe(false);
    expect(validateToolArgs("createZone", { type: "shoe", version: 9 }).ok).toBe(false);
  });

  it("no tool accepts an id it should be generating", () => {
    // Letting a caller choose an object id lets it overwrite an existing one.
    expect(validateToolArgs("createZone", { type: "shoe", id: "zone1" }).ok).toBe(false);
    expect(validateToolArgs("createRoute", { id: "route1" }).ok).toBe(false);
    expect(validateToolArgs("createArray", { rows: 1, cols: 1, id: "grp1" }).ok).toBe(false);
  });
});
