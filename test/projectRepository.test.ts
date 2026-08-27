/**
 * The multi-project library. The assertions that matter most are the ones the
 * brief called out by name: creating a project must never replace another one,
 * and each project's autosave must be physically isolated from the others.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LEGACY_AUTOSAVE_KEY,
  LEGACY_LAYOUTS_KEY,
  PROJECT_STORAGE_KEYS,
  ProjectRepository,
} from "../src/state/projectRepository";
import { createDefaultProject, uid, type Project } from "../src/core/model";
import { buildE310GoldenProject } from "../src/core/quickStart";
import { venuePresetById } from "../src/core/venues";

/** A localStorage good enough to exercise quota failures and key scans. */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  /** When set, any setItem whose key matches throws like a full disk. */
  failOn: RegExp | null = null;

  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    if (this.failOn?.test(key)) throw new DOMException("quota", "QuotaExceededError");
    this.map.set(key, value);
  }
}

let store: MemoryStorage;

function plan(name: string, objectCount = 0): Project {
  const p = createDefaultProject();
  p.name = name;
  for (let i = 0; i < objectCount; i++) {
    p.objects.push({
      id: uid("obj"),
      kind: "table",
      assetId: "builtin:table",
      x: i,
      z: 0,
      rotationDeg: 0,
      width: 1.2,
      depth: 0.6,
      height: 0.74,
      locked: false,
      surface: "floor",
      elevation: 0,
    } as Project["objects"][number]);
  }
  return p;
}

beforeEach(() => {
  store = new MemoryStorage();
  vi.stubGlobal("localStorage", store);
});

describe("creating projects", () => {
  it("starts with an empty library", () => {
    expect(ProjectRepository.listProjects()).toEqual([]);
    expect(ProjectRepository.count()).toBe(0);
  });

  it("gives every project a stable id that is not its name", () => {
    const a = ProjectRepository.createProject({ name: "9/24 社課", project: plan("9/24 社課") });
    const b = ProjectRepository.createProject({ name: "9/24 社課", project: plan("9/24 社課") });
    expect(a.id).not.toBe(b.id);
    expect(a.id).toMatch(/^prj_/);
    // Two projects may legitimately share a name; both must survive.
    expect(ProjectRepository.count()).toBe(2);
  });

  it("NEVER replaces an existing project — the whole point of the feature", () => {
    const a = ProjectRepository.createProject({ name: "期初茶會", project: plan("期初茶會", 3) });
    const b = ProjectRepository.createProject({ name: "E310 社課", project: plan("E310 社課", 7) });
    const c = ProjectRepository.createProject({ name: "生命靈數演講", project: plan("生命靈數演講", 1) });

    expect(ProjectRepository.count()).toBe(3);
    const openedA = ProjectRepository.openProject(a.id);
    const openedB = ProjectRepository.openProject(b.id);
    const openedC = ProjectRepository.openProject(c.id);
    expect(openedA.ok && openedA.project.objects).toHaveLength(3);
    expect(openedB.ok && openedB.project.objects).toHaveLength(7);
    expect(openedC.ok && openedC.project.objects).toHaveLength(1);
  });

  it("records the metadata the project cards need", () => {
    const e310 = venuePresetById("venue:tku-e310")!;
    const meta = ProjectRepository.createProject({
      name: "E310 60 人演講",
      project: buildE310GoldenProject(e310),
      venuePresetId: e310.id,
      venueName: e310.name,
      eventDate: "2026-09-24",
    });
    expect(meta.venuePresetId).toBe("venue:tku-e310");
    expect(meta.venueName).toContain("E310");
    expect(meta.eventDate).toBe("2026-09-24");
    // Head count is derived from the scenario, not asked for twice.
    expect(meta.participants).toBe(60);
    expect(meta.createdAt).toBeGreaterThan(0);
  });

  it("setEventDate writes the card field and can clear it", () => {
    const meta = ProjectRepository.createProject({ name: "社課", project: plan("社課") });
    expect(ProjectRepository.setEventDate(meta.id, "2026-09-24")?.eventDate).toBe("2026-09-24");
    expect(ProjectRepository.getMeta(meta.id)?.eventDate).toBe("2026-09-24");
    expect(ProjectRepository.setEventDate(meta.id, undefined)?.eventDate).toBeUndefined();
    expect(ProjectRepository.getMeta(meta.id)?.eventDate).toBeUndefined();
  });

  it("lists most-recently-updated first", () => {
    const a = ProjectRepository.createProject({ name: "A", project: plan("A") }, 1000);
    const b = ProjectRepository.createProject({ name: "B", project: plan("B") }, 2000);
    expect(ProjectRepository.listProjects().map((p) => p.id)).toEqual([b.id, a.id]);
    ProjectRepository.saveProject(a.id, plan("A"), 3000);
    expect(ProjectRepository.listProjects().map((p) => p.id)).toEqual([a.id, b.id]);
  });
});

describe("save isolation", () => {
  it("saving one project physically cannot touch another", () => {
    const a = ProjectRepository.createProject({ name: "A", project: plan("A", 2) });
    const b = ProjectRepository.createProject({ name: "B", project: plan("B", 5) });

    // Edit A heavily, the way a user would before switching tabs.
    ProjectRepository.saveProject(a.id, plan("A", 40));

    const openedB = ProjectRepository.openProject(b.id);
    expect(openedB.ok && openedB.project.objects).toHaveLength(5);
    const openedA = ProjectRepository.openProject(a.id);
    expect(openedA.ok && openedA.project.objects).toHaveLength(40);
  });

  it("uses a separate storage key per project body", () => {
    const a = ProjectRepository.createProject({ name: "A", project: plan("A") });
    const b = ProjectRepository.createProject({ name: "B", project: plan("B") });
    expect(store.getItem(`${PROJECT_STORAGE_KEYS.bodyPrefix}${a.id}`)).toBeTruthy();
    expect(store.getItem(`${PROJECT_STORAGE_KEYS.bodyPrefix}${b.id}`)).toBeTruthy();
    expect(a.id).not.toBe(b.id);
  });

  it("round-trips edits across a simulated reload", () => {
    const a = ProjectRepository.createProject({ name: "A", project: plan("A", 2) });
    const b = ProjectRepository.createProject({ name: "B", project: plan("B", 5) });
    ProjectRepository.saveProject(a.id, plan("A", 9));
    // "Reload": nothing in memory, same storage.
    const reopenedA = ProjectRepository.openProject(a.id);
    const reopenedB = ProjectRepository.openProject(b.id);
    expect(reopenedA.ok && reopenedA.project.objects).toHaveLength(9);
    expect(reopenedB.ok && reopenedB.project.objects).toHaveLength(5);
  });
});

describe("rename / duplicate / delete", () => {
  it("renames the card and the body together", () => {
    const a = ProjectRepository.createProject({ name: "舊名字", project: plan("舊名字") });
    ProjectRepository.renameProject(a.id, "9/24 禪學社社課");
    expect(ProjectRepository.getMeta(a.id)!.name).toBe("9/24 禪學社社課");
    const opened = ProjectRepository.openProject(a.id);
    expect(opened.ok && opened.project.name).toBe("9/24 禪學社社課");
  });

  it("refuses a blank rename instead of creating a nameless card", () => {
    const a = ProjectRepository.createProject({ name: "A", project: plan("A") });
    expect(ProjectRepository.renameProject(a.id, "   ")).toBeNull();
    expect(ProjectRepository.getMeta(a.id)!.name).toBe("A");
  });

  it("duplicates the whole plan into an independent project", () => {
    const a = ProjectRepository.createProject({
      name: "8/25 社課",
      project: plan("8/25 社課", 12),
      venuePresetId: "venue:tku-e310",
    });
    const copy = ProjectRepository.duplicateProject(a.id, "9/1 社課")!;
    expect(copy.id).not.toBe(a.id);
    expect(copy.name).toBe("9/1 社課");
    expect(copy.venuePresetId).toBe("venue:tku-e310");

    // Editing the copy must not disturb the original.
    ProjectRepository.saveProject(copy.id, plan("9/1 社課", 1));
    const original = ProjectRepository.openProject(a.id);
    expect(original.ok && original.project.objects).toHaveLength(12);
  });

  it("defaults the copy's name rather than silently colliding", () => {
    const a = ProjectRepository.createProject({ name: "社課", project: plan("社課") });
    expect(ProjectRepository.duplicateProject(a.id)!.name).toBe("社課 複本");
  });

  it("deletes and can undo the delete", () => {
    const a = ProjectRepository.createProject({ name: "A", project: plan("A", 4) });
    ProjectRepository.createProject({ name: "B", project: plan("B") });
    const snapshot = ProjectRepository.deleteProject(a.id)!;
    expect(ProjectRepository.count()).toBe(1);
    expect(ProjectRepository.openProject(a.id).ok).toBe(false);

    expect(ProjectRepository.restoreProject(snapshot)).toBe(true);
    expect(ProjectRepository.count()).toBe(2);
    const restored = ProjectRepository.openProject(a.id);
    expect(restored.ok && restored.project.objects).toHaveLength(4);
  });

  it("clears the active pointer when the open project is deleted", () => {
    const a = ProjectRepository.createProject({ name: "A", project: plan("A") });
    ProjectRepository.setActiveProjectId(a.id);
    ProjectRepository.deleteProject(a.id);
    // Otherwise the app boots pointing at nothing and shows a white screen.
    expect(ProjectRepository.getActiveProjectId()).toBeNull();
  });
});

describe("active project pointer", () => {
  it("round-trips", () => {
    const a = ProjectRepository.createProject({ name: "A", project: plan("A") });
    ProjectRepository.setActiveProjectId(a.id);
    expect(ProjectRepository.getActiveProjectId()).toBe(a.id);
  });

  it("ignores a pointer at a project that no longer exists", () => {
    ProjectRepository.setActiveProjectId("prj_ghost");
    expect(ProjectRepository.getActiveProjectId()).toBeNull();
  });
});

describe("legacy migration", () => {
  it("turns the old single autosave into a real project, keeping its name", () => {
    store.setItem(LEGACY_AUTOSAVE_KEY, JSON.stringify(plan("E310 社課 9/24", 6)));
    const meta = ProjectRepository.migrateLegacyIfNeeded()!;
    expect(meta.name).toBe("E310 社課 9/24");
    const opened = ProjectRepository.openProject(meta.id);
    expect(opened.ok && opened.project.objects).toHaveLength(6);
  });

  it("names an untitled legacy plan 我的舊場佈", () => {
    store.setItem(LEGACY_AUTOSAVE_KEY, JSON.stringify(createDefaultProject()));
    expect(ProjectRepository.migrateLegacyIfNeeded()!.name).toBe("我的舊場佈");
  });

  it("never deletes the legacy keys — the old data stays on disk", () => {
    const legacy = JSON.stringify(plan("舊的", 2));
    store.setItem(LEGACY_AUTOSAVE_KEY, legacy);
    store.setItem(LEGACY_LAYOUTS_KEY, JSON.stringify({ "方案 A": plan("方案 A") }));
    ProjectRepository.migrateLegacyIfNeeded();
    expect(store.getItem(LEGACY_AUTOSAVE_KEY)).toBe(legacy);
    expect(store.getItem(LEGACY_LAYOUTS_KEY)).toBeTruthy();
  });

  it("runs once, not on every boot", () => {
    store.setItem(LEGACY_AUTOSAVE_KEY, JSON.stringify(plan("舊的")));
    expect(ProjectRepository.migrateLegacyIfNeeded()).not.toBeNull();
    expect(ProjectRepository.migrateLegacyIfNeeded()).toBeNull();
    expect(ProjectRepository.count()).toBe(1);
  });

  it("does not import on top of an existing library", () => {
    ProjectRepository.createProject({ name: "已經有的", project: plan("已經有的") });
    store.setItem(LEGACY_AUTOSAVE_KEY, JSON.stringify(plan("舊的")));
    expect(ProjectRepository.migrateLegacyIfNeeded()).toBeNull();
    expect(ProjectRepository.count()).toBe(1);
  });

  it("leaves a corrupt legacy blob alone instead of importing garbage", () => {
    store.setItem(LEGACY_AUTOSAVE_KEY, "{ this is not json");
    expect(ProjectRepository.migrateLegacyIfNeeded()).toBeNull();
    expect(ProjectRepository.count()).toBe(0);
    expect(store.getItem(LEGACY_AUTOSAVE_KEY)).toBe("{ this is not json");
  });

  it("retries later if storage was full during migration", () => {
    store.setItem(LEGACY_AUTOSAVE_KEY, JSON.stringify(plan("舊的")));
    store.failOn = /projects:prj_/;
    expect(() => ProjectRepository.migrateLegacyIfNeeded()).not.toThrow();
    expect(ProjectRepository.hasMigrated()).toBe(false);
    store.failOn = null;
    expect(ProjectRepository.migrateLegacyIfNeeded()).not.toBeNull();
  });
});

describe("corrupt recovery", () => {
  it("one broken project does not take the library down", () => {
    const good = ProjectRepository.createProject({ name: "好的", project: plan("好的", 3) });
    const bad = ProjectRepository.createProject({ name: "壞掉的", project: plan("壞掉的") });
    store.setItem(`${PROJECT_STORAGE_KEYS.bodyPrefix}${bad.id}`, "<<not json>>");

    // Project Home still lists both.
    expect(ProjectRepository.listProjects()).toHaveLength(2);
    // The good one still opens.
    expect(ProjectRepository.openProject(good.id).ok).toBe(true);
    // The bad one reports itself instead of throwing.
    const opened = ProjectRepository.openProject(bad.id);
    expect(opened.ok).toBe(false);
    expect(!opened.ok && opened.reason).toBe("corrupt");
    expect(!opened.ok && opened.meta?.name).toBe("壞掉的");
  });

  it("keeps the unreadable bytes so the data can still be rescued", () => {
    const bad = ProjectRepository.createProject({ name: "壞掉的", project: plan("壞掉的") });
    store.setItem(`${PROJECT_STORAGE_KEYS.bodyPrefix}${bad.id}`, "<<not json>>");
    ProjectRepository.openProject(bad.id);
    expect(ProjectRepository.corruptBody(bad.id)).toBe("<<not json>>");
  });

  it("rebuilds the library from bodies when the index itself is corrupt", () => {
    const a = ProjectRepository.createProject({ name: "A", project: plan("A") });
    ProjectRepository.createProject({ name: "B", project: plan("B") });
    store.setItem(PROJECT_STORAGE_KEYS.index, "<<not json>>");
    const recovered = ProjectRepository.listProjects();
    expect(recovered).toHaveLength(2);
    expect(recovered.map((p) => p.name).sort()).toEqual(["A", "B"]);
    expect(ProjectRepository.openProject(a.id).ok).toBe(true);
  });

  it("drops an unusable index row without hiding the rest", () => {
    ProjectRepository.createProject({ name: "A", project: plan("A") });
    const index = JSON.parse(store.getItem(PROJECT_STORAGE_KEYS.index)!);
    index.entries.push({ nonsense: true });
    store.setItem(PROJECT_STORAGE_KEYS.index, JSON.stringify(index));
    expect(ProjectRepository.listProjects()).toHaveLength(1);
  });

  it("reports a missing body rather than throwing", () => {
    const a = ProjectRepository.createProject({ name: "A", project: plan("A") });
    store.removeItem(`${PROJECT_STORAGE_KEYS.bodyPrefix}${a.id}`);
    const opened = ProjectRepository.openProject(a.id);
    expect(opened.ok).toBe(false);
    expect(!opened.ok && opened.reason).toBe("missing");
  });
});

describe("storage unavailable", () => {
  it("degrades to an empty library instead of crashing the app", () => {
    vi.stubGlobal("localStorage", {
      get length() {
        throw new Error("blocked");
      },
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
      removeItem() {
        throw new Error("blocked");
      },
      key() {
        throw new Error("blocked");
      },
      clear() {
        throw new Error("blocked");
      },
    });
    expect(ProjectRepository.listProjects()).toEqual([]);
    expect(ProjectRepository.getActiveProjectId()).toBeNull();
    expect(() => ProjectRepository.setActiveProjectId("x")).not.toThrow();
    expect(ProjectRepository.migrateLegacyIfNeeded()).toBeNull();
  });

  it("surfaces a full disk on create rather than making an empty card", () => {
    store.failOn = /projects:prj_/;
    expect(() => ProjectRepository.createProject({ name: "A", project: plan("A") })).toThrow();
    expect(ProjectRepository.count()).toBe(0);
  });

  it("reports a failed save instead of pretending it worked", () => {
    const a = ProjectRepository.createProject({ name: "A", project: plan("A", 1) });
    store.failOn = new RegExp(`projects:${a.id}$`);
    expect(ProjectRepository.saveProject(a.id, plan("A", 99))).toBe(false);
    // The last good body is still there.
    const opened = ProjectRepository.openProject(a.id);
    expect(opened.ok && opened.project.objects).toHaveLength(1);
  });
});

describe("real club sizes fit in localStorage", () => {
  it("a season of E310 projects stays well under the budget", () => {
    const e310 = venuePresetById("venue:tku-e310")!;
    for (let week = 0; week < 20; week++) {
      ProjectRepository.createProject({
        name: `E310 社課 第 ${week + 1} 週`,
        project: buildE310GoldenProject(e310),
        venuePresetId: e310.id,
      });
    }
    let bytes = 0;
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i)!;
      bytes += key.length + (store.getItem(key)?.length ?? 0);
    }
    expect(ProjectRepository.count()).toBe(20);
    // 20 full golden scenarios — comfortably inside a 5 MB origin quota.
    expect(bytes).toBeLessThan(1_000_000);
  });
});

describe("card metadata stays true to the plan", () => {
  it("drops the stale venue name when the plan changes venue", () => {
    const a = ProjectRepository.createProject({
      name: "A",
      project: plan("A"),
      venuePresetId: "venue:tku-e310",
      venueName: "E310＋走廊（待現場校正）",
    });
    expect(ProjectRepository.getMeta(a.id)!.venueName).toContain("E310");

    const moved = plan("A");
    moved.venuePresetId = "venue:blank";
    ProjectRepository.saveProject(a.id, moved);

    const meta = ProjectRepository.getMeta(a.id)!;
    expect(meta.venuePresetId).toBe("venue:blank");
    // Otherwise the card would still read "E310" for a plan that is not in E310.
    expect(meta.venueName).toBeUndefined();
  });

  it("keeps the head count in step with the plan's scenario", () => {
    const e310 = venuePresetById("venue:tku-e310")!;
    const a = ProjectRepository.createProject({ name: "A", project: buildE310GoldenProject(e310) });
    expect(ProjectRepository.getMeta(a.id)!.participants).toBe(60);

    const smaller = buildE310GoldenProject(e310);
    smaller.scenarios[0].participantCount = 25;
    ProjectRepository.saveProject(a.id, smaller);
    expect(ProjectRepository.getMeta(a.id)!.participants).toBe(25);
  });

  it("gives distinct ids even when two are created in the same millisecond", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 200; i++) {
      ids.add(ProjectRepository.createProject({ name: `P${i}`, project: plan(`P${i}`) }, 1234).id);
    }
    expect(ids.size).toBe(200);
  });
});

describe("the stored body is the source of truth for the name", () => {
  it("stamps the project name over a template's own name", () => {
    // Regression: buildE310GoldenProject names itself 「E310 演講活動（範例）」.
    // The wizard's name must win, and — critically — the body that gets STORED
    // must already carry it, or the editor opens under the template name and
    // the next autosave writes that name back over the user's.
    const e310 = venuePresetById("venue:tku-e310")!;
    const template = buildE310GoldenProject(e310);
    expect(template.name).toBe("E310 演講活動（範例）");

    const meta = ProjectRepository.createProject({
      name: "9/24 禪學社社課",
      project: template,
      venuePresetId: e310.id,
    });
    expect(meta.name).toBe("9/24 禪學社社課");
    const opened = ProjectRepository.openProject(meta.id);
    expect(opened.ok && opened.project.name).toBe("9/24 禪學社社課");
  });

  it("does not mutate the caller's object", () => {
    const source = plan("原本的名字");
    ProjectRepository.createProject({ name: "新名字", project: source });
    expect(source.name).toBe("原本的名字");
  });

  it("falls back to the plan's own name when none is given", () => {
    const meta = ProjectRepository.createProject({ name: "", project: plan("計畫自己的名字") });
    expect(meta.name).toBe("計畫自己的名字");
  });
});
