/**
 * PLANFORM 1.1 product-hardening gates, driven through shipped code.
 *
 * Each assertion is a thing a volunteer can see go wrong: a toast that lied,
 * a booth that ran the classroom funnel, a header still saying the old name,
 * a mat that was a coloured plane. Mutation check: take the matching fix out
 * and this file turns red.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it, beforeEach } from "vitest";
import { Box3, Mesh, MeshStandardMaterial, Scene, Vector3 } from "three";
import { BRAND } from "../src/core/brand";
import { FIRST_LAYER_PATH, PRIMARY_WORKFLOWS, WORKFLOW_LABELS } from "../src/core/workflow";
import { BOOTH_SKIP_RATE, BOOTH_STOP_RATE, defaultBoothParams } from "../src/core/boothCatalog";
import {
  audienceJoiners,
  templateFromBooth,
  templateFromScenario,
} from "../src/core/interactionCompile";
import { applyCalibrationPath } from "../src/core/calibration";
import { buildE310GoldenProject } from "../src/core/quickStart";
import { boothVenuePreset, createProjectFromVenuePreset, venuePresetById } from "../src/core/venues";
import { resolveTemplateBindings } from "../src/core/migrate";
import { runInteraction } from "../src/core/eventFlow";
import { createDefaultProject, type Project, type SceneObject } from "../src/core/model";
import { ProjectRepository } from "../src/state/projectRepository";
import { Store } from "../src/state/store";
import { AgentExecutor } from "../src/agent/executor";
import { AgentTransaction } from "../src/agent/transaction";
import { ReconstructionQueue } from "../src/assets/reconstruction";
import { buildAssetGroup } from "../src/scene/assets";
import { MATERIAL_PRESETS } from "../src/scene/materials";
import { installStudioLighting } from "../src/scene/lighting";
import { propFromRecipe } from "../src/core/propRecipe";

function installLocalStorage(): void {
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
  (globalThis as { localStorage?: unknown }).localStorage = storage;
}
beforeEach(() => installLocalStorage());
installLocalStorage();

function obj(over: Partial<SceneObject> & { id: string }): SceneObject {
  return {
    kind: "table", x: 2, z: 2, rotationDeg: 0, width: 1.2, depth: 0.6, height: 0.74,
    locked: false, hidden: false, surface: "floor", elevation: 0,
    ...over,
  } as SceneObject;
}

function plan(name: string): Project {
  const p = createDefaultProject();
  p.name = name;
  p.objects.push(obj({ id: "t1", kind: "table" }));
  return p;
}

const src = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

describe("brand identity is PLANFORM, not 平面場 ISO", () => {
  it("the brand module is the public name", () => {
    expect(BRAND.name).toBe("PLANFORM");
    expect(BRAND.title).toBe("PLANFORM｜活動空間彩排");
    expect(BRAND.tagline).toBe("先排好，再上場。");
  });

  it("browser title, PWA and package description all say PLANFORM", () => {
    expect(src("index.html")).toContain(`<title>${BRAND.title}</title>`);
    expect(src("index.html")).toContain("PLANFORM");
    expect(src("vite.config.ts")).toContain(`name: "${BRAND.title}"`);
    expect(src("vite.config.ts")).toContain(`short_name: "${BRAND.shortName}"`);
    expect(src("package.json")).toContain("PLANFORM");
  });

  it("shipped UI and 場刊 chrome do not use 平面場 ISO as the product name", () => {
    for (const file of ["src/ui/UI.ts", "src/ui/projectHome.ts", "src/export/constructionPlan.ts", "index.html"]) {
      expect(src(file), file).not.toMatch(/平面場 ISO/);
    }
    expect(src("src/ui/UI.ts")).toContain("BRAND");
    expect(src("src/ui/projectHome.ts")).toContain("BRAND.title");
    expect(src("src/export/constructionPlan.ts")).toContain("BRAND.title");
    expect(src("index.html")).toContain("PLANFORM");
  });
});

describe("first-layer IA is 我的專案 → 場地 → 場佈 → 動線／互動 → 彩排 → 分享", () => {
  it("the five editor tabs plus 我的專案 match the product path", () => {
    expect(FIRST_LAYER_PATH).toEqual(["我的專案", "場地", "場佈", "動線／互動", "彩排", "分享"]);
    expect(PRIMARY_WORKFLOWS.map((w) => w.label)).toEqual(["場地", "場佈", "動線／互動", "彩排", "分享"]);
    expect(PRIMARY_WORKFLOWS.map((w) => w.id)).toEqual(["site", "layout", "route", "sim", "export"]);
    expect(WORKFLOW_LABELS.sim).toBe("彩排");
    expect(WORKFLOW_LABELS.route).toBe("動線／互動");
  });

  it("the editor actually wires those labels — not 模擬, not 動線 alone", () => {
    const ui = src("src/ui/UI.ts");
    expect(ui).toContain("PRIMARY_WORKFLOWS");
    expect(ui).not.toMatch(/label:\s*"模擬"/);
    expect(ui).not.toMatch(/label:\s*"動線"/);
  });
});

describe("booth compile is not the classroom funnel", () => {
  const booth = () => createProjectFromVenuePreset(boothVenuePreset(), "攤位");

  it("classroom stays invited: stopRate 1, no balk, no funnel", () => {
    const scenario = buildE310GoldenProject(venuePresetById("venue:tku-e310")!).scenarios[0];
    const t = templateFromScenario(scenario);
    expect(t.audience.stopRate).toBe(1);
    expect(t.audience.patienceSeconds).toBe(0);
    const funnel = audienceJoiners(t.audience);
    expect(funnel.passed).toBe(funnel.joined);
    const r = runInteraction(t, { sampleDt: 30 });
    expect(r.funnel).toBeUndefined();
    expect(r.leftEarly).toBe(0);
  });

  it("a booth has passers-by, stop, skip, dwell, balk, queue and staff", () => {
    const project = booth();
    const t = templateFromBooth(project.booth!);
    expect(t.audience.stopRate).toBe(BOOTH_STOP_RATE);
    expect(t.audience.stopRate).toBeLessThan(1);
    const funnel = audienceJoiners(t.audience);
    expect(funnel.passed).toBeGreaterThan(funnel.joined);
    expect(funnel.joined).toBe(project.booth!.params.visitorCount);

    const skipSteps = t.steps.filter((s) => s.branch?.kind === "chance");
    expect(skipSteps.length).toBeGreaterThan(0);
    expect(BOOTH_SKIP_RATE.cushion).toBeGreaterThan(0);

    const talk = t.stations.find((s) => s.name === "與工作人員對談")!;
    expect(talk.staffRoleId).toBe("talker");
    expect(t.staff[0]?.count).toBe(defaultBoothParams("normal").deskStaff);
    expect(talk.meanServiceSeconds).toBe(defaultBoothParams("normal").talkSeconds);
    expect(talk.balkQueueLength).toBeGreaterThan(0);
    expect(t.audience.patienceSeconds).toBeGreaterThan(0);

    const r = runInteraction(t, { sampleDt: 30 });
    expect(r.funnel).toBeDefined();
    expect(r.funnel!.passed).toBe(funnel.passed);
    expect(r.participantCount).toBe(funnel.joined);
    expect(r.steps!.some((s) => s.name.startsWith("要不要"))).toBe(true);
  });

  it("moving a station changes the rehearsal numbers", () => {
    const project = booth();
    const bound = resolveTemplateBindings(project, templateFromBooth(project.booth!));
    const clustered = runInteraction(bound, { sampleDt: 30 });
    const stretched = {
      ...bound,
      stations: bound.stations.map((s, i) => ({ ...s, x: s.x + i * 6, z: s.z + i * 6 })),
    };
    const moved = runInteraction(stretched, { sampleDt: 30 });
    expect(moved.avgJourneySeconds).not.toBe(clustered.avgJourneySeconds);
  });
});

describe("false success: a reported ok must change real state", () => {
  it("Store mutate → flushAutosave → reopen still has the edit", () => {
    const created = ProjectRepository.createProject({ name: "上週社課", project: plan("上週社課") });
    const store = new Store();
    const opened = ProjectRepository.openProject(created.id);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    store.openBoundProject(created.id, opened.project);
    store.mutate((p) => {
      p.name = "這週社課";
      p.objects.push(obj({ id: "t2", x: 4, z: 4 }));
    });
    store.flushAutosave();
    const again = ProjectRepository.openProject(created.id);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.project.name).toBe("這週社課");
    expect(again.project.objects.some((o) => o.id === "t2")).toBe(true);
  });

  it("createRoute ok:true writes a route that survives the draft", async () => {
    const tx = new AgentTransaction();
    tx.start(plan("場"));
    const ex = new AgentExecutor(tx, { selectionIds: [], reconstructionQueue: new ReconstructionQueue() });
    const before = tx.getDraft()!.routes.length;
    const r = await ex.run({
      tool: "createRoute",
      args: { name: "入場", type: "entry", points: [{ x: 1, z: 1 }, { x: 5, z: 5 }] },
    });
    expect(r.ok, r.error).toBe(true);
    expect(tx.getDraft()!.routes.length).toBe(before + 1);
    expect(tx.getDraft()!.routes.at(-1)!.points).toHaveLength(2);
  });

  it("setPropArtwork without a blob is a failure, not a success", async () => {
    const p = plan("場");
    p.props = [propFromRecipe({ kind: "backdrop", name: "背景牆" }, "prop_bg")];
    const tx = new AgentTransaction();
    tx.start(p);
    const ex = new AgentExecutor(tx, { selectionIds: [], reconstructionQueue: new ReconstructionQueue() });
    const r = await ex.run({ tool: "setPropArtwork", args: { propId: "prop_bg" } });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/assetId|imageBlobId|來源圖片/);
    expect(tx.getDraft()!.props![0].parts.some((part) => part.imageBlobId)).toBe(false);
  });

  it("setPropArtwork with a blob id writes it and bumps the version", async () => {
    const p = plan("場");
    p.props = [propFromRecipe({ kind: "backdrop", name: "背景牆" }, "prop_bg")];
    const tx = new AgentTransaction();
    tx.start(p);
    const ex = new AgentExecutor(tx, { selectionIds: [], reconstructionQueue: new ReconstructionQueue() });
    const before = tx.getDraft()!.props![0].version;
    const r = await ex.run({
      tool: "setPropArtwork",
      args: { propId: "prop_bg", imageBlobId: "img_club_photo" },
    });
    expect(r.ok, r.error).toBe(true);
    const def = tx.getDraft()!.props![0];
    expect(def.version).toBe(before + 1);
    expect(def.parts.some((part) => part.imageBlobId === "img_club_photo")).toBe(true);
  });

  it("updating a missing door is not a successful calibration", () => {
    const p = createDefaultProject();
    p.objects = p.objects.filter((o) => o.kind !== "door");
    const before = JSON.stringify(p);
    expect(applyCalibrationPath(p, "door", 0.9)).toBe(false);
    expect(JSON.stringify(p)).toBe(before);
  });

  it("updating a door that exists actually changes its width", () => {
    const p = createDefaultProject();
    p.objects.push(obj({ id: "door1", kind: "door", width: 0.8, depth: 0.1, height: 2, surface: "wall" }));
    expect(applyCalibrationPath(p, "door", 0.9)).toBe(true);
    expect(p.objects.find((o) => o.id === "door1")!.width).toBe(0.9);
    expect(p.calibration.confirmed.door).toBe(true);
  });

  it("an AI preview does not write the bound project until commit", async () => {
    const created = ProjectRepository.createProject({ name: "A 專案", project: plan("A 專案") });
    const store = new Store();
    const opened = ProjectRepository.openProject(created.id);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    store.openBoundProject(created.id, opened.project);
    const tx = new AgentTransaction();
    tx.start(store.getState());
    const ex = new AgentExecutor(tx, { selectionIds: [], reconstructionQueue: new ReconstructionQueue() });
    await ex.run({
      tool: "createRoute",
      args: { name: "預覽動線", type: "entry", points: [{ x: 0, z: 0 }, { x: 2, z: 2 }] },
    });
    expect(tx.getDraft()!.routes.some((r) => r.name === "預覽動線")).toBe(true);
    expect(store.getState().routes.some((r) => r.name === "預覽動線")).toBe(false);
    store.flushAutosave();
    const mid = ProjectRepository.openProject(created.id);
    expect(mid.ok && mid.project.routes.some((r) => r.name === "預覽動線")).toBe(false);
    tx.commit(store);
    expect(store.getState().routes.some((r) => r.name === "預覽動線")).toBe(true);
  });
});

describe("data durability: one bad item does not take the others down", () => {
  it("a corrupt sibling still lists, and the healthy project still opens", () => {
    const a = ProjectRepository.createProject({ name: "完好", project: plan("完好") });
    const b = ProjectRepository.createProject({ name: "損壞", project: plan("損壞") });
    localStorage.setItem(`planform-iso:projects:${b.id}`, "{not json");
    const list = ProjectRepository.listProjects();
    expect(list.map((m) => m.id).sort()).toEqual([a.id, b.id].sort());
    const opened = ProjectRepository.openProject(a.id);
    expect(opened.ok).toBe(true);
    if (opened.ok) expect(opened.project.name).toBe("完好");
    const broken = ProjectRepository.openProject(b.id);
    expect(broken.ok).toBe(false);
  });
});

describe("visual structure: mats have thickness and contact shadows exist", () => {
  it("a 巧拼 is a slab, not a single coloured plane", () => {
    const group = buildAssetGroup("mat", { width: 0.6, depth: 0.6, height: 0.04 });
    const box = new Box3().setFromObject(group);
    const size = box.getSize(new Vector3());
    expect(size.y).toBeGreaterThan(0.02);
    const meshes: Mesh[] = [];
    group.traverse((o) => { if (o instanceof Mesh) meshes.push(o); });
    expect(meshes.length).toBeGreaterThan(1);
    const materials = meshes.map((m) => m.material as MeshStandardMaterial);
    expect(materials.some((m) => m.roughness >= 0.9)).toBe(true);
  });

  it("mat-soft is a foam, not a glossy plastic", () => {
    expect(MATERIAL_PRESETS["mat-soft"].roughness).toBeGreaterThan(0.9);
    expect(MATERIAL_PRESETS["mat-soft"].metalness).toBe(0);
  });

  it("a chair is not a generic grey box", () => {
    const group = buildAssetGroup("chair", { width: 0.45, depth: 0.5, height: 0.85 });
    const meshes: Mesh[] = [];
    group.traverse((o) => { if (o instanceof Mesh) meshes.push(o); });
    expect(meshes.length).toBeGreaterThan(2);
  });

  it("studio lighting casts a contact shadow", () => {
    const scene = new Scene();
    const lights = installStudioLighting(scene);
    const key = scene.children.find((c) => "castShadow" in c && (c as { castShadow: boolean }).castShadow);
    expect(key).toBeTruthy();
    lights.dispose();
  });
});
