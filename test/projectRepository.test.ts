import { beforeEach, describe, expect, it } from "vitest";
import { ProjectRepository } from "../src/state/projectRepository";
import {
  PROJECT_INDEX_BACKUP_KEY,
  PROJECT_INDEX_KEY,
  projectBackupKey,
  projectBodyKey,
  projectLayoutsBackupKey,
  projectLayoutsKey,
  type ProjectMeta,
} from "../src/state/projectStorage";
import { createDefaultProject, type Project, type Zone } from "../src/core/model";

/**
 * The same four-method stub `storeRecovery.test.ts` installs: no `length`, no
 * `key()`. That is deliberate — every enumeration in the repository has to be
 * gated behind `canEnumerate`, and this stub is what proves it.
 */
function installLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  return store;
}

function zone(name: string): Zone {
  return {
    id: `zone_${name}`,
    type: "group",
    name,
    x: 0,
    z: 0,
    width: 2,
    depth: 2,
    color: "#38bdf8",
    locked: false,
    hidden: false,
    icon: "◻",
    capacity: null,
  };
}

function planWith(name: string, zones: Zone[] = []): Project {
  const p = createDefaultProject();
  p.name = name;
  p.zones = zones;
  return p;
}

describe("ProjectRepository", () => {
  let backing: Map<string, string>;
  let repo: ProjectRepository;

  beforeEach(() => {
    backing = installLocalStorage();
    repo = new ProjectRepository();
  });

  it("兩份專案各自一支 key，互不覆蓋", () => {
    const a = repo.createProject({ project: planWith("A 活動", [zone("報到區")]) });
    const b = repo.createProject({ project: planWith("B 活動") });

    expect(a.id).not.toBe(b.id);

    const rawA = backing.get(projectBodyKey(a.id))!;
    const rawB = backing.get(projectBodyKey(b.id))!;
    expect(rawA).toContain("報到區");
    expect(rawB).not.toContain("報到區");

    const index = JSON.parse(backing.get(PROJECT_INDEX_KEY)!) as ProjectMeta[];
    expect(index).toHaveLength(2);
    // Most recently touched first.
    expect(repo.listProjects()[0].id).toBe(b.id);
    expect(repo.listProjects().map((m) => m.name).sort()).toEqual(["A 活動", "B 活動"]);
  });

  it("body 的 id 一定等於它所在的 key", () => {
    const foreign = planWith("外來檔案");
    foreign.id = "proj_from_another_device";
    const meta = repo.createProject({ project: foreign });
    const load = repo.openProject(meta.id);
    expect(load.ok).toBe(true);
    if (load.ok) expect(load.project.id).toBe(meta.id);
  });

  it("一份壞掉的專案不會影響其他專案", () => {
    const a = repo.createProject({ project: planWith("壞掉的") });
    const b = repo.createProject({ project: planWith("好的", [zone("舞台")]) });

    backing.set(projectBodyKey(a.id), "{broken json!!");

    expect(repo.listProjects()).toHaveLength(2);

    const good = repo.openProject(b.id);
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.project.zones).toHaveLength(1);

    const bad = repo.openProject(a.id);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe("corrupt");

    expect(repo.getMeta(a.id)?.broken).toBe(true);
    expect(repo.corruptBody(a.id)).toBe("{broken json!!");
    expect(backing.has(projectBodyKey(a.id))).toBe(false);
    expect(backing.get(projectBackupKey(a.id))).toBe("{broken json!!");
  });

  it("第二次開啟壞掉的專案不會覆蓋既有備份", () => {
    const a = repo.createProject({ project: planWith("壞掉的") });
    backing.set(projectBodyKey(a.id), "{first corruption");
    repo.openProject(a.id);
    expect(backing.get(projectBackupKey(a.id))).toBe("{first corruption");

    // A later, different corruption must not overwrite the older copy, and an
    // empty body must never be written over it either.
    backing.set(projectBodyKey(a.id), "{second corruption");
    repo.openProject(a.id);
    expect(backing.get(projectBackupKey(a.id))).toBe("{first corruption");
    repo.openProject(a.id);
    expect(backing.get(projectBackupKey(a.id))).toBe("{first corruption");
  });

  it("備份寫入失敗時不會刪掉原始 bytes", () => {
    const a = repo.createProject({ project: planWith("壞掉的") });
    backing.set(projectBodyKey(a.id), "{broken json!!");

    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (k.endsWith(":backup")) throw new Error("QuotaExceededError");
        backing.set(k, v);
      },
      removeItem: (k: string) => void backing.delete(k),
      clear: () => backing.clear(),
    };

    const load = repo.openProject(a.id);
    expect(load.ok).toBe(false);
    // A full disk must never be able to destroy the user's only copy.
    expect(backing.get(projectBodyKey(a.id))).toBe("{broken json!!");
  });

  it("壞掉的 index 會被隔離，不會靜靜清空整個列表", () => {
    repo.createProject({ project: planWith("A") });
    backing.set(PROJECT_INDEX_KEY, "[not json");

    // No enumeration is possible under the four-method stub, so recovery is
    // skipped rather than inventing projects called `getItem`.
    expect(() => repo.listProjects()).not.toThrow();
    expect(repo.listProjects()).toEqual([]);
    expect(backing.get(PROJECT_INDEX_BACKUP_KEY)).toBe("[not json");
    expect(repo.corruptIndex()).toBe("[not json");
  });

  it("index 自我修復只會新增，不會刪掉沒有 body 的條目", () => {
    const a = repo.createProject({ project: planWith("A") });
    const b = repo.createProject({ project: planWith("B") });
    // C is quarantined: its bytes live only in :backup, with no body key.
    const c: ProjectMeta = { id: "proj_c", name: "C", createdAt: 1, updatedAt: 1, broken: true };
    backing.set(projectBackupKey(c.id), "{broken}");
    const index = JSON.parse(backing.get(PROJECT_INDEX_KEY)!) as ProjectMeta[];
    backing.set(PROJECT_INDEX_KEY, JSON.stringify([...index, c]));

    const listed = repo.listProjects();
    expect(listed).toHaveLength(3);
    expect(listed.map((m) => m.id).sort()).toEqual([a.id, b.id, c.id].sort());
    expect(repo.getMeta(c.id)?.broken).toBe(true);
  });

  it("一份壞掉的排法不會清空整個專案的排法", () => {
    const a = repo.createProject({ project: planWith("A", [zone("報到區")]) });
    repo.writeLayout(a.id, "A版", planWith("A", [zone("報到區")]));
    repo.writeLayout(a.id, "B版", planWith("A", [zone("舞台")]));

    const original = backing.get(projectLayoutsKey(a.id))!;
    expect(original).toContain("A版");

    backing.set(projectLayoutsKey(a.id), "{broken layouts");
    repo.deleteLayout(a.id, "A版");

    expect(backing.get(projectLayoutsBackupKey(a.id))).toBe("{broken layouts");
    expect(repo.corruptLayouts(a.id)).toBe("{broken layouts");
    // Crucially: no `{}` was written over anything.
    expect(backing.get(projectLayoutsKey(a.id))).toBeUndefined();
  });

  it("載入排法版本後，body 的 id 仍等於目前專案的 id", () => {
    const a = repo.createProject({ project: planWith("原名", [zone("報到區")]) });
    repo.writeLayout(a.id, "A版", planWith("存檔時的名字", [zone("報到區")]));
    repo.renameProject(a.id, "改過的名字");

    const loaded = repo.readLayout(a.id, "A版")!;
    expect(loaded.id).toBe(a.id);
    expect(loaded.name).toBe("改過的名字");
    expect(loaded.zones).toHaveLength(1);

    const stored = JSON.parse(backing.get(projectLayoutsKey(a.id))!) as Record<
      string,
      { body: Record<string, unknown> }
    >;
    expect(Object.keys(stored["A版"].body)).not.toContain("id");
    expect(Object.keys(stored["A版"].body)).not.toContain("name");
  });

  it("複製會整份帶走，並產生新的 id", () => {
    const source = planWith("原專案", [zone("報到區")]);
    source.objects = [];
    source.routes = [];
    source.groups = [];
    source.scenarios = [
      {
        id: "sc_1",
        name: "情境",
        participantCount: 120,
        arrivalWindowSeconds: 600,
        arrivalProfile: "uniform",
        profiles: [],
        stations: [],
        seed: 1,
        settings: { speedMetersPerSecond: 1 },
      },
    ];
    source.activeScenarioId = "sc_1";
    const a = repo.createProject({ project: source });
    repo.writeLayout(a.id, "A版", source);

    const copy = repo.duplicateProject(a.id)!;
    expect(copy.id).not.toBe(a.id);
    expect(copy.name).toBe("原專案 副本");
    expect(copy.participants).toBe(120);

    const loaded = repo.openProject(copy.id);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.project.id).toBe(copy.id);
      expect(loaded.project.zones).toHaveLength(1);
      expect(loaded.project.scenarios).toHaveLength(1);
    }
    expect(repo.listLayouts(copy.id)).toEqual(["A版"]);

    // Editing the copy must not reach back into the original's key.
    const edited = repo.openProject(copy.id);
    if (edited.ok) {
      edited.project.zones.push(zone("新的區域"));
      repo.saveProject(copy.id, edited.project);
    }
    const originalAfter = repo.openProject(a.id);
    expect(originalAfter.ok).toBe(true);
    if (originalAfter.ok) expect(originalAfter.project.zones).toHaveLength(1);
  });

  it("刪除會保留 tombstone，還原是 byte-identical", () => {
    const a = repo.createProject({ project: planWith("A", [zone("報到區")]) });
    repo.writeLayout(a.id, "A版", planWith("A", [zone("報到區")]));
    const body = backing.get(projectBodyKey(a.id))!;
    const layouts = backing.get(projectLayoutsKey(a.id))!;

    const tomb = repo.deleteProject(a.id)!;
    expect(tomb.body).toBe(body);
    expect(tomb.layouts).toBe(layouts);
    expect(backing.has(projectBodyKey(a.id))).toBe(false);
    expect(repo.listProjects()).toHaveLength(0);

    expect(repo.restoreProject(tomb)).toBe(true);
    expect(backing.get(projectBodyKey(a.id))).toBe(body);
    expect(backing.get(projectLayoutsKey(a.id))).toBe(layouts);
    expect(repo.listProjects().map((m) => m.id)).toEqual([a.id]);
  });

  it("刪除壞掉的專案時，隔離的 bytes 也會被保留與還原", () => {
    const a = repo.createProject({ project: planWith("壞掉的") });
    backing.set(projectBodyKey(a.id), "{broken json!!");
    repo.openProject(a.id); // quarantines: body gone, bytes in :backup

    const tomb = repo.deleteProject(a.id)!;
    expect(tomb.body).toBeNull();
    expect(tomb.backup).toBe("{broken json!!");
    expect(backing.has(projectBackupKey(a.id))).toBe(false);

    expect(repo.restoreProject(tomb)).toBe(true);
    expect(backing.get(projectBackupKey(a.id))).toBe("{broken json!!");
    expect(repo.getMeta(a.id)?.broken).toBe(true);
  });

  it("另一個分頁新增的專案不會被本頁的 flushIndex 蓋掉", () => {
    const a = repo.createProject({ project: planWith("A") });
    const b = repo.createProject({ project: planWith("B") });

    // Another tab writes a third project straight into the shared index.
    const onDisk = JSON.parse(backing.get(PROJECT_INDEX_KEY)!) as ProjectMeta[];
    const c: ProjectMeta = { id: "proj_other_tab", name: "另一個分頁", createdAt: 5, updatedAt: 5 };
    backing.set(PROJECT_INDEX_KEY, JSON.stringify([...onDisk, c]));
    backing.set(projectBodyKey(c.id), JSON.stringify({ ...planWith("另一個分頁"), id: c.id }));

    const load = repo.openProject(a.id);
    if (load.ok) {
      load.project.name = "A 改過";
      repo.saveProject(a.id, load.project);
    }
    repo.flushIndex();

    const merged = JSON.parse(backing.get(PROJECT_INDEX_KEY)!) as ProjectMeta[];
    expect(merged.map((m) => m.id).sort()).toEqual([a.id, b.id, c.id].sort());
    expect(merged.find((m) => m.id === a.id)?.name).toBe("A 改過");
  });

  it("index 寫入失敗時不會留下截斷的 index，也會在下次 flush 重試", () => {
    const a = repo.createProject({ project: planWith("A") });
    const before = backing.get(PROJECT_INDEX_KEY)!;

    let failing = true;
    const errors: Array<"index" | "layout"> = [];
    repo.onError = (op) => errors.push(op);
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (failing && k === PROJECT_INDEX_KEY) throw new Error("QuotaExceededError");
        backing.set(k, v);
      },
      removeItem: (k: string) => void backing.delete(k),
      clear: () => backing.clear(),
    };

    repo.renameProject(a.id, "改過的名字");
    expect(errors).toContain("index");
    expect(backing.get(PROJECT_INDEX_KEY)).toBe(before);

    failing = false;
    repo.flushIndex();
    const after = JSON.parse(backing.get(PROJECT_INDEX_KEY)!) as ProjectMeta[];
    expect(after.find((m) => m.id === a.id)?.name).toBe("改過的名字");
  });

  it("重新命名以 body 為準，index 只是鏡子", () => {
    const a = repo.createProject({ project: planWith("原名") });
    expect(repo.renameProject(a.id, "新名字")).toBe(true);

    const load = repo.openProject(a.id);
    expect(load.ok).toBe(true);
    if (load.ok) expect(load.project.name).toBe("新名字");
    expect(repo.getMeta(a.id)?.name).toBe("新名字");

    // A body that will not parse is not renamed at all — a half-rename that
    // only touched the index would make the mirror lie.
    backing.set(projectBodyKey(a.id), "{broken");
    expect(repo.renameProject(a.id, "再改一次")).toBe(false);
    expect(repo.getMeta(a.id)?.name).toBe("新名字");
  });

  it("不存在的專案回報 missing，而不是 corrupt", () => {
    const load = repo.openProject("proj_never_existed");
    expect(load.ok).toBe(false);
    if (!load.ok) {
      expect(load.reason).toBe("missing");
      expect(load.meta).toBeNull();
    }
  });

  it("blocked storage 下每個讀取都回傳空值而不是丟例外", () => {
    (globalThis as { localStorage?: unknown }).localStorage = undefined;
    const blocked = new ProjectRepository();
    expect(blocked.listProjects()).toEqual([]);
    expect(blocked.hasProjects()).toBe(false);
    expect(blocked.getActiveProjectId()).toBeNull();
    expect(blocked.openProject("proj_x").ok).toBe(false);
    expect(() => blocked.setActiveProjectId("proj_x")).not.toThrow();
    expect(() => blocked.createProject()).toThrow();
  });
});
