import { beforeEach, describe, expect, it } from "vitest";
import { Store } from "../src/state/store";
import { createDefaultProject } from "../src/core/model";
import { ProjectRepository } from "../src/state/projectRepository";

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

describe("per-project autosave isolation", () => {
  beforeEach(() => {
    installLocalStorage();
    ProjectRepository._resetForTests();
  });

  it("edits land in the bound project, not the global autosave key", () => {
    const a = ProjectRepository.createProject({ name: "A", project: createDefaultProject() });
    const store = new Store(createDefaultProject());
    store.bindProject(a.id);
    store.mutate((p) => (p.name = "只屬於 A"), { history: false });
    store.flushAutosave();

    const opened = ProjectRepository.openProject(a.id);
    expect(opened.ok && opened.project.name).toBe("只屬於 A");
    // The legacy single-project key must not be written any more.
    expect(localStorage.getItem("planform-iso:autosave")).toBeNull();
  });

  it("editing A then switching to B leaves A intact — the P0 the brief named", () => {
    const a = ProjectRepository.createProject({ name: "E310 30 人社課", project: createDefaultProject() });
    const b = ProjectRepository.createProject({ name: "E310 60 人演講", project: createDefaultProject() });
    const store = new Store(createDefaultProject());

    store.bindProject(a.id);
    store.mutate((p) => (p.description = "A 的地墊改過了"), { history: false });

    // Switch to B and edit it.
    const openedB = ProjectRepository.openProject(b.id);
    expect(openedB.ok).toBe(true);
    if (openedB.ok) store.openBoundProject(b.id, openedB.project);
    store.mutate((p) => (p.description = "B 的報到改過了"), { history: false });
    store.flushAutosave();

    // Back to A: it must be exactly as it was left.
    const backToA = ProjectRepository.openProject(a.id);
    expect(backToA.ok && backToA.project.description).toBe("A 的地墊改過了");
    const stillB = ProjectRepository.openProject(b.id);
    expect(stillB.ok && stillB.project.description).toBe("B 的報到改過了");
  });

  it("switching projects clears undo history rather than letting A undo into B", () => {
    const a = ProjectRepository.createProject({ name: "A", project: createDefaultProject() });
    const b = ProjectRepository.createProject({ name: "B", project: createDefaultProject() });
    const store = new Store(createDefaultProject());
    store.bindProject(a.id);
    store.mutate((p) => (p.name = "A 改過"));
    expect(store.canUndo()).toBe(true);

    const openedB = ProjectRepository.openProject(b.id);
    if (openedB.ok) store.openBoundProject(b.id, openedB.project);
    expect(store.canUndo()).toBe(false);
    expect(store.getProjectId()).toBe(b.id);
  });

  it("a full disk while bound still reports through onStorageError", () => {
    const a = ProjectRepository.createProject({ name: "A", project: createDefaultProject() });
    const store = new Store(createDefaultProject());
    store.bindProject(a.id);
    let errors = 0;
    store.onStorageError = () => void errors++;
    const real = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (k: string, v: string) => {
      if (k.includes("projects:prj_")) throw new Error("QuotaExceededError");
      real(k, v);
    };
    store.mutate((p) => (p.name = "寫不進去"), { history: false });
    store.flushAutosave();
    expect(errors).toBe(1);
  });
});
