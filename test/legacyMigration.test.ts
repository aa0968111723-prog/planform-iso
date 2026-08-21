import { beforeEach, describe, expect, it } from "vitest";
import { ProjectRepository, type CreateProjectOptions } from "../src/state/projectRepository";
import { __testing, clearLegacyKeys, runLegacyMigration } from "../src/state/legacyMigration";
import { projectBackupKey, type ProjectMeta } from "../src/state/projectStorage";
import { createDefaultProject, type Zone } from "../src/core/model";

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

function zone(name: string, x = 0): Zone {
  return {
    id: `zone_${name}`,
    type: "group",
    name,
    x,
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

/** A pre-library (v7) document, as the old autosave key would have held it. */
function legacyPlan(name: string, zones: Zone[] = []): Record<string, unknown> {
  const p = createDefaultProject() as unknown as Record<string, unknown>;
  delete p.id;
  p.version = 7;
  p.name = name;
  p.zones = zones;
  return p;
}

const AUTOSAVE = "planform-iso:autosave";
const AUTOSAVE_BACKUP = "planform-iso:autosave-backup";
const LAYOUTS = "planform-iso:layouts";

describe("legacy migration", () => {
  let backing: Map<string, string>;
  let repo: ProjectRepository;

  beforeEach(() => {
    backing = installLocalStorage();
    repo = new ProjectRepository();
  });

  it("舊的 autosave 變成一份專案，舊的 layouts 各自變成專案", () => {
    backing.set(AUTOSAVE, JSON.stringify(legacyPlan("去年的活動", [zone("報到區")])));
    backing.set(AUTOSAVE_BACKUP, "{一個更早的壞檔案");
    backing.set(
      LAYOUTS,
      JSON.stringify({
        春季場: legacyPlan("春季場", [zone("舞台")]),
        秋季場: legacyPlan("秋季場", [zone("走道")]),
      }),
    );

    const result = runLegacyMigration(repo);
    expect(result.created).toBe(3);
    expect(result.skipped).toBe(false);

    const names = repo.listProjects().map((m) => m.name).sort();
    expect(names).toEqual(["去年的活動", "春季場", "秋季場"]);

    const active = repo.getActiveProjectId();
    expect(active).not.toBeNull();
    expect(repo.getMeta(active!)?.name).toBe("去年的活動");

    // Requirement 6: nothing is deleted. The legacy keys stay as a cold backup.
    expect(backing.get(AUTOSAVE)).toBeDefined();
    expect(backing.get(AUTOSAVE_BACKUP)).toBe("{一個更早的壞檔案");
    expect(backing.get(LAYOUTS)).toBeDefined();

    expect(__testing.readProgress()?.done).toBe(true);
  });

  it("排法只有位置不同時不會被當成重複刪掉", () => {
    // Exactly the shape `saveNamedLayout` produced: the same name and all four
    // counts on both sides, differing only in where one zone sits.
    backing.set(AUTOSAVE, JSON.stringify(legacyPlan("版本A", [zone("報到區", 5)])));
    backing.set(LAYOUTS, JSON.stringify({ 版本A: legacyPlan("版本A", [zone("報到區", 0)]) }));

    runLegacyMigration(repo);
    expect(repo.listProjects()).toHaveLength(2);
  });

  it("完全相同的 body 才會被視為重複", () => {
    const body = legacyPlan("版本A", [zone("報到區")]);
    backing.set(AUTOSAVE, JSON.stringify(body));
    backing.set(LAYOUTS, JSON.stringify({ 版本A: body }));

    runLegacyMigration(repo);
    expect(repo.listProjects()).toHaveLength(1);
  });

  it("跑第二次不會複製一份", () => {
    backing.set(AUTOSAVE, JSON.stringify(legacyPlan("去年的活動")));
    backing.set(LAYOUTS, JSON.stringify({ 春季場: legacyPlan("春季場", [zone("舞台")]) }));

    runLegacyMigration(repo);
    const first = repo.listProjects().length;
    const second = runLegacyMigration(repo);
    expect(second.skipped).toBe(true);
    expect(repo.listProjects()).toHaveLength(first);

    // Even a fresh repository instance (i.e. a new tab) must not re-promote.
    runLegacyMigration(new ProjectRepository());
    expect(repo.listProjects()).toHaveLength(first);
  });

  it("中斷後再跑會補完剩下的，不會凍結", () => {
    const layouts: Record<string, unknown> = {};
    for (const name of ["A場", "B場", "C場", "D場", "E場"]) {
      layouts[name] = legacyPlan(name, [zone(name)]);
    }
    backing.set(LAYOUTS, JSON.stringify(layouts));

    class FlakyRepo extends ProjectRepository {
      created = 0;
      broken = true;
      override createProject(opts: CreateProjectOptions = {}): ProjectMeta {
        if (this.broken && this.created >= 2) throw new Error("QuotaExceededError");
        this.created += 1;
        return super.createProject(opts);
      }
    }

    const flaky = new FlakyRepo();
    runLegacyMigration(flaky);
    expect(flaky.listProjects()).toHaveLength(2);
    expect(__testing.readProgress()?.done).toBe(false);

    flaky.broken = false;
    runLegacyMigration(flaky);
    const names = flaky.listProjects().map((m) => m.name).sort();
    expect(names).toEqual(["A場", "B場", "C場", "D場", "E場"]);
    expect(__testing.readProgress()?.done).toBe(true);
  });

  it("舊 autosave 壞掉時仍完成遷移，且原始 bytes 被保留", () => {
    backing.set(AUTOSAVE, "{broken autosave!!");
    backing.set(AUTOSAVE_BACKUP, "{一個更早的壞檔案");
    backing.set(
      LAYOUTS,
      JSON.stringify({
        春季場: legacyPlan("春季場", [zone("舞台")]),
        秋季場: legacyPlan("秋季場", [zone("走道")]),
      }),
    );

    const result = runLegacyMigration(repo);
    expect(result.quarantined).toBe(1);

    const metas = repo.listProjects();
    expect(metas).toHaveLength(3);
    const broken = metas.find((m) => m.broken);
    expect(broken).toBeDefined();
    expect(broken!.name).toContain("需要復原");
    expect(backing.get(projectBackupKey(broken!.id))).toBe("{broken autosave!!");

    // The app's own last-resort copy is not legacy data and is never touched.
    expect(backing.get(AUTOSAVE_BACKUP)).toBe("{一個更早的壞檔案");
    expect(repo.listProjects().filter((m) => !m.broken).map((m) => m.name).sort()).toEqual([
      "春季場",
      "秋季場",
    ]);
  });

  it("壞掉的 layouts 會被隔離，但 autosave 仍然完成遷移", () => {
    backing.set(AUTOSAVE, JSON.stringify(legacyPlan("去年的活動", [zone("報到區")])));
    backing.set(LAYOUTS, "{broken layouts!!");

    const result = runLegacyMigration(repo);
    expect(result.created).toBe(1);
    expect(result.quarantined).toBe(1);
    expect(backing.get("planform-iso:layouts-backup")).toBe("{broken layouts!!");
    expect(repo.listProjects().map((m) => m.name)).toEqual(["去年的活動"]);
  });

  it("沒有舊資料時什麼都不做，讓 boot 走真正的第一次啟動", () => {
    const result = runLegacyMigration(repo);
    expect(result.created).toBe(0);
    expect(repo.listProjects()).toEqual([]);
    expect(repo.getActiveProjectId()).toBeNull();
    expect(__testing.readProgress()?.done).toBe(true);
  });

  it("clearLegacyKeys 不會刪掉 autosave-backup，且未完成時拒絕執行", () => {
    backing.set(AUTOSAVE, JSON.stringify(legacyPlan("去年的活動")));
    backing.set(AUTOSAVE_BACKUP, "{壞掉的原始資料");
    backing.set(LAYOUTS, JSON.stringify({ 春季場: legacyPlan("春季場", [zone("舞台")]) }));

    // Not migrated yet → refuses.
    expect(clearLegacyKeys().cleared).toBe(false);

    runLegacyMigration(repo);

    // A layout that appeared after the migration ran → still refuses.
    const layouts = JSON.parse(backing.get(LAYOUTS)!) as Record<string, unknown>;
    layouts["新的一場"] = legacyPlan("新的一場");
    backing.set(LAYOUTS, JSON.stringify(layouts));
    const refused = clearLegacyKeys();
    expect(refused.cleared).toBe(false);
    expect(refused.reason).toContain("新的一場");

    // Everything accounted for → clears the two legacy keys only.
    runLegacyMigration(new ProjectRepository());
    delete layouts["新的一場"];
    backing.set(LAYOUTS, JSON.stringify(layouts));
    expect(clearLegacyKeys().cleared).toBe(true);
    expect(backing.has(AUTOSAVE)).toBe(false);
    expect(backing.has(LAYOUTS)).toBe(false);
    expect(backing.get(AUTOSAVE_BACKUP)).toBe("{壞掉的原始資料");
  });

  it("index 已有專案但沒有進度紀錄時，不會再複製一份", () => {
    const plan = legacyPlan("去年的活動", [zone("報到區")]);
    backing.set(AUTOSAVE, JSON.stringify(plan));
    runLegacyMigration(repo);
    expect(repo.listProjects()).toHaveLength(1);

    // Simulate a build that migrated and then lost its progress record.
    backing.delete("planform-iso:projects:migration");
    runLegacyMigration(new ProjectRepository());
    expect(repo.listProjects()).toHaveLength(1);
  });
});
