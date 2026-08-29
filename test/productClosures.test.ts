import { beforeEach, describe, expect, it } from "vitest";
import { generateLayouts } from "../src/core/smartLayout";
import { generateFamilyLayouts } from "../src/core/familySeating";
import { applyRegistrationWizard, WIZARD_PATTERNS, WIZARD_SPLITS } from "../src/core/registrationWizard";
import { analyzeVenuePixels } from "../src/assets/venueVision";
import { BUILTIN_CATALOG } from "../src/core/catalog";
import { createDefaultProject, ZONE_DEFAULTS } from "../src/core/model";
import { buildE310GoldenProject } from "../src/core/quickStart";
import { venuePresetById } from "../src/core/venues";
import { inventoryLines } from "../src/export/constructionPlan";
import { Store, snapshotStorageKey } from "../src/state/store";
import { ProjectRepository } from "../src/state/projectRepository";
import { parseAgentJson } from "../src/agent/cloudProvider";
import { getLlmSettings, hasLlmKey, LLM_SETTINGS_KEY, setLlmSettings } from "../src/agent/llmSettings";
import { getTabId, TAB_ID_KEY } from "../src/state/tabSync";

const bounds = { minX: 0, maxX: 10, minZ: 0, maxZ: 8 };

function installLocalStorage(): Map<string, string> {
  const map = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
  return map;
}

describe("R-06 family seating", () => {
  it("generateLayouts(family) returns named 家族 zones", () => {
    const cands = generateLayouts({
      participants: 28, matWidth: 0.6, matDepth: 0.6, gap: 0, aisleWidth: 0.9, bounds, mode: "family",
    });
    expect(cands.length).toBeGreaterThanOrEqual(2);
    expect(cands.every((c) => c.mode === "family")).toBe(true);
    expect(cands[0].familyZones?.length).toBeGreaterThanOrEqual(2);
    expect(cands[0].familyZones?.[0].name).toMatch(/^家族 /);
    expect(cands[0].count).toBe(28);
  });

  it("keeps clusters inside the usable bounds when the room is large enough", () => {
    const cands = generateFamilyLayouts({ participants: 21, aisleWidth: 1.0, bounds });
    expect(cands.some((c) => c.fits)).toBe(true);
    expect(cands.every((c) => c.groups.length >= 2)).toBe(true);
  });
});

describe("R-07 / R-08 catalog + inventory", () => {
  it("ships 音控／控 PPT／名牌盒 catalog entries", () => {
    for (const id of ["builtin:av-mixer", "builtin:ppt-control", "builtin:name-badge-box"]) {
      expect(BUILTIN_CATALOG.some((e) => e.id === id)).toBe(true);
    }
    expect(ZONE_DEFAULTS.av.label).toBe("音控區");
    expect(ZONE_DEFAULTS.ppt.label).toBe("控 PPT 區");
  });

  it("E310 golden has AV/PPT zones, name-badge box, and 名牌 on the packing list", () => {
    const project = buildE310GoldenProject(venuePresetById("venue:tku-e310")!);
    expect(project.zones.some((z) => z.type === "av")).toBe(true);
    expect(project.zones.some((z) => z.type === "ppt")).toBe(true);
    expect(project.objects.some((o) => o.assetId === "builtin:name-badge-box")).toBe(true);
    expect(project.objects.some((o) => o.assetId === "builtin:av-mixer")).toBe(true);
    const names = inventoryLines(project).map((l) => l.name);
    expect(names).toContain("名牌");
    const badge = inventoryLines(project).find((l) => l.name === "名牌");
    expect(badge?.count).toBe(60);
  });
});

describe("venue vision pixels", () => {
  it("reads a bright top band and a dark bottom as screen + door, ignoring the filename", () => {
    const w = 40;
    const h = 30;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const bright = y < 4;
        const dark = y > 25;
        const v = bright ? 230 : dark ? 20 : 120;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    const dets = analyzeVenuePixels(w, h, data);
    expect(dets.some((d) => d.kind === "screen")).toBe(true);
    expect(dets.some((d) => d.kind === "door")).toBe(true);
    expect(dets.some((d) => d.kind === "tile-hint")).toBe(true);
  });

  it("does not invent a screen on a uniformly dark image", () => {
    const w = 20;
    const h = 20;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 30;
      data[i + 1] = 30;
      data[i + 2] = 30;
      data[i + 3] = 255;
    }
    const dets = analyzeVenuePixels(w, h, data);
    expect(dets.some((d) => d.kind === "screen")).toBe(false);
  });
});

describe("V2 registration wizard", () => {
  it("lists A–E and the four split modes", () => {
    expect(WIZARD_PATTERNS.map((p) => p.id)).toEqual(["A", "B", "C", "D", "E"]);
    expect(WIZARD_SPLITS.map((s) => s.id)).toEqual(["same-table", "split-table", "entry-first", "multi-desk"]);
  });

  it("A 一般報到 has no payment station in the prepaid branch", () => {
    const p = createDefaultProject();
    const scn = applyRegistrationWizard(p, {
      pattern: "A",
      split: "split-table",
      participants: 40,
      prepaidRatio: 1,
      arrivalWindowSeconds: 900,
      checkinStaff: 2,
      paymentStaff: 1,
    });
    expect(scn.stations.some((s) => s.type === "payment")).toBe(false);
    expect(scn.stations.some((s) => s.type === "checkin")).toBe(true);
    expect(scn.profiles.every((pr) => pr.branch.length > 0)).toBe(true);
  });

  it("E 多組報到 creates three check-in desks", () => {
    const p = createDefaultProject();
    const scn = applyRegistrationWizard(p, {
      pattern: "E",
      split: "multi-desk",
      participants: 60,
      prepaidRatio: 0.5,
      arrivalWindowSeconds: 1200,
      checkinStaff: 3,
      paymentStaff: 1,
    });
    expect(scn.stations.filter((s) => s.type === "checkin").length).toBeGreaterThanOrEqual(3);
  });

  it("B + 同桌 folds payment into check-in", () => {
    const p = createDefaultProject();
    const scn = applyRegistrationWizard(p, {
      pattern: "B",
      split: "same-table",
      participants: 50,
      prepaidRatio: 0.6,
      arrivalWindowSeconds: 1200,
      checkinStaff: 1,
      paymentStaff: 1,
    });
    const pay = scn.stations.find((s) => s.type === "payment");
    expect(pay?.staffCount ?? 0).toBe(0);
  });
});

describe("project-scoped snapshots + revision conflict", () => {
  let backing: Map<string, string>;
  beforeEach(() => {
    backing = installLocalStorage();
  });

  it("bound project A does not see project B's snapshot", () => {
    const a = ProjectRepository.createProject({ name: "A", project: createDefaultProject() });
    const b = ProjectRepository.createProject({ name: "B", project: createDefaultProject() });
    const storeA = new Store(createDefaultProject());
    storeA.bindProject(a.id);
    storeA.mutate((p) => { p.name = "方案甲"; }, { history: false });
    expect(storeA.saveNamedLayout("方案甲")).toBe(true);
    expect(backing.has(snapshotStorageKey(a.id))).toBe(true);

    const storeB = new Store(createDefaultProject());
    storeB.bindProject(b.id);
    expect(storeB.listLayouts()).not.toContain("方案甲");
    storeB.saveNamedLayout("方案乙");
    expect(storeA.listLayouts()).toEqual(["方案甲"]);
    expect(storeB.listLayouts()).toEqual(["方案乙"]);
  });

  it("refuses to overwrite a newer revision", () => {
    const meta = ProjectRepository.createProject({ name: "同份", project: createDefaultProject() });
    const tabA = new Store(createDefaultProject());
    tabA.bindProject(meta.id);
    tabA.mutate((p) => { p.description = "A"; }, { history: false });
    tabA.flushAutosave();
    const opened = ProjectRepository.openProject(meta.id);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const tabB = new Store(opened.project);
    tabB.bindProject(meta.id);
    tabA.mutate((p) => { p.description = "A2"; }, { history: false });
    tabA.flushAutosave();

    let conflict = false;
    tabB.onWriteConflict = () => { conflict = true; };
    tabB.mutate((p) => { p.description = "B stale"; }, { history: false });
    tabB.flushAutosave();
    expect(conflict).toBe(true);
    const latest = ProjectRepository.openProject(meta.id);
    expect(latest.ok && latest.project.description).toBe("A2");
  });
});

describe("optional LLM + tab id", () => {
  beforeEach(() => {
    installLocalStorage();
    const sess = new Map<string, string>();
    (globalThis as { sessionStorage?: Storage }).sessionStorage = {
      getItem: (k: string) => sess.get(k) ?? null,
      setItem: (k: string, v: string) => void sess.set(k, v),
      removeItem: (k: string) => void sess.delete(k),
      clear: () => sess.clear(),
      key: (i: number) => [...sess.keys()][i] ?? null,
      get length() { return sess.size; },
    };
  });

  it("hasLlmKey is false until a key is stored", () => {
    expect(hasLlmKey()).toBe(false);
    setLlmSettings({ apiKey: "sk-test" });
    expect(hasLlmKey()).toBe(true);
    expect(getLlmSettings().apiKey).toBe("sk-test");
    expect(localStorage.getItem(LLM_SETTINGS_KEY)).toContain("sk-test");
  });

  it("parseAgentJson keeps only allowed tools", () => {
    const r = parseAgentJson(JSON.stringify({
      message: "好",
      toolCalls: [
        { tool: "simulateScenario", args: { participants: 40 } },
        { tool: "rm -rf", args: {} },
      ],
    }), "openai-compatible");
    expect(r.toolCalls).toEqual([{ tool: "simulateScenario", args: { participants: 40 } }]);
    expect(r.message).toBe("好");
  });

  it("getTabId is stable in one session", () => {
    const a = getTabId();
    const b = getTabId();
    expect(a).toBe(b);
    expect(sessionStorage.getItem(TAB_ID_KEY)).toBe(a);
  });
});
