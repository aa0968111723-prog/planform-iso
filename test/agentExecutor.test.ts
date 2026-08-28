import { beforeEach, describe, expect, it } from "vitest";
import { AgentExecutor, type ToolResult } from "../src/agent/executor";
import { AgentTransaction } from "../src/agent/transaction";
import { ReconstructionQueue } from "../src/assets/reconstruction";
import { TOOL_SPECS } from "../src/agent/toolSchema";
import type { AgentHost } from "../src/agent/host";
import { createDefaultProject, type Project, type SceneObject } from "../src/core/model";
import { Store } from "../src/state/store";

/**
 * Every tool, exercised. The coverage assertion at the end is the point: a tool
 * added to the schema without a test here fails the suite, so "76 tools" cannot
 * quietly become "76 declared, 40 tested".
 */

const called = new Set<string>();

function obj(over: Partial<SceneObject> & { id: string }): SceneObject {
  return {
    kind: "table", x: 2, z: 2, rotationDeg: 0, width: 1.2, depth: 0.6, height: 0.74,
    locked: false, hidden: false, surface: "floor", elevation: 0,
    ...over,
  } as SceneObject;
}

function fixture(): Project {
  const p = createDefaultProject();
  p.objects.push(
    obj({ id: "door1", kind: "door", x: 5, z: 8, width: 0.9, depth: 0.1, height: 2, surface: "wall", assetId: "builtin:door" }),
    obj({ id: "reg1", kind: "regTable", x: 3, z: 6, width: 1.5, depth: 0.7, assetId: "builtin:regTable", serviceRole: "checkin" }),
    obj({ id: "pay1", kind: "regTable", x: 7, z: 6, width: 1.5, depth: 0.7, assetId: "builtin:regTable", serviceRole: "payment" }),
    obj({ id: "t1", kind: "table", x: 2, z: 2 }),
    obj({ id: "t2", kind: "table", x: 4, z: 2.2 }),
    obj({ id: "t3", kind: "table", x: 6, z: 1.8 }),
    obj({ id: "locked1", kind: "table", x: 8, z: 2, locked: true }),
    obj({ id: "screen1", kind: "screen", x: 5, z: 0.2, width: 1.6, depth: 0.1, height: 1, surface: "wall", assetId: "builtin:screen" }),
  );
  p.zones.push({
    id: "zone1", type: "registration", name: "報到區", x: 3, z: 6, width: 2, depth: 1.5,
    color: "#38bdf8", icon: "R", capacity: null, locked: false, hidden: false,
  });
  p.routes.push({
    id: "route1", name: "入場", color: "#38bdf8", type: "entry", visible: true,
    points: [{ x: 5, z: 7.5 }, { x: 5, z: 4 }],
  });
  return p;
}

function makeExecutor(project = fixture(), host?: AgentHost) {
  const tx = new AgentTransaction();
  tx.start(project);
  const ex = new AgentExecutor(tx, {
    selectionIds: ["t1"],
    reconstructionQueue: new ReconstructionQueue(),
    ...(host ? { host } : {}),
  });
  const run = async (tool: string, args?: Record<string, unknown>): Promise<ToolResult> => {
    called.add(tool);
    return ex.run({ tool: tool as never, args });
  };
  return { tx, ex, run, draft: () => tx.getDraft()! };
}

/* ------------------------------------------------------------------ */

describe("read tools", () => {
  it("report on the draft", async () => {
    const { run, draft } = makeExecutor();
    for (const tool of [
      "getProjectSummary", "getVenueGeometry", "getSelection", "getZones", "getRoutes",
      "listAssets", "getValidationIssues", "getSimulationSummary", "getViewportState",
      "getLayerVisibility", "getMeasurements", "getActiveScenario",
    ]) {
      const r = await run(tool);
      expect(r.ok, `${tool}: ${r.error}`).toBe(true);
    }
    expect(draft().objects.length).toBe(8);
  });

  it("getSelection returns the injected selection", async () => {
    const { run } = makeExecutor();
    const r = await run("getSelection");
    expect((r.data as { selectionIds: string[] }).selectionIds).toEqual(["t1"]);
  });

  it("listAssets filters by search", async () => {
    const { run } = makeExecutor();
    const r = await run("listAssets", { search: "報到" });
    const assets = (r.data as { assets: { name: string }[] }).assets;
    expect(assets.length).toBeGreaterThan(0);
    expect(assets.every((a) => a.name.includes("報到"))).toBe(true);
  });

  it("getViewportState reports no workspace mode without a host", async () => {
    const { run } = makeExecutor();
    const r = await run("getViewportState");
    expect((r.data as { workspaceMode: string | null }).workspaceMode).toBeNull();
  });
});

describe("object tools", () => {
  it("places, moves, rotates, resizes, duplicates and removes", async () => {
    const { run, draft } = makeExecutor();
    const before = draft().objects.length;

    const placed = await run("placeAsset", { assetId: "builtin:chair", target: "classroom-center" });
    expect(placed.ok).toBe(true);
    const newId = (placed.data as { objectId: string }).objectId;
    expect(draft().objects.length).toBe(before + 1);

    expect((await run("createAssetFromCatalog", { assetId: "builtin:table" })).ok).toBe(true);

    const moved = await run("moveAsset", { objectId: newId, x: 4, z: 4 });
    expect(moved.ok).toBe(true);
    expect(draft().objects.find((o) => o.id === newId)!.x).toBe(4);

    expect((await run("rotateAsset", { objectId: newId, rotationDeg: 90 })).ok).toBe(true);
    expect(draft().objects.find((o) => o.id === newId)!.rotationDeg).toBe(90);

    expect((await run("resizeAsset", { objectId: newId, width: 0.5, depth: 0.5 })).ok).toBe(true);
    expect(draft().objects.find((o) => o.id === newId)!.width).toBe(0.5);

    const dup = await run("duplicateAsset", { objectId: newId, offsetX: 1 });
    expect(dup.ok).toBe(true);

    const removed = await run("removeAsset", { objectId: newId });
    expect(removed.ok).toBe(true);
    expect(draft().objects.some((o) => o.id === newId)).toBe(false);
  });

  it("refuses to touch a locked object instead of silently skipping", async () => {
    // The old executor's `if (o && !o.locked)` returned ok:true either way, so
    // "move the desk" on a locked desk reported success and moved nothing.
    const { run } = makeExecutor();
    for (const [tool, args] of [
      ["moveAsset", { objectId: "locked1", x: 1, z: 1 }],
      ["rotateAsset", { objectId: "locked1", rotationDeg: 45 }],
      ["resizeAsset", { objectId: "locked1", width: 1 }],
      ["removeAsset", { objectId: "locked1" }],
    ] as const) {
      const r = await run(tool, args as Record<string, unknown>);
      expect(r.ok, `${tool} 應該拒絕已鎖定的物件`).toBe(false);
      expect(r.error).toContain("鎖定");
    }
  });

  it("reports a missing object rather than succeeding", async () => {
    const { run } = makeExecutor();
    const r = await run("moveAsset", { objectId: "nope", x: 1, z: 1 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("nope");
  });

  it("removing an object unbinds the stations that pointed at it", async () => {
    const project = fixture();
    project.scenarios = [{
      id: "s1", name: "t", participantCount: 10, arrivalWindowSeconds: 600,
      arrivalProfile: "uniform", seed: 1, settings: { speedMetersPerSecond: 1 },
      profiles: [{ id: "all", ratio: 1, branch: ["st1"] }],
      stations: [{
        id: "st1", name: "報到", type: "checkin", staffCount: 1, parallelServers: 1,
        meanServiceSeconds: 30, queueCapacity: 30, x: 3, z: 6, objectId: "reg1",
      }],
    }];
    project.activeScenarioId = "s1";
    const { run, draft } = makeExecutor(project);
    const r = await run("removeAsset", { objectId: "reg1" });
    expect(r.ok).toBe(true);
    expect((r.data as { unboundStations: number }).unboundStations).toBe(1);
    expect(draft().scenarios[0].stations[0].objectId).toBeUndefined();
  });

  it("creates and updates a custom asset, and refuses to edit a builtin", async () => {
    const { run, draft } = makeExecutor();
    const created = await run("createCustomAssetProxy", {
      name: "自訂報到桌", semanticType: "service-desk", serviceRole: "checkin",
      width: 1.8, depth: 0.6, height: 0.74,
    });
    expect(created.ok).toBe(true);
    const assetId = (created.data as { assetId: string }).assetId;

    const updated = await run("updateAssetMetadata", { assetId, name: "新名字", width: 2.0 });
    expect(updated.ok).toBe(true);
    expect(draft().catalogExtras!.find((e) => e.id === assetId)!.name).toBe("新名字");

    const builtin = await run("updateAssetMetadata", { assetId: "builtin:table", width: 3 });
    expect(builtin.ok).toBe(false);
    expect(builtin.error).toContain("內建");

    expect((await run("replaceAssetVisual", { assetId, visualRef: "proxy:new" })).ok).toBe(true);
    expect((await run("requestAssetReconstruction", { assetId })).ok).toBe(true);
  });

  it("createPropFromRecipe adds a prop and its catalog mirror", async () => {
    const { run, draft } = makeExecutor();
    const r = await run("createPropFromRecipe", {
      name: "六面骰子", kind: "dice",
      faces: Array.from({ length: 6 }, (_, i) => ({ label: `第 ${i + 1} 面` })),
    });
    expect(r.ok).toBe(true);
    expect(draft().props!.length).toBe(1);
  });

  it("importAsset says a file picker is needed rather than pretending", async () => {
    const { run } = makeExecutor();
    const r = await run("importAsset", { assetId: "custom:nothere" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("使用者");
  });
});

describe("array tools", () => {
  it("creates, updates and removes an array", async () => {
    const { run, draft } = makeExecutor();
    const created = await run("createArray", { assetId: "builtin:mat", rows: 4, cols: 5, gapX: 0, gapZ: 0 });
    expect(created.ok).toBe(true);
    const groupId = (created.data as { groupId: string }).groupId;
    expect((created.data as { count: number }).count).toBe(20);

    const updated = await run("updateArray", { groupId, rows: 6 });
    expect(updated.ok).toBe(true);
    expect((updated.data as { after: { count: number } }).after.count).toBe(30);
    expect(draft().groups.find((g) => g.id === groupId)!.rows).toBe(6);

    // An update with nothing to change is an error, not a cheerful no-op.
    expect((await run("updateArray", { groupId })).ok).toBe(false);

    expect((await run("removeArray", { groupId })).ok).toBe(true);
    expect(draft().groups.length).toBe(0);
  });

  it("distributes objects evenly along an axis", async () => {
    const { run, draft } = makeExecutor();
    const r = await run("distributeObjects", { objectIds: ["t1", "t2", "t3"], axis: "x" });
    expect(r.ok).toBe(true);
    const xs = ["t1", "t2", "t3"].map((id) => draft().objects.find((o) => o.id === id)!.x).sort((a, b) => a - b);
    expect(xs[1] - xs[0]).toBeCloseTo(xs[2] - xs[1], 6);
  });

  it("distributes with an explicit spacing", async () => {
    const { run, draft } = makeExecutor();
    const r = await run("distributeObjects", { objectIds: ["t1", "t2"], axis: "z", spacing: 1.5 });
    expect(r.ok).toBe(true);
    const zs = ["t1", "t2"].map((id) => draft().objects.find((o) => o.id === id)!.z).sort((a, b) => a - b);
    expect(zs[1] - zs[0]).toBeCloseTo(1.5, 6);
  });

  it("aligns using the rotated footprint, not the raw width", async () => {
    const project = fixture();
    // A desk rotated 90° occupies depth along X. Aligning by `width` would put
    // its visible edge somewhere else entirely.
    project.objects.push(obj({ id: "rot", kind: "table", x: 5, z: 3, width: 2, depth: 0.5, rotationDeg: 90 }));
    const { run, draft } = makeExecutor(project);
    const r = await run("alignObjects", { objectIds: ["t1", "rot"], edge: "left" });
    expect(r.ok).toBe(true);
    const t1 = draft().objects.find((o) => o.id === "t1")!;
    const rot = draft().objects.find((o) => o.id === "rot")!;
    // t1 is unrotated (half-width 0.6); rot is 90° so its half-extent along X is 0.25.
    expect(t1.x - 0.6).toBeCloseTo(rot.x - 0.25, 5);
  });

  it("reports missing ids rather than aligning whatever it found", async () => {
    const { run } = makeExecutor();
    const r = await run("alignObjects", { objectIds: ["t1", "ghost"], edge: "left" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("ghost");
  });
});

describe("zone, route and station tools", () => {
  it("creates, updates and removes a zone", async () => {
    const { run, draft } = makeExecutor();
    const created = await run("createZone", { type: "shoe", x: 2, z: 7, width: 1.2, depth: 1.2 });
    expect(created.ok).toBe(true);
    const zoneId = (created.data as { zoneId: string }).zoneId;

    const updated = await run("updateZone", { zoneId, x: 3, capacity: 20 });
    expect(updated.ok).toBe(true);
    expect(draft().zones.find((z) => z.id === zoneId)!.x).toBe(3);
    expect(draft().zones.find((z) => z.id === zoneId)!.capacity).toBe(20);

    expect((await run("updateZone", { zoneId })).ok).toBe(false);
    expect((await run("removeZone", { zoneId })).ok).toBe(true);
    expect(draft().zones.some((z) => z.id === zoneId)).toBe(false);
  });

  it("moving a zone carries its bound station with it", async () => {
    const project = fixture();
    project.scenarios = [{
      id: "s1", name: "t", participantCount: 10, arrivalWindowSeconds: 600,
      arrivalProfile: "uniform", seed: 1, settings: { speedMetersPerSecond: 1 },
      profiles: [{ id: "all", ratio: 1, branch: ["st1"] }],
      stations: [{
        id: "st1", name: "報到", type: "checkin", staffCount: 1, parallelServers: 1,
        meanServiceSeconds: 30, queueCapacity: 30, x: 3, z: 6, zoneId: "zone1",
      }],
    }];
    project.activeScenarioId = "s1";
    const { run, draft } = makeExecutor(project);
    expect((await run("updateZone", { zoneId: "zone1", x: 8, z: 2 })).ok).toBe(true);
    expect(draft().scenarios[0].stations[0].x).toBe(8);
    expect(draft().scenarios[0].stations[0].z).toBe(2);
  });

  it("removing a zone unlinks the routes that referenced it", async () => {
    const project = fixture();
    project.routes[0].startZoneId = "zone1";
    const { run, draft } = makeExecutor(project);
    const r = await run("removeZone", { zoneId: "zone1" });
    expect(r.ok).toBe(true);
    expect((r.data as { unlinkedRoutes: number }).unlinkedRoutes).toBe(1);
    expect(draft().routes[0].startZoneId).toBeUndefined();
  });

  it("creates, updates and removes a route", async () => {
    const { run, draft } = makeExecutor();
    const created = await run("createRoute", {
      name: "測試動線", type: "staff", points: [{ x: 1, z: 1 }, { x: 5, z: 5 }],
    });
    expect(created.ok).toBe(true);
    const routeId = (created.data as { routeId: string }).routeId;

    expect((await run("updateRoute", { routeId, name: "改名", visible: false })).ok).toBe(true);
    expect(draft().routes.find((r) => r.id === routeId)!.name).toBe("改名");

    // A one-point route is not a route.
    expect((await run("updateRoute", { routeId, points: [{ x: 1, z: 1 }] })).ok).toBe(false);
    expect((await run("removeRoute", { routeId })).ok).toBe(true);
  });

  it("connectRouteToZones recomputes the path from the zones", async () => {
    const project = fixture();
    project.zones.push({
      id: "zone2", type: "meditation", name: "禪坐區", x: 5, z: 3, width: 4, depth: 3,
      color: "#a78bfa", icon: "M", capacity: null, locked: false, hidden: false,
    });
    const { run, draft } = makeExecutor(project);
    const r = await run("connectRouteToZones", { routeId: "route1", startZoneId: "zone1", endZoneId: "zone2" });
    expect(r.ok).toBe(true);
    const route = draft().routes.find((x) => x.id === "route1")!;
    expect(route.points).toEqual([{ x: 3, z: 6 }, { x: 5, z: 3 }]);
    expect(route.startZoneId).toBe("zone1");
  });

  it("connectRouteToZones reports an unknown zone", async () => {
    const { run } = makeExecutor();
    const r = await run("connectRouteToZones", { routeId: "route1", startZoneId: "ghost", endZoneId: "zone1" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("ghost");
  });

  it("creates, updates and removes a service station", async () => {
    const { run, draft } = makeExecutor();
    const created = await run("createServiceStation", { type: "checkin", name: "報到", x: 3, z: 6, staffCount: 2 });
    expect(created.ok).toBe(true);
    const stationId = (created.data as { station: { id: string } }).station.id;

    expect((await run("updateServiceStation", { stationId, staffCount: 3 })).ok).toBe(true);

    // A typo in a station id used to return ok:true from the adapter.
    const missing = await run("updateServiceStation", { stationId: "stn_nope", staffCount: 1 });
    expect(missing.ok).toBe(false);

    const removed = await run("removeServiceStation", { stationId });
    expect(removed.ok).toBe(true);
    const scn = draft().scenarios.find((s) => s.stations.some((x) => x.id === stationId));
    expect(scn).toBeUndefined();
  });

  it("removing a station also takes it out of every profile branch", async () => {
    const { run, draft } = makeExecutor();
    const created = await run("createServiceStation", { type: "custom", name: "臨時" });
    const stationId = (created.data as { station: { id: string } }).station.id;
    await run("removeServiceStation", { stationId });
    for (const s of draft().scenarios) {
      for (const p of s.profiles) expect(p.branch).not.toContain(stationId);
    }
  });
});

describe("spatial design tools", () => {
  it("generates, scores and applies a layout scheme", async () => {
    const { run, draft } = makeExecutor();
    const gen = await run("generateLayoutCandidates", { participants: 40, eventType: "tea-gathering", staffCount: 4 });
    expect(gen.ok).toBe(true);
    const data = gen.data as { schemes: { id: string }[]; recommendedId: string; comparison: unknown[] };
    expect(data.schemes.length).toBe(3);
    expect(data.comparison.length).toBe(3);
    expect(["scheme-a", "scheme-b", "scheme-c"]).toContain(data.recommendedId);

    const scored = await run("scoreLayoutCandidate", { candidateId: "scheme-b", participants: 40 });
    expect(scored.ok).toBe(true);
    expect((scored.data as { score: { total: number } }).score.total).toBeGreaterThan(0);

    const before = draft().groups.length;
    const applied = await run("applySmartLayout", { candidateId: "scheme-b", participants: 40, staffCount: 4 });
    expect(applied.ok).toBe(true);
    expect(draft().groups.length).toBeGreaterThan(before);

    const bad = await run("applySmartLayout", { candidateId: "scheme-z" });
    expect(bad.ok).toBe(false);
  });

  it("validateLayout can clear doors and reports how many moved", async () => {
    const project = fixture();
    project.objects.push(obj({ id: "blocker", kind: "table", x: 5.2, z: 7.8 }));
    const { run } = makeExecutor(project);
    const r = await run("validateLayout", { optimize: "clear-doors" });
    expect(r.ok).toBe(true);
    expect((r.data as { movedObjects: number }).movedObjects).toBeGreaterThan(0);
  });

  it("measureGap returns a real distance, both to an object and to a wall", async () => {
    const { run } = makeExecutor();
    const gap = await run("measureGap", { objectIdA: "reg1", objectIdB: "pay1" });
    expect(gap.ok).toBe(true);
    const g = gap.data as { gapMeters: number; meetsMinimum: boolean };
    // Desks at x=3 and x=7, each 1.5 wide → 4 - 1.5 = 2.5 m of clear gap.
    expect(g.gapMeters).toBeCloseTo(2.5, 5);
    expect(g.meetsMinimum).toBe(true);

    const wall = await run("measureGap", { objectIdA: "reg1", toWall: true });
    expect(wall.ok).toBe(true);
    expect((wall.data as { nearestMeters: number }).nearestMeters).toBeGreaterThan(0);

    expect((await run("measureGap", { objectIdA: "reg1" })).ok).toBe(false);
  });

  it("checkDoorClearance finds a blocker and always carries the disclaimer", async () => {
    const project = fixture();
    project.objects.push(obj({ id: "blocker", kind: "table", x: 5.1, z: 7.7 }));
    const { run } = makeExecutor(project);
    const r = await run("checkDoorClearance", { clearance: 1.2 });
    expect(r.ok).toBe(true);
    const d = r.data as { blocked: unknown[]; passed: boolean; disclaimer: string };
    expect(d.blocked.length).toBeGreaterThan(0);
    expect(d.passed).toBe(false);
    expect(d.disclaimer).toContain("仍需依現場與專業規範確認");
  });

  it("checkDoorClearance says so when there is no door, rather than passing", async () => {
    const project = createDefaultProject();
    const { run } = makeExecutor(project);
    const r = await run("checkDoorClearance");
    expect(r.ok).toBe(true);
    expect((r.data as { note?: string }).note).toContain("沒有門物件");
  });

  it("checkAccessibilityWarnings flags a project minimum below the accessible figure", async () => {
    const { run } = makeExecutor();
    const r = await run("checkAccessibilityWarnings", { corridorWidth: 1.2 });
    expect(r.ok).toBe(true);
    const d = r.data as { warnings: { code: string }[]; disclaimer: string; explanation: { citations: unknown[] } };
    // The default project minimum is 0.9 m, below the 1.2 m figure.
    expect(d.warnings.some((w) => w.code === "min-aisle-below-accessible")).toBe(true);
    expect(d.disclaimer).toContain("仍需依現場與專業規範確認");
    expect(d.explanation.citations.length).toBeGreaterThan(0);
  });

  it("checkSightlines admits when the check is switched off", async () => {
    const project = fixture();
    project.validationSettings = { ...project.validationSettings, checkScreenView: false };
    const { run } = makeExecutor(project);
    const r = await run("checkSightlines");
    expect(r.ok).toBe(true);
    expect((r.data as { note?: string }).note).toContain("關閉");
  });

  it("checkSightlines runs when enabled", async () => {
    const { run } = makeExecutor();
    const r = await run("checkSightlines");
    expect(r.ok).toBe(true);
    expect((r.data as { screens: unknown[] }).screens.length).toBe(1);
  });

  it("calculateCapacity counts mats from geometry and areas from sourced figures", async () => {
    const project = fixture();
    project.groups.push({
      id: "g1", name: "墊區", sourceKind: "mat", rows: 4, cols: 10,
      itemWidth: 0.6, itemDepth: 0.6, itemHeight: 0.03, gapX: 0, gapZ: 0,
      rotationDeg: 0, anchorX: 1, anchorZ: 1, locked: false, hidden: false,
      numberPrefix: "A", numberOrder: "row", numberStart: "nw",
    });
    const { run } = makeExecutor(project);

    const mats = await run("calculateCapacity", { mode: "floor-mat" });
    expect(mats.ok).toBe(true);
    const m = mats.data as { method: string; matCells: number; estimatedPeople: number };
    expect(m.method).toBe("geometry");
    expect(m.matCells).toBe(40);
    expect(m.estimatedPeople).toBe(20);

    const chairs = await run("calculateCapacity", { mode: "chairs-rows", areaSquareMeters: 65 });
    expect(chairs.ok).toBe(true);
    const c = chairs.data as { method: string; estimatedPeople: number; explanation: { citations: unknown[] } };
    expect(c.method).toBe("area-per-person");
    expect(c.estimatedPeople).toBe(100); // 65 / 0.65
    expect(c.explanation.citations.length).toBeGreaterThan(0);
  });

  it("simulates, compares and explains the bottleneck", async () => {
    const { run } = makeExecutor();
    const sim = await run("simulateScenario", { participants: 40 });
    expect(sim.ok).toBe(true);

    const cmp = await run("compareScenarios", { participants: 40 });
    expect(cmp.ok).toBe(true);

    const why = await run("explainBottleneck", { participants: 40 });
    expect(why.ok).toBe(true);
    const d = why.data as { reasons: string[]; worstStation: { name: string } | null };
    expect(d.reasons.length).toBeGreaterThan(0);
    expect(d.worstStation).not.toBeNull();
  });
});

describe("view tools", () => {
  it("setView and setLayerVisibility change the draft, not the store", async () => {
    const { run, draft } = makeExecutor();
    expect((await run("setView", { view: "top" })).ok).toBe(true);
    expect(draft().view).toBe("top");

    expect((await run("setLayerVisibility", { layer: "routes", visible: false })).ok).toBe(true);
    expect(draft().layers.routes).toBe(false);
  });

  it("camera tools fail honestly with no viewport", async () => {
    const { run } = makeExecutor();
    for (const [tool, args] of [
      ["focusObject", { objectId: "t1" }],
      ["focusZone", { zoneId: "zone1" }],
      ["fitScene", {}],
      ["toggleLabels", { visible: true }],
      ["toggleSimulation", { running: true }],
    ] as const) {
      const r = await run(tool, args as Record<string, unknown>);
      expect(r.ok, `${tool} 應該在沒有視窗時失敗`).toBe(false);
      expect(r.error).toContain("視窗");
    }
  });
});

describe("project tools", () => {
  const hostCalls: string[] = [];
  let host: AgentHost;

  beforeEach(() => {
    hostCalls.length = 0;
    host = {
      projects: {
        list: () => [{ id: "p1", name: "專案一", updatedAt: 1 }],
        activeId: () => "p1",
        create: (i) => { hostCalls.push("create"); return { id: "p2", name: i.name, updatedAt: 2 }; },
        open: () => { hostCalls.push("open"); return { ok: true, project: createDefaultProject() }; },
        save: () => { hostCalls.push("save"); return { ok: true }; },
        duplicate: (id) => { hostCalls.push("duplicate"); return { id: `${id}-copy`, name: "副本", updatedAt: 3 }; },
        rename: (id, name) => { hostCalls.push("rename"); return { id, name, updatedAt: 4 }; },
        remove: () => { hostCalls.push("remove"); return { restored: true, snapshot: {} }; },
      },
      layoutVersions: {
        list: () => ["v1"],
        exists: (n) => n === "v1",
        save: () => { hostCalls.push("saveVersion"); return true; },
        read: (n) => (n === "v1" ? createDefaultProject() : null),
      },
      exports: {
        planImage: async () => { hostCalls.push("planImage"); return "plan.png"; },
        partnerView: async () => { hostCalls.push("partnerView"); return "partner.png"; },
        projectJson: () => JSON.stringify({}),
      },
    };
  });

  it("routes each project tool to the host", async () => {
    const { run } = makeExecutor(fixture(), host);
    expect((await run("createProject", { name: "新專案" })).ok).toBe(true);
    expect((await run("openProject", { projectId: "p1" })).ok).toBe(true);
    expect((await run("saveProject")).ok).toBe(true);
    expect((await run("duplicateProject", { projectId: "p1" })).ok).toBe(true);
    expect((await run("renameProject", { projectId: "p1", name: "改名" })).ok).toBe(true);
    expect((await run("exportProject")).ok).toBe(true);
    expect((await run("exportPlanImage", { preset: "staff" })).ok).toBe(true);
    expect((await run("exportPartnerView")).ok).toBe(true);
    expect(hostCalls).toContain("create");
    expect(hostCalls).toContain("planImage");
  });

  it("deleteProject refuses without an explicit confirmation", async () => {
    const { run } = makeExecutor(fixture(), host);
    const no = await run("deleteProject", { projectId: "p1", confirm: false });
    expect(no.ok).toBe(false);
    expect(no.error).toContain("確認");
    expect(hostCalls).not.toContain("remove");

    const yes = await run("deleteProject", { projectId: "p1", confirm: true });
    expect(yes.ok).toBe(true);
    expect(hostCalls).toContain("remove");
  });

  it("restoreLayoutVersion lands in the draft, not the live plan", async () => {
    const { run, tx } = makeExecutor(fixture(), host);
    const before = tx.getBase()!.objects.length;
    const r = await run("restoreLayoutVersion", { name: "v1" });
    expect(r.ok).toBe(true);
    // The committed base is untouched; only the draft changed.
    expect(tx.getBase()!.objects.length).toBe(before);
    expect(tx.getDraft()!.objects.length).toBe(0);
  });

  it("reports a missing version with the list of real ones", async () => {
    const { run } = makeExecutor(fixture(), host);
    const r = await run("restoreLayoutVersion", { name: "不存在" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("v1");
  });

  it("createLayoutVersion reports whether it overwrote", async () => {
    const { run } = makeExecutor(fixture(), host);
    const fresh = await run("createLayoutVersion", { name: "v2" });
    expect((fresh.data as { overwrote: boolean }).overwrote).toBe(false);
    const over = await run("createLayoutVersion", { name: "v1" });
    expect((over.data as { overwrote: boolean }).overwrote).toBe(true);
  });

  it("project tools fail honestly with no host", async () => {
    const { run } = makeExecutor();
    for (const [tool, args] of [
      ["createProject", { name: "x" }],
      ["openProject", { projectId: "p1" }],
      ["saveProject", {}],
      ["duplicateProject", {}],
      ["renameProject", { name: "x" }],
      ["deleteProject", { projectId: "p1", confirm: true }],
      ["createLayoutVersion", { name: "v" }],
      ["restoreLayoutVersion", { name: "v" }],
      ["exportProject", {}],
      ["exportPlanImage", {}],
      ["exportPartnerView", {}],
    ] as const) {
      const r = await run(tool, args as Record<string, unknown>);
      expect(r.ok, `${tool} 應該在沒有 host 時失敗`).toBe(false);
    }
  });

  it("importProject refuses to read a file on its own", async () => {
    const { run } = makeExecutor(fixture(), host);
    const r = await run("importProject");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("使用者");
  });

  it("exportMaterialList works with no host at all", async () => {
    const { run } = makeExecutor();
    const r = await run("exportMaterialList");
    expect(r.ok).toBe(true);
    expect((r.data as { totalItems: number }).totalItems).toBeGreaterThan(0);
  });
});

describe("meta tools and gating", () => {
  it("previewAgentChanges summarises before and after", async () => {
    const { run } = makeExecutor();
    await run("placeAsset", { assetId: "builtin:chair" });
    const r = await run("previewAgentChanges");
    expect(r.ok).toBe(true);
    expect((r.data as { addedObjectIds: string[] }).addedObjectIds.length).toBe(1);
  });

  it("commit and rollback cannot be called as tools", async () => {
    const { run } = makeExecutor();
    for (const tool of ["commitAgentChanges", "rollbackAgentChanges"]) {
      const r = await run(tool);
      expect(r.ok).toBe(false);
      expect(r.error).toContain("編排層");
    }
  });

  it("rejects a tool outside the allowlist", async () => {
    const { ex } = makeExecutor();
    const r = await ex.run({ tool: "rm -rf" as never, args: {} });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("允許清單");
  });

  it("refuses to run without an active preview", async () => {
    const tx = new AgentTransaction();
    const ex = new AgentExecutor(tx, { selectionIds: [], reconstructionQueue: new ReconstructionQueue() });
    const r = await ex.run({ tool: "getZones", args: {} });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Preview");
  });

  it("never mutates the committed store", async () => {
    const store = new Store(fixture());
    const tx = new AgentTransaction();
    tx.start(store.getState());
    const ex = new AgentExecutor(tx, { selectionIds: [], reconstructionQueue: new ReconstructionQueue() });
    const before = store.getState().objects.length;
    await ex.run({ tool: "placeAsset", args: { assetId: "builtin:chair" } });
    await ex.run({ tool: "removeAsset", args: { objectId: "t1" } });
    expect(store.getState().objects.length).toBe(before);
    expect(store.getState().objects.some((o) => o.id === "t1")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */

describe("coverage", () => {
  it("exercises every tool in the schema", () => {
    // A tool added to TOOL_SPECS without a test here fails this assertion,
    // which is the only thing that keeps "76 tools" from drifting into
    // "76 declared, some of them fictional".
    const untested = TOOL_SPECS.map((s) => s.name).filter((n) => !called.has(n));
    expect(untested, `這些工具沒有測試：${untested.join("、")}`).toEqual([]);
  });
});
