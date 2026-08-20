import { beforeEach, describe, expect, it } from "vitest";
import { Store } from "../src/state/store";
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

  it("loads a healthy autosave without flagging recovery", () => {
    const p = createDefaultProject();
    p.name = "健康專案";
    backing.set("planform-iso:autosave", JSON.stringify(p));
    const { project, recovered } = Store.loadAutosaveWithRecovery();
    expect(recovered).toBe(false);
    expect(project?.name).toBe("健康專案");
  });

  it("corrupt autosave → backup kept, recovery flagged, no throw", () => {
    backing.set("planform-iso:autosave", "{broken json!!");
    const { project, recovered } = Store.loadAutosaveWithRecovery();
    expect(project).toBeNull();
    expect(recovered).toBe(true);
    expect(Store.corruptBackup()).toBe("{broken json!!");
    // The broken blob no longer shadows the next healthy autosave.
    expect(backing.get("planform-iso:autosave")).toBeUndefined();
  });

  it("empty storage is a normal first run, not a recovery", () => {
    const { project, recovered } = Store.loadAutosaveWithRecovery();
    expect(project).toBeNull();
    expect(recovered).toBe(false);
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
});
