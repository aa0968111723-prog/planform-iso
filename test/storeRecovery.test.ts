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
});
