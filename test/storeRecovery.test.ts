import { beforeEach, describe, expect, it } from "vitest";
import { Store } from "../src/state/store";
import { ProjectRepository } from "../src/state/projectRepository";
import { projectBodyKey, readLegacyCorruptBackup } from "../src/state/projectStorage";
import { createDefaultProject } from "../src/core/model";

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

describe("autosave recovery", () => {
  let backing: Map<string, string>;
  beforeEach(() => {
    backing = installLocalStorage();
  });

  it("舊版存檔的損壞備份仍然拿得到（更多 → 下載損壞前的備份）", () => {
    expect(readLegacyCorruptBackup()).toBeNull();
    backing.set("planform-iso:autosave-backup", "{broken json!!");
    expect(readLegacyCorruptBackup()).toBe("{broken json!!");
  });

  it("flushAutosave writes immediately", () => {
    const store = new Store(createDefaultProject());
    store.mutate((p) => (p.name = "立即寫入"), { history: false });
    store.flushAutosave();
    expect(backing.get("planform-iso:autosave")).toContain("立即寫入");
  });

  it("storage failure reports once via onStorageError", () => {
    let calls = 0;
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => undefined,
    };
    const store = new Store(createDefaultProject());
    store.onStorageError = () => calls++;
    store.saveAutosave();
    store.saveAutosave();
    expect(calls).toBe(1);
  });

  it("keeps an undo checkpoint before replacing a non-empty project", () => {
    const current = createDefaultProject();
    current.zones.push({
      id: "zone-1", type: "registration", name: "報到區", x: 1, z: 1,
      width: 2, depth: 2, color: "#ddd", locked: false, hidden: false, icon: "", capacity: null,
    });
    const incoming = createDefaultProject();
    incoming.name = "匯入專案";
    const store = new Store(current);

    store.loadProject(incoming);
    expect(store.getState().name).toBe("匯入專案");
    expect(store.canUndo()).toBe(true);
    store.undo();
    expect(store.getState().name).toBe("未命名平面圖");
    expect(store.getState().zones).toHaveLength(1);
  });

  it("reports named-layout write failures and recovers autosave banner state", () => {
    let layoutError: "save" | "delete" | null = null;
    let recovered = 0;
    const storage = (globalThis as { localStorage?: { setItem: (k: string, v: string) => void; getItem: (k: string) => string | null; removeItem: (k: string) => void } }).localStorage!;
    storage.setItem = () => { throw new Error("quota"); };
    const store = new Store(createDefaultProject());
    store.onLayoutError = (action) => { layoutError = action; };
    expect(store.saveNamedLayout("不能保存")).toBe(false);
    expect(layoutError).toBe("save");
    expect(store.deleteNamedLayout("不能刪除")).toBe(false);
    expect(layoutError).toBe("delete");

    store.onStorageError = () => undefined;
    store.onStorageRecovered = () => recovered++;
    store.saveAutosave();
    storage.setItem = () => undefined;
    store.saveAutosave();
    expect(recovered).toBe(1);
  });

  it("setPersistence 後，autosave 寫到專案 key，舊的 autosave key 不再被寫", () => {
    const repo = new ProjectRepository();
    const meta = repo.createProject({ name: "A 活動" });
    const store = new Store(createDefaultProject());
    store.setPersistence(repo.persistenceFor(meta.id));

    store.mutate((p) => (p.name = "改過的名字"), { history: false });
    store.flushAutosave();

    expect(backing.get(projectBodyKey(meta.id))).toContain("改過的名字");
    expect(backing.has("planform-iso:autosave")).toBe(false);
  });

  it("setPersistence 後儲存場佈不會改掉專案名稱；legacy 模式仍會", () => {
    const repo = new ProjectRepository();
    const meta = repo.createProject({ name: "A 活動" });
    const store = new Store(createDefaultProject());
    store.setPersistence(repo.persistenceFor(meta.id));
    store.mutate((p) => (p.name = "A 活動"), { history: false });

    expect(store.saveNamedLayout("晚宴版")).toBe(true);
    expect(store.getState().name).toBe("A 活動");
    expect(store.listLayouts()).toEqual(["晚宴版"]);

    // The legacy branch keeps its old behaviour, and is still exercised, so it
    // cannot rot behind the branch production actually takes.
    const legacy = new Store(createDefaultProject());
    expect(legacy.saveNamedLayout("晚宴版")).toBe(true);
    expect(legacy.getState().name).toBe("晚宴版");
  });

  it("配額爆掉只回報一次，且 index 失敗不會謊稱已恢復", () => {
    let errors = 0;
    let recovered = 0;
    const store = new Store(createDefaultProject());
    // A sink whose body write always fails. The index write beside it may well
    // succeed — it must never be allowed to clear the banner.
    store.setPersistence({
      saveProject: () => {
        throw new Error("QuotaExceededError");
      },
      listLayouts: () => [],
      readLayout: () => null,
      writeLayout: () => undefined,
      deleteLayout: () => undefined,
    });
    store.onStorageError = () => errors++;
    store.onStorageRecovered = () => recovered++;

    store.saveAutosave();
    store.saveAutosave();
    expect(errors).toBe(1);
    expect(recovered).toBe(0);
  });
});
